const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { fixture } = require("./helpers/provider-driver-fixture.cjs");
const runtime = require("./helpers/private-runtime.cjs");
const { actualModule } = require("./helpers/global-favorites-main-ports.cjs");
const source = "magnet:?xt=urn:btih:" + "a".repeat(40) + "&dn=Public+sample";
const config = {
    entries: [
        {
            category: "Public sample",
            files: [
                { index: 1, length: 100, name: "one.mp4" },
                { index: 3, length: 200, name: "two.mkv" },
            ],
            id: "sample",
            source,
            title: "Public sample",
        },
    ],
    id: "catalog-a",
    name: "Torrent",
    schema: 1,
};
const copy = (value) => JSON.parse(JSON.stringify(value));
const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
};
function setup(value = config) {
    const f = fixture(value ? { torrentcfg: JSON.stringify(value) } : {});
    f.host.URL = URL;
    f.host.crypto = { randomUUID: () => "generated-id" };
    f.host.listFooter = {};
    f.host.renderButtonHint = () => "";
    f.host.__ottMediaCompanion = {
        available: () => true,
        ensure() {
            throw new Error("Browsing must not start a service");
        },
        providerAvailable: () => true,
    };
    runtime(f.host, "src/provider/source-identity.ts");
    f.driver = f.mount("torrent");
    const storage = {
        getItem: (key) => f.saved.get(key) ?? null,
        removeItem: (key) => f.saved.delete(key),
        setItem: (key, value) => f.saved.set(key, value),
    };
    Object.assign(f.host, {
        localStorage: storage,
        location: { origin: "https://player.test" },
        navigator: {
            locks: { request: (_name, _options, callback) => callback({}) },
        },
    });
    const grant = actualModule(
        "src/storage/favorites-physical-storage.ts",
        f.host
    ).createFavoritesPhysicalStorageGrant(f.host, storage, () => true);
    const saveHost = actualModule(
        "src/plugins/torrent-catalog-runtime.ts",
        f.host
    ).createTorrentCatalogHost(f.host, {
        runtime: () => "torrent-test",
        storage: () => grant,
    });
    f.host.__ottTorrentCatalogAccess = () => saveHost;
    return f;
}
function load(f) {
    let catalog;
    f.driver.load((value) => {
        catalog = value;
    });
    return catalog;
}

function addonSettings(f, initial = {}) {
    const source = fs.readFileSync("src/settings/index.ts", "utf8");
    const ast = ts.createSourceFile(
        "settings.ts",
        source,
        ts.ScriptTarget.Latest,
        true
    );
    const normalize = ast.statements.find(
        (node) =>
            ts.isFunctionDeclaration(node) &&
            node.name?.text === "normalizeTorrentStreamAddons"
    );
    const schema = ast.statements
        .filter(ts.isVariableStatement)
        .flatMap((node) => [...node.declarationList.declarations])
        .find(
            (node) => node.name.getText(ast) === "settingsSchema"
        ).initializer;
    const definitions = schema.elements.filter((node) =>
        node.properties?.some(
            (property) =>
                property.name?.getText(ast) === "id" &&
                ["torrentStreamAddons", "torrentCatalogEndpoint"].includes(
                    property.initializer?.text
                )
        )
    );
    vm.runInContext(
        ts.transpileModule(
            normalize.getText(ast).replace(/^export /, "") +
                "\nvar addonSchema = [" +
                definitions.map((node) => node.getText(ast)).join(",") +
                "];",
            { compilerOptions: { target: ts.ScriptTarget.ES5 } }
        ).outputText,
        f.host
    );
    for (const [key, value] of Object.entries(initial)) f.saved.set(key, value);
    f.settingEffects = [];
    const store = f.host.createSettingsStore(f.host.addonSchema, {
        context: () => "torrent",
        effect: (name) =>
            f.settingEffects.push([name, Object.fromEntries(f.saved)]),
        storage: (entry) => ({
            read: () => f.saved.get(entry.key) ?? null,
            remove: () => f.saved.delete(entry.key),
            write: (value) => {
                if (f.rejectSettingKey !== entry.key)
                    f.saved.set(entry.key, value);
            },
        }),
    });
    store.reload();
    f.host.__ottPlayerSettingsHost = { schema: f.host.addonSchema, store };
    f.host.settings = {};
    for (const entry of f.host.addonSchema)
        Object.defineProperty(f.host.settings, entry.id, {
            get: () => store.get(entry.id),
        });
    f.addonTimers = new Map();
    let sequence = 0;
    f.host.setTimeout = (callback) => {
        const id = ++sequence;
        f.addonTimers.set(id, callback);
        return id;
    };
    f.host.clearTimeout = (id) => f.addonTimers.delete(id);
    return store;
}
function addManifest(f, url) {
    f.host.__ottEditProvider();
    f.host.selIndex = f.host.listArray.findIndex(
        (row) => row.name === "Add Stremio addon…"
    );
    assert(f.host.selIndex >= 0);
    f.host.listKeyHandler(f.host.keys.ENTER);
    assert.equal(f.host.editCaption, "Enter a Stremio addon manifest URL.");
    f.host.editvar = url;
    f.host.setEdit();
    return f.requests.at(-1);
}
const addonManifest = {
    catalogs: [{ id: "movies", name: "Movies", type: "movie" }],
    id: "test.addon",
    name: "Test addon",
    resources: ["catalog", "stream"],
    types: ["movie"],
};

