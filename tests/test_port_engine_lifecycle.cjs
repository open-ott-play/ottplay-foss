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
        this.loaded = deferred();
        this.destroyed = deferred();
        this.destroyCalls = 0;
        shakas.push(this);
    }
    Shaka.isBrowserSupported = () => true;
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
            css() {},
            hide() {
                hidden.push(selector);
            },
            html() {},
            show() {},
        }),
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
        execCHarr() {},
        Hls,
        innerHeight: 720,
        innerWidth: 1280,
        Map: undefined,
        // Mode A must still run without the ES2015 Promise constructor.
        Promise: undefined,
        Set: undefined,
        saveCHarr() {},
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
    vm.runInContext(core, w);
    w.video = media();
    w.videoPip = media();
    return { boxes, errors, hidden, players, shakas, w };
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
