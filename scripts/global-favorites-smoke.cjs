"use strict";
// Hosted transport fixture, not browser/native persistence qualification.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {
    createMainPorts,
} = require("../tests/helpers/global-favorites-main-ports.cjs");

function install(w, emitted, runtime, configuration) {
    const data = new Map([["m3um3uArr", JSON.stringify(configuration)]]);
    const writes = [];
    const modules = new Map();
    let active = true;
    let held = false;
    let tail = Promise.resolve();
    const read = (key) => (data.has(key) ? data.get(key) : null);
    // Only the physical persistence/environment ports are synthetic. The
    // actual host, portable codec, facade, transaction and receipt stores run
    // from the same project-compiled output as remote-requests.ts.
    const grant = Object.freeze({
        compareAndSwap(key, before, after, admitted) {
            assert(
                held,
                "persistent writes require the captured exclusive lock"
            );
            if (!active || (admitted && !admitted()) || read(key) !== before)
                return "conflict";
            assert.equal(typeof after, "string");
            writes.push(key);
            data.set(key, after);
            return "confirmed";
        },
        current: () => active,
        exclusive(work) {
            const run = tail.then(async () => {
                assert(!held);
                held = true;
                try {
                    return await work(grant);
                } finally {
                    held = false;
                }
            });
            tail = run.then(
                () => undefined,
                () => undefined
            );
            return run;
        },
        implementationVersion: 1,
        kind: "synchronous-localstorage",
        lockName: "ottplay:favorites-ledger",
        origin: "https://transport-fixture.invalid",
        privateLedgerKey: "favorites-receipts.v1",
        read,
    });
    w._ = (text) => text;
    w.p_pref = "m3u";
    w.stbGetItem = read;
    w.stbGetPersistedItem = read;
    function load(relative) {
        const file = path.resolve(emitted, relative);
        assert(file.startsWith(path.resolve(emitted) + path.sep));
        if (modules.has(file)) return modules.get(file);
        const exports = {};
        modules.set(file, exports);
        vm.runInNewContext(
            fs.readFileSync(file, "utf8"),
            {
                console,
                exports,
                Promise,
                require(name) {
                    assert(
                        name.startsWith("."),
                        "unexpected optional runtime dependency"
                    );
                    return load(
                        path.relative(
                            emitted,
                            path.resolve(path.dirname(file), name + ".js")
                        )
                    );
                },
                Uint8Array,
                URL,
                window: w,
            },
            { filename: file }
        );
        return exports;
    }
    const ports = {
        ...createMainPorts(w),
        authorized: () => active,
        base64Decode: (text) => new Uint8Array(Buffer.from(text, "base64")),
        base64Encode: (bytes) => Buffer.from(bytes).toString("base64"),
        capture: () => grant,
        captureLegacy: async () => {
            throw Error("unexpected legacy capture");
        },
        current: () => active,
        now: Date.now,
        playLegacy: () => {
            throw Error("unexpected legacy playback");
        },
        runtime,
        sha256: async (value) =>
            crypto
                .createHash("sha256")
                .update(typeof value === "string" ? value : Buffer.from(value))
                .digest("hex"),
        uuid: crypto.randomUUID,
    };
    const host = load(
        "media/global-favorites-host.js"
    ).createGlobalFavoritesHost(w, ports);
    w.__ottGlobalFavorites = host;
    w.__ottGlobalFavoritesFacade = host.facade;
    w.__ottGlobalFavoritesPorts = { runtime };
    w.__ottGlobalFavoritesProtocol = host.protocol;
    w.__ottGlobalFavoritesRecovery = host.recovery;
    return {
        dispose() {
            host.dispose();
            active = false;
        },
        snapshot: () => Array.from(data),
        writes: () => writes.slice(),
    };
}

