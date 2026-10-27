"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const test = require("node:test");
const acorn = require("acorn");
const clone = (value) => JSON.parse(JSON.stringify(value));
const contract = JSON.parse(
    fs.readFileSync("contracts/local-media-v1.json", "utf8")
);
function load(file, requires = {}, extra = {}) {
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText;
    acorn.parse(code, { ecmaVersion: 5 });
    vm.runInNewContext(code, {
        clearTimeout,
        Date,
        exports,
        require(name) {
            assert.ok(name in requires, name);
            return requires[name];
        },
        setTimeout,
        URL,
        ...extra,
    });
    return exports;
}
const selection = load("src/offline/playback-selection.ts");
const progress = load("src/offline/local-media-progress.ts");
const execute = load("src/commands/remote-local-media.ts", {
    "../offline/playback-selection": selection,
    "./remote-restart": { remotePlayerInfo: (w) => ({ runtime: w.runtime }) },
}).executeRemoteLocalMedia;
const source = {
    available: true,
    id: "source-123",
    kind: "folder",
    name: "Movies",
};
const other = { available: true, id: "other", kind: "folder", name: "Other" };
function catalog() {
    return {
        items: [1, 2, 3]
            .map((id) => ({
                id: String(id),
                name: id + ".mp4",
                sourceId: source.id,
                url: "/v/" + id,
            }))
            .concat({
                id: "unrelated",
                name: "Other.mp4",
                sourceId: "other",
                url: "/v/other",
            }),
        scanning: false,
        sources: [source, other],
    };
}
function fixture() {
    const calls = [],
        value = catalog();
    const w = {
        __ottActiveProviderDriver: { id: "m3u" },
        __ottCommandChannelLoad: {},
        __ottLocalMedia: {
            remoteActivate: (...args) =>
                calls.push(["activate", ...args.slice(0, 2)]),
            remoteCapabilities: () => clone(contract.capability),
            remoteCatalog: async () => value,
            remoteConnect: async (path) => {
                calls.push(["connect", path]);
                return { source };
            },
            remoteSources: async () => ({ sources: value.sources }),
        },
        runtime: "page-123",
    };
    return {
        calls,
        request(params, expiresAt) {
            return new Promise((resolve) =>
                execute(
                    w,
                    params,
                    (result) => resolve(clone(result)),
                    expiresAt
                )
            );
        },
        value,
        w,
    };
}
const request = (op, extra = {}) => ({
    op,
    runtime: "page-123",
    ...(op === "sources" ? {} : { source: "Movies" }),
    ...extra,
});
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("shared contract: named play and shuffle return exact correlated shape, source-only unique order", async () => {
    for (const op of ["play", "shuffle"]) {
        const f = fixture();
        const result = await f.request(request(op));
        assert.equal(result.status, "ok");
        assert.deepEqual(result.data, contract[op + "_result"]);
        assert.equal(f.calls[0][0], "activate");
        assert.equal(f.calls[0][1], source.id);
        assert.deepEqual([...f.calls[0][2]].sort(), ["1", "2", "3"]);
        assert.equal(new Set(f.calls[0][2]).size, 3);
        assert.deepEqual(
            f.value.items.map((x) => x.id),
            ["1", "2", "3", "unrelated"]
        );
    }
});

test("sources and connect preserve provider/playback; native source paths are explicit only", async () => {
    const f = fixture();
    f.value.sources = [{ ...source, path: "/Volumes/data/Movies" }];
    const provider = f.w.__ottActiveProviderDriver;
    assert.deepEqual(
        (await f.request(request("sources"))).data,
        contract.sources_result
    );
    assert.deepEqual(
        (await f.request(request("sources", { include_paths: true }))).data,
        contract.paths_result
    );
    const connected = await f.request(request("connect"));
    assert.equal(connected.status, "ok");
    assert.equal(connected.data.count, 0);
    assert.deepEqual(connected.data.source, source);
    assert.deepEqual(f.calls, []);
    assert.equal(f.w.__ottActiveProviderDriver, provider);
});

