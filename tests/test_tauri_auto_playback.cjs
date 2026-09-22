/* Execute the shared Auto watcher and actual core with deterministic media IO. */
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

function media(nativeHls) {
    let source = "",
        position = 0;
    const listeners = {};
    return {
        addEventListener(event, callback) {
            (listeners[event] ||= []).push(callback);
        },
        audioTracks: [],
        canPlayType() {
            return nativeHls ? "probably" : "";
        },
        get currentTime() {
            return position;
        },
        set currentTime(value) {
            if (this.readyState === 0) throw new Error("InvalidStateError");
            position = value;
        },
        emit(event) {
            for (const callback of [...(listeners[event] || [])]) callback();
        },
        error: null,
        listeners,
        muted: false,
        pause() {
            this.pauseCalls++;
            this.paused = true;
        },
        pauseCalls: 0,
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
        removeEventListener(event, callback) {
            listeners[event] = (listeners[event] || []).filter(
                (fn) => fn !== callback
            );
        },
        sourceHistory: [],
        get src() {
            return source;
        },
        set src(value) {
            source = value;
            this.sourceHistory.push(value);
            position = 0;
            this.readyState = 0;
            this.videoWidth = this.videoHeight = 0;
            this.audioTracks = [];
            this.videoTracks = [];
            this.error = null;
        },
        videoHeight: 0,
        videoTracks: [],
        videoWidth: 0,
    };
}

function fixture(options = {}) {
    let now = 0,
        nextTimer = 0;
    const timers = new Map(),
        players = [],
        shakaPlayers = [];
    const preferences = {};
    if (options.savedPlayerMode !== undefined)
        preferences.sPlayers = String(options.savedPlayerMode);
    function Hls(config) {
        this.config = config || {};
        this.events = {};
        this.levels = [];
        this.audioTracks = [];
        this.subtitleTracks = [];
        this.destroyCalls = 0;
        this.recoverCalls = 0;
        players.push(this);
    }
    Hls.Events = {
        AUDIO_TRACKS_UPDATED: "audio",
        ERROR: "error",
        FRAG_PARSING_INIT_SEGMENT: "tracks",
        MANIFEST_PARSED: "manifest",
    };
    Hls.ErrorTypes = { MEDIA_ERROR: "media", NETWORK_ERROR: "network" };
    Hls.isSupported = () => options.hlsSupported !== false;
    Hls.prototype.on = function (event, callback) {
        (this.events[event] ||= []).push(callback);
    };
    Hls.prototype.emit = function (event, data) {
        this.emitting = true;
        try {
            for (const callback of this.events[event] || [])
                callback(event, data);
        } finally {
            this.emitting = false;
        }
    };
    Hls.prototype.loadSource = function (url) {
        this.url = url;
    };
    Hls.prototype.attachMedia = function (target) {
        this.media = target;
        target.src = "blob:hls-" + players.indexOf(this);
    };
    Hls.prototype.destroy = function () {
        if (this.config.startFragPrefetch)
            assert.ok(
                !this.emitting,
                "Probe destruction waits until the HLS event returns"
            );
        this.destroyCalls++;
        if (this.media) this.media.src = "";
    };
    Hls.prototype.recoverMediaError = function () {
        this.recoverCalls++;
    };
    Hls.prototype.startLoad = function () {};
    Hls.prototype.removeLevel = function () {};
    function Shaka(target) {
        this.media = target;
        this.destroyCalls = 0;
        shakaPlayers.push(this);
    }
    Shaka.isBrowserSupported = () => options.shakaSupported !== false;
    Shaka.prototype.load = function (url, position) {
        this.url = url;
        this.position = position;
        this.media.src = "blob:shaka-" + shakaPlayers.indexOf(this);
    };
    Shaka.prototype.destroy = function () {
        this.destroyCalls++;
        this.media.src = "";
    };
    const w = {
        _: (text) => text,
        __TAURI__: options.tauri === false ? undefined : {},
        $: () => ({ css() {}, hide() {}, html() {}, show() {} }),
        applyChannelPreference() {},
        clearInterval() {},
        clearTimeout(timer) {
            timers.delete(timer);
        },
        console: { error() {}, log() {}, warn() {} },
        document: { body: { style: {} } },
        Hls,
        innerHeight: 720,
        innerWidth: 1280,
        Map: undefined,
        navigator: { userAgent: options.userAgent || "" },
        ott_device: options.device || "pc",
        // The classic bundle still executes without Promise/Map/Set globals.
        Promise: undefined,
        providerHasItemValue: (key) =>
            Object.prototype.hasOwnProperty.call(preferences, key),
        providerSetItem(key, value) {
            preferences[key] = String(value);
        },
        Set: undefined,
        saveChannelPreference() {},
        setInterval() {
            return ++nextTimer;
        },
        setTimeout(callback, delay) {
            timers.set(++nextTimer, { callback, due: now + delay });
            return nextTimer;
        },
        shaka: { Player: Shaka },
        ...options.globals,
    };
    if (options.hlsMissing) delete w.Hls;
    w.window = w;
    vm.createContext(w);
    require("./helpers/shared-core-runtime.cjs")(w);
    vm.runInContext(source, w);
    w.video = media(options.nativeHls !== false);
    w.videoPip = media(options.nativeHls !== false);
    w.setPlayerMode(options.savedPlayerMode ?? 3);
    function advance(milliseconds) {
        const end = now + milliseconds;
        for (let count = 0; count < 100; count++) {
            const next = [...timers.entries()]
                .filter(([, timer]) => timer.due <= end)
                .sort((a, b) => a[1].due - b[1].due)[0];
            if (!next) {
                now = end;
                return;
            }
            timers.delete(next[0]);
            now = next[1].due;
            next[1].callback();
        }
        throw new Error("Unexpected unbounded timer loop");
    }
    return { advance, players, preferences, shakaPlayers, timers, w };
}

