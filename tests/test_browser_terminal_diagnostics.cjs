const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const observeTerminal = require("../scripts/browser-terminal-diagnostics.cjs");
const source = fs.readFileSync(
    path.join(__dirname, "../scripts/browser-acceptance.cjs"),
    "utf8"
);
const sha = "a".repeat(40);
function fixture(t) {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), "browser-terminal-"));
    t.after(() => fs.rmSync(output, { force: true, recursive: true }));
    const options = {
        candidate: { sourceSha: sha },
        output,
        runtime: {
            browserVersion: "153.0",
            engine: "firefox",
            playwrightVersion: "1.62.1",
            sourceSha: sha,
            target: "ubuntu-latest-firefox-1-62-1",
        },
    };
    return {
        file: path.join(output, "acceptance-terminal.json"),
        options,
        read() {
            return JSON.parse(fs.readFileSync(this.file, "utf8"));
        },
    };
}

test("terminal observer preserves success and writes diagnostic-only metadata", async (t) => {
    const f = fixture(t);
    const expected = {};
    assert.equal(
        await observeTerminal(f.options, (observer) => {
            observer.phase("write-acceptance");
            observer.process({ signal: null, status: 0 });
            return expected;
        }),
        expected
    );
    assert.equal(f.read().acceptance, false);
    assert.equal(f.read().outcome, "passed");
    assert.equal(f.read().sourceSha, sha);
    assert.equal(f.read().phase, "write-acceptance");
    assert.equal(f.read().scenarioProcess.status, 0);
    if (process.platform !== "win32")
        assert.equal(fs.statSync(f.file).mode & 0o777, 0o600);
});

test("failure preserves exact rejection and never serializes messages or buffers", async (t) => {
    const f = fixture(t);
    const secret = "must-not-be-written";
    const failure = Object.assign(new Error(secret), { code: "ETIMEDOUT" });
    await assert.rejects(
        observeTerminal(f.options, (observer) => {
            observer.phase("scenario-process");
            observer.process({
                args: [secret],
                error: failure,
                signal: "SIGTERM",
                status: null,
                stderr: Buffer.from(secret),
                stdout: Buffer.from(secret),
            });
            throw failure;
        }),
        (error) => error === failure
    );
    const record = f.read();
    assert.equal(record.outcome, "failed");
    assert.equal(record.errorCode, "ETIMEDOUT");
    assert.deepEqual(record.scenarioProcess, {
        errorCode: "ETIMEDOUT",
        signal: "SIGTERM",
        status: null,
    });
    assert.equal(fs.readFileSync(f.file, "utf8").includes(secret), false);
});

test("untrusted metadata is omitted and the diagnostic stays below two KiB", async (t) => {
    const f = fixture(t);
    const secret = "https://private.invalid/" + "x".repeat(100000);
    Object.keys(f.options.runtime).forEach((key) => {
        f.options.runtime[key] = secret;
    });
    f.options.candidate.sourceSha = secret;
    await observeTerminal(f.options, (observer) => {
        observer.phase(secret);
        observer.process({
            error: { code: secret },
            signal: secret,
            status: secret,
        });
    });
    assert.equal(
        fs.readFileSync(f.file, "utf8").includes("private.invalid"),
        false
    );
    assert.ok(fs.statSync(f.file).size < 2048);
    assert.equal(f.read().sourceSha, null);
    assert.equal(f.read().engine, null);
    assert.equal(f.read().phase, "initializing");
});

test("error code is read once before allowlisting an alternating getter", async (t) => {
    const f = fixture(t);
    let reads = 0;
    const original = {};
    Object.defineProperty(original, "code", {
        get() {
            return ++reads === 1 ? "ETIMEDOUT" : "private alternating value";
        },
    });
    await assert.rejects(
        observeTerminal(f.options, () => Promise.reject(original)),
        (error) => error === original
    );
    assert.equal(reads, 1);
    assert.equal(f.read().errorCode, "ETIMEDOUT");
    assert.equal(
        fs.readFileSync(f.file, "utf8").includes("private alternating value"),
        false
    );
});

