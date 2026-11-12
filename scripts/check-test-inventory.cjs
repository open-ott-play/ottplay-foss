#!/usr/bin/env node
// Audit executable workflow steps, npm script edges and JS require/import edges.
// A filename appearing in a comment, source read or unused npm script is not coverage.
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const YAML = require("yaml");

function filesBelow(directory) {
    if (!fs.existsSync(directory)) return [];
    return fs
        .readdirSync(directory, { withFileTypes: true })
        .flatMap((entry) => {
            const file = path.join(directory, entry.name);
            return entry.isDirectory()
                ? ["target", "__pycache__", "node_modules"].includes(entry.name)
                    ? []
                    : filesBelow(file)
                : [file];
        });
}

// Preserve quoted arguments and command boundaries; discard shell comments.
function commands(source) {
    const result = [];
    let command = [],
        word = "",
        quote = "",
        started = false;
    const flushWord = () => {
        if (started) command.push(word);
        word = "";
        started = false;
    };
    const flushCommand = () => {
        flushWord();
        if (command.length) result.push(command);
        command = [];
    };
    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (c === "\\" && quote !== "'" && i + 1 < source.length) {
            const next = source[++i];
            if (next !== "\n") {
                word += next;
                started = true;
            }
        } else if (quote) {
            if (c === quote) quote = "";
            else word += c;
        } else if (c === "'" || c === '"') {
            quote = c;
            started = true;
        } else if (c === "#" && !started) {
            while (i < source.length && source[i] !== "\n") i++;
            flushCommand();
        } else if ("\n;|&".includes(c)) {
            flushCommand();
        } else if (/\s/.test(c)) {
            flushWord();
        } else {
            word += c;
            started = true;
        }
    }
    flushCommand();
    return result;
}

