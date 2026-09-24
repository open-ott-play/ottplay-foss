const assert = require("node:assert/strict");
const vm = require("node:vm");
const loadPrivate = require("./helpers/private-runtime.cjs");
const sharedCore = require("./helpers/shared-core-runtime.cjs");
const plain = (v) => JSON.parse(JSON.stringify(v));

function fixture(initial = {}) {
    const values = new Map(
        Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)])
    );
    const writes = [];
    let active = true;
    let fail = false;
    const w = { window: null };
    w.window = w;
    vm.createContext(w);
    loadPrivate(w, "src/playback/journal.ts");
    const journal = w.__ottPlaybackJournal.create({
        get: (key) => values.get(key),
        isCurrent: () => active,
        now: () => 1700000100000,
        set: (key, value) => {
            if (fail) throw new Error("quota");
            writes.push(key);
            values.set(key, value);
        },
        sourceId: "fixture",
    });
    return {
        fail: () => {
            fail = true;
        },
        journal,
        retire: () => {
            active = false;
        },
        values,
        writes,
    };
}

// First read imports without touching any version-1 bytes. IDs survive reordered views.
{
    const f = fixture({
        catsArray: ["News", "Cinema"],
        continueWatch: {
            catIndex: 1,
            channelId: 41,
            mode: "archive",
            playTime: 25,
            playType: 1700000000,
            updatedAt: 1700000000123,
            v: 1,
        },
        medHistory: [
            { request: { opaque: "preserve" }, stream_url: "rotating-url" },
        ],
        prevArr: [
            { c: 1, ci: 41, e: "Programme", i: 3, t: 1700000000 },
            { ci: "42" },
            { ci: null },
            { ci: 99, t: "bad" },
        ],
    });
    const old = new Map(f.values);
    const document = plain(f.journal.read().document);
    assert.deepEqual(document.bookmark, {
        archiveStart: 1700000000,
        channelId: "41",
        groupId: "Cinema",
        kind: "archive",
        position: 25,
    });
    assert.equal(document.updatedAt, 1700000000123);
    assert.equal(document.history.length, 2);
    assert.equal(document.history[0].groupId, "Cinema");
    assert.equal(document.history[0].label, "Programme");
    assert.deepEqual(f.writes, []);
    assert.equal(f.journal.update({ history: document.history }), true);
    assert.deepEqual(f.writes, ["playbackJournal"]);
    for (const [key, value] of old)
        assert.equal(
            f.values.get(key),
            value,
            "rollback bytes remain intact: " + key
        );
    const saved = JSON.parse(f.values.get("playbackJournal"));
    assert.equal(saved.version, 2);
    assert.equal(
        saved.updatedAt,
        document.updatedAt,
        "history-only write cannot refresh expired bookmark"
    );
    assert.equal(saved.history[0].ci, undefined);
    assert.equal(saved.history[0].c, undefined);
    document.history[0].channelId = "mutated";
    assert.equal(f.journal.read().document.history[0].channelId, "41");
}

// Canonical data wins over stale mirrors, including explicit empty history.
{
    const f = fixture({
        continueWatch: { channelId: 123, mode: "live", v: 1 },
        prevArr: [{ ci: 123 }],
    });
    assert.equal(
        f.journal.update({
            bookmark: { channelId: "42", kind: "live" },
            history: [],
        }),
        true
    );
    f.values.set("prevArr", JSON.stringify([{ ci: 999 }]));
    assert.deepEqual(plain(f.journal.read().document.history), []);
    assert.equal(f.journal.read().document.bookmark.channelId, "42");
    assert.equal(f.journal.read().document.bookmark.kind, "live");
}

for (const raw of [
    "{broken",
    "null",
    JSON.stringify({ version: 3 }),
    JSON.stringify({
        history: [],
        sourceId: "another",
        updatedAt: 0,
        version: 2,
    }),
]) {
    const f = fixture({ prevArr: [{ ci: 123 }] });
    f.values.set("playbackJournal", raw);
    assert.equal(f.journal.read().writable, false);
    assert.equal(
        f.journal.update({ bookmark: { channelId: "1", kind: "live" } }),
        false
    );
    assert.equal(f.values.get("playbackJournal"), raw);
    assert.deepEqual(f.writes, []);
}

// Failure and cancellation leave previous complete envelope in place.
for (const fault of ["fail", "retire"]) {
    const f = fixture();
    assert.equal(
        f.journal.update({
            bookmark: { channelId: "first", kind: "vod", position: 31 },
        }),
        true
    );
    const saved = f.values.get("playbackJournal");
    f[fault]();
    assert.equal(
        f.journal.update({
            bookmark: {
                archiveStart: 123,
                channelId: "second",
                kind: "archive",
            },
        }),
        false
    );
    assert.equal(f.values.get("playbackJournal"), saved);
}
{
    const f = fixture({
        continueWatch: {
            channelId: 1,
            mode: "vod",
            playType: -99999999999,
            v: 1,
        },
    });
    assert.equal(
        f.journal.read().document.bookmark,
        null,
        "ambiguous legacy media mode is not assigned a fabricated media identity"
    );
    assert.equal(
        f.journal.update({ bookmark: { channelId: "", kind: "live" } }),
        false
    );
    assert.equal(
        f.journal.update({
            bookmark: { archiveStart: NaN, channelId: "1", kind: "archive" },
        }),
        false
    );
}

