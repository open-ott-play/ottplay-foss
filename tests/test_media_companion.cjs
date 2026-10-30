const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");
const ts = require("typescript");
function compile(path) {
    const code = ts.transpileModule(fs.readFileSync(path, "utf8"), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText;
    require("acorn").parse(code, { ecmaVersion: 5 });
    return code;
}
const code = compile("src/plugins/media-companion.ts");
const base = "http://127.0.0.1:19000/companion/" + "a".repeat(32) + "/v1";
const source = "magnet:?xt=urn:btih:" + "0".repeat(40);
const clone = (v) => JSON.parse(JSON.stringify(v));
const flush = async () => {
    for (let n = 0; n < 50; n++) await Promise.resolve();
};
function deferred() {
    let resolve;
    const promise = new Promise((r) => {
        resolve = r;
    });
    return { promise, resolve };
}
function fixture(custom = {}) {
    const calls = [],
        timers = new Map(),
        listeners = {},
        outcomes = [],
        transports = [];
    let sequence = 0,
        nativeCalls = 0;
    const response = (value) => ({
        json: async () => value,
        ok: true,
        status: 200,
    });
    const w = {
        AbortController,
        addEventListener: (name, fn) => {
            listeners[name] = fn;
        },
        fetch: async (url, options) => {
            const path = url.slice(base.length + 1);
            const body = options.body ? JSON.parse(options.body) : undefined;
            calls.push({
                body,
                credentials: options.credentials,
                method: options.method,
                path,
                signal: options.signal,
            });
            if (custom.response) {
                const result = custom.response(path, options);
                if (result !== undefined) return result;
            }
            if (custom.handle) {
                const result = custom.handle(
                    path,
                    options.method,
                    body,
                    options
                );
                if (result !== undefined) return response(await result);
            }
            if (path === "capabilities")
                return response({ plugins: true, schema: 1, torrent: true });
            if (path === "sessions" && options.method === "POST")
                return response({
                    files: [],
                    id: "s" + ++sequence,
                    state: "metadata",
                });
            if (/^sessions\/s\d+$/.test(path) && options.method === "GET")
                return response({
                    files: [
                        { index: 0, length: 30, name: "readme.txt" },
                        { index: 2, length: 1000, name: "movie.mp4" },
                    ],
                    id: path.split("/")[1],
                    state: "select",
                });
            if (path.endsWith("/select"))
                return response({
                    files: [{ index: 2, length: 1000, name: "movie.mp4" }],
                    id: path.split("/")[1],
                    selected: body.fileIndex,
                    state: "ready",
                    streamPath: path.replace(/\/select$/, "/stream"),
                });
            if (options.method === "DELETE") return response({});
            throw new Error("Unexpected request " + path);
        },
        settings: { companionEndpoint: custom.native ? "" : base },
    };
    if (custom.noFetch) delete w.fetch;
    vm.runInNewContext(code, {
        clearTimeout: (key) => timers.delete(key),
        Error,
        Number,
        Promise,
        setTimeout: (fn, ms) => {
            const key = {};
            timers.set(key, { fn, ms });
            return key;
        },
        URL,
        URLSearchParams,
        window: w,
    });
    const client = w.__ottMediaCompanionFactory(
        w,
        custom.native
            ? async () => {
                  nativeCalls++;
                  return { endpoint: base };
              }
            : undefined,
        custom.nativeOnly === true
    );
    return {
        calls,
        client,
        listeners,
        nativeCalls: () => nativeCalls,
        outcomes,
        resolve: (value = source, options) =>
            client.resolve(
                value,
                (v, transport) => {
                    outcomes.push(v);
                    transports.push(transport);
                },
                options
            ),
        tick: async (ms) => {
            const ready = [...timers].filter(([, t]) => t.ms === ms);
            ready.forEach(([key, t]) => {
                timers.delete(key);
                t.fn();
            });
            await flush();
        },
        timers,
        transports,
        w,
    };
}
test("two viewers own distinct leases and preserve the durable source URI", async () => {
    const f = fixture();
    const a = f.resolve(),
        b = f.resolve();
    await flush();
    await f.tick(750);
    assert.deepEqual(f.outcomes, [
        base + "/sessions/s1/stream",
        base + "/sessions/s2/stream",
    ]);
    assert.deepEqual(f.transports, ["file", "file"]);
    assert.equal(f.client.status().source, source);
    assert.equal(f.calls.filter((c) => c.path.endsWith("/select")).length, 2);
    assert.equal(
        f.calls.every((c) => c.credentials === "omit"),
        true
    );
    a();
    await flush();
    assert.deepEqual(
        f.calls.filter((c) => c.method === "DELETE").map((c) => c.path),
        ["sessions/s1"]
    );
    b();
    await flush();
    assert.equal(f.calls.filter((c) => c.method === "DELETE").length, 2);
});
test("a cancelled creation deletes its late receipt without starting playback", async () => {
    const pending = deferred();
    const f = fixture({
        handle: (path, method) =>
            path === "sessions" && method === "POST"
                ? pending.promise
                : undefined,
    });
    const cancel = f.resolve();
    await flush();
    cancel();
    pending.resolve({ files: [], id: "late", state: "metadata" });
    await flush();
    assert.deepEqual(f.outcomes, []);
    assert.deepEqual(
        f.calls.filter((c) => c.method === "DELETE").map((c) => c.path),
        ["sessions/late"]
    );
});
test("request timeout also cleans a creation receipt which arrives later", async () => {
    const pending = deferred();
    const f = fixture({
        handle: (path, method) =>
            path === "sessions" && method === "POST"
                ? pending.promise
                : undefined,
    });
    f.resolve();
    await flush();
    await f.tick(10000);
    assert.deepEqual(f.outcomes, [null]);
    pending.resolve({ id: "late", state: "metadata" });
    await flush();
    assert.equal(
        f.calls.some(
            (c) => c.path === "sessions/late" && c.method === "DELETE"
        ),
        true
    );
});
test("cancelled or timed out creates have a bounded final abort grace", async () => {
    let aborted = 0;
    const f = fixture({
        handle: (path, method, body, options) =>
            path === "sessions" && method === "POST"
                ? new Promise((resolve, reject) => {
                      options.signal.addEventListener("abort", () => {
                          aborted++;
                          reject(new Error("aborted"));
                      });
                  })
                : undefined,
    });
    const cancel = f.resolve();
    f.resolve();
    await flush();
    cancel();
    await f.tick(10000);
    assert.equal(aborted, 0, "allow a late receipt to identify its lease");
    assert.deepEqual(f.outcomes, [null]);
    await f.tick(30000);
    assert.equal(aborted, 2);
    assert.equal(f.timers.size, 0);
});
test("preparing is polled until ready and active buffered leases keep a heartbeat", async () => {
    let selected = false,
        now = 0,
        touched = 0,
        samples = 0;
    const f = fixture({
        handle: (path, method) => {
            if (path.endsWith("/select")) {
                selected = true;
                return { id: "s1", state: "preparing" };
            }
            if (path === "sessions/s1" && method === "GET" && selected) {
                assert(now - touched < 120000, "lease did not expire");
                touched = now;
                samples++;
                return {
                    downloaded: 1000,
                    id: "s1",
                    state: "ready",
                    streamPath: "sessions/s1/stream",
                    total: 1000,
                };
            }
            return undefined;
        },
    });
    const cancel = f.resolve();
    await flush();
    await f.tick(750);
    assert.deepEqual(f.outcomes, [], "preparing must not fail the resolver");
    await f.tick(750);
    assert.deepEqual(f.outcomes, [base + "/sessions/s1/stream"]);
    for (let i = 0; i < 6; i++) {
        now += 30000;
        await f.tick(30000);
    }
    assert.equal(samples, 7, "fully buffered playback still renews its lease");
    assert.equal(f.client.status().downloaded, 1000);
    assert.equal(f.client.status().total, 1000);
    assert.equal(f.outcomes.length, 1, "heartbeat must not restart playback");
    cancel();
    await flush();
    assert.equal(f.timers.size, 0);
    await f.tick(30000);
    assert.equal(samples, 7);
});
test("backend failures retain only explicit public error codes", async () => {
    for (const [error, expected, status] of [
        ["cache_limit", "cache_limit", 409],
        ["plugin_network_denied", "plugin_network_denied", 400],
        ["private_token_from_unknown_error", "companion_request_failed", 400],
        ["https://private.invalid/token", "companion_request_failed", 500],
        ["cache_limit", "companion_access_denied", 401],
    ]) {
        const f = fixture({
            response: () => ({
                json: async () => ({ error }),
                ok: false,
                status,
            }),
        });
        f.resolve();
        await flush();
        assert.deepEqual(f.outcomes, [null]);
        assert.equal(f.client.status().error, expected);
    }
});
test("metadata has a finite deadline and pagehide releases a playing session", async () => {
    const f = fixture();
    f.resolve();
    await flush();
    await f.tick(60000);
    assert.deepEqual(f.outcomes, [null]);
    assert.equal(f.client.status().error, "companion_timeout");
    const g = fixture();
    g.resolve();
    await flush();
    await g.tick(750);
    g.listeners.pagehide();
    await flush();
    assert.equal(
        g.calls.some((c) => c.method === "DELETE"),
        true
    );
    assert.equal(g.timers.size, 0);
});
test("native endpoint is reacquired after release while explicit endpoint overrides it", async () => {
    const f = fixture({ native: true });
    const a = f.resolve();
    await flush();
    await f.tick(750);
    a();
    await flush();
    f.resolve();
    await flush();
    assert.equal(f.nativeCalls(), 2);
    f.w.settings.companionEndpoint = base;
    f.resolve();
    await flush();
    assert.equal(f.nativeCalls(), 2);
});

test("owned native source ignores a saved external endpoint", async () => {
    const f = fixture({
        handle: (path, method) =>
            path === "sessions/s1" && method === "GET"
                ? {
                      files: [{ index: 2, name: "movie.mp4" }],
                      id: "s1",
                      selected: 2,
                      state: "ready",
                      streamPath: "sessions/s1/stream",
                  }
                : undefined,
        native: true,
        nativeOnly: true,
    });
    f.w.settings.companionEndpoint =
        "https://external.invalid/companion/" + "z".repeat(32) + "/v1";
    f.resolve(
        "ottplay-torrent:?source=" +
            encodeURIComponent(source) +
            "&index=2&native=1"
    );
    await flush();
    assert.equal(f.nativeCalls(), 1);
    assert.deepEqual(
        clone(f.calls.find((call) => call.path === "sessions").body),
        { fileIndex: 2, source }
    );
    await f.tick(750);
    assert.deepEqual(f.outcomes, [base + "/sessions/s1/stream"]);
});
test("file selector remains durable and never stores an HTTP playback lease", async () => {
    const f = fixture();
    f.resolve(source + "&so=2");
    await flush();
    const body = f.calls.find((c) => c.path === "sessions").body;
    assert.equal(body.fileIndex, 2);
    assert.equal(body.source.includes("so="), false);
    await f.tick(750);
    assert.equal(f.client.choices()[0].source.includes("so=2"), true);
    assert.equal(f.client.choices()[0].source.includes("/sessions/"), false);
});
test("invalid or foreign stream receipts are rejected and cleaned", async () => {
    const f = fixture({
        handle: (path) =>
            path.endsWith("/select")
                ? {
                      id: "s1",
                      state: "ready",
                      streamPath: "https://foreign.invalid/video.mp4",
                  }
                : undefined,
    });
    f.resolve();
    await flush();
    await f.tick(750);
    assert.deepEqual(f.outcomes, [null]);
    assert.equal(
        f.calls.some((c) => c.method === "DELETE"),
        true
    );
});
test("plugin references resolve without persisting resolved URLs", async () => {
    const f = fixture({
        handle: (path) =>
            path === "plugins/demo/resolve"
                ? {
                      streams: [
                          {
                              title: "One",
                              url: "https://media.invalid/one.mp4",
                          },
                          {
                              title: "Two",
                              url: "https://media.invalid/two.mp4",
                          },
                      ],
                  }
                : undefined,
    });
    const input = "ottplay-plugin:demo?input=movie&index=1";
    f.resolve(input);
    await flush();
    assert.deepEqual(f.outcomes, ["https://media.invalid/two.mp4"]);
    assert.deepEqual(f.transports, ["file"]);
    assert.equal(f.client.status().source, input);
    assert.equal(
        f.client.choices()[0].source.startsWith("ottplay-plugin:"),
        true
    );
});
test("plugin HLS, DASH and extensionless URLs keep stream transport even with file query values", async () => {
    for (const url of [
        "https://media.invalid/video.m3u8",
        "https://media.invalid/video.mpd",
        "https://media.invalid/play?name=movie.mp4",
    ]) {
        const f = fixture({
            handle: (path) =>
                path === "plugins/demo/resolve"
                    ? { streams: [{ title: "Media", url }] }
                    : undefined,
        });
        f.resolve("ottplay-plugin:demo?input=movie");
        await flush();
        assert.deepEqual(f.outcomes, [url]);
        assert.deepEqual(f.transports, ["stream"]);
    }
});
test("explicit torrent URL selection preserves the original fetch URL", async () => {
    const f = fixture();
    f.resolve(
        "ottplay-torrent:?source=" +
            encodeURIComponent(
                "https://media.invalid/movie.torrent?signature=x"
            ) +
            "&index=2"
    );
    await flush();
    assert.deepEqual(clone(f.calls.find((c) => c.path === "sessions").body), {
        fileIndex: 2,
        source: "https://media.invalid/movie.torrent?signature=x",
    });
});
test("missing endpoint fails without network requests and unsafe endpoints are rejected", async () => {
    const f = fixture();
    f.w.settings.companionEndpoint = "";
    f.resolve();
    await flush();
    assert.deepEqual(f.outcomes, [null]);
    assert.equal(f.calls.length, 0);
    for (const value of [
        "https://user:pass@media.invalid/companion/" + "a".repeat(32) + "/v1",
        "https://media.invalid/v1",
        base + "?token=x",
        base.replace("a".repeat(32), "a".repeat(31)),
    ])
        assert.throws(() => f.client.endpointValue(value));
});

test("missing Fetch keeps startup idle and rejects companion use before native discovery", async () => {
    for (const native of [false, true]) {
        const f = fixture({ native, noFetch: true });
        assert.equal(f.client.supportsTransport(), false);
        assert.equal(f.client.status(), null);
        assert.equal(f.timers.size, 0);
        assert.equal(f.nativeCalls(), 0);
        assert.equal(f.calls.length, 0);
        await assert.rejects(f.client.plugins(), {
            message: "companion_transport_unavailable",
        });
        f.resolve();
        await flush();
        assert.deepEqual(f.outcomes, [null]);
        assert.equal(
            f.client.status().error,
            "companion_transport_unavailable"
        );
        assert.equal(f.client.status().active, false);
        assert.equal(f.nativeCalls(), 0);
        assert.equal(f.calls.length, 0);
        assert.equal(f.timers.size, 0);
        f.listeners.pagehide();
    }
});

test("backend suspension releases the stream and resume reacquires from the original URI", async () => {
    const f = fixture({ native: true });
    const host = {},
        opened = [],
        disposed = [];
    vm.runInNewContext(compile("src/device/media-backend.ts"), {
        window: host,
    });
    const domain = { generation: 1, kind: "vod", position: 0 };
    const backend = host.__ottMediaBackend.create({
        clearInterval() {},
        context: () => domain,
        emit() {},
        open(request) {
            opened.push(clone(request));
            return {
                dispose: () => disposed.push(request.url),
                pause() {},
                resume() {},
                sample: () => ({
                    duration: 100,
                    paused: false,
                    position: 22,
                    ready: 2,
                }),
                seek() {},
            };
        },
        resolve: f.client.resolve,
        setInterval() {
            return 1;
        },
    });
    const handle = backend.open({ url: source });
    await flush();
    await f.tick(750);
    assert.equal(opened[0].sourceUrl, source);
    assert.equal(opened[0].url, base + "/sessions/s1/stream");
    handle.suspend();
    await flush();
    assert.equal(
        f.calls.some((c) => c.method === "DELETE" && c.path === "sessions/s1"),
        true
    );
    handle.resume();
    await flush();
    await f.tick(750);
    assert.equal(opened[1].sourceUrl, source);
    assert.equal(opened[1].position, 22);
    assert.equal(f.nativeCalls(), 2);
    backend.dispose();
    await flush();
    assert.equal(disposed.length, 2);
});

test("lazy loader cancellation prevents service startup and keeps the completed lease cancellable", async () => {
    let started = 0,
        released = 0;
    const w = {
        __ottMediaCompanionFactory: () => ({
            resolve: (_source, done) => {
                started++;
                done("ready", "file");
                return () => released++;
            },
        }),
        __TAURI__: {},
    };
    const module = { exports: {} };
    vm.runInNewContext(compile("src/plugins/media-companion-loader.ts"), {
        clearTimeout,
        Error,
        exports: module.exports,
        Promise,
        require: () => ({ tauriInvoke: async () => ({ endpoint: base }) }),
        setTimeout,
    });
    module.exports.installMediaCompanion(w);
    const results = [];
    const cancel = w.__ottMediaCompanion.resolve(source, (v) =>
        results.push(v)
    );
    cancel();
    await flush();
    assert.equal(started, 0);
    assert.deepEqual(results, []);
    const release = w.__ottMediaCompanion.resolve(source, (v, transport) => {
        assert.equal(transport, "file");
        results.push(v);
    });
    await flush();
    assert.deepEqual(results, ["ready"]);
    release();
    assert.equal(released, 1);
});

test("native capability discovery never starts the media service", async () => {
    const calls = [],
        w = { __TAURI__: {}, fetch() {}, settings: {} };
    const module = { exports: {} };
    vm.runInNewContext(compile("src/plugins/media-companion-loader.ts"), {
        exports: module.exports,
        Promise,
        require: () => ({
            tauriInvoke: async (command) => {
                calls.push(command);
                return {
                    available: true,
                    local: true,
                    plugins: true,
                    schema: 1,
                    torrent: true,
                };
            },
        }),
    });
    module.exports.installMediaCompanion(w);
    assert.equal(w.__ottMediaCompanion.providerAvailable(), false);
    assert.deepEqual(calls, []);
    const caps = await w.__ottMediaCompanion.capabilities();
    assert.equal(caps.torrent, true);
    assert.equal(w.__ottMediaCompanion.providerAvailable(), true);
    assert.deepEqual(calls, ["companion_capabilities"]);
    await w.__ottMediaCompanion.capabilities();
    assert.equal(calls.length, 1);
    assert.equal(w.__ottMediaCompanion.open, undefined);
});

test("external playback endpoints never expose the native Torrent provider on web clients", () => {
    const module = { exports: {} };
    vm.runInNewContext(compile("src/plugins/media-companion-loader.ts"), {
        exports: module.exports,
        Promise,
        require: () => ({}),
    });
    for (const host of [{}, { Capacitor: {} }, { AndroidInterface: {} }]) {
        const w = { ...host, fetch() {}, settings: {} };
        module.exports.installMediaCompanion(w);
        assert.equal(w.__ottMediaCompanion.available(), false);
        w.settings.companionEndpoint = base;
        assert.equal(w.__ottMediaCompanion.available(), true);
        assert.equal(w.__ottMediaCompanion.providerAvailable(), false);
        delete w.fetch;
        assert.equal(w.__ottMediaCompanion.available(), false);
    }
});

test("catalog metadata releases its lease without selecting or streaming a file", async () => {
    const f = fixture(),
        results = [];
    f.client.metadata(source, (files) => results.push(clone(files)));
    await flush();
    await f.tick(750);
    await flush();
    assert.deepEqual(results, [
        [{ index: 2, length: 1000, name: "movie.mp4" }],
    ]);
    assert.equal(f.calls.filter((call) => call.method === "DELETE").length, 1);
    assert.equal(
        f.calls.some((call) => call.path.endsWith("/select")),
        false
    );
    assert.equal(f.timers.size, 0);
});

test("catalog metadata ignores source file-selection hints", async () => {
    for (const input of [
        source + "&so=2",
        "ottplay-torrent:?source=" + encodeURIComponent(source) + "&index=2",
    ]) {
        const f = fixture(),
            results = [];
        f.client.metadata(input, (files) => results.push(clone(files)));
        await flush();
        await f.tick(750);
        await flush();
        const create = f.calls.find((call) => call.path === "sessions");
        assert.equal(Object.hasOwn(create.body, "fileIndex"), false);
        assert.equal(new URL(create.body.source).searchParams.has("so"), false);
        assert.equal(results[0][0].index, 2);
        assert.equal(
            f.calls.some((call) => call.path.endsWith("/select")),
            false
        );
        assert.equal(
            f.calls.filter((call) => call.method === "DELETE").length,
            1
        );
        assert.equal(f.timers.size, 0);
    }
});

test("accepted file selection is polled instead of resubmitted while the worker catches up", async () => {
    let selects = 0,
        polls = 0;
    const f = fixture({
        handle: (path, method) => {
            if (path.endsWith("/select")) {
                selects++;
                return {
                    files: [{ index: 2, name: "movie.mp4" }],
                    id: "s1",
                    state: "select",
                };
            }
            if (path === "sessions/s1" && method === "GET" && selects)
                return {
                    files: [{ index: 2, name: "movie.mp4" }],
                    id: "s1",
                    state: ++polls < 3 ? "select" : "ready",
                    streamPath: "sessions/s1/stream",
                };
        },
    });
    f.resolve();
    await flush();
    await f.tick(750);
    assert.equal(selects, 1);
    await f.tick(750);
    assert.equal(selects, 1);
    assert.deepEqual(f.outcomes, []);
    await f.tick(750);
    assert.equal(selects, 1);
    assert.deepEqual(f.outcomes, []);
    await f.tick(750);
    assert.equal(selects, 1);
    assert.deepEqual(f.outcomes, [base + "/sessions/s1/stream"]);
});

test("explicit file index in session creation never triggers first-file fallback", async () => {
    const f = fixture({
        handle: (path, method) => {
            if (path === "sessions" && method === "POST")
                return {
                    files: [
                        { index: 0, name: "wrong.mp4" },
                        { index: 2, name: "right.mp4" },
                    ],
                    id: "s1",
                    state: "select",
                };
            if (path === "sessions/s1" && method === "GET")
                return {
                    files: [{ index: 2, name: "right.mp4" }],
                    id: "s1",
                    selected: 2,
                    state: "ready",
                    streamPath: "sessions/s1/stream",
                };
        },
    });
    f.resolve(source + "&so=2");
    await flush();
    await f.tick(750);
    assert.equal(
        f.calls.some((call) => call.path.endsWith("/select")),
        false
    );
    assert.deepEqual(f.outcomes, [base + "/sessions/s1/stream"]);
});
