const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
const { fixture: originalMediaFixture } = require("./test_port_vod.cjs");
function mediaFixture() {
    const value = originalMediaFixture();
    value.catalogs[""][0].id = "stable-default";
    return value;
}
const remoteTransferDependency = require("./helpers/remote-transfer-dependency.cjs");
const {
    fixture: sharedFixture,
    load: sharedLoad,
    hash,
} = require("./global-favorites-fixture.cjs");
const plain = (value) => JSON.parse(JSON.stringify(value));
function compile(file) {
    const code = ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
    }).outputText;
    acorn.parse(code, { ecmaVersion: 5 });
    return code;
}
const code = compile("src/commands/remote-favorites.ts");
let passed = 0;
const scenarios = [];
function scenario(name, run) {
    scenarios.push({ name, run });
}
async function flush() {
    for (let n = 0; n < 100; n++) await Promise.resolve();
}
function fixture(storage = {}) {
    let config = {
        active: 0,
        M3Us: [
            { name: "One", www: "first" },
            { name: "Two", www: "second" },
        ],
    };
    let generation = 1;
    let state;
    let nextTimer = 0;
    const timers = new Map();
    const plays = [];
    const legacyReplies = [];
    const w = {
        __ottClassicPlayback: { snapshot: () => plain(state) },
        __ottCommandChannelLoad: {},
        __ottKiosk: { enabled: () => !!w.locked },
        __ottParental: { needs: (area) => !!w.pin && area !== "channels" },
        __ottPlex: { configuredSource: () => "plex:account" },
        __ottSourceIdentity: {
            current: () => source(),
            media: () => source() + ":media",
        },
        addToFavorites(id) {
            w.lastFavorite = id;
        },
        clearTimeout(id) {
            timers.delete(id);
        },
        commandChannelsReady: true,
        Date,
        exports: {},
        hasParentalLock: () => false,
        JSON,
        Math,
        Object,
        playChannel(cat, index, _fullscreen, admit) {
            if (!admit()) return false;
            const id = w.cats[w.catsArray[cat]][index];
            plays.push({
                itemId: w.channels[id].itemId,
                profile: config.active,
                source: source(),
            });
            state = {
                generation: ++generation,
                phase: "playing",
                target: {
                    channelId: String(id),
                    kind: "live",
                    sourceId: source(),
                },
            };
            return true;
        },
        providerGetItem: (key) => storage["provider:" + key] ?? null,
        providerGetPersistedItem: (key) => storage["provider:" + key] ?? null,
        saveChannelsCats() {
            storage["provider:favoritesLibrary:" + source()] = JSON.stringify({
                itemId: w.channels[w.lastFavorite].itemId,
            });
        },
        setTimeout(fn, ms) {
            const id = ++nextTimer;
            timers.set(id, { fn, ms });
            return id;
        },
        stbGetItem: (key) => storage[key] ?? null,
        stbGetPersistedItem: (key) => storage[key] ?? null,
        stbSetItem: (key, value) => {
            storage[key] = value;
        },
        window: null,
    };
    function source() {
        return (
            w.__ottActiveProviderDriver.id +
            ":" +
            config.active +
            "@" +
            config.M3Us[config.active].www
        );
    }
    const driver = {
        configuration: () => plain(config),
        fixedSlot: () => -1,
        id: "m3u",
    };
    w.__ottActiveProviderDriver = driver;
    function catalog() {
        w.channels = {
            42: {
                channel_name: "Channel " + config.active,
                itemId: "stable:" + config.active,
            },
        };
        w.cats = { All: [42] };
        w.catsArray = ["All"];
    }
    function selectProfile(number) {
        config.active = number - 1;
        w.__ottCommandChannelLoad = {};
        w.commandChannelsReady = false;
        catalog();
        if (!w.delay) w.commandChannelsReady = true;
    }
    catalog();
    state = {
        generation,
        phase: "playing",
        target: { channelId: "42", kind: "live", sourceId: source() },
    };
    w.window = w;
    const checkProviderUrl =
        require("./helpers/global-favorites-main-ports.cjs").createMainPorts(w)
            .providerModule.checkProviderUrl;
    w.require = (name) => {
        if (name === "./remote-favorites-contract")
            return {
                remoteFavoritesCapability: {
                    operations: ["list", "add", "remove", "play"],
                },
            };
        if (name === "../utils/caseless")
            return { caselessKey: (value) => value.toLowerCase() };
        if (name === "../provider")
            return {
                checkProviderUrl,
                isProviderAllowed: () => !w.denied,
                providerIds: ["m3u", "stalker"],
                selectProviderByIndex(index) {
                    w.__ottActiveProviderDriver = {
                        ...driver,
                        id: ["m3u", "stalker"][index],
                    };
                    w.__ottCommandChannelLoad = {};
                    return true;
                },
            };
        if (name === "./remote-profiles")
            return {
                handleRemoteProfiles(request, done) {
                    selectProfile(request.params.number);
                    done({ status: "ok" });
                },
            };
        if (name === "./remote-plex")
            return {
                remotePlexQueue: () => ({
                    execute(request, done) {
                        plays.push(plain(request));
                        done({ data: { state: "playing" }, status: "ok" });
                    },
                }),
            };
        const actual = remoteTransferDependency(name, w, {
            clearTimeout: w.clearTimeout,
            Date,
            Math,
            setTimeout: w.setTimeout,
        });
        if (actual) return actual;
        throw new Error(name);
    };
    vm.runInNewContext(compile("src/channels/channel-references.ts"), w);
    vm.runInNewContext(code, w);
    const shared = sharedFixture();
    shared.data.has = (key) => Object.hasOwn(storage, key);
    shared.data.get = (key) => storage[key];
    shared.data.set = (key, value) => {
        storage[key] = value;
        return shared.data;
    };
    shared.grant.read = (key) => {
        const physical = w.stbGetPersistedItem(key),
            logical = w.stbGetItem(key);
        if (physical !== logical) throw Error("storage_unavailable");
        return physical;
    };
    let serial = 0;
    const facade = sharedLoad(
        "src/settings/global-favorites-facade.ts"
    ).createGlobalFavoritesFacade({
        capture: async () => {
            throw Error("unsupported_item");
        },
        captureLegacy: async () => w.exports.captureLegacyCurrentFavorite(w),
        caselessKey: sharedLoad("src/utils/caseless.ts").caselessKey,
        codec: shared.codec,
        current: () => true,
        locatorKinds: ["channel"],
        playEntry: () => {
            throw Error("unexpected portable alias");
        },
        playLegacy(entry, current) {
            let cancel, resolve;
            const result = new Promise((done) => {
                resolve = done;
            });
            cancel = w.exports.executeLegacyFavoriteTarget(
                w,
                "runtime-test",
                {
                    action: "favorites",
                    params: {
                        id: entry.id,
                        op: "play",
                        runtime: "runtime-test",
                    },
                },
                (reply) => {
                    legacyReplies.push(plain(reply));
                    resolve(
                        w.rewriteLegacyReply
                            ? w.rewriteLegacyReply(reply)
                            : reply
                    );
                },
                entry
            );
            if (!current() && cancel) cancel();
            return {
                cancel: () => {
                    if (cancel) cancel();
                },
                result,
            };
        },
        qualify: () => shared.committer.qualify(),
        sha256: async (value) => hash(value),
        store: shared.store,
        uuid: () =>
            `30000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`,
    });
    w.__ottGlobalFavoritesFacade = facade;
    w.__ottGlobalFavoritesPorts = { runtime: () => "runtime-test" };
    async function call(op, extra = {}) {
        const replies = [];
        const cancel = w.exports.executeRemoteFavorites(
            w,
            "runtime-test",
            {
                action: "favorites",
                params: { op, runtime: "runtime-test", ...extra },
            },
            (value) => replies.push(plain(value))
        );
        await flush();
        return {
            cancel,
            replies,
            get result() {
                return replies.at(-1);
            },
        };
    }
    return {
        call,
        catalog,
        config,
        legacyReplies,
        plays,
        selectProfile,
        get state() {
            return state;
        },
        set state(value) {
            generation = value.generation;
            state = value;
        },
        storage,
        async tick() {
            const row = [...timers].find(([, item]) => item.ms === 50);
            assert(row);
            timers.delete(row[0]);
            row[1].fn();
            await flush();
        },
        async timeout() {
            const row = [...timers].find(([, item]) => item.ms > 100);
            assert(row);
            timers.delete(row[0]);
            row[1].fn();
            await flush();
        },
        w,
    };
}
scenario("runtime and strict request grammar", async () => {
    const f = fixture();
    for (const extra of [
        { runtime: "wrong" },
        { extra: 1 },
        { name: " " },
        { name: "x".repeat(161) },
    ])
        assert.equal(
            (await f.call("add", extra)).result.data.error,
            "invalid_request"
        );
    assert.equal(
        (await f.call("play", { id: "fav-one", query: "One" })).result.data
            .error,
        "invalid_request"
    );
});
scenario(
    "current playback, not browsed selection; stable reference and idempotent add",
    async () => {
        const f = fixture();
        f.w.primaryIndex = 44;
        f.w.curList = [999];
        const first = (await f.call("add")).result;
        assert.equal(first.status, "ok");
        assert.equal(first.data.entry.title, "Channel 0");
        assert.equal(first.data.created, true);
        assert.deepEqual(
            JSON.parse(f.storage["remoteFavorites.v1"]).legacy[0].ref,
            { itemId: "stable:0" }
        );
        const again = (await f.call("add", { name: "  My favorite  " })).result;
        assert.equal(again.data.created, false);
        assert.equal(again.data.entry.id, first.data.entry.id);
        assert.equal(again.data.entry.name, "My favorite");
        assert.equal((await f.call("list")).result.data.entries.length, 1);
        assert(!JSON.stringify(first).includes("stable:"));
    }
);
scenario(
    "durable index survives recreation and excludes stream URLs",
    async () => {
        const f = fixture();
        f.w.channels[42].url = "https://temporary.invalid/token";
        const entry = (await f.call("add")).result.data.entry;
        const other = fixture(f.storage);
        assert.equal(
            (await other.call("list")).result.data.entries[0].id,
            entry.id
        );
        assert.equal(
            (await other.call("play", { id: entry.id })).result.status,
            "ok"
        );
        assert.equal(other.plays[0].itemId, "stable:0");
        assert(!f.storage["remoteFavorites.v1"].includes("temporary"));
    }
);
scenario(
    "same numeric channel on different profile waits for catalog and resolves saved stable ID",
    async () => {
        const f = fixture();
        const a = (await f.call("add", { name: "One" })).result.data.entry;
        f.selectProfile(2);
        f.w.commandChannelsReady = true;
        f.state = {
            generation: 2,
            phase: "playing",
            target: { channelId: "42", kind: "live", sourceId: "m3u:1@second" },
        };
        const b = (await f.call("add", { name: "Two" })).result.data.entry;
        f.w.delay = true;
        const play = await f.call("play", { id: a.id });
        assert.equal(play.replies.length, 0);
        assert.equal(f.plays.length, 0);
        f.w.commandChannelsReady = true;
        await f.tick();
        assert.equal(play.result.status, "ok");
        assert.equal(f.plays[0].itemId, "stable:0");
        const next = await f.call("play", { id: b.id });
        f.w.commandChannelsReady = true;
        await f.tick();
        assert.equal(next.result.status, "ok");
        assert.equal(f.plays[1].itemId, "stable:1");
    }
);
scenario(
    "reconfigured profile, removed stable item and ambiguous item fail closed",
    async () => {
        let f = fixture();
        const a = (await f.call("add")).result.data.entry;
        f.config.M3Us[0].www = "replacement";
        assert.equal(
            (await f.call("play", { id: a.id })).result.data.error,
            "profile_changed"
        );
        assert.equal(f.plays.length, 0);
        f = fixture();
        const b = (await f.call("add")).result.data.entry;
        f.w.channels[42].itemId = "other";
        assert.equal(
            (await f.call("play", { id: b.id })).result.data.error,
            "item_unavailable"
        );
        f.w.channels[42].itemId = "stable:0";
        f.w.channels[43] = { itemId: "stable:0", name: "collision" };
        assert.equal(
            (await f.call("play", { id: b.id })).result.data.error,
            "item_unavailable"
        );
    }
);
scenario(
    "source changes and cancellation while loading never launch",
    async () => {
        for (const event of ["load", "driver", "cancel", "timeout"]) {
            const f = fixture();
            const entry = (await f.call("add")).result.data.entry;
            f.selectProfile(2);
            f.w.commandChannelsReady = true;
            f.w.delay = true;
            const play = await f.call("play", { id: entry.id });
            if (event === "cancel") play.cancel();
            else if (event === "timeout") await f.timeout();
            else {
                if (event === "load") f.w.__ottCommandChannelLoad = {};
                else
                    f.w.__ottActiveProviderDriver = {
                        ...f.w.__ottActiveProviderDriver,
                    };
                await f.tick();
            }
            assert.equal(play.replies.length, 1);
            assert.equal(play.result.status, "rejected");
            assert.equal(f.plays.length, 0);
        }
    }
);
scenario(
    "archive, idle, malformed storage, memory-only storage, policy and duplicate names",
    async () => {
        let f = fixture();
        f.state.target.kind = "archive";
        assert.equal(
            (await f.call("add")).result.data.error,
            "unsupported_item"
        );
        f = fixture();
        f.state.phase = "idle";
        assert.equal(
            (await f.call("add")).result.data.error,
            "no_current_item"
        );
        f = fixture({ "remoteFavorites.v1": "{" });
        assert.equal(
            (await f.call("list")).result.data.error,
            "storage_unavailable"
        );
        f = fixture();
        f.w.stbGetPersistedItem = () => null;
        assert.equal(
            (await f.call("add")).result.data.error,
            "storage_unavailable"
        );
        f = fixture();
        f.w.locked = true;
        assert.equal((await f.call("add")).result.data.error, "policy_denied");
        f = fixture();
        f.w.pin = true;
        assert.equal((await f.call("add")).result.data.error, "policy_denied");
    }
);
scenario("query and remove affect only selected index entry", async () => {
    const f = fixture();
    const a = (await f.call("add", { name: "Три кота" })).result.data.entry;
    assert.equal((await f.call("play", { query: "КОТА" })).result.status, "ok");
    assert.equal(
        (await f.call("remove", { id: a.id })).result.data.removed,
        true
    );
    assert.equal((await f.call("list")).result.data.entries.length, 0);
    assert.equal(
        (await f.call("play", { id: a.id })).result.data.error,
        "favorite_not_found"
    );
});
scenario(
    "Plex overlay retains current TV profile and validates separate media account",
    async () => {
        const f = fixture();
        const ref = { itemId: "provider:123", sourceId: "plex:account" };
        f.state = {
            generation: 2,
            phase: "playing",
            target: {
                channelId: ref.itemId,
                kind: "vod",
                sourceId: ref.sourceId,
            },
        };
        f.w.__ottMedia = {
            captureFavorite: () => ({ ref, title: "Film" }),
            current: () => ({
                context: {},
                payload: {
                    plexSource: ref.sourceId,
                    request: { path: "/library/metadata/123" },
                },
                ref,
            }),
        };
        const entry = (await f.call("add")).result.data.entry;
        assert.equal(entry.provider, "m3u");
        assert.equal(entry.profile_number, 1);
        assert.equal(
            (await f.call("play", { id: entry.id })).result.status,
            "ok"
        );
        assert.deepEqual(f.plays[0].params.ids, ["123"]);
        f.w.__ottPlex.configuredSource = () => "plex:another";
        assert.equal(
            (await f.call("play", { id: entry.id })).result.data.error,
            "profile_changed"
        );
    }
);
scenario(
    "real media journal adds current item, not browsed item, and strips temporary URL",
    async () => {
        const c = mediaFixture();
        c.providerGetPersistedItem = c.providerGetItem;
        c.mediaList(null);
        c.selectMedia(0);
        const playing = c.__ottMedia.current();
        assert(playing);
        c.mediaList(null);
        const result = c.__ottMedia.captureFavorite();
        assert(result);
        assert.equal(result.ref.itemId, playing.ref.itemId);
        const saved = c.documentState().favorites[0];
        assert.equal(saved.payload.stream_url, undefined);
        assert.equal(
            c.__ottMedia.captureFavorite().ref.itemId,
            result.ref.itemId
        );
        assert.equal(c.documentState().favorites.length, 1);
        c.catalogs[""][0].stream_url = "fresh-after-restart.mp4";
        let done;
        assert.equal(
            c.__ottMedia.playFavorite(
                result.ref,
                () => true,
                (ok) => {
                    done = ok;
                }
            ),
            true
        );
        assert.equal(done, true);
        assert(
            c.calls.some(
                (row) =>
                    row[0] === "play" && row[1] === "fresh-after-restart.mp4"
            )
        );
    }
);
scenario(
    "real media persistence fails if only memory readback exists",
    async () => {
        const c = mediaFixture();
        c.providerGetPersistedItem = () => null;
        c.mediaList(null);
        c.selectMedia(0);
        assert.equal(c.__ottMedia.captureFavorite(), null);
    }
);
scenario(
    "persisted storage is authoritative and a refused same-channel dispatch never succeeds",
    async () => {
        const f = fixture();
        const saved = (await f.call("add")).result.data.entry;
        f.w.stbGetPersistedItem = () => null;
        assert.equal(
            (await f.call("list")).result.data.error,
            "storage_unavailable"
        );
        assert.equal(
            (await f.call("play", { id: saved.id })).result.data.error,
            "storage_unavailable"
        );
        f.w.stbGetPersistedItem = f.w.stbGetItem;
        f.w.playChannel = () => false;
        assert.equal(
            (await f.call("play", { id: saved.id })).result.data.error,
            "playback_failed"
        );
    }
);
scenario(
    "remove does not need an active profile and profile URL lock prevents switching",
    async () => {
        const f = fixture();
        const entry = (await f.call("add")).result.data.entry;
        f.selectProfile(2);
        f.w.commandChannelsReady = true;
        f.w.__ottActiveProviderDriver.fixedSlot = () => 1;
        assert.equal(
            (await f.call("play", { id: entry.id })).result.data.error,
            "policy_denied"
        );
        f.w.__ottActiveProviderDriver = null;
        f.w.commandChannelsReady = false;
        assert.equal(
            (await f.call("remove", { id: entry.id })).result.status,
            "ok"
        );
    }
);

