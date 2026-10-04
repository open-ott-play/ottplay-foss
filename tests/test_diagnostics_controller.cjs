const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");

function loadSource(file, dependencies) {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    const code = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText;
    acorn.parse(code, { ecmaVersion: 5 });
    const context = {
        exports: {},
        require(name) {
            assert.ok(
                Object.prototype.hasOwnProperty.call(dependencies, name),
                name
            );
            return dependencies[name];
        },
        URL,
    };
    vm.runInNewContext(code, context, { filename: file });
    return context.exports;
}
const commandServer = loadSource("src/plugins/command-server.ts", {
    "../shared/wire-contracts": require("./load-wire.cjs")(),
});
const realRemote = loadSource("src/plugins/remote-diagnostics.ts", {
    "../shared/wire-contracts": require("./load-wire.cjs")(),
    "./diagnostic-buffer": loadSource("src/plugins/diagnostic-buffer.ts", {}),
});
const { installDiagnosticsController } = loadSource(
    "src/plugins/diagnostics-controller.ts",
    {
        "../commands/remote-restart": loadSource(
            "src/commands/remote-restart.ts",
            {}
        ),
        "./command-server": commandServer,
        "./diagnostics-permission": loadSource(
            "src/plugins/diagnostics-permission.ts",
            {}
        ),
        "./remote-diagnostics": {
            createRemoteDiagnostics() {
                throw new Error("Inject a client");
            },
        },
    }
);
const plain = (value) => JSON.parse(JSON.stringify(value));
const token = "device_" + "x".repeat(40);

function eventTarget() {
    const listeners = [];
    const removed = [];
    return {
        addEventListener(type, callback, capture) {
            listeners.push({ callback, capture, type });
        },
        dispatch(type) {
            listeners
                .slice()
                .filter((item) => item.type === type)
                .forEach((item) => item.callback());
        },
        listeners,
        removed,
        removeEventListener(type, callback, capture) {
            const index = listeners.findIndex(
                (item) =>
                    item.type === type &&
                    item.callback === callback &&
                    item.capture === capture
            );
            assert.ok(index >= 0, "remove only an owned listener");
            removed.push(listeners.splice(index, 1)[0]);
        },
    };
}
function harness(real = false, permissionStore, runtimeLabel) {
    let now = 100;
    let nextTimer = 0;
    let randomSequence = 0;
    const timers = new Map();
    const timerHistory = [];
    const document = Object.assign(eventTarget(), {
        hidden: false,
        visibilityState: "visible",
    });
    const w = Object.assign(eventTarget(), {
        clearTimeout(id) {
            timers.delete(id);
        },
        crypto: {
            getRandomValues(bytes) {
                bytes.fill(++randomSequence);
                return bytes;
            },
        },
        document,
        navigator: { onLine: true },
        performance: { now: () => now },
        setTimeout(callback, delay) {
            const timer = { at: now + delay, callback };
            timers.set(++nextTimer, timer);
            timerHistory.push(timer);
            return nextTimer;
        },
    });
    Object.defineProperty(w, "localStorage", {
        get() {
            throw new Error("Consent must not be persisted");
        },
    });
    const h = {
        advance(ms) {
            const target = now + ms;
            for (;;) {
                let next = null;
                for (const [id, timer] of timers)
                    if (
                        timer.at <= target &&
                        (!next || timer.at < next.timer.at)
                    )
                        next = { id, timer };
                if (!next) break;
                now = next.timer.at;
                timers.delete(next.id);
                next.timer.callback();
            }
            now = target;
        },
        captures: [],
        clients: [],
        config: {
            address: "https://control.example/ottplay",
            enabled: true,
            token,
        },
        getConfigCalls: 0,
        onConfigure: null,
        onFactory: null,
        onRelease: null,
        onStatus: null,
        rawSnapshot: {
            available: true,
            counters: { errors: 2 },
            enabled: true,
            video: { currentTime: 10, paused: false },
        },
        releaseCalls: 0,
        requests: [],
        setNow(value) {
            now = value;
        },
        snapshotCalls: 0,
        startCapture(index = h.clients.length - 1) {
            const current = h.clients[index];
            current.release = current.options.capture(
                (event) => current.events.push(plain(event)),
                () => current.captureStops++
            );
            return h.captures[h.captures.length - 1];
        },
        statuses: [],
        timerHistory,
        timers,
        w,
    };
    w.__ottDebug = {
        capture(event, stopped) {
            const capture = { active: true, event, stopped };
            h.captures.push(capture);
            return () => {
                h.releaseCalls++;
                capture.active = false;
                if (h.onRelease) h.onRelease(capture);
            };
        },
        snapshot() {
            h.snapshotCalls++;
            return h.rawSnapshot;
        },
    };
    h.controller = installDiagnosticsController(w, {
        clientFactory(options) {
            if (real) return realRemote.createRemoteDiagnostics(options);
            const current = {
                captureStops: 0,
                configs: [],
                configure(config) {
                    current.configs.push(plain(config));
                    options.onStatus({ runtimeId: "rt-1", state: "ready" });
                    if (h.onConfigure) h.onConfigure(current);
                },
                events: [],
                options,
                release: null,
                stop(reason) {
                    current.stops.push(reason);
                    if (current.release) current.release();
                    options.onStatus({ reason, state: "stopped" });
                },
                stops: [],
            };
            h.clients.push(current);
            if (h.onFactory) h.onFactory(current);
            return current;
        },
        getConfig() {
            h.getConfigCalls++;
            return h.config;
        },
        onStatus(status) {
            h.statuses.push(plain(status));
            if (h.onStatus) h.onStatus(status);
        },
        permissionStore,
        runtimeLabel,
        send(request, complete) {
            const entry = { canceled: false, complete, request };
            h.requests.push(entry);
            return () => {
                entry.canceled = true;
            };
        },
    });
    return h;
}
function stopped(h, message) {
    assert.equal(h.controller.status().enabled, false, message);
    assert.equal(h.timers.size, 0, "no remaining wrapper timers");
    assert.equal(h.w.listeners.length, 0, "no remaining window listeners");
    assert.equal(
        h.w.document.listeners.length,
        0,
        "no remaining document listeners"
    );
}
function test(name, body) {
    body();
    console.log("PASS " + name);
}

