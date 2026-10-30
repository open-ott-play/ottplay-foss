"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { clock, load, plain } = require("./helpers/player-presence.cjs");
const epoch = "a".repeat(32),
    token = "device-only-test-credential";
const advertisement = (changes = {}) => ({
    controller_epoch: epoch,
    heartbeat_ms: 15000,
    max_body_bytes: 4096,
    report_path: "/api/player-state",
    stale_after_ms: 45000,
    version: 1,
    ...changes,
});
function snapshot(changes = {}) {
    return {
        playback: {
            channel_number: null,
            duration: 500,
            kind: "vod",
            media_id: "12345",
            position: 10,
            provider: "plex",
            state: "playing",
            title: "Example",
            volume: 50,
            ...changes,
        },
        player: { platform: "browser", standby: false, version: "1.1.62" },
        runtime: "page-example",
    };
}
function fixture() {
    const time = clock(),
        calls = [];
    let state = snapshot();
    const w = { clearTimeout: time.clearTimeout, setTimeout: time.setTimeout };
    const { createPlayerStateReporter } = load("src/plugins/player-state.ts", {
        Date: time.Date,
        URL,
    });
    const reporter = createPlayerStateReporter(
        w,
        (request, complete) => {
            const call = {
                cancelled: false,
                complete,
                request: plain(request),
            };
            calls.push(call);
            return () => {
                call.cancelled = true;
            };
        },
        () => state
    );
    const next = (before = calls.length) => {
        for (
            let elapsed = 0;
            calls.length === before && elapsed < 16000;
            elapsed += 100
        )
            time.advance(100);
        assert.ok(calls.length > before, "expected a bounded state report");
        return calls[before];
    };
    const ack = (call, changes = {}, status = 200) => {
        const body = JSON.parse(call.request.body);
        call.complete({
            body: JSON.stringify({
                controller_epoch: body.controller_epoch,
                duplicate: false,
                received_at: "2026-10-29T12:00:00Z",
                runtime: body.runtime,
                sequence: body.sequence,
                storage: "memory",
                version: 1,
                ...changes,
            }),
            status,
        });
    };
    reporter.configure(
        "https://controller.example/proxy/api/webhook/commands?device_id=test",
        token
    );
    return {
        ack,
        calls,
        next,
        reporter,
        set: (value) => {
            state = value;
        },
        time,
    };
}
test("old controllers do not receive state reports", () => {
    const f = fixture();
    f.reporter.connected(undefined);
    f.reporter.changed();
    f.time.advance(60000);
    assert.equal(f.calls.length, 0);
    f.reporter.stop();
});
test("negotiated reports use exact body fields and device authentication", () => {
    const f = fixture();
    f.reporter.connected(advertisement());
    const call = f.next(0),
        body = JSON.parse(call.request.body);
    assert.equal(call.request.method, "POST");
    assert.equal(
        new URL(call.request.url).origin,
        "https://controller.example"
    );
    assert.equal(new URL(call.request.url).pathname, "/proxy/api/player-state");
    assert.equal(call.request.headers.Authorization, "Bearer " + token);
    assert.deepEqual(Object.keys(body).sort(), [
        "controller_epoch",
        "playback",
        "player",
        "runtime",
        "sequence",
        "version",
    ]);
    assert.equal(body.controller_epoch, epoch);
    assert.equal(body.version, 1);
    assert.equal(body.sequence, 1);
    assert.equal(body.runtime, "page-example");
    assert.deepEqual(body.playback, snapshot().playback);
    assert.ok(Buffer.byteLength(call.request.body) <= 4096);
    assert.ok(!call.request.body.includes(token));
    f.ack(call);
    f.reporter.stop();
});
test("one in-flight report coalesces rapid changes to the newest snapshot", () => {
    const f = fixture();
    f.reporter.connected(advertisement());
    const first = f.next(0);
    for (let i = 1; i <= 8; i++) {
        f.set(snapshot({ position: i + 10, title: "Changed " + i }));
        f.reporter.changed();
    }
    f.time.advance(1000);
    assert.equal(f.calls.length, 1);
    f.ack(first);
    const second = f.next(1),
        body = JSON.parse(second.request.body);
    assert.equal(body.sequence, 2);
    assert.equal(body.playback.title, "Changed 8");
    assert.equal(body.playback.position, 18);
    f.ack(second);
    f.reporter.stop();
});
test("failed transport retries identical bytes and sequence before newer state", () => {
    const f = fixture();
    f.reporter.connected(advertisement());
    const first = f.next(0);
    first.complete({ body: "", status: 503 });
    f.set(snapshot({ title: "New while retrying" }));
    f.reporter.changed();
    const retry = f.next(1);
    assert.equal(retry.request.body, first.request.body);
    f.ack(retry, { duplicate: true });
    const newest = f.next(2);
    assert.equal(JSON.parse(newest.request.body).sequence, 2);
    assert.equal(
        JSON.parse(newest.request.body).playback.title,
        "New while retrying"
    );
    f.ack(newest);
    f.reporter.stop();
});
test("new controller epoch cancels old work and ignores its late acknowledgement", () => {
    const f = fixture();
    f.reporter.connected(advertisement());
    const old = f.next(0);
    f.set(snapshot({ title: "New epoch" }));
    f.reporter.connected(advertisement({ controller_epoch: "b".repeat(32) }));
    assert.equal(old.cancelled, true);
    const current = f.next(1);
    f.ack(old);
    const body = JSON.parse(current.request.body);
    assert.equal(body.controller_epoch, "b".repeat(32));
    assert.ok(body.sequence > JSON.parse(old.request.body).sequence);
    assert.equal(body.playback.title, "New epoch");
    f.ack(current);
    f.reporter.stop();
});
test("disconnect and stop cancel work; late callbacks cannot restart reports", () => {
    for (const method of ["disconnected", "stop"]) {
        const f = fixture();
        f.reporter.connected(advertisement());
        const old = f.next(0);
        f.reporter[method]();
        assert.equal(old.cancelled, true);
        f.ack(old);
        f.reporter.changed();
        f.time.advance(60000);
        assert.equal(f.calls.length, 1);
    }
});
for (const changed of [
    { version: 2 },
    { controller_epoch: "not-an-epoch" },
    { report_path: "https://other.example/collect" },
    { report_path: "/api/../collect" },
]) {
    test(
        "malformed advertisement cannot redirect state: " +
            Object.keys(changed)[0],
        () => {
            const f = fixture();
            f.reporter.connected(advertisement(changed));
            f.reporter.changed();
            f.time.advance(60000);
            assert.equal(f.calls.length, 0);
            f.reporter.stop();
        }
    );
}
test("position-only changes coalesce until heartbeat without extra reports", () => {
    const f = fixture();
    f.reporter.connected(advertisement());
    const first = f.next(0);
    f.ack(first);
    f.set(snapshot({ position: 25 }));
    f.reporter.changed();
    f.time.advance(14900);
    assert.equal(f.calls.length, 1);
    const heartbeat = f.next(1);
    assert.equal(JSON.parse(heartbeat.request.body).sequence, 2);
    assert.equal(JSON.parse(heartbeat.request.body).playback.position, 25);
    f.ack(heartbeat);
    f.reporter.stop();
});
test("changing controller credentials retires old report and late callback", () => {
    const f = fixture();
    f.reporter.connected(advertisement());
    const old = f.next(0);
    f.reporter.configure(
        "https://next.example/api/webhook/commands",
        "new-device-credential"
    );
    assert.equal(old.cancelled, true);
    f.ack(old);
    f.time.advance(2000);
    assert.equal(f.calls.length, 1);
    f.reporter.connected(advertisement());
    const fresh = f.next(1);
    assert.equal(new URL(fresh.request.url).origin, "https://next.example");
    assert.equal(
        fresh.request.headers.Authorization,
        "Bearer new-device-credential"
    );
    assert.ok(
        JSON.parse(fresh.request.body).sequence >
            JSON.parse(old.request.body).sequence
    );
    f.ack(fresh);
    f.reporter.stop();
});
for (const [name, changes] of [
    ["sequence", { sequence: 99 }],
    ["epoch", { controller_epoch: "b".repeat(32) }],
    ["runtime", { runtime: "other-page" }],
    ["missing receipt time", { received_at: undefined }],
    ["storage", { storage: "unknown" }],
    ["duplicate type", { duplicate: "yes" }],
    ["extra field", { extra: true }],
])
    test("malformed acknowledgement cannot accept report: " + name, () => {
        const f = fixture();
        f.reporter.connected(advertisement());
        const first = f.next(0);
        f.ack(first, changes);
        const retried = f.next(1);
        assert.equal(retried.request.body, first.request.body);
        f.ack(retried);
        f.reporter.stop();
    });
