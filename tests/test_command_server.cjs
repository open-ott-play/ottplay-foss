const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
const source = fs.readFileSync(
    path.join(__dirname, "../src/plugins/command-server.ts"),
    "utf8"
);
const code = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES5,
    },
}).outputText;
acorn.parse(code, { ecmaVersion: 5 });
let clock = 1000000;
const moduleContext = {
    console,
    Date: { now: () => clock },
    exports: {},
    require(name) {
        assert.equal(name, "../shared/wire-contracts");
        return require("./load-wire.cjs")();
    },
    URL,
};
vm.runInNewContext(code, moduleContext);
const {
    createCommandServer,
    createCommandServerTransport,
    normalizeCommandServerAddress: normalize,
} = moduleContext.exports;
const token = "device_read_code_" + "a".repeat(32);
for (const [input, expected] of [
    ["192.168.1.20", "http://192.168.1.20:8081/api/webhook/commands"],
    ["player.local:9090", "http://player.local:9090/api/webhook/commands"],
    [
        "server.local?device_id=lounge",
        "http://server.local:8081/api/webhook/commands?device_id=lounge",
    ],
    [
        "server.local:8081?device_id=lounge",
        "http://server.local:8081/api/webhook/commands?device_id=lounge",
    ],
    [
        "server.local:9090?device_id=lounge",
        "http://server.local:9090/api/webhook/commands?device_id=lounge",
    ],
    [
        "server.local/remote?device_id=lounge:tv",
        "http://server.local:8081/remote/api/webhook/commands?device_id=lounge%3Atv",
    ],
    [
        "server.local/webhook/poll?device_id=lounge",
        "http://server.local:8081/api/webhook/commands?device_id=lounge",
    ],
    [
        "[::1]?device_id=lounge",
        "http://[::1]:8081/api/webhook/commands?device_id=lounge",
    ],
    [
        "2001:db8::1?device_id=lounge",
        "http://[2001:db8::1]:8081/api/webhook/commands?device_id=lounge",
    ],
    [
        "[2001:db8::1]:9090?device_id=lounge",
        "http://[2001:db8::1]:9090/api/webhook/commands?device_id=lounge",
    ],
    ["[::1]", "http://[::1]:8081/api/webhook/commands"],
    ["2001:db8::1", "http://[2001:db8::1]:8081/api/webhook/commands"],
    ["[2001:db8::1]:9090", "http://[2001:db8::1]:9090/api/webhook/commands"],
    [
        "https://server.example/remote/",
        "https://server.example/remote/api/webhook/commands",
    ],
    [
        "http://server.example/webhook/poll?device_id=living-room",
        "http://server.example/api/webhook/commands?device_id=living-room",
    ],
    [
        "https://server.example/api/webhook/commands",
        "https://server.example/api/webhook/commands",
    ],
])
    assert.equal(normalize(input), expected, input);
