const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const load = require("./helpers/private-runtime.cjs");
function fixture(limit = 2, timeout = 10) {
    const w = vm.createContext({});
    w.window = w;
    load(w, "src/playback/live-recovery.ts");
    let time = 0,
        timer = null,
        restarts = 0;
    let sample = {
        activity: "0",
        blocked: false,
        handleId: 1,
        key: "source/channel/1",
        position: 1,
        ready: true,
        recovering: false,
        terminal: false,
    };
    const settings = { attempts: limit, timeout };
    const reports = [];
    let sampleHook = null,
        restartHook = null;
    const watchdog = w.__ottLiveRecovery.create({
        clearInterval() {
            timer = null;
        },
        now: () => time,
        report: (status) => reports.push({ ...status }),
        restart() {
            restarts++;
            sample.handleId++;
            sample.position = 0;
            if (restartHook) return restartHook();
            return { accepted: true };
        },
        sample: () => (sampleHook ? sampleHook() : sample),
        setInterval(fn) {
            timer = fn;
            return 1;
        },
        settings: () => settings,
    });
    watchdog.configure();
    function tick(seconds = 1, moving = false) {
        for (let i = 0; i < seconds; i++) {
            time += 1000;
            if (moving && sample) sample.position++;
            if (timer) timer();
        }
    }
    function arm() {
        tick();
        tick(2, true);
    }
    return {
        arm,
        reports,
        restartHook(fn) {
            restartHook = fn;
        },
        get restarts() {
            return restarts;
        },
        get sample() {
            return sample;
        },
        sampleHook(fn) {
            sampleHook = fn;
        },
        setSample(value) {
            sample = value;
        },
        settings,
        suspend(seconds) {
            time += seconds * 1000;
            if (timer) timer();
        },
        tick,
        get timer() {
            return timer;
        },
        w,
        watchdog,
    };
}
function test(name, run) {
    run();
    console.log("PASS live recovery: " + name);
}
test("zero creates no timer or restart, enabling/disabling is immediate", () => {
    const f = fixture(0);
    f.arm();
    f.tick(100);
    assert.equal(f.timer, null);
    assert.equal(f.restarts, 0);
    f.settings.attempts = 1;
    f.watchdog.configure();
    f.arm();
    f.tick(10);
    assert.equal(f.restarts, 1);
    f.settings.attempts = 0;
    f.watchdog.configure();
    assert.equal(f.timer, null);
    f.tick(100);
    assert.equal(f.restarts, 1);
});
for (const timeout of [10, 15, 20, 30])
    test("stall timeout " + timeout, () => {
        const f = fixture(1, timeout);
        f.arm();
        f.tick(timeout - 1);
        assert.equal(f.restarts, 0);
        f.tick();
        assert.equal(f.restarts, 1);
    });
for (let limit = 1; limit <= 5; limit++)
    test("finite budget survives decoder replacements: " + limit, () => {
        const f = fixture(limit);
        f.arm();
        f.tick(300);
        assert.equal(f.restarts, limit);
    });
test("loading after restart cannot renew the budget or run rapid retries", () => {
    const f = fixture(2);
    f.arm();
    f.tick(10);
    f.sample.ready = false;
    f.tick(10);
    assert.equal(f.restarts, 1);
    f.tick();
    assert.equal(f.restarts, 2);
    f.tick(100);
    assert.equal(f.restarts, 2);
});
test("brief progress does not reset attempts; ten continuous seconds do", () => {
    const f = fixture(1);
    f.arm();
    f.tick(10);
    f.tick(9, true);
    f.tick(20);
    assert.equal(f.restarts, 1);
    f.tick(11, true);
    assert.equal(f.watchdog.snapshot().attempts, 0);
    f.tick(10);
    assert.equal(f.restarts, 2);
});
test("healthy playback and initial switching/startup never restart", () => {
    const f = fixture();
    f.tick(60);
    assert.equal(f.restarts, 0);
    f.tick(90, true);
    assert.equal(f.restarts, 0);
});
for (const flag of ["blocked", "recovering", "terminal"])
    test(flag + " suppresses restart", () => {
        const f = fixture();
        f.arm();
        f.sample[flag] = true;
        f.tick(100);
        assert.equal(f.restarts, 0);
        f.sample[flag] = false;
        f.tick(9);
        assert.equal(f.restarts, 0);
    });