test("a hostile error getter cannot replace the original rejection", async (t) => {
    const f = fixture(t);
    const original = {};
    Object.defineProperty(original, "code", {
        get() {
            throw new Error("getter failed");
        },
    });
    await assert.rejects(
        observeTerminal(f.options, () => Promise.reject(original)),
        (error) => error === original
    );
    assert.equal(f.read().errorCode, null);
});

test("an existing file is not overwritten and does not alter a successful result", async (t) => {
    const f = fixture(t);
    fs.writeFileSync(f.file, "prior evidence");
    assert.equal(await observeTerminal(f.options, () => 42), 42);
    assert.equal(fs.readFileSync(f.file, "utf8"), "prior evidence");
});

test("missing output preserves failure and a final symlink is never followed", async (t) => {
    const f = fixture(t);
    const original = new Error("original");
    await assert.rejects(
        observeTerminal(
            { ...f.options, output: path.join(f.options.output, "missing") },
            () => {
                throw original;
            }
        ),
        (error) => error === original
    );
    // Windows CI may prohibit ordinary-user symlink creation.
    if (process.platform !== "win32") {
        const target = path.join(f.options.output, "target");
        fs.writeFileSync(target, "do not overwrite");
        fs.symlinkSync(target, f.file);
        assert.equal(await observeTerminal(f.options, () => 7), 7);
        assert.equal(fs.readFileSync(target, "utf8"), "do not overwrite");
        assert.equal(fs.lstatSync(f.file).isSymbolicLink(), true);
    }
});

async function runCaller(t, failure) {
    const f = fixture(t);
    const evidence = path.join(f.options.output, "acceptance.json");
    const capabilities = { hlsVersion: "fixture" };
    const profile = { media: "required", scenarios: ["required scenario"] };
    const report = {
        errors: [],
        suites: [
            {
                specs: [
                    {
                        ok: true,
                        tests: [
                            {
                                results: [{ status: "passed" }],
                                status: "expected",
                            },
                        ],
                        title: "required scenario",
                    },
                ],
            },
        ],
    };
    if (failure === "retried")
        report.suites[0].specs[0].tests[0].results.push({ status: "passed" });
    if (failure === "missing-scenario") report.suites = [];
    let reportReads = 0;
    let spawned = 0;
    const child = { error: undefined, signal: null, status: 0 };
    if (failure === "child-exit") child.status = 1;
    if (failure === "child-signal") {
        child.status = null;
        child.signal = "SIGKILL";
    }
    if (failure === "child-timeout") {
        child.status = null;
        child.error = Object.assign(new Error("synthetic timeout"), {
            code: "ETIMEDOUT",
        });
    }
    const fakeProcess = {
        env: {
            CI_BROWSER_DIAGNOSTICS: f.options.output,
            CI_BROWSER_EVIDENCE: evidence,
            CI_PLAYWRIGHT_MODULE: "/synthetic-playwright",
        },
        execPath: process.execPath,
    };
    const modules = {
        "../package.json": { dependencies: { "hls.js": "fixture" } },
        "./browser-compatibility-profile.cjs": {
            selectProfile: () => profile,
            verifyCapabilities: () => assert.notEqual(failure, "capabilities"),
        },
        "./browser-media-capabilities.cjs": {
            readBrowserMediaCapabilities: () => {},
        },
        "./browser-terminal-diagnostics.cjs": observeTerminal,
        "/synthetic-playwright": {
            firefox: {
                async launch() {
                    if (failure === "probe-launch")
                        throw new Error("probe launch");
                    return {
                        close: async () => {},
                        newPage: async () => ({
                            addScriptTag: async () => {},
                            evaluate: async () => {
                                if (failure === "probe-evaluate")
                                    throw new Error("probe evaluate");
                                return capabilities;
                            },
                        }),
                        version: () => "153.0",
                    };
                },
            },
        },
        "node:assert/strict": assert,
        "node:child_process": {
            spawnSync(executable, args, options) {
                spawned++;
                assert.equal(executable, process.execPath);
                assert.deepEqual(Array.from(args), [
                    "/synthetic-playwright/cli.js",
                    "test",
                    "--config=playwright.compatibility.config.cjs",
                ]);
                assert.equal(options.timeout, 8 * 60 * 1000);
                assert.equal(options.stdio, "inherit");
                assert.equal(options.env.CI, "1");
                return child;
            },
        },
        "node:fs": {
            readFileSync(file) {
                if (file.endsWith("runtime.json"))
                    return JSON.stringify(f.options.runtime);
                if (file.endsWith("candidate.json"))
                    return JSON.stringify({
                        sourceSha: failure === "source" ? "b".repeat(40) : sha,
                    });
                if (file.endsWith("playwright.json")) {
                    reportReads++;
                    return failure === "malformed-report"
                        ? "invalid json"
                        : JSON.stringify(report);
                }
                throw new Error("Unexpected file read");
            },
            writeFileSync: fs.writeFileSync,
        },
        "node:path": path,
    };
    await vm.runInNewContext(source, {
        console: { error() {} },
        process: fakeProcess,
        require(name) {
            assert.ok(Object.hasOwn(modules, name), name);
            return modules[name];
        },
    });
    return { ...f, evidence, fakeProcess, reportReads, spawned };
}

