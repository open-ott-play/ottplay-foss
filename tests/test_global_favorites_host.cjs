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
        shown = [],
        toggles = [];
    let writeFailure = null;
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
                w.selIndex = view.selected;
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
            if (key === "remoteFavorites.v1" && writeFailure === "conflict")
                return "conflict";
            writes.push(key);
            data.set(key, after);
            return key === "remoteFavorites.v1" && writeFailure === "unknown"
                ? "unknown"
                : "confirmed";
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
        favoriteToggled: (title, added) => toggles.push([title, added]),
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
        load,
        w,
        data,
        writes,
        journal,
        shown,
        hash,
        makeHost,
        hostPorts,
        mainCalls,
        toggles,
        failWrites(mode) {
            writeFailure = mode;
        },
        deactivate() {
            active = false;
        },
        expireRuntime() {
            runtimeCurrent = false;
        },
    };
}
async function seededPlayableFixture(title = "Seeded playable") {
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
        title,
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
    const localA = fixture();
    await localA.host.committer.qualify();
    const foreign = {
        title: "Foreign binding",
        origin: {
            provider: "m3u",
            profile: "Foreign",
            sourceAlias: "Foreign alias",
            subprofile: null,
        },
        locator: { kind: "channel", channelId: "m3u-epg:News" },
    };
    let aliasView = await localA.host.store.snapshot();
    await localA.host.store.mutate(aliasView.revision, {
        op: "put",
        entries: [foreign],
    });
    await localA.host.pair(foreign.origin, 0, undefined, () => true);
    const awayB = fixture();
    awayB.data.set("remoteFavorites.v1", localA.data.get("remoteFavorites.v1"));
    awayB.data.set(
        "favorites-bindings.v1",
        localA.data.get("favorites-bindings.v1")
    );
    const awayConfig = JSON.parse(awayB.data.get("m3um3uArr"));
    awayConfig.M3Us[0].name = "B";
    awayB.data.set("m3um3uArr", JSON.stringify(awayConfig));
    awayB.w.__ottSourceIdentity.current = () => "m3u:away-B";
    awayB.w.keys.YELLOW = 405;
    awayB.w.keys.TOOLS = 84;
    awayB.w.keys.N0 = 48;
    await awayB.host.open();
    const awayView = awayB.shown.at(-1),
        foreignId = (await awayB.host.store.snapshot()).entries.find(
            (row) => row.title === "Foreign binding"
        ).id;
    awayB.w.selIndex = awayView.rows.indexOf(foreignId);
    assert(awayView.key(405));
    for (let turn = 0; turn < 20; turn++) await new Promise(setImmediate);
    localA.data.set("remoteFavorites.v1", awayB.data.get("remoteFavorites.v1"));
    await localA.host.open();
    assert(
        !(await localA.host.store.snapshot()).entries.some(
            (row) =>
                row.locator.channelId === "m3u-epg:News" &&
                row.origin.profile !== "B"
        ),
        "verified Foreign-to-Local mapping cannot resurrect under Local alias"
    );
    await localA.host.add({ __ottGlobalChannel: 7 });
    aliasView = await localA.host.store.snapshot();
    assert.equal(
        aliasView.entries.filter((row) => row.origin.profile === "Foreign")
            .length,
        1,
        "manual explicit Add retains paired Foreign identity"
    );
    assert.equal(
        aliasView.entries.filter((row) => row.origin.profile === "Profile")
            .length,
        0,
        "no duplicate Local identity"
    );
    assert.equal(
        (await localA.host.add({ __ottGlobalChannel: 7 })).changed,
        false
    );
    await localA.host.toggle({ __ottGlobalChannel: 7 });
    assert(
        !(await localA.host.store.snapshot()).entries.some(
            (row) => row.origin.profile === "Foreign"
        ),
        "manual F toggles mapped identity"
    );
    await localA.host.pair(
        {
            ...foreign.origin,
            profile: "Other imported",
            sourceAlias: "Other imported",
        },
        0,
        undefined,
        () => true
    );
    const ambiguousRaw = new Map(localA.data);
    await assert.rejects(
        localA.host.add({ __ottGlobalChannel: 7 }),
        /unavailable/
    );
    assertRawUnchanged(localA, ambiguousRaw);
    localA.host.dispose();
    awayB.host.dispose();
    const sourceB = fixture();
    await sourceB.host.committer.qualify();
    const importedA = {
        title: "Imported A",
        origin: {
            provider: "m3u",
            profile: "A",
            sourceAlias: "A",
            subprofile: null,
        },
        locator: { kind: "channel", channelId: "m3u-epg:News" },
    };
    let importedView = await sourceB.host.store.snapshot();
    await sourceB.host.store.mutate(importedView.revision, {
        op: "put",
        entries: [importedA],
    });
    sourceB.w.keys.YELLOW = 405;
    sourceB.w.keys.TOOLS = 84;
    sourceB.w.keys.N0 = 48;
    await sourceB.host.open();
    const viewB = sourceB.shown.at(-1),
        idA = (await sourceB.host.store.snapshot()).entries.find(
            (row) => row.title === "Imported A"
        ).id;
    sourceB.w.selIndex = viewB.rows.indexOf(idA);
    assert(viewB.key(sourceB.w.keys.YELLOW));
    for (let turn = 0; turn < 20; turn++) await new Promise(setImmediate);
    assert(
        !(await sourceB.host.store.snapshot()).entries.some(
            (row) => row.id === idA
        )
    );
    const sourceA = fixture();
    sourceA.data.set(
        "remoteFavorites.v1",
        sourceB.data.get("remoteFavorites.v1")
    );
    const profileA = JSON.parse(sourceA.data.get("m3um3uArr"));
    profileA.M3Us[0].name = "A";
    sourceA.data.set("m3um3uArr", JSON.stringify(profileA));
    sourceA.w.__ottSourceIdentity.current = () => "m3u:unvisited-A";
    sourceA.hostPorts.uuid = () => "99999999-9999-4999-8999-999999999999";
    await sourceA.host.open();
    assert(
        !(await sourceA.host.store.snapshot()).entries.some(
            (row) => row.origin.profile === "A"
        ),
        "first visit A does not resurrect row removed by UUID while B was current"
    );
    await sourceA.host.add({ __ottGlobalChannel: 7 });
    assert(
        (await sourceA.host.store.snapshot()).entries.some(
            (row) => row.origin.profile === "A"
        ),
        "explicit re-add on A works after durable suppression"
    );
    sourceA.host.dispose();
    sourceB.host.dispose();
    const deferred = fixture();
    await deferred.host.committer.qualify();
    assert.equal((await deferred.host.store.snapshot()).entries.length, 0);
    await deferred.host.remove({ __ottGlobalChannel: 7 });
    await deferred.host.open();
    assert.equal(
        (await deferred.host.store.snapshot()).entries.filter(
            (row) => row.locator.channelId === "m3u-epg:News"
        ).length,
        0,
        "remove before first migration must not resurrect the legacy favorite"
    );
    await deferred.host.add({ __ottGlobalChannel: 7 });
    assert.equal(
        (await deferred.host.store.snapshot()).entries.filter(
            (row) => row.locator.channelId === "m3u-epg:News"
        ).length,
        1,
        "explicit add after removal remains available"
    );
    assert.equal(
        (await deferred.host.add({ __ottGlobalChannel: 7 })).changed,
        false
    );
    deferred.host.dispose();
    const menus = await seededPlayableFixture("Explicit menu item");
    const item = { __ottGlobalChannel: 7 };
    assert.equal(
        (await menus.host.add(item)).changed,
        false,
        "add existing is a no-op"
    );
    assert.equal((await menus.host.remove(item)).changed, true);
    assert.equal(
        (await menus.host.remove(item)).changed,
        false,
        "remove absent never adds"
    );
    assert.equal((await menus.host.add(item)).changed, true);
    assert.equal(
        (await menus.host.add(item)).changed,
        false,
        "repeat add never removes"
    );
    assert.equal((await menus.host.store.snapshot()).entries.length, 1);
    assert.deepEqual(
        menus.toggles,
        [
            ["Explicit menu item", false],
            ["Explicit menu item", true],
        ],
        "only persisted changes emit one confirmation each"
    );
    const protectedRaw = new Map(menus.data);
    await assert.rejects(menus.host.remove(item, () => false));
    assertRawUnchanged(menus, protectedRaw);
    menus.w.keys.YELLOW = 405;
    menus.w.keys.TOOLS = 84;
    menus.w.keys.N0 = 48;
    await menus.host.open();
    const shown = menus.shown.at(-1);
    assert.equal(shown.actions, "Favorites: −");
    const beforeMenuRemove = (await menus.host.store.snapshot()).entries;
    const selectedMenuId = shown.rows[shown.selected];
    assert(beforeMenuRemove.some((row) => row.id === selectedMenuId));
    assert.equal(shown.key(menus.w.keys.YELLOW), true);
    for (let turn = 0; turn < 20; turn++) await new Promise(setImmediate);
    assert.deepEqual(
        Array.from(
            (await menus.host.store.snapshot()).entries,
            (row) => row.id
        ),
        Array.from(
            beforeMenuRemove.filter((row) => row.id !== selectedMenuId),
            (row) => row.id
        ),
        "global view action removes only the selected UUID, preserving migrated entries"
    );
    assert.equal(
        shown.key(menus.w.keys.YELLOW),
        false,
        "stale repeated remove cannot affect another row"
    );
    menus.w.sFavorites = -1;
    await menus.host.open();
    assert.equal(
        menus.shown.at(-1).actions,
        false,
        "editing-disabled list does not advertise remove"
    );
    menus.host.dispose();
    const literal = "<b>A & B</b> &amp;";
    const toggleFixture = await seededPlayableFixture(literal);
    await toggleFixture.host.toggle();
    await toggleFixture.host.toggle();
    assert.deepEqual(
        toggleFixture.toggles,
        [
            [literal, false],
            [literal, true],
        ],
        "one confirmed removal/addition notification with the unmodified title"
    );
    const refusedBefore = new Map(toggleFixture.data),
        refusedWrites = toggleFixture.writes.length;
    toggleFixture.failWrites("conflict");
    await assert.rejects(toggleFixture.host.toggle(), /storage_unavailable/);
    assertRawUnchanged(toggleFixture, refusedBefore);
    assert.equal(toggleFixture.writes.length, refusedWrites);
    assert.equal(
        toggleFixture.toggles.length,
        2,
        "refused persistence emits no success"
    );
    toggleFixture.failWrites("unknown");
    await assert.rejects(toggleFixture.host.toggle(), /storage_unavailable/);
    assert.equal(
        toggleFixture.toggles.length,
        2,
        "uncertain persistence emits no success or rollback claim"
    );
    toggleFixture.host.dispose();
    const byteFixture = fixture();
    for (const request of [
        { text: "ASCII" },
        { text: "Привет 世界 😀" },
        { text: "\ud800" },
    ]) {
        assert.equal(
            byteFixture.host.requestBytes(request),
            Buffer.byteLength(JSON.stringify(request), "utf8")
        );
    }
    assert.equal(byteFixture.host.requestBytes("a".repeat(16382)), 16384);
    assert.equal(byteFixture.host.requestBytes("a".repeat(16383)), 16385);
    const circular = {};
    circular.self = circular;
    assert.throws(() => byteFixture.host.requestBytes(circular));
    assert.throws(() => byteFixture.host.requestBytes(undefined));
    assert.throws(() => byteFixture.host.requestBytes("a".repeat(1048576)));
    const originalRequestBytes = byteFixture.host.requestBytes;
    const originalCreateItems = byteFixture.host.createItems;
    async function invokeByteWrapper(kind, request, missingMethod = false) {
        const seen = [];
        const execute = (_params, count) => {
            seen.push(count);
            return Promise.resolve(
                count > 16384
                    ? { error: "envelope_too_large" }
                    : { accepted: true }
            );
        };
        byteFixture.host.requestBytes = missingMethod
            ? undefined
            : originalRequestBytes;
        byteFixture.host.createItems = () => ({ execute, cancel() {} });
        const w = {
            __ottGlobalFavorites: byteFixture.host,
            __ottGlobalFavoritesFacade: byteFixture.host.facade,
            __ottGlobalFavoritesPorts: byteFixture.hostPorts,
            __ottGlobalFavoritesProtocol: { execute },
            __ottGlobalFavoritesRecovery: {
                execute(value) {
                    seen.push(value);
                    return Promise.resolve({ accepted: true });
                },
            },
        };
        const module = byteFixture.load(
            "src/commands/remote-favorites-global" +
                (kind === "core" ? "" : "-" + kind) +
                ".ts"
        );
        const dispatch =
            kind === "core"
                ? module.executeGlobalFavorites
                : kind === "items"
                  ? module.executeGlobalFavoritesItems
                  : module.executeGlobalFavoritesRecovery;
        const reply = await new Promise((resolve, reject) => {
            let settled = false;
            const timer = setTimeout(() => {
                settled = true;
                reject(new Error("wrapper callback was not delivered"));
            }, 2000);
            try {
                dispatch(w, "runtime-one", request, (value) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    resolve(value);
                });
            } catch (error) {
                settled = true;
                clearTimeout(timer);
                reject(error);
            }
        });
        return { reply, seen };
    }
    function byteRequest(size) {
        const request = {
            params: { op: "describe", runtime: "runtime-one" },
            expires_at: Date.now() / 1000 + 60,
            padding: "😀界",
        };
        request.padding += "a".repeat(
            size - Buffer.byteLength(JSON.stringify(request), "utf8")
        );
        assert.equal(Buffer.byteLength(JSON.stringify(request), "utf8"), size);
        return request;
    }
    for (const kind of ["core", "items", "recovery"]) {
        const exact = await invokeByteWrapper(kind, byteRequest(16384));
        assert.equal(exact.reply.status, "ok");
        assert.equal(exact.seen.length, 1);
        if (kind !== "recovery") assert.equal(exact.seen[0], 16384);
        const over = await invokeByteWrapper(kind, byteRequest(16385));
        assert.equal(over.reply.data.error, "envelope_too_large");
        assert.equal(over.seen.length, kind === "recovery" ? 0 : 1);
        if (kind !== "recovery") assert.equal(over.seen[0], 16385);
        for (const invalid of ["cycle", "undefined", "missing"]) {
            const request = byteRequest(256);
            if (invalid === "cycle") request.cycle = request;
            if (invalid === "undefined") request.toJSON = () => undefined;
            const bad = await invokeByteWrapper(
                kind,
                request,
                invalid === "missing"
            );
            assert.equal(
                bad.reply.data.error,
                kind === "recovery" ? "invalid_request" : "envelope_too_large"
            );
            assert.equal(bad.seen.length, kind === "recovery" ? 0 : 1);
            if (kind !== "recovery") assert.equal(bad.seen[0], 16385);
        }
    }
    byteFixture.host.requestBytes = originalRequestBytes;
    byteFixture.host.createItems = originalCreateItems;
    byteFixture.host.dispose();
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
    const manualItem = (await f.host.currentItem()).entry;
    assert.equal(
        manualItem.origin.sourceAlias,
        imported.origin.sourceAlias,
        "manual entry uses the verified profile binding, not prior playback provenance"
    );
    assert.equal(
        manualItem.locator.channelId,
        "m3u-epg:Other",
        "manual switch still captures the newly selected content"
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