function ready(target, video = false) {
    target.readyState = 3;
    target.audioTracks = [{ language: "en" }];
    target.videoTracks = video ? [{}] : [];
    target.videoWidth = video ? 1920 : 0;
    target.videoHeight = video ? 1080 : 0;
    target.emit("loadedmetadata");
    target.emit("playing");
}
function hevc(player, muxed = false) {
    player.emit("tracks", {
        id: "main",
        tracks: muxed
            ? { audiovideo: { codec: "mp4a.40.2,hvc1.1.6.L120" } }
            : { video: { codec: "hvc1.1.6.L120" } },
    });
}
function probe(fixture, target = fixture.w.video) {
    ready(target);
    fixture.advance(1500);
    const player = fixture.players.at(-1);
    assert.equal(player.config.startFragPrefetch, true);
    assert.equal(player.config.testBandwidth, false);
    assert.equal(player.media, undefined, "Probe does not attach a decoder");
    assert.equal(
        target.paused,
        false,
        "Probe preserves play/pause control state"
    );
    return player;
}
const cases = [];
function test(name, callback) {
    cases.push([name, callback]);
}

test("Tauri Auto preserves working native H264 and explicit HTML5/hls.js choices", () => {
    const f = fixture();
    f.w.stbPlay("working.m3u8?token=1");
    ready(f.w.video, true);
    f.advance(10000);
    assert.equal(f.players.length, 0);
    assert.equal(f.w.video.playCalls, 1);
    assert.equal(f.w.video.videoWidth, 1920);
    assert.equal(f.w.video.src, "working.m3u8?token=1");
    f.w.setPlayerMode(0);
    f.w.stbPlay("explicit.m3u8");
    ready(f.w.video);
    f.advance(10000);
    assert.equal(f.players.length, 0, "Explicit HTML5 has no Auto watcher");
    f.w.setPlayerMode(1);
    f.w.stbPlay("explicit-hls.m3u8");
    assert.equal(f.players.length, 1);
    assert.equal(f.players[0].media, f.w.video);
});

test("webOS uses Auto for every requested mode while Tauri and NetCast preserve manual modes", () => {
    for (const requested of [0, 1, 2, 3]) {
        const webos = fixture({
            device: "lg/webos",
            savedPlayerMode: requested,
            tauri: false,
        });
        assert.equal(webos.w.getDefaultPlayerMode(), 3);
        assert.equal(webos.w.normalizePlayerMode(requested), 3);
        assert.equal(webos.w.playerMode, 3);
        assert.equal(webos.preferences.sPlayers, String(requested));
        for (const device of ["pc", "lg/netcast"]) {
            const legacy = fixture({
                device,
                savedPlayerMode: requested,
                tauri: false,
            });
            assert.equal(legacy.w.getDefaultPlayerMode(), 0);
            assert.equal(
                legacy.w.normalizePlayerMode(requested),
                requested === 3 ? 0 : requested
            );
            assert.equal(legacy.preferences.sPlayers, String(requested));
        }
        const tauri = fixture({ savedPlayerMode: requested });
        assert.equal(tauri.w.getDefaultPlayerMode(), 3);
        assert.equal(tauri.w.playerMode, requested);
        assert.equal(tauri.preferences.sPlayers, String(requested));
    }
});