test("off boot is inert and status/subscription are detached", () => {
    const h = harness();
    assert.deepEqual(plain(h.controller.status()), {
        enabled: false,
        message: "Remote diagnostics is off.",
        pending: false,
        state: "disabled",
        trusted: false,
    });
    assert.equal(h.getConfigCalls, 0);
    assert.equal(h.clients.length, 0);
    assert.equal(h.requests.length, 0);
    assert.equal(h.snapshotCalls, 0);
    stopped(h);
    let status;
    h.controller.subscribe((value) => {
        status = value;
        value.enabled = true;
        value.message = token;
    });
    assert.equal(status.enabled, true);
    assert.equal(h.controller.status().enabled, false);
    h.controller.subscribe(null);
    h.controller.stop();
    assert.ok(!JSON.stringify(h.statuses).includes(token));
});

test("invalid configuration and unsupported environment cannot opt in", () => {
    for (const config of [
        { enabled: false },
        { token: "short" },
        { address: "http://control.example" },
        { address: "https://user:secret@control.example" },
        { address: "https://control.example?token=secret" },
    ]) {
        const h = harness();
        Object.assign(h.config, config);
        h.controller.setEnabled(true);
        stopped(h);
        assert.equal(h.clients.length, 0);
        assert.ok(!JSON.stringify(h.statuses).includes("secret"));
    }
    for (const mutate of [
        (h) => {
            delete h.w.__ottDebug.capture;
        },
        (h) => {
            delete h.w.__ottDebug.snapshot;
        },
        (h) => {
            delete h.w.performance;
        },
        (h) => {
            h.w.document.visibilityState = "hidden";
        },
        (h) => {
            h.w.navigator.onLine = false;
        },
        (h) => h.setNow(Number.MAX_SAFE_INTEGER),
    ]) {
        const h = harness();
        mutate(h);
        h.controller.setEnabled(true);
        stopped(h);
        assert.equal(h.clients.length, 0);
    }
});

test("explicit opt-in bounds the grant and cleans capture once", () => {
    const h = harness();
    h.controller.setEnabled(true);
    const current = h.clients[0];
    assert.equal(
        current.configs[0].address,
        "https://control.example/ottplay/api/webhook/commands"
    );
    assert.equal(current.configs[0].token, token);
    assert.equal(h.controller.status().remainingMs, 600000);
    assert.deepEqual(plain(current.options.capabilities), [
        "playback",
        "network",
    ]);
    h.controller.setEnabled(true);
    assert.equal(
        h.clients.length,
        1,
        "a repeated opt-in cannot extend consent"
    );
    h.startCapture();
    current.options.onStatus({
        message: token,
        runtimeId: "runtime-1",
        sessionId: "session-1",
        state: "active",
        token,
    });
    assert.equal(h.controller.status().state, "active");
    assert.ok(!JSON.stringify(h.controller.status()).includes(token));
    h.controller.setEnabled(false);
    stopped(h);
    assert.equal(
        h.releaseCalls,
        1,
        "client release and wrapper release are idempotent"
    );
    assert.deepEqual(current.stops, ["local_stop"]);
    const before = h.snapshotCalls;
    assert.deepEqual(plain(current.options.snapshot()), {});
    assert.equal(
        h.snapshotCalls,
        before,
        "stale transports cannot observe the logger"
    );
    current.options.onStatus({ runtimeId: "stale", state: "active" });
    assert.equal(h.controller.status().state, "disabled");
    h.controller.setEnabled(true);
    const next = h.clients[1].configs[0];
    for (const key of ["consentEpoch", "instanceId", "bootId"])
        assert.notEqual(next[key], current.configs[0][key]);
    h.controller.stop();
});

test("grant expires at ten minutes and never resumes itself", () => {
    const h = harness();
    h.controller.setEnabled(true);
    h.startCapture();
    h.advance(599999);
    assert.equal(h.controller.status().enabled, true);
    h.advance(1);
    stopped(h);
    assert.equal(h.controller.status().state, "regrant-needed");
    assert.equal(h.clients[0].stops[0], "lease_expired");
    h.advance(600000);
    assert.equal(h.clients.length, 1);
});

