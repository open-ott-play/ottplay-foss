"use strict";
const storageImports =
    require("./helpers/remote-transfer-dependency.cjs").storage;
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const vm = require("node:vm");
function boot(saved = new Map()) {
    const host = {
        localStorage: {
            getItem: (key) => (saved.has(key) ? saved.get(key) : null),
            key: (index) => [...saved.keys()][index] || null,
            get length() {
                return saved.size;
            },
            removeItem: (key) => saved.delete(key),
            setItem: (key, value) => saved.set(key, String(value)),
        },
    };
    const exports = {};
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync("src/storage/index.ts", "utf8"), {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES5,
            },
        }).outputText,
        {
            ...storageImports(),
            console,
            document: { cookie: "" },
            exports,
            window: host,
        }
    );
    return { ...exports, adapter: exports.storage, host, saved };
}
{
    const f = boot(
        new Map([
            ["ottplayprov", "m3u"],
            ["offlineprimaryIndex", "3"],
            ["offlineProfiles", "saved-profile"],
        ])
    );
    const read = f.stbGetItem,
        write = f.stbSetItem;
    f.adapter.localPlayback.begin(() => "profile");
    write("localMediaPlaybackSelection", "command-folder");
    write("offlineprimaryIndex", "12");
    write("offlineplaybackJournal:offline:2", "command-bookmark");
    assert.equal(read("ottplayprov"), "offline");
    assert.equal(f.adapter.getI("offlineprimaryIndex"), 12);
    assert.equal(f.adapter.has("localMediaPlaybackSelection"), true);
    assert.equal(f.adapter.hasValue("localMediaPlaybackSelection"), true);
    assert.equal(
        read,
        f.adapter.get,
        "classic storage alias identity is retained"
    );
    assert.equal(write, f.adapter.set);
    write("sVolume", "42");
    write("localMediaEndpoint", "https://library.invalid");
    write("stalkertoken", "unchanged-auth-boundary");
    assert.equal(f.saved.get("sVolume"), "42");
    assert.equal(f.saved.get("localMediaEndpoint"), "https://library.invalid");
    assert.equal(f.saved.get("stalkertoken"), "unchanged-auth-boundary");
    assert.equal(f.adapter.dump().offlineProfiles, "saved-profile");
    assert.equal(f.adapter.dump().ottplayprov, "m3u");
    assert.equal(f.adapter.dump().offlineprimaryIndex, "3");
    assert.equal(f.adapter.dump().localMediaPlaybackSelection, undefined);
    assert.equal(f.stbGetPersistedItem("ottplayprov"), "m3u");
    const restart = boot(f.saved);
    assert.equal(restart.stbGetItem("ottplayprov"), "m3u");
    assert.equal(restart.stbGetItem("offlineprimaryIndex"), "3");
    assert.equal(restart.stbGetItem("localMediaPlaybackSelection"), null);
}
{
    const f = boot(
        new Map([
            ["ottplayprov", "offline"],
            ["offlineplaybackJournal", "previous-bookmark"],
        ])
    );
    let identity = "a";
    f.adapter.localPlayback.begin(() => identity);
    f.adapter.set("offlineplaybackJournal", "temporary");
    identity = "b";
    assert.throws(
        () => f.adapter.get("offlineplaybackJournal"),
        /session changed/
    );
    assert.throws(
        () => f.adapter.set("offlineplaybackJournal", "stale"),
        /session changed/
    );
    assert.equal(f.adapter.localPlayback.end(true), false);
    assert.equal(f.saved.get("offlineplaybackJournal"), "previous-bookmark");
    f.adapter.localPlayback.end(false);
    assert.equal(f.adapter.get("offlineplaybackJournal"), "previous-bookmark");
}
{
    const f = boot(new Map([["ottplayprov", "m3u"]]));
    f.adapter.localPlayback.begin(() => "a");
    f.adapter.set("localMediaPlaybackSelection", "chosen-folder");
    assert.equal(
        f.adapter.localPlayback.end(true, {
            key: "kiosk-policy",
            value: "explicit-policy",
        }),
        true
    );
    const restart = boot(f.saved);
    assert.equal(restart.adapter.get("ottplayprov"), "offline");
    assert.equal(
        restart.adapter.get("localMediaPlaybackSelection"),
        "chosen-folder"
    );
    assert.equal(restart.adapter.get("kiosk-policy"), "explicit-policy");
}
{
    for (const promote of [false, true]) {
        const f = boot(
            new Map([
                ["ottplayprov", "m3u"],
                ["offlineProfiles", "old-profile"],
                ["offlineplaybackJournal", "old-bookmark"],
            ])
        );
        f.adapter.localPlayback.begin(() => f.adapter.get("offlineProfiles"));
        f.adapter.set("offlineplaybackJournal", "one-off-bookmark");
        assert.equal(
            f.adapter.localPlayback.profile(
                [
                    {
                        after: "new-profile",
                        before: "old-profile",
                        key: "offlineProfiles",
                    },
                ],
                () => true,
                promote
            ),
            true
        );
        const restart = boot(f.saved);
        assert.equal(restart.adapter.get("ottplayprov"), "offline");
        assert.equal(restart.adapter.get("offlineProfiles"), "new-profile");
        assert.equal(
            restart.adapter.get("offlineplaybackJournal"),
            promote ? "one-off-bookmark" : "old-bookmark"
        );
    }
}
{
    const f = boot();
    const rollback = f.adapter.localPlayback.begin(() => "a");
    f.adapter.set("localMediaPlaybackSelection", "first");
    f.adapter.localPlayback.begin(() => "b");
    rollback();
    assert.equal(
        f.adapter.get("ottplayprov"),
        "offline",
        "stale rollback cannot retire a replacement owner"
    );
    assert.equal(
        f.adapter.transaction(
            [
                { after: "7", before: null, key: "offlineprimaryIndex" },
                { after: "12", before: null, key: "sVolume" },
            ],
            () => true
        ),
        false
    );
    assert.equal(f.saved.get("sVolume"), undefined);
    assert.equal(f.adapter.get("offlineprimaryIndex"), null);
    f.adapter.reset();
    assert.equal(f.adapter.localPlayback.active(), false);
    assert.equal(f.adapter.get("ottplayprov"), null);
    f.adapter.localPlayback.begin(() => "c");
    f.adapter.clear();
    assert.equal(f.adapter.localPlayback.active(), false);
}
{
    const f = boot();
    const adapter = f.installLocalPlaybackSession({
        clear() {},
        del() {},
        dump: () => ({}),
        get: () => null,
        reset() {},
        set() {
            throw Error("unexpected write");
        },
    });
    adapter.localPlayback.begin(() => "a");
    assert.equal(
        adapter.localPlayback.end(true),
        false,
        "unavailable durable transaction never partially promotes"
    );
    assert.equal(adapter.localPlayback.active(), true);
}
console.log(
    "PASS Local playback RAM session: restart, aliases, durable export, profile/kiosk promotion, identity, reset, atomic failure"
);
// Preview protects only the selected cursor; explicit library metadata remains durable.
for (const commit of [false, true]) {
    const key = "offlinechannelLibrary:offline";
    const original = {
        groups: ["old"],
        locks: {},
        selected: { itemId: "local-saved" },
        version: 2,
    };
    const f = boot(new Map([[key, JSON.stringify(original)]]));
    const preview = f.adapter.localPlayback.preview(() => "library");
    f.adapter.set(
        key,
        JSON.stringify({
            ...original,
            groups: ["edited"],
            selected: { itemId: "local-first" },
        })
    );
    assert.equal(JSON.parse(f.saved.get(key)).selected.itemId, "local-saved");
    assert.deepEqual(JSON.parse(f.saved.get(key)).groups, ["edited"]);
    const before = f.adapter.get(key);
    const after = JSON.stringify({
        ...JSON.parse(before),
        groups: ["transaction-edit"],
        locks: { one: true },
    });
    assert.equal(
        f.adapter.transaction([{ after, before, key }], () => true),
        true
    );
    assert.equal(JSON.parse(f.saved.get(key)).selected.itemId, "local-saved");
    assert.equal(JSON.parse(f.adapter.get(key)).selected.itemId, "local-first");
    assert.deepEqual(JSON.parse(f.saved.get(key)).groups, ["transaction-edit"]);
    assert.deepEqual(JSON.parse(f.saved.get(key)).locks, { one: true });
    if (commit) assert.equal(preview.commit(), true);
    else preview.discard();
    const restored = JSON.parse(boot(f.saved).adapter.get(key));
    assert.equal(
        restored.selected.itemId,
        commit ? "local-first" : "local-saved"
    );
    assert.deepEqual(restored.groups, ["transaction-edit"]);
    assert.deepEqual(restored.locks, { one: true });
}
console.log(
    "PASS preview channel-library metadata survives direct writes, native transactions, discard and selected commit"
);

