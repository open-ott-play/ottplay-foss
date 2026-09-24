const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
const root = path.resolve(__dirname, "..");
const compile = (file) =>
    ts.transpileModule(
        fs
            .readFileSync(path.join(root, file), "utf8")
            .replace(/^export /gm, ""),
        {
            compilerOptions: {
                module: ts.ModuleKind.None,
                target: ts.ScriptTarget.ES5,
            },
        }
    ).outputText;
const code =
    compile("src/channels/channel-references.ts") +
    "\n" +
    compile("src/channels/favorites-lists.ts");
acorn.parse(code, { ecmaVersion: 5 });
const plain = (value) => JSON.parse(JSON.stringify(value));
const rows = () => ({
    10: { itemId: "stream:A", legacyChannelId: 100 },
    20: { itemId: "stream:B", legacyChannelId: 200 },
    30: { itemId: "stream:C", legacyChannelId: 300 },
});
const blob = (values, name = "Main") => ({
    active: name,
    lists: { [name]: values },
    order: [name],
    v: 1,
});
function fixture() {
    const saved = new Map(),
        events = [];
    let readHook = null,
        writeHook = null;
    const w = { channels: rows(), console, p_pref: "a" };
    w.window = w;
    w.providerGetItem = (key) => {
        const value = saved.get(w.p_pref + ":" + key) ?? null;
        if (readHook) readHook(key);
        return value;
    };
    w.providerGetJson = (key, fallback) => {
        const value = w.providerGetItem(key);
        return value ? JSON.parse(value) : fallback;
    };
    w.providerSetItem = (key, value) => {
        events.push([w.p_pref, key, value]);
        saved.set(w.p_pref + ":" + key, value);
        if (writeHook) writeHook(key);
    };
    vm.createContext(w);
    require("./helpers/shared-core-runtime.cjs")(w, { vendorOnly: true });
    require("./helpers/private-runtime.cjs")(
        w,
        "src/provider/source-identity.ts"
    );
    vm.runInContext(code, w);
    function key() {
        return (
            w.p_pref + ":favoritesLibrary:" + w.__ottSourceIdentity.current(w)
        );
    }
    return {
        envelope(value) {
            saved.set(key(), JSON.stringify(value));
        },
        events,
        load() {
            w.loadFavoritesLists();
        },
        onRead(callback) {
            readHook = callback;
        },
        onWrite(callback) {
            writeHook = callback;
        },
        raw(name, value) {
            saved.set(w.p_pref + ":" + name, JSON.stringify(value));
        },
        read() {
            return JSON.parse(saved.get(key()));
        },
        saved,
        view() {
            return Array.from(w.favoritesArray);
        },
        w,
    };
}
let passed = 0;
function test(name, run) {
    run(fixture());
    passed++;
    console.log("PASS favorites references: " + name);
}
test("raw hash/current collision stays unresolved while canonical v1 targets the current ID", (f) => {
    f.w.channels = {
        10: { itemId: "A", legacyChannelId: 100 },
        100: { itemId: "B" },
    };
    f.raw("favoritesArray", [100]);
    f.load();
    assert.deepEqual(f.view(), []);
    assert.deepEqual(f.read().lists.lists.Favorites, [
        { ambiguous: true, legacyId: 100, origin: "raw" },
    ]);
    f.envelope({ lists: blob([100]), sourceId: "a", version: 1 });
    f.load();
    assert.deepEqual(f.view(), [100]);
    assert.equal(f.read().version, 2);
    assert.deepEqual(f.read().lists.lists.Main, [{ itemId: "B" }]);
});
test("codec follows observed transitive hashes and treats null, cycles and competing paths conservatively", (f) => {
    const codec = f.w.__ottChannelReferences.create(rows(), {
        1: 2,
        2: 100,
        4: null,
        5: 6,
        6: 5,
        10: 10,
    });
    assert.deepEqual(plain(codec.resolve(1, "raw")), { itemId: "stream:A" });
    assert.equal(codec.project(codec.resolve(1, "raw")), 10);
    for (const id of [4, 5, 6])
        assert.equal(codec.resolve(id, "raw").ambiguous, true);
    assert.deepEqual(plain(codec.resolve(10, "raw")), { itemId: "stream:A" });
    assert.deepEqual(plain(codec.resolve(1, "canonical")), {
        legacyId: 1,
        origin: "canonical",
    });
    const collision = f.w.__ottChannelReferences.create(
        { ...rows(), 2: { itemId: "other" } },
        { 1: 2, 2: 100 }
    );
    assert.equal(collision.resolve(1, "raw").ambiguous, true);
});
test("codec snapshot cannot drift when catalog or alias inputs mutate", (f) => {
    const channels = rows(),
        aliases = { 1: 100 };
    const codec = f.w.__ottChannelReferences.create(channels, aliases);
    channels[10].itemId = "replaced";
    aliases[1] = 200;
    assert.deepEqual(plain(codec.resolve(1, "raw")), { itemId: "stream:A" });
    assert.equal(codec.project({ itemId: "stream:A" }), 10);
});
test("ambiguous imported records never attach when only one competing channel later remains", (f) => {
    f.w.channels[100] = { itemId: "other" };
    f.raw("favoritesLists", blob([100]));
    f.load();
    delete f.w.channels[100];
    f.load();
    assert.deepEqual(f.view(), []);
    assert.equal(f.read().lists.lists.Main[0].ambiguous, true);
});
test("stable IDs survive renumbering and do not attach to another channel reusing a numeric ID", (f) => {
    f.raw("favoritesArray", [100, 200]);
    f.load();
    f.w.channels = {
        10: { itemId: "new stranger" },
        41: { itemId: "stream:A" },
        42: { itemId: "stream:B" },
    };
    f.load();
    assert.deepEqual(f.view(), [41, 42]);
    assert.deepEqual(f.read().lists.lists.Favorites, [
        { itemId: "stream:A" },
        { itemId: "stream:B" },
    ]);
});
test("missing references preserve relative order across save, rename and returning catalog", (f) => {
    f.raw("favoritesLists", blob([100, 200, 300]));
    f.load();
    delete f.w.channels[20];
    f.load();
    assert.deepEqual(f.view(), [10, 30]);
    assert(f.w.renameFavoritesList("Main", "Renamed"));
    assert(f.w.saveFavoritesLists());
    assert.deepEqual(f.read().lists.lists.Renamed, [
        { itemId: "stream:A" },
        { itemId: "stream:B" },
        { itemId: "stream:C" },
    ]);
    f.w.channels[99] = { itemId: "stream:B" };
    f.load();
    assert.deepEqual(f.view(), [10, 99, 30]);
});
test("visible removals and reordering retain only invisible references and list deletion removes them", (f) => {
    f.raw("favoritesLists", blob([100, 200, 300]));
    f.load();
    delete f.w.channels[20];
    f.load();
    f.w.favoritesArray.splice(0, 1);
    f.w.favoritesArray.push(10);
    f.w.saveFavoritesLists();
    assert.deepEqual(f.read().lists.lists.Main, [
        { itemId: "stream:B" },
        { itemId: "stream:C" },
        { itemId: "stream:A" },
    ]);
    f.w.favoritesArray.splice(1, 1);
    f.w.saveFavoritesLists();
    assert.deepEqual(f.read().lists.lists.Main, [
        { itemId: "stream:B" },
        { itemId: "stream:C" },
    ]);
    f.w.addFavoritesList("Keep");
    f.w.deleteFavoritesList("Main");
    f.w.saveFavoritesLists();
    assert.equal(f.read().lists.lists.Main, undefined);
    assert.deepEqual(f.read().lists.lists.Keep, []);
});
test("saving a stale numeric projection cannot duplicate or redirect its missing stable binding", (f) => {
    f.raw("favoritesArray", [100]);
    f.load();
    f.w.channels = { 10: { itemId: "stranger" } };
    f.w.saveFavoritesLists();
    f.w.saveFavoritesLists();
    assert.deepEqual(f.read().lists.lists.Favorites, [{ itemId: "stream:A" }]);
    f.load();
    assert.deepEqual(f.view(), []);
    f.w.channels[77] = { itemId: "stream:A" };
    f.load();
    assert.deepEqual(f.view(), [77]);
});
test("unknown raw and canonical references resolve only under their recorded import policy", (f) => {
    f.envelope({
        lists: blob([
            { legacyId: 777, origin: "raw" },
            { legacyId: 778, origin: "canonical" },
        ]),
        sourceId: "a",
        version: 2,
    });
    f.load();
    assert.deepEqual(f.view(), []);
    f.w.saveFavoritesLists();
    f.w.channels[55] = { itemId: "returned raw", legacyChannelId: 777 };
    f.w.channels[56] = { itemId: "not canonical", legacyChannelId: 778 };
    f.load();
    assert.deepEqual(f.view(), [55]);
    f.w.channels[778] = { itemId: "canonical returned" };
    f.load();
    assert.deepEqual(f.view(), [55, 778]);
});
test("duplicate stable item identities stay invisible until the catalog becomes unambiguous", (f) => {
    f.envelope({
        lists: blob([{ itemId: "duplicate" }]),
        sourceId: "a",
        version: 2,
    });
    f.w.channels = { 10: { itemId: "duplicate" }, 20: { itemId: "duplicate" } };
    f.load();
    assert.deepEqual(f.view(), []);
    f.w.saveFavoritesLists();
    delete f.w.channels[20];
    f.load();
    assert.deepEqual(f.view(), [10]);
});
test("reference import reads the source-owned alias map without pre-mutating legacy data", (f) => {
    f.w.__ottLegacyChannelAliases = { 1: 2, 2: 100 };
    f.raw("favoritesArray", [1]);
    f.load();
    assert.deepEqual(f.view(), [10]);
    assert.equal(f.saved.get("a:favoritesArray"), "[1]");
});
test("account fingerprint and storage-accessor replacement reject stale saves", (f) => {
    let username = "first";
    f.w.__ottActiveProviderDriver = {
        credentials: () => ({ server: "server", username }),
    };
    f.raw("favoritesArray", [100]);
    f.load();
    const before = f.events.length;
    username = "second";
    assert.equal(f.w.saveFavoritesLists(), false);
    assert.equal(f.events.length, before);
    username = "first";
    f.w.providerSetItem = () => {
        throw Error("wrong storage");
    };
    assert.equal(f.w.saveFavoritesLists(), false);
    assert.equal(f.events.length, before);
});
for (const operation of ["load", "save"])
    test(
        "storage read reentry retires " +
            operation +
            " before replacement publication",
        (f) => {
            f.envelope({ lists: blob([10]), sourceId: "a", version: 1 });
            f.saved.set(
                "b:favoritesLibrary:b",
                JSON.stringify({ lists: blob([20]), sourceId: "b", version: 1 })
            );
            if (operation === "save") f.load();
            f.onRead((key) => {
                if (key !== "favoritesLibrary:a") return;
                f.onRead(null);
                f.w.p_pref = "b";
                f.load();
            });
            if (operation === "load") f.load();
            else assert.equal(f.w.saveFavoritesLists(), false);
            assert.deepEqual(f.view(), [20]);
            assert.deepEqual(f.read().lists.lists.Main, [
                { itemId: "stream:B" },
            ]);
        }
    );
