const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const file = "src/core/index.ts";
const source = fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
const names = [
    "cancelCoreVideoGeometryRefresh",
    "refreshCoreVideoGeometryAfterFrame",
];
const declarations = ast.statements.filter(
    (node) => ts.isFunctionDeclaration(node) && names.includes(node.name.text)
);
assert.equal(declarations.length, names.length);
const code = ts.transpileModule(
    declarations.map((node) => node.getText(ast)).join("\n"),
    { compilerOptions: { target: ts.ScriptTarget.ES5 } }
).outputText;

function fixture({ frame = "supported", raf = "supported" } = {}) {
    let sequence = 0;
    let owner = { active: () => true };
    const timers = new Map();
    const frames = new Map();
    const animations = new Map();
    const saved = { animations: [], frames: [], timers: [] };
    const writes = [];
    const delays = [];
    function schedule(queue, history, callback) {
        const id = ++sequence;
        queue.set(id, callback);
        history.push(callback);
        return id;
    }
    function run(queue) {
        assert.ok(queue.size, "expected a scheduled callback");
        const [id, callback] = queue.entries().next().value;
        queue.delete(id);
        callback();
    }
    const media = {};
    if (frame !== "missing") {
        media.requestVideoFrameCallback = (callback) => {
            if (frame === "throws") throw new Error("frame API unavailable");
            return schedule(frames, saved.frames, callback);
        };
        media.cancelVideoFrameCallback = (id) => frames.delete(id);
    }
    const host = {
        applyAspectRatio() {
            writes.push({
                aspect: host.aspectRatio,
                fullscreen: host.isFullscreen,
                preview: host.preview,
                type: "aspect",
            });
        },
        applyZoom() {
            writes.push({ type: "zoom", zoom: host.zoomLevel });
        },
        aspectRatio: 0,
        clearTimeout: (id) => timers.delete(id),
        coreMediaBackend: { current: () => owner },
        isFullscreen: true,
        preview: "initial",
        setTimeout(callback, delay) {
            delays.push(delay);
            return schedule(timers, saved.timers, callback);
        },
        video: media,
        zoomLevel: 0,
    };
    if (raf !== "missing") {
        host.requestAnimationFrame = (callback) => {
            if (
                raf === "throws" ||
                (raf === "throws-second" && saved.animations.length)
            )
                throw new Error("RAF unavailable");
            return schedule(animations, saved.animations, callback);
        };
        host.cancelAnimationFrame = (id) => animations.delete(id);
    }
    host.window = host;
    vm.runInNewContext(code, host);
    return {
        animations,
        arm: () => host.refreshCoreVideoGeometryAfterFrame(media),
        cancel: () => host.cancelCoreVideoGeometryRefresh(),
        delays,
        frames,
        host,
        media,
        noPending() {
            assert.equal(timers.size, 0, "watchdog released");
            assert.equal(animations.size, 0, "RAF released");
            assert.equal(frames.size, 0, "video frame callback released");
            assert.equal(host.__ottVideoFit, null);
        },
        replaceOwner: () => {
            owner = { active: () => true };
        },
        retireOwner: () => {
            owner = { active: () => false };
        },
        runAnimation: () => run(animations),
        runFrame: () => run(frames),
        runTimer: () => run(timers),
        saved,
        timers,
        writes,
    };
}

let cases = 0;
function test(name, callback) {
    try {
        callback();
        cases++;
    } catch (error) {
        error.message = name + ": " + error.message;
        throw error;
    }
}
function refreshedOnce(rig) {
    assert.deepEqual(
        rig.writes.map((write) => write.type),
        ["aspect", "zoom"]
    );
    rig.noPending();
}

test("presented frame waits for both layout frames and releases all handles", () => {
    const rig = fixture();
    rig.arm();
    assert.deepEqual(rig.delays, [250]);
    assert.equal(rig.frames.size, 1);
    assert.equal(rig.animations.size, 0);
    rig.runFrame();
    rig.runAnimation();
    assert.equal(rig.writes.length, 0);
    rig.runAnimation();
    refreshedOnce(rig);
    for (const callback of Object.values(rig.saved).flat()) callback();
    refreshedOnce(rig);
});

for (const frame of ["missing", "throws"]) {
    test(frame + " frame API uses bounded layout fallback", () => {
        const rig = fixture({ frame });
        rig.arm();
        rig.runAnimation();
        rig.runAnimation();
        refreshedOnce(rig);
    });
}

