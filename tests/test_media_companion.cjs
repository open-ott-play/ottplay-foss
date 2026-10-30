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
        outcomes = [];
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
            : undefined
    );
    return {
        calls,
        client,
        listeners,
        nativeCalls: () => nativeCalls,
        outcomes,
        resolve: (value = source, options) =>
            client.resolve(value, (v) => outcomes.push(v), options),
        tick: async (ms) => {
            const ready = [...timers].filter(([, t]) => t.ms === ms);
            ready.forEach(([key, t]) => {
                timers.delete(key);
                t.fn();
            });
            await flush();
        },
        timers,
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
    assert.equal(f.client.status().source, input);
    assert.equal(
        f.client.choices()[0].source.startsWith("ottplay-plugin:"),
        true
    );
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
                done("ready");
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
    const release = w.__ottMediaCompanion.resolve(source, (v) =>
        results.push(v)
    );
    await flush();
    assert.deepEqual(results, ["ready"]);
    release();
    assert.equal(released, 1);
});

test("companion UI edits the endpoint through the shared editor and opens stable media", () => {
    const f = fixture(),
        edits = [],
        played = [],
        saved = [],
        returns = [];
    let manualContext,
        playbackState = { generation: 0, phase: "stopped" };
    Object.assign(f.w, {
        __ottClassicPlayback: { snapshot: () => playbackState },
        __ottMedia: {
            beginSource(value) {
                manualContext = value;
                return { commit: () => true, rollback() {} };
            },
            usesSource: (value) => value === manualContext,
        },
        _playMedia: (value) => {
            played.push(value);
            playbackState = {
                generation: playbackState.generation + 1,
                phase: "playing",
                target: {
                    channelId: value.__ottMediaRef.itemId,
                    kind: "vod",
                    sourceId: value.__ottMediaRef.sourceId,
                },
            };
        },
        closeList() {
            this.isListVisible = false;
        },
        isListVisible: true,
        keys: { ENTER: 13, EXIT: 8, RETURN: 27 },
        listCaption: {},
        listDetail: {},
        listFooter: {},
        optionsList: (fn) => returns.push(fn),
        renderButtonHint: () => "",
        saveSettings: (value) => {
            saved.push(value);
            Object.assign(f.w.settings, value);
            return true;
        },
        settingsMediaCompanion() {},
        showPage() {},
    });
    vm.runInNewContext(compile("src/plugins/media-companion-ui.ts"), {
        window: f.w,
    });
    f.w.__ottMediaCompanionUi(
        f.w,
        f.client,
        (caption, value, accept, close, secret) =>
            edits.push({ accept, caption, close, secret, value })
    );
    f.w.listArray[0].action();
    assert.equal(edits[0].secret, true);
    edits[0].accept(base);
    assert.equal(saved[0].companionEndpoint, base);
    f.w.listArray[1].action();
    edits[1].accept(source);
    assert.equal(played[0].stream_url, source);
    assert.equal(played[0].itemId, "manual");
    assert.match(played[0].__ottMediaRef.sourceId, /^companion:manual:/);
    manualContext.write("history", "private memory only");
    assert.equal(manualContext.read("history"), "private memory only");
    assert.equal(manualContext.readPersisted("history"), null);
    assert.equal(played[0].stream_url.includes("/sessions/"), false);
});

test("companion UI keeps Back available and ignores plugin results after closing", async () => {
    const pending = deferred(),
        returns = [],
        w = {
            isListVisible: true,
            keys: { ENTER: 13, EXIT: 8, RETURN: 27 },
            listCaption: {},
            listDetail: {},
            listFooter: {},
            optionsList() {
                returns.push(true);
                w.getListItem = null;
            },
            renderButtonHint: () => "",
            settings: {},
            settingsMediaCompanion() {},
            showPage() {},
        };
    vm.runInNewContext(compile("src/plugins/media-companion-ui.ts"), {
        window: w,
    });
    w.__ottMediaCompanionUi(
        w,
        { choices: () => [], plugins: () => pending.promise },
        () => {}
    );
    w.listArray[2].action();
    assert.equal(w.listKeyHandler(27), true);
    pending.resolve({ plugins: [{ id: "demo", name: "Demo" }], schema: 1 });
    await flush();
    assert.equal(returns.length, 1);
    assert.equal(w.getListItem, null);
});