test("internal recovery activity gives a fresh grace without renewing budget", () => {
    const f = fixture(1);
    f.arm();
    f.tick(9);
    f.sample.activity = "1";
    f.tick(9);
    assert.equal(f.restarts, 0);
    f.tick(2);
    assert.equal(f.restarts, 1);
    f.sample.activity = "2";
    f.tick(100);
    assert.equal(f.restarts, 1);
});
test("channel/source/generation change cancels the old deadline and starts unarmed", () => {
    const f = fixture();
    f.arm();
    f.tick(9);
    f.sample.key = "source/other/2";
    f.sample.handleId++;
    f.tick(30);
    assert.equal(f.restarts, 0);
    f.tick(2, true);
    f.tick(10);
    assert.equal(f.restarts, 1);
});
test("archive, VOD, stop or disposal clears the live session", () => {
    const f = fixture();
    f.arm();
    f.tick(9);
    f.setSample(null);
    f.tick(60);
    assert.equal(f.restarts, 0);
    f.watchdog.dispose();
    assert.equal(f.timer, null);
});
test("ownership changes during final sampling cannot restart replacement", () => {
    const f = fixture();
    f.arm();
    f.tick(9);
    let calls = 0;
    f.sampleHook(() =>
        ++calls === 1 ? f.sample : { ...f.sample, key: "other" }
    );
    f.tick();
    assert.equal(f.restarts, 0);
});
test("sleep or throttled timer gets fresh grace", () => {
    const f = fixture();
    f.arm();
    f.suspend(120);
    assert.equal(f.restarts, 0);
    f.tick(9);
    assert.equal(f.restarts, 0);
    f.tick();
    assert.equal(f.restarts, 1);
});
test("dispatch exceptions still exhaust the finite budget", () => {
    const f = fixture(2);
    f.restartHook(() => {
        throw Error("failed");
    });
    f.arm();
    f.tick(100);
    assert.equal(f.restarts, 2);
});
// Exercise the actual runtime bridge, including mode and pause guards.
{
    const source = ts.createSourceFile(
        "core.ts",
        fs.readFileSync("src/core/index.ts", "utf8"),
        ts.ScriptTarget.Latest,
        true
    );
    const fn = source.statements.find(
        (n) =>
            ts.isFunctionDeclaration(n) &&
            n.name.text === "sampleCoreLiveRecovery"
    );
    const w = vm.createContext({ JSON });
    w.window = w;
    let active = true,
        kind = "live",
        phase = "playing";
    w.__ottCoreTransport = { play() {} };
    w.stbPlay = w.__ottCoreTransport.play;
    w.__ottClassicPlayback = {
        snapshot: () => ({
            generation: 1,
            phase,
            target: { channelId: "b", kind, sourceId: "a" },
        }),
    };
    w.coreMediaBackend = {
        current: () => ({
            active: () => active,
            id: 1,
            snapshot: () => ({ phase }),
        }),
    };
    w.video = { currentTime: 10, paused: false, readyState: 3 };
    w.document = { visibilityState: "visible" };
    w.navigator = { onLine: true };
    w.coreStreamAttempt = { state: () => ({ pending: true, terminal: false }) };
    w.coreAttemptCounters = {};
    w.coreAvTest = null;
    vm.runInContext(
        ts.transpileModule(fn.getText(source), {
            compilerOptions: { target: ts.ScriptTarget.ES5 },
        }).outputText,
        w
    );
    assert.equal(w.sampleCoreLiveRecovery().recovering, true);
    w.coreStreamAttempt.state = () => ({ pending: false, terminal: true });
    assert.equal(w.sampleCoreLiveRecovery().terminal, true);
    for (const mode of ["archive", "vod"]) {
        kind = mode;
        assert.equal(w.sampleCoreLiveRecovery(), null);
    }
    kind = "live";
    phase = "paused";
    assert.equal(w.sampleCoreLiveRecovery().blocked, true);
    phase = "playing";
    w.video.seeking = true;
    assert.equal(w.sampleCoreLiveRecovery().blocked, true);
    w.video.seeking = false;
    w.forcePlay = false;
    assert.equal(w.sampleCoreLiveRecovery().blocked, true);
    w.forcePlay = true;
    w.__ottKiosk = { enabled: () => true };
    assert.equal(w.sampleCoreLiveRecovery().blocked, true);
    w.__ottKiosk = null;
    active = false;
    assert.equal(w.sampleCoreLiveRecovery(), null);
    console.log(
        "PASS live recovery: real bridge guards pause, seek, archive/VOD, obsolete owner, kiosk and recovery state"
    );
}
// A watchdog retry goes through the real backend.restart(), not engine internals.
{
    const w = vm.createContext({});
    w.window = w;
    load(w, "src/device/media-backend.ts");
    load(w, "src/playback/live-recovery.ts");
    let time = 0,
        generation = 1,
        engineCount = 0;
    const timers = new Map(),
        samples = [];
    let nextTimer = 0;
    const context = () => ({
        active: () => generation === 1,
        generation,
        kind: "live",
        position: 0,
    });
    const backend = w.__ottMediaBackend.create({
        clearInterval: (id) => timers.delete(id),
        context,
        emit() {},
        open() {
            engineCount++;
            const sample = {
                duration: Infinity,
                paused: false,
                position: 0,
                ready: 3,
            };
            samples.push(sample);
            return {
                dispose() {},
                pause() {},
                resume() {},
                sample: () => sample,
                seek() {},
            };
        },
        setInterval(fn) {
            timers.set(++nextTimer, fn);
            return nextTimer;
        },
    });
    backend.open({ url: "https://example.test/synthetic-live" });
    const watchdog = w.__ottLiveRecovery.create({
        clearInterval: (id) => timers.delete(id),
        now: () => time,
        restart: () => backend.restart(),
        sample() {
            const handle = backend.current();
            if (!handle || !handle.active()) return null;
            return {
                activity: "0",
                blocked: false,
                handleId: handle.id,
                key: String(generation),
                position: samples.at(-1).position,
                ready: true,
                recovering: false,
                terminal: false,
            };
        },
        setInterval(fn) {
            timers.set(++nextTimer, fn);
            return nextTimer;
        },
        settings: () => ({ attempts: 2, timeout: 10 }),
    });
    watchdog.configure();
    function tick(moving = false) {
        time += 1000;
        if (moving) samples.at(-1).position++;
        for (const fn of [...timers.values()]) fn();
    }
    tick();
    tick(true);
    tick(true);
    for (let n = 0; n < 100; n++) tick();
    assert.equal(
        engineCount,
        3,
        "initial engine plus exactly two real backend restarts"
    );
    generation++;
    for (let n = 0; n < 100; n++) tick();
    assert.equal(engineCount, 3, "retired channel cannot be restarted");
    watchdog.dispose();
    backend.dispose();
    console.log(
        "PASS live recovery: real backend restart preserves a bounded budget and rejects retired channels"
    );
}