function inspect(root) {
    root = path.resolve(root);
    const relative = (file) =>
        path.relative(root, file).split(path.sep).join("/");
    const testFiles = [
        ...filesBelow(path.join(root, "tests")),
        ...filesBelow(path.join(root, ".github/release-tests")),
    ]
        .filter(
            (file) =>
                /(?:^test[-_].*\.(?:cjs|ts|py)$|\.spec\.(?:cjs|ts)$|^android_provider_policy\.cjs$)/.test(
                    path.basename(file)
                ) || file.endsWith("/tests/variant_str_iter.rs")
        )
        .map(relative);
    const known = new Set(testFiles);
    const packageJson = JSON.parse(
        fs.readFileSync(path.join(root, "package.json"), "utf8")
    );
    const policy = JSON.parse(
        fs.readFileSync(path.join(root, "tests/ci-inventory.json"), "utf8")
    );
    let reached = new Map();
    let npmSeen = new Set();
    const errors = [];
    function visit(file, args = []) {
        if (!known.has(file)) return;
        if (!reached.has(file)) reached.set(file, new Set());
        const variants = reached.get(file);
        const key = JSON.stringify(args);
        if (variants.has(key)) return;
        variants.add(key);
        if (!/\.(?:cjs|ts)$/.test(file)) return;
        const ast = ts.createSourceFile(
            file,
            fs.readFileSync(path.join(root, file), "utf8"),
            ts.ScriptTarget.Latest,
            true
        );
        function walk(node) {
            let specifier;
            if (
                ts.isCallExpression(node) &&
                node.arguments.length === 1 &&
                (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                    (ts.isIdentifier(node.expression) &&
                        node.expression.text === "require"))
            ) {
                specifier = node.arguments[0];
            } else if (ts.isImportDeclaration(node)) {
                specifier = node.moduleSpecifier;
            }
            if (
                specifier &&
                ts.isStringLiteral(specifier) &&
                specifier.text.startsWith(".")
            ) {
                visit(
                    relative(
                        path.resolve(root, path.dirname(file), specifier.text)
                    )
                );
            }
            ts.forEachChild(node, walk);
        }
        walk(ast);
    }
    function readCommands(source, cwd = root) {
        for (let words of commands(source)) {
            while (
                words.length &&
                (/^[A-Za-z_][A-Za-z_0-9]*=/.test(words[0]) ||
                    words[0] === "env")
            )
                words = words.slice(1);
            if (!words.length) continue;
            if (
                words[0] === "npm" &&
                (words[1] === "run" || words[1] === "test")
            ) {
                const name = words[1] === "test" ? "test" : words[2];
                if (npmSeen.has(name)) continue;
                npmSeen.add(name);
                if (!packageJson.scripts[name])
                    errors.push(`Missing npm script: ${name}`);
                else readCommands(packageJson.scripts[name], cwd);
            } else if (
                (words[0] === "playwright" && words[1] === "test") ||
                (words[0] === "npx" &&
                    words[1] === "playwright" &&
                    words[2] === "test")
            ) {
                // Require explicit spec paths so an unused npm script, install
                // command or unrelated Playwright invocation cannot count as CI.
                if (
                    words.some((word) =>
                        ["--list", "--help", "-h", "--version", "-V"].includes(
                            word
                        )
                    )
                )
                    continue;
                for (const file of words.slice(words[0] === "npx" ? 3 : 2)) {
                    if (/\.spec\.(?:cjs|ts)$/.test(file))
                        visit(relative(path.resolve(cwd, file)));
                }
            } else if (["node", "python3", "python"].includes(words[0])) {
                if (
                    words[1] === "scripts/test-python.py" &&
                    !words.some((word) => ["--help", "-h"].includes(word))
                ) {
                    const profile = words.includes("--profile")
                        ? words[words.indexOf("--profile") + 1]
                        : "portable";
                    const suites = JSON.parse(
                        fs.readFileSync(
                            path.join(root, "tests/python-suites.json"),
                            "utf8"
                        )
                    );
                    if (!suites[profile])
                        errors.push(`Unknown Python suite profile: ${profile}`);
                    else
                        for (const [file, ...args] of suites[profile])
                            visit(file, args);
                } else if (
                    words.includes("unittest") &&
                    words.includes("discover")
                ) {
                    const directory = words[words.indexOf("-s") + 1];
                    const pattern = words.includes("-p")
                        ? words[words.indexOf("-p") + 1]
                        : "test*.py";
                    const glob = new RegExp(
                        "^" +
                            pattern
                                .split("*")
                                .map((s) =>
                                    s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
                                )
                                .join(".*") +
                            "$"
                    );
                    for (const file of filesBelow(
                        path.resolve(cwd, directory)
                    )) {
                        if (glob.test(path.basename(file)))
                            visit(relative(file));
                    }
                } else {
                    const index = words.findIndex(
                        (word, i) =>
                            i > 0 &&
                            !word.startsWith("-") &&
                            /\.(?:cjs|ts|py)$/.test(word)
                    );
                    if (index >= 0)
                        visit(
                            relative(path.resolve(cwd, words[index])),
                            words.slice(index + 1)
                        );
                }
            } else if (
                words[0] === "cargo" &&
                words[1] === "test" &&
                words.includes("--manifest-path")
            ) {
                const manifest = words[words.indexOf("--manifest-path") + 1];
                for (const file of filesBelow(
                    path.resolve(cwd, path.dirname(manifest), "tests")
                ))
                    visit(relative(file));
            }
        }
    }
    const workflows = new Map();
    for (const file of filesBelow(path.join(root, ".github/workflows")).filter(
        (file) => /\.ya?ml$/.test(file)
    )) {
        workflows.set(
            relative(file),
            YAML.parse(fs.readFileSync(file, "utf8"))
        );
    }
    let workflowSeen = new Set();
    function disabled(condition, scope) {
        if (
            condition === false ||
            ["false", "${{ false }}"].includes(String(condition).trim())
        )
            return true;
        // A false prefix cannot suppress an outer OR alternative. Unsupported
        // expressions remain structurally reachable, without evaluating GHA.
        let depth = 0,
            quote = "";
        const expression = String(condition).trim();
        for (let i = 0; i < expression.length; i++) {
            const character = expression[i];
            if (quote) {
                if (character === quote) {
                    if (expression[i + 1] === quote) i++;
                    else quote = "";
                }
            } else if (character === "'" || character === '"')
                quote = character;
            else if (character === "(") depth++;
            else if (character === ")" && --depth < 0) return false;
            else if (!depth && character === "|" && expression[i + 1] === "|")
                return false;
        }
        if (quote || depth) return false;
        // Only resolve the declared platform selector, never arbitrary GHA code.
        const selected =
            /^\$\{\{\s*inputs\.runtime-platform-scope\s*(==|!=)\s*(['"])(all|windows)\2\s*(?:&&|\}\})/.exec(
                String(condition).trim()
            );
        return (
            ["all", "windows"].includes(scope) &&
            selected !== null &&
            (selected[1] === "=="
                ? scope !== selected[3]
                : scope === selected[3])
        );
    }
    function visitWorkflow(file, inputs = {}, callerScope) {
        const workflow = workflows.get(file);
        if (!workflow) {
            errors.push(`Missing reusable workflow: ${file}`);
            return;
        }
        const declared =
            workflow.on?.workflow_call?.inputs?.["runtime-platform-scope"];
        const supplied = inputs["runtime-platform-scope"];
        let scope = supplied === undefined ? declared?.default : supplied;
        if (scope === "${{ inputs.runtime-platform-scope }}")
            scope = callerScope;
        if (!declared || !["all", "windows"].includes(scope)) scope = undefined;
        const key = JSON.stringify([file, scope ?? null]);
        if (workflowSeen.has(key)) return;
        workflowSeen.add(key);
        for (const job of Object.values(workflow.jobs || {})) {
            if (disabled(job.if, scope)) continue;
            if (job.uses?.startsWith("./.github/workflows/"))
                visitWorkflow(job.uses.slice(2), job.with || {}, scope);
            for (const step of job.steps || []) {
                if (typeof step.run === "string" && !disabled(step.if, scope)) {
                    const directory =
                        step["working-directory"] ||
                        job.defaults?.run?.["working-directory"] ||
                        workflow.defaults?.run?.["working-directory"] ||
                        ".";
                    readCommands(step.run, path.resolve(root, directory));
                }
            }
        }
    }
    for (const [file, workflow] of workflows) {
        const triggers =
            typeof workflow.on === "string"
                ? [workflow.on]
                : Array.isArray(workflow.on)
                  ? workflow.on
                  : Object.keys(workflow.on || {});
        if (
            triggers.some((trigger) =>
                [
                    "push",
                    "pull_request",
                    "pull_request_target",
                    "merge_group",
                    "schedule",
                ].includes(trigger)
            )
        )
            visitWorkflow(file);
    }
    // These are structural workflow paths, not evidence that tests executed.
    // Manual suites remain available without pretending they run on each PR.
    const automatic = reached;
    reached = new Map();
    npmSeen = new Set();
    workflowSeen = new Set();
    for (const [file, workflow] of workflows) {
        const triggers =
            typeof workflow.on === "string"
                ? [workflow.on]
                : Array.isArray(workflow.on)
                  ? workflow.on
                  : Object.keys(workflow.on || {});
        if (triggers.includes("workflow_dispatch")) visitWorkflow(file);
    }
    const manual = reached;
    const manualOnly = [...reached.keys()]
        .filter((file) => !automatic.has(file))
        .sort();
    reached = new Map(
        [...manual].map(([file, variants]) => [file, new Set(variants)])
    );
    for (const [file, variants] of automatic) {
        if (!reached.has(file)) reached.set(file, new Set());
        for (const variant of variants) reached.get(file).add(variant);
    }
    const excluded = policy.excluded || {};
    for (const [file, reason] of Object.entries(excluded)) {
        if (typeof reason !== "string" || reason.trim().length < 12)
            errors.push(`Exclusion needs a concrete reason: ${file}`);
        if (!known.has(file)) errors.push(`Stale exclusion: ${file}`);
        if (reached.has(file))
            errors.push(`Remove exclusion for covered test: ${file}`);
    }
    for (const file of testFiles) {
        if (!reached.has(file) && !Object.hasOwn(excluded, file))
            errors.push(`Test unreachable from CI: ${file}`);
    }
    for (const [file, variants] of Object.entries(
        policy.requiredVariants || {}
    )) {
        if (!known.has(file)) errors.push(`Missing required test: ${file}`);
        for (const args of variants) {
            if (!automatic.get(file)?.has(JSON.stringify(args)))
                errors.push(`Missing CI variant: ${file} ${args.join(" ")}`);
        }
    }
    const manualRequiredVariants = policy.manualRequiredVariants || {};
    for (const [file, variants] of Object.entries(manualRequiredVariants)) {
        if (!known.has(file))
            errors.push(`Missing required manual test: ${file}`);
        if (!Array.isArray(variants) || !variants.length) {
            errors.push(`Invalid required manual variants: ${file}`);
            continue;
        }
        for (const args of variants) {
            if (
                !Array.isArray(args) ||
                args.some((arg) => typeof arg !== "string")
            )
                errors.push(`Invalid required manual variant: ${file}`);
            else if (!manual.get(file)?.has(JSON.stringify(args)))
                errors.push(
                    `Missing manual CI variant: ${file} ${args.join(" ")}`
                );
        }
    }
    return {
        discovered: testFiles.length,
        automaticReached: automatic.size,
        manualOnly,
        manualRequiredVariants,
        errors,
        excluded: Object.keys(excluded).length,
        reached: reached.size,
    };
}

if (require.main === module) {
    const result = inspect(path.resolve(__dirname, ".."));
    if (result.errors.length) {
        console.error(result.errors.join("\n"));
        process.exitCode = 1;
    } else {
        console.log(
            `PASS structural CI inventory: ${result.automaticReached} automatically reachable, ${result.manualOnly.length} manual-only, ${result.excluded} justified exclusions (${result.discovered} discovered); reachability is not execution evidence`
        );
        for (const file of result.manualOnly)
            console.log(`MANUAL-ONLY: ${file}`);
        for (const [file, variants] of Object.entries(
            result.manualRequiredVariants
        ))
            for (const args of variants)
                console.log(
                    `MANUAL-REQUIRED VARIANT: ${file} ${args.join(" ")}`
                );
    }
}
module.exports = { commands, inspect };