test("same-controller reconfiguration cannot reset its accepted sequence", () => {
    const f = fixture();
    f.reporter.connected(advertisement());
    const first = f.next(0);
    f.ack(first);
    f.reporter.configure(
        "https://controller.example/proxy/api/webhook/commands?device_id=test",
        token
    );
    f.reporter.connected(advertisement());
    const next = f.next(1);
    assert.ok(
        JSON.parse(next.request.body).sequence >
            JSON.parse(first.request.body).sequence
    );
    f.ack(next);
    f.reporter.stop();
});
test("late completion from an earlier attempt cannot accept an in-flight retry", () => {
    const f = fixture();
    f.reporter.connected(advertisement());
    const first = f.next(0);
    first.complete({ body: "", status: 503 });
    const retry = f.next(1);
    f.set(snapshot({ title: "Next state" }));
    f.reporter.changed();
    f.ack(first);
    f.time.advance(1500);
    assert.equal(
        f.calls.length,
        2,
        "late first ACK must not schedule a new state"
    );
    f.ack(retry);
    const next = f.next(2);
    assert.equal(JSON.parse(next.request.body).playback.title, "Next state");
    assert.ok(
        JSON.parse(next.request.body).sequence >
            JSON.parse(retry.request.body).sequence
    );
    f.ack(next);
    f.reporter.stop();
});

