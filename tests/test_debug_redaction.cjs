const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const bundle = process.argv.includes("--bundle");
async function testSource() {
    const context = vm.createContext({
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
        context.sessionStorage = { getItem: () => storedToken };
        const setToken = (token) => {
            storedToken = token;
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
        console.log(
            "PASS debug (source): redaction, authenticated fetch/XHR/unload, no-token isolation, byte/event limits and offline/HTTP retry recovery"
        );
    }
    await testTransport();
}

// The packaged runtime is tested through its supported API, scheduled work and
// real DOM lifecycle events. No private state is exposed for the test harness.
async function testBundle() {
    const { JSDOM } = require("jsdom");
    const code = fs.readFileSync(path.join(root, "dist/stbPlayer.js"), "utf8");
    const token = "DUMMY_AUTH_TOKEN_".repeat(3);
    const settle = () => new Promise(setImmediate);
    function fixture(enabled, initialToken = "", serverEnabled = false) {
        const dom = new JSDOM("<!doctype html><video id='video'></video>", {
            runScripts: "outside-only",
            url: "https://fixture.invalid/",
        });
        const context = dom.getInternalVMContext();
        const calls = [];
        const intervals = [];
        let respond = () =>
            Promise.resolve({
                json: () => ({ enabled: serverEnabled }),
                ok: true,
                status: 200,
            });
        context.setTimeout = () => 1;
        context.setInterval = (callback, ms) => {
            intervals.push({ callback, ms });
            return intervals.length;
        };
        context.console = { error() {}, info() {}, log() {}, warn() {} };
        context.__OTT_DEBUG__ = enabled;
        context.sessionStorage.setItem("ottplay_debug_token", initialToken);
        const fetch = (url, options) => {
            calls.push({ ...options, url });
            return respond(url, options);
        };
        context.fetch = fetch;
        vm.runInContext(
            fs.readFileSync(path.join(root, "js/runtime-polyfills.js"), "utf8"),
            context
        );
        require("./helpers/shared-core-runtime.cjs")(context);
        vm.runInContext(code, context);
        return {
            api: () => context.__ottDebug,
            calls,
            context,
            dom,
            fetch,
            flush() {
                const ingest = intervals.filter((timer) => timer.ms === 2000);
                assert.equal(
                    ingest.length,
                    1,
                    "Debug schedules one ingest interval"
                );
                ingest[0].callback();
            },
            intervals,
            respond: (callback) => {
                respond = callback;
            },
            urgent() {
                context.dispatchEvent(new context.Event("pagehide"));
            },
        };
    }
    function events(calls) {
        return calls
            .filter((call) => call.url === "/debug/ingest")
            .flatMap((call) => {
                const parsed = JSON.parse(call.body);
                assert(parsed.events.length <= 500);
                assert(Buffer.byteLength(call.body, "utf8") <= 60 * 1024);
                return parsed.events;
            });
    }
    function assertAuthenticated(calls) {
        assert(calls.length > 0);
        for (const call of calls) {
            assert.equal(call.headers.Authorization, "Bearer " + token);
            assert(!(call.body || "").includes(token));
        }
    }
    for (const invalidToken of ["", "short", "x".repeat(32) + "\n"]) {
        for (const enabled of [false, true]) {
            const f = fixture(enabled, invalidToken);
            try {
                assert.equal(f.api().enabled, enabled);
                f.api().push("net", "must not leave the client");
                if (enabled) {
                    f.flush();
                    f.api().push("net", "urgent without auth");
                    f.urgent();
                    f.context.sessionStorage.setItem(
                        "ottplay_debug_token",
                        token
                    );
                    f.flush();
                } else
                    assert.equal(
                        f.intervals.length,
                        0,
                        "Disabled debug schedules no work"
                    );
                await settle();
                assert.equal(
                    f.calls.length,
                    0,
                    "Invalid tokens cannot send or retain queued debug data"
                );
            } finally {
                f.dom.window.close();
            }
        }
    }
    for (const serverEnabled of [false, true]) {
        const auto = fixture(false, token, serverEnabled);
        try {
            assert.equal(auto.api().enabled, false);
            assert.equal(auto.calls[0].url, "/debug/config");
            assertAuthenticated(auto.calls);
            await settle();
            assert.equal(auto.api().enabled, serverEnabled);
            if (serverEnabled) {
                assert.equal(auto.calls[1].url, "/debug/ingest");
                assert.equal(events(auto.calls)[0].msg, "boot");
                assertAuthenticated(auto.calls);
                auto.flush();
            }
        } finally {
            auto.dom.window.close();
        }
    }

    const f = fixture(true);
    try {
        const api = f.api();
        for (const privateName of [
            "_ottDbgRing",
            "_ottDbgPending",
            "ottDebugPush",
            "ottDebugFlushIngest",
            "OTT_DEBUG_RING_MAX",
        ])
            assert.equal(
                f.context[privateName],
                undefined,
                privateName + " stays private"
            );
        f.context.sessionStorage.setItem("ottplay_debug_token", token);
        api.clear();
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
        api.push(
            "net",
            "failure https://provider.invalid/path/DUMMY_SECRET",
            original
        );
        assert(!api.dump().includes("DUMMY_SECRET"));
        assert(api.dump().includes("provider.invalid/[redacted]"));
        assert.equal(original.nested.password, "DUMMY_SECRET");
        const circular = {};
        circular.self = circular;
        api.push("net", "cycle", circular);
        assert(api.dump().includes("[truncated]"));
        f.flush();
        await settle();
        assertAuthenticated(f.calls);
        assert(!f.calls[0].body.includes("DUMMY_SECRET"));
        assert(f.calls[0].body.includes("provider.invalid/[redacted]"));
        assert.equal(events(f.calls)[0].data.status, 403);
        api.push("net", "urgent event");
        f.urgent();
        assert.equal(f.calls.at(-1).keepalive, true);
        assert(events(f.calls).some((event) => event.msg === "unload-stats"));
        assertAuthenticated(f.calls);

        const xhrCalls = [];
        let xhrStatus = 200;
        f.context.fetch = undefined;
        f.context.XMLHttpRequest = function () {
            const call = { headers: {} };
            this.open = (method, url, async) =>
                Object.assign(call, { async, method, url });
            this.setRequestHeader = (name, value) => {
                call.headers[name] = value;
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
        api.clear();
        api.push("net", "async xhr");
        f.flush();
        api.push("net", "urgent xhr");
        f.urgent();
        assert.deepEqual(
            xhrCalls.map((call) => call.async),
            [true, false]
        );
        assertAuthenticated(xhrCalls);
        for (const status of [0, 429, 503]) {
            for (const urgent of [false, true]) {
                api.clear();
                xhrCalls.length = 0;
                xhrStatus = status;
                api.push("net", "retry xhr " + status);
                urgent ? f.urgent() : f.flush();
                const failed = events(xhrCalls).filter(
                    (event) => event.cat === "net"
                );
                xhrStatus = 200;
                xhrCalls.length = 0;
                f.flush();
                assert.deepEqual(
                    events(xhrCalls).filter((event) => event.cat === "net"),
                    failed
                );
                assert.equal(
                    events(xhrCalls).filter((event) => event.cat === "net")
                        .length,
                    1,
                    "Failed XHR batch is retried once"
                );
                const count = xhrCalls.length;
                f.flush();
                assert.equal(xhrCalls.length, count);
            }
        }
        f.context.fetch = f.fetch;
        for (const failure of [
            () => Promise.reject(new Error("offline")),
            ...[429, 503].map(
                (status) => () => Promise.resolve({ ok: false, status })
            ),
        ]) {
            for (const urgent of [false, true]) {
                api.clear();
                f.calls.length = 0;
                f.respond(failure);
                api.push("net", "retry fetch");
                urgent ? f.urgent() : f.flush();
                await settle();
                f.respond(() => Promise.resolve({ ok: true, status: 200 }));
                f.calls.length = 0;
                f.flush();
                await settle();
                assert.equal(
                    events(f.calls).filter(
                        (event) => event.msg === "retry fetch"
                    ).length,
                    1
                );
                const count = f.calls.length;
                f.flush();
                assert.equal(
                    f.calls.length,
                    count,
                    "Successfully retried batch leaves the queue"
                );
            }
        }
        api.clear();
        f.calls.length = 0;
        for (let index = 0; index < 600; index++)
            api.push("net", "safe " + index);
        for (let tick = 0; tick < 4; tick++) f.flush();
        await settle();
        assert.equal(events(f.calls).length, 600);
        assert.equal(
            new Set(events(f.calls).map((event) => event.msg)).size,
            600
        );
        api.clear();
        f.calls.length = 0;
        for (let index = 0; index < 400; index++)
            api.push("net", "😀Я".repeat(200));
        for (let tick = 0; tick < 40; tick++) f.flush();
        await settle();
        assert.equal(
            events(f.calls).length,
            400,
            "Multibyte events arrive within byte limits"
        );
        api.clear();
        f.calls.length = 0;
        api.push("net", "x".repeat(100000));
        api.push("net", "after oversize");
        f.flush();
        assert.deepEqual(
            events(f.calls).map((event) => event.msg),
            ["after oversize"]
        );
        assert(
            api.dump().includes("x".repeat(100000)),
            "Oversize events remain locally inspectable"
        );
        api.clear();
        f.calls.length = 0;
        let rejectPending;
        f.respond(
            () =>
                new Promise((_resolve, reject) => {
                    rejectPending = reject;
                })
        );
        for (let index = 0; index < 500; index++)
            api.push("net", "old " + index);
        f.flush();
        for (let index = 0; index < 600; index++)
            api.push("net", "new " + index);
        rejectPending(new Error("offline"));
        await settle();
        f.respond(() => Promise.resolve({ ok: true, status: 200 }));
        f.calls.length = 0;
        for (let tick = 0; tick < 4; tick++) f.flush();
        await settle();
        const retained = events(f.calls);
        assert.equal(retained.length, 800, "Offline retry queue is capped");
        assert.equal(retained[0].msg, "old 300");
        assert.equal(retained.at(-1).msg, "new 599");
        assert.equal(
            api.dump().split("\n").length,
            800,
            "Local event ring remains bounded"
        );
        assert(!api.dump().includes(token));
    } finally {
        f.dom.window.close();
    }
    console.log(
        "PASS debug (bundle public API): private scope, redaction, authenticated fetch/XHR/unload, no-token isolation, byte/event limits and offline/HTTP retry recovery"
    );
}

(bundle ? testBundle() : testSource()).catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