async function exercise({
    dir,
    fault,
    jsonOn,
    submissions,
    television,
    desktop,
}) {
    const fixture = JSON.parse(
        fs.readFileSync(
            path.join(
                __dirname,
                "../tests/fixtures/global-mixed-sequence.json"
            ),
            "utf8"
        )
    );
    const document = fixture.portable_document;
    assert.equal(document.entries.length, 5);
    const source = path.join(dir, "global-input.json");
    const output = path.join(dir, "global-export.json");
    fs.writeFileSync(source, JSON.stringify(document), { mode: 0o600 });
    const localConfig = fs.readFileSync(path.join(dir, "cli.json"));
    const tv = television().global();
    const other = desktop().global();
    const before = tv.snapshot();
    const foreignBefore = other.snapshot();
    const requestStart = submissions.length;
    const ops = () =>
        submissions
            .slice(requestStart)
            .filter((row) => row.action === "favorites_global")
            .map((row) => row.op);
    const count = (op) => ops().filter((value) => value === op).length;

    const empty = await jsonOn("tv", "fav", "global", "list");
    assert.equal(empty.collection, "global");
    assert.equal(empty.total, 0);
    assert.deepEqual(empty.entries, []);
    assert.equal(empty.unresolved_legacy_count, 0);
    const preview = await jsonOn(
        "tv",
        "fav",
        "global",
        "import",
        source,
        "replace",
        "--dry-run"
    );
    assert.equal(preview.status, "planned");
    assert.equal(preview.ready, true);
    assert.equal(preview.cleanup, "aborted");
    assert.equal(preview.summary.added, 5);
    // No target mappings are configured. Valid portable data must survive as
    // unresolved metadata, rather than gaining a synthetic playback target.
    assert.deepEqual(preview.resolution, {
        ambiguous: 0,
        missing: 5,
        resolved: 0,
        unsupported: 0,
    });
    assert.equal(preview.replay_allowed, false);
    assert.deepEqual(
        tv.snapshot(),
        before,
        "preview/abort writes no persistent store or ledger"
    );
    assert.deepEqual(tv.writes(), []);
    assert.equal(count("commit"), 0);
    assert.equal(count("abort"), 1);
    assert.equal(
        fs
            .readdirSync(dir)
            .filter((name) => name.startsWith(".favorites-global-operations-"))
            .length,
        0
    );

    fault.armed = true;
    const changed = await jsonOn(
        "tv",
        "fav",
        "global",
        "import",
        source,
        "replace"
    );
    assert.equal(
        fault.corrupted,
        1,
        "a real completed commit receipt must cross the proxy"
    );
    assert.equal(fault.original.id, fault.requestId);
    assert.equal(fault.original.status, "ok");
    assert.equal(fault.original.data.op, "commit");
    assert.equal(fault.original.data.receipt.outcome, "verified");
    assert.equal(changed.status, "verified");
    assert.equal(changed.verified, true);
    assert.equal(changed.replay_allowed, false);
    assert.deepEqual(changed.warnings, []);
    assert.match(changed.operation_id, /^[0-9a-f-]{36}$/);
    assert.equal(changed.operation_id, fault.original.data.operation_id);
    assert.equal(
        count("commit"),
        1,
        "a malformed/lost receipt never resends commit"
    );
    assert.equal(
        count("begin"),
        2,
        "one preview stage plus one committed stage"
    );
    assert.equal(
        count("append"),
        2,
        "the small fixture is sent once in each stage"
    );
    assert.equal(
        fs
            .readdirSync(dir)
            .filter((name) => name.startsWith(".favorites-global-operations-"))
            .length,
        1
    );
    assert.equal(
        count("status"),
        1,
        "the uncertain commit is reconciled once through the real read-only RPC"
    );
    assert.equal(
        tv.writes().filter((key) => key === "remoteFavorites.v1").length,
        1
    );
    assert.equal(
        submissions
            .slice(requestStart)
            .filter(
                (row) =>
                    row.action === "favorites_global_recovery" &&
                    row.op === "acknowledge"
            ).length,
        0
    );
    assert.deepEqual(
        other.snapshot(),
        foreignBefore,
        "another device's store remains isolated"
    );

    // A separate actual CLI process must reload the durable context from disk.
    const writesAfterCommit = tv.writes();
    const status = await jsonOn(
        "tv",
        "fav",
        "global",
        "status",
        changed.operation_id
    );
    assert.equal(status.status, "verified");
    assert.equal(status.operation_id, changed.operation_id);
    assert.equal(status.verified, true);
    assert.equal(status.replay_allowed, false);
    assert.deepEqual(status.warnings, []);
    assert.equal(count("commit"), 1);
    assert.equal(count("status"), 2);
    assert.deepEqual(
        tv.writes(),
        writesAfterCommit,
        "status must not rewrite the player's stores"
    );

    const listing = await jsonOn("tv", "fav", "global", "list");
    assert.equal(listing.total, 5);
    assert.equal(listing.collection, "global");
    assert.deepEqual(
        listing.entries.map((row) => row.entry),
        document.entries
    );
    assert.equal(new Set(listing.entries.map((row) => row.id)).size, 5);
    listing.entries.forEach((row) =>
        assert.match(
            row.id,
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        )
    );
    const exported = await jsonOn("tv", "fav", "global", "export", output);
    assert.equal(exported.status, "exported");
    assert.equal(exported.entries, 5);
    const bytes = fs.readFileSync(output);
    assert.deepEqual(JSON.parse(bytes), document);
    assert.equal(
        crypto.createHash("sha256").update(bytes).digest("hex"),
        exported.document_sha256
    );
    assert.deepEqual(tv.writes(), writesAfterCommit);
    assert.equal((await jsonOn("mac", "fav", "global", "list")).total, 0);
    assert.deepEqual(other.snapshot(), foreignBefore);
    assert.deepEqual(fs.readFileSync(path.join(dir, "cli.json")), localConfig);
    assert.equal(
        submissions
            .slice(requestStart)
            .filter(
                (row) =>
                    row.action === "favorites" ||
                    (row.action === "favorites_global_items" &&
                        row.op === "play")
            ).length,
        0,
        "this scenario neither falls back to legacy nor starts playback"
    );
    console.log(
        "PASS Global Favorites: actual Python CLI -> HTTP proxy -> Go controller -> compiled player wrappers/host; five-item unresolved mixed import/export order, no-write preview, one commit/effect despite malformed completed receipt, durable-context status and device isolation (synthetic storage only; no provider playback or browser/native qualification)"
    );
}

module.exports = { exercise, install };