test("network boundary rechecks foreground consent and rejects stale responses", () => {
    const h = harness();
    h.controller.setEnabled(true);
    const options = h.clients[0].options;
    const request = {
        headers: {},
        method: "POST",
        timeoutMs: 4000,
        url: "https://control.example/diagnostics",
    };
    let replies = 0;
    const cancel = options.send(request, () => replies++);
    assert.equal(h.requests.length, 1);
    h.requests[0].complete({ body: "{}", status: 200 });
    assert.equal(replies, 1);
    cancel();
    assert.equal(h.requests[0].canceled, true);
    h.w.document.visibilityState = "hidden";
    options.send(request, () => replies++);
    stopped(h);
    assert.equal(
        h.requests.length,
        1,
        "no request before visibilitychange has fired"
    );
    h.requests[0].complete({ body: "{}", status: 200 });
    assert.equal(replies, 1);
    h.w.document.visibilityState = "visible";
    h.controller.setEnabled(true);
    options.send(request, () => replies++);
    assert.equal(
        h.requests.length,
        1,
        "old transport cannot use fresh consent"
    );
    h.controller.stop();
});

test("background, page freeze, navigation and offline revoke consent", () => {
    for (const type of ["visibilitychange", "freeze", "pagehide", "offline"]) {
        const h = harness();
        h.controller.setEnabled(true);
        h.startCapture();
        if (type === "visibilitychange")
            h.w.document.visibilityState = "hidden";
        const target = ["visibilitychange", "freeze"].includes(type)
            ? h.w.document
            : h.w;
        target.dispatch(type);
        stopped(h, type);
        h.w.document.visibilityState = "visible";
        h.w.document.dispatch("visibilitychange");
        h.w.dispatch("online");
        assert.equal(h.clients.length, 1);
    }
});

test("config edits revoke immediately and silent edits revoke at next observation", () => {
    const h = harness();
    h.controller.setEnabled(true);
    h.controller.configurationChanged({
        ...h.config,
        address: "https://control.example/ottplay/api/webhook/commands",
    });
    assert.equal(
        h.controller.status().enabled,
        true,
        "equivalent normalized address retains consent"
    );
    h.controller.configurationChanged({ ...h.config, token: "y".repeat(40) });
    stopped(h);
    assert.equal(h.clients[0].stops[0], "consent_revoked");
    h.controller.setEnabled(true);
    h.config.token = "z".repeat(40);
    h.advance(1000);
    stopped(h);
    h.controller.setEnabled(true);
    h.controller.configurationChanged(null);
    stopped(h);
});

test("clock failure, transport revoke and local logger stop release everything", () => {
    for (const value of [0, NaN, Infinity]) {
        const h = harness();
        h.controller.setEnabled(true);
        h.startCapture();
        h.setNow(value);
        h.clients[0].options.snapshot();
        stopped(h);
        assert.equal(h.clients[0].stops[0], "unsupported");
    }
    for (const state of [
        "unavailable",
        "regrant_required",
        "stopped",
        "error",
    ]) {
        const h = harness();
        h.controller.setEnabled(true);
        h.startCapture();
        h.clients[0].options.onStatus({
            reason: "do not render arbitrary error text " + token,
            state,
        });
        stopped(h);
        assert.ok(!JSON.stringify(h.statuses).includes(token));
    }
    const h = harness();
    h.controller.setEnabled(true);
    const capture = h.startCapture();
    capture.stopped();
    stopped(h);
    assert.equal(h.releaseCalls, 1);
    assert.equal(h.clients[0].captureStops, 1);
});

test("event and snapshot allowlists copy each field once without raw data", () => {
    const h = harness();
    h.controller.setEnabled(true);
    const capture = h.startCapture();
    let reads = 0;
    const data = {
        code: -1,
        size: Infinity,
        status: 503,
        url: "https://private.example/" + token,
    };
    Object.defineProperty(data, "loadMs", {
        get() {
            return ++reads === 1 ? 12 : token;
        },
    });
    capture.event({ cat: "hls", data, msg: "FRAG_LOADED", stack: token });
    assert.deepEqual(h.clients[0].events, [
        { cat: "hls", data: { loadMs: 12, status: 503 }, msg: "FRAG_LOADED" },
    ]);
    assert.equal(reads, 1);
    capture.event({ cat: "video", data: { code: 3 }, msg: token });
    capture.event({ cat: "private", data: { code: 3 }, msg: "error" });
    assert.equal(h.clients[0].events.length, 1);
    const counters = { errors: 2, provider: token, recoveries: NaN };
    Object.defineProperty(counters, "dropped", {
        get() {
            throw new Error(token);
        },
    });
    const video = {
        currentTime: 9,
        ended: true,
        paused: false,
        source: token,
        videoWidth: 1920,
    };
    let pauseReads = 0;
    Object.defineProperty(video, "paused", {
        get() {
            pauseReads++;
            return pauseReads === 1 ? false : token;
        },
    });
    h.rawSnapshot = {
        available: true,
        counters,
        enabled: true,
        url: token,
        video,
    };
    assert.deepEqual(plain(h.clients[0].options.snapshot()), {
        available: true,
        counters: { errors: 2 },
        enabled: true,
        video: { currentTime: 9, ended: true, paused: false, videoWidth: 1920 },
    });
    assert.equal(pauseReads, 1);
    h.controller.stop();
    capture.event({ cat: "video", data: { code: 3 }, msg: "error" });
    assert.equal(h.clients[0].events.length, 1);
});

