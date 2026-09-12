const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src/index.ts"), "utf8");
const begin = source.indexOf("        let _bgPosTimer:");
const end = source.indexOf("    })();\n}", begin);
assert.ok(begin > 0 && end > begin, "actual Capacitor playback wrapper exists");
const code = ts.transpileModule(source.slice(begin, end), {
    compilerOptions: {
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES5,
    },
}).outputText;
const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, reject, resolve };
}
function fixture() {
    const calls = [],
        supports = [],
        plays = [],
        stops = [],
        states = [],
        timers = new Map();
    let timerId = 0;
    const cap = {};
    for (const name of [
        "startBackgroundAudio",
        "stopBackgroundAudio",
        "pauseBackgroundAudio",
        "resumeBackgroundAudio",
        "updateBackgroundAudio",
    ]) {
        cap[name] = (...args) => {
            calls.push([name, ...args]);
            return Promise.resolve({ ok: true });
        };
    }
    const dash = {
        getPlaybackState() {
            const d = deferred();
            states.push(d);
            return d.promise;
        },
        isDashSupported() {
            const d = deferred();
            supports.push(d);
            return d.promise;
        },
        pauseDash() {
            calls.push(["pauseDash"]);
            return Promise.resolve({ ok: true });
        },
        playDash(options) {
            const d = deferred();
            plays.push(d);
            calls.push(["playDash", options]);
            return d.promise;
        },
        resumeDash() {
            calls.push(["resumeDash"]);
            return Promise.resolve({ ok: true });
        },
        seekDash(options) {
            calls.push(["seekDash", options]);
            return Promise.resolve({ ok: true });
        },
        stopDash() {
            const d = deferred();
            stops.push(d);
            calls.push(["stopDash"]);
            return d.promise;
        },
    };
    let webPlaying = false;
    const w = {
        bgMeta: () => ({
            durationSec: 300,
            positionSec: 10,
            seekable: true,
            title: "Movie",
        }),
        cap,
        clearInterval(id) {
            timers.delete(id);
        },
        clearTimeout(id) {
            timers.delete(id);
        },
        console: { warn() {} },
        DashExoPlayer: dash,
        forcePlay: true,
        setInterval(fn) {
            const id = ++timerId;
            timers.set(id, fn);
            return id;
        },
        setTimeout(fn) {
            const id = ++timerId;
            timers.set(id, fn);
            return id;
        },
        stbContinue() {
            webPlaying = !webPlaying;
            w.forcePlay = webPlaying;
        },
        stbGetLen: () => 999,
        stbGetPosTime: () => 444,
        stbIsPlaying: () => webPlaying,
        stbPause() {
            webPlaying = false;
            w.forcePlay = false;
        },
        stbPlay(url, pos) {
            calls.push(["webPlay", url, pos]);
            webPlaying = true;
            w.forcePlay = true;
        },
        stbSetPosTime(pos) {
            calls.push(["webSeek", pos]);
        },
        stbStop() {
            calls.push(["webStop"]);
            webPlaying = false;
            w.forcePlay = false;
        },
    };
    w.window = w;
    vm.createContext(w);
    vm.runInContext(code, w);
    return { calls, dash, plays, states, stops, supports, timers, w };
}
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
test("late native support cannot revive stop or replace a newer web channel", async () => {
    const { w, supports, plays, calls } = fixture();
    w.stbPlay("old.mpd");
    w.stbStop();
    supports[0].resolve({ ok: true });
    await tick();
    assert.equal(plays.length, 0);
    w.stbPlay("older.mpd");
    w.stbPlay("new.m3u8");
    supports[1].resolve({ ok: false });
    await tick();
    assert.deepEqual(
        calls.filter((c) => c[0] === "webPlay").map((c) => c[1]),
        ["new.m3u8"]
    );
});
test("native start is drained and stopped before a replacement web channel starts", async () => {
    const { w, supports, plays, stops, calls } = fixture();
    w.stbPlay("old.mpd");
    supports[0].resolve({ ok: true });
    await tick();
    assert.equal(plays.length, 1);
    w.stbPlay("new.m3u8");
    assert.equal(calls.filter((c) => c[0] === "webPlay").length, 0);
    plays[0].resolve({ ok: false });
    await tick();
    assert.equal(stops.length, 1);
    assert.equal(calls.filter((c) => c[0] === "webPlay").length, 0);
    stops[0].resolve({ ok: true });
    await tick();
    assert.deepEqual(
        calls.filter((c) => c[0] === "webPlay").map((c) => c[1]),
        ["new.m3u8"]
    );
});
test("pause during native loading survives completion and native getters/seek use cached state", async () => {
    const { w, supports, plays, states, calls } = fixture();
    w.stbPlay("movie.mpd", 30);
    supports[0].resolve({ ok: true });
    await tick();
    w.stbPause();
    plays[0].resolve({ ok: true });
    await tick();
    assert.equal(w.stbIsPlaying(), false);
    assert.equal(w.forcePlay, false);
    assert.ok(calls.some((c) => c[0] === "pauseDash"));
    assert.equal(w.stbGetPosTime(), 30);
    assert.equal(w.stbGetLen(), 0);
    assert.equal(states.length, 1);
    states[0].resolve({
        duration: 300,
        ended: false,
        ok: true,
        playing: false,
        position: 30,
    });
    await tick();
    assert.equal(w.stbGetLen(), 300);
    w.stbContinue();
    await tick();
    assert.ok(calls.some((c) => c[0] === "resumeDash"));
    w.stbSetPosTime(70);
    await tick();
    assert.equal(w.stbGetPosTime(), 70);
    assert.ok(calls.some((c) => c[0] === "seekDash" && c[1].position === 70));
    assert.equal(calls.filter((c) => c[0] === "webSeek").length, 0);
});
test("stale native polls and delayed metadata refresh cannot restart a stopped session", async () => {
    const { w, supports, plays, states, stops, timers } = fixture();
    w.stbPlay("movie.mpd", 20);
    supports[0].resolve({ ok: true });
    await tick();
    plays[0].resolve({ ok: true });
    await tick();
    const lateTimers = [...timers.values()];
    w.stbStop();
    await tick();
    assert.equal(stops.length, 1);
    stops[0].resolve({ ok: true });
    states[0].resolve({
        duration: 300,
        ended: false,
        ok: true,
        playing: true,
        position: 88,
    });
    for (const cb of lateTimers) cb();
    await tick();
    assert.equal(timers.size, 0);
    assert.equal(w.stbIsPlaying(), false);
    w.stbPlay("web.mp4");
    const refresh = [...timers.values()];
    w.stbPause();
    for (const cb of refresh) cb();
    await tick();
    assert.equal(timers.size, 0);
});
test("seek and pause during support detection survive native start; polls are bounded", async () => {
    const { w, calls, supports, plays, states, timers } = fixture();
    w.stbPlay("movie.mpd", 10);
    w.stbSetPosTime(55);
    w.stbPause();
    supports[0].resolve({ ok: true });
    await tick();
    assert.equal(calls.find((c) => c[0] === "playDash")[1].position, 55);
    plays[0].resolve({ ok: true });
    await tick();
    assert.equal(w.stbIsPlaying(), false);
    for (const fn of timers.values()) {
        fn();
        fn();
        fn();
    }
    assert.equal(
        states.length,
        1,
        "at most one native state request may be outstanding"
    );
    w.stbSetPosTime(66);
    await tick();
    states[0].resolve({
        duration: 300,
        ended: false,
        ok: true,
        playing: true,
        position: 55,
    });
    await tick();
    assert.equal(
        w.stbGetPosTime(),
        66,
        "pre-seek polling response cannot undo new position"
    );
});
test("older native binary without state methods does not seek the hidden HTML player", async () => {
    const { w, dash, calls, supports, plays, timers } = fixture();
    delete dash.getPlaybackState;
    delete dash.seekDash;
    w.stbPlay("movie.mpd", 12);
    supports[0].resolve({ ok: true });
    await tick();
    plays[0].resolve({ ok: true });
    await tick();
    w.stbSetPosTime(99);
    assert.equal(w.stbGetPosTime(), 12);
    assert.equal(w.stbGetLen(), 0);
    assert.equal(timers.size, 0);
    assert.ok(!calls.some((c) => c[0] === "webSeek"));
});
test("resuming completed native media seeks to the beginning like HTMLMediaElement.play", async () => {
    const { w, calls, supports, plays, states } = fixture();
    w.stbPlay("movie.mpd");
    supports[0].resolve({ ok: true });
    await tick();
    plays[0].resolve({ ok: true });
    await tick();
    states[0].resolve({
        duration: 300,
        ended: true,
        ok: true,
        playing: false,
        position: 300,
    });
    await tick();
    assert.equal(w.stbIsPlaying(), false);
    w.stbContinue();
    await tick();
    assert.equal(w.stbGetPosTime(), 0);
    assert.equal(w.stbIsPlaying(), true);
    assert.deepEqual(
        calls
            .filter((c) => c[0] === "seekDash" || c[0] === "resumeDash")
            .map((c) => c[0]),
        ["seekDash", "resumeDash"]
    );
});
test("zero seek during native support detection survives the web fallback", async () => {
    const { w, calls, supports } = fixture();
    w.stbPlay("movie.mpd", 90);
    w.stbSetPosTime(0);
    supports[0].resolve({ ok: false, unsupported: true });
    await tick();
    assert.equal(calls.find((c) => c[0] === "webPlay")[2], 0);
});
(async () => {
    let failures = 0;
    for (const [name, fn] of tests) {
        try {
            await fn();
            console.log("PASS " + name);
        } catch (e) {
            failures++;
            console.error("FAIL " + name + "\n" + e.stack);
        }
    }
    if (failures) process.exitCode = 1;
})();
