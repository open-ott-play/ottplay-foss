const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const vm = require("node:vm");
const { spawn } = require("node:child_process");
const { test } = require("node:test");
const {
    CLASSIC_PROVIDER_BUNDLES,
    CLASSIC_OPTIONAL_BUNDLES,
} = require("../scripts/classic-bundle.cjs");
const {
    advanceNativePlayback,
    captureOwnedImage,
    cases,
    nativeChannelIds,
    nativeStartupUrl,
    nativeSourceAttached,
    nativePlaybackSample,
    pageStartupDiagnostic,
    redactDiagnosticText,
    removeOwnedImages,
    saveNativeFill,
    validateCaptureInterval,
    validateNativeSelection,
} = require("../scripts/check-windows-video-geometry.cjs");
require("./test_native_hls_fixture.cjs");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("native startup URL binds the exact case and engine without a second navigation", () => {
    for (const [engine, query] of [
        ["html5", "html5"],
        ["hls.js", "hls"],
    ]) {
        const url = new URL(
            nativeStartupUrl("http://127.0.0.1:8443", "abcdef1234", engine)
        );
        assert.equal(url.pathname, "/index.html");
        assert.deepEqual(
            [...url.searchParams],
            [
                ["nativecase", "abcdef1234"],
                ["nativeengine", query],
            ]
        );
    }
    for (const [origin, id, engine] of [
        ["https://foreign.invalid", "abcdef1234", "hls.js"],
        ["http://127.0.0.1:8443", "abcdef1234&nativeengine=hls", "html5"],
        ["http://127.0.0.1:8443", "abcdef1234", undefined],
    ])
        assert.throws(
            () => nativeStartupUrl(origin, id, engine),
            /Invalid owned/
        );
    assert.throws(
        () => validateNativeSelection({}, {}, null, "cold"),
        /explicit fixture engine/
    );
});

test("HLS readiness waits safely before the backend and engine attachment exist", () => {
    const expected = "http://127.0.0.1:8443/owned.m3u8";
    let backend;
    const scope = {
        args: { engine: "hls.js", expected },
        window: { __ottCoreBackendPeek: () => backend },
    };
    const ready = () =>
        vm.runInNewContext(
            "(" + nativeSourceAttached.toString() + ")(args)",
            scope
        );
    for (const value of [undefined, null, {}, { current: () => null }]) {
        backend = value;
        assert.equal(ready(), false);
    }
    backend = { current: () => ({ diagnosticEngine: () => "hls.js" }) };
    assert.equal(ready(), false);
    backend.current = () => ({
        diagnosticEngine: () => "hls.js",
        diagnosticMedia: () => ({ hls: { url: expected } }),
    });
    assert.equal(ready(), true);
    scope.args.expected += "-replacement";
    assert.equal(ready(), false);
});

test("capture subprocess failures retain cleanup ownership and preserve preexisting files", () => {
    const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), "native-capture-cleanup-")
    );
    const image = path.join(directory, "owned.bmp");
    const owned = [];
    try {
        assert.throws(
            () =>
                captureOwnedImage(image, owned, 123, () => {
                    fs.writeFileSync(image, "temporary screen pixels", {
                        flag: "wx",
                    });
                    return JSON.parse(
                        "invalid subprocess JSON after image write"
                    );
                }),
            SyntaxError
        );
        assert.deepEqual(owned, [image]);
        assert.equal(fs.existsSync(image), true);
        removeOwnedImages(owned);
        assert.equal(fs.existsSync(image), false);
        fs.writeFileSync(image, "preexisting must survive", { flag: "wx" });
        const unowned = [];
        assert.throws(
            () =>
                captureOwnedImage(image, unowned, 123, () => {
                    throw new Error(
                        "Must not invoke capture for an existing output"
                    );
                }),
            /existing file was preserved/
        );
        removeOwnedImages(unowned);
        assert.equal(
            fs.readFileSync(image, "utf8"),
            "preexisting must survive"
        );
    } finally {
        fs.rmSync(directory, { force: true, recursive: true });
    }
});

test("capture guard rejects a later same-color cycle and slow or reversed intervals", () => {
    validateCaptureInterval(0.5, 0.7, 0);
    validateCaptureInterval(2.0, 2.2, 1);
    for (const args of [
        [0.5, 3.5, 0],
        [1.95, 5.0, 1],
        [3.5, 3.6, 0],
        [2.0, 3.0, 1],
        [0.7, 0.5, 0],
        [NaN, 0.5, 0],
    ])
        assert.throws(
            () => validateCaptureInterval(...args),
            /absolute initial phase/
        );
});