test("browser cannot gain paths or link absolute folders; exact source IDs and names only", async () => {
    const f = fixture();
    f.w.__ottLocalMedia.remoteCapabilities = () => ({
        ...contract.capability,
        absolute_paths: false,
    });
    for (const params of [
        request("sources", { include_paths: true }),
        request("shuffle", { source: "/Volumes/data/Movies" }),
    ])
        assert.equal((await f.request(params)).data.error, "unsupported");
    for (const name of ["Movie", "movies", "missing"])
        assert.equal(
            (await f.request(request("shuffle", { source: name }))).data.error,
            "source_not_found"
        );
    assert.equal(
        (await f.request(request("play", { source: "../Movies" }))).data.error,
        "invalid_request"
    );
    assert.equal(
        (await f.request(request("play", { source: source.id }))).status,
        "ok"
    );
});

test("ambiguous, unavailable, empty, partial and oversized folders never fall back to all sources", async () => {
    for (const [change, expected] of [
        [
            (f) => f.value.sources.push({ ...source, id: "duplicate" }),
            "source_ambiguous",
        ],
        [
            (f) => (f.value.sources = [{ ...source, available: false }]),
            "source_unavailable",
        ],
        [
            (f) =>
                (f.value.items = f.value.items.filter(
                    (x) => x.sourceId === "other"
                )),
            "empty_source",
        ],
        [(f) => (f.value.scanning = true), "catalog_loading"],
        [
            (f) =>
                (f.value.items = Array.from({ length: 50001 }, (_, n) => ({
                    id: String(n),
                    sourceId: source.id,
                    url: "/v",
                }))),
            "too_many_items",
        ],
        [(f) => f.value.items.push(f.value.items[0]), "catalog_unavailable"],
    ]) {
        const f = fixture();
        change(f);
        assert.equal(
            (await f.request(request("shuffle"))).data.error,
            expected
        );
        assert.deepEqual(f.calls, []);
    }
});

test("profile restrictions are retained when selecting a folder", async () => {
    const f = fixture();
    f.w.__ottOfflineProfiles = {
        filter: (value) => ({
            ...value,
            items: value.items.filter((x) => x.sourceId !== source.id),
        }),
    };
    assert.equal(
        (await f.request(request("shuffle"))).data.error,
        "empty_source"
    );
    assert.deepEqual(f.calls, []);
});

test("runtime, provider and load supersession during catalog collection cannot start playback", async () => {
    for (const change of [
        (w) => (w.runtime = "page-new"),
        (w) => (w.__ottActiveProviderDriver = { id: "m3u" }),
        (w) => (w.__ottCommandChannelLoad = {}),
        (w) => (w.__ottStandby = { blocked: () => true }),
    ]) {
        const f = fixture();
        let resolve;
        f.w.__ottLocalMedia.remoteCatalog = () =>
            new Promise((done) => (resolve = done));
        const pending = f.request(request("shuffle"));
        await tick();
        change(f.w);
        resolve(f.value);
        const result = await pending;
        assert.equal(result.data.error, "runtime_changed");
        assert.equal(result.data.runtime, "page-123");
        assert.deepEqual(f.calls, []);
    }
});

test("expired requests reply once and cannot start playback after a late scan", async () => {
    const f = fixture();
    let resolve,
        replies = 0;
    f.w.__ottLocalMedia.remoteCatalog = () =>
        new Promise((done) => (resolve = done));
    const result = await new Promise((done) =>
        execute(
            f.w,
            request("shuffle"),
            (value) => {
                replies++;
                done(clone(value));
            },
            (Date.now() + 30) / 1000
        )
    );
    assert.equal(result.data.error, "catalog_loading");
    assert.equal(f.w.__ottLocalMediaRequestActive, false);
    resolve(f.value);
    await tick();
    assert.equal(replies, 1);
    assert.deepEqual(f.calls, []);
});