test("available platform adapters only report observed safe metrics", () => {
    const h = harness();
    h.w.__ottDebugInputSnapshot = () => ({
        available: true,
        click: 4,
        down: 3,
        enabled: true,
        key: token,
        move: 2,
        wheel: 5,
    });
    h.w.__ottHostedEpg = {
        remoteSnapshot() {
            return {
                available: true,
                enabled: false,
                phase: "error",
                url: token,
            };
        },
    };
    h.controller.setEnabled(true);
    const options = h.clients[0].options;
    assert.deepEqual(plain(options.capabilities), [
        "playback",
        "network",
        "input",
        "epg",
    ]);
    assert.deepEqual(plain(options.inputSnapshot()), {
        available: true,
        enabled: true,
        inputEvents: 14,
    });
    assert.deepEqual(plain(options.epgSnapshot()), {
        available: true,
        enabled: false,
    });
    h.w.__ottDebugInputSnapshot = () => ({
        available: true,
        click: 4,
        down: null,
        enabled: true,
        move: 2,
        wheel: 5,
    });
    assert.deepEqual(plain(options.inputSnapshot()), {
        available: true,
        enabled: true,
    });
    h.w.__ottDebugInputSnapshot = () => ({
        available: true,
        click: 0,
        down: 1,
        enabled: true,
        move: Number.MAX_SAFE_INTEGER,
        wheel: 0,
    });
    assert.deepEqual(plain(options.inputSnapshot()), {
        available: true,
        enabled: true,
    });
    h.controller.stop();
    assert.deepEqual(plain(options.inputSnapshot()), {});
    assert.deepEqual(plain(options.epgSnapshot()), {});
});

test("cleanup reentry and stale callbacks cannot destroy a fresh grant", () => {
    const h = harness();
    h.controller.setEnabled(true);
    h.startCapture();
    const oldTimer = h.timerHistory[0].callback;
    const oldHandlers = [...h.w.listeners, ...h.w.document.listeners].map(
        (value) => value.callback
    );
    let reentered = false;
    h.onRelease = () => {
        if (!reentered) {
            reentered = true;
            h.controller.setEnabled(true);
        }
    };
    h.controller.stop();
    assert.equal(h.clients.length, 2);
    assert.deepEqual(h.clients[0].stops, ["local_stop"]);
    assert.deepEqual(h.clients[1].stops, []);
    assert.equal(h.controller.status().enabled, true);
    assert.equal(h.timers.size, 1);
    oldTimer();
    oldHandlers.forEach((handler) => handler());
    assert.equal(h.controller.status().enabled, true);
    assert.equal(h.timers.size, 1);
    h.clients[0].options.onStatus({ state: "regrant_required" });
    assert.equal(h.controller.status().enabled, true);
    h.controller.stop();
    stopped(h);
});

test("synchronous factory and capture callbacks cannot leave an orphan client", () => {
    const h = harness();
    h.onFactory = () => h.controller.stop();
    h.controller.setEnabled(true);
    stopped(h);
    assert.equal(h.clients.length, 1);
    assert.deepEqual(h.clients[0].stops, ["consent_revoked"]);
    const next = harness();
    next.w.__ottDebug.capture = (_event, stop) => {
        stop();
        return () => next.releaseCalls++;
    };
    next.onConfigure = () => next.startCapture();
    next.controller.setEnabled(true);
    stopped(next);
    assert.equal(next.releaseCalls, 1);
    const reentrant = harness();
    reentrant.onConfigure = (current) => {
        if (current !== reentrant.clients[0]) return;
        reentrant.controller.stop();
        reentrant.controller.setEnabled(true);
        throw new Error("Old configure failed after a fresh grant");
    };
    reentrant.controller.setEnabled(true);
    assert.equal(reentrant.controller.status().enabled, true);
    assert.equal(reentrant.clients.length, 2);
    assert.equal(reentrant.clients[1].stops.length, 0);
    reentrant.controller.stop();
    stopped(reentrant);
});

