const assert = require("node:assert/strict");
const { fixture, row, hash, load } = require("./global-favorites-fixture.cjs");
const KEY = "favorites-global-receipts.v1",
    STORE = "remoteFavorites.v1";
async function interrupted() {
    const f = fixture(),
        operation = "10000000-0000-4000-8000-000000000021";
    f.authorize(operation);
    const before = await f.store.snapshot(),
        p = await f.committer.prepare({
            operation_id: operation,
            transaction_id: "20000000-0000-4000-8000-000000000021",
            runtime: "original-runtime",
            expected_revision: before.revision,
            expected_context_revision: f.context,
            input_document_sha256: hash("document"),
            change: { op: "put", entries: [row()] },
        });
    f.hooks.unknown = STORE;
    assert.equal(
        (await f.committer.commit(operation, p.plan_digest)).outcome,
        "unknown"
    );
    delete f.hooks.unknown;
    return { f, operation };
}
function recovery(f, runtime = "inspection-runtime") {
    return load(
        "src/settings/global-favorites-recovery.ts"
    ).createGlobalFavoritesRecovery({
        capture: () => f.grant,
        current: () => true,
        runtime: () => runtime,
        now: () => 1000000,
        authorized: () => true,
        sha256: async (x) => hash(x),
        captureContext: async () => ({
            revision: f.context,
            current: () => true,
        }),
    });
}
function request(params, runtime = "inspection-runtime") {
    return {
        params: { runtime, subject: "global", ...params },
        expires_at: 1030,
    };
}
function ack(inspected) {
    return request({
        op: "acknowledge",
        operation_id: inspected.operation_id,
        operation_runtime: inspected.record.operation_runtime,
        original_entry_sha256: inspected.record.original_entry_sha256,
        expected_ledger_revision: inspected.ledger_revision,
        expected_store_revision: inspected.store_revision,
        expected_context_revision: inspected.context_revision,
        backend_proof: inspected.backend_proof,
        reason: "accept-unknown-no-replay",
        acknowledgement_id: inspected.acknowledgement_id,
        after_ledger_sha256: inspected.after_ledger_sha256,
        plan_sha256: inspected.plan_sha256,
        accept_unknown: true,
    });
}
async function main() {
    const { f, operation } = await interrupted(),
        api = recovery(f),
        original = JSON.parse(f.data.get(KEY)).entries[0],
        storeBefore = f.data.get(STORE),
        events = f.events.length;
    const selected = await api.execute(
        request({ op: "inspect", operation_id: operation })
    );
    assert.equal(selected.acknowledge_allowed, true);
    assert.equal(f.events.length, events);
    const tuple = [
        "ottplay-favorites-global-recovery-ack-v1",
        "inspection-runtime",
        "global",
        operation,
        "original-runtime",
        selected.record.original_entry_sha256,
        selected.ledger_revision,
        selected.store_revision,
        selected.context_revision,
        selected.backend_proof,
        "accept-unknown-no-replay",
    ];
    assert.equal(selected.acknowledgement_id, hash(JSON.stringify(tuple)));
    const invalid = ack(selected);
    invalid.params.accept_unknown = false;
    await assert.rejects(api.execute(invalid));
    assert.equal(f.events.length, events);
    const result = await api.execute(ack(selected));
    assert.equal(result.acknowledged, true);
    assert.equal(f.data.get(STORE), storeBefore);
    assert.equal(f.events.length, events + 1);
    const after = JSON.parse(f.data.get(KEY)).entries[0],
        audit = after.recovery_ack;
    delete after.recovery_ack;
    assert.deepEqual(after, original);
    assert.equal(audit.acknowledgement_id, selected.acknowledgement_id);
    const later = await recovery(f, "new-runtime").execute(
        request({ op: "inspect", operation_id: operation }, "new-runtime")
    );
    assert.equal(later.acknowledge_allowed, false);
    assert.deepEqual(
        JSON.parse(JSON.stringify(later.record.acknowledgement)),
        audit
    );
    assert.equal(later.record.original_state, "pending");
    await assert.rejects(api.execute(ack(selected)));
    assert.equal(f.events.length, events + 1);
    assert.equal(
        f.committer.canWrite(),
        false,
        "unqualified observed audit does not silently unlock"
    );
    await f.committer.qualify();
    assert.equal(f.committer.canWrite(), true);
    const empty = fixture(),
        read = await recovery(empty).execute(
            request({ op: "inspect", cursor: null })
        );
    assert.equal(read.total, 0);
    assert.equal(empty.events.length, 0);
    const pageFixture = await interrupted(),
        template = JSON.parse(pageFixture.f.data.get(KEY)).entries[0];
    const rows = Array.from({ length: 17 }, (_, i) => ({
        ...template,
        operationId: `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
    }));
    pageFixture.f.data.set(KEY, JSON.stringify({ entries: rows, version: 1 }));
    const pages = recovery(pageFixture.f),
        first = await pages.execute(request({ op: "inspect", cursor: null }));
    assert.equal(first.records.length, 16);
    assert(first.next_cursor);
    const second = await pages.execute(
        request({ op: "inspect", cursor: first.next_cursor })
    );
    assert.equal(second.records.length, 1);
    assert.equal(second.next_cursor, null);
    const badCursor = {
        ...first.next_cursor,
        after_operation_id: rows[0].operationId,
    };
    await assert.rejects(
        pages.execute(request({ op: "inspect", cursor: badCursor })),
        /invalid_cursor/
    );
    const originalBytes = Buffer.byteLength(pageFixture.f.data.get(KEY));
    const chosen = await pages.execute(
        request({ op: "inspect", operation_id: rows[0].operationId })
    );
    assert(chosen.acknowledge_allowed);
    const maximumRow = {
        ...original,
        recovery_ack: { ...audit, runtime: "X".repeat(128) },
    };
    const maximumDelta =
        Buffer.byteLength(
            JSON.stringify({ entries: [maximumRow], version: 1 })
        ) -
        Buffer.byteLength(JSON.stringify({ entries: [original], version: 1 }));
    assert(maximumDelta <= 1024);
    assert(originalBytes < 65536);
    console.log(
        "PASS global recovery: deterministic audit-only CAS, exact original/store preservation, restart recognition, no replay, explicit unlock and16+1 pages"
    );
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
