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
        { exports, window: {}, Promise }
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
function fixture(vod = false) {
    const driver = { id: "m3u" },
        load = {},
        request = { path: "/movie/42" };
    let state = {
        generation: 7,
        phase: "playing",
        target: { sourceId: "source", channelId: vod ? "movie42" : 7 },
    };
    const w = {
        _playSession: 11,
        __ottActiveProviderDriver: driver,
        __ottCommandChannelLoad: load,
        __ottSourceIdentity: { current: () => "source", media: () => "source" },
        __ottClassicPlayback: { snapshot: () => state },
        channels: { 7: { itemId: "stable", __ottFavoriteTvgId: "stable" } },
        __ottMedia: {
            current: () => ({
                ref: { sourceId: "source", itemId: "movie42" },
                payload: { request },
            }),
        },
    };
    const scope = vm.createContext({
        w,
        driver,
        expectedLoad: load,
        source: "source",
        target: {
            current: () => true,
            selector: {},
            origin: { subprofile: null },
        },
        playbackItem: vod
            ? {
                  locator: { kind: "vportal-media", idField: "id", id: "42" },
                  items: [{ request }],
              }
            : {
                  id: 7,
                  locator: { kind: "channel", channelId: "m3u-epg:stable" },
              },
        ...identities,
    });
    vm.runInContext(
        ts.transpileModule(declaration.getText(ast), {
            compilerOptions: { target: ts.ScriptTarget.ES5 },
        }).outputText,
        scope
    );
    return {
        w,
        request,
        proof: scope.capturePlayback(),
        change: (value) => (state = value),
    };
}
function plexCatalogFixture() {
    // Real plex-list catalogue shape: the channel key is only a UI selection;
    // classic-adapter describe() supplies the media ref dispatched by index.ts.
    const request = { path: "/library/metadata/42" };
    const payload = {
        request,
        plexSource: "media:plex",
        __ottMediaRef: { sourceId: "media:plex", itemId: "request:42" },
    };
    const row = {
        __ottMediaItem: payload,
        channel_name: "Movie",
        logo: "",
        rec: 0,
    };
    const driver = {
            id: "plex",
            favoritesSource: () => ({
                serverId: "fixture-pms",
                current: () => true,
            }),
        },
        load = {};
    const state = {
        generation: 9,
        phase: "playing",
        target: { sourceId: "media:plex", channelId: "request:42" },
    };
    const w = {
        _playSession: 12,
        __ottActiveProviderDriver: driver,
        __ottCommandChannelLoad: load,
        __ottSourceIdentity: {
            current: () => "plex",
            media: () => "media:plex",
        },
        __ottClassicPlayback: { snapshot: () => state },
        channels: { "plex-row-0": row },
    };
    const scope = vm.createContext({
        w,
        driver,
        expectedLoad: load,
        source: "plex",
        target: {
            current: () => true,
            selector: {},
            origin: { subprofile: null },
        },
        playbackItem: {
            id: "plex-row-0",
            locator: {
                kind: "plex-media",
                serverId: "fixture-pms",
                ratingKey: "42",
            },
        },
        ...identities,
    });
    vm.runInContext(
        ts.transpileModule(declaration.getText(ast), {
            compilerOptions: { target: ts.ScriptTarget.ES5 },
        }).outputText,
        scope
    );
    return { w, payload, row, proof: scope.capturePlayback() };
}
async function main() {
    const plex = plexCatalogFixture();
    assert(
        plex.proof,
        "real Plex catalogue row has no itemId but its media ref must own playback"
    );
    assert(plex.proof.current());
    assert(plex.proof.matches({ __ottGlobalChannel: "plex-row-0" }));
    assert(
        plex.proof.matches({
            __ottMediaRef: { sourceId: "media:plex", itemId: "request:42" },
        })
    );
    plex.payload.__ottMediaRef.itemId = "request:43";
    assert.equal(
        plex.proof.current(),
        false,
        "same UI row cannot replace media identity"
    );
    const plexRequest = plexCatalogFixture();
    plexRequest.payload.request.path = "/library/metadata/43";
    assert.equal(
        plexRequest.proof.current(),
        false,
        "catalogue request cannot rebaseline captured locator"
    );
    const plexSource = plexCatalogFixture();
    plexSource.payload.__ottMediaRef.sourceId = "other";
    assert.equal(
        plexSource.proof.current(),
        false,
        "foreign media source cannot reuse catalogue row"
    );
    const tv = fixture();
    assert(tv.proof.current());
    tv.w.channels[7] = { itemId: "different", __ottFavoriteTvgId: "different" };
    assert.equal(tv.proof.current(), false);
    const ending = fixture(),
        postStop = ending.proof.prepareEnded(7);
    assert.equal(typeof postStop, "function");
    assert.equal(postStop(), false);
    ending.change({
        generation: 8,
        phase: "stopped",
        target: { sourceId: "source", channelId: 7 },
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
        target: { sourceId: "source", channelId: 8 },
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
            title: "A",
            origin: {
                provider: "m3u",
                profile: "P",
                subprofile: null,
                sourceAlias: "S",
            },
            locator: { kind: "channel", channelId: "m3u-epg:stable" },
        };
    const router = create({
        now: () => 1,
        setTimer: () => 1,
        clearTimer() {},
        current: () => true,
        allowed: () => true,
        changed() {},
        codec,
        snapshot: async () => ({
            entries: [{ id: "id", ...value }],
            current: () => true,
        }),
        targets: async () => [{ origin: value.origin, current: () => true }],
        activate: async () => ({
            origin: value.origin,
            current: () => true,
            resolve: async () => ({ available: true, locator: value.locator }),
            play: async () => true,
            capturePlayback: () => ({
                current: () => true,
                matches: () => true,
            }),
            complete() {
                throw Error("late completion failure");
            },
            release() {},
        }),
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