test("native matrix includes exact locked/unlocked starts and all one-pixel controls", () => {
    const matrix = cases();
    const mp4 = matrix.filter((item) => item.engine === "html5");
    const hls = matrix.filter((item) => item.engine === "hls.js");
    assert.equal(mp4.length, 16);
    assert.equal(hls.length, 8);
    assert.equal(matrix.length, 24);
    assert.equal(mp4.filter((item) => item.lock).length, 3);
    assert.equal(hls.filter((item) => item.lock).length, 3);
    for (const [width, height] of [
        [800, 450],
        [1280, 720],
    ]) {
        assert.deepEqual(
            mp4
                .filter((x) => x.width === width && x.height === height)
                .map((x) => x.lock),
            [false, true]
        );
        for (const [w, h] of [
            [width - 1, height],
            [width + 1, height],
            [width, height - 1],
            [width, height + 1],
        ])
            assert.deepEqual(
                mp4.filter((x) => x.width === w && x.height === h),
                [{ engine: "html5", height: h, lock: false, width: w }]
            );
    }
    assert.deepEqual(
        mp4.filter((x) => x.width === 802 && x.height === 451),
        [false, true].map((lock) => ({
            engine: "html5",
            height: 451,
            lock,
            width: 802,
        }))
    );
    for (const [width, height] of [
        [800, 452],
        [802, 450],
    ])
        assert.deepEqual(
            mp4.filter((x) => x.width === width && x.height === height),
            [{ engine: "html5", height, lock: false, width }]
        );
    assert.deepEqual(
        hls.map(({ engine, width, height, lock }) => ({
            engine,
            height,
            lock,
            width,
        })),
        [
            { engine: "hls.js", height: 450, lock: false, width: 800 },
            { engine: "hls.js", height: 450, lock: true, width: 800 },
            { engine: "hls.js", height: 451, lock: false, width: 802 },
            { engine: "hls.js", height: 451, lock: true, width: 802 },
            { engine: "hls.js", height: 720, lock: false, width: 1280 },
            { engine: "hls.js", height: 720, lock: true, width: 1280 },
            { engine: "hls.js", height: 451, lock: false, width: 800 },
            { engine: "hls.js", height: 721, lock: false, width: 1280 },
        ]
    );
    assert.equal(matrix.length * 2 * 3 * 2, 288);
});

function playbackFixture() {
    const urls = {
        standard: "http://127.0.0.1/standard.mp4",
        wide: "http://127.0.0.1/wide.mp4",
    };
    const calls = [];
    const saved = new Map();
    let ownerId = 1;
    const state = {
        generation: 1,
        target: { channelId: "11", kind: "live", sourceId: "owned-fixture" },
    };
    const video = {
        currentSrc: urls.wide,
        currentTime: 0.5,
        getBoundingClientRect: () => ({ height: 450, width: 800, x: 0, y: 0 }),
        getVideoPlaybackQuality: () => ({ totalVideoFrames: 6 }),
    };
    const forbidden = () => {
        throw new Error("Artificial layout repair");
    };
    const w = {
        __nativeGeometryRetained: video,
        __ottChannels: {
            capturePreference(name, id) {
                assert.equal(name, "aAspects");
                assert.ok([11, 22].includes(id));
                return {
                    active: () => true,
                    get: () => saved.get(id),
                    saved: () => saved.get(id),
                    set(value) {
                        saved.set(id, value);
                        return true;
                    },
                };
            },
        },
        __ottClassicPlayback: {
            context: () => ({ isCurrentBackend: () => true }),
            snapshot: () => state,
        },
        __ottCoreBackendPeek: () => ({
            current: () => ({
                active: () => true,
                diagnosticEngine: () => "html5",
                diagnosticMedia: () => ({ hls: null, media: video }),
                id: ownerId,
            }),
        }),
        captureAspectTarget: () => ({
            current: () => true,
            mode: saved.get(w.curList[w.primaryIndex]) === 1 ? "fill" : "fit",
            savedMode:
                saved.get(w.curList[w.primaryIndex]) === 1 ? "fill" : null,
            set: forbidden,
        }),
        channels: {
            11: { channel_name: "Native geometry wide" },
            22: { channel_name: "Native geometry standard" },
        },
        closeList: forbidden,
        curList: [11, 22],
        isListVisible: false,
        primaryIndex: 0,
        setPlayerMode: forbidden,
        stbPlay(url) {
            calls.push(["play", url]);
            video.currentSrc = url;
            ownerId++;
        },
        stbStop: forbidden,
    };
    const scope = {
        document: { querySelector: () => video },
        innerHeight: 450,
        innerWidth: 800,
        window: w,
    };
    const page = {
        evaluate(fn, args) {
            scope.args = args;
            return vm.runInNewContext("(" + fn.toString() + ")(args)", scope);
        },
        keyboard: {
            press(key) {
                assert.equal(key, "Equal");
                calls.push(["key", key]);
                w.primaryIndex = 1 - w.primaryIndex;
                state.target.channelId = String(w.curList[w.primaryIndex]);
                state.generation++;
                ownerId++;
                video.currentSrc = w.primaryIndex ? urls.standard : urls.wide;
            },
        },
    };
    return { calls, page, saved, state, urls, video, w };
}