test("actual acceptance caller preserves success and original acceptance fields", async (t) => {
    const f = await runCaller(t);
    assert.equal(f.fakeProcess.exitCode, undefined);
    assert.equal(f.read().outcome, "passed");
    assert.equal(f.read().phase, "write-acceptance");
    const evidence = JSON.parse(fs.readFileSync(f.evidence, "utf8"));
    assert.equal(evidence.testsPassed, 1);
    assert.equal(evidence.testsFailed, 0);
    assert.equal(evidence.coverage.media, "passed");
    assert.equal(f.spawned, 1);
});

for (const [failure, phase, spawned] of [
    ["source", "verify-inputs", 0],
    ["probe-launch", "probe-launch", 0],
    ["probe-evaluate", "probe-session", 0],
    ["capabilities", "verify-capabilities", 0],
    ["child-exit", "scenario-process", 1],
    ["child-signal", "scenario-process", 1],
    ["child-timeout", "scenario-process", 1],
    ["malformed-report", "verify-scenarios", 1],
    ["retried", "verify-scenarios", 1],
    ["missing-scenario", "verify-scenarios", 1],
]) {
    test(
        "actual caller retains failure without acceptance: " + failure,
        async (t) => {
            const f = await runCaller(t, failure);
            assert.equal(f.fakeProcess.exitCode, 1);
            assert.equal(fs.existsSync(f.evidence), false);
            assert.equal(f.read().outcome, "failed");
            assert.equal(f.read().phase, phase);
            assert.equal(f.spawned, spawned);
            if (phase === "scenario-process") assert.equal(f.reportReads, 0);
        }
    );
}