test("real transport sends only bounded consent revocation after wrapper cleanup", () => {
    const runtime = "2".repeat(32);
    const serverEpoch = "1".repeat(32);
    const runtimeToken = "runtime_" + "r".repeat(36);
    const envelope = (value) => ({
        diagnostics_protocol: 2,
        server_epoch: serverEpoch,
        ...value,
    });
    for (const reason of ["stop", "background", "configuration"]) {
        const h = harness(true);
        assert.equal(h.requests.length, 0);
        h.controller.setEnabled(true);
        const registration = h.requests[0];
        const consent = JSON.parse(registration.request.body).consent;
        assert.equal(
            registration.request.url,
            "https://control.example/ottplay/api/v2/diagnostics/runtimes"
        );
        registration.complete({
            body: JSON.stringify(
                envelope({
                    device_id: "test-device",
                    limits: {
                        event_bytes_max: 1024,
                        events_body_bytes: 16384,
                        events_per_batch: 32,
                        poll_after_ms: 3000,
                        session_lease_ms_max: 600000,
                    },
                    runtime_credential: runtimeToken,
                    runtime_id: runtime,
                    runtime_ttl_ms: 600000,
                })
            ),
            status: 201,
        });
        h.advance(0);
        const poll = h.requests[h.requests.length - 1];
        assert.equal(poll.request.url.endsWith("/poll"), true);
        poll.complete({
            body: JSON.stringify(
                envelope({
                    control: {
                        action: "start",
                        consent_epoch: consent.epoch,
                        lease_ms: 60000,
                        profile: "standard",
                        request_id: "3".repeat(32),
                        session_id: "4".repeat(32),
                    },
                    control_revision: 1,
                    poll_after_ms: 1000,
                    runtime_id: runtime,
                })
            ),
            status: 200,
        });
        const result = h.requests[h.requests.length - 1];
        assert.equal(result.request.url.endsWith("/results"), true);
        result.complete({
            body: JSON.stringify(envelope({ status: "recorded" })),
            status: 200,
        });
        h.advance(0);
        assert.equal(h.controller.status().state, "active");
        assert.equal(h.captures.length, 1);
        const count = h.requests.length;
        if (reason === "stop") h.controller.stop();
        if (reason === "background") {
            h.w.document.visibilityState = "hidden";
            h.w.document.dispatch("visibilitychange");
        }
        if (reason === "configuration")
            h.controller.configurationChanged({
                ...h.config,
                address: "https://new.example",
            });
        assert.equal(h.controller.status().enabled, false);
        assert.equal(h.captures[0].active, false);
        assert.equal(h.releaseCalls, 1);
        assert.equal(h.w.listeners.length, 0);
        assert.equal(h.w.document.listeners.length, 0);
        assert.equal(
            h.requests.length,
            count + 1,
            reason + " must notify the original controller"
        );
        const revoke = h.requests[h.requests.length - 1];
        assert.equal(
            revoke.request.url,
            "https://control.example/ottplay/api/v2/diagnostics/poll"
        );
        assert.equal(
            revoke.request.headers.Authorization,
            "Bearer " + runtimeToken
        );
        assert.deepEqual(JSON.parse(revoke.request.body), {
            consent: { granted: false },
            last_control_revision: 1,
            poll_seq: 2,
            runtime_id: runtime,
        });
        assert.equal(revoke.request.timeoutMs, 1000);
        assert.equal(
            h.timers.size,
            1,
            "only bounded independent revoke timeout survives"
        );
        h.advance(1000);
        stopped(h);
        assert.equal(revoke.canceled, true);
        revoke.complete({
            body: JSON.stringify(
                envelope({
                    control: null,
                    control_revision: 2,
                    poll_after_ms: 1000,
                    runtime_id: runtime,
                })
            ),
            status: 200,
        });
        h.advance(600000);
        assert.equal(
            h.requests.length,
            count + 1,
            "late response cannot retry or restore consent"
        );
        assert.equal(h.controller.status().enabled, false);
    }
});

function permissionMemory(initial = null) {
    return {
        finishRead(error = false) {
            this.reads.shift()(error, plain(this.value));
        },
        finishWrite(error = false) {
            const operation = this.writes.shift();
            if (!error) this.value = plain(operation.value);
            operation.done(error);
        },
        read(done) {
            this.reads.push(done);
        },
        reads: [],
        value: initial,
        write(value, done) {
            this.writes.push({ done, value: plain(value) });
        },
        writes: [],
    };
}
function trustHarness(store = permissionMemory()) {
    const h = harness(false, store, "webos.1.2.3");
    store.finishRead();
    h.controller.setTrusted(true);
    assert.equal(h.controller.status().trusted, false);
    assert.equal(h.controller.status().pending, true);
    assert.equal(
        h.clients.length,
        0,
        "registration must wait for durable permission"
    );
    store.finishWrite();
    assert.equal(h.controller.status().trusted, true);
    assert.equal(h.controller.status().enabled, true);
    return { h, store };
}

test("trusted policy is persisted separately, bound exactly and survives a page reopen", () => {
    const { h, store } = trustHarness();
    assert.deepEqual(store.value, {
        address: "https://control.example/ottplay/api/webhook/commands",
        revision: store.value.revision,
        token,
    });
    assert.match(h.clients[0].configs[0].instanceId, /^webos\.1\.2\.3\./);
    h.advance(600001);
    store.finishRead();
    assert.equal(
        h.controller.status().enabled,
        true,
        "trusted authority outlives a temporary grant"
    );
    assert.equal(h.controller.status().remainingMs, undefined);
    assert.equal(
        h.captures.length,
        0,
        "saved trust never starts a capture itself"
    );
    const reopened = harness(false, store);
    assert.equal(reopened.controller.status().pending, true);
    store.finishRead();
    assert.equal(reopened.controller.status().trusted, true);
    assert.equal(reopened.clients.length, 1);
    h.controller.stop();
    store.finishWrite();
    reopened.controller.stop();
    store.finishWrite();
    stopped(h);
    stopped(reopened);
});

test("trusted hide/offline/resume retires runtime and needs a new server command", () => {
    const { h, store } = trustHarness();
    const first = h.clients[0];
    const capture = h.startCapture();
    h.w.document.visibilityState = "hidden";
    h.w.document.dispatch("visibilitychange");
    assert.equal(h.controller.status().enabled, false);
    assert.equal(h.controller.status().trusted, true);
    assert.equal(capture.active, false);
    assert.equal(h.timers.size, 0);
    assert.equal(store.writes.length, 0);
    h.w.document.visibilityState = "visible";
    h.w.document.dispatch("visibilitychange");
    h.advance(0);
    store.finishRead();
    assert.equal(h.clients.length, 2);
    assert.notEqual(
        h.clients[1].configs[0].consentEpoch,
        first.configs[0].consentEpoch
    );
    assert.equal(
        h.captures.length,
        1,
        "resuming does not reopen the old capture"
    );
    first.options.onStatus({ sessionId: "old-session", state: "active" });
    assert.equal(h.controller.status().sessionId, undefined);
    h.w.navigator.onLine = false;
    h.w.dispatch("offline");
    assert.equal(h.controller.status().trusted, true);
    assert.equal(h.controller.status().enabled, false);
    h.w.navigator.onLine = true;
    h.w.dispatch("online");
    h.advance(0);
    store.finishRead();
    assert.equal(h.clients.length, 3);
    h.controller.stop();
    store.finishWrite();
    stopped(h);
});

