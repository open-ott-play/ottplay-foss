// Keep the test runner and fixtures in the same pinned Playwright generation.
const path = require("node:path");
const playwright = require(
    process.env.CI_PLAYWRIGHT_MODULE
        ? path.join(process.env.CI_PLAYWRIGHT_MODULE, "test.js")
        : "@playwright/test"
);
const crashDiagnostics = require("../../scripts/firefox-crash-diagnostics.cjs");
const test = playwright.test.extend({
    compatibilityRuntime: [
        async ({ browser, browserName }, use) => {
            if (process.env.CI_PLAYWRIGHT_MODULE) {
                const assert = require("node:assert/strict");
                const runtime = JSON.parse(
                    require("node:fs").readFileSync(
                        path.join(
                            process.env.CI_BROWSER_DIAGNOSTICS,
                            "runtime.json"
                        )
                    )
                );
                assert.equal(browserName, runtime.engine);
                assert.equal(browser.version(), runtime.browserVersion);
                assert.equal(
                    require(
                        path.join(
                            process.env.CI_PLAYWRIGHT_MODULE,
                            "package.json"
                        )
                    ).version,
                    runtime.playwrightVersion
                );
            }
            try {
                await use();
            } finally {
                if (
                    browserName === "firefox" &&
                    process.env.CI_FIREFOX_CRASH_DIAGNOSTICS === "1"
                ) {
                    try {
                        crashDiagnostics.retain(crashDiagnostics.session());
                    } catch (_) {
                        console.error("Firefox crash retention unavailable");
                    }
                }
            }
        },
        { auto: true },
    ],
});
module.exports = { ...playwright, test };
