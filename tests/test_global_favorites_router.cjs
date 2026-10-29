"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
function load(file, supplied = {}) {
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText;
    vm.runInNewContext(code, {
        exports,
        require(name) {
            if (name === "./global-favorites-providers")
                return load("src/media/global-favorites-providers.ts");
            if (!(name in supplied))
                throw new Error("Unprovided dependency " + name);
            return supplied[name];
        },
        window: {},
        Promise,
        Object,
        Array,
        JSON,
        Math,
        Number,
        String,
        Error,
        isFinite,
    });
    return exports;
}
const codec = load(
    "src/settings/global-favorites-portable.ts"
).createGlobalFavoritesPortableCodec();
const create = load(
    "src/media/global-favorites-router.ts"
).createGlobalFavoritesRouter;
function deferred() {
    let resolve;
    const promise = new Promise((done) => (resolve = done));
    return { promise, resolve };
}
async function flush() {
    for (let i = 0; i < 15; i++) await Promise.resolve();
}
function fixture(provider = "m3u") {
    let now = 0,
        current = true,
        snapshotCurrent = true,
        targetCurrent = true,
        plays = 0,
        releases = 0,
        timer;
    const origin = {
        provider,
        profile: "Second",
        subprofile: null,
        sourceAlias: "Source",
    };
    const locator =
        provider === "plex"
            ? { kind: "plex-media", serverId: "PMS", ratingKey: "42" }
            : provider === "local"
              ? {
                    kind: "local-media",
                    rootAlias: "Root",
                    relativePath: "Dir/file.mp4",
                }
              : provider === "vportal"
                ? { kind: "vportal-media", idField: "id", id: "42" }
                : { kind: "channel", channelId: "m3u-epg:news" };
    const row = {
        id: "00000000-0000-4000-8000-000000000001",
        title: "Title",
        origin,
        locator,
    };
    const target = { origin, current: () => targetCurrent };
    const session = {
        origin,
        current: () => targetCurrent,
        resolve: async () => ({ available: true, locator }),
        play: async () => {
            plays++;
            return true;
        },
        release: () => releases++,
        complete() {},
    };
    const ports = {
        codec,
        now: () => now,
        current: () => current,
        allowed: () => current,
        snapshot: async () => ({
            revision: "r1",
            entries: [row],
            current: () => snapshotCurrent,
        }),
        targets: async () => [target],
        activate: async () => session,
        setTimer: (fn) => {
            timer = fn;
            return 1;
        },
        clearTimer() {},
        changed() {},
    };
    return {
        row,
        target,
        session,
        ports,
        router: create(ports),
        plays: () => plays,
        releases: () => releases,
        staleStore: () => (snapshotCurrent = false),
        staleTarget: () => (targetCurrent = false),
        block: () => (current = false),
        expire: () => {
            now = 30000;
            timer();
        },
    };
}
const cases = [];
function test(name, run) {
    cases.push([name, run]);
}
for (const provider of ["m3u", "plex", "vportal", "local"])
    test(
        "exact " + provider + " locator reaches only selected origin",
        async () => {
            const f = fixture(provider),
                result = await f.router.select(f.row.id).result;
            assert.equal(result.status, "ok");
            assert.equal(f.plays(), 1);
        }
    );