test("saved Torrent catalog loads stable categories and file identities without a service", () => {
    const f = setup(),
        catalog = load(f);
    assert.deepEqual(copy(catalog.ids), [
        "torrent:catalog-a:sample:1",
        "torrent:catalog-a:sample:3",
    ]);
    assert.deepEqual(copy(catalog.groupOrder), ["Public sample"]);
    assert.equal(f.driver.capabilities.mediaPlaylist, true);
    const identity = f.host.__ottSourceIdentity.current(f.host);
    assert.equal(identity, f.host.__ottSourceIdentity.media(f.host));
    f.host.settings = {
        companionEndpoint:
            "http://127.0.0.1:49999/companion/" + "b".repeat(32) + "/v1",
    };
    assert.equal(f.host.__ottSourceIdentity.current(f.host), identity);
    const renamed = copy(config);
    renamed.entries[0].title = "New title";
    renamed.entries[0].category = "New title";
    assert.equal(f.driver.saveConfiguration(renamed), true);
    assert.deepEqual(copy(load(f).ids), copy(catalog.ids));
    assert.equal(f.host.__ottSourceIdentity.current(f.host), identity);
});

test("media journals keep file requests while playback reconstructs the current source", () => {
    const f = setup(),
        catalog = load(f),
        client = f.driver.mediaClient();
    const item = catalog.channels[catalog.ids[0]].__ottMediaItem;
    const persisted = client.persist({
        ...item,
        stream_url:
            "http://127.0.0.1/companion/secret/v1/sessions/lease/stream",
    });
    assert.equal(persisted.stream_url, undefined);
    assert.equal(JSON.stringify(persisted).includes("secret"), false);
    let resolved;
    client.resolve(persisted, (value) => {
        resolved = value;
    });
    assert.equal(new URL(resolved.stream_url).searchParams.get("so"), "1");
    assert.equal(resolved.itemId, item.itemId);
    const next = copy(config);
    next.entries[0].source = "https://media.example/sample.torrent?version=2";
    f.driver.saveConfiguration(next);
    client.resolve(persisted, (value) => {
        resolved = value;
    });
    assert.equal(
        new URL(resolved.stream_url).searchParams.get("source"),
        next.entries[0].source
    );
    const foreign = copy(persisted);
    foreign.request.catalogId = "foreign";
    client.resolve(foreign, (value) => {
        resolved = value;
    });
    assert.equal(resolved, null);
    f.driver.dispose();
    client.resolve(persisted, (value) => {
        resolved = value;
    });
    assert.equal(resolved, null);
});

