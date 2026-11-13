#!/usr/bin/env node
// Local pre-push checks; no native compilation, packaging, installation or device access.
const { spawn, execFileSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PYTHON_MODULE = `import sys, unittest
suite = unittest.defaultTestLoader.discover(sys.argv[1], pattern=sys.argv[2])
if suite.countTestCases() == 0:
    raise SystemExit('No tests discovered for ' + sys.argv[2])
result = unittest.TextTestRunner(verbosity=1).run(suite)
sys.exit(not result.wasSuccessful())
`;
function plan(root, python, browser = true) {
    const node = (name, args, seconds = 120, env = {}) => ({
        args,
        command: process.execPath,
        env,
        name,
        seconds,
    });
    const py = (name, args, seconds = 120) => ({
        args,
        command: python,
        env: {},
        name,
        seconds,
    });
    const steps = [
        py("python-prerequisites", [
            "-c",
            "import sys, yaml; assert sys.version_info[:2] == (3, 12), 'Use Python 3.12'; assert yaml.__version__ == '6.0.3', 'Install the existing hashed workflow requirements'",
        ]),
        node("gate-contracts", ["--test", "tests/test_windows_readiness.cjs"]),
        node("test-inventory", ["scripts/check-test-inventory.cjs"]),
        node("inventory-contracts", ["tests/test_ci_inventory.cjs"]),
        node("offline-profiles-lf-crlf", [
            "--test",
            "tests/test_offline_profiles.cjs",
        ]),
        node("pin-security", ["--test", "tests/test_pin_security.cjs"]),
        node("parental-input", ["tests/test_parental_pin_input.cjs"]),
        node("access-session", ["tests/test_access_session.cjs"]),
        // This manual CI preflight deliberately has no site packages or npm setup.
        py("macos-preflight-stdlib", [
            "-S",
            "tests/test_ci_macos_desktop_preflight.py",
        ]),
        py("workflow-policy", ["scripts/workflow_contracts.py"]),
        node(
            "lint",
            ["node_modules/@biomejs/biome/bin/biome", "check", "."],
            180
        ),
        node(
            "lint-correctness",
            [
                "node_modules/@biomejs/biome/bin/biome",
                "check",
                "--config-path=biome-correctness.json",
                "src",
            ],
            180
        ),
        node("typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"], 180),
        node("media-inputs", ["scripts/media-runtime.cjs", "check"]),
    ];
    for (const [directory, module] of [
        [".github/release-tests", "test_browser_candidate"],
        [".github/release-tests", "test_required_gate_cancellation"],
        [".github/release-tests", "test_linux_release_baseline"],
        [".github/release-tests", "test_macos_cross_build"],
        [".github/workflow-tests", "test_release_scope"],
        [".github/workflow-tests", "test_linux_playback_ci"],
    ]) {
        steps.push(
            py(module, ["-c", PYTHON_MODULE, directory, module + ".py"])
        );
    }
    if (browser) {
        steps.push(
            node(
                "frontend-build",
                ["node_modules/vite/bin/vite.js", "build"],
                600
            ),
            node(
                "delayed-pin-chromium",
                [
                    "node_modules/@playwright/test/cli.js",
                    "test",
                    "--config",
                    "playwright.native-ui.config.cjs",
                    "--project=chromium",
                    "--workers=1",
                    "--retries=0",
                    "--reporter=json",
                    "tests/browser/channel-list-csp.spec.cjs",
                    "--grep",
                    "remote channel selection closes the list after admission",
                ],
                180,
                { OTTP_TEST_PIN_CRYPTO_DELAY_MS: "250" }
            ),
            node(
                "browser-direct-media",
                ["tests/test_browser_direct_media.cjs"],
                180
            )
        );
    }
    return steps;
}

function runStep(step, directory, env, cwd = ROOT) {
    return new Promise((resolve) => {
        const started = Date.now();
        const log = path.join(directory, step.name + ".log");
        const fd = fs.openSync(log, "wx", 0o600);
        const child = spawn(step.command, step.args, {
            cwd,
            detached: process.platform !== "win32",
            env: { ...env, ...step.env },
            shell: false,
            stdio: ["ignore", fd, fd],
        });
        fs.closeSync(fd);
        let timedOut = false;
        let forceKill;
        const killGroup = (signal) => {
            try {
                if (process.platform === "win32") {
                    if (child.exitCode !== null || child.signalCode !== null)
                        return;
                    execFileSync(
                        "taskkill",
                        ["/PID", String(child.pid), "/T", "/F"],
                        { stdio: "ignore" }
                    );
                } else process.kill(-child.pid, signal);
            } catch (error) {
                if (error.code !== "ESRCH") throw error;
            }
        };
        const timer = setTimeout(() => {
            timedOut = true;
            killGroup("SIGTERM");
            if (process.platform !== "win32") {
                forceKill = setTimeout(() => killGroup("SIGKILL"), 1000);
            }
        }, step.seconds * 1000);
        child.once("error", (error) => {
            clearTimeout(timer);
            clearTimeout(forceKill);
            resolve({
                error: error.code,
                name: step.name,
                elapsed: (Date.now() - started) / 1000,
                status: "failed",
            });
        });
        child.once("close", (code, signal) => {
            clearTimeout(timer);
            if (!timedOut) clearTimeout(forceKill);
            resolve({
                code,
                name: step.name,
                elapsed: (Date.now() - started) / 1000,
                signal,
                status: timedOut ? "timeout" : code === 0 ? "passed" : "failed",
            });
        });
    });
}

