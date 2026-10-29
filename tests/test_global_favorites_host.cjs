"use strict";
const {
    createMainPorts,
} = require("./helpers/global-favorites-main-ports.cjs");
const assert = require("node:assert/strict"),
    fs = require("node:fs"),
    path = require("node:path"),
    vm = require("node:vm"),
    ts = require("typescript"),
    crypto = require("node:crypto");
function fixture(partial = false) {
    const data = new Map(),
        writes = [],
        cache = {},
        timers = new Map();
    let serial = 0,
        clock = 1000000,
        held = false,
        active = true,
        runtimeCurrent = true,
        handler = {},
        shown = [];
    const hash = (value) =>
        crypto
            .createHash("sha256")
            .update(typeof value === "string" ? value : Buffer.from(value))
            .digest("hex");
    const w = {
        _: (v) => v,
        stbGetItem: (key) => (data.has(key) ? data.get(key) : null),
        __ottStandby: { blocked: () => false },
        __ottKiosk: { enabled: () => false },
        __ottParental: { needs: () => false },
        setTimeout(fn) {
            timers.set(++serial, fn);
            return serial;
        },
        clearTimeout(id) {
            timers.delete(id);
        },
        __ottCommandChannelLoad: {},
        commandChannelsReady: true,
        __ottSourceIdentity: {
            current: () => "m3u:source",
            media: () => "media:source",
        },
        __ottClassicPlayback: { snapshot: () => ({ generation: 1 }) },
        listKeyHandlerFn: handler,
        __ottClassicScreenPort: { screens: { current: () => null } },
        keys: { ENTER: 13, PLAY: 80, RETURN: 27, EXIT: 27 },
        showShift() {},
        closeList() {},
        __ottChannelListView: {
            show(view) {
                shown.push(view);
            },
        },
        channels: {
            7: {
                itemId: "news",
                __ottFavoriteTvgId: "News",
                channel_name: "News",
            },
        },
        cList: [7],
    };
    data.set(
        "m3um3uArr",
        JSON.stringify({
            active: 0,
            M3Us: [
                {
                    name: "Profile",
                    www: "https://fixture.test/list",
                    rechours: 0,
                },
            ],
        })
    );
    w.__ottActiveProviderDriver = {
        id: "m3u",
        configuration: () => JSON.parse(w.stbGetItem("m3um3uArr")),
    };
    function load(name) {
        if (cache[name]) return cache[name];
        const exports = (cache[name] = {});
        vm.runInNewContext(
            ts.transpileModule(fs.readFileSync(name, "utf8"), {
                compilerOptions: {
                    module: ts.ModuleKind.CommonJS,
                    target: ts.ScriptTarget.ES5,
                },
            }).outputText,
            {
                exports,
                window: w,
                Uint8Array,
                Promise,
                console,
                require: (relative) =>
                    load(
                        path.posix.normalize(
                            path.posix.join(
                                path.posix.dirname(name),
                                relative + ".ts"
                            )
                        )
                    ),
            }
        );
        return exports;
    }
    load("src/channels/channel-references.ts");
    load("src/media/journal.ts");
    function journal(position, title = "News") {
        data.set(
            "mediaJournal.v1:media:source",
            JSON.stringify({
                version: 1,
                sourceId: "media:source",
                favorites: [
                    {
                        sourceId: "media:source",
                        itemId: "news",
                        position: 0,
                        payload: { title, __ottGlobalChannel: 7 },
                    },
                ],
                history: [
                    {
                        sourceId: "media:source",
                        itemId: "news",
                        position,
                        payload: { title, __ottGlobalChannel: 7 },
                    },
                ],
            })
        );
    }
    journal(1);
    const media = w.__ottMediaJournal.create({
        sourceId: "media:source",
        current: () => active,
        enabled: () => true,
        read: w.stbGetItem,
        write() {
            throw Error("read-only capture must not write journal");
        },
        importRows: () => [],
        limit: () => 20,
        core: {},
    });
    w.__ottMedia = {
        current: () => null,
        captureGlobalFavorites: () => media.captureFavorites(),
    };
    if (partial) {
        const document = {
            sourceId: "m3u:source",
            lists: {
                order: ["Favorites"],
                lists: {
                    Favorites: [{ itemId: "news" }, { itemId: "missing" }],
                },
            },
        };
        w.__ottFavoritesLibrary = {
            captureGlobal: () => ({
                document,
                raw: JSON.stringify(document),
                current: () => active,
            }),
        };
    }
    const grant = {
        origin: "https://fixture.test",
        privateLedgerKey: "favorites-receipts.v1",
        lockName: "ottplay:favorites-ledger",
        implementationVersion: 1,
        kind: "synchronous-localstorage",
        current: () => active,
        read: w.stbGetItem,
        async exclusive(work) {
            assert(!held);
            held = true;
            try {
                return await work(grant);
            } finally {
                held = false;
            }
        },
        compareAndSwap(key, before, after, admitted) {
            assert(held);
            if (
                !active ||
                (admitted && !admitted()) ||
                w.stbGetItem(key) !== before
            )
                return "conflict";
            writes.push(key);
            data.set(key, after);
            return "confirmed";
        },
    };
    const mainCalls = [],
        main = createMainPorts(w);
    for (const name of [
        "remoteCheckpoint",
        "handleRemoteProfiles",
        "isProviderAllowed",
        "providerIds",
        "selectProviderByIndex",
        "selectMediaProfile",
    ]) {
        const actual = main[name];
        main[name] = function () {
            mainCalls.push(name);
            return actual.apply(undefined, arguments);
        };
    }
    const hostPorts = {
        ...main,
        favoriteRemoved: (title) => w.showShift("Favorites: − " + title),
        capture: () => grant,
        current: () => active && runtimeCurrent,
        runtime: () => "runtime-one",
        authorized: () => true,
        now: () => clock,
        uuid: () =>
            `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`,
        sha256: async (value) => hash(value),
        base64Encode: (bytes) => Buffer.from(bytes).toString("base64"),
        base64Decode: (text) => new Uint8Array(Buffer.from(text, "base64")),
        captureLegacy: async () => {
            throw Error("unexpected legacy capture");
        },
        playLegacy() {
            throw Error("unexpected legacy play");
        },
    };
    const makeHost = load(
            "src/media/global-favorites-host.ts"
        ).createGlobalFavoritesHost,
        host = makeHost(w, hostPorts);
    return {
        host,
        w,
        data,
        writes,
        journal,
        shown,
        hash,
        makeHost,
        hostPorts,
        mainCalls,
        deactivate() {
            active = false;
        },
        expireRuntime() {
            runtimeCurrent = false;
        },
    };
}
async function seededPlayableFixture() {
    const f = fixture(),
        w = f.w;
    let state = {
            generation: 1,
            phase: "playing",
            target: { kind: "live", sourceId: "m3u:source", channelId: 7 },
        },
        plays = 0;
    w._playSession = 11;
    w.__ottClassicPlayback = { snapshot: () => state, checkpoint() {} };
    w.__ottChannels = { index: () => 0 };
    w.catsArray = ["all"];
    w.cats = { all: [7] };
    w.playChannel = (group, index, force, current) => {
        assert(current());
        plays++;
        w._playSession++;
        state = {
            generation: state.generation + 1,
            phase: "playing",
            target: {
                kind: "live",
                sourceId: "m3u:source",
                channelId: w.cats[w.catsArray[group]][index],
            },
        };
        return true;
    };
    const entry = {
        title: "Seeded playable",
        origin: {
            provider: "m3u",
            profile: "Paired Profile",
            subprofile: null,
            sourceAlias: "Paired Source",
        },
        locator: { kind: "channel", channelId: "m3u-epg:News" },
    };
    await f.host.committer.qualify();
    const before = await f.host.store.snapshot();
    await f.host.store.mutate(before.revision, { op: "put", entries: [entry] });
    await f.host.pair(entry.origin, 0, undefined, () => true);
    const snapshot = await f.host.store.snapshot();
    assert.equal(snapshot.entries.length, 1);
    const id = snapshot.entries[0].id;
    assert.equal(
        (await f.host.router.select(id).result).status,
        "ok",
        "healthy same stored/paired route must be playable"
    );
    assert.equal(plays, 1);
    assert(f.host.router.captureCurrent());
    return { ...f, id, plays: () => plays };
}
function assertRawUnchanged(f, before) {
    assert.equal(f.data.size, before.size);
    for (const [key, value] of before)
        assert.equal(f.data.get(key), value, key);
}
async function main() {
    const required = [
        "current",
        "caselessKey",
        "remoteCheckpoint",
        "handleRemoteProfiles",
        "isProviderAllowed",
        "providerIds",
        "selectProviderByIndex",
        "selectMediaProfile",
    ];
    const missing = fixture();
    for (const name of required) {
        let captures = 0;
        const invalid = {
            ...missing.hostPorts,
            [name]: undefined,
            capture() {
                captures++;
                throw Error("missing port reached physical capture");
            },
        };
        assert.throws(
            () => missing.makeHost(missing.w, invalid),
            (error) => error.message === "unsupported",
            name
        );
        assert.equal(captures, 0);
    }
    let captures = 0;
    assert.throws(
        () =>
            missing.makeHost(missing.w, {
                ...missing.hostPorts,
                current: () => false,
                capture() {
                    captures++;
                    throw Error("stale host captured storage");
                },
            }),
        (error) => error.message === "context_changed"
    );
    assert.equal(captures, 0);
    assert.equal(missing.writes.length, 0);
    assert.equal(missing.w.__ottGlobalFavorites, undefined);
    assert.equal(missing.w.__ottGlobalFavoritesPorts, undefined);
    missing.host.dispose();
    for (const name of required) {
        const stale = await seededPlayableFixture(),
            before = new Map(stale.data),
            calls = stale.mainCalls.length,
            writes = stale.writes.length;
        let replacements = 0;
        stale.hostPorts[name] = () => {
            replacements++;
            throw Error("stale replacement invoked");
        };
        assert.equal(stale.host.facade.current(), false, name);
        assert.notEqual(
            (await stale.host.router.select(stale.id).result).status,
            "ok"
        );
        assert.equal(replacements, 0);
        assert.equal(
            stale.mainCalls.length,
            calls,
            "replacement port cannot call provider/checkpoint/profile"
        );
        assert.equal(stale.writes.length, writes);
        assert.equal(stale.plays(), 1);
        assertRawUnchanged(stale, before);
        stale.host.dispose();
    }
    for (const invalidate of ["deactivate", "expireRuntime"]) {
        const stale = await seededPlayableFixture(),
            before = new Map(stale.data),
            calls = stale.mainCalls.length,
            writes = stale.writes.length;
        stale[invalidate]();
        assert.equal(stale.host.facade.current(), false);
        assert.notEqual(
            (await stale.host.router.select(stale.id).result).status,
            "ok"
        );
        await assert.rejects(
            stale.host.open(),
            (error) => error.message === "policy_denied"
        );
        assert.equal(stale.mainCalls.length, calls);
        assert.equal(stale.writes.length, writes);
        assert.equal(stale.plays(), 1);
        assertRawUnchanged(stale, before);
        stale.host.dispose();
    }
    for (const partial of [false, true]) {
        const f = fixture(partial),
            before = new Map(f.data);
        const described = await f.host.protocol.execute(
            { op: "describe", runtime: "runtime-one" },
            80,
            1030
        );
        assert.equal(
            described.error,
            undefined,
            "actual cold host protocol has its required context port"
        );
        assert.equal(described.write_ready, true);
        assert.deepEqual(
            Array.from(described.locator_kinds),
            Array.from(described.locator_kinds).sort()
        );
        assert.equal(f.writes.length, 0);
        for (const [key, value] of before) assert.equal(f.data.get(key), value);
        await f.host.open();
        const snapshot = await f.host.store.snapshot();
        assert.equal(
            snapshot.entries.length,
            1,
            "actual capture migrates source membership"
        );
        await f.host.store.mutate(snapshot.revision, {
            op: "remove",
            ids: [snapshot.entries[0].id],
        });
        assert.equal((await f.host.store.snapshot()).entries.length, 0);
        f.journal(99, "Renamed label");
        await f.host.open();
        assert.equal(
            (await f.host.store.snapshot()).entries.length,
            0,
            "history/title change cannot resurrect deleted global favorite, including partial source capture"
        );
        assert.equal(
            JSON.parse(f.data.get("mediaJournal.v1:media:source")).favorites
                .length,
            1,
            "original per-source favorite is retained"
        );
        f.host.dispose();
    }
    const f = fixture(),
        w = f.w;
    let state = {
        generation: 1,
        phase: "playing",
        target: { kind: "live", sourceId: "m3u:source", channelId: 7 },
    };
    w._playSession = 11;
    w.__ottClassicPlayback = { snapshot: () => state, checkpoint() {} };
    w.__ottChannels = { index: () => 0 };
    w.catsArray = ["all"];
    w.cats = { all: [7, 8] };
    w.channels[8] = {
        itemId: "other",
        __ottFavoriteTvgId: "Other",
        channel_name: "Other",
    };
    w.cList.push(8);
    w.playChannel = (group, index, _force, current) => {
        assert(current());
        w._playSession++;
        state = {
            generation: state.generation + 1,
            phase: "playing",
            target: {
                kind: "live",
                sourceId: "m3u:source",
                channelId: w.cats[w.catsArray[group]][index],
            },
        };
        return true;
    };
    const imported = {
        title: "Imported News",
        origin: {
            provider: "m3u",
            profile: "Imported Profile Alias",
            subprofile: null,
            sourceAlias: "Imported Source Alias",
        },
        locator: { kind: "channel", channelId: "m3u-epg:News" },
    };
    const other = {
        title: "Unrelated row",
        origin: {
            provider: "m3u",
            profile: "Another profile",
            subprofile: null,
            sourceAlias: "Another source",
        },
        locator: { kind: "channel", channelId: "m3u-epg:Other" },
    };
    await f.host.committer.qualify();
    let before = await f.host.store.snapshot();
    await f.host.store.mutate(before.revision, {
        op: "put",
        entries: [imported, other],
    });
    await f.host.pair(imported.origin, 0, undefined, () => true);
    const entries = (await f.host.store.snapshot()).entries,
        selected = entries.find((row) => row.title === imported.title),
        retained = entries.find((row) => row.title === other.title);
    assert.equal((await f.host.router.select(selected.id).result).status, "ok");
    const writesBeforeCurrent = f.writes.length;
    assert.equal(
        (await f.host.currentItem()).entry.origin.sourceAlias,
        imported.origin.sourceAlias,
        "actual host current API retains the proven imported alias"
    );
    assert.equal(
        f.writes.length,
        writesBeforeCurrent,
        "currentItem remains read-only"
    );
    w.channels[7] = { ...w.channels[7], __ottFavoriteTvgId: "Different" };
    assert.equal(
        f.host.router.captureCurrent(),
        null,
        "same numeric row with different stable identity retires provenance"
    );
    w.channels[7].__ottFavoriteTvgId = "News";
    assert.equal((await f.host.router.select(selected.id).result).status, "ok");
    w._playSession++;
    assert.equal(
        f.host.router.captureCurrent(),
        null,
        "actual session generation bump retires provenance"
    );
    assert.equal((await f.host.router.select(selected.id).result).status, "ok");
    assert.equal(
        f.host.router.captureCurrent({ __ottGlobalChannel: 8 }),
        null,
        "selected different row cannot inherit the playing identity"
    );
    await f.host.toggle();
    let after = await f.host.store.snapshot();
    assert.deepEqual(
        Array.from(after.entries, (row) => row.id),
        [retained.id],
        "fullscreen toggle removes imported playing row only, with distinct local profile labels"
    );
    await f.host.toggle();
    after = await f.host.store.snapshot();
    assert.equal(after.entries.length, 2);
    assert(after.entries.some((row) => row.id === retained.id));
    const restored = after.entries.find((row) => row.id !== retained.id);
    assert.equal(
        restored.origin.sourceAlias,
        imported.origin.sourceAlias,
        "second F re-adds the same imported identity"
    );
    state = {
        generation: state.generation + 1,
        phase: "playing",
        target: { kind: "live", sourceId: "m3u:source", channelId: 8 },
    };
    assert.equal(
        f.host.router.captureCurrent(),
        null,
        "manual channel switch retires the imported identity"
    );
    assert.notEqual(
        (await f.host.currentItem()).entry.origin.sourceAlias,
        imported.origin.sourceAlias
    );
    f.host.dispose();
    const g = fixture(),
        gw = g.w;
    let gs = {
        generation: 1,
        phase: "playing",
        target: { kind: "live", sourceId: "m3u:source", channelId: 7 },
    };
    gw._playSession = 1;
    gw.__ottClassicPlayback = { snapshot: () => gs, checkpoint() {} };
    gw.__ottChannels = { index: () => 0 };
    gw.catsArray = ["all"];
    gw.cats = { all: [7] };
    gw.playChannel = (group, index, force, current) => {
        assert(current());
        gw._playSession++;
        gs = {
            generation: gs.generation + 1,
            phase: "playing",
            target: { kind: "live", sourceId: "m3u:source", channelId: 7 },
        };
        return true;
    };
    await g.host.committer.qualify();
    let gb = await g.host.store.snapshot();
    await g.host.store.mutate(gb.revision, {
        op: "put",
        entries: [
            {
                title: "Automatic mapping",
                origin: {
                    provider: "m3u",
                    profile: "Profile",
                    sourceAlias: "Profile",
                    subprofile: null,
                },
                locator: { kind: "channel", channelId: "m3u-epg:News" },
            },
        ],
    });
    const gid = (await g.host.store.snapshot()).entries[0].id;
    assert.equal((await g.host.router.select(gid).result).status, "ok");
    assert(g.host.router.captureCurrent());
    const bindingKey = "favorites-bindings.v1",
        binding = JSON.parse(g.data.get(bindingKey));
    binding.revision++;
    g.data.set(bindingKey, JSON.stringify(binding));
    assert.equal(
        g.host.router.captureCurrent(),
        null,
        "automatically persisted mapping is pinned after handoff"
    );
    g.host.dispose();
    console.log(
        "PASS actual host imported-playing identity, fullscreen toggle and manual-switch retirement"
    );
    console.log(
        "PASS actual cold host describe and complete/partial migration tombstones after history changes"
    );
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