const testHost = {
    device: "android",
    tauri: false,
    userAgent:
        "Mozilla/5.0 (Linux; Android 16) Chrome/143.0.0.0 OttplayTestWebView/1.0",
};

test("Android test host marker is exact, bounded and independent of native product bridges", () => {
    for (const userAgent of [
        "OttplayTestWebView/1.0",
        testHost.userAgent,
        "Mozilla/5.0 OttplayTestWebView/1.0 Chrome/143",
        "Mozilla/5.0\tOttplayTestWebView/1.0\tChrome/143",
    ]) {
        const f = fixture({ ...testHost, userAgent });
        assert.equal(f.w.isOttplayTestWebView(), true);
        assert.equal(f.w.getDefaultPlayerMode(), 3);
        assert.deepEqual(Array.from(f.w.playerModeNames), [
            "html5",
            "hls.js",
            "shaka",
            "auto",
        ]);
    }
    for (const userAgent of [
        "Mozilla/5.0 (Linux; Android 16) Chrome/143.0.0.0",
        "NotOttplayTestWebView/1.0",
        "OttplayTestWebView/1.00",
        "OttplayTestWebView/1.0.1",
        "OttplayTestWebView/1.0suffix",
        "OttplayTestWebView/1.0;Other",
        "ottplaytestwebview/1.0",
        "OttplayTestWebView/2.0",
    ]) {
        const f = fixture({ ...testHost, userAgent });
        assert.equal(f.w.isOttplayTestWebView(), false, userAgent);
        assert.equal(f.w.getDefaultPlayerMode(), 0);
        assert.equal(f.w.playerModeNames.length, 3);
        f.w.setPlayer();
        f.w.stbPlay("old-android.m3u8");
        assert.equal(f.w.video.src, "old-android.m3u8");
        assert.equal(f.players.length, 0);
    }
    for (const device of ["pc", "lg/webos", "lg/netcast", "samsung/tizen"]) {
        const f = fixture({ ...testHost, device });
        assert.equal(f.w.isOttplayTestWebView(), false, device);
    }
    for (const bridge of [
        "Capacitor",
        "__ottNativeRuntime",
        "Android",
        "__TAURI__",
        "__TAURI_INTERNALS__",
    ]) {
        const f = fixture({ ...testHost, globals: { [bridge]: {} } });
        assert.equal(f.w.isOttplayTestWebView(), false, bridge);
        assert.equal(
            f.w.getDefaultPlayerMode(),
            bridge.startsWith("__TAURI") ? 3 : 0
        );
        f.w.setPlayer();
        f.w.stbPlay("native-product.m3u8");
        ready(f.w.video, true);
        f.advance(10000);
        assert.equal(f.w.video.src, "native-product.m3u8", bridge);
        assert.equal(
            f.players.length,
            0,
            "native product behavior remains unchanged"
        );
    }
    const guarded = fixture(testHost);
    // Node's contextified global suppresses throwing getters; use a normal
    // window object here to exercise an unavailable native bridge faithfully.
    guarded.w.window = Object.create(guarded.w);
    Object.defineProperty(guarded.w.window, "Android", {
        get() {
            throw new Error("native bridge unavailable");
        },
    });
    assert.equal(guarded.w.isOttplayTestWebView(), false);
    assert.equal(guarded.w.getDefaultPlayerMode(), 0);
});

test("marked Android defaults to Auto without replacing saved manual engine choices", () => {
    const fresh = fixture(testHost);
    fresh.w.setPlayerMode(fresh.w.getDefaultPlayerMode());
    fresh.w.setPlayer();
    assert.equal(fresh.w.playerMode, 3);
    assert.deepEqual(fresh.preferences, {});
    for (const savedPlayerMode of [0, 1, 2]) {
        const f = fixture({ ...testHost, savedPlayerMode });
        f.w.setPlayer();
        f.w.stbPlay("manual-android.m3u8");
        assert.equal(f.w.playerMode, savedPlayerMode);
        assert.equal(f.players.length, savedPlayerMode === 1 ? 1 : 0);
        assert.equal(f.shakaPlayers.length, savedPlayerMode === 2 ? 1 : 0);
        assert.equal(f.preferences.sPlayers, String(savedPlayerMode));
        if (savedPlayerMode === 0) {
            f.w.video.error = { code: 4 };
            f.w.video.emit("error");
            f.advance(10000);
            assert.equal(
                f.players.length,
                0,
                "explicit HTML5 remains an explicit choice"
            );
        }
    }
});