test("native Torrent playback carries owned-service selection through resume", () => {
    const f = setup();
    f.host.__TAURI__ = {};
    const catalog = load(f),
        item = catalog.channels[catalog.ids[0]].__ottMediaItem;
    let result;
    f.driver.mediaClient().resolve(item, (value) => {
        result = value;
    });
    const uri = new URL(result.stream_url);
    assert.equal(uri.protocol, "ottplay-torrent:");
    assert.equal(uri.searchParams.get("native"), "1");
    assert.equal(uri.searchParams.get("source"), source);
    assert.equal(f.driver.mediaClient().persist(result).stream_url, undefined);
});

test("catalog normalization rejects ambiguous or transient source identities", () => {
    const f = setup();
    for (const change of [
        (value) => value.entries.push(copy(value.entries[0])),
        (value) => value.entries[0].files.push(copy(value.entries[0].files[0])),
        (value) => {
            value.entries[0].source =
                "http://localhost/companion/token/v1/sessions/1/stream";
        },
        (value) => {
            value.entries[0].files[0].index = -1;
        },
        (value) => {
            value.entries[0].source = "ottplay-plugin:direct-url?input=movie";
        },
    ]) {
        const value = copy(config);
        change(value);
        assert.equal(f.driver.saveConfiguration(value), false);
    }
});

test("long metadata names retain stable identity and bounded Favorites titles", () => {
    const value = copy(config);
    value.entries[0].files[0].name = "a".repeat(4092) + ".mp4";
    const f = setup(value),
        catalog = load(f),
        row = catalog.channels[catalog.ids[0]];
    assert.equal(row.channel_name.length, 1024);
    assert.equal(row.__ottMediaItem.title.length, 1024);
    assert.equal(row.__ottMediaItem.itemId, "torrent:catalog-a:sample:1");
    assert.equal(
        f.driver.configuration().entries[0].files[0].name.length,
        4096
    );
});

test("adding a source saves cached metadata then uses the normal channel reload", async () => {
    const f = setup(null),
        inspections = [];
    f.host.__ottMediaCompanion.ensure = async () => ({
        metadata(source, done) {
            inspections.push({ done, source });
            return () => {};
        },
    });
    f.host.__ottEditProvider();
    f.host.listKeyHandler(f.host.keys.ENTER);
    f.host.editvar = source;
    f.host.setEdit();
    assert.equal(f.host.editCaption, "New list name");
    f.host.editvar = "Public sample";
    f.host.setEdit();
    await flush();
    assert.equal(inspections.length, 1);
    inspections[0].done([{ index: 2, length: 200, name: "film.mp4" }]);
    await flush();
    assert.equal(f.reloads, 1);
    const saved = JSON.parse(f.saved.get("torrentcfg"));
    assert.equal(saved.entries[0].source, source);
    assert.equal(saved.entries[0].files[0].index, 2);
    assert.equal(JSON.stringify(saved).includes("sessions"), false);
});

test("closing the source editor cancels metadata and ignores a late result", async () => {
    const f = setup(),
        inspections = [];
    let released = 0;
    f.host.__ottMediaCompanion.ensure = async () => ({
        metadata(source, done) {
            inspections.push({ done, source });
            return () => released++;
        },
    });
    f.host.__ottEditProvider();
    f.host.selIndex = f.host.listArray.findIndex(
        (row) => row.name === "Public sample (2)"
    );
    assert.ok(f.host.selIndex >= 0);
    f.host.listKeyHandler(f.host.keys.ENTER);
    f.host.listKeyHandler(f.host.keys.ENTER);
    await flush();
    const before = f.saved.get("torrentcfg");
    f.host.listKeyHandler(f.host.keys.RETURN);
    inspections[0].done([{ index: 0, length: 1, name: "late.mp4" }]);
    assert.equal(released, 1);
    assert.equal(f.saved.get("torrentcfg"), before);
    assert.equal(f.reloads, 0);
});