test("native transitions replay without layout repair and use a real channel key", async () => {
    const fixture = playbackFixture();
    const { page, urls } = fixture;
    assert.deepEqual(
        JSON.parse(JSON.stringify(await page.evaluate(nativeChannelIds))),
        { standard: 22, wide: 11 }
    );
    let prior = await page.evaluate(nativePlaybackSample);
    await advanceNativePlayback(page, "replay", urls.wide);
    let sample = await page.evaluate(nativePlaybackSample);
    validateNativeSelection(
        sample,
        { channelId: 11, engine: "html5", mode: "fit", url: urls.wide },
        prior,
        "replay"
    );
    prior = sample;
    await advanceNativePlayback(page, "channel-change", urls.standard);
    sample = await page.evaluate(nativePlaybackSample);
    validateNativeSelection(
        sample,
        { channelId: 22, engine: "html5", mode: "fit", url: urls.standard },
        prior,
        "channel-change"
    );
    await page.evaluate(saveNativeFill, [11, 22]);
    assert.deepEqual(
        [...fixture.saved],
        [
            [11, 1],
            [22, 1],
        ]
    );
    prior = sample;
    await advanceNativePlayback(page, "mode-change", urls.wide);
    sample = await page.evaluate(nativePlaybackSample);
    validateNativeSelection(
        sample,
        { channelId: 11, engine: "html5", mode: "fill", url: urls.wide },
        prior,
        "mode-change"
    );
    assert.deepEqual(fixture.calls, [
        ["play", urls.wide],
        ["key", "Equal"],
        ["key", "Equal"],
    ]);
});

test("media source alone cannot fake a channel selection or a new engine owner", async () => {
    const { page, state, urls, video, w } = playbackFixture();
    const prior = await page.evaluate(nativePlaybackSample);
    const expected = {
        channelId: 22,
        engine: "html5",
        mode: "fit",
        url: urls.standard,
    };
    video.currentSrc = urls.standard;
    assert.throws(
        () =>
            validateNativeSelection(
                page.evaluate(nativePlaybackSample),
                expected,
                prior,
                "channel-change"
            ),
        /channel, source or saved aspect/
    );
    w.primaryIndex = 1;
    assert.throws(
        () => page.evaluate(nativePlaybackSample),
        /selection or engine owner/
    );
    state.target.channelId = "22";
    state.generation++;
    assert.throws(
        () =>
            validateNativeSelection(
                page.evaluate(nativePlaybackSample),
                expected,
                prior,
                "channel-change"
            ),
        /did not replace the expected owner/
    );
    const sample = {
        ...page.evaluate(nativePlaybackSample),
        ownerId: prior.ownerId + 1,
    };
    validateNativeSelection(sample, expected, prior, "channel-change");
    assert.throws(
        () =>
            validateNativeSelection(
                { ...sample, generation: prior.generation },
                expected,
                prior,
                "channel-change"
            ),
        /did not replace/
    );
    assert.throws(
        () =>
            validateNativeSelection(
                { ...sample, sourceId: "other-provider" },
                expected,
                prior,
                "channel-change"
            ),
        /did not replace/
    );
    assert.throws(
        () =>
            validateNativeSelection(
                { ...sample, aspect: "fill", savedAspect: null },
                { ...expected, mode: "fill" },
                prior,
                "channel-change"
            ),
        /saved aspect/
    );
});

