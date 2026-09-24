const assert = require("node:assert/strict");
const vm = require("node:vm");
const runtime = require("./helpers/private-runtime.cjs");
function fixture(capacity = 8) {
    let source = "one",
        now = 100,
        nextTimer = 0;
    const tokens = { 1: {}, 2: {} };
    const timers = new Map(),
        requests = [];
    const host = {};
    host.window = host;
    vm.createContext(host);
    require("./helpers/shared-core-runtime.cjs")(host);
    runtime(host, "src/guide/service.ts");
    const service = host.__ottGuideService.create({
        capacity: () => capacity,
        clearTimer: (id) => timers.delete(id),
        context: () => source,
        current: (ref) =>
            ref.sourceId === source && ref.token === tokens[ref.id],
        decode: (_ref, rows) =>
            Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [],
        fetch(ref, done) {
            const request = { canceled: 0, done, ref };
            requests.push(request);
            return () => {
                request.canceled++;
                if (request.onCancel) request.onCancel();
            };
        },
        nextCount: () => 2,
        now: () => now,
        select: (rows, time, count) =>
            host.OttPlayCore.guideScheduleSelection(rows, time, count),
        timer(fn, delay) {
            const id = ++nextTimer;
            timers.set(id, { at: now + delay / 1000, fn });
            return id;
        },
    });
    return {
        advance(value) {
            now = value;
        },
        flush() {
            for (let limit = 0; limit < 100; limit++) {
                const due = [...timers]
                    .filter(([, timer]) => timer.at <= now)
                    .sort((a, b) => a[1].at - b[1].at)[0];
                if (!due) return;
                timers.delete(due[0]);
                due[1].fn();
            }
            throw Error("unbounded guide timer loop");
        },
        ref: (id = 1) => ({
            channelId: "channel:" + id,
            id,
            sourceId: source,
            token: tokens[id],
        }),
        requests,
        service,
        source(value) {
            source = value;
        },
        timers,
        tokens,
    };
}
const programme = (id, start = 90, end = 110) => ({
    description: "",
    end,
    id,
    start,
    title: id,
});
let passed = 0;
function check(name, run) {
    run();
    passed++;
    console.log("PASS guide service: " + name);
}
check("coalesces requests and detaches every response/projection", () => {
    const f = fixture(),
        got = [];
    f.service.request(f.ref(), (rows) => {
        got.push(rows);
        rows[0].title = "mutated";
    });
    f.service.request(f.ref(), (rows) => got.push(rows));
    f.flush();
    assert.equal(f.requests.length, 1);
    f.requests[0].done([programme("A")]);
    assert.equal(got[1][0].title, "A");
    assert.equal(f.service.peek(f.ref())[0].title, "A");
    const snapshot = f.service.snapshot(f.ref());
    snapshot.current.title = "changed";
    assert.equal(f.service.snapshot(f.ref()).current.title, "A");
});
check(
    "last consumer cancellation aborts without rejecting another consumer",
    () => {
        const f = fixture(),
            got = [];
        const a = f.service.request(f.ref(), () => got.push("a")),
            b = f.service.request(f.ref(), () => got.push("b"));
        f.flush();
        a();
        assert.equal(f.requests[0].canceled, 0);
        b();
        assert.equal(f.requests[0].canceled, 1);
        f.requests[0].done([programme("late")]);
        assert.deepEqual(got, []);
        assert.equal(f.service.snapshot(f.ref()), null);
    }
);
check(
    "old source completion cannot populate replacement cache or subscribers",
    () => {
        const f = fixture(),
            got = [];
        f.service.request(f.ref(), () => got.push("old"));
        f.flush();
        f.source("two");
        f.service.request(f.ref(), () => got.push("new"));
        f.flush();
        assert.equal(f.requests[0].canceled, 1);
        f.requests[0].done([programme("old")]);
        f.requests[1].done([programme("new")]);
        assert.deepEqual(got, ["new"]);
        assert.equal(f.service.peek(f.ref())[0].id, "new");
    }
);
check("clock follows half-open/latest-start schedule boundaries", () => {
    const f = fixture();
    f.service.subscribe(f.ref(), () => {});
    f.flush();
    f.requests[0].done([
        programme("long", 90, 120),
        programme("overlap", 105, 110),
        programme("next", 120, 140),
    ]);
    assert.equal(f.service.snapshot(f.ref()).current.id, "long");
    f.advance(105);
    f.flush();
    assert.equal(f.service.snapshot(f.ref()).current.id, "overlap");
    f.advance(110);
    f.flush();
    assert.equal(f.service.snapshot(f.ref()).current.id, "long");
    f.advance(120);
    f.flush();
    assert.equal(f.service.snapshot(f.ref()).current.id, "next");
    assert.equal(f.requests.length, 1);
});
check(
    "disabled full cache refetches at expiry once and keeps only projection",
    () => {
        const f = fixture(0);
        f.service.subscribe(f.ref(), () => {});
        f.flush();
        f.requests[0].done([programme("A")]);
        assert.equal(f.service.peek(f.ref()), null);
        assert.equal(f.service.snapshot(f.ref()).current.id, "A");
        f.advance(110);
        f.flush();
        assert.equal(f.requests.length, 2);
        f.flush();
        assert.equal(f.requests.length, 2);
    }
);
check(
    "warm invalidation transfers callbacks while preserving their cancellation handles",
    () => {
        const f = fixture(),
            got = [];
        const cancel = f.service.request(f.ref(), () => got.push("cancelled"));
        f.service.request(f.ref(), () => got.push("kept"));
        f.flush();
        f.service.invalidate(true);
        cancel();
        f.flush();
        assert.equal(f.requests.length, 2);
        f.requests[0].done([programme("stale")]);
        f.requests[1].done([programme("fresh")]);
        assert.deepEqual(got, ["kept"]);
    }
);
check("provider replacement drops callbacks and all scheduled work", () => {
    const f = fixture(),
        got = [];
    f.service.request(f.ref(), () => got.push("old"));
    f.flush();
    f.service.invalidate(false);
    f.requests[0].done([programme("stale")]);
    f.flush();
    assert.deepEqual(got, []);
    assert.equal(f.timers.size, 0);
});
check("cancel reentry cannot overwrite a newer channel revision", () => {
    const f = fixture(),
        got = [];
    f.service.request(f.ref(), () => got.push("A"));
    f.flush();
    f.requests[0].onCancel = () => {
        f.tokens[1] = {};
        f.service.request(f.ref(), () => got.push("C"));
    };
    f.tokens[1] = {};
    f.service.request(f.ref(), () => got.push("B"));
    f.flush();
    f.requests[1].done([programme("C")]);
    assert.deepEqual(got, ["C"]);
});
check("a failing UI callback cannot starve the next channel request", () => {
    const f = fixture(),
        got = [];
    f.service.request(f.ref(), () => {
        throw Error("detached UI");
    });
    f.service.request(f.ref(2), () => got.push("two"));
    f.flush();
    f.requests[0].done([programme("one")]);
    f.flush();
    f.requests[1].done([programme("two")]);
    assert.deepEqual(got, ["two"]);
});
check(
    "warm refresh subscriptions cancel their new fetch when the last observer leaves",
    () => {
        const f = fixture();
        const cancel = f.service.subscribe(f.ref(), () => {});
        f.flush();
        f.service.invalidate(true);
        f.flush();
        assert.equal(f.requests.length, 2);
        cancel();
        assert.equal(f.requests[1].canceled, 1);
    }
);

console.log(
    "PASS " + passed + " GuideService scenarios with compiled shared core"
);
