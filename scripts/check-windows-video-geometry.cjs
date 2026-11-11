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
function validateCaptureInterval(before, after, phase) {
    const start = phase * 1.5 + 0.4;
    const end = phase * 1.5 + 1.1;
    if (
        ![before, after].every(
            (value) => Number.isFinite(value) && value > start && value < end
        ) ||
        after < before
    )
        throw new Error(
            "Capture missed its absolute initial phase window; no automatic retry"
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
function powershellFile(file, args) {
    const result = spawnSync(
        "pwsh.exe",
        [
            "-NoProfile",
            "-NonInteractive",
            "-File",
            path.join(ROOT, file),
            ...args,
        ],
        {
            cwd: ROOT,
            encoding: "utf8",
            timeout: 20000,
            windowsHide: true,
        }
    );
    if (result.error || result.status !== 0)
        throw new Error(
            "Windows fixture helper failed: " +
                (result.stderr || result.stdout || result.error)
        );
    return JSON.parse(result.stdout.replace(/^\uFEFF/, "").trim());
}
function startupDiagnostic(pid, port) {
    try {
        return powershellFile("scripts/windows-video-startup-diagnostics.ps1", [
            "-RootPid",
            String(pid),
            "-DebugPort",
            String(port),
        ]);
    } catch (error) {
        return { error: redactDiagnosticText(error, 600), ok: false };
    }
}
function redactDiagnosticText(value, maxLength = 600) {
    return String(value || "")
        .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, "[URL]")
        .replace(
            /\b(token|password|passwd|authorization|api[_-]?key)\s*[:=]\s*[^\s"'<>]+/gi,
            "$1=[REDACTED]"
        )
        .replace(/\b[A-Za-z0-9_+/-]{24,}={0,2}\b/g, "[LONG_TOKEN]")
        .replace(/(?:[A-Za-z]:\\|\\\\)[^\s"'<>]*/g, "[PATH]")
        .slice(0, maxLength);
}
async function pageStartupDiagnostic(page, origin, expectedCase) {
    if (!page || page.isClosed()) return { status: "page-unavailable" };
    let timer;
    try {
        return await Promise.race([
            page.evaluate(
                async ({ expectedOrigin, expectedCaseId }) => {
                    const text = (value, limit) =>
                        String(value || "")
                            .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, "[URL]")
                            .replace(
                                /\b(token|password|passwd|authorization|api[_-]?key)\s*[:=]\s*[^\s"'<>]+/gi,
                                "$1=[REDACTED]"
                            )
                            .replace(
                                /\b[A-Za-z0-9_+/-]{24,}={0,2}\b/g,
                                "[LONG_TOKEN]"
                            )
                            .replace(
                                /(?:[A-Za-z]:\\|\\\\)[^\s"'<>]*/g,
                                "[PATH]"
                            )
                            .replace(/\s+/g, " ")
                            .trim()
                            .slice(0, limit);
                    const knownDevices = new Set([
                        "tauri",
                        "pc",
                        "pc2",
                        "desktop",
                        "nodejs",
                        "android",
                        "androidtv",
                        "lg/webos",
                        "webos",
                        "tizen",
                        "ios",
                    ]);
                    const knownDrivers = new Set([
                        "demo",
                        "m3u",
                        "vportal",
                        "plex",
                        "stalker",
                        "classic-stalker",
                        "offline",
                        "torrent",
                        "xtream",
                        "edem",
                        "kb-team",
                    ]);
                    const routeClass = (pathname) => {
                        if (pathname === "/index.html") return "app-index";
                        const fixture = pathname.match(
                            /^\/__native_video_geometry\/(wide|standard)\.mp4$/
                        );
                        if (fixture) return `fixture-${fixture[1]}`;
                        if (pathname === "/__native_video_geometry/admit")
                            return "fixture-admit";
                        if (pathname.startsWith("/__native_video_geometry/"))
                            return "fixture-other";
                        return "same-origin-other";
                    };
                    const classifySource = (raw) => {
                        if (!raw) return { kind: "empty" };
                        try {
                            const parsed = new URL(raw, location.href);
                            if (parsed.origin !== expectedOrigin)
                                return { kind: "other-origin" };
                            const kind = routeClass(parsed.pathname);
                            return { kind };
                        } catch (_) {
                            return { kind: "invalid" };
                        }
                    };
                    const visible = (element) => {
                        if (!element) return false;
                        const style = getComputedStyle(element);
                        const rect = element.getBoundingClientRect();
                        return (
                            style.display !== "none" &&
                            style.visibility !== "hidden" &&
                            Number(style.opacity || 1) > 0 &&
                            rect.width > 0 &&
                            rect.height > 0
                        );
                    };
                    const video = document.querySelector("#video");
                    const standby = window.__ottStandby;
                    let standbyBlocked = null;
                    let standbyGeneration = null;
                    let standbySnapshot = null;
                    try {
                        if (typeof standby?.blocked === "function")
                            standbyBlocked = !!standby.blocked();
                    } catch (_) {}
                    try {
                        if (typeof standby?.generation === "function") {
                            const value = standby.generation();
                            if (Number.isSafeInteger(value) && value >= 0)
                                standbyGeneration = value;
                        }
                    } catch (_) {}
                    try {
                        const value =
                            typeof standby?.snapshot === "function"
                                ? standby.snapshot()
                                : null;
                        const states = new Set([
                            "running",
                            "suspended",
                            "suspending",
                            "error",
                            "unsupported",
                        ]);
                        if (value && states.has(value.state)) {
                            standbySnapshot = {
                                pending:
                                    Number.isSafeInteger(value.pending) &&
                                    value.pending >= 0
                                        ? value.pending
                                        : null,
                                state: value.state,
                            };
                        }
                    } catch (_) {}
                    const driverId = String(
                        window.__ottActiveProviderDriver?.id || ""
                    );
                    const device = String(window.ott_device || "");
                    const language = String(
                        localStorage.getItem("ottplaylang") || ""
                    );
                    let seededM3uValid = false;
                    try {
                        const config = JSON.parse(
                            localStorage.getItem("m3um3uArr") || "null"
                        );
                        const expectedPlaylist =
                            expectedOrigin +
                            "/__native_video_geometry/channels.m3u?case=" +
                            expectedCaseId;
                        seededM3uValid =
                            config?.active === 0 &&
                            typeof config?.M3Us?.[0]?.www === "string" &&
                            config.M3Us[0].www === expectedPlaylist;
                    } catch (_) {}
                    const events = Array.isArray(window.__nativeGeometryEvents)
                        ? window.__nativeGeometryEvents
                        : null;
                    const eventCounts = {};
                    if (events) {
                        for (const event of events.slice(0, 128)) {
                            const kind =
                                typeof event?.kind === "string" &&
                                /^[A-Za-z0-9_-]{1,32}$/.test(event.kind)
                                    ? event.kind
                                    : "other";
                            eventCounts[kind] = Math.min(
                                128,
                                (eventCounts[kind] || 0) + 1
                            );
                        }
                    }
                    const resources = [];
                    for (const entry of performance
                        .getEntriesByType("resource")
                        .slice(-256)) {
                        if (typeof entry.name !== "string") continue;
                        try {
                            const parsed = new URL(entry.name, location.href);
                            if (parsed.origin !== expectedOrigin) continue;
                            const status = Number(entry.responseStatus);
                            if (
                                Number.isFinite(status) &&
                                (status === 0 || status >= 400)
                            ) {
                                resources.push({
                                    route: routeClass(parsed.pathname),
                                    status,
                                });
                            }
                        } catch (_) {}
                    }
                    const visibleLists = [];
                    for (const selector of [
                        "#channelList",
                        "#channels",
                        "#list",
                        "#cList",
                        ".channel-list",
                        ".channelList",
                    ]) {
                        const element = document.querySelector(selector);
                        if (element)
                            visibleLists.push({
                                selector,
                                visible: visible(element),
                            });
                        if (visibleLists.length === 4) break;
                    }
                    const launch = document.querySelector("#launch");
                    const launchText = visible(launch)
                        ? text(launch.innerText, 300)
                        : "";
                    const query = new URLSearchParams(location.search);
                    const expectedSource =
                        expectedOrigin +
                        "/__native_video_geometry/wide.mp4?case=" +
                        expectedCaseId;
                    const sourceAttribute = classifySource(
                        video?.getAttribute("src") || ""
                    );
                    const sourceProperty = classifySource(video?.src || "");
                    const currentSource = classifySource(
                        video?.currentSrc || ""
                    );
                    let nativeStandbyStatus = { status: "unavailable" };
                    try {
                        const invoke = window.__TAURI__?.core?.invoke;
                        if (typeof invoke === "function") {
                            nativeStandbyStatus = await Promise.race([
                                invoke("background_standby_status", {})
                                    .then((value) => {
                                        if (
                                            !value ||
                                            typeof value.standby !==
                                                "boolean" ||
                                            typeof value.quiescent !==
                                                "boolean" ||
                                            !Number.isSafeInteger(
                                                value.pending
                                            ) ||
                                            value.pending < 0
                                        ) {
                                            return {
                                                status: "invalid-response",
                                            };
                                        }
                                        return {
                                            pending: Math.min(
                                                value.pending,
                                                2147483647
                                            ),
                                            quiescent: value.quiescent,
                                            standby: value.standby,
                                            status: "ok",
                                        };
                                    })
                                    .catch((error) => ({
                                        errorName: String(
                                            error?.name || "Error"
                                        ).slice(0, 48),
                                        status: "error",
                                    })),
                                new Promise((resolve) =>
                                    setTimeout(
                                        () => resolve({ status: "timeout" }),
                                        1200
                                    )
                                ),
                            ]);
                        }
                    } catch (error) {
                        nativeStandbyStatus = {
                            errorName: String(error?.name || "Error").slice(
                                0,
                                48
                            ),
                            status: "error",
                        };
                    }
                    return {
                        launchText,
                        launchVisible: !!(launch && visible(launch)),
                        nativeGeometryEvents: events
                            ? { count: events.length, kindCounts: eventCounts }
                            : null,
                        ownOriginResourceFailures: resources.slice(0, 32),
                        page: {
                            nativecaseMatchesExpected:
                                query.get("nativecase") === expectedCaseId,
                            originMatchesExpected:
                                location.origin === expectedOrigin,
                            pathClass:
                                location.pathname === "/index.html"
                                    ? "app-index"
                                    : "other",
                            readyState: document.readyState,
                            title: text(document.title, 120),
                            visibilityState: document.visibilityState,
                        },
                        runtime: {
                            activeProviderKnown: knownDrivers.has(driverId),
                            bootstrapPresent:
                                !!window.__ottDevice &&
                                typeof window.__ottDevice === "object",
                            cListLength: Array.isArray(window.cList)
                                ? Math.min(1000000, window.cList.length)
                                : null,
                            commandChannelsReady:
                                typeof window.commandChannelsReady === "boolean"
                                    ? window.commandChannelsReady
                                    : null,
                            languageEnumMatch: language === "_eng",
                            ottDeviceKnown: knownDevices.has(device),
                            playerMode:
                                Number.isInteger(window.playerMode) &&
                                window.playerMode >= 0 &&
                                window.playerMode <= 16
                                    ? window.playerMode
                                    : null,
                            seededM3uValid,
                        },
                        standby: {
                            blocked: standbyBlocked,
                            generation: standbyGeneration,
                            nativeStatus: nativeStandbyStatus,
                            snapshot: standbySnapshot,
                        },
                        status: "captured",
                        video: video
                            ? {
                                  currentSource: currentSource.kind,
                                  currentSourceMatchesFixture:
                                      video.currentSrc === expectedSource,
                                  currentTime: Number.isFinite(
                                      video.currentTime
                                  )
                                      ? Number(video.currentTime.toFixed(3))
                                      : null,
                                  errorCode: video.error
                                      ? Number(video.error.code) || null
                                      : null,
                                  firstSourceMatchesFixture:
                                      video.src === expectedSource,
                                  height: Number(video.videoHeight) || 0,
                                  networkState: Number(video.networkState),
                                  paused: !!video.paused,
                                  readyState: Number(video.readyState),
                                  sourceAttribute: sourceAttribute.kind,
                                  sourceProperty: sourceProperty.kind,
                                  width: Number(video.videoWidth) || 0,
                              }
                            : null,
                        visibleLists,
                    };
                },
                { expectedCaseId: expectedCase, expectedOrigin: origin }
            ),
            new Promise((resolve) => {
                timer = setTimeout(
                    () => resolve({ status: "diagnostic-timeout" }),
                    2500
                );
            }),
        ]);
    } catch (error) {
        return {
            errorName: String(error?.name || "Error").slice(0, 48),
            status: "diagnostic-unavailable",
        };
    } finally {
        if (timer) clearTimeout(timer);
    }
}
async function exercise(binary, origin, item, index, report, debugPort) {
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
    const log = fs.openSync(path.join(OUT, stem + ".log"), "wx");
    let child, browser, page;
    const pageErrors = [];
    const ownedImages = [];
    const record = { ...item, samples: [], status: "fail" };
    report.cases.push(record);
    try {
        child = spawn(binary, [], {
            cwd: ROOT,
            env: {
                ...process.env,
                EPG_URLS: origin + "/__native_video_geometry/guide.xml",
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
            record.spawnError = redactDiagnosticText(error.message, 300);
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
        page = context.pages()[0];
        if (!page) throw new Error("No owned WebView2 page");
        page.on("pageerror", (error) => {
            if (pageErrors.length < 8)
                pageErrors.push(
                    redactDiagnosticText(error?.stack || error?.message, 360)
                );
        });
        await page.waitForURL(origin + "/index.html?nativecase=" + id, {
            timeout: 30000,
            waitUntil: "domcontentloaded",
        });
        await page.waitForFunction(
            () => window.__ottDevice && typeof window.stbPlay === "function"
        );
        record.nativeBridge = await page.evaluate(() =>
            window.__TAURI__.core.invoke("ping")
        );
        if (index === 0)
            record.startup = startupDiagnostic(child.pid, debugPort);
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
                        window.__nativeGeometryRetained =
                            document.querySelector("#video");
                        window.__nativeGeometryRetained.muted = true;
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
                            const target = window.captureAspectTarget();
                            if (!target)
                                throw new Error(
                                    "No production aspect preference target"
                                );
                            if (target.mode !== mode && !target.set(mode))
                                throw new Error(
                                    "Could not persist the requested aspect preference"
                                );
                            window.stbStop();
                            window.setPlayerMode(0);
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
                                v.currentTime > phase * 1.5 + 0.4 &&
                                v.currentTime < phase * 1.5 + 1.1 &&
                                v.getVideoPlaybackQuality().totalVideoFrames > 0
                            );
                        },
                        { height, phase, width },
                        { timeout: 12000 }
                    );
                    const before = await page.evaluate(() => {
                        const v = document.querySelector("#video");
                        if (v !== window.__nativeGeometryRetained)
                            throw new Error(
                                "Replay replaced the retained media element"
                            );
                        const target = window.captureAspectTarget();
                        const r = v.getBoundingClientRect();
                        return {
                            aspect: target?.mode,
                            frames: v.getVideoPlaybackQuality()
                                .totalVideoFrames,
                            height: innerHeight,
                            rect: {
                                height: r.height,
                                width: r.width,
                                x: r.x,
                                y: r.y,
                            },
                            source: v.currentSrc,
                            time: v.currentTime,
                            width: innerWidth,
                        };
                    });
                    if (before.aspect !== mode)
                        throw new Error(
                            "Production aspect mode changed before capture"
                        );
                    if (
                        before.source !==
                        origin +
                            "/__native_video_geometry/" +
                            source +
                            ".mp4?case=" +
                            id
                    )
                        throw new Error(
                            "Captured media source does not belong to the current fixture case"
                        );
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
                    ownedImages.push(image);
                    const after = await page.evaluate(
                        () => document.querySelector("#video").currentTime
                    );
                    validateCaptureInterval(before.time, after, phase);
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
        record.error = redactDiagnosticText(error.stack || String(error), 1600);
        record.processExitCode = child?.exitCode;
        record.pageErrors = pageErrors;
        record.startupPage = await pageStartupDiagnostic(page, origin, id);
        if (child?.pid && child.exitCode === null)
            record.startupFailure = startupDiagnostic(child.pid, debugPort);
        throw error;
    } finally {
        // CDP disconnect, then owned process-tree cleanup; no installed players.
        if (browser)
            await Promise.race([browser.close().catch(() => {}), sleep(5000)]);
        try {
            await stopOwned(child);
        } catch (error) {
            record.cleanupError = redactDiagnosticText(error, 300);
            record.status = "fail";
            throw error;
        } finally {
            fs.closeSync(log);
            // Raw desktop pixels are transient oracle input, never public artifacts.
            for (const image of ownedImages) fs.rmSync(image, { force: true });
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
    const debugPort = await freePort();
    const policyReceipt = path.join(OUT, "debug-policy.json");
    const displayReceipt = path.join(OUT, "display-mode.json");
    const hosted =
        process.env.GITHUB_ACTIONS === "true" &&
        process.env.RUNNER_ENVIRONMENT === "github-hosted";
    let fixtureBinary = binary;
    let copiedBinary;
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
        if (hosted) {
            report.displayPreparation = powershellFile(
                "scripts/windows-video-display.ps1",
                ["-Action", "Apply", "-Receipt", displayReceipt]
            );
            if (
                !["applied", "unchanged"].includes(
                    report.displayPreparation.status
                )
            )
                throw new Error(
                    "Hosted desktop display was not qualified before app launch"
                );
            const name =
                "ottplay-video-fixture-" +
                crypto.randomBytes(16).toString("hex") +
                ".exe";
            const candidate = path.join(path.dirname(binary), name);
            fs.copyFileSync(binary, candidate, fs.constants.COPYFILE_EXCL);
            copiedBinary = candidate;
            if (hash(copiedBinary) !== report.executable.sha256)
                throw new Error(
                    "Native fixture copy differs from production EXE"
                );
            fixtureBinary = copiedBinary;
            report.fixtureExecutable = {
                byteIdentical: true,
                name,
                sha256: hash(copiedBinary),
            };
            report.debugPolicyInstall = powershellFile(
                "scripts/windows-video-debug-policy.ps1",
                [
                    "-Action",
                    "Install",
                    "-Name",
                    name,
                    "-Port",
                    String(debugPort),
                    "-Receipt",
                    policyReceipt,
                ]
            );
        }
        if (hosted && report.debugPolicyInstall?.status !== "installed")
            throw new Error("Debug policy was not confirmed installed");
        for (const [index, item] of cases().entries())
            await exercise(
                fixtureBinary,
                origin,
                item,
                index,
                report,
                debugPort
            );
        report.status = "pass";
    } catch (error) {
        report.error = redactDiagnosticText(error.stack || String(error), 1600);
        process.exitCode = 1;
    } finally {
        try {
            await stopOwned(server);
        } catch (error) {
            report.cleanupError = redactDiagnosticText(error, 600);
            report.status = "fail";
            process.exitCode = 1;
        }
        fs.closeSync(serverLog);
        if (fs.existsSync(policyReceipt)) {
            try {
                report.debugPolicyRestore = powershellFile(
                    "scripts/windows-video-debug-policy.ps1",
                    ["-Action", "Restore", "-Receipt", policyReceipt]
                );
                if (report.debugPolicyRestore.status !== "restored")
                    throw new Error(
                        "Debug policy restoration was not confirmed"
                    );
            } catch (error) {
                report.policyCleanupError = redactDiagnosticText(error, 600);
                report.status = "fail";
                process.exitCode = 1;
            }
        }
        if (copiedBinary && fs.existsSync(copiedBinary)) {
            try {
                fs.rmSync(copiedBinary, { maxRetries: 3, retryDelay: 100 });
            } catch (error) {
                report.executableCleanupError = redactDiagnosticText(
                    error,
                    600
                );
                report.status = "fail";
                process.exitCode = 1;
            }
        }
        if (fs.existsSync(displayReceipt)) {
            try {
                report.displayRestore = powershellFile(
                    "scripts/windows-video-display.ps1",
                    ["-Action", "Restore", "-Receipt", displayReceipt]
                );
                if (report.displayRestore.status !== "restored")
                    throw new Error(
                        "Owned desktop display restoration was not confirmed"
                    );
            } catch (error) {
                report.displayCleanupError = redactDiagnosticText(error, 600);
                report.status = "fail";
                process.exitCode = 1;
            }
        }
        fs.writeFileSync(
            path.join(OUT, "result.json"),
            JSON.stringify(report, null, 2) + "\n"
        );
    }
}
module.exports = {
    cases,
    pageStartupDiagnostic,
    redactDiagnosticText,
    validateCaptureInterval,
};
if (require.main === module)
    main().catch((error) => {
        console.error(redactDiagnosticText(error.stack || String(error), 1600));
        process.exitCode = 1;
    });
