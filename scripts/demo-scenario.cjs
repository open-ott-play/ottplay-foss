const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const origin = "https://ott-demo.invalid";
const fixture = "https://liminal-sketch-vv8r.here.now";
const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
};
module.exports = {
    name: "ott-first-run-and-demo-playback",
    privateGeometry: false,
    chromium: () => require("@playwright/test").chromium,
    preflight: async (root) => {
        for (const file of ["dist/index.html", "dist/stbPlayer.js"])
            if (!fs.existsSync(path.join(root, file)))
                throw new Error("Build first: npm ci && npm run build");
    },
    route: async (route, root) => {
        const url = new URL(route.request().url());
        if (
            url.origin === fixture &&
            ["/demo/pattern.m3u8", "/demo/segment00.ts"].includes(url.pathname)
        ) {
            return route.fulfill({
                body: fs.readFileSync(
                    path.join(
                        root,
                        "tests/fixtures/media-runtime",
                        url.pathname.endsWith("m3u8")
                            ? "index.m3u8"
                            : "segment00.ts",
                    ),
                ),
                contentType: url.pathname.endsWith("m3u8")
                    ? "application/vnd.apple.mpegurl"
                    : "video/mp2t",
                headers: { "Access-Control-Allow-Origin": "*" },
            });
        }
        if (url.origin !== origin) return route.abort("blockedbyclient");
        if (url.pathname === "/local/swop.json")
            return route.fulfill({ json: {} });
        const relative =
            url.pathname === "/" || url.pathname.startsWith("/f/")
                ? "index.html"
                : url.pathname === "/dist/stbPlayer.js"
                  ? "stbPlayer.js"
                  : url.pathname.slice(1);
        const dist = path.join(root, "dist");
        const file = path.resolve(dist, relative);
        if (
            !file.startsWith(dist + path.sep) ||
            !fs.existsSync(file) ||
            !fs.statSync(file).isFile() ||
            !fs.realpathSync(file).startsWith(fs.realpathSync(dist) + path.sep)
        )
            return route.fulfill({ status: 404, body: "" });
        return route.fulfill({
            body: fs.readFileSync(file),
            contentType:
                types[path.extname(file)] || "application/octet-stream",
        });
    },
    run: async (page, checkpoint) => {
        await page.addInitScript(() =>
            localStorage.setItem("ottplaylang", "_eng"),
        );
        await page.goto(origin + "/f/pc/");
        await page
            .locator("#listCaption")
            .filter({ hasText: "First-run setup" })
            .waitFor();
        await checkpoint("first-run");
        await page.keyboard.press("Enter");
        await page.waitForFunction(
            () => window.__ottActiveProviderDriver?.id === "demo",
        );
        // Select the HLS demo channel backed by the checked-in synthetic fixture.
        await page.waitForFunction(() => window.cList?.length >= 2);
        await page.keyboard.press("Enter");
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Enter");
        await page.waitForFunction(() => {
            const video = document.querySelector("#video");
            return (
                video &&
                video.readyState >= 2 &&
                video.currentTime > 0 &&
                video.getVideoPlaybackQuality().totalVideoFrames > 0
            );
        });
        assert.equal(
            await page.evaluate(() => localStorage.getItem("ottplayprov")),
            "demo",
        );
        await checkpoint("demo-playback");
        await page.keyboard.press("Enter");
        await page.locator("#list").waitFor({ state: "visible" });
        await checkpoint("channel-list");
        await page.keyboard.press("Escape");
        await page.locator("#list").waitFor({ state: "hidden" });
        const before = await page
            .locator("#video")
            .evaluate((video) => video.currentTime);
        await page.waitForFunction((previous) => {
            const video = document.querySelector("#video");
            return (
                video && !video.paused && video.currentTime > previous + 0.05
            );
        }, before);
        await checkpoint("return-to-player");
    },
};
