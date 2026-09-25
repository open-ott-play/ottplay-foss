const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");
const { settingsSource } = require("./helpers/settings-source-fixture.cjs");
const { compatibilitySource } = require("./helpers/english-source-fixture.cjs");
const plain = (value) => JSON.parse(JSON.stringify(value));
let count = 0;
function check(name, run) {
    run();
    count++;
    console.log("OK: " + name);
}
function fixture() {
    const data = new Map();
    let fail,
        hook,
        confirm,
        result,
        restarts = 0;
    const w = {
        _: (value) => value,
        catIndex: 0,
        channels: {
            10: {
                category: { name: "News" },
                itemId: "stream:A",
                legacyChannelId: 100,
            },
            20: {
                category: { name: "News" },
                itemId: "stream:B",
                legacyChannelId: 200,
            },
        },
        cList: [10, 20],
        confirmBox: (_message, yes) => {
            confirm = yes;
        },
        console,
        favoritesArray: [],
        m3uArr: { active: 0, M3Us: [{ www: "https://one.invalid/list" }] },
        p_pref: "m3u",
        primaryIndex: 0,
        restart: () => restarts++,
    };
    w.window = w;
    const read = (key) => data.get(key) ?? null;
    const write = (key, value) => {
        if (fail === key) return;
        data.set(key, String(value));
        if (hook) hook(key);
    };
    w.storage = {
        del: (key) => data.delete(key),
        get: read,
        set: write,
        setI: write,
    };
    w.providerGetItem = (key) => read("p:" + key);
    w.providerSetItem = (key, value) => write("p:" + key, value);
    w.providerDelItem = (key) => data.delete("p:" + key);
    w.providerGetJson = (key, fallback) =>
        JSON.parse(w.providerGetItem(key) || "null") || fallback;
    vm.createContext(w);
    require("./helpers/shared-core-runtime.cjs")(w);
    vm.runInContext(compatibilitySource + settingsSource(), w);
    vm.runInContext(
        ts.transpileModule(
            fs
                .readFileSync(
                    require.resolve("../src/channels/favorites-lists.ts"),
                    "utf8"
                )
                .replace(/^export /gm, ""),
            {
                compilerOptions: {
                    module: ts.ModuleKind.None,
                    target: ts.ScriptTarget.ES5,
                },
            }
        ).outputText,
        w
    );
    const source = w.__ottSourceIdentity.current(w);
    const channelKey = "p:channelLibrary:" + source,
        favoriteKey = "p:favoritesLibrary:" + source;
    const f = {
        accept() {
            if (confirm) confirm();
            return result;
        },
        channelKey,
        confirm() {
            return confirm;
        },
        data,
        export() {
            return JSON.parse(w.exportSettings());
        },
        fail(key) {
            fail = key;
        },
        favoriteKey,
        hook(fn) {
            hook = fn;
        },
        import(env) {
            result = undefined;
            confirm = undefined;
            w.importSettings(JSON.stringify(env), (ok) => {
                result = ok;
            });
        },
        mount() {
            w.loadFavoritesLists();
            w.__ottChannels.mount(w);
        },
        restarts() {
            return restarts;
        },
        result() {
            return result;
        },
        source,
        w,
    };
    return f;
}
check(
    "v2 round-trips full owner documents and preserves invisible references",
    () => {
        const f = fixture(),
            w = f.w;
        f.data.set("p:favoritesArray", "[100]");
        f.mount();
        w.__ottChannels.change("lock", 20, true);
        w.__ottChannels.change("create", "Custom", [10]);
        w.__ottChannels.setPreference("aAudios", 10, 2);
        const exported = f.export();
        assert.equal(exported.version, 2);
        assert.deepEqual(exported.tv.channels.locks, ["stream:B"]);
        assert.equal(exported.tv.channels.preferences.audio["stream:A"], 2);
        exported.tv.favorites.lists.lists[
            exported.tv.favorites.lists.active
        ].push({ itemId: "stream:missing" });
        exported.tv.channels.hidden.push("stream:missing");
        exported.tv.channels.groups[0].members.push("stream:missing");
        const oldBytes = f.data.get("p:favoritesArray");
        f.import(exported);
        assert.equal(f.result(), undefined);
        assert.equal(f.accept(), true);
        assert.equal(f.restarts(), 1);
        assert.deepEqual(
            JSON.parse(f.data.get(f.favoriteKey)),
            exported.tv.favorites
        );
        assert.deepEqual(
            JSON.parse(f.data.get(f.channelKey)),
            exported.tv.channels
        );
        assert.equal(
            f.data.get("p:favoritesArray"),
            oldBytes,
            "rollback bytes stay untouched"
        );
        f.mount();
        assert.deepEqual(plain(w.favoritesArray), [10]);
        exported.tv.channels.groups[0].inheritsMembers = false;
        exported.tv.channels.groups[0].known = [];
        assert.deepEqual(f.export().tv, exported.tv);
        w.channels[30] = {
            category: { name: "News" },
            itemId: "stream:missing",
        };
        w.cList.push(30);
        f.mount();
        assert.deepEqual(plain(w.favoritesArray), [10, 30]);
    }
);
check(
    "v1 replaces canonical active favorites and locks despite existing migration claims",
    () => {
        const f = fixture();
        f.mount();
        f.w.__ottChannels.change("lock", 10, true);
        f.data.set("p:favoritesLibrarySource", f.source);
        f.data.set("p:channelLibrarySource", f.source);
        f.import({
            favoritesArray: [200, 999],
            parentalArray: [200],
            settings: { fontSize: 3 },
            version: 1,
        });
        assert.equal(f.accept(), true);
        f.mount();
        assert.deepEqual(plain(f.w.favoritesArray), [20]);
        assert.deepEqual(plain(f.w.parentalArray), [20]);
        const exported = f.export();
        assert.deepEqual(exported.tv.channels.unlocks, ["stream:A"]);
        assert.deepEqual(
            exported.tv.favorites.lists.lists[
                exported.tv.favorites.lists.active
            ],
            [{ itemId: "stream:B" }, { legacyId: 999, origin: "raw" }]
        );
    }
);
check(
    "same-prefix account replacement and accessor replacement cancel confirmation without writes",
    () => {
        for (const replace of [
            (f) => {
                f.w.m3uArr.M3Us[0].www = "https://two.invalid/list";
            },
            (f) => {
                f.w.providerSetItem = () => {
                    throw new Error("replacement");
                };
            },
        ]) {
            const f = fixture();
            f.mount();
            const env = f.export(),
                before = [...f.data];
            f.import(env);
            replace(f);
            assert.equal(f.accept(), false);
            assert.deepEqual([...f.data], before);
            assert.equal(f.restarts(), 0);
        }
    }
);
check(
    "invalid or foreign documents and future local schemas cannot be overwritten",
    () => {
        for (const mutate of [
            (e) => {
                e.tv.sourceId = "another";
            },
            (e) => {
                e.settings = [];
            },
            (e) => {
                e.tv.channels.version = 2;
            },
            (e) => {
                e.tv.favorites.lists.active = "missing";
            },
            (e) => {
                e.settings.fontSize = -1;
            },
            (e) => {
                e.tv.channels.preferences.audio = { constructor: 2 };
            },
        ]) {
            const f = fixture();
            f.mount();
            const e = f.export();
            mutate(e);
            const before = [...f.data];
            f.import(e);
            assert.equal(f.result(), false);
            assert.equal(f.confirm(), undefined);
            assert.deepEqual([...f.data], before);
        }
        const f = fixture();
        f.mount();
        const e = f.export();
        f.data.set(f.channelKey, JSON.stringify({ version: 99 }));
        f.w.__ottChannels.reset();
        assert.throws(() => f.export());
        f.import(e);
        assert.equal(f.result(), false);
    }
);
check(
    "every partial write failure rolls back canonical documents and settings without publication",
    () => {
        for (const failed of ["channels", "favorites", "settings"]) {
            const f = fixture();
            f.mount();
            const e = f.export();
            e.tv.channels.locks = ["stream:B"];
            e.tv.favorites.lists.lists[e.tv.favorites.lists.active] = [
                { itemId: "stream:B" },
            ];
            e.settings.fontSize = 3;
            f.fail(
                failed === "channels"
                    ? f.channelKey
                    : failed === "favorites"
                      ? f.favoriteKey
                      : "sFont"
            );
            const before = [...f.data];
            f.import(e);
            assert.equal(f.accept(), false);
            assert.deepEqual([...f.data], before);
            assert.equal(f.restarts(), 0);
            assert.deepEqual(plain(f.w.parentalArray), []);
        }
    }
);
check("an intervening library edit rejects the stale confirmation", () => {
    const f = fixture();
    f.mount();
    const e = f.export();
    f.import(e);
    f.w.__ottChannels.change("lock", 10, true);
    const before = [...f.data];
    assert.equal(f.accept(), false);
    assert.deepEqual([...f.data], before);
});
check(
    "source replacement during a write stops the batch without touching replacement storage",
    () => {
        const f = fixture();
        f.mount();
        const e = f.export();
        e.tv.channels.locks = ["stream:B"];
        let writes = 0;
        f.hook(() => {
            writes++;
            f.w.m3uArr.M3Us[0].www = "https://two.invalid/list";
        });
        f.import(e);
        assert.equal(f.accept(), false);
        assert.equal(writes, 1);
        assert.equal(f.restarts(), 0);
    }
);
console.log("OK: " + count + " settings/library backup integration groups");