test("singleflight rejects overlap without releasing the active operation", async () => {
    const f = fixture();
    let resolve;
    f.w.__ottLocalMedia.remoteCatalog = () =>
        new Promise((done) => (resolve = done));
    const pending = f.request(request("play"));
    await tick();
    assert.equal(
        (await f.request(request("shuffle"))).data.error,
        "operation_in_progress"
    );
    assert.equal(f.w.__ottLocalMediaRequestActive, true);
    resolve(f.value);
    assert.equal((await pending).status, "ok");
    assert.equal(f.w.__ottLocalMediaRequestActive, false);
});

function pluginFixture(options = {}) {
    let linked = !!options.connected;
    const data = new Map(),
        calls = [],
        snapshots = [],
        w = {
            __ottActiveProviderDriver: { id: "m3u" },
            __ottCommandChannelLoad: {},
            __TAURI__: {},
            closeList() {},
            fetch: async () => ({
                json: async () =>
                    snapshots.length > 1 ? snapshots.shift() : snapshots[0],
                ok: true,
            }),
            loadProv(id) {
                calls.push(["provider", id]);
                this.__ottActiveProviderDriver = { id };
                this.__ottCommandChannelLoad = {};
            },
            optionsList() {},
            runtime: "page-123",
            stbGetItem: (key) => data.get(key) || "",
            stbSetItem: (key, value) => data.set(key, value),
        };
    const install = load("src/plugins/local-media.ts", {
        "../offline/browser-local-media": {
            installBrowserLocalMedia: () => ({ suspend() {} }),
            installOfflineShell() {},
        },
        "../offline/local-media-progress": progress,
        "../offline/playback-selection": selection,
        "../offline/profiles": { installOfflineProfiles() {} },
        "./native-bridge": {
            resolveNativePlugin: () => ({}),
            tauriInvoke: async (name, args) => {
                calls.push([name, args]);
                if (name === "local_media_capabilities")
                    return {
                        absolutePaths: true,
                        sourcePaths: true,
                        version: 1,
                    };
                if (name === "local_media_sources")
                    return {
                        endpoint: "http://localhost/catalog",
                        sources: args.path
                            ? linked
                                ? [source]
                                : []
                            : [source, other],
                    };
                if (name === "local_media_link_folder") {
                    linked = true;
                    return { endpoint: "http://localhost/catalog", source };
                }
                if (name === "offline_media_endpoint")
                    return { endpoint: "http://localhost/catalog" };
                throw Error(name);
            },
        },
    }).installLocalMedia;
    const api = install(w);
    return { api, calls, data, snapshots, w };
}

test("new native absolute folder waits for the complete scan and activates only its own source", async () => {
    const f = pluginFixture();
    await tick();
    f.snapshots.push(
        { ...catalog(), items: [catalog().items[0]], scanning: true },
        catalog()
    );
    const result = await new Promise((resolve) =>
        execute(
            f.w,
            request("shuffle", { source: "/Volumes/data/Movies/" }),
            resolve
        )
    );
    assert.equal(result.status, "ok");
    assert.equal(result.data.count, 3);
    assert.ok(f.calls.some((x) => x[0] === "local_media_link_folder"));
    assert.equal(f.calls.filter((x) => x[0] === "provider").length, 1);
    const initial = f.api.takeImportSelection();
    const delivered = await f.api.list();
    const filtered = f.api.playbackFilter(delivered);
    assert.deepEqual(clone(filtered.items.map((x) => x.id)).sort(), [
        "1",
        "2",
        "3",
    ]);
    const order = clone(f.api.playbackOrder());
    assert.deepEqual(order.slice().sort(), ["local-1", "local-2", "local-3"]);
    assert.deepEqual(clone(filtered.items.map((x) => "local-" + x.id)), order);
    assert.equal(initial, order[0]);
    f.api.playbackOrdered();
    assert.equal(f.api.playbackOrder(), null);
});