test("trusted session stop preserves permission but global/local off revokes it", () => {
    const { h, store } = trustHarness();
    h.startCapture();
    const previous = h.clients[0].configs[0];
    h.controller.stopSession();
    assert.equal(h.releaseCalls, 1);
    assert.equal(h.controller.status().trusted, true);
    h.advance(0);
    store.finishRead();
    assert.equal(h.clients.length, 2);
    assert.notEqual(
        h.clients[1].configs[0].consentEpoch,
        previous.consentEpoch
    );
    h.startCapture().stopped();
    assert.equal(h.controller.status().trusted, false);
    store.finishWrite();
    assert.equal(store.value, null);
    stopped(h);
    const reloaded = harness(false, store);
    store.finishRead();
    assert.equal(reloaded.clients.length, 0);
});

test("trusted reconnect backs off and permanent authorization failure revokes", () => {
    const { h, store } = trustHarness();
    h.clients[0].options.onStatus({
        reason: "disconnected",
        state: "regrant_required",
    });
    assert.equal(h.controller.status().trusted, true);
    assert.equal(h.controller.status().enabled, false);
    h.advance(999);
    assert.equal(h.clients.length, 1);
    h.advance(1);
    store.finishRead();
    assert.equal(h.clients.length, 2);
    h.clients[1].options.onStatus({
        reason: "consent_revoked",
        state: "regrant_required",
    });
    store.finishWrite();
    stopped(h);
    h.advance(600000);
    assert.equal(h.clients.length, 2);
    assert.equal(store.value, null);
});

test("failed durable revocation stays visible until a successful retry", () => {
    const { h, store } = trustHarness();
    const grant = plain(store.value);
    const capture = h.startCapture();
    h.controller.setEnabled(false);
    stopped(h);
    assert.equal(capture.active, false, "storage cannot delay local cleanup");
    assert.equal(h.controller.status().trusted, false);
    assert.equal(h.controller.status().pending, true);
    h.controller.setEnabled(true);
    h.controller.setTrusted(true);
    assert.equal(
        h.clients.length,
        1,
        "pending durable revoke blocks new grants"
    );
    assert.equal(
        store.writes.length,
        1,
        "new grant cannot supersede a pending revoke"
    );
    store.finishWrite(true);
    const message = "Trusted access could not be removed from device storage.";
    assert.equal(h.controller.status().state, "storage-error");
    assert.equal(h.controller.status().message, message);
    assert.deepEqual(store.value, grant);
    const observed = h.statuses.length;
    h.controller.setEnabled(true);
    h.controller.setTrusted(true);
    h.controller.configurationChanged({ ...h.config, enabled: false });
    assert.equal(
        h.clients.length,
        1,
        "unresolved revocation blocks new grants"
    );
    h.controller.setEnabled(false);
    assert.equal(h.controller.status().pending, true);
    store.finishWrite(true);
    assert.equal(h.controller.status().pending, false);
    assert.ok(
        h.statuses
            .slice(observed)
            .every(
                (value) =>
                    !value.enabled &&
                    !value.trusted &&
                    value.state === "storage-error" &&
                    value.message === message
            ),
        "attempts and their pending state cannot hide the durable failure"
    );
    assert.deepEqual(store.value, grant);
    h.controller.setEnabled(false);
    store.finishWrite();
    assert.equal(h.controller.status().state, "disabled");
    assert.equal(h.controller.status().pending, false);
    assert.equal(store.value, null);
    stopped(h);
    const reopened = harness(false, store);
    store.finishRead();
    assert.equal(reopened.controller.status().trusted, false);
    assert.equal(
        reopened.clients.length,
        0,
        "cleared grant cannot return on reload"
    );
    h.controller.setEnabled(true);
    assert.equal(
        h.clients.length,
        2,
        "new consent works after successful cleanup"
    );
    h.controller.stop();
    store.finishWrite();
});

test("temporary opt-in cannot skip revocation of an unresolved startup grant", () => {
    const store = permissionMemory({
        address: "https://control.example/ottplay/api/webhook/commands",
        revision: "previous-grant",
        token,
    });
    const h = harness(false, store);
    h.controller.setEnabled(true);
    assert.equal(h.clients.length, 0);
    assert.equal(h.controller.status().pending, true);
    store.finishRead();
    assert.equal(
        h.clients.length,
        0,
        "canceled startup read cannot grant trust"
    );
    store.finishWrite(true);
    assert.equal(h.controller.status().state, "storage-error");
    stopped(h);
    h.controller.setEnabled(false);
    store.finishWrite();
    h.controller.setEnabled(true);
    assert.equal(h.clients.length, 1);
    h.controller.stop();
    store.finishWrite();
});

