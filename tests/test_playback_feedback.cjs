const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { JSDOM } = require("jsdom");
function fixture() {
    const dom = new JSDOM(
        '<style>#buffering {display:none}</style><div id="buffering"></div><div id="video_res"></div><video></video>',
        { runScripts: "outside-only" }
    );
    const w = dom.window;
    let time = 0,
        sequence = 0;
    const timers = new Map();
    w.setTimeout = (fn, delay) => {
        timers.set(++sequence, { at: time + delay, fn });
        return sequence;
    };
    w.clearTimeout = (id) => timers.delete(id);
    w.forcePlay = true;
    w._ = (value) => value;
    w.eval(
        ts.transpileModule(
            fs.readFileSync("src/core/playback-feedback.ts", "utf8"),
            { compilerOptions: { target: ts.ScriptTarget.ES5 } }
        ).outputText
    );
    const api = w.__ottPlaybackFeedback,
        video = w.document.querySelector("video");
    api.bind(video);
    return {
        advance: (ms) => {
            time += ms;
            for (const [id, timer] of timers)
                if (timer.at <= time) {
                    timers.delete(id);
                    timer.fn();
                }
        },
        api,
        busy: () =>
            w.getComputedStyle(w.document.getElementById("buffering"))
                .display !== "none",
        event: (name) => video.dispatchEvent(new w.Event(name)),
        text: () => w.document.getElementById("video_res").textContent,
        timers,
        w,
    };
}
{
    const f = fixture();
    f.api.begin();
    assert.equal(f.text(), "Connecting...");
    assert.equal(f.timers.size, 1);
    f.advance(20000);
    f.api.retry();
    assert.equal(f.text(), "Retrying...");
    f.event("waiting");
    assert.equal(f.text(), "Buffering...");
    f.advance(10000);
    assert.match(f.text(), /timed out/);
    assert.equal(f.busy(), false);
    f.event("waiting");
    f.event("loadstart");
    assert.equal(f.busy(), false);
    assert.equal(f.timers.size, 0);
    f.event("playing");
    assert.equal(f.text(), "");
    f.event("waiting");
    assert.equal(f.busy(), true);
    f.advance(45000);
    assert.equal(f.busy(), false);
    f.w.close();
}
{
    const f = fixture();
    f.api.begin();
    f.api.stop();
    f.event("waiting");
    f.advance(60000);
    assert.equal(f.text(), "");
    assert.equal(f.busy(), false);
    assert.equal(f.timers.size, 0);
    f.api.begin(true);
    f.event("loadstart");
    assert.equal(f.timers.size, 0);
    f.api.begin();
    f.w.forcePlay = false;
    f.event("pause");
    assert.equal(f.busy(), false);
    assert.equal(f.timers.size, 0);
    f.w.close();
}
{
    const f = fixture();
    f.api.begin();
    f.advance(29000);
    f.api.begin();
    f.advance(1000);
    assert.equal(f.busy(), true);
    f.advance(29000);
    assert.equal(f.busy(), false);
    f.api.begin();
    f.api.fail();
    assert.equal(f.text(), "Stream could not be played");
    assert.equal(f.busy(), false);
    f.w.close();
}
console.log(
    "playback feedback: bounded waits, retry deadlines, late recovery, pause/stop and source replacement PASS"
);