// Explicit sort changes persist while a startup cursor is protected.
{
    const key = "offlinesSortAbc";
    const f = boot(new Map([[key, "0"]]));
    let preview = f.adapter.localPlayback.preview(() => "library");
    f.adapter.set(key, "1");
    preview.discard();
    assert.equal(boot(f.saved).adapter.get(key), "1");
    preview = f.adapter.localPlayback.preview(() => "library");
    assert.equal(
        f.adapter.transaction([{ after: "0", before: "1", key }], () => true),
        true
    );
    preview.discard();
    assert.equal(boot(f.saved).adapter.get(key), "0");
    const discard = f.adapter.localPlayback.begin(() => "remote");
    f.adapter.set(key, "1");
    assert.equal(f.adapter.get(key), "1");
    discard();
    assert.equal(boot(f.saved).adapter.get(key), "0");
}
console.log(
    "PASS preview sort changes remain durable; remote session sort stays isolated"
);
// A competing metadata writer must never become a fresh CAS baseline mid-write.
for (const operation of ["transaction", "commit", "profile"]) {
    const key = "offlinechannelLibrary:offline";
    const original = {
        groups: ["old"],
        locks: {},
        selected: { itemId: "local-saved" },
        version: 2,
    };
    const competitor = JSON.stringify({
        ...original,
        groups: ["competitor"],
        locks: { protected: true },
    });
    const f = boot(new Map([[key, JSON.stringify(original)]]));
    const preview = f.adapter.localPlayback.preview(() => "library");
    f.adapter.set(
        key,
        JSON.stringify({ ...original, selected: { itemId: "local-first" } })
    );
    const before = f.adapter.get(key);
    const after = JSON.stringify({
        ...JSON.parse(before),
        groups: ["transaction"],
    });
    const getItem = f.host.localStorage.getItem;
    let reads = 0;
    f.host.localStorage.getItem = (readKey) => {
        if (readKey === key && ++reads === 2) f.saved.set(key, competitor);
        return getItem(readKey);
    };
    let accepted = false;
    try {
        accepted =
            operation === "transaction"
                ? f.adapter.transaction([{ after, before, key }], () => true)
                : operation === "commit"
                  ? preview.commit()
                  : f.adapter.localPlayback.profile(
                        [
                            {
                                after: "new-profile",
                                before: null,
                                key: "offlineProfiles",
                            },
                        ],
                        () => true,
                        true
                    );
    } catch (error) {
        assert.match(String(error), /changed|mismatch|current/i);
    }
    assert.equal(accepted, false, operation);
    assert.equal(reads >= 2, true, operation);
    assert.equal(f.saved.get(key), competitor, operation);
    assert.equal(JSON.parse(f.adapter.get(key)).selected.itemId, "local-first");
    assert.equal(f.saved.get("offlineProfiles"), undefined);
    preview.discard();
    assert.equal(f.saved.get(key), competitor, operation);
}
console.log(
    "PASS preview transaction, commit and profile reject concurrent library metadata edits"
);