test("marked Android Auto uses HLS despite native claims, Shaka for DASH and native MP4", () => {
    const f = fixture(testHost);
    assert.equal(
        f.w.video.canPlayType("application/vnd.apple.mpegurl"),
        "probably"
    );
    f.w.stbPlay("android-live.M3U8?quality=auto#live");
    assert.equal(f.players.length, 1);
    assert.equal(f.players[0].media, f.w.video);
    assert.equal(f.players[0].url, "android-live.M3U8?quality=auto#live");
    assert.equal(
        f.players[0].config.startFragPrefetch,
        undefined,
        "actual playback starts without a native probe"
    );
    assert.deepEqual(f.w.video.sourceHistory, ["blob:hls-0"]);
    f.players[0].emit("manifest");
    assert.equal(f.w.video.playCalls, 1);
    f.w.stbPlay("android-archive.MPD?start=33", 33);
    assert.equal(f.players[0].destroyCalls, 1);
    assert.equal(f.shakaPlayers.length, 1);
    assert.equal(f.shakaPlayers[0].media, f.w.video);
    assert.equal(f.shakaPlayers[0].url, "android-archive.MPD?start=33");
    assert.equal(f.shakaPlayers[0].position, 33);
    f.w.stbPlay("android-vod.mp4?quality=high");
    assert.equal(f.shakaPlayers[0].destroyCalls, 1);
    assert.equal(f.w.video.src, "android-vod.mp4?quality=high");
    assert.equal(f.players.length, 1);
    assert.equal(f.w.playerMode, 3);
    assert.deepEqual(f.preferences, {});
});

test("marked Android Auto falls back to native when HLS is missing or unsupported", () => {
    for (const unavailable of [{ hlsMissing: true }, { hlsSupported: false }]) {
        for (const nativeHls of [true, false]) {
            const f = fixture({ ...testHost, ...unavailable, nativeHls });
            f.w.stbPlay("missing-hls.m3u8");
            f.w.stbPlayPip("missing-pip.m3u8");
            assert.equal(f.players.length, 0);
            assert.equal(f.w.video.src, "missing-hls.m3u8");
            assert.equal(f.w.videoPip.src, "missing-pip.m3u8");
            assert.equal(f.w.video.playCalls, 1);
            assert.equal(f.w.videoPip.playCalls, 1);
        }
    }
});

test("marked Android CSS PiP shares HLS-first Auto selection and keeps main playback isolated", () => {
    const f = fixture(testHost);
    f.w.stbPlay("main.m3u8");
    f.w.stbPlayPip("pip.m3u8?channel=2");
    assert.equal(f.players.length, 2);
    assert.equal(f.players[0].media, f.w.video);
    assert.equal(f.players[1].media, f.w.videoPip);
    assert.deepEqual(f.w.videoPip.sourceHistory, ["blob:hls-1"]);
    f.players[0].emit("manifest");
    f.players[1].emit("manifest");
    assert.equal(f.w.video.playCalls, 1);
    assert.equal(f.w.videoPip.playCalls, 1);
    f.w.stbPlayPip("pip-vod.mp4");
    assert.equal(f.players[1].destroyCalls, 1);
    assert.equal(f.w.videoPip.src, "pip-vod.mp4");
    assert.equal(f.w.video.src, "blob:hls-0");
    f.w.stbStopPip();
    f.players[1].emit("manifest");
    assert.equal(
        f.w.videoPip.playCalls,
        2,
        "stale PiP manifest cannot restart playback"
    );
    assert.equal(f.players[0].destroyCalls, 0);
    assert.equal(f.w.video.src, "blob:hls-0");
});

test("webOS keeps working HLS native despite an old HTML5, HLS or Shaka preference", () => {
    for (const savedPlayerMode of [0, 1, 2]) {
        const f = fixture({
            device: "lg/webos",
            savedPlayerMode,
            tauri: false,
        });
        f.w.setPlayer();
        f.w.stbPlay("working-lg.m3u8?token=1");
        ready(f.w.video, true);
        f.advance(10000);
        assert.equal(f.w.video.src, "working-lg.m3u8?token=1");
        assert.equal(f.w.video.playCalls, 1);
        assert.equal(f.players.length, 0);
        assert.equal(f.shakaPlayers.length, 0);
        assert.equal(f.w.playerMode, 3);
        assert.equal(f.preferences.sPlayers, String(savedPlayerMode));
    }
});