test("pending local activation is scoped to its provider generation", async () => {
    const f = pluginFixture();
    await tick();
    f.snapshots.push(catalog());
    f.api.remoteActivate(source.id, ["3", "2", "1"], catalog(), () => true);
    f.w.__ottCommandChannelLoad = {};
    assert.equal(f.api.takeImportSelection(), "");
    assert.equal(f.api.playbackOrder(), null);
    await f.api.list();
    assert.equal(f.api.playbackOrder(), null);
});

test("source filter survives reload, retains connected sources and fails closed if the folder vanishes", () => {
    const data = new Map();
    let identity = "tauri";
    const w = {
        stbGetItem: (k) => data.get(k),
        stbSetItem: (k, v) => data.set(k, v),
    };
    const a = selection.createLocalPlaybackSelection(w, () => identity);
    a.select(source.id, ["3", "1", "2"]);
    const fresh = selection.createLocalPlaybackSelection(w, () => identity);
    assert.equal(fresh.order(), null);
    assert.deepEqual(clone(fresh.filter(catalog()).sources), [source]);
    assert.equal(catalog().sources.length, 2);
    assert.throws(
        () => fresh.filter({ items: catalog().items, sources: [other] }),
        /unavailable/
    );
    identity = "browser:";
    assert.equal(fresh.filter(catalog()).items.length, 4);
    identity = "tauri";
    fresh.clear();
    assert.equal(fresh.filter(catalog()).items.length, 4);
});

test("local playback order replaces all provider groups atomically and survives reload without changing custom groups", () => {
    const host = { window: {} };
    vm.createContext(host);
    require("./helpers/private-runtime.cjs")(host, "src/channels/library.ts");
    const saved = new Map();
    let fail = false;
    const rows = [1, 2, 3].map((id) => ({
        groupId: "local",
        groupLabel: "Local videos",
        id: "local-" + id,
        itemId: "local:" + id,
        label: String(id),
    }));
    const ports = {
        current: () => true,
        get: (key) => saved.get(key),
        set: (key, value) => {
            if (fail) throw Error("full");
            saved.set(key, value);
        },
        sourceId: "local-test",
    };
    const create = () => host.window.__ottChannelLibrary.create(ports, rows);
    let api = create();
    const custom = api.createGroup("Custom", "local");
    const before = clone(api.snapshot().groups.find((x) => x.id === custom));
    api.renameGroup("local", "Family movies");
    api.changeMember("local", "local-2", "remove");
    rows.unshift(rows.pop());
    api = create();
    assert.equal(
        api.adoptPlaybackOrder(["local-3", "local-1", "local-2"]),
        true
    );
    const state = clone(create().snapshot());
    assert.deepEqual(state.all, ["local-3", "local-1", "local-2"]);
    assert.deepEqual(state.groups.find((x) => x.id === "local").members, [
        "local-3",
        "local-1",
        "local-2",
    ]);
    assert.equal(
        state.groups.find((x) => x.id === "local").label,
        "Family movies"
    );
    assert.deepEqual(
        state.groups.find((x) => x.id === custom),
        before
    );
    assert.deepEqual(state.selected, {
        groupId: "system:all",
        itemId: "local:3",
    });
    for (const invalid of [
        ["local-1"],
        ["local-1", "local-1", "local-2"],
        ["local-1", "local-2", "foreign"],
    ]) {
        assert.equal(api.adoptPlaybackOrder(invalid), false);
        assert.deepEqual(clone(api.snapshot()), state);
    }
    api.select("system:all", "local-1");
    const beforeFailure = clone(api.snapshot());
    fail = true;
    assert.equal(
        api.adoptPlaybackOrder(["local-3", "local-1", "local-2"]),
        false
    );
    assert.deepEqual(clone(api.snapshot()), beforeFailure);
});