// These pure VM checks exercise the same function serialized by Playwright.
const plexChannelTransition = require("./helpers/plex-channel-transition.cjs");
function teardownFixture() {
    const calls = [];
    const lines = [];
    const results = {};
    const failures = {};
    const originalDescriptors = [];
    function method(name) {
        return function () {
            "use strict";
            calls.push({ args: Array.from(arguments), name, receiver: this });
            if (Object.hasOwn(failures, name)) throw failures[name];
            return results[name];
        };
    }
    function Worker() {}
    function SourceBuffer() {}
    Worker.prototype.terminate = method("worker.terminate");
    SourceBuffer.prototype.abort = method("sourceBuffer.abort");
    const mediaPrototype = { load: method("media.load") };
    const media = Object.assign(Object.create(mediaPrototype), {
        buffered: { length: 0 },
        currentSrc: "private-src",
        currentTime: 0,
        duration: 2,
        ended: false,
        networkState: 2,
        paused: false,
        readyState: 0,
    });
    const techPrototype = {
        clearTracks: method("tech.clearTracks"),
        disposeSourceHandler: method("tech.disposeSourceHandler"),
        reset: method("tech.reset"),
    };
    const tech = Object.assign(Object.create(techPrototype), {
        el: () => media,
    });
    const player = { pause: method("player.pause"), tech: () => tech };
    const worker = new Worker();
    const buffer = new SourceBuffer();
    const targets = [
        [player, "pause", "player.pause"],
        [tech, "disposeSourceHandler", "tech.disposeSourceHandler"],
        [tech, "clearTracks", "tech.clearTracks"],
        [tech, "reset", "tech.reset"],
        [media, "load", "media.load"],
        [Worker.prototype, "terminate", "worker.terminate"],
        [SourceBuffer.prototype, "abort", "sourceBuffer.abort"],
    ];
    for (const [target, key] of targets)
        originalDescriptors.push(Object.getOwnPropertyDescriptor(target, key));
    const operationCalls = [];
    const host = {
        __ottMedia: {
            open(value) {
                assert.equal(value, null);
                operationCalls.push("open");
            },
            useSource(value) {
                assert.equal(value, null);
                operationCalls.push("useSource");
            },
        },
        closeList() {
            operationCalls.push("close");
        },
        SourceBuffer,
        stbStop() {
            operationCalls.push("stop");
        },
        video: media,
        videojs: { getPlayer: () => player },
        Worker,
    };
    const logger = {
        log(line) {
            lines.push(line);
        },
    };
    return {
        assertRestored() {
            for (let i = 0; i < targets.length; i++)
                assert.deepEqual(
                    Object.getOwnPropertyDescriptor(
                        targets[i][0],
                        targets[i][1]
                    ),
                    originalDescriptors[i]
                );
        },
        buffer,
        calls,
        events() {
            return lines
                .filter((line) => line.startsWith("Plex teardown boundary: "))
                .map((line) =>
                    JSON.parse(line.slice("Plex teardown boundary: ".length))
                );
        },
        failures,
        host,
        lines,
        logger,
        media,
        operationCalls,
        player,
        results,
        run(engine = "video.js") {
            return vm.runInNewContext(
                `(${plexChannelTransition.toString()})(${JSON.stringify(engine)})`,
                {
                    console: logger,
                    window: host,
                }
            );
        },
        targets,
        tech,
        worker,
    };
}

test("synchronous teardown diagnostics preserve exact four-call order and restore all hooks", () => {
    const f = teardownFixture();
    f.host.stbStop = function () {
        f.operationCalls.push("stop");
        f.player.pause();
        f.tech.disposeSourceHandler();
        f.tech.clearTracks("text");
        f.tech.reset();
        f.media.load();
        f.worker.terminate();
        f.buffer.abort();
    };
    assert.equal(f.run(), undefined);
    assert.deepEqual(f.operationCalls, ["stop", "close", "useSource", "open"]);
    assert.deepEqual(
        f.calls.map((call) => call.name),
        f.targets.map((entry) => entry[2])
    );
    const events = f.events();
    assert.equal(
        events.filter((event) => event.phase === "attached").length,
        7
    );
    assert.equal(
        events.filter((event) => event.phase === "restored").length,
        7
    );
    for (const [, , hook] of f.targets)
        assert.deepEqual(
            events
                .filter((event) => event.hook === hook)
                .map((event) => event.phase),
            ["attached", "entered", "returned", "restored"]
        );
    assert.deepEqual(
        f.lines
            .filter((line) => line.startsWith("Plex channel transition: "))
            .map(
                (line) =>
                    JSON.parse(line.slice("Plex channel transition: ".length))
                        .step
            ),
        [0, 1, 2, 3, 4, 5, 6, 7]
    );
    f.assertRestored();
    const before = f.events().length;
    f.run();
    assert.equal(
        f.events().length,
        2 * before,
        "no nested wrappers survive into a later call"
    );
    f.assertRestored();
});