test("write reentry cannot restore old references or refresh the old source", (f) => {
    f.envelope({ lists: blob([10]), sourceId: "a", version: 1 });
    f.load();
    f.saved.set(
        "b:favoritesLibrary:b",
        JSON.stringify({ lists: blob([20]), sourceId: "b", version: 1 })
    );
    f.w.favoritesArray.push(30);
    f.onWrite((key) => {
        if (key !== "favoritesLibrary:a") return;
        f.onWrite(null);
        f.w.p_pref = "b";
        f.load();
    });
    assert.equal(f.w.saveFavoritesLists(), false);
    assert.deepEqual(f.view(), [20]);
    f.w.saveFavoritesLists();
    assert.deepEqual(f.read().lists.lists.Main, [{ itemId: "stream:B" }]);
});
test("failed legacy reads cannot claim or shadow recoverable favorites", (f) => {
    f.raw("favoritesLists", blob([100, 200]));
    f.onRead((key) => {
        if (key === "favoritesLists") throw Error("temporary storage failure");
    });
    f.load();
    assert.deepEqual(f.view(), []);
    assert.equal(f.w.saveFavoritesLists(), false);
    assert.deepEqual(f.events, []);
    assert.equal(f.saved.has("a:favoritesLibrarySource"), false);
    assert.equal(f.saved.has("a:favoritesLibrary:a"), false);
    f.onRead(null);
    f.load();
    assert.deepEqual(f.view(), [10, 20]);
    assert.deepEqual(f.read().lists.lists.Main, [
        { itemId: "stream:A" },
        { itemId: "stream:B" },
    ]);
});
test("reloading migrated ambiguous and missing references makes no redundant storage writes", (f) => {
    f.w.channels[100] = { itemId: "other" };
    f.raw("favoritesLists", blob([100, 200, 999]));
    f.load();
    const before = f.events.length,
        text = f.saved.get("a:favoritesLibrary:a");
    f.load();
    f.load();
    f.w.saveFavoritesLists();
    assert.equal(f.events.length, before);
    assert.equal(f.saved.get("a:favoritesLibrary:a"), text);
});
test("future or malformed envelopes remain untouched and unwritable", (f) => {
    for (const value of [
        { lists: blob([10]), sourceId: "a", version: 99 },
        { lists: blob([10]), sourceId: "other", version: 2 },
    ]) {
        f.envelope(value);
        const before = [...f.saved];
        f.load();
        assert.equal(f.w.saveFavoritesLists(), false);
        assert.deepEqual([...f.saved], before);
    }
});
console.log(
    "PASS " +
        passed +
        " favorites reference scenarios; ES5 codec and public numeric projections"
);