test("native canonical lookup is metadata-only, with paths returned only on explicit opt-in", async () => {
    const f = fixture();
    let calls = [];
    f.w.__ottLocalMedia.remoteSources = async (includePaths, path) => {
        calls.push([includePaths, path]);
        return { sources: [{ ...source, path: "/private/var/media/Movies" }] };
    };
    const result = await f.request(contract.lookup_request.params);
    assert.deepEqual(result.data, contract.lookup_result);
    const hidden = await f.request({
        ...contract.lookup_request.params,
        include_paths: false,
    });
    assert.equal(Object.hasOwn(hidden.data.sources[0], "path"), false);
    assert.deepEqual(calls, [
        [true, "/var/media/Movies"],
        [false, "/var/media/Movies"],
    ]);
    assert.deepEqual(f.calls, []);
    assert.equal(
        (await f.request(request("sources", { path: "Movies" }))).data.error,
        "invalid_request"
    );
    f.w.__ottLocalMedia.remoteCapabilities = () => ({
        ...contract.capability,
        absolute_paths: false,
    });
    assert.equal(
        (await f.request(contract.lookup_request.params)).data.error,
        "unsupported"
    );
});

test("native API passes canonical lookup to sources without starting a catalog scan", async () => {
    const f = pluginFixture();
    await tick();
    await f.api.remoteSources(true, "/var/media/Movies");
    assert.deepEqual(clone(f.calls.at(-1)), [
        "local_media_sources",
        { includePaths: true, path: "/var/media/Movies" },
    ]);
    assert.equal(
        f.calls.some(
            (x) => x[0] === "offline_media_endpoint" || x[0] === "provider"
        ),
        false
    );
});

test("local selection is scoped to the active saved profile binding", async () => {
    const f = pluginFixture();
    await tick();
    let slot = 0,
        binding = "a";
    f.w.__ottOfflineProfiles = {
        current: () => ({ binding_id: binding }),
        namespace: () => "offline:" + slot,
    };
    f.api.remoteActivate(source.id, ["1", "2", "3"], catalog(), () => true);
    assert.equal(f.api.playbackFilter(catalog()).items.length, 3);
    slot = 1;
    assert.equal(f.api.playbackFilter(catalog()).items.length, 4);
    slot = 0;
    binding = "replacement";
    assert.equal(f.api.playbackFilter(catalog()).items.length, 4);
});

test("asynchronous driver mount binds the intended local order across the catalogue generation change", async () => {
    const f = pluginFixture();
    await tick();
    let active = true;
    f.api.remoteActivate(source.id, ["3", "1", "2"], catalog(), () => true);
    // Production mounts the driver under loadProv's generation, then
    // loadChannels starts its own generation before calling driver.load.
    f.api.bindPlaybackOwner(() => active);
    f.w.__ottCommandChannelLoad = {};
    assert.equal(f.api.takeImportSelection(), "local-3");
    await f.api.list();
    assert.deepEqual(clone(f.api.playbackOrder()), [
        "local-3",
        "local-1",
        "local-2",
    ]);
    f.w.__ottCommandChannelLoad = {};
    assert.equal(f.api.playbackOrder(), null);
    active = false;
});

test("replaced driver ownership never lends a pending local handoff to a newer driver", async () => {
    const f = pluginFixture();
    await tick();
    let active = true;
    f.api.remoteActivate(source.id, ["3", "1", "2"], catalog(), () => true);
    f.api.bindPlaybackOwner(() => active);
    active = false;
    f.w.__ottCommandChannelLoad = {};
    f.api.bindPlaybackOwner(() => true);
    assert.equal(f.api.takeImportSelection(), "");
    assert.equal(f.api.playbackOrder(), null);
});

