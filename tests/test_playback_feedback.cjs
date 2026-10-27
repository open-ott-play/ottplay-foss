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
        sequence = 0,
        refreshes = 0;
    const timers = new Map();
    w.Date.now = () => time;
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
    let paused = false,
        seeking = false;
    Object.defineProperty(video, "paused", { get: () => paused });
    Object.defineProperty(video, "seeking", { get: () => seeking });
    api.bind(video, () => {
        refreshes++;
    });
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
        nativeWaiting: () => {
            w.document.getElementById("buffering").style.display = "block";
            w.document.getElementById("video_res").textContent =
                "Native buffer";
        },
        pause: (value) => {
            paused = value;
        },
        rawText: () => w.document.getElementById("video_res").textContent,
        refreshes: () => refreshes,
        seeking: (value) => {
            seeking = value;
        },
        text: () => {
            const label = w.document.getElementById("video_res");
            return label.getAttribute("title") || label.textContent;
        },
        timers,
        video,
        w,
    };
}
{
    const f = fixture();
    f.api.begin();
    assert.equal(f.text(), "Connecting...");
    assert.equal(f.timers.size, 1);
    f.event("loadstart");
    f.advance(20000);
    f.api.retry();
    assert.equal(f.text(), "Retrying...");
    f.event("waiting");
    assert.equal(f.text(), "Buffering...");
    f.advance(10000);
    assert.match(f.text(), /timed out/);
    assert.equal(f.busy(), false);
    f.nativeWaiting();
    f.event("waiting");
    assert.equal(
        f.rawText(),
        "ERROR!",
        "late native writes cannot hide terminal feedback"
    );
    assert.equal(f.busy(), false);
    f.event("loadstart");
    assert.equal(f.busy(), false);
    assert.equal(f.timers.size, 0);
    f.event("playing");
    assert.match(
        f.text(),
        /timed out/,
        "playing without progress is not recovery"
    );
    f.advance(1000);
    f.video.currentTime = 1;
    f.event("timeupdate");
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
    f.nativeWaiting();
    f.event("waiting");
    assert.equal(
        f.rawText(),
        "",
        "paused native writes are cleared by inactive feedback"
    );
    assert.equal(f.busy(), false);
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
{
    const f = fixture();
    f.api.begin();
    f.event("loadstart");
    f.event("playing");
    f.event("stalled");
    f.advance(1000);
    f.video.currentTime = 1;
    f.event("timeupdate");
    assert.equal(
        f.text(),
        "",
        "buffered playback clears stalled fetch feedback"
    );
    assert.equal(f.timers.size, 0);
    const healthyRefreshes = f.refreshes();
    f.advance(1000);
    f.video.currentTime = 1.5;
    f.event("timeupdate");
    assert.equal(
        f.refreshes(),
        healthyRefreshes,
        "healthy timeupdate never rerenders metadata or feedback"
    );
    f.event("stalled");
    f.video.currentTime = 2;
    f.advance(45000);
    assert.equal(
        f.text(),
        "",
        "deadline checks progress despite missing timeupdate"
    );
    f.event("waiting");
    Object.defineProperty(f.video, "readyState", { value: 4 });
    f.advance(45000);
    assert.match(f.text(), /timed out/, "unchanged time remains a real stall");
    assert.equal(f.timers.size, 0, "expired stall leaves no recurring probes");
    f.event("timeupdate");
    assert.match(f.text(), /timed out/, "duplicate timeupdate is not recovery");
    f.advance(1000);
    f.video.currentTime = 3;
    f.event("timeupdate");
    assert.equal(
        f.text(),
        "",
        "actual progress recovers even without playing event"
    );
    f.w.close();
}
{
    const f = fixture();
    f.api.begin();
    f.event("loadstart");
    f.advance(1000);
    f.video.currentTime = 1;
    f.pause(true);
    f.event("timeupdate");
    assert.equal(f.busy(), true, "paused position changes are not playback");
    f.pause(false);
    f.seeking(true);
    f.event("seeking");
    f.video.currentTime = 200;
    f.event("timeupdate");
    f.seeking(false);
    f.event("seeked");
    assert.equal(f.busy(), true, "seek itself is not playback recovery");
    f.advance(1000);
    f.video.currentTime = 201;
    f.event("timeupdate");
    assert.equal(f.text(), "", "normal progress after seek is playback");
    f.api.begin();
    f.advance(1000);
    f.video.currentTime = 202;
    f.event("timeupdate");
    f.event("playing");
    assert.equal(f.busy(), true, "old source cannot acknowledge new begin");
    f.event("loadstart");
    f.advance(1000);
    f.video.currentTime = 203;
    f.event("timeupdate");
    assert.equal(f.text(), "");
    f.api.stop();
    f.video.currentTime = 204;
    f.event("timeupdate");
    assert.equal(f.text(), "", "stopped source remains inactive");
    assert.equal(f.api.inactive(), true);
    f.api.begin(false, true);
    f.event("playing");
    f.advance(1000);
    f.video.currentTime = 205;
    f.event("timeupdate");
    assert.equal(f.text(), "", "same-source resume needs no new loadstart");
    f.api.stop();
    f.event("play");
    f.advance(1000);
    f.video.currentTime = 206;
    f.event("timeupdate");
    assert.equal(f.text(), "", "native play resumes same source");
    f.w.close();
}
{
    const f = fixture();
    f.api.begin();
    f.video.src = "https://example.test/new.mp4";
    f.event("timeupdate");
    f.advance(1000);
    f.video.currentTime = 1;
    f.event("timeupdate");
    assert.equal(
        f.text(),
        "",
        "changed source can arm without loadstart event"
    );
    f.event("waiting");
    f.video.currentTime = 500;
    f.event("timeupdate");
    assert.equal(
        f.busy(),
        true,
        "implausible time jump is not decoded playback"
    );
    f.advance(45000);
    assert.match(f.text(), /timed out/);
    f.w.close();
}
{
    const f = fixture();
    let attached = "https://example.test/old.mp4";
    Object.defineProperty(f.video, "currentSrc", { get: () => attached });
    f.video.src = attached;
    f.api.begin();
    f.video.src = "https://example.test/new.mp4";
    f.advance(1000);
    f.video.currentTime = 1;
    f.event("timeupdate");
    f.advance(1000);
    f.video.currentTime = 2;
    f.event("timeupdate");
    assert.equal(
        f.busy(),
        true,
        "pending src cannot acknowledge old attached frames"
    );
    attached = f.video.src;
    f.event("timeupdate");
    f.advance(1000);
    f.video.currentTime = 3;
    f.event("timeupdate");
    assert.equal(
        f.text(),
        "",
        "new attached source recovers only on its own progress"
    );
    f.w.close();
}

{
    const f = fixture();
    f.api.begin(false, false, 75000);
    f.event("loadstart");
    f.advance(30000);
    assert.doesNotMatch(f.text(), /timed out/);
    f.api.retry();
    f.event("waiting");
    f.advance(40000);
    assert.doesNotMatch(f.text(), /timed out/);
    f.video.currentTime = 1;
    f.event("timeupdate");
    assert.equal(f.timers.size, 0, "real progress clears extended startup");
    f.event("waiting");
    f.advance(45000);
    assert.match(f.text(), /timed out/, "later stalls retain45-second limit");
    f.api.stop();
    assert.equal(f.timers.size, 0);
}
{
    const f = fixture();
    f.api.begin(false, false, 75000);
    f.event("loadstart");
    f.advance(70000);
    f.api.retry();
    f.advance(5000);
    assert.match(
        f.text(),
        /timed out/,
        "startup retries cannot extend75-second deadline"
    );
    f.api.begin();
    f.advance(30000);
    assert.match(f.text(), /timed out/, "next normal source retains30 seconds");
}

console.log(
    "playback feedback: bounded waits, confirmed progress, late recovery, seeks, pause/stop and source replacement PASS"
);

// OSD ownership affects presentation, never the upstream deadline or retries.
{
    const f = fixture();
    f.api.begin();
    f.advance(20000);
    f.api.setRecoveryOverlay(true);
    assert.equal(f.text(), "");
    assert.equal(f.busy(), false);
    assert.equal(f.timers.size, 1);
    f.api.retry();
    assert.equal(f.text(), "");
    f.advance(10000);
    assert.equal(f.text(), "");
    assert.equal(f.timers.size, 0, "original deadline still expires");
    f.api.setRecoveryOverlay(false);
    assert.match(f.text(), /timed out/);
    assert.equal(f.busy(), false);
    f.w.close();
}
{
    const f = fixture();
    f.w.document.body.insertAdjacentHTML(
        "beforeend",
        '<div id="liveRecoveryStatus" aria-hidden="true"></div>'
    );
    for (const file of [
        "src/playback/live-recovery.ts",
        "src/ui/live-recovery.ts",
    ])
        f.w.eval(
            ts.transpileModule(fs.readFileSync(file, "utf8"), {
                compilerOptions: { target: ts.ScriptTarget.ES5 },
            }).outputText
        );
    let time = 0;
    let tick;
    let restarts = 0;
    const sample = {
        activity: "0",
        blocked: false,
        handleId: 1,
        key: "fixture-live",
        position: 0,
        ready: true,
        recovering: false,
        terminal: false,
    };
    const ui = f.w.__ottLiveRecoveryOSD;
    const watcher = f.w.__ottLiveRecovery.create({
        clearInterval() {},
        now: () => time,
        report: (state) => ui.render(state),
        restart() {
            restarts++;
            sample.handleId++;
            sample.position = 0;
            f.api.begin();
            f.event("loadstart");
        },
        sample: () => sample,
        setInterval(callback) {
            tick = callback;
            return 1;
        },
        settings: () => ({ attempts: 1, timeout: 10 }),
    });
    function step(moving = false) {
        time += 1000;
        f.advance(1000);
        if (moving) {
            sample.position++;
            f.video.currentTime++;
            f.event("timeupdate");
            watcher.refresh();
        }
        tick();
    }
    watcher.configure();
    f.api.begin();
    f.event("loadstart");
    step();
    step(true);
    step(true);
    f.event("waiting");
    step();
    step();
    step();
    assert.equal(watcher.snapshot().status.phase, "countdown");
    assert.equal(f.text(), "", "countdown supersedes Buffering");
    assert.equal(f.busy(), false);
    sample.recovering = true;
    step();
    assert.equal(watcher.snapshot().status.phase, "hidden");
    assert.equal(
        f.text(),
        "Buffering...",
        "pending engine recovery owns feedback"
    );
    sample.recovering = false;
    step(true);
    assert.equal(f.text(), "");
    for (let i = 0; i < 10; i++) step();
    assert.equal(restarts, 1);
    assert.equal(
        f.text(),
        "",
        "replacement loadstart cannot cover the recovery OSD"
    );
    sample.terminal = true;
    f.api.fail();
    watcher.refresh();
    assert.equal(watcher.snapshot().status.phase, "exhausted");
    assert.equal(
        f.text(),
        "Stream could not be played",
        "terminal errors stay visible"
    );
    sample.terminal = false;
    step(true);
    assert.equal(f.text(), "", "actual progress clears both presentations");
    assert.equal(watcher.snapshot().status.phase, "hidden");
    assert.equal(
        watcher.snapshot().attempts,
        1,
        "one good frame does not renew budget"
    );
    watcher.dispose();
    f.w.close();
}
console.log(
    "playback feedback: live OSD handoff preserves deadlines, engine recovery and terminal errors PASS"
);
