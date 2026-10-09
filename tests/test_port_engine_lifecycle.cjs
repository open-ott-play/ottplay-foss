const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const source = [
    "src/plugins/access-media.ts",
    "src/core/native-hls.ts",
    "src/core/index.ts",
]
    .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
    .join("\n");
const core = ts
    .transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.ES2015,
            target: ts.ScriptTarget.ES5,
        },
    })
    .outputText.replace(/^import .*\n/gm, "")
    .replace(/^export /gm, "");
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
    });
    promise.catch(() => {});
    return { promise, reject, resolve };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
function media() {
    const listeners = {};
    let src = "",
        time = 0;
    return {
        addEventListener(name, cb) {
            (listeners[name] ||= []).push(cb);
        },
        canPlayType() {
            return "probably";
        },
        get currentTime() {
            return time;
        },
        set currentTime(value) {
            if (this.blockEarlySeek && this.readyState === 0)
                throw new Error("InvalidStateError");
            time = value;
        },
        listeners,
        metadata() {
            this.readyState = 1;
            for (const cb of [...(listeners.loadedmetadata || [])]) cb();
        },
        pause() {
            this.paused = true;
        },
        paused: true,
        play() {
            this.playCalls++;
            this.paused = false;
        },
        playCalls: 0,
        readyState: 0,
        removeAttribute(name) {
            if (name === "src") this.src = "";
        },
        removeEventListener(name, cb) {
            listeners[name] = (listeners[name] || []).filter((x) => x !== cb);
        },
        get src() {
            return src;
        },
        set src(value) {
            src = value;
            time = 0;
            this.readyState = 0;
        },
    };
}
function fixture() {
    const styles = {};
    const players = [],
        shakas = [],
        errors = [],
        boxes = [],
        hidden = [];
    function Hls() {
        this.events = {};
        this.levels = [];
        this.audioTracks = [{ name: "A" }];
        this.subtitleTracks = [];
        this.audioTrack = 0;
        this.destroyCalls = 0;
        players.push(this);
    }
    Hls.Events = {
        AUDIO_TRACKS_UPDATED: "audio",
        ERROR: "error",
        MANIFEST_PARSED: "manifest",
        SUBTITLE_TRACKS_UPDATED: "subtitles",
    };
    Hls.ErrorTypes = { MEDIA_ERROR: "media", NETWORK_ERROR: "network" };
    Hls.isSupported = () => true;
    Hls.prototype.on = function (name, cb) {
        this.events[name] = cb;
    };
    Hls.prototype.loadSource = function (url) {
        this.url = url;
    };
    Hls.prototype.attachMedia = function (m) {
        this.media = m;
    };
    Hls.prototype.destroy = function () {
        this.destroyCalls++;
        if (this.media) this.media.src = "";
    };
    Hls.prototype.recoverMediaError = function () {};
    Hls.prototype.removeLevel = function (i) {
        this.removed = i;
    };
    Hls.prototype.startLoad = function () {};
    function Shaka(m) {
        this.media = m;
        this.attached = deferred();
        this.loaded = deferred();
        this.destroyed = deferred();
        this.destroyCalls = 0;
        shakas.push(this);
    }
    Shaka.isBrowserSupported = () => true;
    Shaka.prototype.attach = function (media) {
        this.media = media;
        return this.attached.promise;
    };
    Shaka.prototype.load = function (url, position) {
        this.url = url;
        this.position = position;
        return this.loaded.promise;
    };
    Shaka.prototype.destroy = function () {
        this.destroyCalls++;
        return this.destroyed.promise;
    };
    const w = {
        _: (s) => s,
        $: (selector) => ({
            css(values) {
                Object.assign((styles[selector] ||= {}), values);
            },
            hide() {
                hidden.push(selector);
            },
            html() {},
            show() {},
        }),
        applyChannelPreference() {},
        clearInterval,
        clearTimeout,
        console: {
            error(...args) {
                errors.push(args);
            },
            log() {},
            warn() {},
        },
        document: { body: { style: {} } },
        Hls,
        innerHeight: 720,
        innerWidth: 1280,
        Map: undefined,
        // Mode A must still run without the ES2015 Promise constructor.
        Promise: undefined,
        Set: undefined,
        saveChannelPreference() {},
        setInterval,
        setTimeout,
        shaka: { Player: Shaka },
        showSelectBox(...args) {
            boxes.push(args);
        },
        showShift() {},
    };
    w.window = w;
    vm.createContext(w);
    require("./helpers/shared-core-runtime.cjs")(w);
    vm.runInContext(core, w);
    w.video = media();
    w.videoPip = media();
    return { boxes, errors, hidden, players, shakas, styles, w };
}
const cases = [];
function test(name, fn) {
    cases.push([name, fn]);
}
test("HLS same-track restoration and unavailable native track APIs", () => {
    const { w, boxes } = fixture();
    w.playerMode = 1;
    w.stbPlay("a.m3u8");
    w.setAudioTrack(0);
    w.stbStop();
    w.setAudioTrack(0);
    w.setSubtitleTrack(0);
    assert.equal(w.stbSubtitleExists(), 0);
    w.stbToggleAudioTrack();
    assert.equal(boxes.at(-1)[1][0], "Not found");
    w.stbToggleSubtitle();
});
test("HLS restores late subtitle lists only for the current stream", () => {
    const { w, players } = fixture();
    let restorations = 0;
    w.applyChannelPreference = (name, callback) => {
        if (name === "aSubs") {
            restorations++;
            callback(2);
        }
    };
    w.playerMode = 1;
    w.stbPlay("a.m3u8");
    const old = players[0];
    old.events.subtitles();
    assert.equal(old.subtitleTrack, 1);
    w.stbPlay("b.m3u8");
    const count = restorations;
    old.events.subtitles();
    assert.equal(restorations, count);
    players[1].events.subtitles();
    assert.equal(restorations, count + 1);
    assert.equal(players[1].subtitleTrack, 1);
});
test("native late-track listeners belong to their engine lease", () => {
    const { w } = fixture();
    const listeners = [];
    w.video.textTracks = {
        addEventListener(name, callback) {
            assert.equal(name, "addtrack");
            listeners.push(callback);
        },
        length: 0,
        removeEventListener(name, callback) {
            listeners.splice(listeners.indexOf(callback), 1);
        },
    };
    let restores = 0;
    w.applyChannelPreference = (name) => {
        if (name === "aSubs") restores++;
    };
    w.playerMode = 0;
    w.stbPlay("a.mp4");
    assert.equal(listeners.length, 1);
    const old = listeners[0];
    old();
    assert.equal(restores, 1);
    w.stbPlay("b.mp4");
    assert.equal(listeners.length, 1, "replacement removes old listener");
    old();
    assert.equal(restores, 1, "retained callback has no authority");
    listeners[0]();
    assert.equal(restores, 2);
    w.stbStop();
    assert.equal(listeners.length, 0);
});
test("main engine restores aspect before metadata, including the next video", () => {
    const { w, styles } = fixture();
    w.document.getElementById = () => null;
    w.document.body.classList = { add() {}, remove() {} };
    let saved = 1;
    w.applyChannelPreference = (name, callback) => {
        if (name === "aAspects") callback(saved);
    };
    w.stbPlay("first.mp4");
    assert.equal(w.video.readyState, 0);
    assert.equal(styles["#video"]["object-fit"], "cover");
    saved = 0;
    w.stbPlay("second.mp4");
    assert.equal(w.video.readyState, 0);
    assert.equal(styles["#video"]["object-fit"], "contain");
    w.stbStop();
});
test("PiP starts after manifest and ignores callbacks after switch/stop", () => {
    const { w, players, hidden } = fixture();
    w.playerMode = 1;
    w.stbPlayPip("a.m3u8");
    assert.equal(
        w.videoPip.playCalls,
        0,
        "HLS PiP must wait for attachment/manifest"
    );
    players[0].events.manifest();
    assert.equal(w.videoPip.playCalls, 1);
    w.playerMode = 0;
    w.stbPlayPip("b.mp4");
    assert.equal(players[0].destroyCalls, 1);
    players[0].events.manifest();
    assert.equal(w.videoPip.playCalls, 2);
    w.stbStopPip();
    w.stbStopPip();
    assert.equal(players[0].destroyCalls, 1);
    assert.equal(w.videoPip.src, "");
    assert.ok(hidden.includes("#pip_buffering"));
});
test("native PiP fallback keeps source identity and uses the prepared transport", () => {
    const { w } = fixture();
    const source = "https://source.invalid/protected.m3u8";
    const local =
        "http://127.0.0.1:12345/access/" +
        "a".repeat(43) +
        "/fixture/media.m3u8";
    let original;
    w.playerMode = 0;
    w.__ottCoreTransport.configure({
        pip: {
            open(request, fallback) {
                original = request;
                return fallback(local);
            },
        },
    });
    w.stbPlayPip(source);
    assert.equal(original.url, source);
    assert.equal(w.videoPip.src, local);
    assert.equal(w.videoPip.playCalls, 1);
    w.stbStopPip();
    assert.equal(w.videoPip.src, "");
    assert.equal(w.videoPip.paused, true);
});
test("PiP loader stays compact and centered through size, corner and canvas changes", () => {
    const { w, styles } = fixture();
    const presets = [
        [256, 144],
        [384, 216],
        [512, 288],
    ];
    function rectangle(style) {
        const width = parseFloat(style.width);
        const height = parseFloat(style.height);
        assert.notEqual(style.left === "auto", style.right === "auto");
        assert.notEqual(style.top === "auto", style.bottom === "auto");
        return {
            height,
            width,
            x:
                style.left === "auto"
                    ? w.innerWidth - parseFloat(style.right) - width
                    : parseFloat(style.left),
            y:
                style.top === "auto"
                    ? w.innerHeight - parseFloat(style.bottom) - height
                    : parseFloat(style.top),
        };
    }
    function near(actual, expected, message) {
        assert.ok(Math.abs(actual - expected) < 0.000001, message);
    }
    w.playerMode = 0;
    w.stbPlayPip("preview.mp4");
    assert.equal(styles["#pip_buffering"].width, "30px");
    for (const [width, height] of [
        [1280, 720],
        [1920, 1080],
        [640, 360],
        [1024, 768],
        [720, 1280],
    ]) {
        w.innerWidth = width;
        w.innerHeight = height;
        const scale = Math.min(width / 1280, height / 720);
        for (let size = 0; size < presets.length; size++) {
            // Retain the prior CSS between opposite-corner transitions.
            for (const corner of [0, 2, 1, 3, 0]) {
                w.sPipSize = String(size);
                w.sPipPos = String(corner);
                w.setPipPosition();
                const videoStyle = styles["#videopip"];
                const loaderStyle = styles["#pip_buffering"];
                const videoRect = rectangle(videoStyle);
                const loaderRect = rectangle(loaderStyle);
                near(videoRect.width, presets[size][0] * scale, "PiP width");
                near(videoRect.height, presets[size][1] * scale, "PiP height");
                near(loaderRect.width, 30 * scale, "compact loader width");
                near(loaderRect.height, 30 * scale, "compact loader height");
                near(
                    loaderRect.x + loaderRect.width / 2,
                    videoRect.x + videoRect.width / 2,
                    "loader centered horizontally"
                );
                near(
                    loaderRect.y + loaderRect.height / 2,
                    videoRect.y + videoRect.height / 2,
                    "loader centered vertically"
                );
                for (const side of ["left", "right", "top", "bottom"])
                    assert.equal(
                        loaderStyle[side] === "auto",
                        videoStyle[side] === "auto",
                        "clear the opposite " + side + " edge"
                    );
            }
        }
    }
});
test("native Shaka awaits attach and ignores a stopped attachment", async () => {
    const { w, shakas } = fixture();
    w.__ottNativeRuntime = true;
    w.playerMode = 2;
    w.stbPlay("native.mpd", 12);
    assert.equal(shakas[0].media, w.video);
    assert.equal(shakas[0].url, undefined, "load waits for attach");
    shakas[0].attached.resolve();
    await tick();
    assert.equal(shakas[0].url, "native.mpd");
    assert.equal(shakas[0].position, 12);
    w.stbStop();
    shakas[0].loaded.resolve();
    shakas[0].destroyed.resolve();
    await tick();
    w.stbPlay("stopped.mpd");
    w.stbStop();
    shakas[1].attached.resolve();
    await tick();
    assert.equal(
        shakas[1].url,
        undefined,
        "late attach cannot revive stopped stream"
    );
    assert.equal(w.video.playCalls, 0);
});

