const path = require("node:path");
const { defineConfig } = require("./tests/helpers/browser-test.cjs");
const base = require("./playwright.config.cjs");
const output = process.env.CI_BROWSER_DIAGNOSTICS;
module.exports = defineConfig({
    ...base,
    grep: /Plex shows a localized animated loader|Plex aspect persists.*(?:hls\.js|video\.js)$/,
    outputDir: path.join(output, "test-results"),
    projects: [
        {
            name: process.env.CI_BROWSER_TARGET_ID,
            use: {
                browserName: process.env.CI_BROWSER_ENGINE,
                channel: process.env.CI_BROWSER_CHANNEL || undefined,
            },
        },
    ],
    reporter: [
        ["list"],
        ["json", { outputFile: path.join(output, "playwright.json") }],
    ],
    retries: 0,
    testMatch: ["plex-provider.spec.cjs"],
    workers: 1,
});
