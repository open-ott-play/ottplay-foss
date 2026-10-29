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
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES5,
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
// biome-ignore assist/source/useSortedKeys: The fixture identity function serializes these fields in insertion order.
const entry = (provider, profile, id) => ({
    title: id,
    // biome-ignore assist/source/useSortedKeys: The fixture identity function serializes these fields in insertion order.
    origin: { provider, profile, subprofile: null, sourceAlias: profile },
    // biome-ignore assist/source/useSortedKeys: The fixture identity function serializes these fields in insertion order.
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
        current: () => active,
        async exclusive(work) {
            if (held) throw Error("busy");
            held = true;
            try {
                return await work(grant);
            } finally {
                held = false;
            }
        },
        read(key) {
            assert.equal(key, "remoteFavorites.v1");
            return raw;
        },
    };
    const store = createGlobalFavoritesStore({
        capture: () => grant,
        codec: actualCodec || {
            identity: (value) => JSON.stringify([value.origin, value.locator]),
            migrateLegacy: (row) =>
                row.id === "fav-map" ? entry("m3u", "mapped", "stable") : null,
            normalize(value) {
                return value.origin &&
                    value.locator &&
                    value.locator.kind === "test" &&
                    value.locator.id &&
                    !/:\/\//.test(value.locator.id)
                    ? plain(value)
                    : null;
            },
        },
        current: () => active,
        migrationCurrent: () => !hooks.migrationLost,
        async sha256(text) {
            if (hooks.hash) await hooks.hash();
            return crypto.createHash("sha256").update(text).digest("hex");
        },
        uuid: () =>
            "00000000-0000-4000-8000-" + String(++serial).padStart(12, "0"),
    });
    return {
        deactivate: () => {
            active = false;
        },
        hooks,
        raw: () => raw,
        replace: (value) => {
            raw = value;
        },
        store,
        writes,
    };
}
async function main() {
    const identityRemoval = fixture(),
        original = entry("m3u", "A", "one");
    let identityView = await identityRemoval.store.snapshot();
    await identityRemoval.store.mutate(identityView.revision, {
        entries: [original],
        op: "put",
    });
    identityView = await identityRemoval.store.snapshot();
    await identityRemoval.store.mutate(identityView.revision, {
        ids: [identityView.entries[0].id],
        op: "remove",
    });
    identityView = await identityRemoval.store.snapshot();
    await identityRemoval.store.mutate(identityView.revision, {
        entries: [
            { entry: { ...original, title: "Renamed" }, token: "d".repeat(64) },
        ],
        migrationId: "c".repeat(64),
        op: "migrate-membership",
    });
    assert.equal(
        (await identityRemoval.store.snapshot()).entries.length,
        0,
        "different source token and title cannot resurrect removed portable identity"
    );
    identityView = await identityRemoval.store.snapshot();
    const different = entry("m3u", "B", "one");
    await identityRemoval.store.mutate(identityView.revision, {
        entries: [different],
        migrationId: "e".repeat(64),
        op: "migrate-source",
    });
    assert.equal(
        (await identityRemoval.store.snapshot()).entries.length,
        1,
        "another profile is not suppressed"
    );
    identityView = await identityRemoval.store.snapshot();
    await identityRemoval.store.mutate(identityView.revision, {
        entries: [original],
        op: "replace",
    });
    identityView = await identityRemoval.store.snapshot();
    assert.equal(
        identityView.entries[0].origin.profile,
        "A",
        "explicit import/replace re-adds A"
    );
    await identityRemoval.store.mutate(identityView.revision, {
        entries: [different],
        migrationId: "f".repeat(64),
        op: "migrate-source",
    });
    assert.equal(
        (await identityRemoval.store.snapshot()).entries.length,
        1,
        "replace omission suppresses B migration"
    );
    identityView = await identityRemoval.store.snapshot();
    await identityRemoval.store.mutate(identityView.revision, {
        ids: [identityView.entries[0].id],
        op: "remove",
    });
    identityView = await identityRemoval.store.snapshot();
    await identityRemoval.store.mutate(identityView.revision, {
        entries: [original],
        op: "put",
    });
    assert.equal(
        (await identityRemoval.store.snapshot()).entries.length,
        1,
        "explicit Add clears only its own suppression"
    );
    const pressureRaw = JSON.parse(identityRemoval.raw());
    pressureRaw.migrations = Array.from({ length: 8192 }, (_, index) =>
        index.toString(16).padStart(64, "0")
    );
    identityRemoval.replace(JSON.stringify(pressureRaw));
    identityView = await identityRemoval.store.snapshot();
    const pressureBefore = identityRemoval.raw(),
        pressureWrites = identityRemoval.writes.length;
    await assert.rejects(
        identityRemoval.store.mutate(identityView.revision, {
            ids: [identityView.entries[0].id],
            op: "remove",
        }),
        /limits_exceeded/
    );
    assert.equal(identityRemoval.raw(), pressureBefore);
    assert.equal(
        identityRemoval.writes.length,
        pressureWrites,
        "suppression pressure refuses the entire CAS"
    );

    const forgotten = fixture(),
        token = "a".repeat(64),
        forgottenEntry = entry("m3u", "Profile", "one");
    let forgetView = await forgotten.store.snapshot();
    await forgotten.store.mutate(forgetView.revision, {
        ids: [],
        op: "forget-membership",
        tokens: [token],
    });
    forgetView = await forgotten.store.snapshot();
    await forgotten.store.mutate(forgetView.revision, {
        entries: [{ entry: forgottenEntry, token }],
        migrationId: "b".repeat(64),
        op: "migrate-membership",
    });
    assert.equal(
        (await forgotten.store.snapshot()).entries.length,
        0,
        "durable removal prevents deferred legacy migration"
    );
    forgetView = await forgotten.store.snapshot();
    assert.equal(
        (
            await forgotten.store.mutate(forgetView.revision, {
                ids: [],
                op: "forget-membership",
                tokens: [token],
            })
        ).changed,
        false
    );
    await forgotten.store.mutate(forgetView.revision, {
        entries: [forgottenEntry],
        op: "put",
    });
    forgetView = await forgotten.store.snapshot();
    assert.equal(
        forgetView.entries.length,
        1,
        "explicit add is not blocked by migration tombstone"
    );
    await forgotten.store.mutate(forgetView.revision, {
        ids: [forgetView.entries[0].id],
        op: "forget-membership",
        tokens: [token],
    });
    assert.equal((await forgotten.store.snapshot()).entries.length, 0);

    const release = fixture(),
        releaseEntry = entry("m3u", "A", "re-add"),
        removedEntry = entry("m3u", "B", "removed");
    let releaseView = await release.store.snapshot();
    await release.store.mutate(releaseView.revision, {
        entries: [removedEntry],
        op: "put",
    });
    const releaseRaw = JSON.parse(release.raw());
    const releaseToken = crypto
        .createHash("sha256")
        .update(
            JSON.stringify([
                "global-favorites-removed-identity-v1",
                JSON.stringify([releaseEntry.origin, releaseEntry.locator]),
            ])
        )
        .digest("hex");
    releaseRaw.migrations = [
        releaseToken,
        ...Array.from({ length: 8191 }, (_, index) =>
            (index + 1).toString(16).padStart(64, "0")
        ),
    ];
    release.replace(JSON.stringify(releaseRaw));
    releaseView = await release.store.snapshot();
    await release.store.mutate(releaseView.revision, {
        entries: [releaseEntry],
        op: "replace",
    });
    assert.equal(
        (await release.store.snapshot()).entries[0].origin.profile,
        "A"
    );
    assert.equal(
        JSON.parse(release.raw()).migrations.length,
        8192,
        "clear explicit re-add marker before reserving omission marker"
    );
    const drift = fixture();
    let driftView = await drift.store.snapshot();
    await drift.store.mutate(driftView.revision, {
        entries: [removedEntry],
        op: "put",
    });
    driftView = await drift.store.snapshot();
    const driftWrites = drift.writes.length;
    let hashCalls = 0,
        changedRaw;
    drift.hooks.hash = () => {
        if (++hashCalls === 2) {
            changedRaw = drift.raw() + " ";
            drift.replace(changedRaw);
        }
    };
    await assert.rejects(
        drift.store.mutate(driftView.revision, {
            ids: [driftView.entries[0].id],
            op: "remove",
        }),
        /revision_conflict/
    );
    assert.equal(drift.raw(), changedRaw);
    assert.equal(
        drift.writes.length,
        driftWrites,
        "async identity hash cannot overwrite a concurrent revision"
    );
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
        (await f.store.mutate(first.revision, { entries: mixed, op: "put" }))
            .outcome,
        "verified"
    );
    let view = await f.store.snapshot();
    assert.deepEqual(
        Array.from(view.entries, (x) => x.origin.profile),
        ["local", "one", "portal", "plex", "two"]
    );
    await assert.rejects(
        f.store.mutate(first.revision, { entries: mixed, op: "put" }),
        /revision_conflict/
    );
    assert.equal(f.writes.length, 1);
    await f.store.mutate(view.revision, { entries: mixed, op: "put" });
    assert.equal(f.writes.length, 1, "dedup is not another write");
    const ids = Array.from(view.entries, (x) => x.id).reverse();
    await f.store.mutate(view.revision, { ids, op: "reorder" });
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
        entries: [mixed[0]],
        migrationId: "a".repeat(64),
        op: "migrate-source",
    });
    view = await migration.store.snapshot();
    await migration.store.mutate(view.revision, {
        ids: [view.entries[0].id],
        op: "remove",
    });
    view = await migration.store.snapshot();
    const count = migration.writes.length;
    await migration.store.mutate(view.revision, {
        entries: [mixed[0]],
        migrationId: "a".repeat(64),
        op: "migrate-source",
    });
    assert.equal(migration.writes.length, count);
    assert.equal((await migration.store.snapshot()).entries.length, 0);
    // biome-ignore assist/source/useSortedKeys: Preserve legacy raw bytes in the no-write migration baseline.
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
    // biome-ignore assist/source/useSortedKeys: Preserve legacy raw bytes in the no-write migration baseline.
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
            entries: [mixed[0]],
            op: "put",
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
        lost.store.mutate(rev, { entries: [mixed[0]], op: "put" }),
        /revision_conflict/
    );
    assert.equal(lost.writes.length, 0);
    const bad = fixture(),
        blank = (await bad.store.snapshot()).revision;
    await assert.rejects(
        bad.store.mutate(blank, {
            entries: [
                entry("plex", "P", "https://access.invalid/?token=secret"),
            ],
            op: "put",
        }),
        /unsupported_entry/
    );
    await assert.rejects(
        bad.store.mutate(blank, {
            entries: new Array(1001).fill(mixed[0]),
            op: "put",
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
            entries: [mixed[0]],
            migrationId: "b".repeat(64),
            op: "migrate-source",
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
        // biome-ignore assist/source/useSortedKeys: Preserve the exact raw replacement used by the stale-snapshot guard.
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
        profile,
        provider,
        sourceAlias: profile,
        subprofile: null,
    });
    const items = [
        {
            locator: {
                kind: "local-media",
                relativePath: "Films/film.mkv",
                rootAlias: "Movies",
            },
            origin: origin("local", "Movies"),
            title: "Local film",
        },
        {
            locator: { channelId: "001", kind: "channel" },
            origin: origin("m3u", "Profile one"),
            title: "TV one",
        },
        {
            locator: { id: "film-42", idField: "id", kind: "vportal-media" },
            origin: origin("vportal", "Portal"),
            title: "Portal film",
        },
        {
            locator: { kind: "plex-media", ratingKey: "42", serverId: "PMS_1" },
            origin: origin("plex", "Plex"),
            title: "Plex film",
        },
        {
            locator: { channelId: "001", kind: "channel" },
            origin: origin("m3u", "Profile two"),
            title: "TV two",
        },
    ];
    assert.equal(
        (
            await real.store.mutate(emptyView.revision, {
                entries: items,
                op: "put",
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
        entries: [{ ...items[1], title: "Renamed" }],
        op: "put",
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
module.exports = { entry, fixture, load };
if (require.main === module)
    main().catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
