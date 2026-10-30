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
        Array,
        Error,
        exports,
        isFinite,
        JSON,
        Math,
        Number,
        Object,
        Promise,
        require(name) {
            if (name === "./global-favorites-providers")
                return load("src/media/global-favorites-providers.ts");
            if (!(name in supplied))
                throw new Error("Unprovided dependency " + name);
            return supplied[name];
        },
        String,
        window: {},
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
        profile: "Second",
        provider,
        sourceAlias: "Source",
        subprofile: null,
    };
    const locator =
        provider === "plex"
            ? { kind: "plex-media", ratingKey: "42", serverId: "PMS" }
            : provider === "local"
              ? {
                    kind: "local-media",
                    relativePath: "Dir/file.mp4",
                    rootAlias: "Root",
                }
              : provider === "vportal"
                ? { id: "42", idField: "id", kind: "vportal-media" }
                : { channelId: "m3u-epg:news", kind: "channel" };
    const row = {
        id: "00000000-0000-4000-8000-000000000001",
        locator,
        origin,
        title: "Title",
    };
    const target = { current: () => targetCurrent, origin };
    const session = {
        complete() {},
        current: () => targetCurrent,
        origin,
        play: async () => {
            plays++;
            return true;
        },
        release: () => releases++,
        resolve: async () => ({ available: true, locator }),
    };
    const ports = {
        activate: async () => session,
        allowed: () => current,
        changed() {},
        clearTimer() {},
        codec,
        current: () => current,
        now: () => now,
        setTimer: (fn) => {
            timer = fn;
            return 1;
        },
        snapshot: async () => ({
            current: () => snapshotCurrent,
            entries: [row],
            revision: "r1",
        }),
        targets: async () => [target],
    };
    return {
        block: () => (current = false),
        expire: () => {
            now = 30000;
            timer();
        },
        plays: () => plays,
        ports,
        releases: () => releases,
        router: create(ports),
        row,
        session,
        staleStore: () => (snapshotCurrent = false),
        staleTarget: () => (targetCurrent = false),
        target,
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
            epg: "guessed",
            itemId: "channel:42",
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
        target: { channelId: 7, kind: "live", sourceId: "source" },
    };
    const w = {
        __ottActiveProviderDriver: {
            configuration: () => ({ active: 0 }),
            id: "m3u",
        },
        __ottChannelReferences: {
            create: () => ({
                project: () => 7,
                resolve: () => ({ itemId: "channel:7" }),
            }),
        },
        __ottClassicPlayback: { snapshot: () => state },
        __ottCommandChannelLoad: {},
        __ottSourceIdentity: { current: () => "source" },
        channels: {
            7: { category: { name: "A" }, channel_name: "News" },
            8: { category: { name: "B" }, channel_name: "News" },
        },
        cList: [7, 8],
    };
    const player = {
        allowed: () => true,
        captureSelector: async () => ({ bound: true }),
        selected: () => ({ name: "Profile" }),
    };
    const captured = await capture(w, player, codec);
    assert.deepEqual(JSON.parse(JSON.stringify(captured.value.locator)), {
        group: "A",
        kind: "channel-name",
        name: "News",
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
            configuration: () => ({ active: 1 }),
            id: "vportal",
        },
        __ottClassicPlayback: { snapshot: () => ({ generation: 3 }) },
        __ottCommandChannelLoad: {},
        __ottSourceIdentity: { current: () => "source", media: () => "media" },
    };
    const player = {
        allowed: () => true,
        captureSelector: async () => ({ bound: true }),
        selected: () => ({ name: "Second" }),
    };
    const payload = { id: "42", title: "Film", vportalSource: "media" };
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
        __ottActiveProviderDriver: { configuration: () => null, id: "offline" },
        __ottClassicPlayback: {
            snapshot: () => ({
                generation: 3,
                target: { channelId: "local-one" },
            }),
        },
        __ottCommandChannelLoad: {},
        __ottLocalMedia: {
            favoriteSnapshot: () => ({
                catalog: {
                    items: [
                        {
                            available: true,
                            id: "one",
                            name: "Folder/file.mp4",
                            sourceId: "root",
                        },
                    ],
                    sources: [{ id: "root", kind: "folder", name: "Movies" }],
                },
                current: () => same,
            }),
        },
        __ottOfflineProfiles: { read: () => ({ active: -1 }) },
        __ottSourceIdentity: { current: () => "source" },
    };
    const player = {
        allowed: () => true,
        captureSelector: async () => ({ bound: true }),
        selected: () => ({ default: true }),
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
            configuration: () => ({}),
            favoritesSource: () => ({
                current: () => verified,
                serverId: "PMS-A",
            }),
            id: "plex",
        },
        __ottClassicPlayback: { snapshot: () => ({ generation: 1 }) },
        __ottCommandChannelLoad: {},
        __ottSourceIdentity: { current: () => "source", media: () => "media" },
    };
    const player = {
        allowed: () => true,
        captureSelector: async () => ({}),
        selected: () => ({}),
    };
    const payload = {
        plexSource: "media",
        request: { path: "/library/metadata/42" },
        title: "Film",
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
        allowed: () => true,
        cancel() {},
        capture: () => null,
        current: () => true,
        failed() {
            throw Error("unexpected navigation failure");
        },
        identity: (value) => codec.identity(value),
        select: () => {
            throw Error("empty view must not dispatch");
        },
        snapshot: async () => ({ current: () => true, entries: [] }),
    });
    const ports = {
        captureScreen: () => () => active,
        current: () => true,
        describe: () => "",
        error: () => {
            throw Error("unexpected");
        },
        navigation,
        router: {},
        show: (view) => {
            shown++;
            descriptor = view;
            return () => true;
        },
        store: { snapshot: () => pending.promise },
        translate: (text) => (text === "Favorites" ? "Избранное" : text),
    };
    const view = make(ports);
    assert.equal(view.category().id, "system:global-favorites");
    assert.equal(view.category().label, "Избранное");
    const first = view.open();
    active = false;
    pending.resolve({ current: () => true, entries: [], unresolvedLegacy: [] });
    await first;
    assert.equal(shown, 0);
    active = true;
    ports.store.snapshot = async () => ({
        current: () => true,
        entries: [],
        unresolvedLegacy: [],
    });
    await view.open();
    assert.equal(shown, 1);
    assert.equal(descriptor.rows.length, 0);
});
function playbackBindingFixture(provider) {
    const valid = load(
        "src/settings/global-favorites-bindings.ts"
    ).isGlobalFavoriteSelector;
    const make = load(
        "src/settings/favorites-bindings.ts"
    ).createFavoritesBindings;
    const state = {
        next: 1,
        raw: null,
        stale: false,
        staleSource: false,
        writes: 0,
    };
    const registry = make({
        compareAndSwap: (before, after) => {
            assert.equal(before, state.raw);
            state.raw = after;
            state.writes++;
            return "confirmed";
        },
        current: (entry) =>
            !state.stale && !(state.staleSource && entry.kind === "source"),
        persistedRead: () => state.raw,
        read: () => state.raw,
        uuid: () =>
            "00000000-0000-4000-8000-" + String(state.next++).padStart(12, "0"),
        validateSelector: (_kind, value) => valid(value),
    });
    const selector = {
        configurationDigest: "a".repeat(64),
        kind: "global-playback-target",
        origin: {
            profile: "Two",
            provider,
            sourceAlias: "Two",
            subprofile: null,
        },
        provider,
        slot: 1,
    };
    const binding = {
        owner: "global:" + selector.configurationDigest,
        selector,
    };
    return {
        binding,
        registry,
        state,
        value: { profile: binding, provider, source: binding },
    };
}
for (const provider of ["m3u", "stalker", "xtream", "bestlist/stalker"]) {
    test(
        provider + " private profile/source pair uses one actual registry CAS",
        () => {
            const f = playbackBindingFixture(provider);
            const result = f.registry.provisionPlayback(f.value, 0);
            assert.equal(f.state.writes, 1);
            assert.equal(JSON.parse(f.state.raw).entries.length, 2);
            assert.equal(result.result.profile.provider, provider);
            assert.equal(result.result.source.provider, provider);
            assert.equal(
                result.result.source.profile_id,
                result.result.profile.id
            );
            assert.equal(
                f.registry.resolve(result.result.source.id).binding.selector
                    .provider,
                provider
            );
            f.registry.provisionPlayback(f.value, result.revision);
            assert.equal(
                f.state.writes,
                1,
                "existing exact pair is idempotent"
            );
        }
    );
}
test("playback pairing rejects mismatched providers and stale profile/source grants before writing", () => {
    const rejects = (f, code) => {
        assert.throws(
            () => f.registry.provisionPlayback(f.value, 0),
            (error) => error.code === code
        );
        assert.equal(f.state.writes, 0);
        assert.equal(f.state.raw, null);
    };
    let f = playbackBindingFixture("stalker");
    f.value.provider = "m3u";
    rejects(f, "invalid_binding");
    f = playbackBindingFixture("m3u");
    f.value.source = playbackBindingFixture("stalker").binding;
    rejects(f, "invalid_binding");
    f = playbackBindingFixture("stalker");
    f.value.profile = playbackBindingFixture("xtream").binding;
    rejects(f, "invalid_binding");
    for (const invalid of [
        "Stalker",
        "stalker\n",
        "https://portal.test",
        123,
    ]) {
        f = playbackBindingFixture("stalker");
        f.value.provider = invalid;
        rejects(f, "invalid_binding");
    }
    f = playbackBindingFixture("stalker");
    f.state.stale = true;
    rejects(f, "stale_context");
    f = playbackBindingFixture("stalker");
    f.state.staleSource = true;
    rejects(f, "stale_context");
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
