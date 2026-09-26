const assert = require("node:assert/strict");
const vm = require("node:vm");
const runtime = require("./helpers/private-runtime.cjs");
const context = vm.createContext({ window: {} });
runtime(context, "src/channels/library.ts");
runtime(context, "src/provider/source-identity.ts");
const create = context.window.__ottChannelLibrary.create;
const saved = new Map();
let source = "provider@account-a";
let broken = false;
const rows = [
    {
        groupId: "genre:7",
        groupLabel: "News",
        id: 11,
        itemId: "stream:10",
        label: "News",
        locked: true,
    },
    {
        groupId: "genre:7",
        groupLabel: "News",
        id: 12,
        itemId: "stream:20",
        label: "Sport",
    },
    {
        groupId: "genre:9",
        groupLabel: "Movies",
        id: 13,
        itemId: "stream:30",
        label: "Film",
    },
];
function library(catalog = rows, legacySelection) {
    const owner = source;
    return create(
        {
            current: () => source === owner,
            get: (k) => saved.get(k) ?? null,
            legacySelection,
            set: (k, v) => {
                if (broken) throw Error("storage full");
                saved.set(k, v);
            },
            sourceId: owner,
        },
        catalog
    );
}
const plain = (x) => JSON.parse(JSON.stringify(x));
let a = library();
assert.deepEqual(
    plain(a.snapshot().locks),
    [11],
    "provider adult protection initializes once"
);
assert(a.setPreference("audio", 11, 2));
assert(a.select("genre:7", 12));
const custom = a.createGroup("Weekend", "genre:7");
assert(custom);
assert.equal(
    a.createGroup("Weekend"),
    null,
    "labels must remain unambiguous for renderer"
);
assert(a.renameGroup(custom, "Evening"));
assert(a.changeMember(custom, 11, "remove"));
assert(a.changeMember(custom, 13, "add"));
assert(a.changeMember(custom, 13, "move", -1));
assert.deepEqual(
    plain(a.snapshot().groups.find((g) => g.id === custom).members),
    [13, 12]
);
const renamed = rows
    .slice()
    .reverse()
    .map((row) => ({
        ...row,
        groupLabel: row.groupId === "genre:7" ? "Actualités" : "Cinéma",
        label: "Renamed " + row.label,
    }));
