const assert = require("node:assert/strict");
const { fixture, row } = require("./global-favorites-fixture.cjs");
async function main() {
    const f = fixture(),
        full = Array.from({ length: 1000 }, (_, i) => ({
            ...row("Item " + i),
            locator: { kind: "channel", channelId: String(i) },
        }));
    let view = await f.store.snapshot();
    await f.store.mutate(view.revision, { op: "put", entries: full });
    view = await f.store.snapshot();
    assert.equal(view.entries.length, 1000);
    await f.store.mutate(view.revision, {
        op: "replace",
        entries: [
            {
                ...row("Replacement"),
                locator: { kind: "channel", channelId: "new" },
            },
        ],
    });
    view = await f.store.snapshot();
    assert.equal(view.entries.length, 1);
    assert.equal(view.entries[0].title, "Replacement");
    function legacy(id) {
        return {
            id,
            name: id,
            title: id,
            provider: "m3u",
            profile_name: "TV",
            profile_number: 1,
            source: "private",
            kind: "live",
            ref: { itemId: id },
        };
    }
    const mixed = fixture();
    mixed.data.set(
        "remoteFavorites.v1",
        JSON.stringify({
            version: 1,
            entries: [legacy("fav-mapped"), legacy("fav-unmapped")],
        })
    );
    view = await mixed.store.snapshot();
    await mixed.store.mutate(view.revision, {
        op: "legacy-put",
        entry: legacy("fav-mapped"),
        portable: row("Mapped"),
    });
    view = await mixed.store.snapshot();
    assert.equal(view.entries.length, 1);
    assert.equal(view.privateLegacy().entries.length, 2);
    await mixed.store.mutate(view.revision, { op: "replace", entries: [] });
    view = await mixed.store.snapshot();
    assert.equal(view.entries.length, 0);
    assert.deepEqual(
        Array.from(view.privateLegacy().entries.map((x) => x.id)),
        ["fav-unmapped"]
    );
    assert.equal(Object.keys(view.privateLegacy().aliases).length, 0);
    await assert.rejects(
        mixed.store.portableSnapshot(),
        /unportable_export/,
        "unmapped legacy is preserved and not silently omitted"
    );
    const mappedOnly = fixture();
    view = await mappedOnly.store.snapshot();
    await mappedOnly.store.mutate(view.revision, {
        op: "legacy-put",
        entry: legacy("fav-mapped"),
        portable: row("Mapped"),
    });
    view = await mappedOnly.store.snapshot();
    await mappedOnly.store.mutate(view.revision, {
        op: "migrate-source",
        migrationId: "b".repeat(64),
        entries: [],
    });
    view = await mappedOnly.store.snapshot();
    await mappedOnly.store.mutate(view.revision, {
        op: "replace",
        entries: [],
    });
    const exported = await mappedOnly.store.portableSnapshot();
    assert.equal(exported.entries.length, 0);
    assert.equal(
        JSON.parse(mappedOnly.data.get("remoteFavorites.v1")).legacy.length,
        0
    );
    assert.deepEqual(
        JSON.parse(mappedOnly.data.get("remoteFavorites.v1")).migrations,
        ["b".repeat(64)]
    );
    const titles = fixture(),
        longTitle = "界".repeat(1024);
    view = await titles.store.snapshot();
    await titles.store.mutate(view.revision, {
        op: "put",
        entries: [row(longTitle)],
    });
    view = await titles.store.snapshot();
    assert.equal(view.entries[0].title, longTitle);
    await assert.rejects(
        titles.store.mutate(view.revision, {
            op: "replace",
            entries: [row(longTitle + "a")],
        }),
        /invalid_entry|unsupported_entry/
    );
    assert.equal(
        (await titles.store.snapshot()).entries[0].title,
        longTitle,
        "invalid replacement never truncates or writes"
    );
    const tombstones = fixture(),
        tokens = Array.from({ length: 8192 }, (_, index) =>
            index.toString(16).padStart(64, "0")
        );
    tombstones.data.set(
        "remoteFavorites.v1",
        JSON.stringify({
            version: 2,
            entries: [],
            legacy: [],
            legacyAliases: {},
            migrations: tokens,
        })
    );
    let tombView = await tombstones.store.snapshot();
    await tombstones.store.mutate(tombView.revision, {
        op: "migrate-membership",
        migrationId: "f".repeat(64),
        entries: [{ token: tokens[0], entry: row("Already removed") }],
    });
    assert.equal(
        (await tombstones.store.snapshot()).entries.length,
        0,
        "retained membership token prevents resurrection"
    );
    tombView = await tombstones.store.snapshot();
    const rawBefore = tombstones.data.get("remoteFavorites.v1");
    await assert.rejects(
        tombstones.store.mutate(tombView.revision, {
            op: "migrate-membership",
            migrationId: "f".repeat(64),
            entries: [{ token: "e".repeat(64), entry: row("New") }],
        }),
        /limits_exceeded/
    );
    assert.equal(
        tombstones.data.get("remoteFavorites.v1"),
        rawBefore,
        "marker pressure never evicts tombstones or partially writes"
    );
    console.log(
        "PASS final-array replacement capacity, mapped legacy removal, preserved unmapped legacy/migrations and honest export"
    );
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