test("unavailable storage is distinct from a failed revoke of possible trust", () => {
    const store = permissionMemory();
    store.available = () => false;
    const h = harness(false, store);
    store.finishRead(true);
    h.controller.setTrusted(true);
    store.finishWrite(true);
    store.finishWrite(true);
    assert.equal(h.controller.status().state, "storage-error");
    assert.equal(
        h.controller.status().message,
        "Trusted diagnostics is unavailable because device storage could not be updated."
    );
    assert.equal(store.value, null);
    h.controller.setEnabled(true);
    assert.equal(
        h.clients.length,
        1,
        "temporary mode needs no durable permission"
    );
    h.controller.stop();
    store.finishWrite(true);
    stopped(h);
});

test("failed startup reads retain possible durable authority through temporary and failed trusted grants", () => {
    for (const mode of ["temporary", "trusted-write", "idle-stop"]) {
        const initial = {
            address: "https://control.example/ottplay/api/webhook/commands",
            revision: "unread-old-grant",
            token,
        };
        const store = permissionMemory(initial);
        const h = harness(false, store);
        store.finishRead(true);
        assert.equal(h.controller.status().trusted, false);
        assert.equal(h.clients.length, 0);
        if (mode === "temporary") {
            h.controller.setEnabled(true);
            h.startCapture();
            h.controller.setEnabled(false);
            assert.equal(h.releaseCalls, 1);
        } else if (mode === "trusted-write") {
            h.controller.setTrusted(true);
            store.finishWrite(true);
        } else h.controller.setEnabled(false);
        store.finishWrite(true);
        stopped(h, mode);
        assert.equal(h.controller.status().state, "storage-error", mode);
        assert.equal(
            h.controller.status().message,
            "Trusted access could not be removed from device storage.",
            mode
        );
        assert.deepEqual(store.value, initial);
        const count = h.clients.length;
        h.controller.setEnabled(true);
        h.controller.setTrusted(true);
        assert.equal(h.clients.length, count);
        assert.equal(store.writes.length, 0);
        h.controller.setEnabled(false);
        store.finishWrite(true);
        assert.equal(h.controller.status().state, "storage-error");
        h.controller.setEnabled(false);
        store.finishWrite();
        assert.equal(h.controller.status().state, "disabled");
        const reopened = harness(false, store);
        store.finishRead();
        assert.equal(reopened.clients.length, 0);
    }
});

test("failed policy reread preserves durable authority for later local revocation", () => {
    const { h, store } = trustHarness();
    const capture = h.startCapture();
    h.advance(5000);
    store.finishRead(true);
    stopped(h);
    assert.equal(capture.active, false);
    assert.equal(
        store.writes.length,
        0,
        "read failure does not erase another page's grant"
    );
    h.controller.setEnabled(false);
    store.finishWrite(true);
    assert.equal(h.controller.status().state, "storage-error");
    assert.notEqual(store.value, null);
    h.controller.setEnabled(false);
    store.finishWrite();
    assert.equal(h.controller.status().state, "disabled");
    assert.equal(store.value, null);
});

test("only successful empty reads or clear resolve possible persisted authority", () => {
    for (const periodic of [false, true]) {
        let h, store;
        if (periodic) {
            ({ h, store } = trustHarness());
            h.advance(5000);
            store.value = null;
            store.finishRead();
        } else {
            store = permissionMemory();
            h = harness(false, store);
            store.finishRead();
        }
        h.controller.setEnabled(true);
        h.controller.setEnabled(false);
        store.finishWrite(true);
        assert.notEqual(h.controller.status().state, "storage-error");
        stopped(h);
    }
    const store = permissionMemory();
    const h = harness(false, store);
    store.finishRead();
    h.controller.setTrusted(true);
    // A failed callback cannot exclude a committed write whose completion was lost.
    store.value = plain(store.writes[0].value);
    store.finishWrite(true);
    store.finishWrite(true);
    assert.equal(h.controller.status().state, "storage-error");
    h.controller.setEnabled(false);
    store.finishWrite();
    assert.equal(store.value, null);
});

test("startup and pending writes cannot restore authority after local stop or config rotation", () => {
    const initial = {
        address: "https://control.example/ottplay/api/webhook/commands",
        revision: "grant-1",
        token,
    };
    const store = permissionMemory(initial);
    const h = harness(false, store);
    h.controller.setEnabled(false);
    store.finishRead();
    assert.equal(h.clients.length, 0);
    store.finishWrite();
    assert.equal(store.value, null);
    h.controller.setTrusted(true);
    h.controller.configurationChanged({ ...h.config, token: "z".repeat(40) });
    store.finishWrite();
    assert.equal(
        h.clients.length,
        0,
        "stale completed write cannot start a runtime"
    );
    store.finishWrite();
    assert.equal(store.value, null);
    stopped(h);
    const granted = trustHarness();
    granted.h.controller.configurationChanged({
        ...granted.h.config,
        enabled: false,
    });
    granted.store.finishWrite();
    stopped(granted.h);
    assert.equal(granted.store.value, null);
});

test("revoking synchronously during grant preparation cannot write authority after cleanup", () => {
    const store = permissionMemory();
    const h = harness(false, store);
    store.finishRead();
    let revoked = false;
    h.onStatus = (status) => {
        if (status.pending && !revoked) {
            revoked = true;
            h.controller.setEnabled(false);
        }
    };
    h.controller.setTrusted(true);
    assert.equal(store.writes.length, 1);
    assert.equal(store.writes[0].value, null, "only revocation is queued");
    store.finishWrite();
    assert.equal(store.value, null);
    assert.equal(h.clients.length, 0);
    stopped(h);
});

