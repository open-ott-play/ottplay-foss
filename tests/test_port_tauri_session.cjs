const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const source = fs.readFileSync(path.join(__dirname, "../src/index.ts"), "utf8");
const begin = source.indexOf("        let _msPosTimer:");
const end = source.indexOf("    })();\n}", begin);
assert.ok(
    begin > 0 && end > begin,
    "actual Tauri media-session wrapper exists"
);
const code = ts.transpileModule(source.slice(begin, end), {
    compilerOptions: { target: ts.ScriptTarget.ES5 },
}).outputText;
function fixture() {
    const calls = [],
        timers = new Map();
    let nextTimer = 0,
        playing = false;
    const w = {
        bgMeta: () => ({
            durationSec: 300,
            positionSec: 30,
            seekable: true,
            title: "Movie",
        }),
        clearInterval(id) {
            timers.delete(id);
        },
        clearTimeout(id) {
            timers.delete(id);
        },
        console: { warn() {} },
        setInterval(fn) {
            const id = ++nextTimer;
            timers.set(id, fn);
            return id;
        },
        setTimeout(fn) {
            const id = ++nextTimer;
            timers.set(id, fn);
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
    w.window = w;
    vm.createContext(w);
    vm.runInContext(code, w);
    return { calls, timers, w };
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
