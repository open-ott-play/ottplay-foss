const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const test = require("node:test");
const { fixture } = require("./helpers/provider-driver-fixture.cjs");
const runtime = require("./helpers/private-runtime.cjs");
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
    };
    runtime(f.host, "src/provider/source-identity.ts");
    f.driver = f.mount("torrent");
    return f;
}
function load(f) {
    let catalog;
    f.driver.load((value) => {
        catalog = value;
    });
    return catalog;
}

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
    assert.equal(f.host.editCaption, "Source name");
    f.host.editvar = "Public sample";
    f.host.setEdit();
    await flush();
    assert.equal(inspections.length, 1);
    inspections[0].done([{ index: 2, length: 200, name: "film.mp4" }]);
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
    f.host.selIndex = 1;
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

test("global Favorites reuse the stable channel locator and catalog identity", () => {
    const f = setup(),
        catalog = load(f),
        exported = {};
    for (const path of [
        "src/media/global-favorites-identities.ts",
        "src/media/global-favorites-providers.ts",
    ]) {
        const code = ts.transpileModule(fs.readFileSync(path, "utf8"), {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES5,
            },
        }).outputText;
        vm.runInNewContext(code, { exports: exported });
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