test("all hooked calls retain receiver, arguments and return identity without inspecting payloads", () => {
    const f = teardownFixture();
    const secret = "https://private.invalid/token";
    const payload = {
        toJSON() {
            assert.fail("payload serialization");
        },
    };
    const returned = {};
    Object.defineProperty(returned, "then", {
        get() {
            assert.fail("promise observation");
        },
    });
    f.host.stbStop = function () {
        for (const [target, key, name] of f.targets) {
            f.results[name] = returned;
            for (const receiver of [undefined, null, payload]) {
                assert.equal(
                    Reflect.apply(target[key], receiver, [payload, secret, 3]),
                    returned
                );
                const call = f.calls.at(-1);
                assert.equal(call.receiver, receiver);
                assert.equal(call.args[0], payload);
                assert.equal(call.args[1], secret);
                assert.equal(call.args[2], 3);
            }
        }
    };
    f.run();
    assert.equal(f.lines.join("\n").includes(secret), false);
    f.assertRestored();
});

for (const hook of [
    "player.pause",
    "tech.disposeSourceHandler",
    "tech.clearTracks",
    "tech.reset",
    "media.load",
    "worker.terminate",
    "sourceBuffer.abort",
]) {
    test(
        "teardown diagnostic preserves thrown value and cleans up: " + hook,
        () => {
            const f = teardownFixture();
            const thrown = {
                toJSON() {
                    assert.fail("error serialization");
                },
            };
            Object.defineProperty(thrown, "message", {
                get() {
                    assert.fail("error inspection");
                },
            });
            f.failures[hook] = thrown;
            f.host.stbStop = function () {
                const [target, key] = f.targets.find(
                    (entry) => entry[2] === hook
                );
                target[key]();
            };
            assert.throws(
                () => f.run(),
                (error) => error === thrown
            );
            assert.deepEqual(f.operationCalls, []);
            assert.deepEqual(
                f
                    .events()
                    .filter((event) => event.hook === hook)
                    .map((event) => event.phase),
                ["attached", "entered", "threw", "restored"]
            );
            f.assertRestored();
        }
    );
}

test("throwing console logger cannot replace a result or an original error", () => {
    for (const throws of [false, true]) {
        const f = teardownFixture();
        const original = {};
        f.logger.log = () => {
            throw new Error("logger failure");
        };
        f.host.stbStop = () => {
            f.player.pause();
            if (throws) throw original;
        };
        if (throws)
            assert.throws(
                () => f.run(),
                (error) => error === original
            );
        else assert.equal(f.run(), undefined);
        assert.equal(f.calls.length, 1);
        f.assertRestored();
    }
});

test("missing main identity records unavailable hooks without changing original operation", () => {
    for (const unavailable of ["missing", "mismatch", "throws"]) {
        const f = teardownFixture();
        if (unavailable === "missing") f.host.videojs = null;
        if (unavailable === "mismatch") f.tech.el = () => ({});
        if (unavailable === "throws")
            f.player.tech = () => {
                throw Error("private");
            };
        f.run();
        assert.deepEqual(f.operationCalls, [
            "stop",
            "close",
            "useSource",
            "open",
        ]);
        assert.equal(f.events().length, 7);
        assert.ok(f.events().every((event) => event.phase === "unavailable"));
        f.assertRestored();
    }
});

test("non-video.js scenarios do not inspect player or install prototype hooks", () => {
    for (const engine of ["hls.js", "html5", "shaka"]) {
        const f = teardownFixture();
        Object.defineProperty(f.host, "videojs", {
            get() {
                assert.fail("other engine inspected");
            },
        });
        f.run(engine);
        assert.deepEqual(f.events(), []);
        assert.deepEqual(f.operationCalls, [
            "stop",
            "close",
            "useSource",
            "open",
        ]);
        f.assertRestored();
    }
});

test("inaccessible hooks are explicit and do not invoke getters", () => {
    const f = teardownFixture();
    Object.defineProperty(f.tech, "clearTracks", {
        get() {
            assert.fail("hook getter invoked");
        },
    });
    Object.defineProperty(f.media, "load", {
        configurable: false,
        value: function () {},
        writable: false,
    });
    delete f.host.Worker;
    f.run();
    for (const name of ["tech.clearTracks", "media.load", "worker.terminate"])
        assert.deepEqual(
            f
                .events()
                .filter((event) => event.hook === name)
                .map((event) => event.phase),
            ["unavailable"]
        );
    assert.deepEqual(f.operationCalls, ["stop", "close", "useSource", "open"]);
});

