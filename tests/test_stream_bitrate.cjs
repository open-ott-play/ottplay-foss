/* Exercise the actual classic core: encoded media bitrate is not network speed. */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const source = ["src/core/auto-playback.ts", "src/core/index.ts"]
    .map((file) =>
        ts
            .transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
                compilerOptions: {
                    module: ts.ModuleKind.ES2015,
                    target: ts.ScriptTarget.ES5,
                },
            })
            .outputText.replace(/^import .*\n/gm, "")
            .replace(/^export /gm, "")
    )
    .join("\n");

function media() {
    let source = "";
    const listeners = {};
    return {
        addEventListener(event, callback) {
            (listeners[event] ||= []).push(callback);
        },
        audioTracks: [],
        canPlayType: () => "probably",
        currentTime: 0,
        emit(event) {
            for (const callback of listeners[event] || [])
                callback({ target: this, type: event });
        },
        pause() {
            this.paused = true;
        },
        paused: true,
        play() {
            this.paused = false;
        },
        readyState: 0,
        removeAttribute(name) {
            if (name === "src") this.src = "";
        },
        removeEventListener(event, callback) {
            listeners[event] = (listeners[event] || []).filter(
                (fn) => fn !== callback
            );
        },
        seeking: false,
        get src() {
            return source;
        },
        set src(value) {
            source = value;
            this.currentTime = 0;
            this.readyState = 0;
            this.videoWidth = this.videoHeight = 0;
        },
        style: {},
        videoHeight: 0,
        videoWidth: 0,
    };
}

function fixture() {
    const players = [],
        html = {};
    let timer = 0;
    function Hls() {
        this.events = {};
        this.levels = [{ bitrate: 90e6 }];
        this.bandwidthEstimate = 700e6;
        this.audioTracks = [];
        this.subtitleTracks = [];
        this.destroyCalls = 0;
        players.push(this);
    }
    Hls.Events = {
        AUDIO_TRACKS_UPDATED: "audio",
        ERROR: "error",
        FRAG_LOADED: "frag-loaded",
        FRAG_PARSING_INIT_SEGMENT: "tracks",
        MANIFEST_PARSED: "manifest",
    };
    Hls.ErrorTypes = { MEDIA_ERROR: "media", NETWORK_ERROR: "network" };
    Hls.isSupported = () => true;
    Hls.prototype.on = function (event, callback) {
        (this.events[event] ||= []).push(callback);
    };
    Hls.prototype.emit = function (event, data) {
        for (const callback of this.events[event] || []) callback(event, data);
    };
    Hls.prototype.loadSource = function (url) {
        this.url = url;
    };
    Hls.prototype.attachMedia = function (target) {
        this.media = target;
        target.src = "blob:hls-" + players.indexOf(this);
    };
    Hls.prototype.destroy = function () {
        this.destroyCalls++;
        if (this.media) this.media.src = "";
        // Retain callbacks deliberately to exercise stale-event guards.
    };
    Hls.prototype.recoverMediaError = function () {};
    Hls.prototype.startLoad = function () {};
    const w = {
        _: (text) => text,
        $: (selector) => ({
            css() {},
            hide() {},
            html(value) {
                if (arguments.length) html[selector] = value;
                return html[selector];
            },
            show() {},
        }),
        addEventListener() {},
        applyChannelPreference() {},
        clearInterval() {},
        clearTimeout() {},
        console: { error() {}, log() {}, warn() {} },
        document: {
            body: { classList: { remove() {} }, style: {} },
            getElementById(id) {
                if (id === "video") return w.video;
                if (id === "videopip") return w.videoPip;
                return id === "vdiv" ? {} : null;
            },
        },
        Hls,
        innerHeight: 720,
        innerWidth: 1280,
        Map: undefined,
        Promise: undefined,
        Set: undefined,
        saveChannelPreference() {},
        setInterval: () => ++timer,
        setTimeout: () => ++timer,
    };
    w.window = w;
    vm.createContext(w);
    require("./helpers/shared-core-runtime.cjs")(w);
    vm.runInContext(source, w);
    w.video = media();
    w.videoPip = media();
    function info() {
        w.updateCoreVideoInfo();
        return html["#video_res"] || "";
    }
    function ready() {
        w.video.readyState = 3;
        w.video.videoWidth = 1920;
        w.video.videoHeight = 1080;
        w.video.paused = false;
    }
    return { info, players, ready, w };
}

function chunk(sn, bytes = 1e6, duration = 1, fragment = {}) {
    return {
        frag: {
            cc: 0,
            duration,
            level: 0,
            sn,
            stats: { loaded: bytes },
            type: "main",
            ...fragment,
        },
    };
}
function part(sn, index, bytes = 250000, duration = 0.25) {
    const data = chunk(sn, 99e6, 1);
    data.part = { duration, index, stats: { loaded: bytes } };
    return data;
}
function near(actual, expected) {
    assert.ok(
        Math.abs(actual - expected) < 1e-9,
        `Expected ${expected} Mbps, received ${actual}`
    );
}
const cases = [];
function test(name, callback) {
    cases.push([name, callback]);
}