a = library(renamed);
assert.equal(a.preference("audio", 11), 2);
assert.deepEqual(plain(a.snapshot().selected), {
    groupId: "genre:7",
    itemId: "stream:20",
});
assert.equal(
    a.snapshot().groups.find((g) => g.id === "genre:7").label,
    "Actualités"
);
assert.equal(a.snapshot().groups.find((g) => g.id === custom).label, "Evening");
assert.deepEqual(
    plain(a.snapshot().groups.find((g) => g.id === custom).members),
    [13, 12]
);
let missing = library(renamed.filter((row) => row.id !== 12));
assert.deepEqual(
    plain(missing.snapshot().groups.find((g) => g.id === custom).members),
    [13]
);
assert(missing.setPreference("zoom", 13, 2));
a = library(rows);
assert.deepEqual(
    plain(a.snapshot().groups.find((g) => g.id === custom).members),
    [13, 12],
    "missing records return without erasing user data"
);
const snapshot = plain(a.snapshot());
broken = true;
assert.equal(a.renameGroup(custom, "Lost"), false);
assert.deepEqual(
    plain(a.snapshot()),
    snapshot,
    "failed commit leaves current model intact"
);
broken = false;
source = "provider@account-b";
assert.equal(a.lock(11, false), false, "retired source cannot write");
let b = library();
assert.equal(
    b.preference("audio", 11),
    undefined,
    "same numeric ID in another account is isolated"
);
assert.equal(
    b.snapshot().groups.some((g) => g.id === custom),
    false
);
const bkey = "channelLibrary:" + source;
saved.set(bkey, '{"version":999}');
b = library();
assert.equal(b.createGroup("Do not overwrite"), null);
assert.equal(saved.get(bkey), '{"version":999}');
// Migration is one-time, leaves prior keys intact, and resolves only known runtime identities.
saved.clear();
saved.set("catsArray", JSON.stringify(["News", "Movies"]));
saved.set("cats", JSON.stringify({ Movies: [13], News: [11, 12] }));
a = library(rows, {
    category: 1,
    favorites: null,
    index: 1,
    virtualLabels: ["All", "Favorites"],
});
assert.deepEqual(
    plain(a.snapshot().selected),
    { groupId: "genre:7", itemId: "stream:20" },
    "hydrated legacy positions include virtual All even when storage did not"
);
saved.set("catIndex", "0");
saved.set("primaryIndex", "0");
a = library(rows, {
    category: 1,
    favorites: [13],
    index: 1,
    virtualLabels: ["All", "Favorites"],
});
assert.deepEqual(
    plain(a.snapshot().selected),
    { groupId: "system:favorites", itemId: "stream:30" },
    "persisted selection takes precedence and resolves Favorites by identity"
);
saved.clear();
source = "m3u:0@one";
saved.set("catsArray", JSON.stringify(["All", "Custom"]));
saved.set("cats", JSON.stringify({ All: [11, 12, 13], Custom: [12, 999] }));
saved.set("aAspects", JSON.stringify({ "-1media": 2, 11: 1 }));
saved.set("parentalArray", JSON.stringify([12]));
a = library();
assert.equal(a.preference("aspect", 11), 1);
assert.equal(a.preference("aspect", null), 2);
assert.deepEqual(plain(a.snapshot().locks), [12]);
assert(a.setPreference("zoom", 11, 3));
source = "m3u:0@two";
b = library();
assert.equal(b.preference("aspect", 11), undefined);
assert.equal(
    b.snapshot().groups.some((g) => g.label === "Custom"),
    false
);
source = "m3u:0@one";
a = library();
assert.equal(a.preference("zoom", 11), 3);