for (const input of [
    "",
    "ftp://host",
    "javascript:alert(1)",
    "https://user:pass@host",
    "https://host#secret",
    "https://host?token=secret",
    "https://host?device_id=a&token=b",
    "host:abc",
    "http://host\\@evil",
    "[notipv6]",
    "http://host:99999",
    "host?token=secret",
    "host:8081?token=secret",
    "host?device_id=lounge&token=secret",
    "host?device_id=lounge&device_id=other",
    "host?device_id=",
    "host?device_id=lounge%26token%3Dsecret",
    "user:pass@host?device_id=lounge",
    "host:abc?device_id=lounge",
    "host:99999?device_id=lounge",
]) {
    assert.throws(() => normalize(input), undefined, input);
}
function harness(protocol = "http:") {
    const jobs = new Map();
    const requests = [];
    const saved = [];
    const delivered = [];
    const behavior = { outcome: undefined };
    let sequence = 0;
    const w = {
        clearTimeout(id) {
            jobs.delete(id);
        },
        location: { protocol },
        setTimeout(fn, delay) {
            jobs.set(++sequence, { delay, fn });
            return sequence;
        },
    };
    const controller = createCommandServer(
        w,
        (request, complete) => {
            const call = { aborted: false, complete, request };
            requests.push(call);
            return () => {
                call.aborted = true;
            };
        },
        (value) => saved.push({ ...value }),
        (command) => {
            if (behavior.outcome !== "deferred") delivered.push(command);
            if (behavior.onDispatch) behavior.onDispatch();
            return behavior.outcome;
        }
    );
    function next() {
        assert.equal(jobs.size, 1, "only one retry/poll timer is scheduled");
        const [id, job] = [...jobs][0];
        jobs.delete(id);
        job.fn();
        return job.delay;
    }
    function respond(body, status = 200) {
        requests.at(-1).complete({ body: JSON.stringify(body), status });
    }
    function connect(extra = {}) {
        controller.configure({
            address: "server.local",
            enabled: true,
            token,
            ...extra,
        });
    }
    return {
        behavior,
        connect,
        controller,
        delivered,
        jobs,
        next,
        requests,
        respond,
        saved,
        w,
    };
}
const bareQuery = harness();
bareQuery.connect({ address: "server.local?device_id=lounge" });
assert.equal(
    bareQuery.requests[0].request.url,
    "http://server.local:8081/api/webhook/commands?device_id=lounge&delivery=ack"
);
bareQuery.respond({
    commands: [{ command: "popup_message", id: "scoped", message: "Fixture" }],
});
bareQuery.next();
assert.equal(
    bareQuery.requests[1].request.url,
    "http://server.local:8081/api/webhook/commands/ack?device_id=lounge"
);
assert.deepEqual(JSON.parse(bareQuery.requests[1].request.body), {
    ids: ["scoped"],
});
const h = harness();
assert.equal(h.controller.status().enabled, false);
assert.equal(h.requests.length, 0);
h.connect();
assert.equal(
    h.requests.length,
    1,
    "supplied code works without crypto or a native listener"
);
assert.equal(
    h.saved[0].enabled,
    false,
    "persist disabled before granting connection"
);
assert.equal(h.saved.at(-1).enabled, true);
assert.equal(h.requests[0].request.headers.Authorization, "Bearer " + token);
assert.equal(
    new URL(h.requests[0].request.url).search,
    "?delivery=ack",
    "strict server query contract has no cache-buster"
);
assert.ok(!h.requests[0].request.url.includes(token));
assert.ok(!JSON.stringify(h.controller.status()).includes(token));
h.controller.poll();
assert.equal(h.requests.length, 1, "no overlapping request");
h.respond({
    commands: [
        { command: "set_volume", id: "one", volume_step: 5 },
        { channel_number: 2, command: "channel_by_number", id: "two" },
    ],
});
assert.equal(h.delivered.length, 2);
assert.equal(h.next(), 0);
assert.equal(h.requests[1].request.method, "POST");
assert.equal(
    h.requests[1].request.url,
    "http://server.local:8081/api/webhook/commands/ack"
);
assert.deepEqual(JSON.parse(h.requests[1].request.body), {
    ids: ["one", "two"],
});
h.respond({ error: "offline" }, 503);
assert.equal(h.controller.status().state, "error");
assert.ok(h.next() >= 2000);
assert.equal(
    h.requests[2].request.method,
    "POST",
    "retry the ACK before polling more commands"
);
assert.equal(h.delivered.length, 2, "lost ACK cannot repeat a volume step");
h.respond({ acknowledged: 2, status: "ok" });
assert.equal(h.next(), 1000);
h.respond({
    commands: [
        { command: "set_volume", id: "one", volume_step: 5 },
        { command: "popup_message", id: "three", message: "new" },
    ],
});
assert.deepEqual(
    h.delivered.map((x) => x.id),
    ["one", "two", "three"]
);
h.next();
h.respond({ acknowledged: 2, status: "ok" });
h.next();
const old = h.requests.at(-1);
h.connect({ address: "other.local", token: "b".repeat(64) });
assert.equal(old.aborted, true);
old.complete({
    body: JSON.stringify({
        commands: [{ command: "exit_player", id: "stale" }],
    }),
    status: 200,
});
assert.equal(
    h.delivered.length,
    3,
    "old endpoint/token cannot deliver after reconfiguration"
);
const latest = h.requests.at(-1);
h.controller.configure({
    address: "other.local",
    enabled: false,
    token: "b".repeat(64),
});
assert.equal(latest.aborted, true);
latest.complete({
    body: '{"commands":[{"id":"late","command":"exit_player"}]}',
    status: 200,
});
assert.equal(h.delivered.length, 3);
assert.equal(h.jobs.size, 0);
assert.equal(h.controller.status().enabled, false);
// Reconnecting the same device queue must not repeat a non-idempotent command
// when delivery succeeded but its ACK did not reach the server.
const reconnect = harness();
const volumeStep = { command: "set_volume", id: "reconnect", volume_step: 5 };
reconnect.connect();
reconnect.respond({ commands: [volumeStep] });
reconnect.next();
reconnect.respond({}, 503);
reconnect.controller.configure({
    address: "server.local",
    enabled: false,
    token,
});
assert.equal(reconnect.jobs.size, 0);
reconnect.connect({ address: "http://server.local:8081/api/webhook/commands" });
reconnect.respond({ commands: [volumeStep] });
assert.equal(
    reconnect.delivered.length,
    1,
    "same normalized queue keeps dedupe history"
);
reconnect.next();
assert.deepEqual(JSON.parse(reconnect.requests.at(-1).request.body), {
    ids: [volumeStep.id],
});
const oldAck = reconnect.requests.at(-1);
reconnect.connect();
assert.equal(oldAck.aborted, true);
oldAck.complete({ body: '{"status":"ok"}', status: 200 });
assert.equal(reconnect.jobs.size, 0, "retired ACK cannot schedule a poll");
reconnect.respond({ commands: [volumeStep] });
assert.equal(reconnect.delivered.length, 1);
reconnect.connect({ token: "b".repeat(64) });
reconnect.respond({ commands: [volumeStep] });
assert.equal(
    reconnect.delivered.length,
    2,
    "a different device token has its own queue"
);
reconnect.connect({ address: "other.local", token: "b".repeat(64) });
reconnect.respond({ commands: [volumeStep] });
assert.equal(
    reconnect.delivered.length,
    3,
    "a different endpoint has its own queue"
);
reconnect.controller.configure({
    address: "edited.local",
    enabled: false,
    token,
});
reconnect.connect({ address: "other.local", token: "b".repeat(64) });
reconnect.respond({ commands: [volumeStep] });
assert.equal(
    reconnect.delivered.length,
    4,
    "disabled identity edits retire previous history"
);
assert.ok(!JSON.stringify(reconnect.controller.status()).includes(token));