test("missing Fetch is explained in the shared UI without changing playback or blocking Back", async () => {
    const f = fixture({ native: true, noFetch: true });
    let accept,
        handoffs = 0,
        played = 0,
        closed = 0;
    Object.assign(f.w, {
        __ottClassicPlayback: { snapshot: () => ({ generation: 1 }) },
        __ottMedia: { beginSource: () => handoffs++ },
        _playMedia: () => played++,
        isListVisible: true,
        keys: { ENTER: 13, EXIT: 8, RETURN: 27 },
        listCaption: {},
        listDetail: {},
        listFooter: {},
        optionsList: () => closed++,
        renderButtonHint: () => "",
        settingsMediaCompanion() {},
        showPage: () => f.w.detailListAction(),
    });
    vm.runInNewContext(compile("src/plugins/media-companion-ui.ts"), {
        window: f.w,
    });
    f.w.__ottMediaCompanionUi(f.w, f.client, (_caption, _value, done) => {
        accept = done;
    });
    assert.match(f.w.listDetail.textContent, /lacks the Fetch API/);
    assert.match(f.w.listDetail.textContent, /newer browser or WebView/);
    f.w.listArray[1].action();
    accept(source);
    assert.equal(handoffs, 0);
    assert.equal(played, 0);
    f.w.listArray[2].action();
    await flush();
    assert.match(f.w.listDetail.textContent, /lacks the Fetch API/);
    assert.equal(f.nativeCalls(), 0);
    assert.equal(f.calls.length, 0);
    assert.equal(f.w.listKeyHandler(27), true);
    assert.equal(closed, 1);
});

for (const provider of ["plex", "m3u"]) {
    for (const accepted of [true, false]) {
        test(`manual companion source isolates ${provider} journal and ${accepted ? "plays" : "rolls back rejected dispatch"}`, () => {
            const { fixture: playbackFixture } = require("./test_port_vod.cjs");
            const w = playbackFixture();
            w.p_pref = provider;
            w.__ottActiveProviderDriver = { id: provider };
            const resolverCalls = [];
            w.providerMediaClient = {
                cancel() {},
                persist(value) {
                    resolverCalls.push("persist");
                    return { ...value, stream_url: undefined };
                },
                resolve() {
                    resolverCalls.push("resolve");
                    throw new Error(
                        "Provider must not resolve companion source"
                    );
                },
                stop() {},
            };
            w.__ottMedia.capture();
            const previousSource = w.__ottMedia.sourceId();
            const saved = JSON.stringify(w.stored);
            const providerWrites = [];
            const originalWrite = w.providerSetItem;
            w.providerSetItem = (key, value) => {
                providerWrites.push(key);
                return originalWrite(key, value);
            };
            // Establish the runtime with the current storage-function identity.
            w.__ottMedia.capture();
            providerWrites.length = 0;
            Object.assign(w, {
                closeList() {
                    w.isListVisible = false;
                },
                isListVisible: true,
                listCaption: {},
                listDetail: {},
                listFooter: {},
            });
            let accept;
            vm.runInContext(compile("src/plugins/media-companion-ui.ts"), w);
            if (!accepted) {
                const command = w.__ottClassicPlayback.command;
                w.__ottClassicPlayback.command = (value) =>
                    value.type === "vod" ? false : command(value);
            }
            const priorHistory = JSON.stringify(w.medHistory);
            w.__ottMediaCompanionUi(
                w,
                { choices: () => [], isSource: () => true },
                (_caption, _value, done) => {
                    accept = done;
                }
            );
            w.listArray[1].action();
            accept(source);
            assert.deepEqual(resolverCalls, []);
            assert.deepEqual(providerWrites, []);
            assert.equal(JSON.stringify(w.stored), saved);
            if (accepted) {
                assert.match(w.__ottMedia.sourceId(), /^companion:manual:/);
                assert.equal(
                    w.__ottClassicPlayback.snapshot().target.sourceId,
                    w.__ottMedia.sourceId()
                );
                assert.equal(w.__ottMedia.current().payload.stream_url, source);
                assert(
                    w.calls.some(
                        (call) => call[0] === "play" && call[1] === source
                    )
                );
                assert.equal(w.isListVisible, false);
                w.__ottMedia.useSource(null);
            } else {
                assert.equal(w.__ottMedia.sourceId(), previousSource);
                assert.equal(
                    JSON.stringify(w.medHistory),
                    priorHistory,
                    "rejected preparation restores the prior projection"
                );
                assert.equal(w.isListVisible, true);
                assert(!w.calls.some((call) => call[0] === "play"));
            }
            assert.equal(w.__ottMedia.sourceId(), previousSource);
        });
    }
}