test("encoded bitrate is independent of localhost throughput and download delay", () => {
    for (const milliseconds of [1, 10000]) {
        const meter = fixture().w.createCoreHlsBitrateMeter();
        const data = chunk(1, 5e6, 5);
        data.frag.stats.loading = { end: milliseconds, start: 0 };
        data.frag.stats.bwEstimate = 700e6;
        meter.add(data);
        near(meter.mbps(), 8);
    }
});

test("rolling samples weight bytes by duration and evict the oldest of eight", () => {
    const { w } = fixture();
    const weighted = w.createCoreHlsBitrateMeter();
    weighted.add(chunk(1, 1e6, 1));
    weighted.add(chunk(2, 9e6, 3));
    near(weighted.mbps(), 20);
    const rolling = w.createCoreHlsBitrateMeter();
    for (let sn = 0; sn < 8; sn++) rolling.add(chunk(sn));
    near(rolling.mbps(), 8);
    rolling.add(chunk(8, 9e6));
    near(rolling.mbps(), 16);
});

test("LL-HLS uses each part's bytes and duration, not the fragment estimate", () => {
    const meter = fixture().w.createCoreHlsBitrateMeter();
    meter.add(part(1, 0));
    meter.add(part(1, 1));
    near(meter.mbps(), 8);
});

test("legacy event stats and payload-only events retain correct bitrate", () => {
    const { w } = fixture();
    const legacy = w.createCoreHlsBitrateMeter();
    const data = chunk(1, 0, 2);
    delete data.frag.stats;
    data.stats = { loaded: 2e6 };
    legacy.add(data);
    near(legacy.mbps(), 8);
    const payload = w.createCoreHlsBitrateMeter();
    const payloadData = chunk(2, 0, 1);
    delete payloadData.frag.stats;
    payloadData.payload = new ArrayBuffer(125000);
    payload.add(payloadData);
    near(payload.mbps(), 1);
});

test("invalid, aborted, initialization and non-main loads do not become media samples", () => {
    const meter = fixture().w.createCoreHlsBitrateMeter();
    for (const data of [
        null,
        {},
        chunk("initSegment"),
        chunk(1, 1e6, 1, { type: "audio" }),
        chunk(1, 1e6, 1, { type: "subtitle" }),
        chunk(1, 1e6, 1, { bitrateTest: true }),
        chunk(1, 1e6, 1, { stats: { aborted: true, loaded: 1e6 } }),
        chunk(1, 0),
        chunk(1, -1),
        chunk(1, NaN),
        chunk(1, Infinity),
        chunk(1, 1e6, 0),
        chunk(1, 1e6, -1),
        chunk(1, 1e6, NaN),
        chunk(1, 1e6, Infinity),
    ]) {
        meter.add(data);
        near(meter.mbps(), 0);
    }
    meter.add(chunk(2));
    near(meter.mbps(), 8);
});

test("repeated chunk replaces its sample and discontinuities stay distinct", () => {
    const meter = fixture().w.createCoreHlsBitrateMeter();
    meter.add(chunk(1));
    meter.add(chunk(2, 3e6));
    meter.add(chunk(1));
    near(meter.mbps(), 16);
    meter.add(chunk(1, 2e6));
    near(meter.mbps(), 20);
    meter.add(chunk(1, 4e6, 1, { cc: 1 }));
    near(meter.mbps(), 24);
});

test("a complete segment supersedes its parts and ignores subsequent duplicate parts", () => {
    const meter = fixture().w.createCoreHlsBitrateMeter();
    meter.add(part(1, 0));
    meter.add(part(1, 1));
    meter.add(chunk(1, 2e6));
    near(meter.mbps(), 16);
    meter.add(part(1, 2));
    near(meter.mbps(), 16);
});

test("actual HLS footer hides guessed rates then renders measured media Mbps", () => {
    const f = fixture();
    f.w.stbInit();
    f.w.setPlayerMode(1);
    f.w.stbPlay("http://127.0.0.1:8090/channel/test/index.m3u8");
    f.ready();
    assert.match(f.info(), /1920x1080/);
    assert.doesNotMatch(f.info(), /Mbps/);
    f.players[0].emit("frag-loaded", chunk(1, 5e6, 5));
    assert.match(f.info(), /(?:<br\/?>(?:\s*)|\s)8(?:\.0+)? Mbps/);
    f.players[0].bandwidthEstimate = 710e6;
    f.w.video.webkitVideoDecodedByteCount = 999e6;
    f.w.video.emit("seeking");
    f.w.video.emit("seeked");
    assert.match(f.info(), /8(?:\.0+)? Mbps/);
    assert.doesNotMatch(f.info(), /(?:700|710|90) Mbps/);
});