test("HLS acceptance requires the current MSE owner, manifest URL and blob media", () => {
    const manifest =
        "http://127.0.0.1:8443/__native_video_geometry/hls/wide/index.m3u8?case=abcdef1234";
    const valid = {
        aspect: "fit",
        channelId: 11,
        engine: "hls.js",
        generationMatchesBackend: true,
        mediaHlsUrl: manifest,
        mediaMatchesRetained: true,
        savedAspect: null,
        source: "blob:http://127.0.0.1:8443/owned-media-source",
    };
    validateNativeSelection(
        valid,
        { channelId: 11, engine: "hls.js", mode: "fit", url: manifest },
        null,
        "cold"
    );
    for (const invalid of [
        { ...valid, engine: "html5" },
        { ...valid, mediaMatchesRetained: false },
        { ...valid, mediaHlsUrl: manifest.replace("wide", "standard") },
        { ...valid, source: manifest },
        { ...valid, source: "blob:https://foreign.invalid/not-owned" },
    ])
        assert.throws(
            () =>
                validateNativeSelection(
                    invalid,
                    {
                        channelId: 11,
                        engine: "hls.js",
                        mode: "fit",
                        url: manifest,
                    },
                    null,
                    "cold"
                ),
            /channel, source or saved aspect/
        );
});

test("Fill preparation rejects a preference that did not reach durable storage", () => {
    const { page, w } = playbackFixture();
    const capture = w.__ottChannels.capturePreference;
    w.__ottChannels.capturePreference = (name, id) => ({
        ...capture(name, id),
        saved: () => undefined,
    });
    assert.throws(
        () => page.evaluate(saveNativeFill, [11, 22]),
        /persist.*Fill/
    );
});

test("failure summaries remove URL credentials and respect their output bound", () => {
    const failure = new Error(
        "Request https://person:private-password@private.invalid/path?token=private-key failed at D:\\a\\private\\client.js"
    );
    const output = redactDiagnosticText(failure.stack, 160);
    assert.ok(output.length <= 160);
    for (const privateValue of [
        "private-password",
        "private.invalid",
        "private-key",
        "D:\\a",
    ])
        assert.equal(output.includes(privateValue), false);
});

test("startup diagnostics retain fixture state without body, list or source secrets", async () => {
    const origin = "http://127.0.0.1:8443";
    const id = "abcdef1234";
    const secret = "do-not-publish-this-private-token";
    const source = origin + "/__native_video_geometry/wide.mp4?case=" + id;
    const launch = {
        getBoundingClientRect: () => ({ height: 450, width: 800 }),
        innerText:
            "Startup failed at https://private.invalid/path?token=" + secret,
    };
    const list = {
        getBoundingClientRect: () => ({ height: 300, width: 300 }),
        get innerText() {
            throw new Error("Do not collect list contents");
        },
    };
    const video = {
        currentSrc: "",
        currentTime: 0,
        error: null,
        getAttribute: () => source,
        networkState: 2,
        paused: true,
        readyState: 0,
        src: source,
        videoHeight: 0,
        videoWidth: 0,
    };
    const stored = new Map([
        ["ottplaylang", "_eng"],
        ["ottplayprov", "m3u"],
        [
            "m3um3uArr",
            JSON.stringify({
                active: 0,
                M3Us: [
                    {
                        www:
                            origin +
                            "/__native_video_geometry/channels.m3u?case=" +
                            id +
                            "&engine=html5",
                    },
                ],
            }),
        ],
    ]);
    const scope = {
        clearTimeout,
        document: {
            get body() {
                throw new Error("Do not collect page contents");
            },
            querySelector: (selector) =>
                selector === "#video"
                    ? video
                    : selector === "#launch"
                      ? launch
                      : selector === "#list"
                        ? list
                        : null,
            readyState: "complete",
            title: "Fixture",
            visibilityState: "visible",
        },
        getComputedStyle: () => ({
            display: "block",
            opacity: "1",
            visibility: "visible",
        }),
        localStorage: { getItem: (key) => stored.get(key) || null },
        location: {
            href: origin + "/index.html?nativecase=" + id,
            origin,
            pathname: "/index.html",
            search: "?nativecase=" + id,
        },
        performance: {
            getEntriesByType: () => [
                {
                    name: origin + "/asset.js?token=" + secret,
                    responseStatus: 404,
                },
                {
                    name: "https://private.invalid/" + secret,
                    responseStatus: 400,
                },
            ],
        },
        setTimeout,
        URL,
        URLSearchParams,
        window: {
            __nativeGeometryEvents: [
                {
                    kind: "loadstart",
                    source: "https://private.invalid/" + secret,
                },
            ],
            __ottActiveProviderDriver: { id: "m3u" },
            __ottStandby: {
                blocked: () => true,
                generation: () => 0,
                snapshot: () => ({ pending: null, state: "error" }),
            },
            cList: [],
            commandChannelsReady: false,
            ott_device: "pc",
            playerMode: 0,
        },
    };
    const page = {
        evaluate: (fn, args) => {
            scope.args = args;
            return vm.runInNewContext("(" + fn.toString() + ")(args)", scope);
        },
        isClosed: () => false,
    };
    const result = await pageStartupDiagnostic(page, origin, id);
    assert.equal(result.status, "captured");
    assert.equal(result.standby.blocked, true);
    assert.equal(result.runtime.seededM3uValid, true);
    const output = JSON.stringify(result);
    assert.equal(output.includes(secret), false);
    assert.equal(output.includes("private.invalid"), false);
    assert.equal(output.includes("visibleText"), false);
    assert.equal(output.includes(source), false);
});

