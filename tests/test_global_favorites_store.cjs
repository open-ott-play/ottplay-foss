const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
function load(file, dependency = {}) {
    const exports = {};
    vm.runInNewContext(
        ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
            compilerOptions: {
                target: ts.ScriptTarget.ES5,
                module: ts.ModuleKind.CommonJS,
            },
        }).outputText,
        { exports, require: () => dependency, Uint8Array }
    );
    return exports;
}
const json = load("src/commands/favorites-document-json.ts");
const { createGlobalFavoritesStore } = load(
    "src/settings/global-favorites.ts",
    json
);
const plain = (value) => JSON.parse(JSON.stringify(value));
const entry = (provider, profile, id) => ({
    title: id,
    origin: { provider, profile, subprofile: null, sourceAlias: profile },
    locator: { kind: "test", id },
});
function fixture(initial = null, actualCodec = null) {
    let raw = initial,
        active = true,
        held = false,
        serial = 0;
    const writes = [],
        hooks = {};
    const grant = {
        current: () => active,
        read(key) {
            assert.equal(key, "remoteFavorites.v1");
            return raw;
        },
        async exclusive(work) {
            if (held) throw Error("busy");
            held = true;
            try {
                return await work(grant);
            } finally {
                held = false;
            }
        },
        compareAndSwap(key, before, after, admission) {
            assert(held);
            assert.equal(key, "remoteFavorites.v1");
            if (hooks.prewrite) hooks.prewrite();
            if (
                !active ||
                !admission() ||
                raw !== before ||
                hooks.mode === "conflict"
            )
                return "conflict";
            writes.push(after);
            raw = hooks.mode === "corrupt" ? "corrupt" : after;
            return hooks.mode === "unknown" ? "unknown" : "confirmed";
        },
    };
    const store = createGlobalFavoritesStore({
        capture: () => grant,
        current: () => active,
        async sha256(text) {
            if (hooks.hash) await hooks.hash();
            return crypto.createHash("sha256").update(text).digest("hex");
        },
        migrationCurrent: () => !hooks.migrationLost,
        uuid: () =>
            "00000000-0000-4000-8000-" + String(++serial).padStart(12, "0"),
        codec: actualCodec || {
            normalize(value) {
                return value.origin &&
                    value.locator &&
                    value.locator.kind === "test" &&
                    value.locator.id &&
                    !/:\/\//.test(value.locator.id)
                    ? plain(value)
                    : null;
            },
            identity: (value) => JSON.stringify([value.origin, value.locator]),
            migrateLegacy: (row) =>
                row.id === "fav-map" ? entry("m3u", "mapped", "stable") : null,
        },
    });
    return {
        store,
        hooks,
        writes,
        raw: () => raw,
        replace: (value) => {
            raw = value;
        },
        deactivate: () => {
            active = false;
        },
    };
}
async function main() {
    const f = fixture(),
        first = await f.store.snapshot();
    assert.equal(f.raw(), null);
    assert.equal(f.writes.length, 0);
    const mixed = [
        entry("local", "local", "movie"),
        entry("m3u", "one", "channel"),
        entry("vportal", "portal", "film"),
        entry("plex", "plex", "film"),
        entry("m3u", "two", "channel"),
    ];
    assert.equal(
        (await f.store.mutate(first.revision, { op: "put", entries: mixed }))
            .outcome,
        "verified"
    );
    let view = await f.store.snapshot();
    assert.deepEqual(
        Array.from(view.entries, (x) => x.origin.profile),
        ["local", "one", "portal", "plex", "two"]
    );
    await assert.rejects(
        f.store.mutate(first.revision, { op: "put", entries: mixed }),
        /revision_conflict/
    );
    assert.equal(f.writes.length, 1);
    await f.store.mutate(view.revision, { op: "put", entries: mixed });
    assert.equal(f.writes.length, 1, "dedup is not another write");
    const ids = Array.from(view.entries, (x) => x.id).reverse();
    await f.store.mutate(view.revision, { op: "reorder", ids });
    view = await f.store.snapshot();
    assert.deepEqual(
        Array.from(view.entries, (x) => x.id),
        ids
    );
    const exported = await f.store.portableSnapshot();
    assert.deepEqual(Object.keys(exported).sort(), ["entries", "version"]);
    assert.equal(JSON.stringify(exported).includes("00000000-0000"), false);
    const migration = fixture();
    view = await migration.store.snapshot();
    await migration.store.mutate(view.revision, {
        op: "migrate-source",
        migrationId: "a".repeat(64),
        entries: [mixed[0]],
    });
    view = await migration.store.snapshot();
    await migration.store.mutate(view.revision, {
        op: "remove",
        ids: [view.entries[0].id],
    });
    view = await migration.store.snapshot();
    const count = migration.writes.length;
    await migration.store.mutate(view.revision, {
        op: "migrate-source",
        migrationId: "a".repeat(64),
        entries: [mixed[0]],
    });
    assert.equal(migration.writes.length, count);
    assert.equal((await migration.store.snapshot()).entries.length, 0);
    const legacyRow = (id) => ({
        id,
        name: "legacy",
        title: "Legacy",
        profile_name: "Old",
        profile_number: 1,
        provider: "m3u",
        kind: "live",
        source: "private-local-source",
        ref: { itemId: "old-reference" },
    });
    const raw = JSON.stringify({
        version: 1,
        entries: [legacyRow("fav-map"), legacyRow("fav-unresolved")],
    });
    const old = fixture(raw);
    view = await old.store.snapshot();
    assert.equal(view.legacyCount, 2);
    assert.equal(old.raw(), raw);
    await old.store.mutate(view.revision, { op: "migrate-legacy" });
    assert.deepEqual(JSON.parse(old.raw()).legacy, [
        legacyRow("fav-map"),
        legacyRow("fav-unresolved"),
    ]);
    assert.equal(Object.keys(JSON.parse(old.raw()).legacyAliases).length, 1);
    await assert.rejects(old.store.portableSnapshot(), /unportable_export/);
    for (const mode of ["conflict", "unknown", "corrupt"]) {
        const x = fixture(),
            rev = (await x.store.snapshot()).revision;
        x.hooks.mode = mode;
        const outcome = await x.store.mutate(rev, {
            op: "put",
            entries: [mixed[0]],
        });
        assert.equal(
            outcome.outcome,
            mode === "conflict" ? "not_applied" : "unknown"
        );
        assert.equal(x.writes.length, mode === "conflict" ? 0 : 1);
    }
    const lost = fixture(),
        rev = (await lost.store.snapshot()).revision;
    lost.hooks.hash = async () => lost.deactivate();
    await assert.rejects(
        lost.store.mutate(rev, { op: "put", entries: [mixed[0]] }),
        /revision_conflict/
    );
    assert.equal(lost.writes.length, 0);
    const bad = fixture(),
        blank = (await bad.store.snapshot()).revision;
    await assert.rejects(
        bad.store.mutate(blank, {
            op: "put",
            entries: [
                entry("plex", "P", "https://access.invalid/?token=secret"),
            ],
        }),
        /unsupported_entry/
    );
    await assert.rejects(
        bad.store.mutate(blank, {
            op: "put",
            entries: new Array(1001).fill(mixed[0]),
        }),
        /limits_exceeded/
    );
    assert.equal(bad.writes.length, 0);
    const incomplete = fixture(),
        initialRevision = (await incomplete.store.snapshot()).revision;
    const incompleteRaw = incomplete.raw(),
        incompleteWrites = incomplete.writes.length;
    incomplete.hooks.migrationLost = true;
    // Admission/revision guards reject this source before apply can migrate it.
    await assert.rejects(
        incomplete.store.mutate(initialRevision, {
            op: "migrate-source",
            migrationId: "b".repeat(64),
            entries: [mixed[0]],
        }),
        (error) => error.message === "revision_conflict"
    );
    assert.equal(
        incomplete.raw(),
        incompleteRaw,
        "pre-admission failure preserves exact raw storage"
    );
    assert.equal(
        incomplete.writes.length,
        incompleteWrites,
        "pre-admission failure writes nothing"
    );
    assert.equal(
        incomplete.raw(),
        null,
        "incomplete source cannot create a migration marker"
    );
    const guard = fixture(),
        stable = await guard.store.snapshot();
    assert.equal(stable.current(), true);
    guard.replace(
        JSON.stringify({ version: 2, entries: [], legacy: [], migrations: [] })
    );
    assert.equal(
        stable.current(),
        false,
        "exact raw drift revokes snapshot guard"
    );
    const owner = fixture(),
        owned = await owner.store.snapshot();
    owner.deactivate();
    assert.equal(
        owned.current(),
        false,
        "physical/auth owner loss revokes snapshot guard"
    );
    const actualCodec = load(
        "src/settings/global-favorites-portable.ts"
    ).createGlobalFavoritesPortableCodec();
    const real = fixture(null, actualCodec),
        emptyView = await real.store.snapshot();
    const origin = (provider, profile) => ({
        provider,
        profile,
        subprofile: null,
        sourceAlias: profile,
    });
    const items = [
        {
            title: "Local film",
            origin: origin("local", "Movies"),
            locator: {
                kind: "local-media",
                rootAlias: "Movies",
                relativePath: "Films/film.mkv",
            },
        },
        {
            title: "TV one",
            origin: origin("m3u", "Profile one"),
            locator: { kind: "channel", channelId: "001" },
        },
        {
            title: "Portal film",
            origin: origin("vportal", "Portal"),
            locator: { kind: "vportal-media", idField: "id", id: "film-42" },
        },
        {
            title: "Plex film",
            origin: origin("plex", "Plex"),
            locator: { kind: "plex-media", serverId: "PMS_1", ratingKey: "42" },
        },
        {
            title: "TV two",
            origin: origin("m3u", "Profile two"),
            locator: { kind: "channel", channelId: "001" },
        },
    ];
    assert.equal(
        (
            await real.store.mutate(emptyView.revision, {
                op: "put",
                entries: items,
            })
        ).outcome,
        "verified"
    );
    assert.equal(
        emptyView.current(),
        false,
        "confirmed list write revokes prior snapshot"
    );
    const realView = await real.store.snapshot();
    assert.equal(realView.entries.length, 5);
    assert.equal(realView.current(), true);
    assert(
        actualCodec.document(await real.store.portableSnapshot()),
        "actual portable codec accepts stored mixed export"
    );
    assert.equal(
        Object.hasOwn(await real.store.portableSnapshot(), "current"),
        false,
        "private guard is not exported"
    );
    await real.store.mutate(realView.revision, {
        op: "put",
        entries: [{ ...items[1], title: "Renamed" }],
    });
    assert.equal(
        (await real.store.snapshot()).entries.length,
        5,
        "actual codec identity ignores label and preserves profile distinction"
    );
    const duplicate = fixture(
        '{"version":2,"version":2,"entries":[],"legacy":[],"migrations":[]}'
    );
    await assert.rejects(duplicate.store.snapshot());
    assert.equal(duplicate.writes.length, 0);
    console.log(
        "PASS global favorites store: mixed order/dedup, exact revision/CAS, private legacy preservation, one-time migration and fail-closed writes"
    );
}
module.exports = { fixture, entry, load };
if (require.main === module)
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