test("duplicate descriptor never picks the first profile", async () => {
    const f = fixture();
    f.ports.targets = async () => [f.target, f.target];
    assert.equal((await f.router.select(f.row.id).result).status, "ambiguous");
    assert.equal(f.plays(), 0);
});
test("missing profile remains unresolved without activation", async () => {
    const f = fixture();
    f.ports.targets = async () => [];
    f.ports.activate = () => {
        throw new Error("must not activate");
    };
    assert.equal((await f.router.select(f.row.id).result).status, "missing");
});
test("cancel during acquisition releases the late owner once", async () => {
    const f = fixture(),
        pending = deferred();
    f.ports.activate = () => pending.promise;
    const request = f.router.select(f.row.id);
    await flush();
    request.cancel();
    pending.resolve(f.session);
    await flush();
    assert.equal((await request.result).status, "cancelled");
    assert.equal(f.plays(), 0);
    assert.equal(f.releases(), 1);
});
test("source replacement, list revision and policy change fence a late resolution", async () => {
    for (const change of ["staleStore", "staleTarget", "block"]) {
        const f = fixture(),
            pending = deferred();
        f.session.resolve = () => pending.promise;
        const request = f.router.select(f.row.id);
        await flush();
        f[change]();
        pending.resolve({ available: true, locator: f.row.locator });
        await flush();
        assert.notEqual((await request.result).status, "ok");
        assert.equal(f.plays(), 0);
    }
});
test("wrong server item returned by resolver cannot play", async () => {
    const f = fixture("plex");
    f.session.resolve = async () => ({
        available: true,
        locator: { ...f.row.locator, ratingKey: "43" },
    });
    assert.equal(
        (await f.router.select(f.row.id).result).status,
        "unavailable"
    );
    assert.equal(f.plays(), 0);
});
test("whole handoff deadline cancels pending resolution without retry", async () => {
    const f = fixture();
    f.session.resolve = () => new Promise(() => {});
    const request = f.router.select(f.row.id);
    await flush();
    f.expire();
    assert.equal((await request.result).status, "timeout");
    assert.equal(f.plays(), 0);
    assert.equal(f.releases(), 1);
});
test("numeric renderer fallback is never portable identity", () => {
    const helpers = load("src/media/global-favorites-identities.ts");
    assert.equal(
        helpers.globalFavoriteChannelId("m3u", {
            itemId: "channel:42",
            epg: "guessed",
        }),
        null
    );
    assert.equal(
        helpers.globalFavoriteChannelId("m3u", {
            __ottFavoriteTvgId: "Exact.ID",
        }),
        "m3u-epg:Exact.ID"
    );
    assert.equal(helpers.globalFavoriteProviderId(9007199254740992), null);
    assert.equal(helpers.globalFavoriteProviderId(1.5), null);
});
test("actual M3U driver preserves explicit tvg-id and not a title fallback", () => {
    const make = require("./helpers/m3u-driver-fixture.cjs");
    const f = make(),
        driver = f.start();
    let completed = false;
    f.host.getChannelsArray(() => (completed = true));
    f.requests[0].resolve(
        '#EXTM3U\n#EXTINF:-1 tvg-id="Stable.ID",One\nhttps://media.test/one\n#EXTINF:-1,Two\nhttps://media.test/two\n'
    );
    assert.equal(completed, true);
    assert.equal(
        f.host.channels[f.host.cList[0]].__ottFavoriteTvgId,
        "Stable.ID"
    );
    assert.equal(f.host.channels[f.host.cList[1]].__ottFavoriteTvgId, "");
});
test("actual capture prefers an explicit identity, otherwise exact unique name/group", async () => {
    const identities = load("src/media/global-favorites-identities.ts");
    const capture = load("src/media/global-favorites-capture.ts", {
        "./global-favorites-identities": identities,
    }).captureGlobalFavorite;
    const state = {
        generation: 1,
        phase: "playing",
        target: { kind: "live", sourceId: "source", channelId: 7 },
    };
    const w = {
        __ottActiveProviderDriver: {
            id: "m3u",
            configuration: () => ({ active: 0 }),
        },
        __ottClassicPlayback: { snapshot: () => state },
        __ottCommandChannelLoad: {},
        __ottSourceIdentity: { current: () => "source" },
        channels: {
            7: { channel_name: "News", category: { name: "A" } },
            8: { channel_name: "News", category: { name: "B" } },
        },
        cList: [7, 8],
        __ottChannelReferences: {
            create: () => ({
                resolve: () => ({ itemId: "channel:7" }),
                project: () => 7,
            }),
        },
    };
    const player = {
        allowed: () => true,
        selected: () => ({ name: "Profile" }),
        captureSelector: async () => ({ bound: true }),
    };
    const captured = await capture(w, player, codec);
    assert.deepEqual(JSON.parse(JSON.stringify(captured.value.locator)), {
        kind: "channel-name",
        name: "News",
        group: "A",
    });
    w.channels[8].category.name = "A";
    assert.equal(
        await capture(w, player, codec),
        null,
        "duplicate exact name/group is unresolved"
    );
    w.channels[7].__ottFavoriteTvgId = "explicit";
    assert.equal(
        (await capture(w, player, codec)).value.locator.channelId,
        "m3u-epg:explicit"
    );
});
test("actual VPortal capture requires source-owned ID attestation", async () => {
    const identities = load("src/media/global-favorites-identities.ts");
    const capture = load("src/media/global-favorites-capture.ts", {
        "./global-favorites-identities": identities,
    }).captureGlobalFavorite;
    const w = {
        __ottActiveProviderDriver: {
            id: "vportal",
            configuration: () => ({ active: 1 }),
        },
        __ottClassicPlayback: { snapshot: () => ({ generation: 3 }) },
        __ottCommandChannelLoad: {},
        __ottSourceIdentity: { current: () => "source", media: () => "media" },
    };
    const player = {
        allowed: () => true,
        selected: () => ({ name: "Second" }),
        captureSelector: async () => ({ bound: true }),
    };
    const payload = { title: "Film", vportalSource: "media", id: "42" };
    assert.equal(await capture(w, player, codec, payload), null);
    payload.__ottFavoriteId = { field: "id", value: "42" };
    w.cList = [7];
    w.channels = { 7: { __ottMediaItem: payload } };
    assert.equal(
        (await capture(w, player, codec, payload)).value.locator.id,
        "42"
    );
    payload.__ottMediaCategory = { name: "Films / Series" };
    payload.__ottMediaCategories = [payload.__ottMediaCategory];
    assert.equal(
        (await capture(w, player, codec, payload)).value.origin.subprofile,
        "Films / Series"
    );
    w.cList.push(8);
    w.channels[8] = { __ottMediaItem: payload };
    assert.equal(
        await capture(w, player, codec, payload),
        null,
        "ambiguous provider ID is not captured"
    );
    w.cList.pop();
    w.__ottActiveProviderDriver.catalogLoading = () => true;
    assert.equal(
        await capture(w, player, codec, payload),
        null,
        "a partial recursive catalog cannot prove unique identity"
    );
    w.__ottActiveProviderDriver.catalogLoading = () => false;
    payload.vportalSource = "foreign";
    assert.equal(await capture(w, player, codec, payload), null);
});
test("actual Local capture uses exact bound root and relative path", async () => {
    const identities = load("src/media/global-favorites-identities.ts");
    const capture = load("src/media/global-favorites-capture.ts", {
        "./global-favorites-identities": identities,
    }).captureGlobalFavorite;
    let same = true;
    const w = {
        __ottActiveProviderDriver: { id: "offline", configuration: () => null },
        __ottClassicPlayback: {
            snapshot: () => ({
                generation: 3,
                target: { channelId: "local-one" },
            }),
        },
        __ottCommandChannelLoad: {},
        __ottSourceIdentity: { current: () => "source" },
        __ottOfflineProfiles: { read: () => ({ active: -1 }) },
        __ottLocalMedia: {
            favoriteSnapshot: () => ({
                current: () => same,
                catalog: {
                    items: [
                        {
                            id: "one",
                            sourceId: "root",
                            name: "Folder/file.mp4",
                            available: true,
                        },
                    ],
                    sources: [{ id: "root", name: "Movies", kind: "folder" }],
                },
            }),
        },
    };
    const player = {
        allowed: () => true,
        selected: () => ({ default: true }),
        captureSelector: async () => ({ bound: true }),
    };
    const result = await capture(w, player, codec);
    assert.equal(result.value.locator.relativePath, "Folder/file.mp4");
    assert.equal(result.root.id, "root");
    same = false;
    assert.equal(
        await capture(w, player, codec),
        null,
        "changed catalog is not captured"
    );
});
test("actual Plex capture pins verified server and current source", async () => {
    const ids = load("src/media/global-favorites-identities.ts"),
        capture = load("src/media/global-favorites-capture.ts", {
            "./global-favorites-identities": ids,
        }).captureGlobalFavorite;
    let verified = true;
    const w = {
        __ottActiveProviderDriver: {
            id: "plex",
            configuration: () => ({}),
            favoritesSource: () => ({
                serverId: "PMS-A",
                current: () => verified,
            }),
        },
        __ottClassicPlayback: { snapshot: () => ({ generation: 1 }) },
        __ottCommandChannelLoad: {},
        __ottSourceIdentity: { current: () => "source", media: () => "media" },
    };
    const player = {
        allowed: () => true,
        selected: () => ({}),
        captureSelector: async () => ({}),
    };
    const payload = {
        title: "Film",
        plexSource: "media",
        request: { path: "/library/metadata/42" },
    };
    assert.equal(
        (await capture(w, player, codec, payload)).value.locator.serverId,
        "PMS-A"
    );
    verified = false;
    assert.equal(await capture(w, player, codec, payload), null);
    verified = true;
    payload.plexSource = "foreign";
    assert.equal(await capture(w, player, codec, payload), null);
});
test("global empty category is localized and a stale async open cannot reopen UI", async () => {
    const make = load(
        "src/media/global-favorites-view.ts"
    ).createGlobalFavoritesView;
    let active = true,
        shown = 0,
        descriptor;
    const pending = deferred();
    const navigation = load(
        "src/media/global-favorites-navigation.ts"
    ).createGlobalFavoritesNavigation({
        current: () => true,
        allowed: () => true,
        capture: () => null,
        identity: (value) => codec.identity(value),
        snapshot: async () => ({ entries: [], current: () => true }),
        select: () => {
            throw Error("empty view must not dispatch");
        },
        cancel() {},
        failed() {
            throw Error("unexpected navigation failure");
        },
    });
    const ports = {
        navigation,
        store: { snapshot: () => pending.promise },
        router: {},
        current: () => true,
        translate: (text) => (text === "Favorites" ? "Избранное" : text),
        captureScreen: () => () => active,
        describe: () => "",
        show: (view) => {
            shown++;
            descriptor = view;
            return () => true;
        },
        error: () => {
            throw Error("unexpected");
        },
    };
    const view = make(ports);
    assert.equal(view.category().id, "system:global-favorites");
    assert.equal(view.category().label, "Избранное");
    const first = view.open();
    active = false;
    pending.resolve({ entries: [], unresolvedLegacy: [], current: () => true });
    await first;
    assert.equal(shown, 0);
    active = true;
    ports.store.snapshot = async () => ({
        entries: [],
        unresolvedLegacy: [],
        current: () => true,
    });
    await view.open();
    assert.equal(shown, 1);
    assert.equal(descriptor.rows.length, 0);
});
test("generic private profile/source pair uses one actual registry CAS", () => {
    const valid = load(
        "src/settings/global-favorites-bindings.ts"
    ).isGlobalFavoriteSelector;
    const make = load(
        "src/settings/favorites-bindings.ts"
    ).createFavoritesBindings;
    let raw = null,
        writes = 0,
        next = 1;
    const registry = make({
        read: () => raw,
        persistedRead: () => raw,
        uuid: () =>
            "00000000-0000-4000-8000-" + String(next++).padStart(12, "0"),
        validateSelector: (_kind, value) => valid(value),
        current: () => true,
        compareAndSwap: (before, after) => {
            assert.equal(before, raw);
            raw = after;
            writes++;
            return "confirmed";
        },
    });
    const selector = {
        kind: "global-playback-target",
        provider: "m3u",
        origin: {
            provider: "m3u",
            profile: "Two",
            subprofile: null,
            sourceAlias: "Two",
        },
        slot: 1,
        configurationDigest: "a".repeat(64),
    };
    const binding = {
        owner: "global:" + selector.configurationDigest,
        selector,
    };
    const result = registry.provisionPlayback(
        { provider: "m3u", profile: binding, source: binding },
        0
    );
    assert.equal(writes, 1);
    assert.equal(JSON.parse(raw).entries.length, 2);
    assert.equal(result.result.source.profile_id, result.result.profile.id);
    registry.provisionPlayback(
        { provider: "m3u", profile: binding, source: binding },
        result.revision
    );
    assert.equal(writes, 1, "existing exact pair is idempotent");
});
(async () => {
    for (const [name, run] of cases) {
        await run();
        console.log("PASS global Favorites: " + name);
    }
    console.log("PASS " + cases.length + " global Favorites scenarios");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