// New adult entries inherit provider protection; explicit unlocks survive refresh.
saved.clear();
source = "provider@parental";
a = library([rows[1]]);
assert(a.persist());
a = library(rows);
assert.deepEqual(plain(a.snapshot().locks), [11]);
assert(a.lock(11, false));
a = library(rows);
assert.deepEqual(plain(a.snapshot().locks), []);
assert(a.lock(11, true));
a = library(rows);
assert.deepEqual(plain(a.snapshot().locks), [11]);
// Renaming a provider group must not freeze its catalog membership or order.
saved.clear();
source = "provider@refresh";
a = library();
assert(a.renameGroup("genre:7", "My news"));
const fresh = [
    rows[1],
    rows[0],
    {
        groupId: "genre:7",
        groupLabel: "News",
        id: 14,
        itemId: "stream:40",
        label: "New",
    },
    rows[2],
];
a = library(fresh);
assert.deepEqual(
    plain(a.snapshot().groups.find((g) => g.id === "genre:7").members),
    [12, 11, 14]
);
assert(a.changeMember("genre:7", 11, "remove"));
a = library(
    fresh.concat({
        groupId: "genre:7",
        groupLabel: "News",
        id: 15,
        itemId: "stream:50",
        label: "Latest",
    })
);
assert.deepEqual(
    plain(a.snapshot().groups.find((g) => g.id === "genre:7").members),
    [12, 14, 15]
);
assert.equal(
    a.snapshot().groups.find((g) => g.id === "genre:7").label,
    "My news"
);
const inaccessible = create(
    {
        current: () => true,
        get: () => {
            throw Error("storage unavailable");
        },
        legacySource: "failed",
        set: () => {
            throw Error("unexpected write");
        },
        sourceId: "failed",
    },
    rows
);
assert.equal(inaccessible.snapshot().all.length, 3);
assert.equal(inaccessible.select("genre:7", 11), false);
{
    let active = true;
    let interrupt = false;
    const writes = [];
    const guarded = create(
        {
            current: () => active,
            get: () => {
                if (interrupt) active = false;
                return null;
            },
            set: (key) => writes.push(key),
            sourceId: "old",
        },
        rows
    );
    interrupt = true;
    assert.equal(guarded.lock(12, true), false);
    assert.deepEqual(
        writes,
        [],
        "replacement during storage read cannot write to the new source"
    );
}
saved.clear();
saved.set("parentalArray", "[90]");
saved.set("aAudios", '{"90":2}');
a = library([rows[0]]);
assert(a.persist());
a = library([rows[0], { ...rows[1], legacyId: 90 }]);
assert.deepEqual(plain(a.snapshot().locks), [12]);
assert.equal(
    a.preference("audio", 12),
    2,
    "a returning old numeric alias resolves to its provider item ID"
);
const sourceId = context.window.__ottSourceIdentity;
{
    const saved = new Map();
    const names = ["constructor", "__proto__", "", "10", "2", "constructor"];
    const catalog = names.map((groupId, index) => ({
        groupId,
        groupLabel: "Group " + groupId,
        id: index + 1,
        itemId: "channel:" + index,
        label: "Channel " + index,
    }));
    catalog.push({ ...catalog[0], groupId: "ignored duplicate" });
    const indexed = create(
        {
            current: () => true,
            get: (key) => saved.get(key) ?? null,
            set: (key, value) => saved.set(key, value),
            sourceId: "indexed-groups",
        },
        catalog
    );
    const original = plain(indexed.snapshot());
    assert.deepEqual(
        original.groups.map((group) => group.id),
        names.slice(0, 5),
        "provider groups keep first appearance order and accept object property names"
    );
    assert.deepEqual(original.groups[0].members, [1, 6]);
    assert.deepEqual(original.all, [1, 2, 3, 4, 5, 6, 1]);
    const disposable = indexed.snapshot();
    disposable.all.length = 0;
    disposable.groups[0].label = "Changed view";
    disposable.groups[0].members.push(99);
    disposable.groups.splice(1, 1);
    assert.deepEqual(
        plain(indexed.snapshot()),
        original,
        "view edits cannot mutate provider groups or later snapshots"
    );
    assert(indexed.renameGroup("__proto__", "Renamed"));
    assert(indexed.changeMember("constructor", 1, "remove"));
    assert(indexed.removeGroup("10"));
    const updated = plain(indexed.snapshot());
    assert.deepEqual(
        updated.groups.map((group) => [group.id, group.label, group.members]),
        [
            ["__proto__", "Renamed", [2]],
            ["constructor", "Group constructor", [6]],
            ["", "Group ", [3]],
            ["2", "Group 2", [5]],
        ],
        "edited and hidden groups remain independent of the provider index"
    );
}
const host = {
    __ottActiveProviderDriver: {
        credentials: () => ({
            password: "secret",
            server: "https://one.invalid",
            username: "a",
        }),
    },
    p_pref: "xtream",
};
const first = sourceId.current(host);
assert(!first.includes("secret") && !first.includes("one.invalid"));
host.__ottActiveProviderDriver.credentials = () => ({
    password: "changed",
    server: "https://one.invalid",
    username: "a",
});
assert.equal(
    sourceId.current(host),
    first,
    "password rotation preserves named account"
);
host.__ottActiveProviderDriver.credentials = () => ({
    password: "secret",
    server: "https://one.invalid",
    username: "b",
});
assert.notEqual(sourceId.current(host), first);
const television = sourceId.current(host);
host.__ottActiveProviderDriver.mediaSource = () => "portal-one";
const media = sourceId.media(host);
host.__ottActiveProviderDriver.mediaSource = () => "portal-two";
assert.equal(sourceId.current(host), television);
assert.notEqual(sourceId.media(host), media);
for (let slot = 0; slot < 15; slot++) {
    const h = {
        m3uArr: {
            active: slot,
            M3Us: Array.from({ length: 15 }, () => ({
                www: "https://list.invalid/live.m3u",
            })),
        },
        p_pref: "m3u",
    };
    assert(sourceId.current(h).startsWith("m3u:" + slot + "@"));
}
console.log(
    "Channel library: stable identity, catalog/user separation, migration, account isolation, storage failures PASS"
);
