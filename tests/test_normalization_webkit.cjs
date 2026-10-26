/* Isolated real WebKit/FFmpeg gateway check; never opens user player instances. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn, spawnSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { webkit, chromium } = require("playwright");
const useHls = process.env.OTT_TEST_ENGINE === "hls";
const playerDist = process.env.OTT_TEST_PLAYER_DIST;
if (playerDist)
    assert(
        process.env.OTT_TEST_DIRECT_HTTPS,
        "Shared runtime test requires direct HTTPS"
    );
const root = path.resolve(__dirname, "..");
const ffmpeg = process.env.OTT_TEST_FFMPEG;
const ffprobe = process.env.OTT_TEST_FFPROBE;
const binary = process.env.OTT_TEST_SERVER;
assert(
    ffmpeg && ffprobe && binary,
    "Set OTT_TEST_FFMPEG, OTT_TEST_FFPROBE, OTT_TEST_SERVER to verified installed executables"
);
const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "ott-normalization-webkit-")
);
let source, reserver, worker, browser, result, page, front, activeLease;
let snapshotIndex = 0;
const diagnostics = { masters: [] };
const servedFiles = new Set();
const lifecycleLog = path.join(directory, "lifecycle.log");
(async () => {
    const languages = ["rus", "eng", "fre", "spa", "qaa", "tur"];
    let upstream, sourceURL;
    const realSource = process.env.OTT_TEST_SOURCE_FILE;
    if (realSource) {
        sourceURL = fs.readFileSync(realSource, "utf8").trim();
        upstream = new URL(sourceURL).origin;
    } else {
        const args = [
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-stream_loop",
            process.env.OTT_TEST_SEGMENT_FILE ? "29" : "119",
            "-i",
            process.env.OTT_TEST_SEGMENT_FILE ||
                path.join(root, "tests/fixtures/media-runtime/segment00.ts"),
            "-map",
            "0:v:0",
        ];
        for (let i = 0; i < 6; i++) args.push("-map", "0:a:0");
        languages.forEach((language, i) =>
            args.push(`-metadata:s:a:${i}`, `language=${language}`)
        );
        const fixturePlaylist = path.join(directory, "fixture.m3u8");
        args.push(
            "-c",
            "copy",
            "-f",
            "hls",
            "-hls_time",
            "2",
            "-hls_list_size",
            "0",
            "-hls_segment_filename",
            path.join(directory, "fixture-%03d.ts"),
            fixturePlaylist
        );
        assert.equal(spawnSync(ffmpeg, args, { stdio: "pipe" }).status, 0);
        const playlist = fs.readFileSync(fixturePlaylist, "utf8");
        const fragments = playlist.match(/#EXTINF:[^\n]+\n[^\n]+/g);
        assert(fragments && fragments.length >= 6);
        const target = Number(
            playlist.match(/#EXT-X-TARGETDURATION:(\d+)/)?.[1]
        );
        const begun = Date.now();
        source = http.createServer((req, res) => {
            if (req.url === "/master.m3u8") {
                // The production contract is live HLS. Slide a bounded window
                // over precomputed media instead of feeding a finite VOD list
                // whose worker can end before a delayed fault is injected.
                const first = Math.min(
                    fragments.length - 6,
                    Math.max(
                        0,
                        Math.floor((Date.now() - begun) / (target * 1000)) - 2
                    )
                );
                res.setHeader("content-type", "application/vnd.apple.mpegurl");
                res.end(
                    `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:${target}\n#EXT-X-MEDIA-SEQUENCE:${first}\n${fragments.slice(first, first + 6).join("\n")}\n`
                );
            } else if (/^\/fixture-\d+\.ts$/.test(req.url))
                res.end(
                    fs.readFileSync(path.join(directory, req.url.slice(1)))
                );
            else {
                res.statusCode = 404;
                res.end();
            }
        });
        await new Promise((resolve) => source.listen(0, "127.0.0.1", resolve));
        upstream = `http://127.0.0.1:${source.address().port}`;
        sourceURL = `${upstream}/master.m3u8`;
    }
    reserver = http.createServer();
    await new Promise((resolve) => reserver.listen(0, "127.0.0.1", resolve));
    const port = reserver.address().port;
    await new Promise((resolve) => reserver.close(resolve));
    const key = randomBytes(24).toString("hex");
    const playback = randomBytes(24).toString("hex");
    let configuredFfmpeg = ffmpeg;
    let configuredFfprobe = ffprobe;
    if (process.env.OTT_TEST_PASSTHROUGH) {
        configuredFfmpeg = path.join(directory, "passthrough-ffmpeg");
        fs.writeFileSync(
            configuredFfmpeg,
            '#!/bin/sh\nif [ "$1" = "-version" ]; then echo ffmpeg version test; exit 0; fi\nexit 1\n',
            { mode: 0o700 }
        );
    }
    if (process.env.OTT_TEST_CAPTURE_WORKER || process.env.OTT_TEST_CRASH) {
        configuredFfmpeg = path.join(directory, "capture-ffmpeg");
        const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
        const failure = process.env.OTT_TEST_FAIL_START_ONCE
            ? `if [ -f ${quote(path.join(directory, "fail-next-worker"))} ]; then rm ${quote(path.join(directory, "fail-next-worker"))}; printf failed >${quote(path.join(directory, "worker.failed"))}; printf 'worker-failed %s %s\\n' "$(date +%s)" "$$" >>${quote(lifecycleLog)}; exit 1; fi;`
            : "";
        fs.writeFileSync(
            configuredFfmpeg,
            `#!/bin/sh\nif [ "$1" != "-version" ]; then printf 'worker-start %s %s\\n' "$(date +%s)" "$$" >>${quote(lifecycleLog)}; printf '%s' "$$" >${quote(path.join(directory, "worker.pid"))}; ${failure} fi\nexec ${quote(ffmpeg)} "$@" 2>>${quote(path.join(directory, "worker.stderr"))}\n`,
            { mode: 0o700 }
        );
    }
    if (process.env.OTT_TEST_CAPTURE_WORKER) {
        configuredFfprobe = path.join(directory, "capture-ffprobe");
        const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
        fs.writeFileSync(
            configuredFfprobe,
            `#!/bin/sh\nif [ "$1" = "-version" ]; then exec ${quote(ffprobe)} "$@"; fi\noutput=${quote(path.join(directory, "probe-"))}"$$.stdout"\nprintf 'probe-start %s %s\n' "$(date +%s)" "$$" >>${quote(lifecycleLog)}\n${quote(ffprobe)} "$@" >"$output" 2>>${quote(path.join(directory, "probe.stderr"))}\nstatus=$?\nprintf 'probe-exit %s %s %s\n' "$(date +%s)" "$$" "$status" >>${quote(lifecycleLog)}\ncat "$output"\nexit "$status"\n`,
            { mode: 0o700 }
        );
    }
    let origin = "https://normalization.test";
    if (process.env.OTT_TEST_DIRECT_HTTPS) {
        const keyFile = path.join(directory, "tls.key");
        const certFile = path.join(directory, "tls.crt");
        assert.equal(
            spawnSync(
                "openssl",
                [
                    "req",
                    "-x509",
                    "-newkey",
                    "rsa:2048",
                    "-nodes",
                    "-keyout",
                    keyFile,
                    "-out",
                    certFile,
                    "-days",
                    "1",
                    "-subj",
                    "/CN=localhost",
                ],
                { stdio: "pipe" }
            ).status,
            0
        );
        front = require("node:https").createServer(
            { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) },
            async (req, res) => {
                if (playerDist && !req.url.startsWith("/normalize/")) {
                    const pathname = new URL(req.url, origin).pathname;
                    if (pathname === "/fixture.m3u") {
                        res.setHeader("content-type", "application/x-mpegurl");
                        return res.end(
                            `#EXTM3U\n#EXTINF:-1 tvg-id="normalized" group-title="Fixture",Normalized fixture\n${origin}/normalize/play/demo/${playback}/master.m3u8\n`
                        );
                    }
                    if (pathname === "/local/swop.json") {
                        res.setHeader("content-type", "application/json");
                        return res.end("{}");
                    }
                    const relative =
                        pathname.startsWith("/f/") || pathname === "/"
                            ? "index.html"
                            : pathname.slice(1);
                    const filename = path.resolve(playerDist, relative);
                    if (
                        !filename.startsWith(
                            path.resolve(playerDist) + path.sep
                        ) ||
                        !/^(index\.html|(?:dist|js|devices|providers|styles|images|fonts|locales)\/|favicon\.ico)/.test(
                            relative
                        ) ||
                        !fs.existsSync(filename) ||
                        !fs.statSync(filename).isFile()
                    ) {
                        res.statusCode = 404;
                        return res.end();
                    }
                    const types = {
                        ".css": "text/css",
                        ".html": "text/html",
                        ".js": "application/javascript",
                        ".json": "application/json",
                        ".png": "image/png",
                        ".svg": "image/svg+xml",
                        ".ttf": "font/ttf",
                        ".woff": "font/woff",
                        ".woff2": "font/woff2",
                    };
                    res.setHeader(
                        "content-type",
                        types[path.extname(filename)] ||
                            "application/octet-stream"
                    );
                    res.setHeader("cache-control", "no-store");
                    return res.end(fs.readFileSync(filename));
                }
                if (req.url === "/test") {
                    res.setHeader("content-type", "text/html");
                    res.end("<video autoplay muted playsinline></video>");
                    return;
                }
                try {
                    servedFiles.add(
                        new URL(req.url, origin).pathname.split("/").at(-1)
                    );
                    const response = await fetch(
                        `http://127.0.0.1:${port}${req.url}`,
                        { headers: { origin } }
                    );
                    res.statusCode = response.status;
                    for (const [name, value] of response.headers)
                        if (
                            ![
                                "transfer-encoding",
                                "connection",
                                "keep-alive",
                                "content-encoding",
                            ].includes(name)
                        )
                            res.setHeader(name, value);
                    const body = Buffer.from(await response.arrayBuffer());
                    if (
                        process.env.OTT_TEST_ARTIFACT_DIR &&
                        req.url.includes(".m3u8") &&
                        snapshotIndex < 200
                    ) {
                        const folder = process.env.OTT_TEST_ARTIFACT_DIR;
                        fs.mkdirSync(folder, { mode: 0o700, recursive: true });
                        const name = new URL(req.url, origin).pathname
                            .split("/")
                            .at(-1);
                        fs.writeFileSync(
                            path.join(
                                folder,
                                `${String(snapshotIndex++).padStart(3, "0")}-${name}`
                            ),
                            body,
                            { mode: 0o600 }
                        );
                    }
                    const lease = req.url.endsWith(".m3u8")
                        ? body
                              .toString()
                              .match(
                                  /\/normalize\/media\/([a-f0-9]{32})\//
                              )?.[1]
                        : undefined;
                    if (lease) activeLease = lease;
                    res.end(body);
                } catch {
                    res.writeHead(502);
                    res.end();
                }
            }
        );
        await new Promise((resolve) => front.listen(0, "127.0.0.1", resolve));
        origin = `https://127.0.0.1:${front.address().port}`;
    }
    const config = path.join(directory, "config.json");
    fs.writeFileSync(
        config,
        JSON.stringify({
            directory: path.join(directory, "sessions"),
            ffmpeg: configuredFfmpeg,
            ffprobe: configuredFfprobe,
            key,
            origins: [origin],
            public_base: origin,
            sources: {
                demo: {
                    allowed_origins: [upstream],
                    headers: {},
                    playback_key: playback,
                    url: sourceURL,
                },
            },
        }),
        { mode: 0o600 }
    );
    worker = spawn(binary, ["--host", "127.0.0.1", "--port", String(port)], {
        cwd: directory,
        env: {
            ...process.env,
            OTT_NORMALIZATION_CONFIG: config,
            OTT_NORMALIZATION_ONLY: "1",
        },
        stdio: ["ignore", "ignore", "ignore"],
    });
    for (let i = 0; ; i++) {
        try {
            if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break;
        } catch {}
        assert(
            i < 100 && worker.exitCode === null,
            "isolated gateway did not start"
        );
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    browser = await (useHls ? chromium : webkit).launch({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    if (!front)
        await context.route("**/*", async (route) => {
            const url = new URL(route.request().url());
            if (url.protocol === "blob:") return route.continue();
            if (url.origin !== "https://normalization.test")
                return route.abort();
            if (url.pathname === "/test")
                return route.fulfill({
                    body: "<video autoplay muted playsinline></video>",
                    contentType: "text/html",
                });
            const response = await fetch(
                `http://127.0.0.1:${port}${url.pathname}${url.search}`,
                { headers: { origin: "https://normalization.test" } }
            );
            const body = Buffer.from(await response.arrayBuffer());
            diagnostics.files ||= {};
            const file = url.pathname.split("/").at(-1);
            diagnostics.files[file] = (diagnostics.files[file] || 0) + 1;
            if (/^track_\d+\.m3u8$/.test(file)) {
                diagnostics.requestedSequences ||= {};
                const sequence = body
                    .toString()
                    .match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/)?.[1];
                (diagnostics.requestedSequences[file] ||= []).push(sequence);
            }
            diagnostics.responses ||= {};
            diagnostics.responses[response.status] =
                (diagnostics.responses[response.status] || 0) + 1;
            if (url.pathname.endsWith("master.m3u8")) {
                const text = body.toString();
                diagnostics.masters.push({
                    audio: text.split("TYPE=AUDIO").length - 1,
                    codecs: text.match(/CODECS="([^"]+)"/)?.[1],
                    original: text.includes("/normalize/original/"),
                    resolution: text.match(/RESOLUTION=([^,\n]+)/)?.[1],
                    status: response.status,
                    variants: text.split("#EXT-X-STREAM-INF").length - 1,
                });
            }
            const headers = Object.fromEntries(response.headers);
            for (const name of [
                "transfer-encoding",
                "content-length",
                "connection",
                "keep-alive",
                "content-encoding",
            ])
                delete headers[name];
            return route.fulfill({ body, headers, status: response.status });
        });
    if (playerDist) {
        await context.addInitScript(
            ({ origin, useHls }) => {
                window.__normalizationShared = true;
                localStorage.setItem("ottplaylang", "_eng");
                localStorage.setItem("ottplayprov", "m3u");
                localStorage.setItem("m3usPlayers", useHls ? "1" : "0");
                localStorage.setItem(
                    "m3um3uArr",
                    JSON.stringify({
                        active: 0,
                        M3Us: [{ www: origin + "/fixture.m3u" }],
                    })
                );
                const play = HTMLMediaElement.prototype.play;
                HTMLMediaElement.prototype.play = function (...args) {
                    this.muted = true;
                    return play.apply(this, args);
                };
            },
            { origin, useHls }
        );
        await context.route("**/*", (route) =>
            new URL(route.request().url()).origin === origin
                ? route.continue()
                : route.abort("blockedbyclient")
        );
        await context.routeWebSocket("**/*", (socket) => socket.close());
    }
    page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    diagnostics.pageErrors = pageErrors;
    await page.goto(`${origin}/${playerDist ? "f/pc/" : "test"}`);
    if (playerDist)
        await page.waitForFunction(
            () => window.__ottDevice && window.__ottCoreBackend?.().current(),
            null,
            { timeout: 45000 }
        );
    if (useHls && !playerDist)
        await page.addScriptTag({ path: path.join(root, "js/hls.min.js") });
    await page.evaluate(() => {
        window.passthrough = false;
    });
    if (process.env.OTT_TEST_PASSTHROUGH)
        await page.evaluate(() => {
            window.passthrough = true;
        });
    await page.evaluate((url) => {
        const video = document.querySelector("video");
        if (window.__normalizationShared) {
            window.readFrames = () =>
                video.getVideoPlaybackQuality?.().totalVideoFrames ??
                video.webkitDecodedFrameCount ??
                null;
            window.readAudioTracks = () =>
                (
                    window.__ottCoreBackend().current()?.tracks("audio") || []
                ).map((track) => ({
                    enabled: track.selected,
                    language: track.language,
                }));
            window.selectAudioTrack = (index) => {
                window.stbToggleAudioTrack();
                window._doKey(window.keys.LEFT);
                for (let i = 0; i < index; i++) window._doKey(window.keys.DOWN);
                window._doKey(window.keys.ENTER);
            };
            return;
        }
        if (window.Hls) {
            window.hls = new window.Hls({ enableWorker: false });
            window.hlsErrors = [];
            window.hls.on(window.Hls.Events.ERROR, (_, data) =>
                window.hlsErrors.push({
                    details: data.details,
                    error: data.error?.message,
                    fatal: data.fatal,
                    reason: data.reason,
                    type: data.type,
                })
            );
            window.hls.attachMedia(video);
            window.hls.loadSource(url);
        } else video.src = url;
        window.readFrames = () =>
            video.getVideoPlaybackQuality?.().totalVideoFrames ??
            video.webkitDecodedFrameCount ??
            null;
        window.readAudioTracks = () =>
            window.hls
                ? window.hls.audioTracks.map((track, i) => ({
                      enabled: window.hls.audioTrack === i,
                      language: track.lang,
                  }))
                : Array.from(video.audioTracks || []);
        window.selectAudioTrack = (index) => {
            if (window.hls) window.hls.audioTrack = index;
            else
                for (let i = 0; i < video.audioTracks.length; i++)
                    video.audioTracks[i].enabled = i === index;
        };
        video.play().catch((error) => {
            window.playError = error.name;
        });
    }, `${origin}/normalize/play/demo/${playback}/master.m3u8`);
    await page.waitForFunction(
        () => {
            const video = document.querySelector("video");
            return (
                video.error ||
                (video.readyState >= 3 &&
                    video.currentTime > 0.5 &&
                    window.readAudioTracks().length ===
                        (window.passthrough ? 1 : 6))
            );
        },
        { timeout: 30000 }
    );
    assert.equal(
        await page.evaluate(
            () => document.querySelector("video").error?.code || 0
        ),
        0,
        "native media decode failed"
    );
    diagnostics.stage = "first-progress";
    const firstTime = await page.evaluate(
        () => document.querySelector("video").currentTime
    );
    await page.waitForFunction(
        (time) => document.querySelector("video").currentTime > time + 0.5,
        firstTime,
        { timeout: 10000 }
    );
    diagnostics.stage = "audio-switch";
    const before = await page.evaluate(() => {
        const video = document.querySelector("video");
        return {
            enabled: window.readAudioTracks().map((track) => track.enabled),
            frames: window.readFrames(),
            languages: window.readAudioTracks().map((track) => track.language),
            time: video.currentTime,
        };
    });
    if (!process.env.OTT_TEST_PASSTHROUGH)
        assert.deepEqual(before.languages, languages);
    if (
        !process.env.OTT_TEST_PASSTHROUGH &&
        !process.env.OTT_TEST_SKIP_SWITCH
    ) {
        await page.evaluate(() => window.selectAudioTrack(2));
        await page.waitForFunction(
            () => window.readAudioTracks()[2]?.enabled,
            null,
            { timeout: 5000 }
        );
        const alternateTime = await page.evaluate(
            () => document.querySelector("video").currentTime
        );
        await page.waitForFunction(
            (time) => document.querySelector("video").currentTime > time + 0.5,
            alternateTime,
            { timeout: 10000 }
        );
        const deadline = Date.now() + 5000;
        while (
            !Array.from(servedFiles).some((name) =>
                /^track_3_\d+\.(m4s|ts)$/.test(name)
            ) &&
            Date.now() < deadline
        )
            await new Promise((resolve) => setTimeout(resolve, 20));
        assert(
            Array.from(servedFiles).some((name) =>
                /^track_3_\d+\.(m4s|ts)$/.test(name)
            ),
            "French media rendition was fetched"
        );
    }
    await page.evaluate((skip) => {
        if (skip) return;
        window.selectAudioTrack(window.passthrough ? 0 : 1);
    }, Boolean(process.env.OTT_TEST_SKIP_SWITCH));
    await page.waitForFunction(
        (time) => document.querySelector("video").currentTime > time + 0.5,
        before.time,
        { timeout: 10000 }
    );
    const enabled = await page.evaluate(() =>
        window.readAudioTracks().map((track) => track.enabled)
    );
    assert.deepEqual(
        enabled,
        process.env.OTT_TEST_PASSTHROUGH
            ? [true]
            : process.env.OTT_TEST_SKIP_SWITCH
              ? before.enabled
              : [false, true, false, false, false, false]
    );
    let restart;
    if ((process.env.OTT_TEST_RESTART || process.env.OTT_TEST_CRASH) && front) {
        restart = (async () => {
            await page.waitForFunction(
                (time) =>
                    document.querySelector("video").currentTime > time + 3,
                before.time,
                { timeout: 15000 }
            );
            assert(activeLease);
            if (process.env.OTT_TEST_CRASH) {
                const pid = Number(
                    fs.readFileSync(path.join(directory, "worker.pid"), "utf8")
                );
                assert(
                    Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid
                );
                const parent = spawnSync(
                    "ps",
                    ["-o", "ppid=", "-p", String(pid)],
                    { encoding: "utf8" }
                );
                assert.equal(
                    Number(parent.stdout.trim()),
                    worker.pid,
                    "fault injection must target a live child of the isolated gateway"
                );
                if (process.env.OTT_TEST_FAIL_START_ONCE)
                    fs.writeFileSync(
                        path.join(directory, "fail-next-worker"),
                        "1",
                        { mode: 0o600 }
                    );
                fs.appendFileSync(
                    lifecycleLog,
                    `worker-kill ${Math.floor(Date.now() / 1000)} ${pid}\n`
                );
                process.kill(pid, "SIGKILL");
                return;
            }
            const response = await fetch(
                `http://127.0.0.1:${port}/normalize/api`,
                {
                    body: JSON.stringify({ lease: activeLease, op: "close" }),
                    headers: {
                        authorization: `Bearer ${key}`,
                        "content-type": "application/json",
                    },
                    method: "POST",
                }
            );
            assert.equal(response.status, 204);
        })();
        // Observe immediately; rethrow below after the playback observation so
        // a failed injection cannot bypass the finally-owned process cleanup.
        restart.catch(() => {});
    }
    let observedSeconds = 0;
    if (
        realSource ||
        process.env.OTT_TEST_SEGMENT_FILE ||
        process.env.OTT_TEST_OBSERVE_SECONDS
    ) {
        const seconds = Number(process.env.OTT_TEST_OBSERVE_SECONDS || 12);
        observedSeconds = seconds;
        // A discontinuity can move currentTime without decoding any frames.
        // Observe real elapsed playback too, rather than accepting a clock jump.
        await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
        await page.waitForFunction(
            ({ time, seconds }) =>
                document.querySelector("video").currentTime > time + seconds,
            { seconds, time: before.time },
            { timeout: (seconds + (restart ? 30 : 12)) * 1000 }
        );
    }
    if (restart) await restart;
    const continuing = await page.evaluate(() => ({
        frames: window.readFrames(),
        time: document.querySelector("video").currentTime,
    }));
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const continued = await page.evaluate(() => ({
        frames: window.readFrames(),
        time: document.querySelector("video").currentTime,
    }));
    assert(
        continued.time > continuing.time + 1,
        "media must keep advancing after recovery/observation"
    );
    if (continuing.frames !== null)
        assert(
            continued.frames > continuing.frames + 10,
            "decoder must keep producing frames after recovery/observation"
        );
    if (playerDist)
        assert.equal(
            await page.evaluate(() => window.playerMode),
            useHls ? 1 : 0,
            "requested shared playback engine must be active"
        );
    if (process.env.OTT_TEST_FAIL_START_ONCE)
        assert(
            fs.existsSync(path.join(directory, "worker.failed")),
            "replacement failure injection must have run"
        );
    const finalTracks = await page.evaluate(() =>
        window.readAudioTracks().map((track) => ({
            enabled: track.enabled,
            language: track.language,
        }))
    );
    diagnostics.finalTracks = finalTracks;
    if (!process.env.OTT_TEST_PASSTHROUGH) {
        assert.equal(
            finalTracks.length,
            6,
            "all six tracks remain after playback/recovery"
        );
        if (!process.env.OTT_TEST_SKIP_SWITCH)
            assert(
                finalTracks[1].enabled,
                "selected audio remains after recovery"
            );
    }
    if (!process.env.OTT_TEST_PASSTHROUGH && !process.env.OTT_TEST_SKIP_SWITCH)
        assert(
            Array.from(servedFiles).some((name) =>
                /^track_2_\d+\.(m4s|ts)$/.test(name)
            ),
            "English media rendition was fetched"
        );
    const actualEngine = playerDist
        ? await page.evaluate(() =>
              window.__ottCoreBackend().current()?.diagnosticEngine()
          )
        : undefined;
    if (process.env.OTT_TEST_EXPECT_ENGINE)
        assert.equal(
            actualEngine,
            process.env.OTT_TEST_EXPECT_ENGINE,
            "actual shared media engine"
        );
    const endTime = await page.evaluate(
        () => document.querySelector("video").currentTime
    );
    const frames = await page.evaluate(() => window.readFrames());
    if (before.frames !== null)
        assert(
            frames - before.frames > Math.max(0, observedSeconds * 5),
            "decoded video frames must advance through the observation interval"
        );
    result = {
        audioTracks: before.languages,
        decodedFrames: before.frames === null ? null : frames - before.frames,
        engine: useHls ? "Hls.js/Chromium" : "WebKit",
        englishSelected: !process.env.OTT_TEST_SKIP_SWITCH,
        framesAdvanced: before.frames === null ? null : true,
        playbackAdvanced: true,
        playbackEngine: actualEngine,
        realSegmentFixture: Boolean(process.env.OTT_TEST_SEGMENT_FILE),
        realSource: Boolean(realSource),
        restart: Boolean(restart),
        result: "PASS",
        secondsAdvanced: Math.round((endTime - before.time) * 100) / 100,
        sharedPlayer: Boolean(playerDist),
        transientFailure: Boolean(process.env.OTT_TEST_FAIL_START_ONCE),
        workerCrash: Boolean(process.env.OTT_TEST_CRASH),
    };
})()
    .catch(async (error) => {
        if (page)
            diagnostics.media = await page
                .evaluate(() => {
                    const v = document.querySelector("video");
                    return {
                        buffered: Array.from(
                            { length: v.buffered.length },
                            (_, i) => [v.buffered.start(i), v.buffered.end(i)]
                        ),
                        ended: v.ended,
                        error: v.error?.code,
                        feedback: window.__normalizationShared
                            ? document.querySelector("#video_res")?.textContent
                            : undefined,
                        hlsErrors: window.hlsErrors,
                        hlsLevel: window.hls?.levels?.map((level) => ({
                            age: level.details?.age,
                            endSN: level.details?.endSN,
                            live: level.details?.live,
                            startSN: level.details?.startSN,
                        })),
                        network: v.networkState,
                        paused: v.paused,
                        playError: window.playError,
                        ready: v.readyState,
                        seekable: Array.from(
                            { length: v.seekable.length },
                            (_, i) => [v.seekable.start(i), v.seekable.end(i)]
                        ),
                        sharedMode: window.__normalizationShared
                            ? window.playerMode
                            : undefined,
                        time: v.currentTime,
                        tracks: window
                            .readAudioTracks?.()
                            .map((t) => t.language),
                    };
                })
                .catch(() => null);
        if (process.env.OTT_TEST_CAPTURE_WORKER) {
            const probeLog = path.join(directory, "probe.stderr");
            diagnostics.probe = fs.existsSync(probeLog)
                ? fs
                      .readFileSync(probeLog, "utf8")
                      .slice(-8192)
                      .replace(/https?:\/\/\S+/g, "[redacted]")
                : "not started";
            try {
                const attempts = fs
                    .readdirSync(directory)
                    .filter((name) => /^probe-\d+\.stdout$/.test(name))
                    .sort(
                        (a, b) =>
                            fs.statSync(path.join(directory, a)).mtimeMs -
                            fs.statSync(path.join(directory, b)).mtimeMs
                    );
                diagnostics.probeAttempts = attempts.map((name) => ({
                    bytes: fs.statSync(path.join(directory, name)).size,
                    file: name,
                }));
                const result = JSON.parse(
                    fs.readFileSync(
                        path.join(directory, attempts.at(-1)),
                        "utf8"
                    )
                );
                diagnostics.inventory = result.streams?.map((stream) => ({
                    codec: stream.codec_name,
                    language: stream.tags?.language,
                }));
            } catch {}
        }
        if (fs.existsSync(lifecycleLog))
            diagnostics.lifecycle = fs
                .readFileSync(lifecycleLog, "utf8")
                .trim()
                .split("\n")
                .slice(-64);
        const workerLog = path.join(directory, "worker.stderr");
        if (process.env.OTT_TEST_CAPTURE_WORKER && fs.existsSync(workerLog))
            diagnostics.worker = fs
                .readFileSync(workerLog, "utf8")
                .split("\n")
                .filter((line) =>
                    /error|failed|Invalid|Server returned|End of|Input\/output|timed out/i.test(
                        line
                    )
                )
                .slice(-30)
                .join("\n")
                .replace(/https?:\/\/\S+/g, "[redacted]")
                .replace(/[a-f0-9]{32}/g, "[id]");
        const sessions = path.join(directory, "sessions");
        if (fs.existsSync(sessions))
            diagnostics.output = fs
                .readdirSync(sessions)
                .filter((id) =>
                    fs.statSync(path.join(sessions, id)).isDirectory()
                )
                .flatMap((id) => {
                    const folder = path.join(sessions, id);
                    diagnostics.playlists = fs
                        .readdirSync(folder)
                        .filter((name) => name.endsWith(".m3u8"))
                        .slice(0, 3)
                        .map((name) => {
                            const text = fs.readFileSync(
                                path.join(folder, name),
                                "utf8"
                            );
                            return {
                                endlist: text.includes("#EXT-X-ENDLIST"),
                                name,
                                segments: text.split("#EXTINF:").length - 1,
                                sequence: text.match(
                                    /#EXT-X-MEDIA-SEQUENCE:(\d+)/
                                )?.[1],
                                target: text.match(
                                    /#EXT-X-TARGETDURATION:(\d+)/
                                )?.[1],
                            };
                        });
                    return fs
                        .readdirSync(folder)
                        .filter((name) =>
                            /^track_[01]_.*\.(ts|m4s)$/.test(name)
                        )
                        .sort()
                        .filter(
                            (name, index, all) =>
                                index % 3 === 0 || index === all.length - 1
                        )
                        .map((name) => {
                            try {
                                let probeFile = path.join(folder, name);
                                if (name.endsWith(".m4s")) {
                                    const track = name.split("_")[1];
                                    probeFile = path.join(
                                        directory,
                                        `inspect_${track}.mp4`
                                    );
                                    fs.writeFileSync(
                                        probeFile,
                                        Buffer.concat([
                                            fs.readFileSync(
                                                path.join(
                                                    folder,
                                                    `track_${track}_init.mp4`
                                                )
                                            ),
                                            fs.readFileSync(
                                                path.join(folder, name)
                                            ),
                                        ])
                                    );
                                }
                                const run = spawnSync(
                                    ffprobe,
                                    [
                                        "-v",
                                        "error",
                                        "-show_entries",
                                        "stream=codec_name,profile,width,height,sample_rate,channels,start_time:format=duration,start_time",
                                        "-of",
                                        "json",
                                        probeFile,
                                    ],
                                    { encoding: "utf8" }
                                );
                                let data;
                                try {
                                    data = JSON.parse(run.stdout);
                                } catch {
                                    data = { failed: true };
                                }
                                const packets = spawnSync(
                                    ffprobe,
                                    [
                                        "-v",
                                        "error",
                                        "-read_intervals",
                                        "%+#3",
                                        "-show_packets",
                                        "-show_entries",
                                        "packet=pts_time,dts_time,flags",
                                        "-of",
                                        "json",
                                        probeFile,
                                    ],
                                    { encoding: "utf8" }
                                );
                                try {
                                    data.firstPackets = JSON.parse(
                                        packets.stdout
                                    ).packets;
                                } catch {}
                                if (process.env.OTT_TEST_ARTIFACT_DIR) {
                                    fs.mkdirSync(
                                        process.env.OTT_TEST_ARTIFACT_DIR,
                                        {
                                            mode: 0o700,
                                            recursive: true,
                                        }
                                    );
                                    fs.copyFileSync(
                                        path.join(folder, name),
                                        path.join(
                                            process.env.OTT_TEST_ARTIFACT_DIR,
                                            name
                                        )
                                    );
                                    fs.chmodSync(
                                        path.join(
                                            process.env.OTT_TEST_ARTIFACT_DIR,
                                            name
                                        ),
                                        0o600
                                    );
                                }
                                return { file: name, ...data };
                            } catch {
                                return { file: name, retired: true };
                            }
                        });
                });
        console.error(
            JSON.stringify({ error: error.message, ...diagnostics }).replace(
                /https?:\/\/[^\s"\\]+/g,
                "[redacted-url]"
            )
        );
        process.exitCode = 1;
    })
    .finally(async () => {
        if (browser) await browser.close();
        if (worker && worker.exitCode === null) {
            worker.kill("SIGTERM");
            await Promise.race([
                new Promise((resolve) => worker.once("exit", resolve)),
                new Promise((resolve) => setTimeout(resolve, 7000)),
            ]);
        }
        if (front) {
            front.closeAllConnections();
            await new Promise((resolve) => front.close(resolve));
        }
        if (source) {
            source.closeAllConnections();
            await new Promise((resolve) => source.close(resolve));
        }
        const sessions = path.join(directory, "sessions");
        if (fs.existsSync(sessions))
            assert.equal(
                fs
                    .readdirSync(sessions)
                    .filter((id) =>
                        fs.statSync(path.join(sessions, id)).isDirectory()
                    ).length,
                0,
                "gateway shutdown must clean its sessions"
            );
        fs.rmSync(directory, { force: true, recursive: true });
        if (!process.exitCode && result) console.log(JSON.stringify(result));
    });
