const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const {
    options,
    plan,
    runPlan,
    runStep,
    validateBrowserReport,
} = require("../scripts/check-windows-readiness.cjs");
const root = path.resolve(__dirname, "..");

test("default plan includes real CRLF, stdlib preflight and delayed-PIN checks without retries", () => {
    const steps = plan(root, "python3");
    assert(
        steps.some((step) =>
            step.args.includes("tests/test_offline_profiles.cjs")
        )
    );
    assert.deepEqual(
        steps.find((step) => step.name === "macos-preflight-stdlib").args,
        ["-S", "tests/test_ci_macos_desktop_preflight.py"]
    );
    const browser = steps.at(-2);
    assert.equal(browser.name, "delayed-pin-chromium");
    assert.equal(browser.env.OTTP_TEST_PIN_CRYPTO_DELAY_MS, "250");
    for (const arg of ["--workers=1", "--retries=0", "--project=chromium"])
        assert(browser.args.includes(arg));
    assert.equal(steps.at(-3).name, "frontend-build");
    assert.deepEqual(steps.at(-1).args, [
        "tests/test_browser_direct_media.cjs",
    ]);
    assert(steps.some((step) => step.name === "test_browser_candidate"));
    assert(steps.some((step) => step.name === "test_release_scope"));
    assert(
        steps.every(
            (step) =>
                step.command === process.execPath || step.command === "python3"
        )
    );
    assert.equal(options([]).browser, true);
    assert.equal(options(["--skip-browser"]).browser, false);
    assert(
        !plan(root, "python3", false).some(
            (step) =>
                step.name === browser.name ||
                step.name === "browser-direct-media"
        )
    );
    assert.throws(() => options(["--skip-build"]));
});

test("a failed prerequisite stops the plan without executing later checks", async () => {
    const seen = [];
    const results = await runPlan(
        [
            { name: "first", seconds: 1 },
            { name: "second", seconds: 1 },
        ],
        "unused",
        {},
        async (step) => {
            seen.push(step.name);
            return { code: 7, name: step.name, status: "failed" };
        }
    );
    assert.deepEqual(seen, ["first"]);
    assert.equal(results[0].code, 7);
});

test("actual child failure and timeout cannot produce a passing result", async () => {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "ott-readiness-test-")
    );
    try {
        const common = { command: process.execPath, env: {}, seconds: 5 };
        const failed = await runStep(
            { ...common, args: ["-e", "process.exit(7)"], name: "failure" },
            directory,
            {},
            root
        );
        assert.equal(failed.status, "failed");
        assert.equal(failed.code, 7);
        const timeout = await runStep(
            {
                ...common,
                args: ["-e", "setInterval(() => {}, 1000)"],
                name: "timeout",
                seconds: 0.1,
            },
            directory,
            {},
            root
        );
        assert.equal(timeout.status, "timeout");
        assert(timeout.elapsed < 5);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("targeted Python plan has explicit modules, no native integration discovery", () => {
    const steps = plan(root, "python3", false);
    const modules = steps.filter((step) =>
        step.args[2]?.startsWith(".github/")
    );
    assert.equal(modules.length, 6);
    for (const step of modules) {
        assert.notEqual(step.args.at(-1), "test_*.py");
    }
    assert(steps.some((step) => step.name === "test_macos_cross_build"));
    assert(
        !steps.some((step) =>
            /cargo|signing|container_workspace/.test(step.name)
        )
    );
});

test("both lint invocations match the actual CI npm lint entry", () => {
    const scripts = JSON.parse(
        fs.readFileSync(path.join(root, "package.json"))
    ).scripts;
    const expected = scripts.lint.replace(
        "npm run lint:correctness",
        scripts["lint:correctness"]
    );
    const steps = plan(root, "python3", false).filter(
        (step) => step.name === "lint" || step.name === "lint-correctness"
    );
    assert.equal(steps.length, 2);
    assert(
        steps.every(
            (step) =>
                step.command === process.execPath &&
                step.args[0] === "node_modules/@biomejs/biome/bin/biome"
        )
    );
    assert.equal(
        steps
            .map((step) => "biome " + step.args.slice(1).join(" "))
            .join(" && "),
        expected
    );
});

test("actual Python loader rejects an empty suite and preserves passing/failing verdicts", () => {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "ott-empty-python-")
    );
    const step = plan(root, process.env.PYTHON || "python3", false).find(
        (item) => item.name === "test_browser_candidate"
    );
    const args = [...step.args];
    args[2] = directory;
    args[3] = "test_sample.py";
    const run = () =>
        spawnSync(step.command, args, {
            encoding: "utf8",
            env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
            timeout: 10000,
        });
    try {
        const empty = run();
        assert.equal(empty.error, undefined);
        assert.notEqual(empty.status, 0);
        assert.match(empty.stderr, /No tests discovered/);
        const file = path.join(directory, "test_sample.py");
        fs.writeFileSync(
            file,
            "import unittest\nclass Sample(unittest.TestCase):\n    def test_present(self):\n        self.assertTrue(True)\n"
        );
        assert.equal(run().status, 0);
        fs.writeFileSync(
            file,
            "import unittest\nclass Sample(unittest.TestCase):\n    def test_present(self):\n        self.assertTrue(False)\n"
        );
        const failed = run();
        assert.equal(failed.error, undefined);
        assert.notEqual(failed.status, 0);
        assert.match(failed.stderr, /FAILED \(failures=1\)/);
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

test("browser evidence must contain all three real passing profiles without retry", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ott-pin-report-"));
    const file = path.join(directory, "browser.json");
    const report = {
        errors: [],
        stats: { expected: 3, flaky: 0, skipped: 0, unexpected: 0 },
        suites: [
            {
                specs: ["server", "tauri", "capacitor"].map((profile) => ({
                    ok: true,
                    title:
                        profile +
                        " remote channel selection closes the list after admission",
                    tests: [
                        {
                            projectName: "chromium",
                            results: [{ retry: 0, status: "passed" }],
                        },
                    ],
                })),
            },
        ],
    };
    const write = () => fs.writeFileSync(file, JSON.stringify(report));
    try {
        write();
        assert.equal(validateBrowserReport(file).passed, 3);
        report.suites[0].specs[0].tests[0].results[0].retry = 1;
        write();
        assert.throws(() => validateBrowserReport(file));
        report.suites[0].specs[0].tests[0].results[0].retry = 0;
        report.suites[0].specs.pop();
        write();
        assert.throws(() => validateBrowserReport(file));
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});