// UI observes the original deadlines; it does not create or run a recovery clock.
function status(f) {
    return f.reports.at(-1);
}
for (const timeout of [10, 15, 20, 30])
    test("indicator uses watchdog deadline: " + timeout, () => {
        const f = fixture(2, timeout);
        f.arm();
        f.tick(2);
        assert.equal(status(f).phase, "hidden");
        f.tick();
        assert.equal(status(f).phase, "countdown");
        assert.equal(status(f).remaining, timeout - 3);
        f.tick();
        assert.equal(status(f).remaining, timeout - 4);
        f.tick(timeout - 4);
        assert.equal(f.restarts, 1);
        assert.equal(status(f).phase, "restarting");
        assert.equal(status(f).attempt, 1);
        assert.equal(status(f).limit, 2);
    });
test("last attempt reports exhaustion only after its existing grace expires", () => {
    const f = fixture(1);
    f.arm();
    f.tick(10);
    assert.equal(status(f).phase, "restarting");
    f.tick(10);
    assert.equal(status(f).phase, "restarting");
    f.tick();
    assert.equal(status(f).phase, "exhausted");
    f.tick(100);
    assert.equal(f.restarts, 1);
});
test("brief recovery after the final attempt cannot promise another restart", () => {
    const f = fixture(1);
    f.arm();
    f.tick(10);
    f.tick();
    f.tick(2, true);
    assert.equal(status(f).phase, "hidden");
    assert.equal(f.watchdog.snapshot().attempts, 1);
    f.tick(3);
    assert.equal(status(f).phase, "hidden");
    f.tick(7);
    assert.equal(status(f).phase, "exhausted");
    assert.equal(f.restarts, 1);
});
test("progress event hides UI immediately without resetting attempts or deadline", () => {
    const f = fixture(1);
    f.arm();
    f.tick(10);
    f.tick();
    f.sample.position += 1;
    f.watchdog.refresh();
    assert.equal(status(f).phase, "hidden");
    assert.equal(f.watchdog.snapshot().attempts, 1);
    assert.equal(f.restarts, 1);
});
for (const cancel of ["pause", "channel", "archive/VOD", "terminal"])
    test("event hides old indicator: " + cancel, () => {
        const f = fixture();
        f.arm();
        f.tick(3);
        assert.equal(status(f).phase, "countdown");
        if (cancel === "pause") f.sample.blocked = true;
        else if (cancel === "channel") f.sample.key = "other";
        else if (cancel === "terminal") f.sample.terminal = true;
        else f.setSample(null);
        f.watchdog.refresh();
        assert.equal(status(f).phase, "hidden");
        assert.equal(f.restarts, 0);
    });
