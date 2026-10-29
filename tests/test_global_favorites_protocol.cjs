const assert = require("node:assert/strict");
const { fixture, row, hash, load } = require("./global-favorites-fixture.cjs");
const json = load("src/commands/favorites-document-json.ts");
const schema = require("./fixtures/global-favorites-v1.schema.json").$defs;
async function main() {
    const f = fixture();
    let serial = 0,
        clock = 1000000;
    const ports = {
        store: f.store,
        codec: f.codec,
        committer: f.committer,
        current: () => true,
        runtime: () => "runtime-one",
        authorized: () => true,
        now: () => clock,
        contextRevision: async () => f.context,
        captureContext: async () => ({
            revision: f.context,
            current: () => true,
        }),
        uuid: () =>
            `20000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`,
        sha256: async (x) => hash(x),
        base64Encode: (x) => Buffer.from(x).toString("base64"),
        base64Decode: (x) => new Uint8Array(Buffer.from(x, "base64")),
        setTimer: () => 1,
        clearTimer() {},
        locatorKinds: [
            "channel",
            "channel-name",
            "plex-media",
            "local-media",
            "vportal-media",
        ],
        resolve: async (entries) => entries.map(() => "missing"),
        acceptOperation: async (p) => {
            f.authorize(p.operation_id);
            return { current: () => true };
        },
        facade: {
            exportSnapshot: async () => {
                const s = await f.store.snapshot();
                return {
                    current: s.current,
                    document: f.codec.document({
                        version: 1,
                        entries: s.entries.map(
                            ({ title, origin, locator }) => ({
                                title,
                                origin,
                                locator,
                            })
                        ),
                    }),
                };
            },
        },
    };
    const protocol = load(
        "src/commands/global-favorites-protocol.ts"
    ).createGlobalFavoritesProtocol(ports);
    f.hooks.authority = (id, hash) => protocol.freshAdmission(id, hash);
    f.hooks.statusAllowed = true; // Same independent read policy as the actual host; never fresh-write admission.
    async function call(op, rest = {}) {
        const p = { op, runtime: "runtime-one", ...rest };
        const result = await protocol.execute(
            p,
            Buffer.byteLength(
                JSON.stringify({
                    id: "request",
                    action: "favorites_global",
                    params: p,
                    expires_at: 1030,
                })
            ),
            1030
        );
        if (!result.error)
            assert.deepEqual(
                Object.keys(result).sort(),
                schema[op + "_response"].required.slice().sort()
            );
        return result;
    }
    const described = await call("describe");
    assert.equal(described.subject, "global");
    assert.deepEqual(
        Array.from(described.locator_kinds),
        ports.locatorKinds.slice().sort()
    );
    assert.equal(f.events.length, 0);
    const document = f.codec.document({ version: 1, entries: [row()] });
    const bytes = json.utf8Encode(JSON.stringify(document)),
        operation = described.admission.operation_id;
    const began = await call("begin", {
        operation_id: operation,
        mode: "merge",
        expected_revision: described.revision,
        expected_context_revision: described.context_revision,
        document_sha256: hash(bytes),
        size_bytes: bytes.length,
        chunk_count: 1,
        budget_ms: 45000,
        required_kinds: ["channel"],
    });
    assert.equal(began.error, undefined);
    assert.equal(f.events.length, 0);
    const sameBegin = await call("begin", {
        operation_id: operation,
        mode: "merge",
        expected_revision: described.revision,
        expected_context_revision: described.context_revision,
        document_sha256: hash(bytes),
        size_bytes: bytes.length,
        chunk_count: 1,
        budget_ms: 45000,
        required_kinds: ["channel"],
    });
    assert.equal(sameBegin.transaction_id, began.transaction_id);
    assert.equal(
        (
            await call("begin", {
                operation_id: operation,
                mode: "replace",
                expected_revision: described.revision,
                expected_context_revision: described.context_revision,
                document_sha256: hash(bytes),
                size_bytes: bytes.length,
                chunk_count: 1,
                budget_ms: 45000,
                required_kinds: ["channel"],
            })
        ).error,
        "operation_conflict"
    );
    const chunk = {
        transaction_id: began.transaction_id,
        seq: 0,
        offset: 0,
        chunk_sha256: hash(bytes),
        data_base64: Buffer.from(bytes).toString("base64"),
    };
    const append = await call("append", chunk);
    assert.equal(append.duplicate, false);
    assert.equal((await call("append", chunk)).duplicate, true);
    const preview = await call("preview", {
        transaction_id: began.transaction_id,
        page_offset: 0,
        max_entries: 64,
    });
    assert.equal(preview.error, undefined, JSON.stringify(preview));
    assert.equal(preview.ready, true);
    assert.equal(
        preview.resolution_counts.missing,
        1,
        "unresolved valid entries remain importable"
    );
    assert.equal(preview.counts.added, 1);
    assert.equal(preview.legacy_effects.linked_removed, 0);
    assert.equal(preview.legacy_effects.unmapped_retained, 0);
    assert.equal(f.events.length, 0);
    const committed = await call("commit", {
        transaction_id: began.transaction_id,
        operation_id: operation,
        plan_digest: preview.plan_digest,
    });
    assert.equal(committed.receipt.outcome, "verified");
    assert.equal(committed.receipt.subject, "global");
    assert.deepEqual(f.events, [
        "favorites-global-receipts.v1",
        "remoteFavorites.v1",
        "favorites-global-receipts.v1",
    ]);
    const status = await call("status", { operation_id: operation });
    assert.equal(status.state, "committed");
    assert.equal(status.receipt.operation_runtime, "runtime-one");
    const d = await call("describe");
    let offset = 0,
        parts = [];
    do {
        const page = await call("export", {
            snapshot_id: d.export.snapshot_id,
            offset,
            max_bytes: 3,
        });
        assert.equal(page.error, undefined);
        const part = Buffer.from(page.data_base64, "base64");
        assert.equal(hash(part), page.chunk_sha256);
        parts.push(part);
        assert.equal(page.next_offset, offset + part.length);
        offset = page.next_offset;
        if (page.eof) break;
    } while (true);
    assert.equal(offset, d.export.size_bytes);
    assert.equal(hash(Buffer.concat(parts)), d.export.document_sha256);
    assert.equal(
        (
            await protocol.execute(
                { op: "describe", runtime: "runtime-one" },
                16385,
                1030
            )
        ).error,
        "envelope_too_large"
    );
    assert.equal(
        (
            await call("begin", {
                operation_id: "10000000-0000-4000-8000-000000000012",
                mode: "replace",
                expected_revision: d.revision,
                expected_context_revision: d.context_revision,
                document_sha256: hash(bytes),
                size_bytes: 1048576,
                chunk_count: 128,
                budget_ms: 45000,
                required_kinds: ["channel"],
            })
        ).error,
        "invalid_request",
        "insufficient whole-operation budget is not extended"
    );
    async function previewDocument(mode, entries) {
        const description = await call("describe"),
            document = f.codec.document({ version: 1, entries }),
            data = json.utf8Encode(JSON.stringify(document));
        const begin = await call("begin", {
            operation_id: description.admission.operation_id,
            mode,
            expected_revision: description.revision,
            expected_context_revision: description.context_revision,
            document_sha256: hash(data),
            size_bytes: data.length,
            chunk_count: 1,
            budget_ms: 45000,
            required_kinds: ["channel"],
        });
        assert.equal(begin.error, undefined);
        await call("append", {
            transaction_id: begin.transaction_id,
            seq: 0,
            offset: 0,
            chunk_sha256: hash(data),
            data_base64: Buffer.from(data).toString("base64"),
        });
        return {
            begin,
            preview: await call("preview", {
                transaction_id: begin.transaction_id,
                page_offset: 0,
                max_entries: 1,
            }),
        };
    }
    const conflict = await previewDocument("merge", [row("Different title")]);
    assert.equal(conflict.preview.ready, false);
    assert.equal(conflict.preview.blocker, "metadata_conflict");
    assert.equal(
        conflict.preview.rows[0].metadata_conflict.reason,
        "title_mismatch"
    );
    assert.equal(
        conflict.preview.rows[0].metadata_conflict.incoming_entry_index,
        0
    );
    const writes = f.events.length;
    assert.equal(
        (
            await call("commit", {
                operation_id: conflict.begin.operation_id,
                transaction_id: conflict.begin.transaction_id,
                plan_digest: conflict.preview.plan_digest,
            })
        ).error,
        "not_ready"
    );
    assert.equal(f.events.length, writes);
    await call("abort", {
        operation_id: conflict.begin.operation_id,
        transaction_id: conflict.begin.transaction_id,
    });
    const replacement = await previewDocument("replace", [
        row("Different title"),
    ]);
    assert.equal(replacement.preview.ready, true);
    assert.equal(replacement.preview.counts.updated, 1);
    await call("abort", {
        operation_id: replacement.begin.operation_id,
        transaction_id: replacement.begin.transaction_id,
    });
    const expiredGrant = await call("describe");
    clock += 10001;
    assert.equal(
        (
            await call("begin", {
                operation_id: expiredGrant.admission.operation_id,
                mode: "merge",
                expected_revision: expiredGrant.revision,
                expected_context_revision: expiredGrant.context_revision,
                document_sha256: hash(bytes),
                size_bytes: bytes.length,
                chunk_count: 1,
                budget_ms: 45000,
                required_kinds: ["channel"],
            })
        ).error,
        "operation_conflict"
    );
    console.log(
        "PASS exact8 global protocol: bounded envelope/chunks/pages, no preview writes, persisted commit/status, unresolved import and absolute budget"
    );
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
