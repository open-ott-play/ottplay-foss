const { defineConfig } = require("@playwright/test");

const port = Number(process.env.OTTP_DEVICE_TEST_PORT || 4179);

module.exports = defineConfig({
    expect: { timeout: 10000 },
    forbidOnly: !!process.env.CI,
    fullyParallel: true,
    outputDir: "build/device-browser-results",
    reporter: [
        ["list"],
        [
            "html",
            { open: "never", outputFolder: "build/device-browser-report" },
        ],
    ],
    retries: 0,
    testDir: "./tests/browser",
    testMatch: [
        "device-detection.spec.cjs",
        "media-runtime.spec.cjs",
        "window-controls.spec.cjs",
    ],
    timeout: 30000,
    use: {
        baseURL: "http://127.0.0.1:" + port,
        browserName: "chromium",
        headless: true,
        screenshot: "only-on-failure",
        serviceWorkers: "block",
        trace: "retain-on-failure",
        viewport: { height: 720, width: 1280 },
    },
    webServer: {
        command: "node tests/helpers/device-browser-server.cjs",
        env: { OTTP_DEVICE_TEST_PORT: String(port) },
        reuseExistingServer: false,
        timeout: 10000,
        url: "http://127.0.0.1:" + port + "/__device_test_health",
    },
    workers: process.env.CI ? 2 : undefined,
});
