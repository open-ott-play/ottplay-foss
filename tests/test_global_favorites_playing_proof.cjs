"use strict";
const assert = require("node:assert/strict"),
    fs = require("node:fs"),
    vm = require("node:vm"),
    ts = require("typescript");
function moduleAt(file) {
    const exports = {};
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES5,
            },
        }).outputText,
        { exports, Promise, window: {} }
    );
    return exports;
}
const identities = moduleAt("src/media/global-favorites-identities.ts"),
    codec = moduleAt(
        "src/settings/global-favorites-portable.ts"
    ).createGlobalFavoritesPortableCodec();
const ast = ts.createSourceFile(
    "player.ts",
    fs.readFileSync("src/media/global-favorites-player.ts", "utf8"),
    ts.ScriptTarget.Latest,
    true
);
let declaration;
function find(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "capturePlayback")
        declaration = node;
    else ts.forEachChild(node, find);
}
find(ast);
assert(declaration);
function playbackState() {
    const source = ts.createSourceFile(
        "session.ts",
        fs.readFileSync("src/playback/session.ts", "utf8"),
        ts.ScriptTarget.Latest,
        true
    );
    const state = source.statements.find(
        (node) =>
            ts.isFunctionDeclaration(node) &&
            node.name?.text === "createPlaybackState"
    );
    assert(state);
    const scope = vm.createContext({});
    vm.runInContext(
        ts.transpileModule(state.getText(source), {
            compilerOptions: { target: ts.ScriptTarget.ES5 },
        }).outputText,
        scope
    );
    return scope.createPlaybackState(() => {});
}
function fixture(vod = false) {
    const driver = { id: "m3u" },
        load = {},
        request = { path: "/movie/42" };
    let state = {
        generation: 7,
        phase: "playing",
        target: { channelId: vod ? "movie42" : 7, sourceId: "source" },
    };
    const w = {
        __ottActiveProviderDriver: driver,
        __ottClassicPlayback: { snapshot: () => state },
        __ottCommandChannelLoad: load,
        __ottMedia: {
            current: () => ({
                payload: { request },
                ref: { itemId: "movie42", sourceId: "source" },
            }),
        },
        __ottSourceIdentity: { current: () => "source", media: () => "source" },
        _playSession: 11,
        channels: { 7: { __ottFavoriteTvgId: "stable", itemId: "stable" } },
    };
    const scope = vm.createContext({
        driver,
        expectedLoad: load,
        playbackItem: vod
            ? {
                  items: [{ request }],
                  locator: { id: "42", idField: "id", kind: "vportal-media" },
              }
            : {
                  id: 7,
                  locator: { channelId: "m3u-epg:stable", kind: "channel" },
              },
        source: "source",
        target: {
            current: () => true,
            origin: { subprofile: null },
            selector: {},
        },
        w,
        ...identities,
    });
    vm.runInContext(
        ts.transpileModule(declaration.getText(ast), {
            compilerOptions: { target: ts.ScriptTarget.ES5 },
        }).outputText,
        scope
    );
    return {
        change: (value) => (state = value),
        proof: scope.capturePlayback(),
        request,
        w,
    };
}
function mediaCatalogFixture(provider = "plex", rawRef = true) {
    // Native Plex lists use described payloads; whole-provider Plex/VPortal
    // catalogs retain the original record without describe()'s copied ref.
    const request =
        provider === "plex"
            ? { path: "/library/metadata/42" }
            : { cmd: "play", id: "episode-17" };
    const source = "media:" + provider;
    const ref = { itemId: "request:42", sourceId: source };
    const payload =
        provider === "plex"
            ? { plexSource: source, request }
            : {
                  __ottFavoriteId: { field: "id", value: "episode-17" },
                  __ottMediaCategories: [{ name: "Series" }],
                  request,
                  vportalSource: source,
              };
    if (rawRef) payload.__ottMediaRef = { ...ref };
    const media = {
        payload: { ...payload, request: { ...request } },
        ref: { ...ref },
    };
    const row = {
        __ottMediaItem: payload,
        channel_name: "Movie",
        logo: "",
        rec: 0,
    };
    const driver = {
            favoritesSource: () => ({
                current: () => true,
                serverId: "fixture-pms",
            }),
            id: provider,
        },
        load = {};
    const state = {
        generation: 9,
        phase: "playing",
        target: { channelId: ref.itemId, sourceId: source },
    };
    const w = {
        __ottActiveProviderDriver: driver,
        __ottClassicPlayback: { snapshot: () => state },
        __ottCommandChannelLoad: load,
        __ottMedia: { current: () => media },
        __ottSourceIdentity: {
            current: () => provider,
            media: () => source,
        },
        _playSession: 12,
        channels: { "plex-row-0": row },
    };
    const scope = vm.createContext({
        driver,
        expectedLoad: load,
        playbackItem: {
            id: "plex-row-0",
            locator:
                provider === "plex"
                    ? {
                          kind: "plex-media",
                          ratingKey: "42",
                          serverId: "fixture-pms",
                      }
                    : {
                          id: "episode-17",
                          idField: "id",
                          kind: "vportal-media",
                      },
        },
        source: provider,
        target: {
            current: () => true,
            origin: { subprofile: provider === "plex" ? null : "Series" },
            selector: {},
        },
        w,
        ...identities,
    });
    vm.runInContext(
        ts.transpileModule(declaration.getText(ast), {
            compilerOptions: { target: ts.ScriptTarget.ES5 },
        }).outputText,
        scope
    );
    return {
        capture: () => scope.capturePlayback(),
        media,
        payload,
        proof: scope.capturePlayback(),
        row,
        state,
        w,
    };
}
async function pausedCatalogEof(provider, invalidation) {
    const catalog = mediaCatalogFixture(provider, false),
        state = playbackState();
    state.open({
        channelId: catalog.media.ref.itemId,
        kind: "vod",
        sourceId: catalog.media.ref.sourceId,
    });
    state.phase("playing");
    catalog.w.__ottClassicPlayback.snapshot = state.snapshot;
    const proof = catalog.capture(),
        entry = {
            locator:
                provider === "plex"
                    ? {
                          kind: "plex-media",
                          ratingKey: "42",
                          serverId: "fixture-pms",
                      }
                    : {
                          id: "episode-17",
                          idField: "id",
                          kind: "vportal-media",
                      },
            origin: {
                profile: "Imported",
                provider,
                sourceAlias: "Alias",
                subprofile: null,
            },
            title: "Imported title",
        };
    const next = {
        ...entry,
        locator:
            provider === "plex"
                ? { ...entry.locator, ratingKey: "43" }
                : { ...entry.locator, id: "episode-18" },
        title: "Next",
    };
    assert.equal(
        codec.identity(entry),
        codec.identity({ ...entry, title: "Renamed" })
    );
    assert.notEqual(codec.identity(entry), codec.identity(next));
    let captured = true;
    const selections = [];
    const navigation = moduleAt(
        "src/media/global-favorites-navigation.ts"
    ).createGlobalFavoritesNavigation({
        allowed: () => true,
        cancel() {},
        capture: () =>
            captured && proof.current()
                ? { current: proof.current, id: "first", value: entry }
                : null,
        captureEnding: (generation) => {
            const current = proof.prepareEnded(generation);
            if (!current) return null;
            captured = false;
            return { current, id: "first", value: entry };
        },
        current: () => true,
        failed() {},
        identity: (value) =>
            codec.identity({
                locator: value.locator,
                origin: value.origin,
                title: value.title,
            }),
        select: (id) => {
            selections.push(id);
            return { cancel() {}, result: Promise.resolve({ status: "ok" }) };
        },
        snapshot: async () => ({
            current: () => true,
            entries: [
                { ...entry, id: "first" },
                { ...next, id: "next" },
            ],
        }),
    });
    navigation.routeState({ id: "first", phase: "playing" });
    const engineScope = { window: {} };
    vm.runInNewContext(
        ts.transpileModule(
            fs.readFileSync("src/device/media-backend.ts", "utf8"),
            {
                compilerOptions: { target: ts.ScriptTarget.ES5 },
            }
        ).outputText,
        engineScope
    );
    let event, completion;
    const sample = { duration: 120, paused: false, position: 45, ready: 2 };
    const backend = engineScope.window.__ottMediaBackend.create({
        clearInterval() {},
        context: () => ({
            generation: state.snapshot().generation,
            kind: "vod",
            position: state.snapshot().position,
        }),
        emit(context, type, position, duration) {
            if (type === "ended") {
                const token = navigation.prepareEnded(context.generation);
                assert(token, "guarded EOF accepts HTML5 pause before ended");
                state.phase("stopped");
                if (invalidation === "session") catalog.w._playSession++;
                if (invalidation === "target")
                    state.open({
                        channelId: "different",
                        kind: "vod",
                        sourceId: "other",
                    });
                completion = { generation: context.generation + 1, token };
                navigation.complete(completion.generation, token, "all");
            } else if (type === "position") {
                if (state.snapshot().phase !== "stopped")
                    state.position(position, duration);
            } else
                state.phase(
                    type === "stop"
                        ? "stopped"
                        : type === "pause"
                          ? "paused"
                          : type === "resume"
                            ? "playing"
                            : type
                );
        },
        open(_request, callback) {
            event = callback;
            return {
                dispose() {},
                pause() {},
                resume() {},
                sample: () => sample,
                seek() {},
            };
        },
        setInterval: () => 1,
    });
    backend.open({ url: "http://synthetic.invalid/movie.mp4" });
    event("playing");
    sample.paused = true;
    event("pause");
    await Promise.resolve();
    assert.equal(state.snapshot().phase, "paused");
    assert.deepEqual(selections, [], "pause alone never advances Favorites");
    if (invalidation === "manual-stop") {
        backend.stop();
        assert.equal(state.snapshot().phase, "stopped");
    }
    event("ended");
    if (completion)
        navigation.complete(completion.generation, completion.token, "all");
    backend.dispose();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(selections, invalidation ? [] : ["next"]);
}
async function main() {
    for (const provider of ["plex", "vportal"]) {
        await pausedCatalogEof(provider);
        await pausedCatalogEof(provider, "session");
        await pausedCatalogEof(provider, "target");
        await pausedCatalogEof(provider, "manual-stop");
    }
    for (const provider of ["plex", "vportal"]) {
        const catalog = mediaCatalogFixture(provider, false);
        assert.equal(catalog.payload.__ottMediaRef, undefined);
        assert(
            catalog.proof,
            provider + " raw catalog must retain played proof"
        );
        assert(catalog.proof.current());
        assert(catalog.proof.matches({ __ottGlobalChannel: "plex-row-0" }));
        assert(catalog.proof.matches({ __ottMediaRef: catalog.media.ref }));
        const state = playbackState();
        state.open({
            channelId: catalog.media.ref.itemId,
            kind: "vod",
            sourceId: catalog.media.ref.sourceId,
        });
        state.phase("playing");
        catalog.w.__ottClassicPlayback.snapshot = state.snapshot;
        const dynamicProof = catalog.capture();
        assert(dynamicProof);
        state.position(45, 120);
        assert(
            dynamicProof.current(),
            "seek position retains content identity"
        );
        state.phase("paused");
        assert(dynamicProof.current(), "pause retains the same content proof");
        const ended = dynamicProof.prepareEnded(state.snapshot().generation);
        assert.equal(typeof ended, "function");
        state.phase("stopped");
        assert.equal(dynamicProof.current(), false);
        assert.equal(
            ended(),
            true,
            "only the prepared EOF accepts stop generation"
        );
        catalog.w._playSession++;
        assert.equal(ended(), false);

        const absentMedia = mediaCatalogFixture(provider, false);
        absentMedia.w.__ottMedia.current = () => null;
        assert.equal(absentMedia.capture(), null);
        const wrongInitialMedia = mediaCatalogFixture(provider, false);
        wrongInitialMedia.media.payload.request = { id: "other" };
        assert.equal(wrongInitialMedia.capture(), null);
        const changedRef = mediaCatalogFixture(provider, false);
        changedRef.media.ref.itemId = "request:other";
        assert.equal(changedRef.proof.current(), false);
        const changedSource = mediaCatalogFixture(provider, false);
        changedSource.media.ref.sourceId = "media:other";
        assert.equal(changedSource.proof.current(), false);
        const changedRequest = mediaCatalogFixture(provider, false);
        changedRequest.media.payload.request = { id: "other", path: "/other" };
        assert.equal(changedRequest.proof.current(), false);
        const changedRow = mediaCatalogFixture(provider, false);
        changedRow.payload.request = { id: "other", path: "/other" };
        assert.equal(changedRow.proof.current(), false);
        const changedGeneration = mediaCatalogFixture(provider, false);
        changedGeneration.state.generation++;
        assert.equal(changedGeneration.proof.current(), false);
    }
    const plexServer = mediaCatalogFixture("plex", false);
    plexServer.w.__ottActiveProviderDriver.favoritesSource = () => ({
        current: () => true,
        serverId: "different-pms",
    });
    assert.equal(plexServer.proof.current(), false);
    const portalLocator = mediaCatalogFixture("vportal", false);
    portalLocator.payload.__ottFavoriteId.value = "other";
    assert.equal(portalLocator.proof.current(), false);
    const portalFolder = mediaCatalogFixture("vportal", false);
    portalFolder.payload.__ottMediaCategories = [{ name: "Other" }];
    assert.equal(portalFolder.proof.current(), false);
    const portalSource = mediaCatalogFixture("vportal", false);
    portalSource.payload.vportalSource = "media:other";
    assert.equal(portalSource.proof.current(), false);

    const plex = mediaCatalogFixture();
    assert(
        plex.proof,
        "real Plex catalogue row has no itemId but its media ref must own playback"
    );
    assert(plex.proof.current());
    assert(plex.proof.matches({ __ottGlobalChannel: "plex-row-0" }));
    assert(
        plex.proof.matches({
            __ottMediaRef: { itemId: "request:42", sourceId: "media:plex" },
        })
    );
    plex.payload.__ottMediaRef.itemId = "request:43";
    assert.equal(
        plex.proof.current(),
        false,
        "same UI row cannot replace media identity"
    );
    const plexRequest = mediaCatalogFixture();
    plexRequest.payload.request.path = "/library/metadata/43";
    assert.equal(
        plexRequest.proof.current(),
        false,
        "catalogue request cannot rebaseline captured locator"
    );
    const plexSource = mediaCatalogFixture();
    plexSource.payload.__ottMediaRef.sourceId = "other";
    assert.equal(
        plexSource.proof.current(),
        false,
        "foreign media source cannot reuse catalogue row"
    );
    const tv = fixture();
    assert(tv.proof.current());
    tv.w.channels[7] = { __ottFavoriteTvgId: "different", itemId: "different" };
    assert.equal(tv.proof.current(), false);
    const ending = fixture(),
        postStop = ending.proof.prepareEnded(7);
    assert.equal(typeof postStop, "function");
    assert.equal(postStop(), false);
    ending.change({
        generation: 8,
        phase: "stopped",
        target: { channelId: 7, sourceId: "source" },
    });
    assert.equal(ending.proof.current(), false);
    assert.equal(postStop(), true);
    assert.equal(
        ending.proof.prepareEnded(7),
        null,
        "manual stopped state cannot mint a fresh EOF proof"
    );
    ending.w._playSession++;
    assert.equal(
        postStop(),
        false,
        "manual session mutation retires already prepared EOF proof"
    );
    const wrongEnding = fixture(),
        wrongStop = wrongEnding.proof.prepareEnded(7);
    wrongEnding.change({
        generation: 8,
        phase: "stopped",
        target: { channelId: 8, sourceId: "source" },
    });
    assert.equal(wrongStop(), false);
    const session = fixture();
    session.w._playSession++;
    assert.equal(session.proof.current(), false);
    const vod = fixture(true);
    assert(vod.proof.current());
    vod.request.path = "/movie/43";
    assert.equal(
        vod.proof.current(),
        false,
        "shared VOD request mutation cannot change captured expected request"
    );
    const create = moduleAt(
            "src/media/global-favorites-router.ts"
        ).createGlobalFavoritesRouter,
        value = {
            locator: { channelId: "m3u-epg:stable", kind: "channel" },
            origin: {
                profile: "P",
                provider: "m3u",
                sourceAlias: "S",
                subprofile: null,
            },
            title: "A",
        };
    const router = create({
        activate: async () => ({
            capturePlayback: () => ({
                current: () => true,
                matches: () => true,
            }),
            complete() {
                throw Error("late completion failure");
            },
            current: () => true,
            origin: value.origin,
            play: async () => true,
            release() {},
            resolve: async () => ({ available: true, locator: value.locator }),
        }),
        allowed: () => true,
        changed() {},
        clearTimer() {},
        codec,
        current: () => true,
        now: () => 1,
        setTimer: () => 1,
        snapshot: async () => ({
            current: () => true,
            entries: [{ id: "id", ...value }],
        }),
        targets: async () => [{ current: () => true, origin: value.origin }],
    });
    assert.equal((await router.select("id").result).status, "unavailable");
    assert.equal(
        router.captureCurrent(),
        null,
        "failed completion must not publish played provenance"
    );
    console.log(
        "PASS actual played proof fences and failed completion publication"
    );
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
