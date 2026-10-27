"use strict";
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
        { console, document: { cookie: "" }, exports, window: host }
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