test("cross-repository smoke loaders resolve both real presence modules", () => {
    const fs = require("node:fs");
    const vm = require("node:vm");
    const ts = require("typescript");
    const time = clock();
    const host = {
        clearTimeout: time.clearTimeout,
        setTimeout: time.setTimeout,
    };
    const wire = require("./load-wire.cjs")();
    function moduleOf(file, dependencies, window = host) {
        const exports = {};
        const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES5,
            },
        }).outputText;
        vm.runInNewContext(code, {
            Date: time.Date,
            exports,
            require: dependencies,
            URL,
            window,
        });
        return exports;
    }
    const context = { host, load: moduleOf, moduleOf, require, wire };
    for (const file of [
        "scripts/smoke-remote-cli.cjs",
        "scripts/smoke-diagnostics.cjs",
    ]) {
        const source = ts.createSourceFile(
            file,
            fs.readFileSync(file, "utf8"),
            ts.ScriptTarget.Latest,
            true
        );
        let resolver;
        let commandDependencies;
        function visit(node) {
            if (
                ts.isCallExpression(node) &&
                node.arguments[0] &&
                ts.isStringLiteral(node.arguments[0]) &&
                node.arguments[0].text === "src/plugins/command-server.ts"
            )
                resolver = node.arguments[1];
            if (
                ts.isVariableDeclaration(node) &&
                node.name.getText(source) === "dependencies"
            )
                commandDependencies = node.initializer;
            ts.forEachChild(node, visit);
        }
        visit(source);
        assert.ok(resolver, file + " must exercise the real command transport");
        const dependencies = vm.runInNewContext(
            "(" + resolver.getText(source) + ")",
            context
        );
        const transport = moduleOf(
            "src/plugins/command-server.ts",
            dependencies
        );
        const controller = transport.createCommandServer(
            host,
            () => {
                throw new Error(
                    "The loader regression must never contact a controller"
                );
            },
            () => {},
            () => {}
        );
        assert.equal(controller.status().state, "disconnected");
        assert.equal(typeof host.__ottPlayerState.changed, "function");
        if (file.endsWith("smoke-remote-cli.cjs")) {
            assert.ok(commandDependencies);
            const projection = vm.runInNewContext(
                "var dependencies = " +
                    commandDependencies.getText(source) +
                    "; dependencies('./player-state')",
                context
            );
            assert.equal(
                projection.readPlayerState(host, {
                    platform: "browser",
                    runtime: "smoke-loader",
                    standby: false,
                    version: "test",
                }).playback.state,
                "unknown"
            );
        }
    }
});