test("Shaka owns load position, respects late pause and releases before the next engine", async () => {
    const { w, shakas } = fixture();
    w.playerMode = 2;
    w.stbPlay("a.mpd", 43);
    assert.equal(shakas[0].position, 43);
    assert.equal(w.video.playCalls, 0);
    w.stbPause();
    shakas[0].loaded.resolve();
    await tick();
    assert.equal(w.video.playCalls, 0);
    w.stbContinue();
    assert.equal(w.video.playCalls, 1);
    w.playerMode = 0;
    w.stbPlay("b.mp4");
    assert.equal(shakas[0].destroyCalls, 1);
    assert.notEqual(w.video.src, "b.mp4", "await asynchronous Shaka detach");
    assert.equal(
        w.video.listeners.playing.length,
        0,
        "replacement must not observe the retiring decoder"
    );
    const pending = w.__ottCoreBackend().current();
    assert.equal(pending.snapshot().phase, "loading");
    w.stbPlay("c.mp4");
    shakas[0].destroyed.resolve();
    await tick();
    assert.equal(w.video.src, "c.mp4");
    assert.equal(
        w.video.listeners.playing.length,
        1,
        "only the attached replacement owns observations"
    );
    assert.equal(pending.active(), false);
    assert.equal(w.video.playCalls, 2);
});
test("Shaka late load/rejection cannot resurrect stopped playback", async () => {
    const { w, shakas, errors } = fixture();
    w.playerMode = 2;
    w.stbPlay("a.mpd");
    w.stbStop();
    assert.equal(shakas[0].destroyCalls, 1);
    shakas[0].loaded.resolve();
    shakas[0].destroyed.resolve();
    await tick();
    assert.equal(w.video.playCalls, 0);
    w.stbPlay("bad.mpd");
    shakas[1].loaded.reject(new Error("manifest failed"));
    await tick();
    assert.equal(w.video.playCalls, 0);
    assert.equal(errors.length, 1);
});
for (const mode of [0, 1, 2]) {
    for (const deferredSource of [false, true]) {
        test(
            "paused restart permits first native Play: engine " +
                mode +
                ", deferred source " +
                deferredSource,
            async () => {
                const { w, players, shakas } = fixture();
                const prepared = [];
                const state = {
                    generation: 1,
                    position: 8,
                    target: { kind: "vod" },
                };
                w.__ottClassicPlayback = {
                    command(value) {
                        if (value.type === "position")
                            state.position = value.position;
                    },
                    context: () => ({
                        isCurrentBackend: () => true,
                        isCurrentSource: () => true,
                    }),
                    snapshot: () => state,
                };
                w.playerMode = mode;
                w.__ottNativeRuntime = true;
                if (deferredSource)
                    w.__ottCoreTransport.configure({
                        prepareSource(_url, ready) {
                            prepared.push(ready);
                            return () => {};
                        },
                    });
                async function finishStartup(index) {
                    if (mode === 2 && index) {
                        shakas[index - 1].destroyed.resolve();
                        await tick();
                    }
                    if (deferredSource) prepared[index]("prepared.mp4");
                    if (mode === 1) players[index].events.manifest();
                    if (mode === 2) {
                        shakas[index].attached.resolve();
                        await tick();
                        shakas[index].loaded.resolve();
                        await tick();
                    }
                }
                function nativePlay() {
                    w.video.play();
                    for (const listener of [...w.video.listeners.playing])
                        listener();
                }
                const backend = w.__ottCoreBackend();
                backend.open({ url: "movie.mp4" });
                await finishStartup(0);
                w.video.readyState = 2;
                w.video.currentTime = 8;
                for (const listener of [...w.video.listeners.playing])
                    listener();
                backend.current().pause();
                const plays = w.video.playCalls;
                w.video.autoplay = true;
                assert.equal(backend.restart().paused, true);
                assert.equal(
                    w.forcePlay,
                    false,
                    "pause intent precedes asynchronous startup"
                );
                assert.equal(
                    w.video.autoplay,
                    false,
                    "the reflected native autoplay attribute is disabled"
                );
                await finishStartup(1);
                w.video.metadata();
                w.video.readyState = 2;
                assert.equal(w.video.paused, true);
                assert.equal(
                    w.video.playCalls,
                    plays,
                    "neither source preparation nor decoder ready may play"
                );
                assert.equal(backend.current().snapshot().phase, "paused");
                nativePlay();
                assert.equal(
                    w.video.paused,
                    false,
                    "first native Play is not mistaken for delayed autoplay"
                );
                assert.equal(backend.current().snapshot().phase, "playing");
                backend.current().pause();
                backend.current().resume();
                assert.equal(
                    w.forcePlay,
                    true,
                    "explicit backend resume still owns autoplay intent"
                );
                assert.equal(w.video.paused, false);
                backend.dispose();
                shakas.forEach((player) => player.destroyed.resolve());
            }
        );
    }
}
test("native and HLS recovery preserve seek on engines rejecting pre-metadata currentTime", () => {
    const { w, players } = fixture();
    w.video.blockEarlySeek = true;
    w.stbPlay("archive.mp4", 37);
    w.stbPause();
    w.video.metadata();
    assert.equal(w.video.currentTime, 37);
    assert.equal(w.video.paused, true);
    w.playerMode = 1;
    w.stbPlay("archive.m3u8", 54);
    players[0].events.manifest();
    w.video.metadata();
    assert.equal(w.video.currentTime, 54);
    w.video.currentTime = 73;
    w.stbPause();
    const fatal = { details: "bufferAppendError", fatal: true, type: "media" };
    players[0].events.error(null, fatal);
    players[0].events.error(null, fatal);
    w.video.metadata();
    assert.equal(w.video.currentTime, 73);
    assert.equal(w.video.paused, true);
    w.playerMode = 0;
    w.stbPlay("old.mp4", 88);
    const stale = [...w.video.listeners.loadedmetadata];
    w.stbPlay("new.mp4", 12);
    for (const cb of stale) cb();
    w.video.metadata();
    assert.equal(w.video.currentTime, 12);
});
test("iOS source login cannot replace a newer channel or revive stopped playback", async () => {
    const { w } = fixture();
    const first = deferred(),
        second = deferred(),
        stopped = deferred();
    const pending = [first, second, stopped];
    const prepared = [],
        cancelled = [];
    w.__ottCoreTransport.configure({ prepareSource: w.prepareAccessMedia });
    w.Capacitor = {
        getPlatform: () => "ios",
        Plugins: {
            AccessMedia: {
                cancelPrepare: ({ requestId }) => {
                    cancelled.push(requestId);
                    return Promise.resolve();
                },
                prepare: ({ requestId }) => {
                    prepared.push(requestId);
                    return pending.shift().promise;
                },
            },
        },
    };
    const local =
        "http://127.0.0.1:12345/access/" +
        "a".repeat(43) +
        "/fixture/media.m3u8";
    w.stbPlay("https://source.invalid/old.m3u8");
    w.stbPlay("https://source.invalid/new.m3u8", 12);
    assert.deepEqual(cancelled, [prepared[0]]);
    assert.notEqual(prepared[0], prepared[1]);
    first.resolve({ url: local + "old" });
    await tick();
    assert.equal(w.video.playCalls, 0);
    second.resolve({ url: local });
    await tick();
    assert.equal(w.video.src, local);
    assert.equal(w.video.playCalls, 1);
    w.stbPlay("https://source.invalid/stopped.m3u8");
    w.stbStop();
    assert.deepEqual(
        cancelled,
        [prepared[0], prepared[2]],
        "only unfinished preparation is cancelled"
    );
    stopped.resolve({ url: local });
    await tick();
    assert.equal(w.video.playCalls, 1);
});
for (const behavior of [
    "missing",
    "nonfunction",
    "throw",
    "empty",
    "reject",
    "getter",
]) {
    test(`iOS source cancellation tolerates ${behavior} optional bridge`, async () => {
        for (const settled of [false, true]) {
            const { w } = fixture();
            const pending = deferred();
            let calls = 0;
            let ready = 0;
            let failed = 0;
            const plugin = { prepare: () => pending.promise };
            if (behavior === "getter")
                Object.defineProperty(plugin, "cancelPrepare", {
                    get() {
                        throw new Error("bridge unavailable");
                    },
                });
            else if (behavior === "nonfunction") plugin.cancelPrepare = true;
            else if (behavior !== "missing")
                plugin.cancelPrepare = function () {
                    assert.equal(this, plugin);
                    calls++;
                    if (behavior === "throw")
                        throw new Error("bridge unavailable");
                    if (behavior === "reject")
                        return Promise.reject(new Error("unsupported"));
                };
            w.Capacitor = {
                getPlatform: () => "ios",
                Plugins: { AccessMedia: plugin },
            };
            const source = "https://source.invalid/live.m3u8";
            const cancel = w.prepareAccessMedia(
                source,
                () => ready++,
                () => failed++
            );
            assert.equal(typeof cancel, "function");
            if (settled) {
                pending.resolve({ url: source });
                await tick();
            }
            assert.doesNotThrow(() => {
                cancel();
                cancel();
            });
            pending.resolve({ url: source });
            await tick();
            assert.equal(ready, settled ? 1 : 0);
            assert.equal(failed, 0);
            assert.equal(
                calls,
                !settled && ["throw", "empty", "reject"].includes(behavior)
                    ? 1
                    : 0
            );
        }
    });
}
test("iOS HLS reconnect prepares the original source again, not a stale loopback URL", async () => {
    const { w, players } = fixture();
    const prepared = [];
    const timers = [];
    const source = "https://source.invalid/live.m3u8";
    const local =
        "http://127.0.0.1:12345/access/" +
        "a".repeat(43) +
        "/fixture/media.m3u8";
    w.playerMode = 1;
    w.setTimeout = (callback) => {
        timers.push(callback);
        return timers.length;
    };
    w.clearTimeout = () => {};
    w.__ottCoreTransport.configure({ prepareSource: w.prepareAccessMedia });
    w.Capacitor = {
        getPlatform: () => "ios",
        Plugins: {
            AccessMedia: {
                prepare: ({ url }) => {
                    prepared.push(url);
                    return Promise.resolve({ url: local });
                },
            },
        },
    };
    w.stbPlay(source);
    await tick();
    players[0].events.error(null, {
        details: "manifestParsingError",
        fatal: true,
        type: "network",
    });
    assert.equal(timers.length, 1);
    timers[0]();
    await tick();
    assert.deepEqual(prepared, [source, source]);
    assert.equal(players.length, 2);
    w.stbStop();
});

