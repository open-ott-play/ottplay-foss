// Real browser decoding is complementary to the isolated missing-API VM test.
// These fixtures do not emulate physical TV firmware, DRM, or device decoders.
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const root = path.resolve(__dirname, "../..");
const mediaRoot = path.join(root, "tests/fixtures/media-runtime");
const runtimeFiles = ["runtime-polyfills.js", "hls.min.js", "hls.worker.js"];
const upstreamWorker = fs.readFileSync(
    path.join(root, "js/hls.worker.js"),
    "utf8"
);

// Window's patched built-ins do not propagate to workers. A test-only prefix
// removes native APIs inside the actual worker before the shipped bytes run.
const stripWorker = `
self.Promise = undefined; self.Map = undefined; self.Set = undefined;
self.WeakMap = undefined; self.WeakSet = undefined; self.Symbol = undefined;
Array.from = undefined; Array.prototype.includes = undefined;
Object.assign = undefined; Object.entries = undefined;
Uint8Array.from = undefined; Uint8Array.prototype.slice = undefined;
self.TextEncoder = undefined; self.TextDecoder = undefined;
self.URL = undefined; self.URLSearchParams = undefined;
`;

let server;
let origin;
const requests = [];

test.beforeAll(async () => {
    server = http.createServer((request, response) => {
        const requestUrl = new URL(request.url, "http://localhost");
        const pathname = requestUrl.pathname;
        requests.push(pathname);
        if (pathname === "/") {
            response.writeHead(200, {
                "Content-Type": "text/html; charset=utf-8",
            });
            response.end(
                '<!doctype html><html><head><meta charset="utf-8">' +
                    (requestUrl.searchParams.has("legacy")
                        ? "<script>" + stripWorker + "</script>"
                        : "") +
                    '<script src="/js/runtime-polyfills.js"></script>' +
                    '<script src="/js/hls.min.js"></script></head>' +
                    "<body><video muted playsinline></video></body></html>"
            );
        } else if (pathname === "/legacy-worker.js") {
            response.writeHead(200, {
                "Content-Type": "application/javascript",
            });
            response.end(stripWorker + upstreamWorker);
        } else if (runtimeFiles.some((name) => pathname === "/js/" + name)) {
            response.writeHead(200, {
                "Content-Type": "application/javascript",
            });
            response.end(fs.readFileSync(path.join(root, pathname.slice(1))));
        } else if (
            pathname === "/media/index.m3u8" ||
            pathname === "/media/segment00.ts"
        ) {
            response.writeHead(200, {
                "Content-Type": pathname.endsWith(".m3u8")
                    ? "application/vnd.apple.mpegurl"
                    : "video/mp2t",
            });
            response.end(
                fs.readFileSync(path.join(mediaRoot, path.basename(pathname)))
            );
        } else {
            response.writeHead(404).end();
        }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = "http://127.0.0.1:" + server.address().port;
});

test.afterAll(async () => {
    await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
    );
});

for (const workerMode of ["disabled", "enabled", "legacy"]) {
    test(
        "decodes local HLS with worker " + workerMode,
        async ({ page, context }) => {
            const browserErrors = [];
            const fatalErrors = [];
            const workerErrors = [];
            const workerUrls = [];
            page.on("pageerror", (error) => browserErrors.push(error.message));
            page.on("worker", (worker) => workerUrls.push(worker.url()));
            await context.route("**/*", (route) => {
                if (new URL(route.request().url()).origin === origin)
                    return route.continue();
                return route.abort("blockedbyclient");
            });
            // Remove and restore globals during HTML bootstrap: Playwright's own
            // evaluation serializer needs Map and must not run between these steps.
            await page.goto(
                origin + (workerMode === "legacy" ? "/?legacy=1" : "/")
            );
            const supported = await page.evaluate(() => Hls.isSupported());
            expect(
                supported,
                "Browser runner must have real H.264/AAC MSE support"
            ).toBe(true);
            await page.exposeFunction("recordFatalHlsError", (error) =>
                fatalErrors.push(error)
            );
            await page.exposeFunction("recordWorkerHlsError", (error) =>
                workerErrors.push(error)
            );
            await page.evaluate(
                ({ workerMode, origin }) => {
                    // Observe messages from actual browser Worker instances.
                    // This also detects synchronous construction/setup fallbacks
                    // that do not change hls.config.enableWorker upstream.
                    var NativeWorker = window.Worker;
                    window.mediaTestWorkerMessages = [];
                    window.Worker = function (url, options) {
                        var worker = new NativeWorker(url, options);
                        worker.addEventListener("message", function (event) {
                            if (event.data && event.data.event)
                                window.mediaTestWorkerMessages.push(
                                    event.data.event
                                );
                        });
                        worker.addEventListener("error", function (event) {
                            window.recordWorkerHlsError({
                                details: "worker error",
                                reason: event.message,
                            });
                        });
                        return worker;
                    };
                    window.Worker.prototype = NativeWorker.prototype;
                    window.mediaTestHls = new Hls({
                        enableWorker: workerMode !== "disabled",
                        workerPath:
                            origin +
                            (workerMode === "legacy"
                                ? "/legacy-worker.js"
                                : "/js/hls.worker.js"),
                    });
                    var video = document.querySelector("video");
                    mediaTestHls.on(Hls.Events.ERROR, function (_, data) {
                        // HLS reports worker errors as nonfatal and can recover
                        // by switching to the main thread. Decoding alone would
                        // therefore hide a broken packaged worker or prelude.
                        if (
                            data.details ===
                                Hls.ErrorDetails.INTERNAL_EXCEPTION ||
                            /worker/i.test(data.reason || "")
                        )
                            window.recordWorkerHlsError({
                                details: data.details,
                                reason: data.reason,
                            });
                        if (data.fatal)
                            window.recordFatalHlsError({
                                details: data.details,
                                reason: data.reason,
                            });
                    });
                    mediaTestHls.attachMedia(video);
                    mediaTestHls.loadSource(origin + "/media/index.m3u8");
                    video.play().catch(function (error) {
                        window.recordFatalHlsError({
                            details: "play rejection",
                            reason: error.message,
                        });
                    });
                },
                { origin, workerMode }
            );
            await expect
                .poll(() =>
                    page.evaluate(
                        () => document.querySelector("video").currentTime
                    )
                )
                .toBeGreaterThan(0.5);
            expect(
                await page.evaluate(() => {
                    var video = document.querySelector("video");
                    return {
                        height: video.videoHeight,
                        width: video.videoWidth,
                    };
                })
            ).toEqual({ height: 360, width: 640 });
            expect(fatalErrors).toEqual([]);
            expect(workerErrors).toEqual([]);
            expect(browserErrors).toEqual([]);
            expect(
                await page.evaluate(
                    () => window.mediaTestHls.config.enableWorker
                ),
                "Worker playback must not succeed through the main-thread error fallback"
            ).toBe(workerMode !== "disabled");
            if (workerMode === "disabled") expect(workerUrls).toEqual([]);
            else {
                const workerPath =
                    workerMode === "legacy"
                        ? "/legacy-worker.js"
                        : "/js/hls.worker.js";
                expect(workerUrls).toContain(origin + workerPath);
                expect(requests).toContain(workerPath);
                expect(
                    await page.evaluate(() => window.mediaTestWorkerMessages),
                    "Real worker must initialize and return transmuxed media"
                ).toEqual(expect.arrayContaining(["init", "transmuxComplete"]));
            }
            await page.evaluate(() => window.mediaTestHls.destroy());
        }
    );
}