scenario(
    "finite channel favorites acknowledge dispatch without canceling media loading",
    async () => {
        const f = fixture();
        const saved = (await f.call("add")).result.data.entry;
        f.w.__ottActiveProviderDriver.capabilities = { mediaPlaylist: true };
        f.w.channels[42].__ottMediaItem = { request: { id: 42 } };
        f.w.closeList = () => {
            throw new Error("Do not cancel the pending media resolver");
        };
        let postSelection;
        f.w.playChannel = (
            category,
            index,
            fullscreen,
            admit,
            _resume,
            _background,
            _fromStart,
            _committed,
            current
        ) => {
            assert.equal(admit(), true);
            postSelection = current;
            f.w.curList = f.w.cats[f.w.catsArray[category]];
            f.w.primaryIndex = index;
            return true;
        };
        const response = (await f.call("play", { id: saved.id })).result;
        assert.equal(response.status, "ok");
        assert.equal(response.data.state, "dispatched");
        assert.equal(response.data.dispatched, true);
        assert.equal(
            postSelection(),
            true,
            "successful dispatch ACK retains pending source authority"
        );
        f.w.pin = true;
        assert.equal(
            postSelection(),
            false,
            "later settings/provider PIN policy blocks resolution"
        );
        f.w.pin = false;
        f.w.Date = { now: () => Date.now() + 120000 };
        assert.equal(
            postSelection(),
            false,
            "pending finite resolution cannot outlive request deadline"
        );
        f.w.Date = Date;
        assert.equal(postSelection(), true);
        f.w.playChannel = () => false;
        assert.equal(
            (await f.call("play", { id: saved.id })).result.data.error,
            "playback_failed"
        );
    }
);
scenario(
    "generic media completion closes overlays and cancellation runs before a reentrant reply",
    async () => {
        const f = fixture();
        const ref = { itemId: "provider:9", sourceId: "m3u:0@first:media" };
        f.state = {
            generation: 2,
            phase: "playing",
            target: {
                channelId: ref.itemId,
                kind: "vod",
                sourceId: ref.sourceId,
            },
        };
        let completion,
            cancelled = 0,
            closed = 0;
        f.w.closeList = (restore) => {
            assert.equal(restore, false);
            closed++;
        };
        f.w.__ottMedia = {
            cancelAuto() {
                cancelled++;
            },
            captureFavorite: () => ({ ref, title: "Film" }),
            current: () => ({ payload: { request: { id: 9 } }, ref }),
            playFavorite(_ref, guard, done) {
                assert(guard());
                completion = done;
                return true;
            },
        };
        const entry = (await f.call("add")).result.data.entry;
        const play = await f.call("play", { id: entry.id });
        completion(true);
        await flush();
        assert.equal(play.result.status, "ok");
        assert.equal(closed, 1);
        let response, reentrantList;
        const stop = f.w.exports.executeRemoteFavorites(
            f.w,
            "runtime-test",
            { params: { id: entry.id, op: "play", runtime: "runtime-test" } },
            (value) => {
                assert.equal(
                    cancelled,
                    1,
                    "the old owner is cancelled before reply can admit new work"
                );
                response = value;
                reentrantList = f.call("list");
            }
        );
        await flush();
        stop();
        await flush();
        assert.equal(response.data.error, "cancelled");
        assert.equal((await reentrantList).result.status, "ok");
    }
);
scenario(
    "real media missing or ambiguous identity fails rather than using old URL",
    async () => {
        for (const ambiguous of [false, true]) {
            const c = mediaFixture();
            c.providerGetPersistedItem = c.providerGetItem;
            c.catalogs[""][0].id = "stable-media";
            c.mediaList(null);
            c.selectMedia(0);
            const saved = c.__ottMedia.captureFavorite();
            assert(saved);
            c.catalogs[""] = ambiguous
                ? [c.catalogs[""][0], c.catalogs[""][0]]
                : [];
            const before = c.calls.filter((row) => row[0] === "play").length;
            let result;
            assert.equal(
                c.__ottMedia.playFavorite(
                    saved.ref,
                    () => true,
                    (ok) => {
                        result = ok;
                    }
                ),
                true
            );
            assert.equal(result, false);
            assert.equal(
                c.calls.filter((row) => row[0] === "play").length,
                before
            );
        }
    }
);
scenario(
    "shared favorite contract matches player capability and error enum",
    async () => {
        const contract = JSON.parse(
            fs.readFileSync("contracts/favorites-v1.json", "utf8")
        );
        const module = {};
        vm.runInNewContext(
            compile("src/commands/remote-favorites-contract.ts"),
            { exports: module }
        );
        assert.equal(
            module.remoteFavoritesCapability.max_items,
            contract.max_items
        );
        assert.deepEqual(
            plain(module.remoteFavoritesCapability.operations),
            contract.operations
        );
        for (const match of fs
            .readFileSync("src/commands/remote-favorites.ts", "utf8")
            .matchAll(/(?:finish|fail)\("([a-z_]+)"/g))
            assert(contract.errors.includes(match[1]), match[1]);
    }
);
scenario(
    "real media favorite survives runtime recreation and resolves current provider URL",
    async () => {
        const first = mediaFixture();
        first.providerGetPersistedItem = first.providerGetItem;
        first.catalogs[""][0].id = "stable-movie";
        first.mediaList(null);
        first.selectMedia(0);
        const saved = first.__ottMedia.captureFavorite();
        assert(saved);
        const second = mediaFixture();
        second.providerGetPersistedItem = second.providerGetItem;
        Object.assign(second.stored, first.stored);
        second.catalogs[""][0].id = "stable-movie";
        second.catalogs[""][0].stream_url = "resolved-in-new-runtime.mp4";
        let result;
        assert.equal(
            second.__ottMedia.playFavorite(
                saved.ref,
                () => true,
                (ok) => {
                    result = ok;
                }
            ),
            true
        );
        assert.equal(result, true);
        assert(
            second.calls.some(
                (row) =>
                    row[0] === "play" &&
                    row[1] === "resolved-in-new-runtime.mp4"
            )
        );
    }
);
scenario(
    "current parental channel and media policies apply before persistence",
    async () => {
        const f = fixture();
        f.w.hasParentalLock = () => true;
        f.w.__ottParental.needs = (area) => area === "channels";
        assert.equal((await f.call("add")).result.data.error, "policy_denied");
        assert.equal(f.storage["remoteFavorites.v1"], undefined);
    }
);
scenario(
    "saved healthy profile recovers from a current failed catalog",
    async () => {
        const f = fixture();
        const saved = (await f.call("add")).result.data.entry;
        f.selectProfile(2);
        f.w.commandChannelsReady = false;
        const reply = (await f.call("play", { id: saved.id })).result;
        assert.equal(reply.status, "ok");
        assert.equal(f.plays[0].profile, 0);
    }
);
scenario("unstable title-occurrence movie references are refused", async () => {
    const c = originalMediaFixture();
    c.providerGetPersistedItem = c.providerGetItem;
    c.catalogs[""] = [
        { stream_url: "first.mp4", title: "Same" },
        { stream_url: "second.mp4", title: "Same" },
    ];
    c.mediaList(null);
    c.selectMedia(0);
    const ref = c.__ottMedia.current().ref;
    assert(ref.itemId.startsWith("catalog:"));
    assert.equal(c.__ottMedia.captureFavorite(), null);
    c.catalogs[""].reverse();
    assert.equal(
        c.__ottMedia.playFavorite(
            ref,
            () => true,
            () => assert.fail("must not dispatch")
        ),
        false
    );
});
scenario(
    "fresh media adult metadata and delayed policy changes are checked before dispatch",
    async () => {
        for (const delayed of [false, true]) {
            const c = mediaFixture();
            c.providerGetPersistedItem = c.providerGetItem;
            c.mediaList(null);
            c.selectMedia(0);
            const saved = c.__ottMedia.captureFavorite();
            assert(saved);
            c.catalogs[""][0].adult = 1;
            let locked = !delayed,
                pending;
            c.__ottParental = { needs: () => locked };
            if (delayed)
                c.providerMediaClient = {
                    cancel() {},
                    resolve(payload, done) {
                        pending = () =>
                            done({ ...payload, stream_url: "adult.mp4" });
                    },
                };
            const before = c.calls.filter((row) => row[0] === "play").length;
            let result;
            assert.equal(
                c.__ottMedia.playFavorite(
                    saved.ref,
                    () => true,
                    (ok) => {
                        result = ok;
                    }
                ),
                true
            );
            if (delayed) {
                assert(pending);
                locked = true;
                pending();
            }
            assert.equal(result, false);
            assert.equal(
                c.calls.filter((row) => row[0] === "play").length,
                before
            );
            assert(!c.calls.some((row) => row[0] === "pin"));
        }
    }
);
scenario(
    "VOD without a durable resolver reports unsupported, not storage failure",
    async () => {
        const f = fixture();
        const ref = { itemId: "provider:9", sourceId: "m3u:0@first:media" };
        f.state = {
            generation: 2,
            phase: "playing",
            target: {
                channelId: ref.itemId,
                kind: "vod",
                sourceId: ref.sourceId,
            },
        };
        f.w.__ottMedia = { current: () => ({ payload: {}, ref }) };
        assert.equal(
            (await f.call("add")).result.data.error,
            "unsupported_item"
        );
        f.w.__ottMedia.current = () => ({
            payload: { request: { id: 9 } },
            ref,
        });
        assert.equal((await f.call("add")).result.data.error, "unsupported");
    }
);
scenario(
    "shared facade preserves actual legacy callback errors and fences unknown codes",
    async () => {
        for (const cause of [
            "profile_changed",
            "item_unavailable",
            "timeout",
            "unknown",
        ]) {
            const f = fixture();
            const saved = (await f.call("add")).result.data.entry;
            if (cause === "profile_changed")
                f.config.M3Us[0].www = "replacement";
            else if (cause === "timeout") {
                f.selectProfile(2);
                f.w.commandChannelsReady = true;
                f.w.delay = true;
            } else {
                f.w.channels[42].itemId = "different-item";
                if (cause === "unknown")
                    f.w.rewriteLegacyReply = (reply) => ({
                        ...reply,
                        data: { ...reply.data, error: "private_codec_error" },
                    });
            }
            const call = await f.call("play", { id: saved.id });
            if (cause === "timeout") await f.timeout();
            const original = f.legacyReplies.at(-1);
            assert.equal(original.status, "rejected");
            assert.equal(
                original.data.error,
                cause === "unknown" ? "item_unavailable" : cause
            );
            assert.equal(call.result.status, "rejected");
            assert.equal(
                call.result.data.error,
                cause === "unknown" ? "playback_failed" : cause
            );
            assert.equal(f.plays.length, 0);
        }
    }
);
scenario(
    "shared legacy boundary maps actual private-store errors without writes",
    async () => {
        for (const failure of [
            "codec_error",
            "invalid_store",
            "invalid_legacy",
        ]) {
            const f = fixture();
            const saved = (await f.call("add")).result;
            assert.equal(saved.status, "ok");
            const document = JSON.parse(f.storage["remoteFavorites.v1"]);
            const malformed =
                failure === "codec_error"
                    ? '{"version":2,"entries":['
                    : failure === "invalid_store"
                      ? JSON.stringify({ ...document, version: 999 })
                      : JSON.stringify({
                            ...document,
                            legacy: [document.legacy[0], document.legacy[0]],
                        });
            f.storage["remoteFavorites.v1"] = malformed;
            const plays = f.plays.length;
            const reply = (await f.call("list")).result;
            assert.equal(reply.status, "rejected", failure);
            assert.equal(reply.data.error, "storage_unavailable", failure);
            assert.equal(
                f.storage["remoteFavorites.v1"],
                malformed,
                "failed read never repairs or rewrites"
            );
            assert.equal(f.plays.length, plays, "failed read never dispatches");
        }
    }
);
scenario("shared legacy boundary retains public business errors", async () => {
    const f = fixture();
    assert.equal(
        (await f.call("remove", { id: "fav-absent" })).result.data.error,
        "favorite_not_found"
    );
    f.w.locked = true;
    assert.equal((await f.call("add")).result.data.error, "policy_denied");
    f.w.locked = false;
    assert.equal(
        (await f.call("add", { name: " " })).result.data.error,
        "invalid_request"
    );
    assert.equal(f.storage["remoteFavorites.v1"], undefined);
});
scenario(
    "host without shared write capability preserves legacy reads and refuses mutations",
    async () => {
        const f = fixture();
        const captured = f.w.exports.captureLegacyCurrentFavorite(f.w).entry;
        captured.id = "fav-retained";
        f.storage["remoteFavorites.v1"] = JSON.stringify({
            entries: [captured],
            version: 1,
        });
        delete f.w.__ottGlobalFavoritesFacade;
        delete f.w.__ottGlobalFavoritesPorts;
        const before = f.storage["remoteFavorites.v1"];
        assert.equal(
            (await f.call("list")).result.data.entries[0].id,
            captured.id
        );
        assert.equal(
            (await f.call("play", { id: captured.id })).result.status,
            "ok"
        );
        assert.equal((await f.call("add")).result.data.error, "unsupported");
        assert.equal(
            (await f.call("remove", { id: captured.id })).result.data.error,
            "unsupported"
        );
        assert.equal(f.storage["remoteFavorites.v1"], before);
    }
);
async function main() {
    for (const { name, run } of scenarios) {
        await run();
        passed++;
        console.log("PASS " + name);
    }
    console.log(`PASS ${passed} remote favorites groups`);
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