test("webOS without native HLS uses HLS and routes DASH through Shaka", () => {
    for (const savedPlayerMode of [0, 1, 2]) {
        const f = fixture({
            device: "lg/webos",
            nativeHls: false,
            savedPlayerMode,
            tauri: false,
        });
        f.w.stbPlay("lg-live.m3u8?quality=auto");
        assert.equal(f.players.length, 1);
        assert.equal(f.players[0].url, "lg-live.m3u8?quality=auto");
        assert.equal(f.players[0].media, f.w.video);
        f.players[0].emit("manifest");
        assert.equal(f.w.video.playCalls, 1);
        f.w.stbPlay("lg-archive.mpd?start=33", 33);
        assert.equal(f.players[0].destroyCalls, 1);
        assert.equal(f.shakaPlayers.length, 1);
        assert.equal(f.shakaPlayers[0].url, "lg-archive.mpd?start=33");
        assert.equal(f.shakaPlayers[0].position, 33);
        assert.equal(f.shakaPlayers[0].media, f.w.video);
        assert.equal(f.w.video.playCalls, 2);
        assert.equal(f.preferences.sPlayers, String(savedPlayerMode));
    }
});

test("webOS native decode failure switches to HLS once without changing the saved choice", () => {
    const f = fixture({
        device: "lg/webos",
        savedPlayerMode: 0,
        tauri: false,
    });
    f.w.stbPlay("lg-error.m3u8");
    f.w.video.error = { code: 3 };
    f.w.video.emit("error");
    f.w.video.emit("error");
    f.advance(0);
    assert.equal(f.players.length, 1);
    assert.equal(f.players[0].url, "lg-error.m3u8");
    assert.equal(f.players[0].media, f.w.video);
    f.players[0].emit("manifest");
    ready(f.w.video, true);
    f.advance(10000);
    assert.equal(f.players.length, 1);
    assert.equal(f.w.playerMode, 3);
    assert.equal(f.preferences.sPlayers, "0");
});

test("webOS routes DASH through Shaka even with native HLS and retains unsupported-library fallback", () => {
    for (const shakaSupported of [true, false]) {
        const f = fixture({
            device: "lg/webos",
            savedPlayerMode: 0,
            shakaSupported,
            tauri: false,
        });
        f.w.stbPlay("lg-dash.mpd");
        assert.equal(f.shakaPlayers.length, shakaSupported ? 1 : 0);
        assert.equal(f.players.length, 0);
        assert.equal(f.w.video.playCalls, 1);
        if (!shakaSupported) assert.equal(f.w.video.src, "lg-dash.mpd");
    }
    const f = fixture({
        device: "lg/webos",
        hlsSupported: false,
        nativeHls: false,
        savedPlayerMode: 1,
        tauri: false,
    });
    f.w.stbPlay("lg-no-mse.m3u8");
    assert.equal(f.players.length, 0);
    assert.equal(f.w.video.src, "lg-no-mse.m3u8");
    assert.equal(f.w.video.playCalls, 1);
});

test("setPlayer applies late webOS detection and preserves an active native session", () => {
    const f = fixture({ savedPlayerMode: 2, tauri: false });
    assert.equal(f.w.playerMode, 2);
    f.w.ott_device = "lg/webos";
    f.w.setPlayer();
    assert.equal(f.w.playerMode, 3);
    f.w.stbPlay("late-lg.m3u8");
    ready(f.w.video, true);
    f.w.setPlayer();
    f.advance(10000);
    assert.equal(f.w.video.playCalls, 1);
    assert.deepEqual(f.w.video.sourceHistory, ["late-lg.m3u8"]);
    assert.equal(f.players.length, 0);
    assert.equal(f.shakaPlayers.length, 0);
    assert.equal(f.preferences.sPlayers, "2");
});

test("Tauri Shaka and NetCast native/HLS preferences still select their requested engines", () => {
    const tauri = fixture({ savedPlayerMode: 2 });
    tauri.w.setPlayer();
    tauri.w.stbPlay("tauri-manual.m3u8");
    assert.equal(tauri.shakaPlayers.length, 1);
    assert.equal(tauri.shakaPlayers[0].url, "tauri-manual.m3u8");
    for (const savedPlayerMode of [0, 1]) {
        const netcast = fixture({
            device: "lg/netcast",
            savedPlayerMode,
            tauri: false,
        });
        netcast.w.setPlayer();
        netcast.w.stbPlay("netcast-manual.m3u8");
        netcast.w.video.error = { code: 3 };
        netcast.w.video.emit("error");
        netcast.advance(10000);
        assert.equal(netcast.w.playerMode, savedPlayerMode);
        assert.equal(netcast.players.length, savedPlayerMode);
        assert.equal(netcast.preferences.sPlayers, String(savedPlayerMode));
    }
});

