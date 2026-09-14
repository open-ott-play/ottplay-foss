const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const bundle = process.argv.includes("--bundle");
let context;
let dom;
if (bundle) {
    const { JSDOM } = require("jsdom");
    dom = new JSDOM("<!doctype html><video id='video'></video>", {
        runScripts: "outside-only",
        url: "https://fixture.invalid/",
    });
    context = dom.getInternalVMContext();
    context.setTimeout = context.setInterval = () => 1;
    context.console = { error() {}, log() {}, warn() {} };
    vm.runInContext(
        fs.readFileSync(path.join(root, "dist/stbPlayer.js"), "utf8"),
        context
    );
} else {
    context = vm.createContext({
        console,
        location: { origin: "https://fixture.invalid", port: "443" },
        setInterval() {},
        setTimeout() {},
    });
    context.window = context;
    const source = ts.transpileModule(
        fs.readFileSync(path.join(root, "src/debug/playback-debug.ts"), "utf8"),
        {
            compilerOptions: {
                module: ts.ModuleKind.None,
                target: ts.ScriptTarget.ES5,
            },
        }
    ).outputText;
    vm.runInContext(source, context);
}
context._ottDbgEnabled = true;
// Keep queued events visible instead of sending; real serialization is exercised.
const flushIngest = context.ottDebugFlushIngest;
context.ottDebugFlushIngest = () => {};
const original = {
    items: [
        "portal::[key:DUMMY_SECRET]http://portal.invalid/api/v1/",
        "portal::%5Bkey:DUMMY_SECRET%5Dhttp://portal.invalid/api/v1/",
        "Bearer DUMMY_SECRET",
        "password=DUMMY_SECRET",
        "token%3dDUMMY_SECRET",
    ],
    nested: {
        access_token: "DUMMY_SECRET",
        "api-key": "DUMMY_SECRET",
        headers: {
            Cookie: "sid=DUMMY_SECRET",
            "Set-Cookie": "sid=DUMMY_SECRET",
        },
        password: "DUMMY_SECRET",
        pwd: "DUMMY_SECRET",
        user: "DUMMY_SECRET",
    },
    status: 403,
    url: "https://user:DUMMY_SECRET@provider.invalid/live/name/DUMMY_SECRET/1?token=DUMMY_SECRET",
};
context.ottDebugPush(
    "net",
    "failure https://provider.invalid/path/DUMMY_SECRET",
    original
);
const ring = JSON.stringify(context._ottDbgRing);
const pending = context.ottDebugBuildIngestBody(context._ottDbgPending);
const dump = context.ottDebugDump();
for (const text of [ring, pending, dump]) {
    assert(!text.includes("DUMMY_SECRET"));
    assert(text.includes("provider.invalid/[redacted]"));
}
assert.equal(context._ottDbgRing[0].data.status, 403);
assert.equal(
    original.nested.password,
    "DUMMY_SECRET",
    "debug must not mutate playback input"
);
const circular = {};
circular.self = circular;
context.ottDebugPush("net", "cycle", circular);
assert.doesNotThrow(() => context.ottDebugDump());
assert(context.ottDebugDump().includes("[truncated]"));
async function testTransport() {
    const calls = [];
    let storedToken = "";
    if (!bundle) {
        context.sessionStorage = { getItem: () => storedToken };
    }
    const setToken = (token) => {
        storedToken = token;
        if (bundle)
            context.sessionStorage.setItem("ottplay_debug_token", token);
    };
    const queue = () => {
        context._ottDbgPending = [{ cat: "net", msg: "safe event" }];
    };
    context.fetch = (url, options) => {
        calls.push({ ...options, url });
        return Promise.resolve({
            json: () => ({ enabled: false }),
            ok: true,
            status: 200,
        });
    };
    for (const token of ["", "short", "x".repeat(32) + "\n"]) {
        setToken(token);
        queue();
        flushIngest();
        assert.equal(context._ottDbgPending.length, 0);
        queue();
        context.ottDebugFlushIngestUrgent();
        context.ottDebugTryServerConfig();
    }
    assert.equal(calls.length, 0, "no unauthenticated debug requests");
    const token = "DUMMY_AUTH_TOKEN_".repeat(3);
    setToken(token);
    queue();
    flushIngest();
    queue();
    context.ottDebugFlushIngestUrgent();
    context.ottDebugTryServerConfig();
    assert.deepEqual(
        calls.map((c) => c.url),
        ["/debug/ingest", "/debug/ingest", "/debug/config"]
    );
    assert.equal(calls[1].keepalive, true);
    for (const call of calls) {
        assert.equal(call.headers.Authorization, "Bearer " + token);
        assert(!(call.body || "").includes(token));
    }
    assert(!context.ottDebugDump().includes(token));
    const xhrCalls = [];
    let xhrStatus = 200;
    context.fetch = undefined;
    context.XMLHttpRequest = function () {
        const call = { headers: {} };
        this.open = (method, url, async) =>
            Object.assign(call, { async, method, url });
        this.setRequestHeader = (key, value) => {
            call.headers[key] = value;
        };
        this.send = (body) => {
            call.body = body;
            xhrCalls.push(call);
            this.status = xhrStatus;
            this.readyState = 4;
            if (call.async && this.onreadystatechange)
                this.onreadystatechange();
        };
    };
    queue();
    flushIngest();
    queue();
    context.ottDebugFlushIngestUrgent();
    assert.deepEqual(
        xhrCalls.map((c) => c.async),
        [true, false]
    );
    for (const call of xhrCalls) {
        assert.equal(call.headers.Authorization, "Bearer " + token);
        assert(!call.body.includes(token));
    }
    for (const status of [0, 429, 503]) {
        xhrStatus = status;
        queue();
        flushIngest();
        assert.equal(context._ottDbgPending.length, 1);
        queue();
        context.ottDebugFlushIngestUrgent();
        assert.equal(context._ottDbgPending.length, 1);
    }
    context.fetch = () => Promise.reject(new Error("offline"));
    context._ottDbgPending = Array.from({ length: 600 }, (_, i) => ({
        msg: "safe " + i,
    }));
    flushIngest();
    await new Promise(setImmediate);
    assert.equal(context._ottDbgPending.length, 600);
    const delivered = [];
    context.fetch = (_url, options) => {
        const events = JSON.parse(options.body).events;
        assert(events.length <= 500);
        assert(Buffer.byteLength(options.body, "utf8") <= 60 * 1024);
        delivered.push(...events);
        return Promise.resolve({ ok: true, status: 200 });
    };
    while (context._ottDbgPending.length) flushIngest();
    await new Promise(setImmediate);
    assert.equal(delivered.length, 600);
    assert.equal(new Set(delivered.map((e) => e.msg)).size, 600);
    context._ottDbgPending = Array.from({ length: 400 }, () => ({
        msg: "😀Я".repeat(200),
    }));
    while (context._ottDbgPending.length) flushIngest();
    await new Promise(setImmediate);
    assert.equal(
        delivered.length,
        1000,
        "multibyte batches stay within byte budget"
    );
    context._ottDbgPending = [
        { msg: "x".repeat(100000) },
        { msg: "after oversize" },
    ];
    flushIngest();
    assert.equal(delivered.at(-1).msg, "after oversize");
    for (const status of [429, 503]) {
        context.fetch = () => Promise.resolve({ ok: false, status });
        queue();
        flushIngest();
        await new Promise(setImmediate);
        assert.equal(context._ottDbgPending.length, 1);
        queue();
        context.ottDebugFlushIngestUrgent();
        await new Promise(setImmediate);
        assert.equal(context._ottDbgPending.length, 1);
    }
    context._ottDbgPending = Array.from({ length: 600 }, () => ({
        msg: "safe",
    }));
    context.ottDebugRetryBatch(
        Array.from({ length: 600 }, () => ({ msg: "retry" }))
    );
    assert.equal(context._ottDbgPending.length, context.OTT_DEBUG_RING_MAX);
    if (dom) dom.window.close();
    console.log(
        `PASS debug (${bundle ? "bundle" : "source"}): redaction, authenticated fetch/XHR/unload, no-token isolation, byte/event limits and offline/HTTP retry recovery`
    );
}
testTransport().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