test("first native media remains undecodable until owned cold-capture admission", {
    timeout: 10000,
}, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "native-video-server-"));
    fs.mkdirSync(path.join(root, "dist"));
    fs.writeFileSync(
        path.join(root, "index.html"),
        "<html><head></head><body></body></html>"
    );
    const scripts = [
        "player",
        ...Object.keys(CLASSIC_OPTIONAL_BUNDLES),
        ...Object.keys(CLASSIC_PROVIDER_BUNDLES).map(
            (name) => "provider-" + name
        ),
    ];
    for (const name of scripts)
        fs.writeFileSync(path.join(root, "dist", name + ".js"), "");
    const socket = net.createServer();
    await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
    const port = socket.address().port;
    await new Promise((resolve) => socket.close(resolve));
    const origin = "http://127.0.0.1:" + port;
    const child = spawn(
        process.execPath,
        [path.join(__dirname, "helpers/device-browser-server.cjs")],
        {
            env: {
                ...process.env,
                CI_BROWSER_WEB_ROOT: root,
                OTTP_DEVICE_TEST_PORT: String(port),
                OTTP_NATIVE_VIDEO_GEOMETRY: "1",
            },
            stdio: "ignore",
        }
    );
    const caseId = "abcdef1234";
    const hlsCaseId = "fedcba9876";
    try {
        let ready = false;
        for (let n = 0; n < 50; n++) {
            try {
                ready = (await fetch(origin + "/__device_test_health")).ok;
            } catch (_) {}
            if (ready) break;
            await pause(50);
        }
        assert.ok(ready, "owned fixture server must become ready");
        assert.equal((await fetch(origin + "/index.html")).status, 400);
        const guide = await fetch(
            origin + "/__native_video_geometry/guide.xml"
        );
        assert.equal(guide.status, 200);
        assert.equal(guide.headers.get("content-type"), "application/xml");
        const guideBody = await guide.text();
        assert.ok(guideBody.includes('<channel id="native-geometry">'));
        assert.ok(
            guideBody.includes(
                "<display-name>Native geometry fixture</display-name>"
            )
        );
        assert.equal(guideBody.includes("http:"), false);
        assert.equal(guideBody.includes("https:"), false);
        let bootResolved = false;
        const pendingPage = fetch(origin + "/index.html?nativecase=" + caseId, {
            signal: AbortSignal.timeout(5000),
        }).then(async (response) => {
            bootResolved = true;
            return response.text();
        });
        await pause(100);
        assert.equal(
            bootResolved,
            false,
            "startup must wait for cold CDP fencing"
        );
        await fetch(
            origin + "/__native_video_geometry/boot-admit?case=0000000000"
        );
        await pause(100);
        assert.equal(
            bootResolved,
            false,
            "another case cannot start this page"
        );
        assert.deepEqual(
            await (
                await fetch(
                    origin +
                        "/__native_video_geometry/boot-admit?case=" +
                        caseId
                )
            ).json(),
            { bootAdmitted: caseId }
        );
        const html = await pendingPage;
        const items = new Map();
        const scope = {
            document: { addEventListener() {} },
            localStorage: { setItem: (k, v) => items.set(k, v) },
            location: {
                href: origin + "/index.html?nativecase=" + caseId,
                origin,
            },
            URL,
            window: {},
        };
        // Extract our known generated bootstrap; this is not an HTML filter.
        const start = html.indexOf("<script>");
        const end = html.indexOf("</script>", start);
        assert.ok(start >= 0 && end > start, "generated bootstrap is present");
        vm.runInNewContext(html.slice(start + "<script>".length, end), scope);
        assert.equal(items.get("ottplayprov"), "m3u");
        assert.equal(items.get("m3usPlayers"), "0");
        assert.equal(items.get("sInfoSwitch"), "0");
        assert.equal(items.get("sInfoChange"), "0");
        const playlist = JSON.parse(items.get("m3um3uArr")).M3Us[0].www;
        const body = await (await fetch(playlist)).text();
        const sources = ["wide", "standard"];
        const media = body
            .trim()
            .split("\n")
            .filter((line) => !line.startsWith("#"));
        assert.deepEqual(
            media,
            sources.map(
                (source) =>
                    origin +
                    "/__native_video_geometry/" +
                    source +
                    ".mp4?case=" +
                    caseId
            )
        );
        for (const source of sources)
            assert.ok(
                body.includes("#EXTINF:-1,Native geometry " + source + "\n")
            );

        let hlsBootResolved = false;
        const hlsPendingPage = fetch(
            origin +
                "/index.html?nativecase=" +
                hlsCaseId +
                "&nativeengine=hls",
            { signal: AbortSignal.timeout(5000) }
        ).then(async (response) => {
            hlsBootResolved = true;
            return response.text();
        });
        await pause(100);
        assert.equal(hlsBootResolved, false);
        await fetch(
            origin + "/__native_video_geometry/boot-admit?case=" + hlsCaseId
        );
        const hlsHtml = await hlsPendingPage;
        const hlsItems = new Map();
        const hlsScope = {
            document: { addEventListener() {} },
            localStorage: { setItem: (k, v) => hlsItems.set(k, v) },
            location: {
                href:
                    origin +
                    "/index.html?nativecase=" +
                    hlsCaseId +
                    "&nativeengine=hls",
                origin,
            },
            URL,
            window: {},
        };
        const hlsStart = hlsHtml.indexOf("<script>");
        const hlsEnd = hlsHtml.indexOf("</script>", hlsStart);
        assert.ok(hlsStart >= 0 && hlsEnd > hlsStart);
        vm.runInNewContext(
            hlsHtml.slice(hlsStart + "<script>".length, hlsEnd),
            hlsScope
        );
        assert.equal(hlsItems.get("ottplayprov"), "m3u");
        assert.equal(hlsItems.get("m3usPlayers"), "1");
        assert.equal(
            JSON.parse(hlsItems.get("m3um3uArr")).M3Us[0].www,
            origin +
                "/__native_video_geometry/channels.m3u?case=" +
                hlsCaseId +
                "&engine=hls"
        );

        const hlsPlaylistUrl =
            origin +
            "/__native_video_geometry/channels.m3u?case=" +
            hlsCaseId +
            "&engine=hls";
        const hlsBody = await (await fetch(hlsPlaylistUrl)).text();
        const hlsUrls = hlsBody
            .trim()
            .split("\n")
            .filter((line) => !line.startsWith("#"));
        assert.deepEqual(
            hlsUrls,
            sources.map(
                (source) =>
                    origin +
                    "/__native_video_geometry/hls/" +
                    source +
                    "/index.m3u8?case=" +
                    hlsCaseId
            )
        );
        const hlsManifest = await fetch(hlsUrls[0]);
        assert.equal(hlsManifest.status, 200);
        assert.match(
            hlsManifest.headers.get("content-type"),
            /application\/vnd\.apple\.mpegurl/
        );
        const hlsText = await hlsManifest.text();
        const hlsMediaUrls = [
            origin +
                "/__native_video_geometry/hls/wide/init.mp4?case=" +
                hlsCaseId,
            origin +
                "/__native_video_geometry/hls/wide/segment000.m4s?case=" +
                hlsCaseId,
            origin +
                "/__native_video_geometry/hls/wide/segment007.m4s?case=" +
                hlsCaseId,
        ];
        assert.ok(hlsText.includes('#EXT-X-MAP:URI="' + hlsMediaUrls[0] + '"'));
        for (let segment = 0; segment < 8; segment++)
            assert.ok(
                hlsText.includes(
                    origin +
                        "/__native_video_geometry/hls/wide/segment" +
                        String(segment).padStart(3, "0") +
                        ".m4s?case=" +
                        hlsCaseId
                )
            );
        assert.equal(/(?:https?:\/\/)(?!127\.0\.0\.1)/.test(hlsText), false);
        assert.equal(hlsText.includes("../"), false);
        assert.equal(
            (
                await fetch(
                    origin + "/__native_video_geometry/hls/wide/index.m3u8"
                )
            ).status,
            400
        );
        assert.equal(
            (
                await fetch(
                    origin +
                        "/__native_video_geometry/hls/%2e%2e%2fwide/init.mp4?case=" +
                        hlsCaseId
                )
            ).status,
            404
        );
        const hlsResolved = [];
        const expectedHls = hlsMediaUrls.map((mediaUrl, index) =>
            fetch(mediaUrl, { signal: AbortSignal.timeout(5000) }).then(
                async (r) => {
                    hlsResolved.push(index);
                    assert.equal(r.status, 200);
                    return Buffer.from(await r.arrayBuffer());
                }
            )
        );
        const wrongCaseController = new AbortController();
        let wrongCaseResolved = false;
        const wrongCase = fetch(
            origin +
                "/__native_video_geometry/hls/wide/segment001.m4s?case=" +
                caseId,
            { signal: wrongCaseController.signal }
        ).then((r) => {
            wrongCaseResolved = true;
            return r.arrayBuffer();
        });
        wrongCase.catch(() => {});
        await pause(150);
        assert.deepEqual(hlsResolved, []);
        assert.equal(wrongCaseResolved, false);
        await fetch(origin + "/__native_video_geometry/admit?case=0000000000");
        await pause(100);
        assert.deepEqual(hlsResolved, []);
        await fetch(
            origin + "/__native_video_geometry/admit?case=" + hlsCaseId
        );
        const receivedHls = await Promise.all(expectedHls);
        const hlsRoot = path.join(
            __dirname,
            "fixtures/windows-video-geometry/hls/wide"
        );
        for (const [index, filename] of [
            "init.mp4",
            "segment000.m4s",
            "segment007.m4s",
        ].entries())
            assert.deepEqual(
                receivedHls[index],
                fs.readFileSync(path.join(hlsRoot, filename))
            );
        await pause(100);
        assert.equal(
            wrongCaseResolved,
            false,
            "only the exact HLS fixture case may release init or media bytes"
        );
        wrongCaseController.abort();
        await assert.rejects(wrongCase, { name: "AbortError" });
        assert.equal(
            (await fetch(origin + "/__native_video_geometry/wide.mp4")).status,
            400
        );
        const resolved = [];
        const pending = media.map((url, index) =>
            fetch(url, {
                signal: AbortSignal.timeout(5000),
            }).then(async (r) => {
                resolved.push(index);
                return Buffer.from(await r.arrayBuffer());
            })
        );
        await pause(150);
        assert.equal(
            resolved.length,
            0,
            "neither fixture channel may decode before admission"
        );
        await fetch(origin + "/__native_video_geometry/admit?case=0000000000");
        await pause(150);
        assert.equal(
            resolved.length,
            0,
            "another process case must not admit this first frame"
        );
        assert.deepEqual(
            await (
                await fetch(
                    origin + "/__native_video_geometry/admit?case=" + caseId
                )
            ).json(),
            { admitted: caseId }
        );
        const received = await Promise.all(pending);
        for (const [index, source] of sources.entries())
            assert.deepEqual(
                received[index],
                fs.readFileSync(
                    path.join(
                        __dirname,
                        "fixtures/windows-video-geometry/" + source + ".mp4"
                    )
                )
            );
    } finally {
        const exited = new Promise((resolve) => child.once("exit", resolve));
        child.kill();
        await exited;
        fs.rmSync(root, { force: true, recursive: true });
    }
});