test("expired native scans stop polling before their next request and never activate", async () => {
    const f = pluginFixture();
    await tick();
    f.snapshots.push(
        { ...catalog(), items: [catalog().items[0]], scanning: true },
        catalog()
    );
    const result = await new Promise((resolve) =>
        execute(
            f.w,
            request("shuffle", { source: "/Volumes/data/Movies" }),
            resolve,
            (Date.now() + 30) / 1000
        )
    );
    assert.equal(result.data.error, "catalog_loading");
    await new Promise((resolve) => setTimeout(resolve, 280));
    assert.equal(
        f.snapshots.length,
        1,
        "completed snapshot must not be requested after expiration"
    );
    assert.equal(
        f.calls.some((x) => x[0] === "provider"),
        false
    );
});

test("13,611-file shuffle is complete, reproducible after reload and stores only a compact seed", async () => {
    const f = pluginFixture();
    await tick();
    const value = catalog();
    value.items = Array.from({ length: 13611 }, (_, index) => ({
        id: index.toString(16).padStart(32, "0"),
        name: "Movie " + index + ".mp4",
        sourceId: source.id,
        url: "/v/" + index,
    })).concat(value.items.filter((item) => item.sourceId === "other"));
    f.snapshots.push(value);
    const reply = await new Promise((resolve) =>
        execute(f.w, request("shuffle"), resolve)
    );
    assert.equal(reply.status, "ok");
    assert.equal(reply.data.count, 13611);
    const first = f.api.playbackFilter(await f.api.list());
    const order = first.items.map((item) => item.id);
    assert.equal(new Set(order).size, 13611);
    assert.equal(
        first.items.every((item) => item.sourceId === source.id),
        true
    );
    const persisted = JSON.parse(f.data.get("localMediaPlaybackSelection"));
    assert.ok(persisted.seed > 0);
    assert.ok(f.data.get("localMediaPlaybackSelection").length < 256);
    const reloaded = selection.createLocalPlaybackSelection(
        f.w,
        () => persisted.library
    );
    const again = reloaded.filter({
        ...value,
        items: value.items.slice().reverse(),
    });
    assert.deepEqual(clone(again.items.map((item) => item.id)), clone(order));
    assert.deepEqual(
        clone(reloaded.filter({ ...value, scanning: true }).items),
        []
    );
    const host = { window: {} };
    vm.createContext(host);
    require("./helpers/private-runtime.cjs")(host, "src/channels/library.ts");
    const documents = new Map();
    const rows = first.items.map((item) => ({
        groupId: "local",
        groupLabel: "Local videos",
        id: "local-" + item.id,
        itemId: "channel:local-" + item.id,
        label: item.name,
    }));
    const library = host.window.__ottChannelLibrary.create(
        {
            current: () => true,
            get: (key) => documents.get(key),
            set: (key, text) => documents.set(key, text),
            sourceId: "large-local",
        },
        rows
    );
    assert.equal(library.adoptPlaybackOrder(f.api.playbackOrder()), true);
    assert.deepEqual(
        clone(library.snapshot().all),
        rows.map((row) => row.id)
    );
    assert.ok(
        [...documents.values()].reduce((n, text) => n + text.length, 0) < 1024,
        "provider order must not duplicate 13,611 IDs in persistent storage"
    );
});

test("invalid wire source identities are rejected before any playback mutation", async () => {
    for (const bad of [
        { ...source, id: "invalid/id" },
        { ...source, name: "x".repeat(513) },
        { ...source, name: "https:secret" },
        { ...source, name: "folder/subfolder" },
    ]) {
        const f = fixture();
        f.value.sources = [bad];
        assert.equal(
            (await f.request(request("play"))).data.error,
            "catalog_unavailable"
        );
        assert.deepEqual(f.calls, []);
    }
});

