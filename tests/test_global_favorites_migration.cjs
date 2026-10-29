"use strict";
const assert = require("node:assert/strict"),
    fs = require("node:fs"),
    vm = require("node:vm"),
    ts = require("typescript");
const load = require("./helpers/private-runtime.cjs");
const context = vm.createContext({ JSON, console });
context.window = context;
load(context, "src/media/journal.ts");
load(context, "src/channels/channel-references.ts");
const original = JSON.stringify({
    version: 1,
    sourceId: "owned",
    history: [],
    favorites: [
        {
            sourceId: "owned",
            itemId: "provider:42",
            position: 0,
            payload: { title: "Film", id: "42" },
        },
    ],
});
let raw = original,
    writes = 0,
    alive = true;
const journal = context.__ottMediaJournal.create({
    sourceId: "owned",
    current: () => alive,
    enabled: () => false,
    read: (key) => (key === "mediaJournal.v1:owned" ? raw : null),
    write() {
        writes++;
    },
    limit: () => 20,
    importRows: () => [],
    core: {},
});
const captured = journal.captureFavorites();
assert(
    captured && captured.current(),
    "disabled favorite editing does not hide existing source-owned read-only data"
);
assert.equal(captured.favorites.length, 1);
assert.equal(writes, 0);
assert.equal(raw, original);
raw = JSON.stringify({
    version: 1,
    sourceId: "foreign",
    history: [],
    favorites: [],
});
assert.equal(captured.current(), false);
assert.equal(journal.captureFavorites(), null);
assert.equal(writes, 0);
raw = original;
alive = false;
assert.equal(journal.captureFavorites(), null);
function moduleAt(file, deps) {
    const exports = {};
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(file, "utf8"), {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES5,
            },
        }).outputText,
        {
            exports,
            require: (name) =>
                name === "./global-favorites-providers"
                    ? moduleAt("src/media/global-favorites-providers.ts", {})
                    : deps[name],
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
        }
    );
    return exports;
}
const identities = moduleAt("src/media/global-favorites-identities.ts", {}),
    capture = moduleAt("src/media/global-favorites-capture.ts", {
        "./global-favorites-identities": identities,
    });
const codec = moduleAt(
    "src/settings/global-favorites-portable.ts",
    {}
).createGlobalFavoritesPortableCodec();
const migration = moduleAt("src/media/global-favorites-migration.ts", {
    "./global-favorites-capture": capture,
}).captureGlobalFavoriteMigration;
async function main() {
    let current = true;
    const w = {
        __ottActiveProviderDriver: {
            id: "m3u",
            configuration: () => ({ active: 0 }),
        },
        commandChannelsReady: true,
        __ottCommandChannelLoad: {},
        __ottClassicPlayback: { snapshot: () => ({ generation: 1 }) },
        __ottSourceIdentity: { current: () => "m3u:source" },
        __ottFavoritesLibrary: {
            captureGlobal: () => ({
                raw: "exact-tv",
                document: {
                    sourceId: "m3u:source",
                    lists: {
                        order: ["Favorites"],
                        lists: {
                            Favorites: [
                                { itemId: "stable" },
                                { itemId: "missing" },
                            ],
                        },
                    },
                },
                current: () => current,
            }),
        },
        __ottChannelReferences: context.__ottChannelReferences,
        cList: [7],
        channels: {
            7: {
                itemId: "stable",
                __ottFavoriteTvgId: "stable",
                channel_name: "News",
                category: { name: "TV" },
            },
        },
    };
    const player = {
        allowed: () => current,
        selected: () => ({ name: "Profile" }),
        captureSelector: async () => ({ bound: true }),
    };
    const result = await migration(w, player, codec);
    assert.equal(result.entries.length, 1);
    assert.equal(
        result.pending.length,
        1,
        "unmapped source favorite remains pending, preventing complete migration marker"
    );
    assert(result.current());
    current = false;
    assert.equal(result.current(), false);
    current = true;
    w.__ottActiveProviderDriver.catalogLoading = () => true;
    assert.equal(
        await migration(w, player, codec),
        null,
        "partial source cannot be marked migrated"
    );
    console.log("PASS read-only journal capture and owned partial migration");
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
