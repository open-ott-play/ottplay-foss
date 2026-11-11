// Native Windows pixels are the verdict; CDP only drives the production player.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const net = require("node:net");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("playwright");
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "build/windows-video-geometry-report");
const hash = (file) =>
    crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sizes = [
    [800, 450],
    [799, 450],
    [801, 450],
    [800, 449],
    [800, 451],
    [1280, 720],
    [1279, 720],
    [1281, 720],
    [1280, 719],
    [1280, 721],
];
function cases() {
    return sizes.flatMap(([width, height]) =>
        (width * 9 === height * 16 ? [false, true] : [false]).map((lock) => ({
            height,
            lock,
            width,
        }))
    );
}
function python(args, allowPixelFailure = false) {
    const result = spawnSync(process.env.PYTHON || "python", args, {
        cwd: ROOT,
        encoding: "utf8",
        timeout: 20000,
        windowsHide: true,
    });
    if (result.error || (result.status !== 0 && !allowPixelFailure))
        throw new Error(
            "Native evidence helper failed: " +
                (result.stderr || result.stdout || result.error)
        );
    return JSON.parse(result.stdout);
}
async function freePort() {
    const server = net.createServer();
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    return port;
}
async function nativeFrontendPort() {
    // Use the production capability allowlist; do not grant test-only IPC origins.
    for (const port of [8443, 8444, 8445, 8446]) {
        const server = net.createServer();
        try {
            await new Promise((resolve, reject) => {
                server.once("error", reject);
                server.listen(
                    { exclusive: true, host: "127.0.0.1", port },
                    resolve
                );
            });
            await new Promise((resolve) => server.close(resolve));
            return port;
        } catch (_) {
            server.close();
        }
    }
    throw new Error(
        "No owned port from the production Tauri IPC allowlist is available"
    );
}
async function waitJson(url, process) {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
        if (process.exitCode !== null)
            throw new Error("Owned process exited before ready");
        try {
            const response = await fetch(url, {
                signal: AbortSignal.timeout(1500),
            });
            if (response.ok) return await response.json();
        } catch (_) {
            /* bounded readiness only, never a test retry */
        }
        await sleep(100);
    }
    throw new Error("Owned loopback endpoint did not start within 60 seconds");
}
async function stopOwned(child) {
    if (!child || child.exitCode !== null) return;
    // /T terminates only the process tree rooted at our just-spawned PID.
    const done = new Promise((resolve) => child.once("exit", resolve));
    const result = spawnSync(
        "taskkill",
        ["/PID", String(child.pid), "/T", "/F"],
        {
            encoding: "utf8",
            timeout: 10000,
            windowsHide: true,
        }
    );
    if (result.status !== 0 && child.exitCode === null)
        throw new Error(
            "Could not clean up owned fixture process " + child.pid
        );
    await Promise.race([done, sleep(5000)]);
    if (child.exitCode === null)
        throw new Error("Owned fixture remains running");
}
function verifyDebugListener(pid, port) {
    const command = `
$ErrorActionPreference='Stop'
$rows=@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:OTT_FIXTURE_PORT))
if ($rows.Count -eq 0) { throw 'No debug listener' }
$result=@()
foreach ($row in $rows) {
  if ($row.LocalAddress -notin @('127.0.0.1','::1')) { throw 'Debug listener exposed beyond loopback' }
  $current=[int]$row.OwningProcess; $chain=@(); $owned=$false
  for ($i=0; $i -lt 16; $i++) {
    $chain += $current
    if ($current -eq [int]$env:OTT_FIXTURE_PID) { $owned=$true; break }
    $p=Get-CimInstance Win32_Process -Filter "ProcessId=$current"
    if (!$p -or $p.ParentProcessId -eq $current) { break }
    $current=[int]$p.ParentProcessId
  }
  if (!$owned) { throw 'Debug listener is not in the owned process tree' }
  $result += @{address=$row.LocalAddress;pid=$row.OwningProcess;parents=$chain}
}
ConvertTo-Json -InputObject @($result) -Depth 4 -Compress
`;
    const result = spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", command],
        {
            encoding: "utf8",
            env: {
                ...process.env,
                OTT_FIXTURE_PID: String(pid),
                OTT_FIXTURE_PORT: String(port),
            },
            timeout: 20000,
            windowsHide: true,
        }
    );
    if (result.error || result.status !== 0)
        throw new Error("Unqualified CDP listener: " + result.stderr);
    return JSON.parse(result.stdout);
}
async function exercise(binary, origin, item, index, report) {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), "ott-video-geometry-"));
    const id = crypto.createHash("md5").update(data).digest("hex").slice(0, 10);
    const config = path.join(process.env.APPDATA, "com.ottplay.foss");
    fs.mkdirSync(config, { recursive: true });
    const state = path.join(config, ".window-state.dir" + id + ".json");
    const stem =
        String(index).padStart(2, "0") +
        "-" +
        item.width +
        "x" +
        item.height +
        "-" +
        item.lock;
    // Exercise the normal saved-window startup path, not a post-play resize.
    fs.writeFileSync(
        state,
        JSON.stringify({
            main: {
                decorated: false,
                fullscreen: false,
                height: item.height,
                maximized: false,
                prev_x: 16,
                prev_y: 16,
                visible: true,
                width: item.width,
                x: 16,
                y: 16,
            },
        }),
        { flag: "wx" }
    );
    fs.writeFileSync(
        path.join(data, "window-aspect-lock"),
        item.lock ? "1\n" : "0\n"
    );
    const debugPort = await freePort();
    const log = fs.openSync(path.join(OUT, stem + ".log"), "wx");
    let child, browser;
    const record = { ...item, samples: [], status: "fail" };
    report.cases.push(record);
    try {
        child = spawn(binary, [], {
            cwd: ROOT,
            env: {
                ...process.env,
                OTTPLAY_DATA_DIR: data,
                OTTPLAY_INSTANCE: "video-geometry-" + id,
                OTTPLAY_WEB_URL: origin + "/index.html?nativecase=" + id,
                WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
                    "--remote-debugging-address=127.0.0.1 --remote-debugging-port=" +
                    debugPort,
            },
            stdio: ["ignore", log, log],
        });
        child.on("error", (error) => {
            record.spawnError = error.message;
        });
        record.pid = child.pid;
        if (!child.pid)
            throw new Error("Could not spawn owned release executable");
        const version = await waitJson(
            "http://127.0.0.1:" + debugPort + "/json/version",
            child
        );
        record.debugListener = verifyDebugListener(child.pid, debugPort);
        record.webview = {
            browser: version.Browser,
            protocol: version["Protocol-Version"],
        };
        browser = await chromium.connectOverCDP(
            "http://127.0.0.1:" + debugPort
        );
        try {
            const session = await browser.newBrowserCDPSession();
            const info = await session.send("SystemInfo.getInfo");
            record.gpu = {
                devices: info.gpu.devices,
                renderer: info.gpu.auxAttributes?.glRenderer,
            };
            await session.detach();
        } catch (_) {
            record.gpu = {
                status: "unavailable; no physical-GPU coverage claimed",
            };
        }
        const context = browser.contexts()[0];
        if (context) context.setDefaultTimeout(30000);
        if (!context) throw new Error("Missing owned WebView2 context");
        await context.route("**/*", (route) =>
            new URL(route.request().url()).origin === origin
                ? route.continue()
                : route.abort()
        );
        await context.routeWebSocket("**/*", (socket) => socket.close());
        const page = context.pages()[0];
        if (!page) throw new Error("No owned WebView2 page");
        await page.waitForURL(origin + "/index.html?nativecase=" + id, {
            timeout: 30000,
            waitUntil: "domcontentloaded",
        });
        await page.waitForFunction(
            () => window.__ottDevice && typeof window.stbPlay === "function"
        );
        record.runtime = await page.evaluate(() => ({
            device: window.__ottDevice,
            dpr: devicePixelRatio,
            userAgent: navigator.userAgent,
        }));
        for (const mode of ["fit", "fill"]) {
            for (const [label, source, width, height] of [
                [mode === "fit" ? "cold" : "mode-change", "wide", 640, 360],
                ["replay", "wide", 640, 360],
                ["channel-change", "standard", 480, 360],
            ]) {
                const first = mode === "fit" && label === "cold";
                if (first) {
                    await page.waitForFunction(
                        (expected) =>
                            document.querySelector("#video")?.src === expected,
                        origin + "/__native_video_geometry/wide.mp4?case=" + id,
                        { timeout: 30000 }
                    );
                    record.beforeAdmission = await page.evaluate(() => {
                        const events = window.__nativeGeometryEvents;
                        if (
                            !Array.isArray(events) ||
                            events.some(
                                (e) =>
                                    e.kind === "loadeddata" ||
                                    e.kind === "playing"
                            )
                        )
                            throw new Error(
                                "A frame was decoded before cold capture admission"
                            );
                        window.closeList(false);
                        document.querySelector("#video").muted = true;
                        return events;
                    });
                    const admitted = await fetch(
                        origin + "/__native_video_geometry/admit?case=" + id
                    );
                    if (!admitted.ok)
                        throw new Error(
                            "Could not admit the first owned media source"
                        );
                } else
                    await page.evaluate(
                        ({ url, mode }) => {
                            window.stbStop();
                            window.setPlayerMode(0);
                            window.setAspect(mode === "fill" ? 1 : 0);
                            window.closeList(false);
                            const media = document.querySelector("#video");
                            media.muted = true;
                            window.stbPlay(url);
                        },
                        {
                            mode,
                            url:
                                origin +
                                "/__native_video_geometry/" +
                                source +
                                ".mp4?case=" +
                                id,
                        }
                    );
                let previous;
                for (const phase of [0, 1]) {
                    await page.waitForFunction(
                        ({ phase, width, height }) => {
                            const v = document.querySelector("#video");
                            return (
                                v &&
                                !v.paused &&
                                v.videoWidth === width &&
                                v.videoHeight === height &&
                                Math.floor(v.currentTime / 1.5) % 2 === phase &&
                                v.currentTime % 1.5 > 0.4 &&
                                v.currentTime % 1.5 < 1.1 &&
                                v.getVideoPlaybackQuality().totalVideoFrames > 0
                            );
                        },
                        { height, phase, width },
                        { timeout: 12000 }
                    );
                    const before = await page.evaluate(() => {
                        const v = document.querySelector("#video");
                        const r = v.getBoundingClientRect();
                        return {
                            frames: v.getVideoPlaybackQuality()
                                .totalVideoFrames,
                            height: innerHeight,
                            rect: {
                                height: r.height,
                                width: r.width,
                                x: r.x,
                                y: r.y,
                            },
                            time: v.currentTime,
                            width: innerWidth,
                        };
                    });
                    const image = path.join(
                        OUT,
                        stem + "-" + mode + "-" + label + "-" + phase + ".bmp"
                    );
                    const capture = python([
                        "scripts/windows-video-capture.py",
                        "--pid",
                        String(child.pid),
                        "--output",
                        image,
                    ]);
                    const after = await page.evaluate(
                        () => document.querySelector("#video").currentTime
                    );
                    if (
                        Math.floor(before.time / 1.5) % 2 !== phase ||
                        Math.floor(after / 1.5) % 2 !== phase
                    )
                        throw new Error(
                            "Capture crossed fixture phase boundary; no automatic retry"
                        );
                    if (
                        capture.window.client_size[0] !== item.width ||
                        capture.window.client_size[1] !== item.height
                    )
                        throw new Error(
                            "Native client differs from requested saved geometry"
                        );
                    if (
                        previous &&
                        (before.time <= previous.time ||
                            before.frames <= previous.frames)
                    )
                        throw new Error(
                            "Decoded video did not advance between native captures"
                        );
                    const verdict = python(
                        [
                            "scripts/windows-video-oracle.py",
                            "--bmp",
                            image,
                            "--phase",
                            String(phase),
                            "--mode",
                            mode,
                            "--video-width",
                            String(width),
                            "--video-height",
                            String(height),
                            "--client-width",
                            String(item.width),
                            "--client-height",
                            String(item.height),
                        ],
                        true
                    );
                    record.samples.push({
                        after,
                        before,
                        capture,
                        label,
                        mode,
                        phase,
                        source,
                        verdict,
                    });
                    if (verdict.status !== "pass")
                        throw new Error("Native pixel geometry rejected");
                    previous = before;
                }
            }
        }
        record.status = "pass";
    } catch (error) {
        record.error = error.stack || String(error);
        throw error;
    } finally {
        // CDP disconnect, then owned process-tree cleanup; no installed players.
        if (browser)
            await Promise.race([browser.close().catch(() => {}), sleep(5000)]);
        try {
            await stopOwned(child);
        } catch (error) {
            record.cleanupError = String(error);
            record.status = "fail";
            throw error;
        } finally {
            fs.closeSync(log);
            if (!child || child.exitCode !== null) {
                fs.rmSync(state, { force: true });
                fs.rmSync(data, { force: true, recursive: true });
            }
        }
    }
}
async function main() {
    if (process.platform !== "win32")
        throw new Error("Native Windows runner required; no portable pass");
    const binary = path.resolve(
        process.argv[2] || "target/release/ottplay-tauri.exe"
    );
    if (!fs.existsSync(binary))
        throw new Error("Build the production release executable first");
    if (
        !fs
            .realpathSync(binary)
            .startsWith(fs.realpathSync(path.join(ROOT, "target")) + path.sep)
    )
        throw new Error(
            "Refusing to launch an installed player outside the owned build tree"
        );
    if (!process.env.APPDATA)
        throw new Error("Windows app config directory unavailable");
    fs.mkdirSync(OUT, { recursive: true });
    if (fs.existsSync(path.join(OUT, "result.json")))
        throw new Error("Fresh evidence directory required");
    const report = {
        cases: [],
        executable: { path: binary, sha256: hash(binary) },
        fixtureHashes: Object.fromEntries(
            ["wide", "standard"].map((name) => [
                name,
                hash(
                    path.join(
                        ROOT,
                        "tests/fixtures/windows-video-geometry/" + name + ".mp4"
                    )
                ),
            ])
        ),
        frontend: {
            index: hash(path.join(ROOT, "src-tauri/frontend/index.html")),
            player: hash(path.join(ROOT, "src-tauri/frontend/dist/player.js")),
        },
        limitation:
            "Hosted WebView2/GPU path only; affected physical Windows hardware acceptance remains open.",
        os: { arch: os.arch(), release: os.release(), version: os.version() },
        schema: 1,
        source: process.env.GITHUB_SHA || null,
        status: "fail",
    };
    const port = await nativeFrontendPort();
    const serverLog = fs.openSync(path.join(OUT, "server.log"), "wx");
    const server = spawn(
        process.execPath,
        ["tests/helpers/device-browser-server.cjs"],
        {
            cwd: ROOT,
            env: {
                ...process.env,
                CI_BROWSER_WEB_ROOT: path.join(ROOT, "src-tauri/frontend"),
                OTTP_DEVICE_TEST_PORT: String(port),
                OTTP_NATIVE_VIDEO_GEOMETRY: "1",
            },
            stdio: ["ignore", serverLog, serverLog],
            windowsHide: true,
        }
    );
    try {
        const origin = "http://127.0.0.1:" + port;
        await waitJson(origin + "/__device_test_health", server);
        report.fixtureListener = verifyDebugListener(server.pid, port);
        for (const [index, item] of cases().entries())
            await exercise(binary, origin, item, index, report);
        report.status = "pass";
    } catch (error) {
        report.error = error.stack || String(error);
        process.exitCode = 1;
    } finally {
        try {
            await stopOwned(server);
        } catch (error) {
            report.cleanupError = String(error);
            report.status = "fail";
            process.exitCode = 1;
        }
        fs.closeSync(serverLog);
        fs.writeFileSync(
            path.join(OUT, "result.json"),
            JSON.stringify(report, null, 2) + "\n"
        );
    }
}
module.exports = { cases };
if (require.main === module)
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