const reentrant = harness();
reentrant.behavior.onDispatch = () => {
    reentrant.behavior.onDispatch = null;
    reentrant.connect();
};
reentrant.connect();
reentrant.respond({ commands: [volumeStep] });
reentrant.respond({ commands: [volumeStep] });
assert.equal(
    reentrant.delivered.length,
    1,
    "dispatch-triggered reconnect retains completed ID"
);

const bounded = harness();
bounded.connect();
for (let batch = 0; batch < 9; batch++) {
    const start = batch * 256;
    bounded.respond({
        commands: Array.from({ length: 256 }, (_, i) => ({
            command: "popup_message",
            id: "history-" + (start + i),
        })),
    });
    // Reconnect retires pending requests, not history. Exercise the bound across generations.
    bounded.connect();
}
bounded.respond({
    commands: [
        { command: "popup_message", id: "history-0" },
        { command: "popup_message", id: "history-2303" },
    ],
});
assert.equal(
    bounded.delivered.length,
    2305,
    "bounded history evicts oldest IDs and retains newest"
);
assert.equal(bounded.delivered.at(-1).id, "history-0");

const denied = harness();
denied.connect();
denied.respond({}, 401);
assert.match(denied.controller.status().message, /access code/i);
const invalid = harness();
invalid.connect({ token: "short" });
assert.equal(invalid.requests.length, 0);
assert.equal(invalid.saved.at(-1).enabled, false);
const secure = harness("https:");
secure.connect();
assert.equal(secure.requests.length, 0);
assert.match(secure.controller.status().message, /HTTPS player cannot connect/);
secure.connect({ address: "https://server.local" });
assert.equal(secure.requests.length, 1);
const native = harness("https:");
native.w.__TAURI__ = {};
native.connect();
assert.equal(
    native.requests.length,
    1,
    "native HTTP does not use WebView mixed content"
);
const malformed = harness();
malformed.connect();
malformed.respond([{ command: "exit_player", id: "legacy" }]);
assert.equal(
    malformed.delivered.length,
    0,
    "a destructive legacy endpoint is never silently accepted in ACK mode"
);
assert.equal(malformed.controller.status().state, "error");
malformed.next();
malformed.respond({
    commands: [
        { command: "exit_player", id: "valid" },
        { command: "exit_player" },
    ],
});
assert.equal(
    malformed.delivered.length,
    0,
    "validate complete envelope before executing any command"
);
const collision = harness();
collision.connect();
collision.respond({
    commands: [
        { command: "popup_message", id: "__proto__" },
        { command: "popup_message", id: "constructor" },
    ],
});
assert.equal(
    collision.delivered.length,
    2,
    "IDs cannot collide with Object.prototype"
);
const query = harness();
query.connect({ address: "https://host/webhook/poll?device_id=lounge" });
query.respond({ commands: [{ command: "exit_player", id: "x" }] });
query.next();
assert.equal(
    query.requests.at(-1).request.url,
    "https://host/api/webhook/commands/ack?device_id=lounge"
);

