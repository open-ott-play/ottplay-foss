const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL, fileURLToPath } = require("node:url");
// Exercise a verified release WGT without changing its contents or browser security.
// Tizen API signals are stubbed; this is not Samsung firmware or decoder emulation.
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { parseArgs } = require("node:util");
const { chromium } = require("@playwright/test");
const { values } = parseArgs({
    options: { output: { type: "string" }, "package-dir": { type: "string" } },
});
assert.ok(
    values["package-dir"] && values.output,
    "Usage: node scripts/tizen-browser-acceptance.cjs --package-dir build/packages --output build/tizen-browser"
);
const packageDir = path.resolve(values["package-dir"]);
const output = path.resolve(values.output);
fs.mkdirSync(output, { recursive: true });
const reportPath = path.join(output, "acceptance.json");
const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "ottplay-tizen-browser-")
);
const root = path.join(temporary, "app");
const pagePath = path.join(root, "index.html");
const report = {
    blockedExternal: [],
    consoleErrors: [],
    failures: [],
    localRequests: [],
    pageErrors: [],
    scope: "Isolated Chromium file-origin package acceptance with Tizen API stubs; not TV firmware, signing, installation or decoder validation.",
};
const scrub = (raw) => {
    try {
        const u = new URL(raw);
        return u.protocol === "file:"
            ? u.pathname.replace(root, "<package>")
            : u.origin + u.pathname;
    } catch {
        return String(raw);
    }
};
const extract = `
import json, runpy, sys
from pathlib import Path, PurePosixPath
# Execute only the trusted repository verifier, never code from the input package.
tool = runpy.run_path(sys.argv[1])
package = Path(sys.argv[2])
meta, files = tool['verify_unsigned'](package / tool['UNSIGNED_NAME'], package / tool['METADATA_NAME'], package / tool['CHECKSUM_NAME'])
destination = Path(sys.argv[3])
destination.mkdir(mode=0o700)
for name, payload in files.items():
    target = destination.joinpath(*PurePosixPath(name).parts)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open('xb') as handle:
        handle.write(payload)
print(json.dumps({key: meta[key] for key in ('source', 'packageVersion', 'tizenVersion', 'sha256', 'bytes')}))
`;
(async () => {
    let browser;
    try {
        const checked = spawnSync(
            "python3",
            [
                "-I",
                "-B",
                "-c",
                extract,
                path.join(__dirname, "tizen-install.py"),
                packageDir,
                root,
            ],
            { encoding: "utf8", maxBuffer: 2 * 1024 * 1024, timeout: 120000 }
        );
        assert.ifError(checked.error);
        assert.equal(
            checked.status,
            0,
            "WGT verification/extraction failed: " + checked.stderr
        );
        report.package = JSON.parse(checked.stdout);
        browser = await chromium.launch({ headless: true });
        report.browser = browser.version();
        const context = await browser.newContext({
            serviceWorkers: "block",
            userAgent:
                "Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/4.0 Chrome/85.0.4183.93 TV Safari/537.36",
            viewport: { height: 720, width: 1280 },
        });
        await context.route("**/*", (route) => {
            const url = new URL(route.request().url());
            if (
                url.protocol === "file:" ||
                url.protocol === "data:" ||
                url.protocol === "blob:"
            )
                return route.continue();
            report.blockedExternal.push(scrub(url.href));
            return route.abort("blockedbyclient");
        });
        await context.routeWebSocket("**/*", (socket) => {
            report.blockedExternal.push(scrub(socket.url()));
            socket.close();
        });
        await context.addInitScript(() => {
            localStorage.setItem("ottplaylang", "_eng");
            window.__tizenAcceptance = { nativeCalls: [], registered: [] };
            window.tizen = {
                application: {
                    getCurrentApplication() {
                        window.__tizenAcceptance.nativeCalls.push(
                            "getCurrentApplication"
                        );
                        return {
                            exit() {
                                window.__tizenAcceptance.nativeCalls.push(
                                    "exit"
                                );
                            },
                        };
                    },
                },
                tvinputdevice: {
                    registerKey(key) {
                        window.__tizenAcceptance.registered.push(key);
                    },
                },
            };
        });
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        page.on("pageerror", (error) => report.pageErrors.push(error.message));
        page.on("console", (item) => {
            if (item.type() === "error") report.consoleErrors.push(item.text());
        });
        page.on("request", (request) => {
            const url = new URL(request.url());
            if (url.protocol === "file:") {
                const file = fileURLToPath(url);
                report.localRequests.push({
                    exists: fs.existsSync(file),
                    insidePackage:
                        file === root || file.startsWith(root + path.sep),
                    path: scrub(url.href),
                    type: request.resourceType(),
                });
            }
        });
        page.on("requestfailed", (request) =>
            report.failures.push({
                error: request.failure()?.errorText,
                path: scrub(request.url()),
            })
        );
        await page.goto(pathToFileURL(pagePath).href, {
            timeout: 30000,
            waitUntil: "load",
        });
        await page.waitForFunction(
            () =>
                document.getElementById("listCaption")?.textContent ===
                "First-run setup",
            null,
            { timeout: 15000 }
        );
        report.boot = await page.evaluate(() => ({
            back: window.keys.RETURN,
            device: window.ott_device,
            down: window.keys.DOWN,
            enter: window.keys.ENTER,
            host: window.host,
            hostUrl: window.hostUrl,
            localeHost: window.__host,
            marker: window.__OTTPLAY_TIZEN_PACKAGE__,
            nativeCalls: window.__tizenAcceptance.nativeCalls,
            packageBase: window.__ottPkgBase,
            polyfills: window.__ottRuntimePolyfillsReady,
            registered: window.__tizenAcceptance.registered,
            scripts: Array.from(document.scripts)
                .filter((s) => s.src)
                .map((s) => ({
                    cors: s.getAttribute("crossorigin"),
                    src: s.src,
                })),
        }));
        assert.equal(report.boot.device, "samsung/tizen");
        assert.equal(report.boot.back, 10009);
        assert.equal(report.boot.packageBase, pathToFileURL(root).href);
        assert.equal(report.boot.host, report.boot.packageBase);
        assert.equal(report.boot.hostUrl, report.boot.packageBase);
        assert.equal(report.boot.localeHost, report.boot.packageBase);
        assert.equal(report.boot.polyfills, true);
        assert.ok(report.boot.registered.includes("MediaPlayPause"));
        assert.ok(
            report.boot.nativeCalls.every(
                (name) => name === "getCurrentApplication"
            )
        );
        assert.ok(
            report.boot.scripts.every(
                (s) => new URL(s.src).protocol !== "file:" || s.cors === null
            )
        );
        const before = await page.locator("#listDetail").innerText();
        await page.keyboard.press("ArrowDown");
        await page.waitForFunction(
            (old) => document.getElementById("listDetail").innerText !== old,
            before
        );
        report.navigation = { arrowDownChangedSelection: true };
        const cdp = await context.newCDPSession(page);
        await cdp.send("Input.dispatchKeyEvent", {
            key: "BrowserBack",
            nativeVirtualKeyCode: 10009,
            type: "rawKeyDown",
            windowsVirtualKeyCode: 10009,
        });
        await cdp.send("Input.dispatchKeyEvent", {
            key: "BrowserBack",
            nativeVirtualKeyCode: 10009,
            type: "keyUp",
            windowsVirtualKeyCode: 10009,
        });
        await cdp.detach();
        await page.waitForFunction(
            () =>
                document.getElementById("listCaption")?.textContent ===
                "Choose language"
        );
        report.navigation.tizenBackOpenedLanguages = true;
        await page.keyboard.press("Enter");
        await page.waitForFunction(
            () =>
                document.getElementById("listCaption")?.textContent ===
                "First-run setup"
        );
        report.engines = await page.evaluate(async () => {
            const load = (engine) =>
                new Promise((resolve) =>
                    window.__ottLoadMediaEngine(engine, resolve)
                );
            return {
                hls: await load("hls"),
                hlsVersion: window.Hls?.version,
                shaka: await load("shaka"),
                shakaTracks: typeof window.__ottShakaTracks,
                shakaVersion: window.shaka?.Player?.version,
                worker: window.Hls?.DefaultConfig.workerPath,
            };
        });
        assert.equal(report.engines.hls, true);
        assert.equal(report.engines.shaka, true);
        assert.equal(report.engines.shakaTracks, "function");
        assert.ok(
            report.engines.worker.startsWith(
                report.boot.packageBase + "/js/hls.worker.js?"
            )
        );
        report.providers = await page.evaluate(async () => {
            const owner = { active: () => true, own: () => () => {} };
            const result = [];
            for (const kind of Object.keys(window.__ottProviderAssets.groups)) {
                await new Promise((resolve, reject) => {
                    const timer = setTimeout(
                        () =>
                            reject(
                                new Error("Provider module timed out: " + kind)
                            ),
                        15000
                    );
                    window.__ottProviderAssets.classic.ensure(
                        kind,
                        window.hostUrl,
                        window.version,
                        owner,
                        () => {
                            clearTimeout(timer);
                            resolve();
                        },
                        (error) => {
                            clearTimeout(timer);
                            reject(error);
                        }
                    );
                });
                result.push(kind);
            }
            return result;
        });
        report.subtitles = await page.evaluate(
            () =>
                new Promise((resolve) =>
                    window.__ottAppearanceHost.ready(resolve)
                )
        );
        assert.equal(report.subtitles, true);
        report.fonts = await page.evaluate(async () => {
            await Promise.all(
                Array.from(document.fonts).map((font) => font.load())
            );
            await document.fonts.ready;
            return Array.from(document.fonts).map((font) => ({
                family: font.family,
                status: font.status,
            }));
        });
        assert.ok(report.fonts.every((font) => font.status === "loaded"));
        await page.screenshot({ path: reportPath.replace(/\.json$/, ".png") });
        assert.ok(
            report.localRequests.every(
                (item) => item.insidePackage && item.exists
            )
        );
        assert.deepEqual(report.pageErrors, []);
        assert.deepEqual(report.blockedExternal, []);
        assert.deepEqual(
            report.failures.filter(
                (item) =>
                    item.path.startsWith("<package>") ||
                    item.path.startsWith("/")
            ),
            []
        );
        report.passed = true;
    } catch (error) {
        report.passed = false;
        report.error = error.stack;
        process.exitCode = 1;
    } finally {
        try {
            if (browser) await browser.close();
        } finally {
            fs.rmSync(temporary, { force: true, recursive: true });
        }
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
        console.log(
            JSON.stringify(
                {
                    blockedExternal: report.blockedExternal.length,
                    error: report.error,
                    failures: report.failures,
                    localRequests: report.localRequests.length,
                    pageErrors: report.pageErrors,
                    passed: report.passed,
                    report: reportPath,
                },
                null,
                2
            )
        );
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
