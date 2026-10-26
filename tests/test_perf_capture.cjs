"use strict";
const assert = require("node:assert/strict"),
    fs = require("node:fs"),
    vm = require("node:vm"),
    ts = require("typescript"),
    acorn = require("acorn");
const { JSDOM } = require("jsdom");
const Hls = require("hls.js");
const contract = JSON.parse(
    fs.readFileSync("tests/fixtures/remote/perf-capture-v1.json", "utf8")
);
const hlsContract = JSON.parse(
    fs.readFileSync("tests/fixtures/remote/perf-capture-v2.json", "utf8")
);
const code = (name) => {
    const result = ts.transpileModule(
        fs.readFileSync("src/plugins/" + name + ".ts", "utf8"),
        {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES5,
            },
        }
    ).outputText;
    acorn.parse(result, { ecmaVersion: 5 });
    return result;
};
const controls = code("perf-capture"),
    sensors = code("perf-sensors"),
    runtime = code("runtime-debug");
const clone = (value) => JSON.parse(JSON.stringify(value));
function schema(value, shape, wire = contract) {
    if (shape.$ref)
        return schema(value, wire.$defs[shape.$ref.split("/").at(-1)], wire);
    if (shape.oneOf) shape = { anyOf: shape.oneOf };
    if (shape.anyOf) {
        assert(
            shape.anyOf.some((candidate) => {
                try {
                    schema(value, candidate, wire);
                    return true;
                } catch {
                    return false;
                }
            })
        );
        return;
    }
    if (shape.enum)
        assert(
            shape.enum.some((item) => Object.is(item, value)),
            `enum ${JSON.stringify(value)}`
        );
    if (shape.type) {
        const types = [].concat(shape.type),
            actual =
                value === null
                    ? "null"
                    : Array.isArray(value)
                      ? "array"
                      : Number.isInteger(value)
                        ? "integer"
                        : typeof value;
        assert(
            types.includes(actual) ||
                (actual === "integer" && types.includes("number")),
            `type ${JSON.stringify(value)} expected ${shape.type}`
        );
    }
    if (typeof value === "number") {
        assert(Number.isFinite(value));
        if (shape.minimum !== undefined) assert(value >= shape.minimum);
        if (shape.maximum !== undefined) assert(value <= shape.maximum);
    }
    if (typeof value === "string" && shape.pattern)
        assert(new RegExp(shape.pattern).test(value));
    if (Array.isArray(value)) {
        if (shape.maxItems !== undefined)
            assert(value.length <= shape.maxItems);
        value.forEach((item) => schema(item, shape.items, wire));
    } else if (value && typeof value === "object") {
        (shape.required || []).forEach((key) =>
            assert(Object.hasOwn(value, key), `required ${key}`)
        );
        Object.keys(value).forEach((key) => {
            if (shape.additionalProperties === false)
                assert(Object.hasOwn(shape.properties, key), `extra ${key}`);
            if (shape.properties[key])
                schema(value[key], shape.properties[key], wire);
        });
    }
}
function fakeHls() {
    const listeners = new Map();
    return {
        autoLevelEnabled: true,
        config: {},
        count() {
            return [...listeners.values()].reduce((n, set) => n + set.size, 0);
        },
        emit(name, data) {
            name = Hls.Events[name] || name;
            [...(listeners.get(name) || [])].forEach((fn) => fn(name, data));
        },
        levels: [{ bitrate: 4000, height: 360, width: 640 }],
        off(name, fn) {
            name = Hls.Events[name] || name;
            listeners.get(name)?.delete(fn);
        },
        on(name, fn) {
            name = Hls.Events[name] || name;
            if (!listeners.has(name)) listeners.set(name, new Set());
            listeners.get(name).add(fn);
        },
    };
}
function fixture(options = {}) {
    const w = new JSDOM("<!doctype html><video id='video'></video>").window;
    let time = 10000,
        wall = 1700000000000,
        serial = 0,
        currentRuntime = "runtime-1",
        observer;
    const timers = new Map(),
        frames = new Map(),
        listeners = new Set();
    w.Date = { now: () => wall };
    w.performance.now = options.wall ? undefined : () => time;
    Object.defineProperty(w.document, "visibilityState", {
        configurable: true,
        value: "visible",
    });
    w.setTimeout = (fn, delay) => {
        const id = ++serial;
        timers.set(id, { at: time + delay, fn });
        return id;
    };
    w.clearTimeout = (id) => timers.delete(id);
    w.requestAnimationFrame = (fn) => {
        const id = ++serial;
        frames.set(id, fn);
        return id;
    };
    w.cancelAnimationFrame = (id) => frames.delete(id);
    w.PerformanceObserver = class {
        static supportedEntryTypes = ["longtask"];
        constructor(fn) {
            observer = this;
            this.fn = fn;
            this.connected = false;
        }
        observe() {
            this.connected = true;
        }
        disconnect() {
            this.connected = false;
        }
    };
    w.Hls = { Events: Hls.Events };
    const media = w.document.getElementById("video");
    let ranges = [[0, 20]],
        total = 0,
        dropped = 0,
        position = 4,
        hls = fakeHls(),
        generation = 1,
        id = 1;
    Object.defineProperties(media, {
        buffered: {
            get: () => ({
                end: (i) => ranges[i][1],
                length: ranges.length,
                start: (i) => ranges[i][0],
            }),
        },
        currentSrc: {
            get() {
                throw new Error("URL MUST NOT BE READ");
            },
        },
        currentTime: { get: () => position },
        networkState: { value: 2 },
        paused: { value: false },
        playbackRate: { value: 1 },
        readyState: { value: 4 },
        videoHeight: { value: 1080 },
        videoWidth: { value: 1920 },
    });
    media.getVideoPlaybackQuality = () => ({
        corruptedVideoFrames: 0,
        droppedVideoFrames: dropped,
        totalVideoFrames: total,
    });
    const attempt = {
        attachment: 1,
        engineStarts: 1,
        fatalErrors: 0,
        nativeFallbacks: 0,
        streamRetries: 0,
    };
    let handle = {
        diagnosticAttempt: () => attempt,
        diagnosticEngine: () => "hls.js",
        diagnosticMedia: () => ({ generation, hls, media }),
        id,
    };
    const backend = {
        current: (lane) => (lane === "main" ? handle : null),
        lastAttempt: () => null,
        subscribe: (fn) => {
            listeners.add(fn);
            return () => listeners.delete(fn);
        },
    };
    w.__ottCoreBackendPeek = () => backend;
    w.__ottClassicPlayback = { snapshot: () => ({ generation }) };
    const config = {
        address: "https://SECRET.invalid",
        enabled: true,
        token: "SECRET",
    };
    const context = { Date: w.Date, exports: {}, Promise, window: w };
    context.require = () => ({
        loadRemoteFeature() {
            throw Error("unexpected detail load");
        },
    });
    vm.runInNewContext(code("runtime-debug-details"), context);
    vm.runInNewContext(runtime, context);
    w.__ottRuntimeDebug = context.exports.installRuntimeDebug(w, {
        getConfig: () => config,
        runtime: () => currentRuntime,
    });
    const visibilityListeners = new Set();
    const addEvent = w.document.addEventListener.bind(w.document);
    const removeEvent = w.document.removeEventListener.bind(w.document);
    w.document.addEventListener = (type, listener, options) => {
        if (type === "visibilitychange") visibilityListeners.add(listener);
        addEvent(type, listener, options);
    };
    w.document.removeEventListener = (type, listener, options) => {
        if (type === "visibilitychange") visibilityListeners.delete(listener);
        removeEvent(type, listener, options);
    };
    vm.runInNewContext(sensors, context);
    vm.runInNewContext(controls, context);
    let emit;
    const createSensors = w.__ottPerfSensors.create;
    w.__ottPerfSensors.create = (host, ports) => {
        emit = ports.emit;
        return createSensors(host, ports);
    };
    const api = w.__ottPerfCaptureFactory.create(w, () => currentRuntime),
        receipts = [];
    function request(op, extra = {}, input = {}) {
        const params = {
            op,
            runtime: currentRuntime,
            version: options.version || 1,
            ...(op === "status" ? {} : { session_id: "a".repeat(32) }),
            ...extra,
        };
        const result = clone(api.request({ params, ...input }));
        const wire = params.version === 2 ? hlsContract : contract;
        if (result.status === "ok")
            schema(result.data, wire.responses[op], wire);
        else if (op in wire.requests) schema(result.data, wire.error, wire);
        receipts.push({ params, response: result });
        return result;
    }
    function advance(ms, fire = true) {
        time += ms;
        wall += ms;
        if (fire) {
            const ready = [...timers].filter(([, t]) => t.at <= time);
            for (const [key, t] of ready) if (timers.delete(key)) t.fn();
        }
    }
    return {
        advance,
        api,
        attempt,
        backend,
        close() {
            w.__ottRuntimeDebug.dispose();
            w.close();
        },
        config,
        count: (a, b = 0) => {
            total = a;
            dropped = b;
        },
        emit: (...args) => emit(...args),
        frames,
        get hls() {
            return hls;
        },
        media,
        get observer() {
            return observer;
        },
        position: (v) => (position = v),
        receipts,
        replace() {
            const old = hls;
            hls = fakeHls();
            generation++;
            handle = { ...handle, id: ++id };
            listeners.forEach((fn) => fn({ type: "open" }));
            return old;
        },
        request,
        runtime: (v) => (currentRuntime = v),
        setRanges: (v) => (ranges = v),
        timers,
        visibility(value) {
            Object.defineProperty(w.document, "visibilityState", {
                configurable: true,
                value,
            });
            w.document.dispatchEvent(new w.Event("visibilitychange"));
        },
        visibilityListeners,
        w,
        wall: (v) => (wall = v),
    };
}
const tests = [];
function test(name, fn) {
    tests.push({ fn, name });
}
const all = (f) => f.request("read", { after_seq: 0 }).data;
test("default off, status-only and stop cleanup leave no performance listeners or timers", () => {
    const f = fixture();
    assert.equal(f.timers.size, 0);
    assert.equal(f.hls.count(), 0);
    assert.equal(f.request("status").data.session, null);
    const start = f.request("start");
    assert.equal(start.data.session.state, "active");
    assert.equal(f.hls.count(), 5);
    assert.equal(f.observer.connected, true);
    assert.equal(f.frames.size, 0);
    f.advance(1000);
    const sample = all(f).events.find((x) => x.kind === "sample");
    assert.equal(sample.data.frames.total, 0);
    assert.equal(sample.data.frames.source, "quality");
    f.request("stop");
    assert.equal(f.hls.count(), 0);
    assert.equal(f.observer.connected, false);
    assert.equal(f.timers.size, 1); // bounded stopped-report retention only
    f.advance(300000);
    assert.equal(f.timers.size, 0);
    assert.equal(f.request("status").data.session, null);
    f.close();
});
test("idempotent active/stopped starts do not renew or silently change options", () => {
    const f = fixture();
    f.request("start", { duration_seconds: 10 });
    f.advance(3000);
    const a = f.request("start", { duration_seconds: 10 }).data.session;
    assert.equal(a.remaining_ms, 7000);
    assert.equal(f.request("start").data.error, "busy");
    f.advance(7000);
    assert.equal(f.request("status").data.session.reason, "expired");
    assert.equal(
        f.request("start", { duration_seconds: 10 }).data.session.state,
        "stopped"
    );
    assert.equal(
        f.request("start", { duration_seconds: 10, session_id: "b".repeat(32) })
            .data.session.state,
        "active"
    );
    f.close();
});
test("fragment and part stats use their owner, buffered reports final stages, schemas redact canaries", () => {
    const f = fixture();
    f.request("start");
    f.advance(1000, false);
    const stats = {
        buffering: { end: 10044, start: 10043 },
        loaded: 512,
        loading: { end: 10040, first: 10020, start: 10010 },
        parsing: { end: 10042, start: 10041 },
        retry: 2,
    };
    f.hls.emit("FRAG_LOADED", {
        frag: { level: 0, sn: 9, stats },
        networkDetails: { status: 206, url: "SECRET" },
        stats: { loaded: 999 },
    });
    f.hls.emit("FRAG_BUFFERED", {
        frag: { level: 0, sn: 9, stats },
        networkDetails: { status: 200 },
        part: { index: 1, stats: { ...stats, loaded: 123 } },
    });
    f.hls.emit("LEVEL_SWITCHED", { level: 0 });
    f.hls.emit("ERROR", {
        details: "bufferStalledError",
        fatal: false,
        type: "mediaError",
    });
    const events = all(f).events,
        fragment = events.find((e) => e.data.event === "fragment"),
        buffered = events.find((e) => e.data.event === "fragment_buffered");
    assert.equal(fragment.data.bytes, 512);
    assert.equal(fragment.data.load_start_ms, 10);
    assert.equal(buffered.data.bytes, 123);
    assert.equal(buffered.data.buffer_duration_ms, 1);
    assert.equal(
        events.find((e) => e.data.event === "error").data.detail,
        "buffer_stalled_error"
    );
    assert(!JSON.stringify(events).includes("SECRET"));
    f.close();
});
test("contiguous buffer never crosses a gap, 8 adjacent ranges are bounded and unsupported frames remain null", () => {
    const f = fixture();
    f.setRanges([
        [0, 2],
        [8, 20],
    ]);
    f.request("start");
    f.advance(1000);
    assert.equal(
        all(f).events.find((e) => e.kind === "sample").data
            .buffer_ahead_seconds,
        0
    );
    f.setRanges(Array.from({ length: 30 }, (_, i) => [i * 10, i * 10 + 5]));
    f.position(142);
    f.media.getVideoPlaybackQuality = undefined;
    f.advance(1000);
    const samples = all(f).events.filter((e) => e.kind === "sample"),
        s = samples.at(-1).data;
    assert.equal(s.buffer_ahead_seconds, 3);
    assert.equal(s.buffered.ranges.length, 8);
    assert.equal(s.buffered.truncated_count, 22);
    assert(s.buffered.ranges.some((r) => r.index === 14));
    assert.equal(s.frames.source, "unsupported");
    assert.equal(s.frames.total, null);
    f.close();
});
test("source replacement continues the lease and detaches retired HLS callbacks", () => {
    const f = fixture();
    f.request("start");
    const old = f.replace();
    assert.equal(old.count(), 0);
    assert.equal(f.hls.count(), 5);
    f.advance(1000);
    const result = all(f);
    assert.equal(result.session.state, "active");
    const changes = result.events.filter(
        (e) => e.kind === "session" && e.data.event === "source_changed"
    );
    assert.equal(changes.length, 2);
    assert.notEqual(changes[0].source_id, changes[1].source_id);
    assert.equal(changes[1].generation, 2);
    f.close();
});
test("rate drops advance sequence, bounded pages report gaps and terminal event is retained", () => {
    const f = fixture();
    f.request("start");
    for (let i = 0; i < 100; i++)
        f.hls.emit("ERROR", { details: "canary", type: "networkError" });
    let page = all(f);
    assert(page.session.rate_dropped > 0);
    assert.equal(page.next_after_seq, page.session.next_seq - 1);
    f.request("stop");
    page = all(f);
    assert.equal(page.events.at(-1).data.event, "stopped");
    assert(page.events.length <= 64);
    assert(Buffer.byteLength(JSON.stringify(page)) <= 61440);
    f.close();
});
test("notification tracing only records actual phases with fixed image bounds and no content", () => {
    const f = fixture();
    f.request("start");
    const t = f.w.__ottPerfSink.notification(
        { bytes: 100, height: 360, id: "SECRET", text: "SECRET", width: 640 },
        () => 1
    );
    t.stage("received");
    t.phase("fetch", false);
    f.advance(10, false);
    t.phase("fetch", true);
    t.phase("base64", false);
    f.advance(2, false);
    t.phase("base64", true);
    t.stage("shown");
    const s = all(f)
        .events.filter((e) => e.kind === "notification")
        .at(-1).data;
    assert.equal(s.fetch_ms, 10);
    assert.equal(s.base64_ms, 2);
    assert.equal(s.decode_ms, null);
    assert.equal(s.queue_ms, null);
    assert(!JSON.stringify(s).includes("SECRET"));
    f.close();
});
test("runtime/config retirement discards report and pagehide stops observation", () => {
    const f = fixture();
    f.request("start", { raf: true });
    assert.equal(f.frames.size, 1);
    f.w.dispatchEvent(new f.w.Event("pagehide"));
    assert.equal(f.frames.size, 0);
    assert.equal(f.hls.count(), 0);
    f.w.dispatchEvent(new f.w.Event("pageshow"));
    assert.equal(f.request("status").data.session.reason, "page_hidden");
    f.request("start", { session_id: "b".repeat(32) });
    f.config.token = "CHANGED";
    f.w.__ottRuntimeDebug.configurationChanged();
    assert.equal(f.request("status").data.session, null);
    assert.equal(f.hls.count(), 0);
    f.close();
});
test("large-event paging counts UTF-8 bytes, ring eviction is truthful and oversized events consume sequence", () => {
    const f = fixture();
    f.request("start", { duration_seconds: 600 });
    f.setRanges(
        Array.from({ length: 8 }, (_, i) => [
            i * 10.123456789,
            i * 10.123456789 + 5.123456789,
        ])
    );
    f.advance(1000);
    const sample = all(f).events.find((e) => e.kind === "sample").data;
    for (const key of Object.keys(f.attempt)) f.attempt[key] = 9007199254740991;
    sample.attempt = { ...f.attempt };
    sample.last_attempt = {
        ...f.attempt,
        generation: 9007199254740991,
        handleId: 9007199254740991,
        reason: "disposed",
    };
    for (let i = 0; i < 800; i++) {
        f.advance(50, false);
        f.emit("sample", "main", sample, {
            generation: 9007199254740991,
            handleId: 9007199254740991,
            sourceId: "s1000",
        });
    }
    f.emit("notification", null, { canary: "x".repeat(3000) });
    const status = f.request("status").data.session;
    assert(status.ring_dropped > 0);
    assert.equal(status.oversized_dropped, 1);
    assert(status.bytes <= 524288);
    assert(status.event_count <= 1023);
    let cursor = 0,
        pages = 0,
        count = 0;
    do {
        const p = f.request("read", { after_seq: cursor, limit: 64 }).data;
        assert(p.events.length <= 64);
        assert(Buffer.byteLength(JSON.stringify(p)) <= 61440);
        if (!pages) assert(p.lost_before > 0);
        if (p.more) assert(p.next_after_seq > cursor);
        cursor = p.next_after_seq;
        count += p.events.length;
        pages++;
        if (!p.more) break;
    } while (pages < 32);
    assert.equal(count, status.event_count);
    assert.equal(cursor, status.next_seq - 1);
    assert(pages < 32);
    f.request("stop");
    assert.equal(
        f.request("read", { after_seq: cursor }).data.events.at(-1).data.event,
        "stopped"
    );
    f.close();
});
test("wall-clock fallback is nondecreasing and invalidates cross-regression phase durations", () => {
    const f = fixture({ wall: true });
    assert.equal(f.request("start").data.session.clock, "wall_fallback");
    const n = f.w.__ottPerfSink.notification(null, () => 0);
    n.phase("fetch", false);
    f.advance(10, false);
    f.wall(1600000000000);
    n.phase("fetch", true);
    n.stage("shown");
    const page = all(f);
    assert.equal(page.events.at(-1).data.fetch_ms, null);
    assert(page.events.every((e, i, es) => !i || e.at_ms >= es[i - 1].at_ms));
    f.advance(120000);
    assert.equal(f.request("status").data.session.state, "stopped");
    f.close();
});
test("requested raf and LongTasks aggregate only finite bounded entries and stop completely", () => {
    const f = fixture();
    f.request("start", { raf: true });
    for (let i = 0; i < 3; i++) {
        f.advance(16, false);
        for (const [id, fn] of [...f.frames]) {
            f.frames.delete(id);
            fn();
        }
    }
    f.observer.fn({
        getEntries: () =>
            Array.from({ length: 100 }, (_, index) => ({
                get attribution() {
                    throw new Error("private attribution read");
                },
                duration: 60,
                get startTime() {
                    assert(
                        index < 64,
                        "overflow entries must not be inspected"
                    );
                    return 10000;
                },
            })),
    });
    f.advance(1000);
    const loop = all(f).events.find((e) => e.kind === "loop").data;
    assert.equal(loop.raf_callbacks, 3);
    assert.equal(loop.long_tasks, 64);
    assert.equal(loop.long_task_entries_dropped, 36);
    f.request("stop");
    assert.equal(f.frames.size, 0);
    assert.equal(f.observer.connected, false);
    f.close();
});
test("visibility transitions discard hidden loop, RAF and queued LongTask intervals", async () => {
    const f = fixture();
    f.request("status");
    f.w.__ottRuntimeDebug.configurationChanged();
    const baseline = f.visibilityListeners.size;
    f.request("start", { raf: true });
    const firstObserver = f.observer;
    const firstFrame = [...f.frames.values()][0];
    f.advance(1000);
    const before = all(f).events.filter(
        (event) => event.kind === "loop"
    ).length;
    firstObserver.fn({
        getEntries: () => [{ duration: 60, startTime: 10500 }],
    });
    f.visibility("hidden");
    f.advance(4000);
    assert.equal(
        all(f).events.filter((event) => event.kind === "loop").length,
        before,
        "Hidden timer intervals must not become loop observations"
    );
    assert.equal(f.frames.size, 0);
    assert.equal(firstObserver.connected, false);
    firstObserver.fn({
        getEntries: () => [{ duration: 3000, startTime: 11000 }],
    });
    f.visibility("visible");
    const resumed = f.observer;
    assert.notEqual(resumed, firstObserver);
    // Already-queued callbacks and a task spanning the visibility boundary
    // must not enter the fresh visible observation window.
    firstObserver.fn({
        getEntries: () => [{ duration: 3000, startTime: 11000 }],
    });
    firstFrame();
    resumed.fn({ getEntries: () => [{ duration: 200, startTime: 14900 }] });
    f.advance(100, false);
    for (const [id, fn] of [...f.frames]) {
        f.frames.delete(id);
        fn();
    }
    resumed.fn({ getEntries: () => [{ duration: 60, startTime: 15010 }] });
    f.advance(900);
    const loop = all(f)
        .events.filter((event) => event.kind === "loop")
        .at(-1).data;
    assert.equal(loop.window_ms, 1000);
    assert.equal(loop.max_delay_ms, 0);
    assert.equal(loop.raf_callbacks, 1);
    assert.equal(loop.raf_max_gap_ms, null);
    assert.equal(loop.long_tasks, 1);
    assert.equal(loop.long_tasks_total_ms, 60);
    assert.equal(loop.long_task_entries_dropped, 0);
    f.visibility("hidden");
    f.advance(5000, false); // Browsers may suspend every timer while hidden.
    f.visibility("visible");
    f.advance(1000);
    const afterSuspension = all(f)
        .events.filter((event) => event.kind === "loop")
        .at(-1).data;
    assert.equal(afterSuspension.window_ms, 1000);
    assert.equal(afterSuspension.max_delay_ms, 0);
    assert.equal(afterSuspension.long_tasks, 0);
    assert.equal(afterSuspension.raf_callbacks, 0);
    const metrics = (await f.w.__ottRuntimeDebug.snapshot()).metrics;
    assert.equal(metrics.loopMaxDelayMs, 0);
    assert.equal(f.visibilityListeners.size, baseline + 1);
    f.request("stop");
    assert.equal(f.visibilityListeners.size, baseline);
    assert.equal(f.frames.size, 0);
    assert.equal(resumed.connected, false);
    f.close();
    assert.equal(f.visibilityListeners.size, 0);
});
test("capture started hidden waits for a visible timing baseline and removes its listener on pagehide", () => {
    const f = fixture();
    f.w.__ottRuntimeDebug.configurationChanged();
    const baseline = f.visibilityListeners.size;
    f.visibility("hidden");
    f.request("start", { raf: true });
    f.advance(5000);
    assert.equal(
        all(f).events.filter((event) => event.kind === "loop").length,
        0
    );
    assert.equal(f.frames.size, 0);
    assert.equal(f.observer, undefined);
    f.visibility("visible");
    f.advance(1000);
    assert.equal(
        all(f).events.find((event) => event.kind === "loop").data.window_ms,
        1000
    );
    f.w.dispatchEvent(new f.w.Event("pagehide"));
    assert.equal(f.visibilityListeners.size, baseline);
    assert.equal(f.frames.size, 0);
    assert.equal(f.observer.connected, false);
    f.w.dispatchEvent(new f.w.Event("pageshow"));
    assert.equal(f.request("status").data.session.reason, "page_hidden");
    f.close();
});
test("wall fallback cannot assign LongTask startTime to a visible window", () => {
    const f = fixture({ wall: true });
    const start = f.request("start").data.session;
    assert.equal(start.clock, "wall_fallback");
    assert.equal(start.supported.long_tasks, false);
    f.advance(1000);
    assert.equal(
        all(f).events.find((event) => event.kind === "loop").data.long_tasks,
        null
    );
    f.close();
});
test("observer failure on visibility resume retires capture without changing its support contract", () => {
    const f = fixture();
    f.request("start", { raf: true });
    f.visibility("hidden");
    const Observer = f.w.PerformanceObserver;
    f.w.PerformanceObserver = class extends Observer {
        observe() {
            throw Error("observer no longer available");
        }
    };
    f.visibility("visible");
    const session = f.request("status").data.session;
    assert.equal(session.state, "stopped");
    assert.equal(session.reason, "unsupported");
    assert.equal(session.supported.long_tasks, true);
    assert.equal(f.frames.size, 0);
    assert.equal(f.hls.count(), 0);
    f.close();
});
test("all event families produce a real controller-validation corpus", () => {
    const f = fixture();
    f.request("start");
    f.advance(1000);
    f.media.dispatchEvent(new f.w.Event("waiting"));
    f.hls.emit("LEVEL_SWITCHED", { level: 0 });
    f.hls.emit("FRAG_BUFFERED", {
        frag: {
            level: 0,
            sn: 1,
            stats: {
                buffering: { end: 10007, start: 10006 },
                loaded: 123,
                loading: { end: 10003, first: 10002, start: 10001 },
                parsing: { end: 10005, start: 10004 },
                retry: 0,
            },
        },
    });
    f.w.__ottPerfSink.recovery("engineStarts");
    const n = f.w.__ottPerfSink.notification(null, () => 0);
    n.stage("received");
    n.stage("shown");
    f.request("stop");
    all(f);
    if (process.env.OTT_PERF_CORPUS)
        fs.writeFileSync(
            process.env.OTT_PERF_CORPUS,
            JSON.stringify(f.receipts, null, 2) + "\n",
            { mode: 0o600 }
        );
    f.close();
});
test("inconsistent and throwing quality counters remain a valid partial observation", () => {
    const f = fixture();
    f.request("start");
    f.count(10, 11);
    f.advance(1000);
    let frame = all(f)
        .events.filter((e) => e.kind === "sample")
        .at(-1).data.frames;
    assert.equal(frame.total, 10);
    assert.equal(frame.dropped, null);
    f.media.getVideoPlaybackQuality = () => ({
        get droppedVideoFrames() {
            throw Error("platform getter");
        },
        totalVideoFrames: 4,
    });
    f.advance(1000);
    frame = all(f)
        .events.filter((e) => e.kind === "sample")
        .at(-1).data.frames;
    assert.equal(frame.source, "quality");
    assert.equal(frame.total, 4);
    assert.equal(frame.dropped, null);
    f.close();
});
test("legacy snapshots expose timing only during an explicit active capture", async () => {
    const f = fixture();
    assert.equal(
        (await f.w.__ottRuntimeDebug.snapshot()).metrics.loopSamples,
        undefined
    );
    f.request("start");
    f.advance(2000);
    let metrics = (await f.w.__ottRuntimeDebug.snapshot()).metrics;
    assert.equal(metrics.loopDelayMs, 1000);
    assert.equal(metrics.loopSamples, 1);
    f.request("stop");
    assert.equal(
        (await f.w.__ottRuntimeDebug.snapshot()).metrics.loopSamples,
        undefined
    );
    f.close();
});
test("clock rollback remains unavailable until recovery, without synthetic zero phase durations", () => {
    const f = fixture({ wall: true });
    f.request("start");
    f.advance(1000, false);
    f.wall(1600000000000);
    const n = f.w.__ottPerfSink.notification(null, () => 0);
    n.phase("fetch", false);
    f.advance(1000);
    n.phase("fetch", true);
    n.phase("base64", false);
    f.advance(1000);
    n.phase("base64", true);
    n.stage("shown");
    const event = all(f)
        .events.filter((e) => e.kind === "notification")
        .at(-1);
    assert.equal(event.data.fetch_ms, null);
    assert.equal(event.data.base64_ms, null);
    assert.equal(all(f).events.filter((e) => e.kind === "loop").length, 0);
    f.close();
});
test("throwing performance clock selects explicit wall fallback", () => {
    const f = fixture();
    f.w.performance.now = () => {
        throw Error("clock unsupported");
    };
    assert.equal(f.request("start").data.session.clock, "wall_fallback");
    f.close();
});
test("partial WebKit getters and unavailable quality use the truthful source", () => {
    const f = fixture();
    f.request("start");
    f.media.getVideoPlaybackQuality = undefined;
    f.media.webkitDecodedFrameCount = 1;
    Object.defineProperty(f.media, "webkitDroppedFrameCount", {
        configurable: true,
        get() {
            throw Error("getter unavailable");
        },
    });
    f.advance(1000);
    let frame = all(f)
        .events.filter((e) => e.kind === "sample")
        .at(-1).data.frames;
    assert.equal(frame.source, "webkit");
    assert.equal(frame.total, 1);
    assert.equal(frame.dropped, null);
    f.media.getVideoPlaybackQuality = () => ({
        corruptedVideoFrames: NaN,
        droppedVideoFrames: NaN,
        totalVideoFrames: NaN,
    });
    Object.defineProperty(f.media, "webkitDroppedFrameCount", { value: 0 });
    f.advance(1000);
    frame = all(f)
        .events.filter((e) => e.kind === "sample")
        .at(-1).data.frames;
    assert.equal(frame.source, "webkit");
    assert.equal(frame.total, 1);
    assert.equal(frame.dropped, 0);
    f.close();
});
test("a thrown clock read invalidates the recovery boundary", () => {
    const f = fixture();
    f.request("start");
    const now = f.w.performance.now;
    f.w.performance.now = () => {
        throw Error("clock transient failure");
    };
    const n = f.w.__ottPerfSink.notification(null, () => 0);
    n.phase("fetch", false);
    f.advance(1000, false);
    f.w.performance.now = now;
    n.phase("fetch", true);
    n.phase("base64", false);
    f.advance(20, false);
    n.phase("base64", true);
    n.stage("shown");
    const event = all(f)
        .events.filter((e) => e.kind === "notification")
        .at(-1);
    assert.equal(event.data.fetch_ms, null);
    assert.equal(event.data.base64_ms, 20);
    f.close();
});
test("fallback HTML observation retains the main playback generation", () => {
    const f = fixture();
    f.backend.current = () => null;
    f.request("start");
    f.advance(1000);
    const event = all(f).events.find((e) => e.kind === "sample");
    assert.equal(event.generation, 1);
    assert.equal(event.handle_id, null);
    f.close();
});
test("HLS detail capture is opt-in and legacy requests cannot access or stop it", () => {
    const f = fixture({ version: 2 });
    f.request("status");
    assert.equal(f.hls.count(), 0);
    const started = f.request("start").data.session;
    assert.equal(started.capture_version, 2);
    assert.equal(f.hls.count(), 6);
    for (const op of ["status", "read", "stop", "start"]) {
        const args = { version: 1 };
        if (op === "read") args.after_seq = 0;
        assert.equal(f.request(op, args).data.error, "unsupported");
        assert.equal(f.request("status").data.session.state, "active");
    }
    assert.equal(
        f.request("start", {
            session_id: "b".repeat(32),
            version: 1,
        }).data.error,
        "unsupported"
    );
    f.request("stop");
    assert.equal(f.hls.count(), 0);
    assert.equal(f.request("start", { version: 1 }).data.error, "unsupported");
    assert.equal(
        f.request("start", {
            session_id: "b".repeat(32),
            version: 1,
        }).status,
        "ok"
    );
    assert.equal(f.hls.count(), 5);
    assert.equal(f.request("status").data.session.capture_version, 1);
    assert.equal(
        f.request("status", { version: 1 }).data.session.capture_version,
        undefined
    );
    f.close();
    const legacy = fixture();
    legacy.request("start");
    assert.equal(
        legacy.request("status", { version: 2 }).data.session.capture_version,
        1
    );
    assert.equal(legacy.request("start", { version: 2 }).data.error, "busy");
    legacy.hls.emit(Hls.Events.BUFFER_APPENDED, { timeRanges: {} });
    legacy.advance(1000);
    assert(!all(legacy).events.some((event) => event.kind.startsWith("hls_")));
    assert.equal(
        legacy.request("stop", { version: 2 }).data.session.state,
        "stopped"
    );
    legacy.close();
});
const timeRanges = (ranges) => ({
    end: (i) => ranges[i][1],
    length: ranges.length,
    start: (i) => ranges[i][0],
});
test("public append snapshots are immediate, per-track, bounded and never synthesized", () => {
    const f = fixture({ version: 2 });
    f.request("start");
    f.advance(1000);
    assert(!all(f).events.some((event) => event.kind === "hls_buffer"));
    f.position(142);
    const audio = Array.from({ length: 30 }, (_, i) => [i * 10, i * 10 + 5]);
    const video = [
        [130, 140],
        [142.25, 160],
    ];
    f.hls.emit(Hls.Events.BUFFER_APPENDED, {
        chunkMeta: {},
        data: "SECRET PAYLOAD",
        frag: { sn: 20 },
        parent: "main",
        part: null,
        timeRanges: { audio: timeRanges(audio), video: timeRanges(video) },
        type: "video",
        url: "SECRET URL",
    });
    audio[14][1] = 9999;
    video[1][0] = 9999;
    let records = all(f).events.filter((event) => event.kind === "hls_buffer");
    assert.equal(records.length, 2);
    assert.equal(records[0].at_ms, 1000);
    assert.equal(records[0].data.position_seconds, 142);
    assert.equal(records[0].data.buffered.range_count, 30);
    assert.equal(records[0].data.buffered.truncated_count, 22);
    assert.equal(
        records[0].data.buffered.ranges.find((r) => r.index === 14).end_seconds,
        145
    );
    assert.equal(records[1].data.buffered.ranges[1].start_seconds, 142.25);
    f.advance(1000);
    assert.equal(
        all(f).events.filter((event) => event.kind === "hls_buffer").length,
        2
    );
    f.hls.emit(Hls.Events.BUFFER_APPENDED, {
        timeRanges: {
            get audio() {
                throw Error("unavailable SourceBuffer");
            },
            video: timeRanges([[140, 160]]),
        },
        type: "video",
    });
    records = all(f).events.filter((event) => event.kind === "hls_buffer");
    assert.equal(records[2].data.buffered.range_count, null);
    assert.equal(records[3].data.buffered.ranges[0].end_seconds, 160);
    assert(!JSON.stringify(all(f)).includes("SECRET"));
    f.close();
});
test("fragment intervals and per-track PTS come from observed HLS fields", () => {
    const f = fixture({ version: 2 });
    f.request("start");
    f.advance(1000, false);
    const frag = {
        cc: 2,
        duration: 10,
        elementaryStreams: {
            audio: { endPTS: 9.875, startPTS: -0.125 },
            audiovideo: null,
            secret: { endPTS: 20, startPTS: 10 },
            video: { endPTS: 9.75, startPTS: 0 },
        },
        get end() {
            return this.start + this.duration;
        },
        endPTS: 9.875,
        level: 1,
        sn: 45,
        start: -0.25,
        startPTS: -0.125,
        stats: {
            buffering: { end: 10040, start: 10026 },
            loaded: 4000,
            loading: { end: 10020, first: 10010, start: 10001 },
            parsing: { end: 10025, start: 10021 },
        },
        url: "SECRET URL",
    };
    f.hls.emit(Hls.Events.FRAG_BUFFERED, {
        frag,
        part: null,
        stats: frag.stats,
    });
    const observed = all(f).events.find(
        (event) => event.kind === "hls_fragment"
    ).data;
    assert.equal(observed.fragment_sequence, 45);
    assert.equal(observed.discontinuity_counter, 2);
    assert.equal(observed.start_seconds, -0.25);
    assert.equal(observed.end_seconds, 9.75);
    assert.equal(observed.start_pts_seconds, -0.125);
    assert.equal(observed.elementary_streams.length, 2);
    assert.equal(observed.elementary_streams[1].end_pts_seconds, 9.75);
    const timing = all(f).events.find((event) => event.kind === "hls").data;
    assert.equal(timing.load_duration_ms, 19);
    assert.equal(timing.buffer_duration_ms, 14);
    f.hls.emit(Hls.Events.FRAG_LOADED, {
        frag: {
            elementaryStreams: { audio: { endPTS: 10, startPTS: 20 } },
            end: 1,
            endPTS: NaN,
            sn: "initSegment",
            start: 3,
            startPTS: Infinity,
        },
    });
    const invalid = all(f)
        .events.filter((event) => event.kind === "hls_fragment")
        .at(-1).data;
    assert.equal(invalid.fragment_sequence, null);
    assert.equal(invalid.start_seconds, null);
    assert.equal(invalid.end_seconds, null);
    assert.equal(invalid.start_pts_seconds, null);
    assert.equal(invalid.end_pts_seconds, null);
    assert.equal(invalid.elementary_streams[0].start_pts_seconds, null);
    assert(!JSON.stringify(all(f)).includes("SECRET"));
    f.close();
});
test("effective HLS config and public live timeline are sampled without extra timers", () => {
    const f = fixture({ version: 2 });
    f.hls.config = {
        backBufferLength: 15,
        highBufferWatchdogPeriod: 2,
        liveMaxLatencyDuration: undefined,
        liveMaxLatencyDurationCount: Infinity,
        liveSyncDuration: undefined,
        liveSyncDurationCount: 3,
        get loader() {
            throw Error("config must be allowlisted");
        },
        maxBufferHole: 0.1,
        maxBufferLength: 3,
        maxBufferSize: 32000000,
        maxMaxBufferLength: 60,
        nudgeMaxRetry: 3,
        nudgeOffset: 0.1,
    };
    f.hls.latestLevelDetails = { edge: 200.2, targetduration: 10.01 };
    f.hls.liveSyncPosition = 170.17;
    f.hls.latency = 33.2;
    f.hls.targetLatency = 30.03;
    f.hls.maxLatency = Infinity;
    f.hls.maxBufferLength = 1.28;
    f.hls.currentLevel = 0;
    f.hls.loadLevel = 1;
    let nextLoadReads = 0;
    Object.defineProperty(f.hls, "nextLoadLevel", {
        get() {
            nextLoadReads++;
            throw Error("effectful ABR getter must not be called");
        },
    });
    f.hls.levels = [
        {
            bitrate: 200000000,
            maxBitrate: 200000000,
            get url() {
                throw Error("must not read source URL");
            },
        },
        { bitrate: 4000000, maxBitrate: 6000000 },
    ];
    f.request("start");
    let config = all(f).events.find(
        (event) => event.kind === "hls_config"
    ).data;
    assert.equal(config.max_buffer_length_seconds, 3);
    assert.equal(config.live_sync_duration_count, 3);
    assert.equal(config.live_max_latency_duration_count, null);
    const timers = f.timers.size;
    f.advance(1000);
    let live = all(f).events.filter((event) => event.kind === "hls_live");
    assert.equal(live.length, 1);
    assert.equal(live[0].data.edge_seconds, 200.2);
    assert.equal(live[0].data.live_sync_position_seconds, 170.17);
    assert.equal(live[0].data.target_duration_seconds, 10.01);
    assert.equal(live[0].data.target_latency_seconds, 30.03);
    assert.equal(live[0].data.max_latency_seconds, null);
    assert.equal(live[0].data.effective_buffer_length_seconds, 1.28);
    assert.deepEqual(live[0].data.current_level, {
        bitrate: 200000000,
        index: 0,
        max_bitrate: 200000000,
    });
    assert.deepEqual(live[0].data.load_level, {
        bitrate: 4000000,
        index: 1,
        max_bitrate: 6000000,
    });
    assert.equal(nextLoadReads, 0);
    assert.equal(f.timers.size, timers);
    f.hls.config.maxBufferLength = 5;
    f.hls.config.nudgeMaxRetry = 1.5;
    f.hls.latestLevelDetails = {
        get edge() {
            throw Error("no playlist");
        },
        targetduration: 10.01,
    };
    f.hls.liveSyncPosition = NaN;
    f.hls.latency = -1;
    Object.defineProperty(f.hls, "maxBufferLength", {
        get() {
            throw Error("unavailable");
        },
    });
    f.hls.currentLevel = 0.5;
    f.hls.loadLevel = 65536;
    f.advance(1000);
    config = all(f).events.filter((event) => event.kind === "hls_config");
    assert.equal(config.length, 2);
    assert.equal(config[1].data.max_buffer_length_seconds, 5);
    assert.equal(config[1].data.nudge_max_retry, null);
    live = all(f).events.filter((event) => event.kind === "hls_live");
    assert.equal(live.length, 2);
    assert.equal(live[1].data.edge_seconds, null);
    assert.equal(live[1].data.live_sync_position_seconds, null);
    assert.equal(live[1].data.latency_seconds, -1);
    assert.equal(live[1].data.effective_buffer_length_seconds, null);
    assert.equal(live[1].data.current_level.index, null);
    assert.equal(live[1].data.load_level.index, null);
    f.hls.currentLevel = -1;
    f.hls.loadLevel = 4;
    f.advance(1000);
    assert.equal(
        all(f).events.filter((event) => event.kind === "hls_config").length,
        2
    );
    live = all(f).events.filter((event) => event.kind === "hls_live");
    assert.deepEqual(live[2].data.current_level, {
        bitrate: null,
        index: -1,
        max_bitrate: null,
    });
    assert.deepEqual(live[2].data.load_level, {
        bitrate: null,
        index: 4,
        max_bitrate: null,
    });
    assert.equal(nextLoadReads, 0);
    f.close();
});
test("extended capture keeps source ownership and byte ceilings with every HLS event family", () => {
    const f = fixture({ version: 2 });
    f.hls.latency = -0.25;
    f.request("start");
    f.advance(1000);
    f.hls.emit(Hls.Events.BUFFER_APPENDED, {
        timeRanges: { audio: timeRanges([[0, 10]]) },
        type: "audio",
    });
    f.hls.emit(Hls.Events.FRAG_BUFFERED, {
        frag: {
            cc: 0,
            elementaryStreams: { audio: { endPTS: 9.875, startPTS: -0.125 } },
            end: 10,
            endPTS: 9.875,
            sn: 1,
            start: -0.25,
            startPTS: -0.125,
        },
    });
    const old = f.replace();
    assert.equal(old.count(), 0);
    const before = all(f).events.length;
    old.emit(Hls.Events.BUFFER_APPENDED, {
        timeRanges: { audio: timeRanges([[0, 20]]) },
        type: "audio",
    });
    assert.equal(all(f).events.length, before);
    f.position(0);
    const maximum = Number.MAX_SAFE_INTEGER;
    f.hls.emit(Hls.Events.BUFFER_APPENDED, {
        timeRanges: {
            video: timeRanges(
                Array.from({ length: 8 }, (_, i) => [
                    -maximum + i * 1e12,
                    -maximum + i * 1e12 + 0.5e12,
                ])
            ),
        },
        type: "video",
    });
    const detail = all(f).events.filter((event) =>
        event.kind.startsWith("hls_")
    );
    assert(detail.every((event) => event.source_id && event.lane === "main"));
    assert(detail.some((event) => event.source_id === "s1"));
    assert(detail.some((event) => event.source_id !== "s1"));
    assert(
        all(f).events.every(
            (event) => Buffer.byteLength(JSON.stringify(event)) <= 2048
        )
    );
    assert.equal(all(f).session.oversized_dropped, 0);
    f.request("stop");
    assert.equal(f.hls.count(), 0);
    if (process.env.OTT_PERF_HLS_CORPUS)
        fs.writeFileSync(
            process.env.OTT_PERF_HLS_CORPUS,
            JSON.stringify(f.receipts, null, 2) + "\n",
            { mode: 0o600 }
        );
    f.close();
});
test("natural expiry retires extended capture before a fresh legacy start", () => {
    const f = fixture({ version: 2 });
    f.request("start", { duration_seconds: 10 });
    f.advance(11000, false);
    assert.equal(
        f.request("start", {
            duration_seconds: 10,
            session_id: "b".repeat(32),
            version: 1,
        }).status,
        "ok"
    );
    assert.equal(f.request("status").data.session.capture_version, 1);
    assert.equal(f.hls.count(), 5);
    f.close();
});
(async () => {
    let failures = 0;
    for (const { name, fn } of tests) {
        try {
            await fn();
            console.log("PASS perf: " + name);
        } catch (e) {
            failures++;
            console.error("FAIL perf: " + name + "\n" + e.stack);
        }
    }
    assert.equal(failures, 0);
    console.log(tests.length + " performance capture groups passed");
})().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
