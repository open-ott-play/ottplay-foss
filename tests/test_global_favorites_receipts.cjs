const assert = require("node:assert/strict");
const { fixture, row, hash, load } = require("./global-favorites-fixture.cjs");
const operation = "10000000-0000-4000-8000-000000000001",
    transaction = "20000000-0000-4000-8000-000000000001";
async function plan(f, entries = [row()]) {
    f.authorize(operation);
    const view = await f.store.snapshot();
    return f.committer.prepare({
        change: { entries, op: "put" },
        expected_context_revision: f.context,
        expected_revision: view.revision,
        input_document_sha256: hash(JSON.stringify(entries)),
        operation_id: operation,
        runtime: "runtime-one",
        transaction_id: transaction,
    });
}
async function main() {
    const f = fixture();
    f.data.set("favorites-receipts.v1", "old-ledger-untouched");
    const p = await plan(f);
    assert.equal(f.events.length, 0, "preparation never writes");
    const result = await f.committer.commit(operation, p.plan_digest);
    assert.equal(result.outcome, "verified");
    assert.deepEqual(f.events, [
        "favorites-global-receipts.v1",
        "remoteFavorites.v1",
        "favorites-global-receipts.v1",
    ]);
    assert.equal(f.data.get("favorites-receipts.v1"), "old-ledger-untouched");
    const after = f.data.get("remoteFavorites.v1");
    assert.equal(result.receipt.new_revision, hash(after));
    await assert.rejects(
        f.committer.commit(operation, p.plan_digest),
        /reconciliation_required/
    );
    const restarted = load(
        "src/settings/global-favorites-receipts.ts"
    ).createGlobalFavoritesCommitter({
        authorizedOperation: async () => true,
        capture: () => f.grant,
        captureContext: async () => ({
            current: () => true,
            revision: f.context,
        }),
        codec: f.codec,
        contextRevision: async () => f.context,
        current: () => true,
        freshAdmission: async () => false,
        now: () => 1000001,
        sha256: async (x) => hash(x),
        store: f.store,
    });
    assert.equal(
        (await restarted.status(operation)).outcome,
        "verified",
        "persisted status after restart, no RAM ticket"
    );
    const events = f.events.length;
    assert.equal(
        (await restarted.status("10000000-0000-4000-8000-000000000002"))
            .outcome,
        "unknown"
    );
    assert.equal(f.events.length, events);
    const uncertain = fixture(),
        u = await plan(uncertain);
    uncertain.hooks.unknown = "remoteFavorites.v1";
    assert.equal(
        (await uncertain.committer.commit(operation, u.plan_digest)).outcome,
        "unknown"
    );
    assert.equal(
        uncertain.committer.canWrite(),
        false,
        "pending receipt protects unknown target write"
    );
    await assert.rejects(
        uncertain.store.mutate((await uncertain.store.snapshot()).revision, {
            entries: [row("other")],
            op: "put",
        })
    );
    assert.equal(
        (await uncertain.committer.status(operation)).outcome,
        "unknown"
    );
    const mismatch = fixture(),
        m = await plan(mismatch);
    mismatch.data.set("remoteFavorites.v1", "changed");
    await assert.rejects(mismatch.committer.commit(operation, m.plan_digest));
    assert.equal(mismatch.events.length, 0);
    const noAuthority = fixture();
    const view = await noAuthority.store.snapshot();
    await assert.rejects(
        noAuthority.committer.prepare({
            change: { entries: [row()], op: "put" },
            expected_context_revision: noAuthority.context,
            expected_revision: view.revision,
            input_document_sha256: hash("x"),
            operation_id: operation,
            runtime: "r",
            transaction_id: transaction,
        }),
        /operation_exists/
    );
    assert.equal(noAuthority.events.length, 0);
    const original = load("src/settings/favorites-recovery-codec.ts");
    assert.throws(
        () =>
            original.parseFavoritesRecoveryLedger(
                f.data.get("favorites-global-receipts.v1")
            ),
        "global rows never become old recovery rows"
    );
    const pressure = fixture();
    for (let index = 1; index <= 40; index++) {
        const id = `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
            snapshot = await pressure.store.snapshot();
        pressure.authorize(id);
        const planned = await pressure.committer.prepare({
            change: {
                entries: [
                    {
                        ...row("Item " + index),
                        locator: { channelId: String(index), kind: "channel" },
                    },
                ],
                op: "put",
            },
            expected_context_revision: pressure.context,
            expected_revision: snapshot.revision,
            input_document_sha256: hash(String(index)),
            operation_id: id,
            runtime: "runtime-one",
            transaction_id: transaction,
        });
        assert.equal(
            (await pressure.committer.commit(id, planned.plan_digest)).outcome,
            "verified"
        );
    }
    const pressureLedger = JSON.parse(
        pressure.data.get("favorites-global-receipts.v1")
    );
    assert(pressureLedger.entries.length <= 32);
    assert.equal((await pressure.store.snapshot()).entries.length, 40);
    assert.equal(pressure.committer.canWrite(), true);
    assert.equal(
        (
            await pressure.committer.status(
                "30000000-0000-4000-8000-000000000001"
            )
        ).outcome,
        "unknown",
        "evicted receipt is never proof of a fresh operation"
    );
    const reorder = fixture();
    let view2 = await reorder.store.snapshot();
    await reorder.store.mutate(view2.revision, {
        entries: [
            row("A"),
            { ...row("B"), locator: { channelId: "002", kind: "channel" } },
        ],
        op: "put",
    });
    view2 = await reorder.store.snapshot();
    reorder.authorize(operation);
    const reordered = await reorder.committer.prepare({
        change: {
            entries: [
                { ...row("B"), locator: { channelId: "002", kind: "channel" } },
                row("A"),
            ],
            op: "replace",
        },
        expected_context_revision: reorder.context,
        expected_revision: view2.revision,
        input_document_sha256: hash("reorder"),
        operation_id: operation,
        runtime: "runtime-one",
        transaction_id: transaction,
    });
    assert.equal(reordered.counts.moved, 2);
    assert.equal(reordered.counts.added, 0);
    assert.equal(reordered.counts.removed, 0);
    const linked = fixture(),
        // biome-ignore assist/source/useSortedKeys: Preserve the legacy input bytes for receipt migration.
        old = (id) => ({
            id,
            name: id,
            title: id,
            provider: "m3u",
            profile_name: "TV",
            profile_number: 1,
            kind: "live",
            source: "private",
            ref: { itemId: id },
        });
    linked.data.set(
        "remoteFavorites.v1",
        // biome-ignore assist/source/useSortedKeys: Preserve the legacy input bytes for receipt migration.
        JSON.stringify({
            version: 1,
            entries: [old("fav-linked"), old("fav-unmapped")],
        })
    );
    let linkedView = await linked.store.snapshot();
    await linked.store.mutate(linkedView.revision, {
        entry: old("fav-linked"),
        op: "legacy-put",
        portable: row(),
    });
    linkedView = await linked.store.snapshot();
    linked.authorize(operation);
    const removal = await linked.committer.prepare({
        change: { entries: [], op: "replace" },
        expected_context_revision: linked.context,
        expected_revision: linkedView.revision,
        input_document_sha256: hash("clear"),
        operation_id: operation,
        runtime: "runtime-one",
        transaction_id: transaction,
    });
    assert.equal(removal.legacy_effects.linked_removed, 1);
    assert.equal(removal.legacy_effects.unmapped_retained, 1);
    const beforeCommit = linked.events.length;
    assert.equal(
        (await linked.committer.commit(operation, removal.plan_digest)).outcome,
        "verified"
    );
    assert.equal(linked.events.length, beforeCommit + 3);
    const remaining = await linked.store.snapshot();
    assert.equal(remaining.entries.length, 0);
    assert.equal(remaining.unresolvedLegacy.length, 1);
    assert.equal(remaining.unresolvedLegacy[0].id, "fav-unmapped");
    console.log(
        "PASS global receipt adapter: prepared bytes, same held physical guard, old ledger isolation, durable restart, unknown fence and no blind replay"
    );
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