test("webOS CSS PiP native fallback leaves the working main stream alone", () => {
    const f = fixture({
        device: "lg/webos",
        savedPlayerMode: 1,
        tauri: false,
    });
    f.w.stbPlay("lg-main.m3u8");
    ready(f.w.video, true);
    f.w.stbPlayPip("lg-pip.m3u8");
    f.w.videoPip.error = { code: 4 };
    f.w.videoPip.emit("error");
    f.advance(0);
    assert.equal(f.players.length, 1);
    assert.equal(f.players[0].url, "lg-pip.m3u8");
    assert.equal(f.players[0].media, f.w.videoPip);
    assert.equal(f.w.video.src, "lg-main.m3u8");
    assert.equal(f.w.video.playCalls, 1);
    assert.equal(f.preferences.sPlayers, "1");
});

test("HEVC audio-only probes once, retains URL and VOD position, and never caps 1080 to window size", () => {
    const f = fixture();
    const url = "http://127.0.0.1:8090/channel/test/index.m3u8?q=1789308244275";
    f.w.stbPlay(url, 45);
    ready(f.w.video);
    assert.equal(f.w.video.currentTime, 45);
    f.w.video.currentTime = 52;
    f.advance(1500);
    const first = f.players[0];
    hevc(first);
    assert.equal(
        first.destroyCalls,
        0,
        "Result is deferred out of transmux callback"
    );
    f.advance(0);
    const actual = f.players[1];
    assert.equal(first.destroyCalls, 1);
    assert.equal(actual.url, url);
    assert.equal(actual.media, f.w.video);
    assert.equal(actual.config.capLevelToPlayerSize, false);
    actual.emit("manifest");
    ready(f.w.video, true);
    assert.equal(f.w.video.currentTime, 52);
    assert.equal(f.w.video.videoHeight, 1080);
    hevc(first);
    f.advance(10000);
    assert.equal(f.players.length, 2);
    assert.equal(
        f.w.playerMode,
        3,
        "Fallback does not rewrite saved Auto mode"
    );
});

test("real radio renews the proxy session once and keeps native playback", () => {
    const f = fixture();
    f.w.stbPlay("radio.m3u8");
    const first = probe(f);
    first.emit("tracks", {
        id: "audio",
        tracks: { audio: { codec: "mp4a.40.2" } },
    });
    f.advance(0);
    assert.equal(
        first.destroyCalls,
        0,
        "Alternate audio is not the main stream result"
    );
    first.emit("tracks", {
        id: "main",
        tracks: { audio: { codec: "mp4a.40.2" } },
    });
    f.advance(0);
    assert.equal(first.destroyCalls, 1);
    assert.equal(
        f.w.video.sourceHistory.filter((url) => url === "radio.m3u8").length,
        2
    );
    assert.equal(f.w.video.playCalls, 2);
    ready(f.w.video);
    f.advance(10000);
    assert.equal(
        f.players.length,
        1,
        "Radio does not repeatedly probe or change engine"
    );
});

test("advertised 720p dimensions cannot hide audio-only native HEVC or misclassify radio", () => {
    for (const result of ["hevc", "radio"]) {
        const f = fixture();
        f.w.stbPlay("advertised.m3u8");
        ready(f.w.video);
        f.w.video.videoWidth = 1280;
        f.w.video.videoHeight = 720;
        f.w.video.emit("resize");
        f.advance(1500);
        const first = f.players[0];
        assert.ok(first, "Empty videoTracks overrides advertised dimensions");
        if (result === "hevc") hevc(first);
        else
            first.emit("tracks", {
                id: "main",
                tracks: { audio: { codec: "mp4a.40.2" } },
            });
        f.advance(0);
        assert.equal(first.destroyCalls, 1);
        if (result === "hevc") {
            assert.equal(f.players.length, 2);
            assert.equal(f.players[1].media, f.w.video);
        } else {
            assert.equal(f.players.length, 1);
            assert.equal(f.w.video.src, "advertised.m3u8");
            assert.equal(f.w.video.sourceHistory.length, 2);
        }
    }
});

