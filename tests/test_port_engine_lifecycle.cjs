const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/core/index.ts"), "utf8");
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
    w.stbPlay("c.mp4");
    shakas[0].destroyed.resolve();
    await tick();
    assert.equal(w.video.src, "c.mp4");
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