test("disabled, disposed and suspended observers cannot leave an OSD behind", () => {
    const f = fixture();
    f.arm();
    f.tick(3);
    f.settings.attempts = 0;
    f.watchdog.configure();
    assert.equal(status(f).phase, "hidden");
    assert.equal(f.timer, null);
    const g = fixture();
    g.arm();
    g.tick(3);
    g.watchdog.dispose();
    assert.equal(status(g).phase, "hidden");
    assert.equal(g.timer, null);
});
// Render the actual OSD module, using the existing DOM test dependency.
{
    const { JSDOM } = require("jsdom");
    const dom = new JSDOM(
        '<div id="liveRecoveryStatus" class="osd" aria-hidden="true"></div>',
        { runScripts: "outside-only" }
    );
    const w = dom.getInternalVMContext();
    w._ = (text, ...args) =>
        text.replace(/%([12])/g, (_, i) => args[Number(i) - 1]);
    load(w, "src/ui/live-recovery.ts");
    const el = w.document.getElementById("liveRecoveryStatus");
    const ui = w.__ottLiveRecoveryOSD;
    ui.render({ attempt: 0, limit: 2, phase: "countdown", remaining: 7 });
    assert.equal(el.textContent, "Stream stalled. Restart in 7 s");
    assert.equal(el.style.display, "block");
    assert.equal(el.getAttribute("aria-hidden"), "false");
    ui.render({ attempt: 1, limit: 2, phase: "restarting" });
    assert.equal(el.textContent, "Recovering stream (1/2)");
    ui.render({ attempt: 2, limit: 2, phase: "exhausted" });
    assert.equal(el.textContent, "Live recovery attempts exhausted (2/2)");
    w.document.pictureInPictureElement = {};
    ui.render({ attempt: 0, limit: 2, phase: "countdown", remaining: 7 });
    assert.equal(
        el.style.display,
        "none",
        "main-video native PiP gets no HTML overlay"
    );
    ui.render({ phase: "hidden" });
    assert.equal(el.textContent, "");
    assert.equal(el.getAttribute("aria-hidden"), "true");
    dom.window.close();
    console.log(
        "PASS live recovery: localized OSD countdown, attempt, exhaustion, hiding and PiP exclusion"
    );
}

test("OSD failures cannot interrupt or increase recovery attempts", () => {
    const f = fixture(2);
    f.reports.push = () => {
        throw Error("UI unavailable");
    };
    f.arm();
    f.tick(100);
    assert.equal(f.restarts, 2);
});

test("progress after decoder replacement hides OSD before the next watchdog tick", () => {
    const f = fixture(1);
    f.arm();
    f.tick(10);
    f.watchdog.refresh();
    f.sample.position += 0.25;
    f.watchdog.refresh();
    assert.equal(status(f).phase, "hidden");
    assert.equal(f.watchdog.snapshot().attempts, 1);
});
test("a terminal final attempt still explains the exhausted budget", () => {
    const f = fixture(1);
    f.arm();
    f.tick(10);
    f.sample.terminal = true;
    f.watchdog.refresh();
    assert.equal(status(f).phase, "exhausted");
    f.tick();
    assert.equal(status(f).phase, "exhausted");
    assert.equal(f.restarts, 1);
});
{
    const source = ts.createSourceFile(
        "core.ts",
        fs.readFileSync("src/core/index.ts", "utf8"),
        ts.ScriptTarget.Latest,
        true
    );
    const fn = source.statements.find(
        (n) =>
            ts.isFunctionDeclaration(n) &&
            n.name.text === "configureLiveRecovery"
    );
    const listeners = new Map();
    let subscriptions = 0,
        unsubscriptions = 0;
    const w = vm.createContext({});
    w.window = w;
    w.coreLiveRecovery = {
        configure() {},
        refresh() {},
        snapshot: () => ({ status: { phase: "hidden" } }),
    };
    w.coreMediaBackend = {
        subscribe() {
            subscriptions++;
            return () => unsubscriptions++;
        },
    };
    w.video = {
        addEventListener: (name, cb) => listeners.set(name, cb),
        removeEventListener: (name) => listeners.delete(name),
    };
    w.document = {};
    vm.runInContext(
        ts.transpileModule(fn.getText(source), {
            compilerOptions: { target: ts.ScriptTarget.ES5 },
        }).outputText,
        w
    );
    w.sLiveRecoveryAttempts = 0;
    w.configureLiveRecovery();
    assert.equal(listeners.size, 0);
    assert.equal(subscriptions, 0);
    w.sLiveRecoveryAttempts = 2;
    w.configureLiveRecovery();
    assert.equal(listeners.size, 7);
    assert.equal(subscriptions, 1);
    w.configureLiveRecovery();
    assert.equal(listeners.size, 7);
    assert.equal(unsubscriptions, 1);
    w.sLiveRecoveryAttempts = 0;
    w.configureLiveRecovery();
    assert.equal(listeners.size, 0);
    assert.equal(unsubscriptions, 2);
    console.log(
        "PASS live recovery: OSD listeners are opt-in, deduplicated and removed when disabled"
    );
}