// Keep channel commands on the server while boot is incomplete, then ACK exactly once.
const boot = harness();
boot.behavior.outcome = "deferred";
boot.connect();
const queued = {
    commands: [
        {
            channel_number: 1,
            command: "channel_by_number",
            expires_at: 5010,
            id: "boot",
        },
    ],
    server_time: 5000,
};
boot.respond(queued);
assert.equal(boot.delivered.length, 0);
assert.equal(boot.controller.status().state, "waiting");
boot.next();
assert.equal(
    boot.requests.at(-1).request.method,
    "GET",
    "unready commands must remain unacknowledged"
);
clock += 1000;
boot.behavior.outcome = undefined;
boot.respond({ ...queued, server_time: 5001 });
assert.equal(boot.delivered.length, 1);
boot.next();
assert.equal(boot.requests.at(-1).request.method, "POST");
boot.respond({ status: "ok" });
boot.next();
boot.respond({ ...queued, server_time: 5002 });
assert.equal(boot.delivered.length, 1);
const expired = harness();
expired.behavior.outcome = "deferred";
expired.connect();
expired.respond(queued);
expired.next();
clock += 11000;
expired.behavior.outcome = undefined;
expired.respond({ ...queued, server_time: 5011 });
assert.equal(expired.delivered.length, 0);
assert.match(expired.controller.status().message, /expired/);
expired.next();
assert.equal(
    expired.requests.at(-1).request.method,
    "POST",
    "expired commands are retired without executing"
);
const capped = harness();
capped.behavior.outcome = "deferred";
capped.connect();
capped.respond({ commands: [{ command: "random_channel", id: "capped" }] });
capped.next();
clock += 60001;
capped.behavior.outcome = undefined;
capped.respond({ commands: [{ command: "random_channel", id: "capped" }] });
assert.equal(
    capped.delivered.length,
    0,
    "old servers without expiry metadata use a bounded60s client wait"
);
const rejected = harness();
rejected.behavior.outcome = "unsupported";
rejected.connect();
rejected.respond({
    commands: [{ command: "change_provider_settings", id: "unsupported" }],
});
assert.match(rejected.controller.status().message, /rejected/);
const batch = harness();
batch.connect();
batch.respond({
    commands: Array.from({ length: 55 }, (_, i) => ({
        command: "popup_message",
        id: "batch" + i,
    })),
});
batch.next();
assert.equal(JSON.parse(batch.requests.at(-1).request.body).ids.length, 50);
batch.respond({ status: "ok" });
batch.next();
assert.equal(JSON.parse(batch.requests.at(-1).request.body).ids.length, 5);
batch.respond({ status: "ok" });
assert.equal(batch.next(), 1000);
assert.equal(batch.requests.at(-1).request.method, "GET");

// Real transport contracts: native promises, timeout/abort, browser headers/body.
(async () => {
    const t = harness();
    let resolveNative;
    const completed = [];
    const transport = createCommandServerTransport(
        t.w,
        () =>
            new Promise((resolve) => {
                resolveNative = resolve;
            })
    );
    const request = {
        body: '{"ids":["one"]}',
        headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
        },
        method: "POST",
        timeoutMs: 8000,
        url: "http://host/api/webhook/commands/ack",
    };
    const abort = transport(request, (value) => completed.push(value));
    abort();
    resolveNative({ body: "{}", status: 200 });
    await Promise.resolve();
    assert.equal(completed.length, 0, "native results after abort are ignored");
    assert.equal(t.jobs.size, 0);
    transport(request, (value) => completed.push(value));
    t.next();
    assert.equal(completed.length, 1);
    assert.equal(completed[0], undefined);
    resolveNative({ body: "{}", status: 200 });
    await Promise.resolve();
    assert.equal(completed.length, 1);
    let xhr;
    t.w.XMLHttpRequest = class {
        constructor() {
            xhr = this;
            this.headers = {};
        }
        open(method, url, async) {
            Object.assign(this, { async, method, url });
        }
        setRequestHeader(name, value) {
            this.headers[name] = value;
        }
        send(body) {
            this.body = body;
        }
        abort() {
            this.aborted = true;
            this.onabort();
        }
    };
    const browserTransport = createCommandServerTransport(t.w);
    const browserAbort = browserTransport(request, (value) =>
        completed.push(value)
    );
    assert.equal(xhr.method, "POST");
    assert.equal(xhr.body, request.body);
    assert.equal(xhr.headers.Authorization, "Bearer " + token);
    assert.equal(xhr.timeout, 8000);
    browserAbort();
    assert.equal(xhr.aborted, true);
    assert.equal(completed.length, 1);
    browserTransport(request, (value) => completed.push(value));
    xhr.status = 403;
    xhr.responseText = "denied";
    xhr.onload();
    assert.deepEqual({ ...completed[1] }, { body: "denied", status: 403 });
    assert.equal(t.jobs.size, 0);
    console.log(
        "PASS command server: ES5, address/auth policy, independent consent, ACK retry/dedup, revocation, backoff, native/XHR cancellation and timeouts"
    );
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