// Real adapter/state integration: new state checkpoints record the entered mode,
// restoration maps stable identities, and old stopped work cannot undo a reset.
{
    const storage = new Map();
    const w = {
        catIndex: 0,
        cats: { Cinema: [33], News: [11, 22] },
        catsArray: ["News", "Cinema"],
        channels: { 11: { rec: 24 }, 22: { rec: 24 }, 33: { rec: 24 } },
        clearTimeout() {},
        curList: [11, 22],
        medHistory: [],
        p_pref: "fixture",
        playTime: 0,
        playType: 0,
        prevArr: [],
        primaryIndex: 0,
        providerGetItem: (key) => storage.get(key) ?? null,
        providerSetItem: (key, value) => storage.set(key, value),
        setTimeout() {
            return 1;
        },
        settings: { prevCount: 2 },
        stbGetLen: () => 600,
        stbGetPosTime: () => 0,
    };
    w.window = w;
    vm.createContext(w);
    sharedCore(w);
    const api = w.__ottClassicPlayback;
    api.command({
        archiveStart: 1700000000,
        channelId: 11,
        position: 25,
        type: "archive",
    });
    assert.equal(
        JSON.parse(storage.get("playbackJournal")).bookmark.kind,
        "archive"
    );
    api.select(0, 1);
    api.command({ channelId: 22, type: "live" });
    const saved = JSON.parse(storage.get("playbackJournal"));
    assert.equal(saved.bookmark.channelId, "22");
    assert.equal(
        saved.bookmark.kind,
        "live",
        "incoming channel never inherits outgoing archive mode"
    );
    assert.equal(saved.bookmark.archiveStart, undefined);
    w.cats = { Cinema: [33], News: [22, 11] };
    w.catsArray = ["Cinema", "News"];
    w.catIndex = 0;
    w.primaryIndex = 0;
    w.curList = w.cats.Cinema;
    api.hydrate();
    assert.equal(w.catIndex, 1);
    assert.equal(w.primaryIndex, 0);
    assert.equal(w.prevArr[0].ci, 11);
    assert.equal(w.prevArr[0].c, 1);
    assert.equal(w.prevArr[0].i, 1);
    api.suspendPersistence();
    storage.clear();
    api.command({ type: "stop" });
    api.select(0, 0); // A closing classic view can still attempt to save selection.
    assert.equal(
        storage.size,
        0,
        "no legacy mirror can resurrect cleared history on next import"
    );
    api.hydrate();
    api.command({ channelId: 22, type: "live" });
    assert.equal(
        JSON.parse(storage.get("playbackJournal")).bookmark.kind,
        "live"
    );
    storage.set("playbackJournal", JSON.stringify({ version: 3 }));
    storage.set("prevArr", JSON.stringify([{ ci: 999 }]));
    w.prevArr = [{ ci: 999 }];
    api.hydrate();
    assert.deepEqual(
        plain(w.prevArr),
        [],
        "unreadable canonical data cannot reactivate stale mirrors"
    );
    api.select(0, 0);
    assert.equal(storage.get("prevArr"), JSON.stringify([{ ci: 999 }]));
    assert.equal(
        storage.get("playbackJournal"),
        JSON.stringify({ version: 3 })
    );
    // The empty OTTCLUB prefix keeps its original keys, while the managed
    // source acquires an explicit ID. Only this known anonymous source imports.
    storage.clear();
    w.p_pref = "";
    w.__ottActiveProviderDriver = { id: "ottclub" };
    const club = JSON.stringify({
        bookmark: { channelId: "22", kind: "live" },
        history: [{ channelId: "11", kind: "live", label: "Preserved" }],
        sourceId: "classic",
        updatedAt: 1700000000000,
        version: 2,
    });
    storage.set("playbackJournal", club);
    api.hydrate();
    assert.equal(
        storage.get("playbackJournal"),
        club,
        "Reading leaves legacy envelope bytes intact"
    );
    assert.equal(w.prevArr[0].ci, 11);
    api.command({ channelId: 22, type: "live" });
    const normalizedClub = JSON.parse(storage.get("playbackJournal"));
    assert.equal(normalizedClub.sourceId, "ottclub");
    assert.equal(normalizedClub.history[0].label, "Preserved");
    w.__ottActiveProviderDriver = { id: "another" };
    api.hydrate();
    assert.deepEqual(
        plain(w.prevArr),
        [],
        "Other unprefixed sources cannot import OTTCLUB history"
    );
    assert.equal(api.canMigrateJournal(), false);
    w.__ottActiveProviderDriver = { id: "ottclub" };
    storage.set(
        "playbackJournal",
        JSON.stringify({ ...normalizedClub, sourceId: "another" })
    );
    api.hydrate();
    assert.equal(
        api.canMigrateJournal(),
        false,
        "OTTCLUB alias accepts classic only"
    );
}

console.log(
    "PASS playback journal: versioned envelope, legacy import, rollback, isolation, canonical restore and reset lifetime"
);