test("an accepted local command cannot replay its pending start after actual standby and wake", async () => {
    const f = pluginFixture();
    await tick();
    Object.assign(f.w, { clearInterval, clearTimeout, setTimeout });
    f.snapshots.push(catalog());
    const gate = load("src/core/standby.ts").installStandby(
        f.w,
        f.w.stbGetItem,
        f.w.stbSetItem
    );
    const reply = await new Promise((resolve) =>
        execute(f.w, request("shuffle"), resolve)
    );
    assert.equal(reply.status, "ok");
    assert.ok(f.api.playbackOrder());
    gate.set(true);
    assert.equal(f.api.playbackOrder(), null);
    assert.equal(f.api.takeImportSelection(), "");
    gate.set(false, () => f.w.loadProv("offline"));
    await tick();
    f.api.bindPlaybackOwner(() => true);
    assert.equal(f.api.playbackOrder(), null);
    assert.equal(f.api.takeImportSelection(), "");
});

test("a profile replacement after acceptance retires the old source/order before async driver mount", async () => {
    const f = pluginFixture();
    await tick();
    f.snapshots.push(catalog());
    let profile = { binding_id: "before" };
    f.w.__ottOfflineProfiles = {
        current: () => profile,
        filter: (value) => value,
        namespace: () => "offline:0",
    };
    const reply = await new Promise((resolve) =>
        execute(f.w, request("shuffle"), resolve)
    );
    assert.equal(reply.status, "ok");
    profile = { binding_id: "after" };
    f.api.bindPlaybackOwner(() => true);
    assert.equal(f.api.takeImportSelection(), "");
    assert.equal(f.api.playbackOrder(), null);
    profile = { binding_id: "before" };
    assert.equal(
        f.api.playbackOrder(),
        null,
        "retired intent cannot revive when the profile returns"
    );
});

test("seeded playback and its pending order use the same playable subset", async () => {
    const f = pluginFixture();
    await tick();
    const value = catalog();
    value.items.push(
        {
            available: false,
            id: "blocked",
            sourceId: source.id,
            url: "/blocked",
        },
        { id: "missing-url", sourceId: source.id }
    );
    f.snapshots.push(value);
    const reply = await new Promise((resolve) =>
        execute(f.w, request("shuffle"), resolve)
    );
    assert.equal(reply.status, "ok");
    assert.equal(reply.data.count, 3);
    assert.deepEqual(
        clone(
            f.api
                .playbackFilter(await f.api.list())
                .items.map((item) => "local-" + item.id)
        ),
        clone(f.api.playbackOrder())
    );
    const broken = fixture();
    broken.value.scanError = "scan traversal limit reached";
    assert.equal(
        (await broken.request(request("shuffle"))).data.error,
        "catalog_unavailable"
    );
    assert.deepEqual(broken.calls, []);
});

test("transport cancellation retires pending scan work and suppresses late replies and playback", async () => {
    const f = fixture();
    let resolve,
        cancelled = 0,
        replies = 0;
    f.w.__ottLocalMedia.remoteCatalog = () =>
        Object.assign(new Promise((done) => (resolve = done)), {
            cancel() {
                cancelled++;
            },
        });
    const cancel = execute(f.w, request("shuffle"), () => replies++);
    await tick();
    assert.equal(typeof cancel, "function");
    cancel();
    cancel();
    assert.equal(cancelled, 1);
    assert.equal(f.w.__ottLocalMediaRequestActive, false);
    resolve(f.value);
    await tick();
    assert.equal(replies, 0);
    assert.deepEqual(f.calls, []);
});