test("failed or absent IndexedDB disables persistent trust while temporary access works", () => {
    const h = harness();
    h.controller.setTrusted(true);
    assert.equal(h.controller.status().trusted, false);
    assert.equal(h.clients.length, 0);
    h.controller.setEnabled(true);
    assert.equal(h.clients.length, 1);
    h.controller.stop();
    const store = permissionMemory();
    const failed = harness(false, store);
    store.finishRead();
    failed.controller.setTrusted(true);
    store.finishWrite(true);
    assert.equal(failed.clients.length, 0);
    assert.equal(failed.controller.status().trusted, false);
    store.finishWrite();
    assert.equal(store.value, null);
    failed.controller.setEnabled(true);
    assert.equal(failed.clients.length, 1);
    failed.controller.stop();
});

test("repair adapter preserves backend ownership, ACK and local cancellation guards", () => {
    const h = harness();
    h.controller.setEnabled(true);
    const options = h.clients[0].options;
    const replies = [];
    options.executeRepair(
        "restart_stream",
        (value) => replies.push(value),
        () => assert.fail("stream has no deferred effect")
    );
    assert.deepEqual(replies, ["unsupported"]);
    let restarted = 0;
    const play = () => {};
    h.w.stbPlay = play;
    h.w.__ottCoreTransport = { play };
    h.w.__ottCoreBackend = () => ({
        restart: () => {
            restarted++;
            return { safe: true };
        },
    });
    options.executeRepair(
        "restart_stream",
        (value) => replies.push(value),
        () => {}
    );
    assert.equal(restarted, 1);
    assert.equal(replies[1], "applied");
    let reloads = 0;
    let effect;
    h.w.restart = () => reloads++;
    const cancel = options.executeRepair(
        "reload_player",
        (value) => replies.push(value),
        (callback) => {
            effect = callback;
        }
    );
    assert.equal(reloads, 0);
    assert.equal(replies[2], "accepted");
    cancel();
    effect();
    assert.equal(reloads, 0, "canceled receipt must not reload");
    options.executeRepair(
        "reload_player",
        (value) => replies.push(value),
        (callback) => {
            effect = callback;
        }
    );
    effect();
    assert.equal(reloads, 1);
    options.executeRepair(
        "reload_player",
        () => {},
        (callback) => {
            effect = callback;
        }
    );
    h.controller.stop();
    effect();
    assert.equal(reloads, 1, "old runtime may not reload after local stop");
});

test("another page's revocation stops cached trust and preserves a newer grant", () => {
    const { h: first, store } = trustHarness();
    const second = harness(false, store);
    store.finishRead();
    second.startCapture();
    const previousRevision = store.value.revision;
    first.controller.stop();
    store.finishWrite();
    first.controller.setTrusted(true);
    store.finishWrite();
    assert.notEqual(store.value.revision, previousRevision);
    second.advance(5000);
    assert.equal(store.reads.length, 1);
    store.finishRead();
    assert.equal(second.controller.status().trusted, false);
    assert.equal(second.captures[0].active, false);
    assert.equal(
        store.writes.length,
        0,
        "a stale page must not delete another page's newer authorization"
    );
    assert.equal(first.controller.status().trusted, true);
    first.controller.stop();
    store.finishWrite();
    stopped(first);
    stopped(second);
});

test("notification prompts an authoritative reread and resume cannot bypass revoked policy", () => {
    const { h, store } = trustHarness();
    h.w.document.visibilityState = "hidden";
    h.w.document.dispatch("visibilitychange");
    store.value = null;
    h.w.document.visibilityState = "visible";
    h.w.document.dispatch("visibilitychange");
    h.advance(0);
    assert.equal(
        h.clients.length,
        1,
        "resume must wait for the durable grant reread"
    );
    store.finishRead();
    stopped(h);
    assert.equal(h.controller.status().trusted, false);
    const fresh = permissionMemory();
    let changed;
    fresh.subscribe = (listener) => {
        changed = listener;
        return () => {
            changed = null;
        };
    };
    const watched = trustHarness(fresh).h;
    fresh.value = null;
    changed();
    assert.equal(fresh.reads.length, 1);
    fresh.finishRead();
    stopped(watched);
    assert.equal(changed, null);
});

test("a pre-suspension permission read cannot authorize resumed registration", () => {
    const { h, store } = trustHarness();
    const oldGrant = plain(store.value);
    h.advance(5000);
    const staleRead = store.reads.shift();
    h.w.document.visibilityState = "hidden";
    h.w.document.dispatch("visibilitychange");
    store.value = null;
    h.w.document.visibilityState = "visible";
    h.w.document.dispatch("visibilitychange");
    h.advance(0);
    staleRead(false, oldGrant);
    assert.equal(
        h.clients.length,
        1,
        "old read snapshot cannot start the next runtime"
    );
    assert.equal(
        store.reads.length,
        1,
        "resume requires a new authoritative read"
    );
    store.finishRead();
    assert.equal(h.controller.status().trusted, false);
    stopped(h);
});

console.log("diagnostics controller tests passed");