async function runPlan(steps, directory, env, execute = runStep) {
    const results = [];
    const started = Date.now();
    for (const step of steps) {
        const remaining = 15 * 60 - (Date.now() - started) / 1000;
        if (remaining <= 0) {
            results.push({ name: step.name, status: "deadline-exhausted" });
            break;
        }
        const result = await execute(
            { ...step, seconds: Math.min(step.seconds, remaining) },
            directory,
            env
        );
        results.push(result);
        console.log(
            `${result.status.toUpperCase()} ${step.name} (${result.elapsed || 0}s)`
        );
        if (result.status !== "passed") break;
    }
    return results;
}

function options(args) {
    const result = { browser: true };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--skip-browser" && result.browser)
            result.browser = false;
        else if (args[i] === "--report-dir" && args[i + 1] && !result.directory)
            result.directory = path.resolve(args[++i]);
        else
            throw new Error(
                "Usage: npm run check:windows-readiness -- [--report-dir FRESH_DIRECTORY] [--skip-browser]"
            );
    }
    return result;
}

function validateBrowserReport(file) {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024)
        throw new Error("Invalid browser report");
    const report = JSON.parse(fs.readFileSync(file, "utf8"));
    const specs = [];
    const collect = (suites) => {
        for (const suite of suites || []) {
            specs.push(...(suite.specs || []));
            collect(suite.suites);
        }
    };
    collect(report.suites);
    const titles = ["server", "tauri", "capacitor"]
        .map(
            (profile) =>
                profile +
                " remote channel selection closes the list after admission"
        )
        .sort();
    if (
        JSON.stringify(specs.map((spec) => spec.title).sort()) !==
            JSON.stringify(titles) ||
        report.errors?.length !== 0 ||
        report.stats?.expected !== 3 ||
        report.stats?.unexpected !== 0 ||
        report.stats?.flaky !== 0 ||
        report.stats?.skipped !== 0 ||
        specs.some(
            (spec) =>
                !spec.ok ||
                spec.tests?.length !== 1 ||
                spec.tests[0].projectName !== "chromium" ||
                spec.tests[0].results?.length !== 1 ||
                spec.tests[0].results[0].status !== "passed" ||
                spec.tests[0].results[0].retry !== 0
        )
    )
        throw new Error(
            "Expected exactly three passing Chromium PIN cases without retry/skip"
        );
    return { cases: titles, deriveBitsDelayMs: 250, passed: 3, retries: 0 };
}

async function main() {
    const {
        browser,
        directory = path.join(ROOT, "build", "windows-readiness-" + Date.now()),
    } = options(process.argv.slice(2));
    if (process.versions.node.split(".")[0] !== "22")
        throw new Error("Use the CI Node 22 runtime");
    const python = process.env.PYTHON || "python3";
    const steps = plan(ROOT, python, browser);
    fs.mkdirSync(path.dirname(directory), { recursive: true });
    fs.mkdirSync(directory, { mode: 0o700 });
    const env = { PYTHONDONTWRITEBYTECODE: "1" };
    for (const key of [
        "HOME",
        "TMPDIR",
        "LANG",
        "LC_ALL",
        "PLAYWRIGHT_BROWSERS_PATH",
    ]) {
        if (process.env[key]) env[key] = process.env[key];
    }
    env.PATH = [
        path.dirname(process.execPath),
        ...(path.isAbsolute(python) ? [path.dirname(python)] : []),
        process.env.PATH,
    ]
        .filter(Boolean)
        .join(path.delimiter);
    const startedAt = new Date().toISOString();
    const git = (args) =>
        execFileSync("git", args, {
            cwd: ROOT,
            encoding: "utf8",
            maxBuffer: 16 * 1024 * 1024,
        });
    const head = git(["rev-parse", "HEAD"]).trim();
    const digest = (bytes) =>
        crypto.createHash("sha256").update(bytes).digest("hex");
    const diffSha256 = digest(git(["diff", "HEAD", "--binary"]));
    const dirty =
        git(["status", "--porcelain", "--untracked-files=normal"]).trim() !==
        "";
    if (browser)
        steps.find(
            (step) => step.name === "delayed-pin-chromium"
        ).env.PLAYWRIGHT_JSON_OUTPUT_FILE = path.join(
            directory,
            "browser.json"
        );
    let browserResult = null;
    const results = await runPlan(
        steps,
        directory,
        env,
        async (step, output, environment) => {
            const result = await runStep(step, output, environment);
            if (
                step.name === "delayed-pin-chromium" &&
                result.status === "passed"
            ) {
                try {
                    browserResult = validateBrowserReport(
                        path.join(directory, "browser.json")
                    );
                } catch (error) {
                    result.status = "failed";
                    result.error = error.message;
                }
            }
            return result;
        }
    );
    const sourceUnchanged =
        head === git(["rev-parse", "HEAD"]).trim() &&
        diffSha256 === digest(git(["diff", "HEAD", "--binary"]));
    const passed =
        sourceUnchanged &&
        results.length === steps.length &&
        results.every((result) => result.status === "passed");
    const report = {
        browserMode: browser ? "full" : "skip",
        browserResult,
        completedAt: new Date().toISOString(),
        diffSha256,
        dirty,
        head,
        nativeAcceptance: false,
        node: process.version,
        steps: results,
        schema: 1,
        scope: browser ? "targeted-portable-and-delayed-pin" : "portable-only",
        sourceUnchanged,
        startedAt,
        status: passed ? "passed" : "failed",
    };
    fs.writeFileSync(
        path.join(directory, "result.json"),
        JSON.stringify(report, null, 2) + "\n",
        { flag: "wx", mode: 0o600 }
    );
    console.log(
        `Local readiness ${report.status}: ${path.join(directory, "result.json")}`
    );
    process.exitCode = passed ? 0 : 1;
}

module.exports = { options, plan, runPlan, runStep, validateBrowserReport };
if (require.main === module)
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