test("cleanup leaves a superseding owner's method intact and silences retained wrappers", () => {
    const f = teardownFixture();
    const successor = function () {};
    let retained;
    f.host.stbStop = () => {
        retained = f.player.pause;
        f.tech.reset = successor;
    };
    f.run();
    assert.equal(f.tech.reset, successor);
    assert.ok(
        f
            .events()
            .some(
                (event) =>
                    event.hook === "tech.reset" && event.phase === "superseded"
            )
    );
    const count = f.lines.length;
    retained.call(f.player);
    assert.equal(f.calls.at(-1).name, "player.pause");
    assert.equal(
        f.lines.length,
        count,
        "a retained wrapper cannot observe after the synchronous scope"
    );
});

test("cleanup failure remains diagnostic and cannot hide an operation error", () => {
    const f = teardownFixture();
    const original = {};
    f.host.stbStop = () => {
        Object.defineProperty(f.media, "load", {
            configurable: false,
            value: f.media.load,
            writable: false,
        });
        throw original;
    };
    assert.throws(
        () => f.run(),
        (error) => error === original
    );
    assert.ok(
        f
            .events()
            .some(
                (event) =>
                    event.hook === "media.load" &&
                    event.phase === "cleanup-failed"
            )
    );
});

test("diagnostic event and receiver counts are strictly bounded and contain scalars only", () => {
    const f = teardownFixture();
    f.host.stbStop = () => {
        for (let i = 0; i < 100; i++)
            f.player.pause.call({ private: "must not appear" });
    };
    f.run();
    assert.equal(f.calls.length, 100);
    const events = f.events();
    assert.equal(events.length, 64);
    assert.deepEqual(events.at(-1), {
        hook: "diagnostics",
        phase: "limit",
        receiver: 0,
        sequence: 64,
    });
    assert.ok(events.some((event) => event.receiver === 0));
    for (const [index, event] of events.entries()) {
        assert.equal(event.sequence, index + 1);
        assert.ok(event.receiver >= 0 && event.receiver <= 16);
        assert.deepEqual(Object.keys(event).sort(), [
            "hook",
            "phase",
            "receiver",
            "sequence",
        ]);
    }
    assert.ok(f.lines.every((line) => Buffer.byteLength(line, "utf8") < 512));
    assert.equal(f.lines.join("\n").includes("must not appear"), false);
    f.assertRestored();
});

function aspectHostFixture() {
    const listeners = {};
    const reports = [];
    const timers = new Set();
    const module = { exports: {} };
    vm.runInNewContext(
        fs.readFileSync(
            path.join(__dirname, "helpers/aspect-readiness-diagnostics.cjs"),
            "utf8"
        ),
        {
            Buffer,
            clearTimeout: (timer) => timers.delete(timer),
            console: { error: (value) => reports.push(value) },
            module,
            require: (name) => {
                assert.equal(name, "node:perf_hooks");
                return { performance: { now: () => 10 } };
            },
            setTimeout: () => {
                const timer = { unref() {} };
                timers.add(timer);
                return timer;
            },
        }
    );
    const page = {
        context: () => ({ browser: () => ({ isConnected: () => true }) }),
        isClosed: () => false,
        off: (name, fn) => {
            if (listeners[name] === fn) delete listeners[name];
        },
        on: (name, fn) => {
            listeners[name] = fn;
        },
    };
    return { listeners, observe: module.exports, page, reports, timers };
}

