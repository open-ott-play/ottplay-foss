const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
const code = ts.transpileModule(
    fs.readFileSync(
        path.join(__dirname, "../src/plugins/notification-media.ts"),
        "utf8"
    ),
    {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }
).outputText;
acorn.parse(code, { ecmaVersion: 5 });
function jpeg(width = 3, height = 2) {
    return Uint8Array.from([
        255,
        216,
        255,
        192,
        0,
        11,
        8,
        height >> 8,
        height & 255,
        width >> 8,
        width & 255,
        1,
        1,
        17,
        0,
        255,
        218,
        0,
        2,
        0,
        255,
        217,
    ]);
}
function fixture(overrides = {}) {
    let time = 10000,
        monotonic = 10000,
        calls = [],
        urls = [],
        revoked = [],
        aborts = 0,
        cancels = 0,
        reads = 0;
    const timers = new Map();
    const context = { Date: { now: () => time }, exports: {} };
    vm.runInNewContext(code, context);
    class MediaURL extends URL {}
    MediaURL.createObjectURL = (blob) => {
        urls.push(blob);
        return "blob:test-" + urls.length;
    };
    MediaURL.revokeObjectURL = (url) => revoked.push(url);
    let body;
    const w = {
        AbortController: class {
            constructor() {
                this.signal = {};
            }
            abort() {
                aborts++;
            }
        },
        atob: (value) => Buffer.from(value, "base64").toString("binary"),
        Blob: class {
            constructor(parts, options) {
                this.parts = parts;
                this.type = options.type;
            }
        },
        clearTimeout: (id) => timers.delete(id),
        fetch: (request) => {
            calls.push(request);
            return Promise.resolve(response());
        },
        performance: { now: () => monotonic },
        ReadableStream: class {
            getReader() {}
        },
        Request: class {
            constructor(url, options) {
                this.url = url;
                Object.assign(this, options);
            }
        },
        setTimeout: (fn, delay) => {
            const id = timers.size + 1;
            timers.set(id, { delay, fn });
            return id;
        },
        URL: MediaURL,
    };
    const bytes = jpeg();
    const options = {
        address:
            "https://controller.test/proxy/api/webhook/commands?device_id=tv-1",
        media: {
            bytes: bytes.length,
            content_type: "image/jpeg",
            height: 2,
            id: "a".repeat(32),
            kind: "image",
            width: 3,
        },
        remainingMs: 5000,
        runtime: "runtime_1",
        token: "device-secret",
        ...overrides,
    };
    const data = {
        bytes: bytes.length,
        content_type: "image/jpeg",
        data_base64: Buffer.from(bytes).toString("base64"),
        expires_at: 1004,
        height: 2,
        id: options.media.id,
        runtime: options.runtime,
        server_time: 1000,
        version: 1,
        width: 3,
    };
    function response(properties = {}, chunks) {
        const encoded = Buffer.from(
            body === undefined ? JSON.stringify(data) : body
        );
        let index = 0;
        const parts = chunks || [encoded];
        return {
            body: {
                getReader: () => ({
                    cancel: () => {
                        cancels++;
                        return Promise.resolve();
                    },
                    read: () => {
                        reads++;
                        return Promise.resolve(
                            index < parts.length
                                ? { done: false, value: parts[index++] }
                                : { done: true }
                        );
                    },
                }),
            },
            headers: {
                get: (key) =>
                    key === "Content-Type"
                        ? "application/json; charset=utf-8"
                        : null,
            },
            redirected: false,
            status: 200,
            url: calls.at(-1)?.url,
            ...properties,
        };
    }
    return {
        advance: (wall, mono = wall) => {
            time += wall;
            monotonic += mono;
        },
        api: context.exports,
        calls,
        data,
        options,
        response,
        revoked,
        setBody: (value) => {
            body = value;
        },
        state: () => ({ aborts, cancels, reads }),
        timers,
        urls,
        w,
    };
}
async function flush() {
    for (let i = 0; i < 12; i++) await Promise.resolve();
}
async function load(h) {
    const results = [];
    const abort = h.api.loadNotificationMedia(h.w, h.options, (x) =>
        results.push(x)
    );
    await flush();
    return { abort, results };
}
(async () => {
    {
        const h = fixture();
        assert.equal(h.api.supportsNotificationMedia(h.w), true);
        assert.equal(h.calls.length, 0);
        assert.equal(h.api.validNotificationMedia(h.options.media), true);
        for (const changes of [
            { id: "https://evil.test" },
            { id: 12 },
            { id: Symbol("bad") },
            { url: "https://evil.test" },
            { bytes: 163841 },
            { bytes: 0 },
            { width: 641 },
            { height: 361 },
            { width: 3.2 },
            { kind: "clip" },
            { content_type: "image/svg+xml" },
        ])
            assert.equal(
                h.api.validNotificationMedia({
                    ...h.options.media,
                    ...changes,
                }),
                false
            );
        for (const key of [
            "fetch",
            "Request",
            "AbortController",
            "ReadableStream",
            "atob",
            "Blob",
            "URL",
        ]) {
            const copy = { ...h.w, [key]: undefined };
            assert.equal(h.api.supportsNotificationMedia(copy), false, key);
        }
    }
    {
        const h = fixture();
        const { results } = await load(h);
        assert.equal(results.length, 1);
        const item = results[0];
        assert(item);
        assert.equal(item.width, 3);
        assert.equal(item.height, 2);
        assert.equal(item.remainingMs, 4000);
        assert.equal(
            h.calls[0].url,
            "https://controller.test/proxy/api/notifications/media?id=" +
                "a".repeat(32) +
                "&runtime=runtime_1&device_id=tv-1"
        );
        assert.equal(h.calls[0].headers.Authorization, "Bearer device-secret");
        assert(!h.calls[0].url.includes("device-secret"));
        assert.equal(h.calls[0].redirect, "error");
        assert.equal(h.calls[0].credentials, "omit");
        assert.equal(h.calls[0].cache, "no-store");
        assert.equal(h.urls[0].type, "image/jpeg");
        assert.deepEqual(Array.from(h.urls[0].parts[0]), Array.from(jpeg()));
        item.dispose();
        item.dispose();
        assert.deepEqual(h.revoked, ["blob:test-1"]);
        assert.equal(h.timers.size, 0);
    }
    for (const changes of [
        { id: "b".repeat(32) },
        { runtime: "stale" },
        { version: 2 },
        { bytes: 5 },
        { width: 4 },
        { height: 3 },
        { content_type: "image/png" },
        { expires_at: 999 },
        { expires_at: Infinity },
        { server_time: 0 },
        { data_base64: "javascript:evil" },
        { data_base64: "A".repeat(300000) },
    ]) {
        const h = fixture();
        Object.assign(h.data, changes);
        const { results } = await load(h);
        assert.equal(results.length, 1);
        assert.equal(results[0], null, JSON.stringify(changes).slice(0, 100));
        assert.equal(h.urls.length, 0);
    }
    for (const bytes of [
        jpeg(641, 2),
        jpeg(3, 361),
        Uint8Array.from([60, 115, 118, 103, 62]),
    ]) {
        const h = fixture();
        h.data.data_base64 = Buffer.from(bytes).toString("base64");
        h.data.bytes = bytes.length;
        h.options.media.bytes = bytes.length;
        const { results } = await load(h);
        assert.equal(results[0], null);
        assert.equal(h.urls.length, 0);
    }
    for (const props of [
        { status: 302 },
        { redirected: true },
        { url: "https://evil.test/media" },
        {
            headers: {
                get: (key) => (key === "Content-Type" ? "text/html" : null),
            },
        },
        {
            headers: {
                get: (key) =>
                    key === "Content-Type" ? "application/json" : "229377",
            },
        },
        { body: null },
    ]) {
        const h = fixture();
        h.w.fetch = (req) => {
            h.calls.push(req);
            return Promise.resolve(h.response(props));
        };
        const { results } = await load(h);
        assert.equal(results[0], null);
        assert.equal(h.urls.length, 0);
        assert.equal(h.state().reads, 0);
    }
    {
        const h = fixture();
        h.w.fetch = (req) => {
            h.calls.push(req);
            return Promise.resolve(h.response({}, [new Uint8Array(229377)]));
        };
        const { results } = await load(h);
        assert.equal(results[0], null);
        assert.equal(h.urls.length, 0);
        assert(h.state().cancels > 0);
    }
    {
        const h = fixture();
        let deliver;
        h.w.fetch = (request) => {
            h.calls.push(request);
            return Promise.resolve(
                h.response({
                    body: {
                        getReader: () => ({
                            cancel: () => Promise.resolve(),
                            read: () =>
                                new Promise((resolve) => {
                                    deliver = resolve;
                                }),
                        }),
                    },
                })
            );
        };
        const results = [];
        const abort = h.api.loadNotificationMedia(h.w, h.options, (value) =>
            results.push(value)
        );
        await flush();
        abort();
        deliver({ done: false, value: Buffer.from(JSON.stringify(h.data)) });
        await flush();
        assert.equal(results.length, 0);
        assert.equal(h.urls.length, 0);
        assert(h.state().aborts > 0);
    }
    {
        const h = fixture();
        Object.defineProperty(h.w, "performance", {
            get: () => {
                throw Error("clock unavailable");
            },
        });
        const { results } = await load(h);
        assert(results[0]);
        results[0].dispose();
    }
    for (const mode of ["abort", "deadline"]) {
        const h = fixture();
        let resolve;
        h.w.fetch = (req) => {
            h.calls.push(req);
            return new Promise((r) => (resolve = r));
        };
        const results = [];
        const abort = h.api.loadNotificationMedia(h.w, h.options, (x) =>
            results.push(x)
        );
        assert.equal(Array.from(h.timers.values())[0].delay, 5000);
        if (mode === "abort") abort();
        else Array.from(h.timers.values())[0].fn();
        resolve(h.response());
        await flush();
        assert.equal(h.urls.length, 0);
        assert.equal(results.length, mode === "abort" ? 0 : 1);
        assert(h.state().aborts > 0);
    }
    {
        const h = fixture();
        let resolve;
        h.w.fetch = (req) => {
            h.calls.push(req);
            return new Promise((r) => (resolve = r));
        };
        const results = [];
        h.api.loadNotificationMedia(h.w, h.options, (x) => results.push(x));
        h.advance(-20000, 6000);
        resolve(h.response());
        await flush();
        assert.equal(results[0], null);
        assert.equal(h.urls.length, 0);
    }
    {
        const h = fixture();
        h.w.fetch = undefined;
        h.w.XMLHttpRequest = class {
            constructor() {
                throw new Error("unsafe XHR used");
            }
        };
        const { results } = await load(h);
        assert.equal(results[0], null);
        assert.equal(h.calls.length, 0);
    }
    for (const address of [
        "https://user:pass@controller.test",
        "http://controller.test/#fragment",
        "file:///x",
        "https://controller.test/?token=bad",
    ]) {
        const h = fixture({ address });
        const { results } = await load(h);
        assert.equal(results[0], null);
        assert.equal(h.calls.length, 0);
    }
    {
        const h = fixture({ token: "a".repeat(43) });
        h.w.location = new URL("https://player.test/f/pc/");
        h.w.__OTTPLAY_HOSTED__ = {
            controlTransport: {
                bases: ["https://controller.test/proxy"],
                endpoint: "/ott-control/api/device-transport",
                version: 1,
            },
        };
        const transport = ts.transpileModule(
            fs.readFileSync("src/plugins/hosted-control-transport.ts", "utf8"),
            {
                compilerOptions: {
                    module: ts.ModuleKind.None,
                    target: ts.ScriptTarget.ES5,
                },
            }
        ).outputText;
        vm.runInNewContext(transport, { URL, window: h.w });
        const { results } = await load(h);
        assert.ok(results[0], "hosted media retains bounded JSON decoding");
        assert.equal(
            h.calls[0].url,
            "https://player.test/ott-control/api/device-transport"
        );
        assert.equal(h.calls[0].method, "POST");
        assert.equal(h.calls[0].headers.Authorization, undefined);
        assert.equal(JSON.parse(h.calls[0].body).token, h.options.token);
        assert.match(
            JSON.parse(h.calls[0].body).path,
            /^\/api\/notifications\/media\?/
        );
        h.w.__ottControlTransport = undefined;
        const failed = await load(h);
        assert.equal(failed.results[0], null);
        assert.equal(
            h.calls.length,
            1,
            "missing hosted asset never falls back to leaking a direct request"
        );
    }
    {
        const phases = [];
        const h = fixture({ phase: (...args) => phases.push(args) });
        const { results } = await load(h);
        assert(results[0]);
        assert.deepEqual(phases, [
            ["fetch", false],
            ["fetch", true],
            ["base64", false],
            ["base64", true],
            ["validation", false],
            ["validation", true],
            ["blob", false],
            ["blob", true],
        ]);
        results[0].dispose();
        const safe = fixture({
            phase: () => {
                throw Error("observer unavailable");
            },
        });
        const observed = await load(safe);
        assert(observed.results[0]);
        observed.results[0].dispose();
    }
    console.log(
        "PASS notification media: ES5, capabilities, bounded JPEG validation/transport, authorization, redirects, expiry, cancellation and URL disposal"
    );
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
