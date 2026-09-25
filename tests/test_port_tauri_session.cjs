const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const source = fs.readFileSync(path.join(__dirname, "../src/index.ts"), "utf8");
function wrapper(first, last) {
    const begin = source.indexOf(first);
    const end = source.indexOf(last, begin);
    assert.ok(begin > 0 && end > begin, "actual native wrapper exists");
    return ts.transpileModule(source.slice(begin, end), {
        compilerOptions: { target: ts.ScriptTarget.ES5 },
    }).outputText;
}
const code = {
    capacitor: wrapper(
        "// Capacitor Mode C: native media bridges",
        "// Tauri Mode B: OS MediaSession"
    ),
    tauri: wrapper(
        "// Tauri Mode B: OS MediaSession",
        "// Tauri Mode B: frameless window"
    ),
};
function fixture(platform = "tauri") {
    const calls = [],
        timers = new Map(),
        timerKinds = new Map(),
        timerDelays = new Map(),
        timerCalls = [];
    let nextTimer = 0,
        playing = false,
        nativeWindow,
        engineEvent;
    function receiver(owner, method) {
        // Browser timer functions can reject the ports object as an illegal
        // receiver even though the previous arrow-function stubs accepted it.
        assert.ok(owner === nativeWindow, method + " requires Window receiver");
        timerCalls.push(method);
    }
    const w = {
        __TAURI__: {},
        clearInterval(id) {
            receiver(this, "clearInterval");
            timers.delete(id);
            timerKinds.delete(id);
            timerDelays.delete(id);
        },
        clearTimeout(id) {
            receiver(this, "clearTimeout");
            timers.delete(id);
            timerKinds.delete(id);
            timerDelays.delete(id);
        },
        console: { warn() {} },
        nativeMediaMetadata: () => ({
            durationSec: 300,
            positionSec: 30,
            seekable: true,
            title: "Movie",
        }),
        setInterval(fn, delay) {
            receiver(this, "setInterval");
            const id = ++nextTimer;
            timers.set(id, fn);
            timerKinds.set(id, "interval");
            timerDelays.set(id, delay);
            return id;
        },
        setTimeout(fn, delay) {
            receiver(this, "setTimeout");
            const id = ++nextTimer;
            timers.set(id, fn);
            timerKinds.set(id, "timeout");
            timerDelays.set(id, delay);
            return id;
        },
        stbContinue() {
            playing = !playing;
        },
        stbIsPlaying() {
            return playing;
        },
        stbPause() {
            playing = false;
        },
        stbPlay() {
            playing = true;
        },
        stbStop() {
            playing = false;
        },
        tauriInvoke(command, meta) {
            calls.push([command, meta]);
            return Promise.resolve();
        },
    };
    if (platform === "capacitor") {
        delete w.__TAURI__;
        w.Capacitor = { getPlatform: () => "ios" };
        w.MobileNativeMedia = {};
        for (const action of ["start", "update", "pause", "resume", "stop"])
            w.MobileNativeMedia[action + "BackgroundAudio"] = (metadata) => {
                calls.push([action + "_media_session", metadata]);
                return Promise.resolve();
            };
        w.__ottCoreTransport = { configure() {} };
    }
    w.window = w;
    vm.createContext(w);
    nativeWindow = vm.runInContext("window", w);
    for (const file of ["media-backend", "media-session", "native-pip"])
        require("./helpers/private-runtime.cjs")(
            w,
            "src/device/" + file + ".ts"
        );
    const backend = w.__ottMediaBackend.create({
        clearInterval: (id) => w.clearInterval.call(nativeWindow, id),
        context: () => null,
        emit() {},
        open(_request, event) {
            playing = true;
            engineEvent = event;
            return {
                dispose() {
                    playing = false;
                },
                pause() {
                    playing = false;
                },
                resume() {
                    playing = true;
                },
                sample: () => ({
                    duration: 300,
                    paused: !playing,
                    position: 30,
                    ready: 2,
                }),
                seek() {},
            };
        },
        setInterval: (fn, delay) => w.setInterval.call(nativeWindow, fn, delay),
    });
    w.__ottCoreBackend = () => backend;
    w.stbPlay = (url) => backend.open({ url });
    w.stbStop = () => backend.stop();
    w.stbPause = () => backend.current().pause();
    w.stbContinue = () =>
        playing ? backend.current().pause() : backend.current().resume();
    vm.runInContext(code[platform], w);
    return {
        calls,
        fire(kind) {
            const ids = [...timerKinds].filter(([, value]) => value === kind);
            assert.equal(ids.length, 1, "one active " + kind + " timer");
            const id = ids[0][0];
            const callback = timers.get(id);
            assert.equal(timerDelays.get(id), kind === "timeout" ? 1500 : 2000);
            if (kind === "timeout") {
                timers.delete(id);
                timerKinds.delete(id);
                timerDelays.delete(id);
            }
            callback();
        },
        playing() {
            engineEvent("playing");
        },
        timerCalls,
        timers,
        w,
    };
}
const cases = [];
function test(name, fn) {
    cases.push([name, fn]);
}
test("Tauri delayed metadata is cancelled by stop, pause and a newer playback session", () => {
    const { w, calls, timers } = fixture();
    w.stbPlay("movie.mp4");
    const stopped = [...timers.values()];
    w.stbStop();
    for (const callback of stopped) callback();
    assert.equal(timers.size, 0);
    assert.ok(!calls.some((c) => c[0] === "update_media_session"));
    w.stbPlay("next.mp4");
    const paused = [...timers.values()];
    w.stbPause();
    for (const callback of paused) callback();
    assert.equal(timers.size, 0);
    w.stbPlay("old.mp4");
    const old = [...timers.values()];
    w.stbPlay("new.mp4");
    for (const callback of old) callback();
    assert.equal(timers.size, 1);
    assert.ok(!calls.some((c) => c[0] === "update_media_session"));
});
test("Tauri continue reports the actual toggle and cancels stale position intervals", () => {
    const { w, calls, timers } = fixture();
    w.stbPlay("movie.mp4");
    w.stbContinue();
    assert.equal(calls.at(-1)[0], "pause_media_session");
    assert.equal(timers.size, 0);
    w.stbContinue();
    assert.equal(calls.at(-1)[0], "resume_media_session");
    assert.equal(timers.size, 1);
    const interval = [...timers.values()][0];
    w.stbStop();
    const count = calls.length;
    interval();
    assert.equal(calls.length, count);
    assert.equal(timers.size, 0);
});
for (const platform of ["tauri", "capacitor"])
    test(
        platform +
            " media-session timers retain Window through the playback lifecycle",
        () => {
            const { w, calls, timers, timerCalls, fire, playing } =
                fixture(platform);
            w.stbPlay("first.mp4");
            assert.equal(calls.at(-1)[0], "start_media_session");
            playing();
            fire("timeout");
            assert.equal(calls.at(-1)[0], "update_media_session");
            const beforeTick = calls.length;
            fire("interval");
            assert.equal(calls.length, beforeTick + 1);
            assert.equal(calls.at(-1)[0], "update_media_session");
            w.stbPause();
            assert.equal(calls.at(-1)[0], "pause_media_session");
            assert.equal(timers.size, 0);
            w.stbContinue();
            assert.equal(calls.at(-1)[0], "resume_media_session");
            assert.equal(timers.size, 1);
            w.stbPlay("replacement.mp4");
            w.stbPlay("newest.mp4");
            assert.equal(calls.at(-1)[0], "start_media_session");
            assert.equal(timers.size, 1);
            w.stbStop();
            assert.equal(calls.at(-1)[0], "stop_media_session");
            assert.equal(timers.size, 0);
            assert.deepEqual([...new Set(timerCalls)].sort(), [
                "clearInterval",
                "clearTimeout",
                "setInterval",
                "setTimeout",
            ]);
        }
    );
let failures = 0;
for (const [name, fn] of cases) {
    try {
        fn();
        console.log("PASS " + name);
    } catch (error) {
        failures++;
        console.error("FAIL " + name + "\n" + error.stack);
    }
}
if (failures) process.exitCode = 1;
