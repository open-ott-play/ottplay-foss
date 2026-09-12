const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function compile(source) {
    return ts
        .transpileModule(source, {
            compilerOptions: {
                module: ts.ModuleKind.ES2015,
                target: ts.ScriptTarget.ES5,
            },
        })
        .outputText.replace(/^import .*\n/gm, "")
        .replace(/^export /gm, "");
}
const core = compile(read("src/core/index.ts"));
const entry = read("src/index.ts");
const begin = entry.indexOf("// Capacitor Mode C: native media bridges");
const end = entry.indexOf("// Tauri Mode B: OS MediaSession", begin);
assert(begin >= 0 && end > begin);
const wrapper = compile(entry.slice(begin, end));

function fixture(platform = "android") {
    const nativeCalls = [];
    const streams = [];
    const timers = new Map();
    let timerId = 0;
    const elements = {};
    function element(id) {
        return (elements[id] ||= {
            style: {},
            clientWidth: 512,
            clientHeight: 288,
        });
    }
    function media(id) {
        return Object.assign(element(id), {
            currentTime: 0,
            duration: 600,
            paused: true,
            muted: id === "videopip",
            volume: 1,
            videoWidth: 1280,
            videoHeight: 720,
            playCalls: 0,
            audioTracks: [{ enabled: true }, { enabled: false }],
            textTracks: [
                { kind: "subtitles", label: "English", mode: "disabled" },
            ],
            canPlayType: () => "probably",
            play() {
                this.paused = false;
                this.playCalls++;
                return Promise.resolve();
            },
            pause() {
                this.paused = true;
            },
            removeAttribute(name) {
                delete this[name];
            },
        });
    }
    function Hls() {
        this.events = {};
        streams.push(this);
    }
    Hls.Events = {
        MANIFEST_PARSED: "manifest",
        ERROR: "error",
        AUDIO_TRACKS_UPDATED: "audio",
    };
    Hls.ErrorTypes = { MEDIA_ERROR: "media", NETWORK_ERROR: "network" };
    Hls.isSupported = () => true;
    Hls.prototype.loadSource = function (url) {
        this.url = url;
    };
    Hls.prototype.attachMedia = function (video) {
        this.video = video;
    };
    Hls.prototype.on = function (event, callback) {
        this.events[event] = callback;
    };
    Hls.prototype.destroy = function () {
        this.destroyed = true;
    };
    function Shaka(video) {
        this.video = video;
        streams.push(this);
    }
    Shaka.isBrowserSupported = () => true;
    Shaka.prototype.load = function (url) {
        this.url = url;
        return Promise.resolve();
    };
    const w = {
        console: { log() {}, warn() {}, error() {} },
        innerWidth: 1280,
        innerHeight: 720,
        playType: -1,
        Capacitor: { getPlatform: () => platform },
        DashExoPlayer: new Proxy(
            {},
            {
                get() {
                    throw Error(
                        "normal playback must not enter a native overlay"
                    );
                },
            }
        ),
        MobileNativeMedia: new Proxy(
            {},
            {
                get:
                    (_, method) =>
                    (...args) => {
                        nativeCalls.push([method, ...args]);
                        return Promise.resolve({ ok: true });
                    },
            }
        ),
        document: {
            getElementById: (id) => elements[id] || null,
            body: { style: {}, classList: { add() {}, remove() {} } },
        },
        $: (selector) => {
            const el = element(selector.slice(1));
            return {
                css(styles) {
                    Object.assign(el.style, styles);
                    return this;
                },
                show() {
                    el.style.display = "block";
                    return this;
                },
                hide() {
                    el.style.display = "none";
                    return this;
                },
                html() {
                    return this;
                },
            };
        },
        Hls,
        shaka: { Player: Shaka },
        execCHarr() {},
        setTimeout(fn) {
            timers.set(++timerId, fn);
            return timerId;
        },
        clearTimeout(id) {
            timers.delete(id);
        },
        setInterval(fn) {
            timers.set(++timerId, fn);
            return timerId;
        },
        clearInterval(id) {
            timers.delete(id);
        },
    };
    w.window = w;
    vm.createContext(w);
    vm.runInContext(core, w);
    w.video = media("video");
    w.videoPip = media("videopip");
    element("vdiv");
    const original = {
        isPlaying: w.stbIsPlaying,
        seek: w.stbSetPosTime,
        mute: w.stbToggleMute,
        audio: w.setAudioTrack,
    };
    vm.runInContext(wrapper, w);
    return { w, streams, timers, nativeCalls, elements, original };
}