test("channel changes reset the meter and stale HLS callbacks cannot affect the new channel", () => {
    const f = fixture();
    f.w.setPlayerMode(1);
    f.w.stbPlay("first.m3u8");
    f.ready();
    f.players[0].emit("frag-loaded", chunk(1));
    assert.match(f.info(), /8(?:\.0+)? Mbps/);
    f.w.stbPlay("second.m3u8");
    f.ready();
    f.players[0].emit("frag-loaded", chunk(2, 99e6));
    assert.doesNotMatch(f.info(), /Mbps/);
    f.players[1].emit("frag-loaded", chunk(1, 2e6));
    assert.match(f.info(), /16(?:\.0+)? Mbps/);
    f.players[0].emit("frag-loaded", chunk(3, 99e6));
    assert.match(f.info(), /16(?:\.0+)? Mbps/);
    f.w.stbStop();
    assert.equal(f.w._coreHlsBitrate, null);
    f.players[1].emit("frag-loaded", chunk(2, 99e6));
    assert.equal(f.w._coreHlsBitrate, null);
});

test("native bitrate uses media time, preserves pause, and resets on seeking or counter reset", () => {
    const f = fixture();
    f.w.setPlayerMode(0);
    f.w.stbPlay("native.mp4");
    f.ready();
    f.w.video.currentTime = 1;
    f.w.video.webkitVideoDecodedByteCount = 1e6;
    assert.doesNotMatch(f.info(), /Mbps/);
    f.w.video.currentTime = 3;
    f.w.video.webkitVideoDecodedByteCount = 3e6;
    assert.match(f.info(), /8(?:\.0+)? Mbps/);
    f.w.stbPause();
    assert.match(f.info(), /8(?:\.0+)? Mbps/);
    f.w.video.seeking = true;
    f.w.video.currentTime = 30;
    assert.doesNotMatch(f.info(), /Mbps/);
    f.w.video.seeking = false;
    f.w.video.paused = false;
    f.w.video.currentTime = 31;
    f.w.video.webkitVideoDecodedByteCount = 4e6;
    f.info();
    f.w.video.currentTime = 32;
    f.w.video.webkitVideoDecodedByteCount = 5e6;
    assert.match(f.info(), /8(?:\.0+)? Mbps/);
    f.w.video.currentTime = 33;
    f.w.video.webkitVideoDecodedByteCount = 100;
    assert.doesNotMatch(f.info(), /Mbps/);
});

test("starting another native channel clears cumulative decoded-byte samples", () => {
    const f = fixture();
    f.w.setPlayerMode(0);
    f.w.stbPlay("first.mp4");
    f.ready();
    f.w.video.currentTime = 1;
    f.w.video.webkitVideoDecodedByteCount = 1e6;
    f.info();
    f.w.video.currentTime = 2;
    f.w.video.webkitVideoDecodedByteCount = 2e6;
    assert.match(f.info(), /8(?:\.0+)? Mbps/);
    f.w.stbPlay("second.mp4");
    f.ready();
    f.w.video.currentTime = 1;
    f.w.video.webkitVideoDecodedByteCount = 99e6;
    assert.doesNotMatch(f.info(), /Mbps/);
    f.w.video.currentTime = 2;
    f.w.video.webkitVideoDecodedByteCount = 100e6;
    assert.match(f.info(), /8(?:\.0+)? Mbps/);
});

test("native seek events reset the baseline even between footer ticks", () => {
    for (const tickDuringSeek of [false, true]) {
        const f = fixture();
        f.w.stbInit();
        f.w.setPlayerMode(0);
        f.w.stbPlay("native.mp4");
        f.ready();
        f.w.video.currentTime = 1;
        f.w.video.webkitVideoDecodedByteCount = 1e6;
        f.info();
        f.w.video.currentTime = 2;
        f.w.video.webkitVideoDecodedByteCount = 2e6;
        assert.match(f.info(), /8(?:\.0+)? Mbps/);
        f.w.stbSetPosTime(30);
        f.w.video.seeking = true;
        f.w.video.emit("seeking");
        if (tickDuringSeek) f.info();
        f.w.video.seeking = false;
        f.w.video.emit("seeked");
        f.w.video.currentTime = 31;
        f.w.video.webkitVideoDecodedByteCount = 3e6;
        assert.doesNotMatch(f.info(), /Mbps/);
        f.w.video.currentTime = 32;
        f.w.video.webkitVideoDecodedByteCount = 4e6;
        assert.match(f.info(), /8(?:\.0+)? Mbps/);
    }
});

let failures = 0;
for (const [name, callback] of cases) {
    try {
        callback();
        console.log("PASS " + name);
    } catch (error) {
        failures++;
        console.error("FAIL " + name);
        console.error(error);
    }
}
console.log(
    `${cases.length - failures}/${cases.length} stream bitrate tests passed`
);
process.exitCode = failures ? 1 : 0;
