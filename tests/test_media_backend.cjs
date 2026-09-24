const assert = require("node:assert/strict");
const vm = require("node:vm");
const load = require("./helpers/private-runtime.cjs");
function fixture() {
    const context = vm.createContext({ console });
    context.window = context;
    for (const file of ["adapter", "media-backend", "media-session"])
        load(context, "src/device/" + file + ".ts");
    let domain = { generation: 1, kind: "vod", position: 0 };
    const commands = [],
        leases = [],
        timers = [];
    const ports = {
        clearInterval(id) {
            timers[id].active = false;
        },
        context: () => domain,
        emit(c, type, position, duration) {
            commands.push({
                duration,
                generation: c.generation,
                position,
                type,
            });
        },
        open(request, event) {
            const sample = {
                duration: 500,
                paused: true,
                position: 0,
                ready: 0,
            };
            const lease = {
                disposed: 0,
                event,
                request,
                sample,
                selections: [],
            };
            leases.push(lease);
            return {
                dispose() {
                    lease.disposed++;
                    if (lease.onDispose) lease.onDispose();
                },
                pause() {
                    sample.paused = true;
                    event("pause");
                },
                resume() {
                    sample.paused = false;
                    event("playing");
                },
                sample: () => sample,
                seek(value) {
                    sample.position = value;
                },
                selectTrack(kind, index) {
                    lease.selections.push([kind, index]);
                },
                tracks: () => [{ id: 0 }],
            };
        },
        setInterval(callback) {
            timers.push({ active: true, callback });
            return timers.length - 1;
        },
    };
    const backend = context.__ottMediaBackend.create(ports);
    return {
        backend,
        commands,
        context,
        domain(value) {
            domain = value;
        },
        leases,
        playing(index = 0, position = 0) {
            Object.assign(leases[index].sample, {
                paused: false,
                position,
                ready: 2,
            });
            leases[index].event("playing");
        },
        ports,
        timers,
    };
}
let passed = 0;
function test(name, run) {
    const f = fixture();
    try {
        run(f);
        console.log("PASS media backend: " + name);
        passed++;
    } finally {
        f.backend.dispose();
    }
}
test("a decoder lease and its timer retire once; old events cannot update replacement", (f) => {
    const old = f.backend.open({ url: "old" });
    f.playing();
    const stale = f.leases[0].event;
    const next = f.backend.open({ url: "new" });
    const before = f.commands.length;
    stale("playing");
    stale("timeupdate");
    old.pause();
    old.seek(80);
    old.dispose();
    assert.equal(f.commands.length, before);
    assert.equal(f.leases[0].disposed, 1);
    assert.equal(old.active(), false);
    assert.equal(next.active(), true);
    assert.equal(f.timers[0].active, false);
});
test("archive uses measured media delta, not wall ticks or buffering elapsed time", (f) => {
    f.domain({ generation: 1, kind: "archive", position: 15 });
    const h = f.backend.open({ url: "archive" });
    f.playing(0, 1200);
    assert.equal(h.snapshot().position, 15);
    for (let i = 0; i < 12; i++) f.timers[0].callback();
    assert.equal(h.snapshot().position, 15);
    f.leases[0].sample.position = 1203.5;
    f.leases[0].event("timeupdate");
    assert.equal(h.snapshot().position, 18.5);
    h.pause();
    f.timers[0].callback();
    assert.equal(h.snapshot().position, 18.5);
});
test("seek rebinds the existing decoder to the new archive generation", (f) => {
    f.domain({
        generation: 1,
        kind: "archive",
        position: 0,
        sourceActive: () => true,
    });
    const h = f.backend.open({ url: "archive" });
    f.playing(0, 100);
    f.domain({ generation: 2, kind: "archive", position: 20 });
    h.seek(999); // escaped handles cannot adopt a new generation
    assert.equal(f.leases[0].sample.position, 100);
    f.backend.seek(120); // explicit same-source device ingress
    f.leases[0].sample.position = 124;
    f.leases[0].event("timeupdate");
    assert.equal(h.snapshot().position, 24);
    assert.equal(f.commands.at(-1).generation, 2);
});
test("a source generation change rejects old backend observations", (f) => {
    f.backend.open({ url: "first" });
    f.playing();
    const before = f.commands.length;
    f.domain({ generation: 2, kind: "live", position: 0 });
    f.leases[0].sample.position = 50;
    f.leases[0].event("timeupdate");
    assert.equal(f.commands.length, before);
});
test("PiP and main have isolated disposal and track selection guards", (f) => {
    const main = f.backend.open({ url: "main" });
    const pip = f.backend.open({ lane: "pip", url: "pip" });
    main.selectTrack("audio", 2);
    assert.deepEqual(f.leases[0].selections, [["audio", 2]]);
    f.backend.stop("pip");
    assert.equal(main.active(), true);
    assert.equal(pip.active(), false);
    f.backend.open({ url: "replacement" });
    main.selectTrack("audio", 1);
    assert.equal(f.leases[0].selections.length, 1);
});
test("cleanup reentry keeps the latest requested handle and avoids abandoned engine startup", (f) => {
    f.backend.open({ url: "A" });
    f.leases[0].onDispose = () => f.backend.open({ url: "C" });
    const abandoned = f.backend.open({ url: "B" });
    assert.equal(abandoned.active(), false);
    assert.deepEqual(
        f.leases.map((x) => x.request.url),
        ["A", "C"]
    );
});
test("loading command reentry cannot start a retired request", (f) => {
    const emit = f.ports.emit;
    let replaced = false;
    f.ports.emit = (...args) => {
        emit(...args);
        if (!replaced) {
            replaced = true;
            f.backend.open({ url: "latest" });
        }
    };
    const abandoned = f.backend.open({ url: "old" });
    assert.equal(abandoned.active(), false);
    assert.deepEqual(
        f.leases.map((x) => x.request.url),
        ["latest"]
    );
});
test("snapshot is a pure value read without engine sampling or domain writes", (f) => {
    const h = f.backend.open({ url: "one" });
    f.playing(0, 10);
    const count = f.commands.length;
    f.leases[0].sample.position = 99;
    assert.equal(h.snapshot().position, 10);
    assert.equal(f.commands.length, count);
    const snapshot = h.snapshot();
    snapshot.position = 900;
    assert.equal(h.snapshot().position, 10);
});
test("OS observer subscribes once and stale refresh cannot update new media", (f) => {
    const calls = [],
        jobs = [];
    const observer = f.context.__ottOsMediaSession.create({
        backend: f.backend,
        clearInterval(id) {
            jobs[id].active = false;
        },
        clearTimeout(id) {
            jobs[id].active = false;
        },
        metadata: () => ({ seekable: true }),
        send(type) {
            calls.push(type);
        },
        setInterval(callback) {
            jobs.push({ active: true, callback });
            return jobs.length - 1;
        },
        setTimeout(callback) {
            jobs.push({ active: true, callback });
            return jobs.length - 1;
        },
    });
    const h = f.backend.open({ url: "first" });
    const stale = jobs[0].callback;
    f.playing();
    h.pause();
    h.resume();
    f.backend.open({ url: "second" });
    const count = calls.length;
    stale();
    assert.equal(calls.length, count);
    assert.deepEqual(calls.slice(0, 4), ["start", "pause", "resume", "stop"]);
    observer.dispose();
    f.backend.stop();
    assert.equal(calls.length, count);
    assert(jobs.every((x) => !x.active));
});
test("native pause and playing events resume OS metadata exactly once", (f) => {
    const calls = [],
        jobs = [];
    const schedule = (callback) => {
        jobs.push({ active: true, callback });
        return jobs.length - 1;
    };
    const cancel = (id) => {
        jobs[id].active = false;
    };
    const observer = f.context.__ottOsMediaSession.create({
        backend: f.backend,
        clearInterval: cancel,
        clearTimeout: cancel,
        metadata: () => ({ seekable: true }),
        send: (type) => calls.push(type),
        setInterval: schedule,
        setTimeout: schedule,
    });
    const handle = f.backend.open({ url: "native" });
    f.playing();
    f.leases[0].sample.paused = true;
    f.leases[0].event("pause");
    assert(jobs.every((job) => !job.active));
    f.playing();
    assert.deepEqual(calls, ["start", "pause", "resume"]);
    assert.equal(jobs.filter((job) => job.active).length, 1);
    handle.pause();
    handle.resume();
    assert.deepEqual(calls, ["start", "pause", "resume", "pause", "resume"]);
    assert.equal(jobs.filter((job) => job.active).length, 1);
    observer.dispose();
});
test("a retired source rejects observations and captured track/control callbacks before the next generation", (f) => {
    let active = true;
    f.domain({ active: () => active, generation: 1, kind: "vod", position: 0 });
    const handle = f.backend.open({ url: "source" });
    f.playing();
    const before = f.commands.length;
    active = false;
    f.leases[0].sample.position = 80;
    f.leases[0].event("timeupdate");
    handle.pause();
    handle.resume();
    handle.selectTrack("audio", 2);
    f.domain({
        active: () => true,
        generation: 2,
        kind: "archive",
        position: 100,
        sourceActive: () => true,
    });
    handle.seek(120);
    f.backend.seek(120);
    assert.equal(
        f.leases[0].sample.position,
        80,
        "old decoder cannot adopt a replacement source via seek"
    );
    assert.equal(handle.active(), false);
    assert.equal(f.commands.length, before);
    assert.deepEqual(f.leases[0].selections, []);
});
test("legacy device clock is explicit, elapsed-time based and does not mutate key maps", (f) => {
    let now = 0,
        managed = false,
        state = {
            generation: 1,
            phase: "playing",
            position: 3,
            target: { kind: "archive" },
        },
        playing = true;
    const writes = [],
        keys = { ENTER: 13 };
    const device = f.context.__ottDeviceAdapter.create({
        capabilities: () => ({ pip: true }),
        clearInterval() {},
        command(v) {
            writes.push(v);
            if (v.type === "position") state.position = v.position;
        },
        duration: () => 100,
        importLegacy: () => state,
        isManaged: () => managed,
        key: (e) => e.code,
        keys: () => keys,
        now: () => now,
        playing: () => playing,
        position: () => 0,
        route: () => "mag",
        setInterval: () => 1,
    });
    device.sampleLegacy();
    now = 3500;
    device.sampleLegacy();
    assert.equal(writes.at(-2).position, 6.5);
    playing = false;
    now = 4000;
    device.sampleLegacy();
    now = 14000;
    device.sampleLegacy();
    assert.equal(writes.at(-2).position, 7);
    playing = true;
    device.sampleLegacy();
    state.position = 100; // retained device seek, unchanged playback generation
    now = 15000;
    device.sampleLegacy();
    assert.equal(writes.at(-2).position, 101);
    state.position = 20;
    now = 16000;
    device.sampleLegacy();
    assert.equal(writes.at(-2).position, 21);
    managed = true;
    const before = writes.length;
    device.sampleLegacy();
    assert.equal(writes.length, before);
    const descriptor = device.describe();
    descriptor.keys.ENTER = 0;
    assert.equal(keys.ENTER, 13);
    assert.equal(device.eventToKeyCode({ code: 13 }), 13);
});
console.log(
    "PASS media backend: " + passed + " ES5 lease/observer/device scenarios"
);