test("iOS source login failure does not fall back to an unprotected URL", async () => {
    const { w } = fixture();
    const messages = [];
    w.showShift = (message) => messages.push(message);
    w.__ottCoreTransport.configure({ prepareSource: w.prepareAccessMedia });
    w.Capacitor = {
        getPlatform: () => "ios",
        Plugins: {
            AccessMedia: {
                prepare: () => Promise.reject(new Error("cancelled")),
            },
        },
    };
    w.stbPlay("https://source.invalid/blocked.m3u8");
    await tick();
    assert.equal(w.video.playCalls, 0);
    assert.deepEqual(messages, ["Source sign-in required"]);
});
test("HLS level zero is never confused with current higher level", () => {
    const { w, players } = fixture();
    w.playerMode = 1;
    w.stbPlay("live.m3u8");
    players[0].levels = [{}, {}, {}];
    players[0].currentLevel = 2;
    players[0].events.error(null, {
        fatal: true,
        frag: { level: 0 },
        type: "media",
    });
    assert.equal(players[0].removed, undefined);
});
(async () => {
    let failures = 0;
    for (const [name, fn] of cases) {
        try {
            await fn();
            console.log("PASS " + name);
        } catch (error) {
            failures++;
            console.error("FAIL " + name + "\n" + error.stack);
        }
    }
    if (failures) process.exitCode = 1;
})();