test("host retains bounded allowlisted teardown evidence and cleans up without page calls", async () => {
    const f = aspectHostFixture();
    const original = {};
    await assert.rejects(
        f.observe(
            f.page,
            { engine: "video.js", phase: "open-channels" },
            () => {
                const send = (value) =>
                    f.listeners.console({
                        text: () =>
                            "Plex teardown boundary: " + JSON.stringify(value),
                    });
                for (const invalid of [
                    null,
                    [],
                    {
                        hook: "private",
                        phase: "entered",
                        receiver: 1,
                        sequence: 1,
                    },
                    {
                        hook: "player.pause",
                        phase: "secret",
                        receiver: 1,
                        sequence: 1,
                    },
                    {
                        hook: "player.pause",
                        phase: "entered",
                        receiver: 17,
                        sequence: 1,
                    },
                    {
                        hook: "player.pause",
                        phase: "entered",
                        receiver: 1,
                        sequence: 0,
                    },
                    {
                        hook: "player.pause",
                        phase: "entered",
                        receiver: 1,
                        secret: "x".repeat(1000),
                        sequence: 1,
                    },
                ])
                    send(invalid);
                for (let sequence = 1; sequence <= 100; sequence++) {
                    send({
                        hook: "player.pause",
                        phase: "entered",
                        receiver: 1,
                        secret: "discarded",
                        sequence,
                    });
                    send({
                        hook: "player.pause",
                        phase: "returned",
                        receiver: 1,
                        sequence,
                    });
                }
                f.listeners.crash();
                throw original;
            }
        ),
        (error) => error === original
    );
    assert.equal(f.reports.length, 1);
    const report = JSON.parse(
        f.reports[0].slice("Aspect readiness host state: ".length)
    );
    assert.equal(report.crashed, true);
    assert.equal(report.teardown.length, 64);
    assert.equal(f.reports[0].includes("discarded"), false);
    assert.equal(f.reports[0].includes("secret"), false);
    assert.ok(Buffer.byteLength(f.reports[0]) < 10000);
    assert.deepEqual(Object.keys(f.listeners), []);
    assert.equal(f.timers.size, 0);
});

test("host ignores new teardown prefix for other engines and preserves result", async () => {
    const f = aspectHostFixture();
    const expected = {};
    assert.equal(
        await f.observe(
            f.page,
            { engine: "hls.js", phase: "open-channels" },
            () => {
                f.listeners.console({
                    text: () =>
                        'Plex teardown boundary: {"hook":"player.pause","phase":"entered","receiver":1,"sequence":1}',
                });
                return expected;
            }
        ),
        expected
    );
    assert.deepEqual(f.reports, []);
    assert.deepEqual(Object.keys(f.listeners), []);
    assert.equal(f.timers.size, 0);
});

test("each original operation retains its thrown value and stops the unchanged sequence", () => {
    for (const failed of ["stop", "close", "useSource", "open"]) {
        const f = teardownFixture();
        const original = {};
        const operations = [
            [f.host, "stbStop", "stop"],
            [f.host, "closeList", "close"],
            [f.host.__ottMedia, "useSource", "useSource"],
            [f.host.__ottMedia, "open", "open"],
        ];
        for (const [target, name, label] of operations) {
            target[name] = function () {
                assert.equal(this, target);
                if (label === "useSource" || label === "open")
                    assert.deepEqual(Array.from(arguments), [null]);
                else assert.deepEqual(Array.from(arguments), []);
                f.operationCalls.push(label);
                if (label === failed) throw original;
            };
        }
        assert.throws(
            () => f.run(),
            (error) => error === original
        );
        assert.deepEqual(
            f.operationCalls,
            operations
                .map((operation) => operation[2])
                .slice(
                    0,
                    operations.findIndex(
                        (operation) => operation[2] === failed
                    ) + 1
                )
        );
        f.assertRestored();
    }
});

test("main media replacement during identity lookup leaves all hooks unavailable", () => {
    const f = teardownFixture();
    f.host.videojs.getPlayer = () => {
        f.host.video = {};
        return f.player;
    };
    f.run();
    assert.equal(f.events().length, 7);
    assert.ok(f.events().every((event) => event.phase === "unavailable"));
    assert.deepEqual(f.operationCalls, ["stop", "close", "useSource", "open"]);
    f.assertRestored();
});
