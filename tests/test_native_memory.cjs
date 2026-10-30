const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
const { CLASSIC_MODULES } = require("../scripts/classic-bundle.cjs");

function load(file) {
    const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText;
    acorn.parse(compiled, { ecmaVersion: 5 });
    const context = { exports: {}, Promise };
    vm.runInNewContext(compiled, context);
    return context.exports;
}
const { captureNativeMemoryHint } = load("src/plugins/native-memory.ts");
const { coreBufferPolicy } = load("src/core/buffer-policy.ts");
const gib = 1024 * 1024 * 1024;
const snapshot = (metrics) => ({ metrics, platform: "android", version: 1 });
const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
};
function fixture({ platform = "android", native = true, memory } = {}) {
    const timers = new Map();
    const listeners = new Map();
    let calls = 0;
    let now = 0;
    let resolve, reject;
    const reply = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
    });
    const w = {
        addEventListener: (name, fn) => listeners.set(name, fn),
        Capacitor: {
            getPlatform: () => platform,
            isNativePlatform: () => native,
        },
        clearTimeout: (id) => timers.delete(id),
        navigator: {
            deviceMemory: memory,
            userAgent: platform === "android" ? "Android" : "",
        },
        performance: { now: () => now },
        removeEventListener: (name, fn) => {
            if (listeners.get(name) === fn) listeners.delete(name);
        },
        setTimeout: (fn, delay) => {
            timers.set(1, { delay, fn });
            return 1;
        },
    };
    const start = (
        read = () => {
            calls++;
            return reply;
        }
    ) => captureNativeMemoryHint(w, read);
    const policy = (live = true, pip = false) =>
        coreBufferPolicy(w, "", "", 0, live, pip);
    return {
        advance: (time) => {
            now = time;
        },
        calls: () => calls,
        listeners,
        policy,
        reject,
        resolve,
        start,
        timers,
        w,
    };
}

