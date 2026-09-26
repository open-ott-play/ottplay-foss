const { createHash } = require("node:crypto");
const { parse } = require("acorn");
const { minify } = require("terser");
const { version: engineVersion } = require("terser/package.json");
const ts = require("typescript");

// Preserve callable API identities (including callbacks exported by a closure).
// Only local declarations used exclusively as direct calls can lose their name.
// A spelling shared with another binding is kept: Terser's keep_fnames option
// matches names, not lexical symbols. Escapes and known dynamic reflection keep
// names; private stack-frame names are not part of the published player ABI.
function privateFunctionNames(source) {
    const filename = "classic-player.js";
    const options = {
        allowJs: true,
        noLib: true,
        noResolve: true,
        target: ts.ScriptTarget.ES5,
        types: [],
    };
    const tree = ts.createSourceFile(
        filename,
        source,
        ts.ScriptTarget.ES5,
        true,
        ts.ScriptKind.JS
    );
    const host = ts.createCompilerHost(options);
    host.getSourceFile = (name) => (name === filename ? tree : undefined);
    host.fileExists = (name) => name === filename;
    host.readFile = (name) => (name === filename ? source : undefined);
    const program = ts.createProgram([filename], options, host);
    const checker = program.getTypeChecker();
    const declarations = [];
    const bindings = new Map();
    const references = new Map();
    let dynamic = false;
    function collect(map, key, node) {
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(node);
    }
    function visit(node, depth = 0) {
        if (ts.isIdentifier(node)) {
            const symbol = ts.isShorthandPropertyAssignment(node.parent)
                ? checker.getShorthandAssignmentValueSymbol(node.parent)
                : checker.getSymbolAtLocation(node);
            if (symbol) collect(references, symbol, node);
            if (node.text === "eval" || node.text === "Function")
                dynamic = true;
        }
        if (ts.isWithStatement(node)) dynamic = true;
        if (
            ts.isStringLiteral(node) &&
            ["caller", "callee"].includes(node.text)
        )
            dynamic = true;
        if (
            ts.isElementAccessExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === "arguments" &&
            !(
                checker.getTypeAtLocation(node.argumentExpression).flags &
                ts.TypeFlags.NumberLike
            )
        )
            dynamic = true;
        const property = ts.isPropertyAccessExpression(node)
            ? node.name.text
            : ts.isElementAccessExpression(node) &&
                ts.isStringLiteral(node.argumentExpression)
              ? node.argumentExpression.text
              : undefined;
        if (property === "caller" || property === "callee") dynamic = true;
        if (
            (ts.isVariableDeclaration(node) ||
                ts.isParameter(node) ||
                ts.isFunctionDeclaration(node) ||
                ts.isFunctionExpression(node)) &&
            node.name &&
            ts.isIdentifier(node.name)
        )
            collect(bindings, node.name.text, node);
        if (depth > 0 && ts.isFunctionDeclaration(node) && node.name) {
            declarations.push({
                name: node.name.text,
                node,
                symbol: checker.getSymbolAtLocation(node.name),
            });
        }
        ts.forEachChild(node, (child) =>
            visit(child, depth + (ts.isFunctionLike(node) ? 1 : 0))
        );
    }
    visit(tree);
    if (dynamic) return [];
    return declarations
        .filter(
            ({ node, name, symbol }) =>
                symbol &&
                bindings.get(name).length === 1 &&
                references
                    .get(symbol)
                    ?.every(
                        (reference) =>
                            reference === node.name ||
                            (ts.isCallExpression(reference.parent) &&
                                reference.parent.expression === reference)
                    )
        )
        .map(({ name }) => name)
        .sort();
}

function classicOptimizerMetadata() {
    // Device/provider scripts load later and may read or replace any global.
    // Menu preferences also persist callback.name; arity is part of the ABI.
    // Return fresh options because Terser may normalize its input options.
    return {
        contracts: {
            classicGlobals: true,
            functionArity: true,
            functionNames: true,
            propertyNames: true,
            sourceText: false,
        },
        engine: "terser",
        engineVersion,
        options: {
            compress: {
                // Preserve omitted/mapped arguments and native Boolean payloads.
                arguments: false,
                booleans_as_integers: false,
                defaults: true,
                drop_console: false,
                drop_debugger: false,
                keep_fargs: true,
                passes: 3,
                pure_getters: false,
                toplevel: false,
                // Terser documents typeof rewrites as unsafe on IE <= 10.
                typeofs: false,
                unsafe: false,
            },
            ecma: 5,
            format: { comments: false, webkit: true },
            ie8: true,
            keep_classnames: true,
            keep_fnames: true,
            mangle: { eval: false, properties: false, toplevel: false },
            module: false,
            safari10: true,
            toplevel: false,
        },
        schema: 1,
    };
}

function classicGlobals(source) {
    const ast = parse(source, { ecmaVersion: 5, sourceType: "script" });
    const names = new Set();
    function visit(node) {
        if (!node || typeof node !== "object") return;
        if (node.type === "FunctionDeclaration") {
            names.add(node.id.name);
            return;
        }
        if (node.type === "FunctionExpression") return;
        if (node.type === "VariableDeclaration") {
            for (const declaration of node.declarations)
                names.add(declaration.id.name);
        }
        // Include hoisted var declarations inside top-level control flow,
        // without treating catch parameters or function locals as globals.
        for (const value of Object.values(node)) {
            if (Array.isArray(value)) value.forEach(visit);
            else if (value && typeof value === "object") visit(value);
        }
    }
    visit(ast);
    return Array.from(names).sort();
}

function sha256(source) {
    return createHash("sha256").update(source, "utf8").digest("hex");
}

async function optimizeClassic(source) {
    if (typeof source !== "string")
        throw new TypeError("Classic optimizer requires an ES5 source string");
    const globalNames = classicGlobals(source);
    const metadata = classicOptimizerMetadata();
    const privateNames = privateFunctionNames(source);
    if (privateNames.length) {
        metadata.options.keep_fnames = new RegExp(
            "^(?!(?:" +
                privateNames
                    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
                    .join("|") +
                ")$)"
        );
        metadata.contracts.functionNames = "public-and-escaping";
    }
    const result = await minify(source, metadata.options);
    if (typeof result.code !== "string")
        throw new Error("Classic optimizer produced no JavaScript");
    const outputGlobals = new Set(classicGlobals(result.code));
    const missing = globalNames.filter((name) => !outputGlobals.has(name));
    if (missing.length)
        throw new Error(
            "Classic optimizer removed globals: " + missing.join(", ")
        );
    return {
        code: result.code,
        report: {
            globalNames,
            inputBytes: Buffer.byteLength(source, "utf8"),
            inputSha256: sha256(source),
            optimizer: {
                ...metadata,
                options: {
                    ...metadata.options,
                    // JSON reports must record the actual regexp, not {}.
                    keep_fnames: privateNames.length
                        ? { regexp: metadata.options.keep_fnames.source }
                        : true,
                },
                privateFunctionNames: privateNames,
            },
            outputBytes: Buffer.byteLength(result.code, "utf8"),
            outputSha256: sha256(result.code),
        },
    };
}

module.exports = { classicOptimizerMetadata, optimizeClassic };
