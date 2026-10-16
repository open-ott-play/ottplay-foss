// Run the existing provider UI/decoder assertions with the selected browser generation.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
    selectProfile,
    verifyCapabilities,
} = require("./browser-compatibility-profile.cjs");
const output = path.resolve(process.env.CI_BROWSER_DIAGNOSTICS);
const runtime = JSON.parse(fs.readFileSync(path.join(output, "runtime.json")));
const candidate = JSON.parse(
    fs.readFileSync(path.join(output, "candidate.json"))
);
assert.equal(candidate.sourceSha, runtime.sourceSha);
const profile = selectProfile(runtime);
async function main() {
    const playwright = require(process.env.CI_PLAYWRIGHT_MODULE);
    const browser = await playwright[runtime.engine].launch({
        channel: runtime.channel || undefined,
        headless: true,
    });
    let capabilities;
    try {
        assert.equal(
            browser.version(),
            runtime.browserVersion,
            "Browser runtime changed"
        );
        const page = await browser.newPage();
        capabilities = await page.evaluate(() => {
            // Match the installed hls.js getMediaSource() capability preference.
            const mse =
                window.ManagedMediaSource ||
                window.MediaSource ||
                window.WebKitMediaSource;
            return {
                aacMse: !!mse?.isTypeSupported('audio/mp4; codecs="mp4a.40.2"'),
                h264Mse: !!mse?.isTypeSupported(
                    'video/mp4; codecs="avc1.42c01e"'
                ),
                managedMediaSource:
                    typeof window.ManagedMediaSource === "function",
                mediaSource: typeof window.MediaSource === "function",
                nativeHls: document
                    .createElement("video")
                    .canPlayType("application/vnd.apple.mpegurl"),
                webkitMediaSource:
                    typeof window.WebKitMediaSource === "function",
            };
        });
    } finally {
        await browser.close();
    }
    fs.writeFileSync(
        path.join(output, "capabilities.json"),
        JSON.stringify(
            {
                ...runtime,
                capabilities,
                profile,
            },
            null,
            2
        ) + "\n"
    );
    verifyCapabilities(profile, capabilities);
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
    assert.equal(new Set(scenarios).size, scenarios.length);
    assert.deepEqual(
        [...scenarios].sort(),
        [...profile.scenarios].sort(),
        "Every declared profile scenario must pass exactly once"
    );
    fs.writeFileSync(
        process.env.CI_BROWSER_EVIDENCE,
        JSON.stringify(
            {
                ...runtime,
                candidate,
                capabilities,
                coverage: {
                    ...profile,
                    media:
                        profile.media === "required" ? "passed" : profile.media,
                },
                scenarios,
                testsFailed: 0,
                testsPassed: scenarios.length,
            },
            null,
            2
        ) + "\n"
    );
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