test("real request dispatcher preserves local cancellation and structured kiosk policy", async () => {
    const f = fixture();
    const modules = {};
    for (const match of fs
        .readFileSync("src/commands/remote-requests.ts", "utf8")
        .matchAll(/from "([^"]+)"/g))
        modules[match[1]] = {};
    modules["./remote-local-media"] = { executeRemoteLocalMedia: execute };
    const dispatch = load("src/commands/remote-requests.ts", modules, {
        window: f.w,
    }).executeRemoteRequest;
    let resolve,
        replies = 0;
    f.w.__ottLocalMedia.remoteCatalog = () =>
        new Promise((done) => (resolve = done));
    const cancel = dispatch(
        { action: "local_media", params: request("shuffle") },
        () => replies++
    );
    await tick();
    cancel();
    resolve(f.value);
    await tick();
    assert.equal(replies, 0);
    f.w.__ottKiosk = { enabled: () => true };
    let result;
    dispatch(
        { action: "local_media", params: request("shuffle") },
        (value) => (result = clone(value))
    );
    assert.deepEqual(result, {
        data: {
            error: "restricted",
            op: "shuffle",
            runtime: "page-123",
            state: "error",
            version: 1,
        },
        status: "rejected",
    });
    result = await new Promise((done) =>
        dispatch({ action: "local_media", params: request("sources") }, done)
    );
    assert.equal(result.status, "ok");
});

test("existing absolute folders are reused without relinking or starting a replacement scan", async () => {
    for (const op of ["play", "shuffle", "connect"]) {
        const f = pluginFixture({ connected: true });
        await tick();
        f.snapshots.push(catalog());
        const reply = await new Promise((resolve) =>
            execute(
                f.w,
                request(op, { source: "/Volumes/data/Movies/" }),
                resolve
            )
        );
        assert.equal(reply.status, "ok");
        assert.equal(reply.data.source.id, source.id);
        assert.equal(
            f.calls.some((call) => call[0] === "local_media_link_folder"),
            false
        );
        const lookup = f.calls.find(
            (call) => call[0] === "local_media_sources"
        );
        assert.deepEqual(clone(lookup[1]), {
            includePaths: false,
            path: "/Volumes/data/Movies/",
        });
        assert.equal(
            f.calls.some(
                (call) =>
                    call[0] === "offline_media_endpoint" && call[1].refresh
            ),
            false
        );
        if (op === "connect")
            assert.equal(
                f.calls.some((call) => call[0] === "offline_media_endpoint"),
                false
            );
    }
});

test("unavailable or ambiguous canonical folders never fall back to reconnecting another source", async () => {
    for (const [sources, code] of [
        [[{ ...source, available: false }], "source_unavailable"],
        [[{ ...source, kind: "file" }], "source_unavailable"],
        [[source, other], "source_ambiguous"],
    ]) {
        const f = fixture();
        f.w.__ottLocalMedia.remoteSources = async () => ({ sources });
        const reply = await f.request(
            request("shuffle", { source: "/Volumes/data/Movies" })
        );
        assert.equal(reply.data.error, code);
        assert.deepEqual(f.calls, []);
    }
});

test("retry after a timed-out new-folder scan reuses its binding and reads the completed catalog", async () => {
    const f = pluginFixture();
    await tick();
    f.w.__ottActiveProviderDriver = { id: "offline" };
    f.snapshots.push(
        { ...catalog(), items: [catalog().items[0]], scanning: true },
        catalog()
    );
    const params = request("shuffle", { source: "/Volumes/data/Movies" });
    const first = await new Promise((resolve) =>
        execute(f.w, params, resolve, (Date.now() + 30) / 1000)
    );
    assert.equal(first.data.error, "catalog_loading");
    assert.equal(
        f.calls.some((call) => call[0] === "provider"),
        false
    );
    await new Promise((resolve) => setTimeout(resolve, 280));
    const second = await new Promise((resolve) =>
        execute(f.w, params, resolve)
    );
    assert.equal(second.status, "ok");
    assert.equal(second.data.count, 3);
    assert.equal(
        f.calls.filter((call) => call[0] === "local_media_link_folder").length,
        1
    );
    assert.equal(
        f.calls.filter((call) => call[0] === "offline_media_endpoint").length,
        2
    );
    assert.equal(f.calls.filter((call) => call[0] === "provider").length, 1);
});
