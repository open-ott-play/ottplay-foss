const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "..");
const ts = require(path.join(root, "node_modules/typescript"));
function runSource(host, file) {
    vm.runInContext(
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
        ).outputText,
        host
    );
}
const results = [];
function check(name, run) {
    try {
        run();
        results.push({ name, status: "PASS" });
    } catch (error) {
        results.push({ error: String(error), name, status: "FAIL" });
    }
}
const row = (id, locked = false) => ({
    groupId: "g",
    groupLabel: "News",
    id,
    itemId: "stream:" + id,
    label: "Channel " + id,
    locked,
});
function libraryFixture(seed = []) {
    const host = { window: {} };
    vm.createContext(host);
    runSource(host, "src/channels/library.ts");
    const saved = new Map(seed);
    const ports = {
        current: () => true,
        get: (key) => saved.get(key) ?? null,
        set: (key, value) => saved.set(key, value),
        sourceId: "source",
    };
    return {
        create: (rows) => host.window.__ottChannelLibrary.create(ports, rows),
        saved,
    };
}
check(
    "new protected records are locked after a saved empty-lock catalog",
    () => {
        const f = libraryFixture();
        f.create([row(11)]).persist();
        assert.deepEqual(
            Array.from(f.create([row(11), row(12, true)]).snapshot().locks),
            [12]
        );
    }
);
check(
    "explicit unlock survives refresh while another new adult record is locked",
    () => {
        const f = libraryFixture();
        let a = f.create([row(11, true)]);
        assert(a.lock(11, false));
        assert.deepEqual(
            Array.from(
                f.create([row(11, true), row(12, true)]).snapshot().locks
            ),
            [12]
        );
    }
);
check(
    "legacy manual lock and preference resolve when a missing record returns",
    () => {
        const f = libraryFixture([
            ["parentalArray", "[12]"],
            ["aAspects", '{"12":3}'],
        ]);
        f.create([row(11)]).persist();
        const a = f.create([row(11), row(12)]);
        assert.deepEqual(Array.from(a.snapshot().locks), [12]);
        assert.equal(a.preference("aspect", 12), 3);
    }
);
function favoritesFixture() {
    let source = "a",
        hook = null;
    const envelope = (id, item) =>
        JSON.stringify({
            lists: {
                active: "Main",
                lists: { Main: [item] },
                order: ["Main"],
                v: 1,
            },
            sourceId: id,
            version: 1,
        });
    const saved = new Map([
        ["a:favoritesLibrary:a", envelope("a", 11)],
        ["b:favoritesLibrary:b", envelope("b", 22)],
    ]);
    const host = {
        _: (s) => s,
        providerGetItem(key) {
            const value = saved.get(source + ":" + key) ?? null;
            if (hook && key === "favoritesLibrary:a") {
                const fn = hook;
                hook = null;
                fn();
            }
            return value;
        },
        providerGetJson(key, fallback) {
            return (
                JSON.parse(saved.get(source + ":" + key) || "null") || fallback
            );
        },
        providerSetItem(key, value) {
            saved.set(source + ":" + key, value);
        },
    };
    host.window = host;
    vm.createContext(host);
    require(path.join(root, "tests/helpers/shared-core-runtime.cjs"))(host);
    host.__ottSourceIdentity = { current: () => source };
    runSource(host, "src/channels/favorites-lists.ts");
    return {
        host,
        reenter() {
            hook = () => {
                source = "b";
                host.loadFavoritesLists();
            };
        },
        saved,
    };
}
function assertB(f) {
    assert.deepEqual(Array.from(f.host.favoritesArray), [22]);
    assert.deepEqual(
        JSON.parse(f.saved.get("b:favoritesLibrary:b")).lists.lists.Main,
        [22]
    );
}
check("reentrant favorites load cannot erase the replacement source", () => {
    const f = favoritesFixture();
    f.reenter();
    f.host.loadFavoritesLists();
    assertB(f);
});
check(
    "reentrant favorites save cannot overwrite the replacement source",
    () => {
        const f = favoritesFixture();
        f.host.loadFavoritesLists();
        f.host.addFavoritesList("Extra");
        f.reenter();
        assert.equal(f.host.saveFavoritesLists(), false);
        assertB(f);
    }
);
check("unreadable favorites storage does not throw or permit writes", () => {
    const f = favoritesFixture();
    f.host.providerGetItem = () => {
        throw Error("storage blocked");
    };
    assert.doesNotThrow(() => f.host.loadFavoritesLists());
    assert.equal(f.host.saveFavoritesLists(), false);
});
console.log(JSON.stringify({ results, root }, null, 2));
if (results.some((result) => result.status === "FAIL")) process.exitCode = 1;