test("source editor cannot overwrite a catalog changed while metadata was loading", async () => {
    const f = setup(),
        inspections = [];
    f.host.__ottMediaCompanion.ensure = async () => ({
        metadata(_source, done) {
            inspections.push(done);
            return () => {};
        },
    });
    f.host.__ottEditProvider();
    f.host.selIndex = f.host.listArray.findIndex(
        (row) => row.name === "Public sample (2)"
    );
    assert.ok(f.host.selIndex >= 0);
    f.host.listKeyHandler(f.host.keys.ENTER);
    f.host.listKeyHandler(f.host.keys.ENTER);
    await flush();
    const external = copy(config);
    external.name = "Changed by a concurrent import";
    const raw = JSON.stringify(external);
    f.saved.set("torrentcfg", raw);
    inspections[0]([{ index: 0, length: 1, name: "new.mp4" }]);
    await flush();
    assert.equal(f.saved.get("torrentcfg"), raw);
    assert.equal(f.reloads, 0);
});

test("adding a Stremio manifest atomically installs streams and its catalog without touching manual sources", () => {
    const f = setup();
    addonSettings(f);
    const before = f.saved.get("torrentcfg"),
        base =
            "http://127.0.0.1:8794/%7b%22token%22%3a%22PRIVATE%20value%22%7d";
    const pending = addManifest(f, base + "/manifest.json/");
    assert.equal(pending.settings.url, base + "/manifest.json");
    assert.equal(f.saved.has("sTorrentStreamAddons"), false);
    pending.resolve(JSON.stringify(addonManifest));
    assert.equal(f.saved.get("sTorrentCatalogEndpoint"), base);
    assert.equal(
        f.saved.get("sTorrentStreamAddons"),
        JSON.stringify([base + "/manifest.json"])
    );
    assert.equal(f.saved.get("torrentcfg"), before);
    assert.equal(f.reloads, 0);
    assert.equal(f.addonTimers.size, 0);
    assert.equal(f.settingEffects.length, 2);
    for (const [, snapshot] of f.settingEffects)
        assert.equal(snapshot.sTorrentCatalogEndpoint, base);
    assert(!JSON.stringify(f.host.listArray).includes("PRIVATE"));
    assert.equal(f.host.editvar, "");
});
test("Stremio stream-only and catalog-only manifests update only supported capabilities", () => {
    for (const kind of ["stream", "catalog"]) {
        const f = setup();
        const existing = '["https://existing.test/manifest.json"]';
        addonSettings(f, {
            sTorrentCatalogEndpoint: "https://catalog.test",
            sTorrentStreamAddons: existing,
        });
        const manifest = copy(addonManifest);
        manifest.resources = [kind];
        if (kind === "stream") manifest.catalogs = [];
        const pending = addManifest(f, "http://localhost:8794/manifest.json");
        pending.resolve(manifest);
        assert.equal(
            f.saved.get("sTorrentCatalogEndpoint"),
            kind === "stream" ? "https://catalog.test" : "http://localhost:8794"
        );
        assert.equal(
            f.saved.get("sTorrentStreamAddons"),
            kind === "catalog"
                ? existing
                : '["https://existing.test/manifest.json","http://localhost:8794/manifest.json"]'
        );
        addManifest(f, "http://localhost:8794/manifest.json").resolve(manifest);
        assert.equal(
            JSON.parse(f.saved.get("sTorrentStreamAddons")).length,
            kind === "catalog" ? 1 : 2
        );
    }
});
test("copied stremio links preserve opaque configuration bytes and become HTTPS", () => {
    const f = setup();
    addonSettings(f);
    const path =
        "addon.test/%7b%22key%22%3a%22PRIVATE%20value%22%7d/manifest.json";
    const pending = addManifest(f, "stremio://" + path);
    assert.equal(pending.settings.url, "https://" + path);
    pending.resolve(addonManifest);
    assert.equal(
        f.saved.get("sTorrentStreamAddons"),
        JSON.stringify(["https://" + path])
    );
});
test("Stremio dialog cancels requests and never publishes late, invalid or oversized manifests", () => {
    for (const mode of [
        "back",
        "dispose",
        "timeout",
        "invalid",
        "oversize",
        "unsupported",
    ]) {
        const f = setup();
        addonSettings(f);
        const before = JSON.stringify([...f.saved]);
        const pending = addManifest(f, "http://localhost:8794/manifest.json");
        if (mode === "back") f.host.listKeyHandler(f.host.keys.RETURN);
        if (mode === "dispose") f.driver.dispose();
        if (mode === "timeout")
            for (const callback of [...f.addonTimers.values()]) callback();
        pending.resolve(
            mode === "invalid"
                ? "not-json"
                : mode === "oversize"
                  ? JSON.stringify({
                        ...addonManifest,
                        name: "x".repeat(65536),
                    })
                  : mode === "unsupported"
                    ? { ...addonManifest, catalogs: [], resources: [] }
                    : addonManifest
        );
        assert.equal(JSON.stringify([...f.saved]), before, mode);
        assert.equal(f.settingEffects.length, 0, mode);
        if (["back", "dispose", "timeout"].includes(mode))
            assert.equal(pending.aborts, 1, mode);
    }
});
test("Stremio install rejects concurrent settings changes, capacity overflow and partial persistence", () => {
    for (const mode of ["concurrent", "limit", "storage"]) {
        const f = setup();
        const initial =
            mode === "limit"
                ? JSON.stringify(
                      Array.from(
                          { length: 8 },
                          (_, i) => "https://addon" + i + ".test/manifest.json"
                      )
                  )
                : "[]";
        const store = addonSettings(f, {
            sTorrentCatalogEndpoint: "https://before.test",
            sTorrentStreamAddons: initial,
        });
        const pending = addManifest(f, "http://localhost:8794/manifest.json");
        if (mode === "concurrent") {
            const draft = store.begin();
            draft.set("torrentCatalogEndpoint", "https://newer.test");
            assert(draft.commit());
            f.settingEffects = [];
        }
        if (mode === "storage") f.rejectSettingKey = "sTorrentCatalogEndpoint";
        pending.resolve(addonManifest);
        assert.equal(f.saved.get("sTorrentStreamAddons"), initial, mode);
        assert.equal(
            f.saved.get("sTorrentCatalogEndpoint"),
            mode === "concurrent"
                ? "https://newer.test"
                : "https://before.test",
            mode
        );
        assert.equal(f.settingEffects.length, 0, mode);
    }
});
test("global Favorites reuse the stable channel locator and catalog identity", () => {
    const f = setup(),
        catalog = load(f),
        exported = {};
    for (const path of [
        "src/media/global-favorites-identities.ts",
        "src/media/global-favorites-providers.ts",
    ]) {
        Object.assign(exported, actualModule(path, f.host));
    }
    const item = catalog.channels[catalog.ids[0]];
    assert.equal(
        exported.globalFavoriteChannelId("torrent", item),
        catalog.ids[0]
    );
    const profile = exported.globalFavoriteBuiltin(f.host, "torrent");
    const identity = exported.globalFavoriteBuiltinConfiguration(
        f.host,
        profile,
        null
    );
    assert.deepEqual(copy(identity.values), ["catalog-a"]);
    assert.equal(JSON.stringify(identity).includes("magnet"), false);
    assert.equal(
        exported.globalFavoriteBuiltinChoices(f.host, profile)[0].provider,
        "torrent"
    );
    const changed = copy(item);
    changed.__ottMediaItem.request.fileIndex = 99;
    assert.equal(exported.globalFavoriteChannelId("torrent", changed), null);
});