for (const options of [
    {},
    { frame: "missing" },
    { frame: "missing", raf: "missing" },
    { frame: "missing", raf: "throws" },
]) {
    test(
        "watchdog finishes without decoder or RAF delivery " +
            JSON.stringify(options),
        () => {
            const rig = fixture(options);
            rig.arm();
            rig.runTimer();
            refreshedOnce(rig);
            for (const callback of Object.values(rig.saved).flat()) callback();
            refreshedOnce(rig);
        }
    );
}

test("watchdog races a partially completed frame chain exactly once", () => {
    const rig = fixture();
    rig.arm();
    rig.runFrame();
    rig.runAnimation();
    rig.runTimer();
    refreshedOnce(rig);
    for (const callback of Object.values(rig.saved).flat()) callback();
    refreshedOnce(rig);
});

for (const invalidate of [
    (rig) => rig.replaceOwner(),
    (rig) => rig.retireOwner(),
    (rig) => (rig.host.video = {}),
    (rig) => (rig.host.coreMediaBackend = { current: () => null }),
]) {
    test("retired source/media/backend cannot write geometry " + cases, () => {
        const rig = fixture();
        rig.arm();
        invalidate(rig);
        rig.runTimer();
        assert.equal(rig.writes.length, 0);
        rig.noPending();
    });
}

for (const phase of ["video-frame", "first-raf", "second-raf"]) {
    test("Stop or reinit cancels retained callbacks at " + phase, () => {
        const rig = fixture();
        rig.arm();
        if (phase !== "video-frame") rig.runFrame();
        if (phase === "second-raf") rig.runAnimation();
        rig.cancel();
        rig.noPending();
        for (const callback of Object.values(rig.saved).flat()) callback();
        assert.equal(rig.writes.length, 0);
        rig.noPending();
    });
}

test("rearming replaces prior work without letting old callbacks cancel new work", () => {
    const rig = fixture();
    rig.arm();
    rig.runFrame();
    const stale = Object.values(rig.saved).flat();
    rig.arm();
    const pending = rig.host.__ottVideoFit;
    for (const callback of stale) callback();
    assert.equal(rig.host.__ottVideoFit, pending);
    assert.equal(rig.writes.length, 0);
    assert.equal(rig.frames.size, 1);
    assert.equal(rig.timers.size, 1);
    assert.equal(rig.animations.size, 0);
    rig.runTimer();
    refreshedOnce(rig);
});

test("second RAF registration failure still finishes at the watchdog", () => {
    const rig = fixture({ raf: "throws-second" });
    rig.arm();
    rig.runFrame();
    rig.runAnimation();
    assert.equal(rig.writes.length, 0);
    rig.runTimer();
    refreshedOnce(rig);
});

test("geometry errors still release every pending callback", () => {
    const rig = fixture();
    rig.host.applyAspectRatio = () => {
        throw new Error("geometry failed");
    };
    rig.arm();
    assert.throws(() => rig.runTimer(), /geometry failed/);
    rig.noPending();
    for (const callback of Object.values(rig.saved).flat()) callback();
    assert.equal(rig.writes.length, 0);
    rig.noPending();
});

test("delivery uses the latest preview, Fit/Fill and zoom settings", () => {
    const rig = fixture();
    rig.arm();
    rig.host.isFullscreen = false;
    rig.host.preview = "current-channel-list-preview";
    rig.host.aspectRatio = 1;
    rig.host.zoomLevel = 3;
    rig.runFrame();
    rig.runAnimation();
    rig.runAnimation();
    assert.deepEqual(rig.writes, [
        {
            aspect: 1,
            fullscreen: false,
            preview: "current-channel-list-preview",
            type: "aspect",
        },
        { type: "zoom", zoom: 3 },
    ]);
    rig.noPending();
});

test("unowned or different media never schedules work", () => {
    const rig = fixture();
    rig.retireOwner();
    rig.arm();
    assert.equal(rig.frames.size + rig.timers.size + rig.animations.size, 0);
    rig.replaceOwner();
    rig.host.refreshCoreVideoGeometryAfterFrame({});
    assert.equal(rig.frames.size + rig.timers.size + rig.animations.size, 0);
    assert.equal(rig.writes.length, 0);
});

console.log(
    "OK: " + cases + " bounded source-owned video geometry scheduler cases"
);
