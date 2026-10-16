// Run the existing provider UI/decoder assertions with the selected browser generation.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const output = path.resolve(process.env.CI_BROWSER_DIAGNOSTICS);
const runtime = JSON.parse(fs.readFileSync(path.join(output, "runtime.json")));
const candidate = JSON.parse(
    fs.readFileSync(path.join(output, "candidate.json"))
);
assert.equal(candidate.sourceSha, runtime.sourceSha);
const result = spawnSync(
    process.execPath,
    [
        path.join(process.env.CI_PLAYWRIGHT_MODULE, "cli.js"),
        "test",
        "--config=playwright.compatibility.config.cjs",
    ],
    {
        env: {
            ...process.env,
            CI: "1",
            CI_BROWSER_WEB_ROOT: path.resolve("browser-candidate-web"),
        },
        stdio: "inherit",
        timeout: 8 * 60 * 1000,
    }
);
assert.ifError(result.error);
assert.equal(result.status, 0, "Real provider/browser assertions failed");
const report = JSON.parse(
    fs.readFileSync(path.join(output, "playwright.json"))
);
assert.deepEqual(report.errors, []);
const scenarios = [];
function collect(suites) {
    for (const suite of suites) {
        for (const spec of suite.specs || []) {
            assert.equal(spec.ok, true, spec.title);
            assert.equal(spec.tests.length, 1);
            const test = spec.tests[0];
            assert.equal(test.status, "expected", spec.title);
            assert.equal(
                test.results.length,
                1,
                "No retries may hide failures"
            );
            assert.equal(test.results[0].status, "passed", spec.title);
            scenarios.push(spec.title);
        }
        collect(suite.suites || []);
    }
}
collect(report.suites);
assert.equal(
    scenarios.length,
    5,
    "Both localized loader flows and three real decoder/resume flows must run"
);
assert.equal(new Set(scenarios).size, scenarios.length);
fs.writeFileSync(
    process.env.CI_BROWSER_EVIDENCE,
    JSON.stringify(
        {
            ...runtime,
            candidate,
            scenarios,
            testsFailed: 0,
            testsPassed: scenarios.length,
        },
        null,
        2
    ) + "\n"
);