async function run() {
    {
        const { w, streams, original, nativeCalls, elements } = fixture();
        w.setPlayerMode(2);
        w.stbPlay("https://example.invalid/video.mpd", 31);
        assert.equal(streams.length, 1);
        assert.equal(
            streams[0].video,
            w.video,
            "DASH uses the same controllable video as browser TS"
        );
        assert.equal(streams[0].url, "https://example.invalid/video.mpd");
        assert.equal(w.stbIsPlaying, original.isPlaying);
        assert.equal(w.stbIsPlaying(), true);
        assert.equal(w.stbGetPosTime(), 31);
        assert.equal(w.stbGetLen(), 600);
        w.stbPause();
        assert.equal(w.stbIsPlaying(), false);
        w.stbContinue();
        assert.equal(w.stbIsPlaying(), true);
        w.stbSetPosTime(95);
        w.stbToggleMute();
        w.setAudioTrack(1);
        assert.equal(w.video.currentTime, 95);
        assert.equal(w.video.muted, true);
        assert.equal(w.video.audioTracks[1].enabled, true);
        w.stbSetWindow();
        assert.equal(
            elements.vdiv.style.width,
            "512px",
            "OTT list preview retains its DOM bounds"
        );
        assert.equal(w.video, streams[0].video);
        assert.equal(
            nativeCalls.some(([name]) => /Dash|Pip/.test(name)),
            false
        );
        w.setPlayerMode(1);
        w.stbPlay("https://example.invalid/channel.m3u8");
        const hls = streams.at(-1);
        hls.events.manifest();
        assert.equal(
            hls.video,
            w.video,
            "switching formats keeps one shared video surface"
        );
        w.stbStop();
        assert.equal(hls.destroyed, true);
        assert.equal(w.stbIsPlaying(), false);
    }
    {
        const { w, streams, timers, nativeCalls } = fixture();
        w.setPlayerMode(1);
        w.stbPlay("https://example.invalid/channel.m3u8");
        const lateManifest = streams[0].events.manifest;
        const lateMeta = [...timers.values()][0];
        w.stbStop();
        const callsAtStop = nativeCalls.length;
        lateManifest();
        lateMeta();
        await Promise.resolve();
        assert.equal(
            w.stbIsPlaying(),
            false,
            "queued callbacks cannot restart stopped playback"
        );
        assert.equal(
            nativeCalls.length,
            callsAtStop,
            "late metadata cannot recreate the stopped background session"
        );
        assert.equal(timers.size, 0);
    }
    {
        const { w, timers, nativeCalls } = fixture();
        w.stbPlay("https://example.invalid/first.mp4");
        const oldMeta = [...timers.values()][0];
        w.stbPlay("https://example.invalid/second.mp4");
        const currentMeta = [...timers.values()][0];
        const calls = nativeCalls.length;
        oldMeta();
        assert.equal(
            nativeCalls.length,
            calls,
            "superseded stream metadata stays cancelled"
        );
        w.stbPause();
        currentMeta();
        assert.equal(nativeCalls.at(-1)[0], "pauseBackgroundAudio");
        assert.equal(timers.size, 0);
    }
    for (const platform of ["android", "web"]) {
        const { w, streams, nativeCalls, elements } = fixture(platform);
        w.setPlayerMode(1);
        w.stbPlay("https://example.invalid/main.m3u8");
        streams[0].events.manifest();
        w.stbPlayPip("https://example.invalid/second.m3u8");
        assert.equal(streams[1].url, "https://example.invalid/second.m3u8");
        assert.equal(streams[1].video, w.videoPip);
        assert.equal(w.videoPip.muted, true);
        assert.equal(elements.videopip.style.display, "block");
        assert.equal(w.stbIsPlaying(), true);
        w.stbStopPip();
        assert.equal(streams[1].destroyed, true);
        assert.equal(w.videoPip.paused, true);
        assert.equal(
            w.stbIsPlaying(),
            true,
            "closing the second channel leaves the primary stream playing"
        );
        assert.equal(
            nativeCalls.some(([name]) => /Pip/.test(name)),
            false,
            "second-channel controls never enter or exit Activity PiP"
        );
    }
    {
        const { w, nativeCalls, elements } = fixture("ios");
        w.stbPlayPip("https://example.invalid/second.m3u8");
        await Promise.resolve();
        assert.equal(nativeCalls[0][0], "playPip");
        assert.equal(
            nativeCalls[0][1].url,
            "https://example.invalid/second.m3u8"
        );
        assert.equal(elements.videopip.style.display, "none");
        w.stbStopPip();
        assert.equal(nativeCalls.at(-1)[0], "stopPip");
    }
    console.log(
        "OK: Capacitor shares TS playback/control/layout, cancels stale callbacks, and opens the requested Android second channel"
    );
}
run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