test("probe timeout or unknown/error result restores native even when user paused", () => {
    for (const result of ["timeout", "error", "unknown"]) {
        const f = fixture();
        f.w.stbPlay("radio.m3u8", 20);
        const first = probe(f);
        f.w.stbPause();
        if (result === "timeout") f.advance(8000);
        else if (result === "error") first.emit("error", { fatal: true });
        else first.emit("tracks", { id: "main", tracks: {} });
        f.advance(0);
        ready(f.w.video);
        assert.equal(first.destroyCalls, 1);
        assert.equal(f.w.video.src, "radio.m3u8");
        assert.equal(f.w.video.currentTime, 20);
        assert.equal(f.w.video.playCalls, 1);
        assert.equal(f.w.video.paused, true);
        assert.equal(f.w.forcePlay, false);
        assert.equal(f.timers.size, 0);
    }
});

test("direct MP4 stays native while an HLS-only webview uses hls.js immediately", () => {
    const f = fixture({ nativeHls: false });
    f.w.stbPlay("movie.mp4?download=1", 12);
    ready(f.w.video, true);
    assert.equal(f.w.video.currentTime, 12);
    f.w.video.error = { code: 4 };
    f.w.video.emit("error");
    f.advance(10000);
    assert.equal(f.players.length, 0);
    f.w.stbPlay("movie.m3u8?download=1");
    assert.equal(f.players.length, 1);
    assert.equal(f.players[0].media, f.w.video);
    assert.equal(f.players[0].config.startFragPrefetch, undefined);
});

test("native decode/unsupported errors fall back once; network errors and absent track APIs do not", () => {
    for (const code of [2, 3, 4]) {
        const f = fixture();
        f.w.stbPlay("error.m3u8");
        f.w.video.error = { code };
        f.w.video.emit("error");
        f.w.video.emit("error");
        f.advance(0);
        assert.equal(f.players.length, code === 2 ? 0 : 1);
    }
    const f = fixture();
    f.w.stbPlay("unknown.m3u8");
    ready(f.w.video);
    f.w.video.videoTracks = undefined;
    f.w.video.emit("timeupdate");
    f.advance(10000);
    assert.equal(f.players.length, 0);
    assert.equal(f.w.video.pauseCalls, 0);
});

test("late dimensions or a user pause cancel speculative audio-only detection", () => {
    for (const action of ["video", "pause"]) {
        const f = fixture();
        f.w.stbPlay("slow.m3u8");
        ready(f.w.video);
        f.advance(1000);
        if (action === "video") ready(f.w.video, true);
        else f.w.stbPause();
        f.advance(10000);
        assert.equal(f.players.length, 0);
    }
});

test("native video arriving during a probe or its deferred result keeps the native engine", () => {
    for (const timing of ["during-probe", "after-result"]) {
        const f = fixture();
        f.w.stbPlay("slow-video.m3u8");
        const first = probe(f);
        if (timing === "during-probe") ready(f.w.video, true);
        hevc(first);
        if (timing === "after-result") ready(f.w.video, true);
        f.advance(0);
        assert.equal(first.destroyCalls, 1);
        assert.equal(f.players.length, 1, "No fallback decoder is attached");
        assert.equal(f.w.video.src, "slow-video.m3u8");
        assert.equal(f.w.video.sourceHistory.length, 2, "Renew proxy session");
    }
});

test("pause during a HEVC probe survives HLS attachment and late manifest", () => {
    const f = fixture();
    f.w.stbPlay("paused.m3u8", 35);
    const first = probe(f);
    f.w.stbPause();
    hevc(first, true);
    f.advance(0);
    f.players[1].emit("manifest");
    ready(f.w.video, true);
    assert.equal(f.w.video.currentTime, 35);
    assert.equal(f.w.video.playCalls, 1);
    assert.equal(f.w.video.paused, true);
    f.w.stbContinue();
    assert.equal(f.w.video.playCalls, 2);
});

test("stop, channel switch and mode change dispose pending probes and suppress their queued results", () => {
    for (const action of ["stop", "switch", "mode"]) {
        const f = fixture();
        f.w.stbPlay("old.m3u8");
        const first = probe(f);
        hevc(first);
        if (action === "stop") f.w.stbStop();
        else if (action === "switch") f.w.stbPlay("new.mp4");
        else f.w.setPlayerMode(0);
        const expectedSrc = f.w.video.src;
        const expectedPlays = f.w.video.playCalls;
        hevc(first);
        first.emit("error", { fatal: true });
        f.advance(10000);
        assert.equal(first.destroyCalls, 1);
        assert.equal(f.players.length, 1);
        assert.equal(f.w.video.src, expectedSrc);
        assert.equal(f.w.video.playCalls, expectedPlays);
        assert.equal(f.timers.size, 0);
    }
});