(async () => {
    const low = fixture({ memory: 8 });
    const before = low.policy();
    const cancel = low.start();
    assert.equal(typeof cancel, "function", "startup returns synchronously");
    assert.equal(low.calls(), 1);
    assert.equal(
        low.policy().hls.maxBufferSize,
        64000000,
        "pending read does not delay playback"
    );
    assert.equal(low.timers.get(1).delay, 1500);
    low.resolve(snapshot({ isLowRamDevice: true, systemTotalBytes: 4 * gib }));
    await flush();
    assert.equal(low.policy().profile, "low-memory/live");
    assert.equal(low.policy().hls.maxBufferSize, 32000000);
    assert.equal(low.policy(false).shaka.bufferingGoal, 30);
    assert.equal(low.policy(true, true).hls.maxBufferSize, 16000000);
    assert.equal(
        before.hls.maxBufferSize,
        64000000,
        "a running engine's policy is not mutated"
    );
    assert.equal(low.timers.size, 0);
    assert.equal(low.listeners.size, 0);
    cancel();
    assert.equal(
        low.calls(),
        1,
        "normal policy construction never polls native"
    );

    for (const metrics of [
        { systemTotalBytes: 2 * gib }, // existing APK, no new flag
        { isLowRamDevice: false, systemTotalBytes: gib },
        { isLowRamDevice: true },
    ]) {
        const f = fixture();
        f.start();
        f.resolve(snapshot(metrics));
        await flush();
        assert.equal(f.policy().profile, "low-memory/live");
    }
    const conservative = fixture({ memory: 2 });
    conservative.start();
    conservative.resolve(
        snapshot({ isLowRamDevice: false, systemTotalBytes: 8 * gib })
    );
    await flush();
    assert.equal(conservative.policy().profile, "low-memory/live");

    for (const deliveredAt of [1499, 1500, 1671]) {
        const f = fixture();
        f.start();
        f.advance(10);
        f.resolve(snapshot({ isLowRamDevice: true }));
        // Hold the event loop: the promise is ready, but its continuation runs
        // before the overdue timeout callback when execution finally resumes.
        f.advance(deliveredAt);
        assert.equal(f.timers.size, 1, "deadline callback has not run");
        await flush();
        assert.equal(
            f.policy().profile,
            deliveredAt < 1500 ? "low-memory/live" : "android/live",
            "the reply must satisfy elapsed time, not merely a pending timer"
        );
        assert.equal(f.timers.size, 0);
        assert.equal(f.listeners.size, 0);
    }

    const invalid = [
        undefined,
        null,
        {},
        { metrics: { isLowRamDevice: true }, platform: "android", version: 2 },
        { metrics: { isLowRamDevice: true }, platform: "ios", version: 1 },
        ...["true", 1, null].map((value) =>
            snapshot({ isLowRamDevice: value })
        ),
        ...["1024", 0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1].map(
            (value) => snapshot({ systemTotalBytes: value })
        ),
        snapshot({ lowMemory: true }), // transient pressure is not device classification
        snapshot({
            isLowRamDevice: false,
            lowMemory: true,
            systemTotalBytes: 8 * gib,
        }),
        snapshot({ isLowRamDevice: false }),
    ];
    for (const value of invalid) {
        const f = fixture();
        f.start();
        f.resolve(value);
        await flush();
        assert.equal(f.policy().profile, "android/live");
        assert.equal(f.timers.size, 0);
        assert.equal(f.listeners.size, 0);
    }
    for (const action of ["timeout", "pagehide", "cancel", "reject", "throw"]) {
        const f = fixture();
        const dispose = f.start(
            action === "throw"
                ? () => {
                      throw Error("unavailable");
                  }
                : undefined
        );
        if (action === "timeout") f.timers.get(1).fn();
        if (action === "pagehide") f.listeners.get("pagehide")();
        if (action === "cancel") dispose();
        if (action === "reject") f.reject(Error("unavailable"));
        else f.resolve(snapshot({ isLowRamDevice: true }));
        await flush();
        assert.equal(
            f.policy().profile,
            "android/live",
            action + " retains fallback"
        );
        assert.equal(f.timers.size, 0);
        assert.equal(f.listeners.size, 0);
    }
    for (const options of [
        { platform: "ios" },
        { platform: "web" },
        { native: false },
    ]) {
        const f = fixture(options);
        f.start();
        assert.equal(f.calls(), 0);
        assert.equal(f.timers.size, 0);
        assert.equal(f.listeners.size, 0);
    }
    const browser = fixture();
    delete browser.w.Capacitor;
    browser.start();
    assert.equal(browser.calls(), 0);

    // Execute the actual bootstrap call against a fake bridge: it must remain optional/non-awaited.
    const index = fs.readFileSync("src/index.ts", "utf8");
    const ast = ts.createSourceFile(
        "index.ts",
        index,
        ts.ScriptTarget.Latest,
        true
    );
    const calls = ast.statements.filter(
        (node) =>
            ts.isExpressionStatement(node) &&
            ts.isCallExpression(node.expression) &&
            node.expression.expression.getText(ast) ===
                "captureNativeMemoryHint"
    );
    assert.equal(calls.length, 1);
    assert.equal(
        CLASSIC_MODULES.filter(
            (file) => file === "build/plugins/native-memory.js"
        ).length,
        1,
        "the classic bundle includes the optional native snapshot"
    );
    assert(
        CLASSIC_MODULES.indexOf("build/plugins/native-memory.js") <
            CLASSIC_MODULES.indexOf("build/index.js")
    );
    const boot = fixture();
    vm.runInNewContext(calls[0].getText(ast), {
        captureNativeMemoryHint,
        runtimeDiagnostics: {
            snapshot: () =>
                Promise.resolve(snapshot({ systemTotalBytes: gib })),
        },
        window: boot.w,
    });
    await flush();
    assert.equal(boot.policy().profile, "low-memory/live");
    console.log(
        "native memory: bounded nonblocking snapshot, Android gating, fallback, low RAM and cancellation passed"
    );
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