test("mode changes renew a probed native session exactly once and preserve pause/seek intent", () => {
    for (const queued of [false, true]) {
        for (const paused of [false, true]) {
            const f = fixture();
            f.w.stbPlay("mode-change.m3u8", 24);
            const first = probe(f);
            if (queued) hevc(first);
            if (paused) f.w.stbPause();
            f.w.setPlayerMode(0);
            assert.equal(first.destroyCalls, 1);
            assert.equal(f.w.video.src, "mode-change.m3u8");
            assert.equal(
                f.w.video.sourceHistory.length,
                2,
                "Renew the native proxy session once"
            );
            ready(f.w.video);
            assert.equal(f.w.video.currentTime, 24);
            assert.equal(f.w.video.playCalls, paused ? 1 : 2);
            assert.equal(f.w.video.paused, paused);
            hevc(first);
            f.advance(10000);
            f.w.setPlayerMode(1);
            assert.equal(
                f.players.length,
                1,
                "Mode-change cancellation suppresses the pending fallback"
            );
            assert.equal(f.w.video.sourceHistory.length, 2);
            assert.equal(f.timers.size, 0);
        }
    }
});

test("mode changes before a probe starts do not renew native source or restart playback", () => {
    const f = fixture();
    f.w.stbPlay("preprobe.m3u8");
    ready(f.w.video);
    f.w.setPlayerMode(0);
    f.advance(10000);
    assert.equal(f.players.length, 0);
    assert.equal(f.w.video.sourceHistory.length, 1);
    assert.equal(f.w.video.playCalls, 1);
    assert.equal(f.timers.size, 0);
});

test("a failed Auto HLS fallback never returns to audio-only native playback", () => {
    const f = fixture();
    f.w.stbPlay("broken.m3u8");
    hevc(probe(f));
    f.advance(0);
    const actual = f.players[1];
    actual.emit("manifest");
    const fatal = { details: "bufferAppendError", fatal: true, type: "media" };
    actual.emit("error", fatal);
    assert.equal(actual.recoverCalls, 1);
    actual.emit("error", fatal);
    f.advance(10000);
    assert.equal(actual.destroyCalls, 1);
    assert.equal(
        f.w.video.sourceHistory.filter((url) => url === "broken.m3u8").length,
        1
    );
    assert.equal(f.players.length, 2);
});

test("main and CSS PiP Auto sessions isolate fallback, stop and stale manifests", () => {
    const f = fixture();
    f.w.stbPlay("main.m3u8");
    ready(f.w.video, true);
    f.w.stbPlayPip("pip.m3u8");
    const first = probe(f, f.w.videoPip);
    hevc(first);
    f.advance(0);
    const actual = f.players[1];
    assert.equal(actual.media, f.w.videoPip);
    actual.emit("manifest");
    assert.equal(f.w.videoPip.playCalls, 2);
    assert.equal(f.w.video.src, "main.m3u8");
    assert.equal(f.w.video.playCalls, 1);
    f.w.stbStopPip();
    actual.emit("manifest");
    assert.equal(f.w.videoPip.playCalls, 2);
    assert.equal(f.w.videoPip.src, "");
    f.w.stbPlayPip("pending.m3u8");
    const pending = probe(f, f.w.videoPip);
    f.w.stbStopPip();
    hevc(pending);
    f.advance(10000);
    assert.equal(pending.destroyCalls, 1);
    assert.equal(f.players.length, 3);
    assert.equal(f.w.video.src, "main.m3u8");
});

test("changing engine mode immediately cancels a pending CSS PiP probe", () => {
    const f = fixture();
    f.w.stbPlayPip("old-pip.m3u8");
    const first = probe(f, f.w.videoPip);
    f.w.setPlayerMode(0);
    assert.equal(first.destroyCalls, 1);
    const plays = f.w.videoPip.playCalls;
    hevc(first);
    f.advance(10000);
    assert.equal(f.players.length, 1);
    assert.equal(f.w.videoPip.playCalls, plays);
    assert.equal(f.timers.size, 0);
});

let failures = 0;
for (const [name, callback] of cases) {
    try {
        callback();
        console.log("PASS " + name);
    } catch (error) {
        failures++;
        console.error("FAIL " + name + "\n" + error.stack);
    }
}
if (failures) process.exitCode = 1;
