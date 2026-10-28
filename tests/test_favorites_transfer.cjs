const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");
const ts = require("typescript");
const test = require("node:test");
const source = fs.readFileSync("src/commands/favorites-transfer.ts", "utf8");
const compiled = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES5,
    },
}).outputText;
require("acorn").parse(compiled, { ecmaVersion: 5 });
const context = { Date, Error, exports: {}, Promise, Uint8Array };
vm.runInNewContext(compiled, context);
const create = context.exports.createFavoritesTransfer;
const clone = (value) => JSON.parse(JSON.stringify(value));
const scope = {
    profileBindingId: "9ac483a8-083e-4ce1-9dca-f31a3514e90f",
    provider: "plex",
    sourceBindingId: "88dbcf12-1d8c-417e-b6c5-f8810e3a3285",
};
const operation = "95e21aca-76b0-4db1-b3ce-bd9a4bd64770";
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
function fixture() {
    let now = 1000,
        runtime = "test-runtime",
        owned = true,
        fresh = true;
    let revision = "favorites-20",
        binding = "bindings-8",
        applies = 0,
        evidence = null;
    const bytes = Buffer.from(
        JSON.stringify({ favorites: ["synthetic"], schema: 1, scope })
    );
    let lastContext;
    let timerId = 0;
    const timers = new Map();
    const ports = {
        adapter: {
            async apply(_plan, receipt) {
                applies++;
                fresh = false;
                lastContext = { ...receipt, bytes: null };
                evidence = {
                    evidence_complete: true,
                    outcome: "verified",
                    per_store: [{ id: "favorites", outcome: "verified" }],
                    persistence: "persistent",
                    receipt: {
                        counts: receipt.counts,
                        document_sha256: receipt.document_sha256,
                        new_revision: "favorites-21",
                        operation_id: receipt.operation_id,
                        outcome: "verified",
                        persistence: "persistent",
                        plan_digest: receipt.plan_digest,
                        scope: receipt.scope,
                    },
                    receipt_verified: true,
                };
                return evidence;
            },
            async inspect() {
                return {
                    binding_revision: binding,
                    budgetAccepted: true,
                    current: () => owned,
                    operationFresh: fresh,
                    persistence: "persistent",
                    revision,
                };
            },
            async preview() {
                return {
                    base_revision: revision,
                    binding_revision: binding,
                    counts: {
                        channelLists: 1,
                        channelMemberships: 0,
                        mediaFavorites: 1,
                        unresolved: 0,
                    },
                    coverage: {
                        channelLists: "complete-for-scope",
                        history: "excluded-preserved",
                        mediaFavorites: "complete-for-scope",
                        remoteAliases: "excluded-preserved",
                    },
                    persistence: "persistent",
                    ready: true,
                    stores: [{ expected_revision: "store-3", id: "favorites" }],
                    unresolved: [],
                    writePlan: [
                        {
                            after: hash(bytes),
                            before: "old-digest",
                            id: "favorites",
                        },
                    ],
                };
            },
            async snapshot() {
                return { binding_revision: binding, bytes, revision };
            },
            async status() {
                return evidence;
            },
        },
        base64Decode(text) {
            if (
                !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
                    text
                )
            )
                throw new Error("invalid_request");
            return new Uint8Array(Buffer.from(text, "base64"));
        },
        base64Encode: (data) => Buffer.from(data).toString("base64"),
        clearTimer(id) {
            timers.delete(id);
        },
        codec: {
            validate(data, expected) {
                const document = JSON.parse(
                    new TextDecoder("utf-8", { fatal: true }).decode(data)
                );
                assert.deepEqual(document.scope, clone(expected));
                if (document.reject) throw new Error("unrepresentable locator");
            },
        },
        now: () => now,
        runtime: () => runtime,
        setTimer(callback, milliseconds) {
            const id = ++timerId;
            timers.set(id, { callback, due: now + milliseconds });
            return id;
        },
        sha256: hash,
        utf8: (text) => new TextEncoder().encode(text),
        uuid: () => crypto.randomUUID(),
    };
    const engine = create(ports);
    const begin = {
        binding_revision: binding,
        chunk_count: 1,
        document_sha256: hash(bytes),
        expected_revision: revision,
        op: "begin",
        operation_id: operation,
        persistence: "persistent",
        runtime,
        scope,
        size_bytes: bytes.length,
    };
    async function send(params, transport = {}) {
        return clone(
            await engine.execute(params, {
                deadlineAt: now + 600000,
                envelope: {
                    action: "favorites_transfer",
                    expires_at: now + 600000,
                    id: "remote-command",
                    params: clone(params),
                },
                runtime: ports.runtime(),
                ...transport,
            })
        );
    }
    async function ready() {
        const opened = await send(begin);
        assert(!opened.error, opened.error);
        const transaction_id = opened.transaction_id;
        const appended = await send({
            chunk_sha256: hash(bytes),
            data_base64: bytes.toString("base64"),
            offset: 0,
            op: "append",
            runtime: ports.runtime(),
            seq: 0,
            transaction_id,
        });
        assert(!appended.error, appended.error);
        const plan = await send({
            op: "preview",
            runtime: ports.runtime(),
            transaction_id,
        });
        assert(!plan.error, plan.error);
        return { plan_digest: plan.plan_digest, transaction_id };
    }
    return {
        advance(milliseconds) {
            const end = now + milliseconds;
            for (let i = 0; i < 1000; i++) {
                const next = [...timers]
                    .filter(([, timer]) => timer.due <= end)
                    .sort((a, b) => a[1].due - b[1].due)[0];
                if (!next) {
                    now = end;
                    return;
                }
                now = next[1].due;
                timers.delete(next[0]);
                next[1].callback();
            }
            throw new Error("timer loop");
        },
        applies: () => applies,
        begin,
        binding: (value) => {
            binding = value;
        },
        bytes,
        engine,
        evidence: (value) => {
            evidence = value;
        },
        fresh: (value) => {
            fresh = value;
        },
        lastContext: () => lastContext,
        owned: (value) => {
            owned = value;
        },
        ports,
        ready,
        revision: (value) => {
            revision = value;
        },
        runtime: (value) => {
            runtime = value;
        },
        send,
    };
}
async function commit(f, prepared) {
    return f.send({
        op: "commit",
        runtime: f.ports.runtime(),
        ...prepared,
        expected_revision: "favorites-20",
        operation_id: operation,
    });
}
test("bounded pure factory snapshots, stages, previews and verifies actual adapter receipt", async () => {
    const f = fixture();
    const snapshot = await f.send({
        op: "snapshot",
        runtime: "test-runtime",
        scope,
    });
    assert.equal(snapshot.version, 1);
    assert.equal(snapshot.op, "snapshot");
    assert.equal(snapshot.document_sha256, hash(f.bytes));
    const prepared = await f.ready();
    assert.equal(f.applies(), 0);
    const applied = await commit(f, prepared);
    assert.equal(applied.outcome, "verified");
    assert.equal(applied.operation_id, operation);
    assert.equal(applied.transaction_id, prepared.transaction_id);
    assert.equal(f.applies(), 1);
    assert.equal((await commit(f, prepared)).error, "transaction_not_found");
    const status = await f.send({
        op: "status",
        operation_id: operation,
        runtime: "test-runtime",
    });
    assert.equal(status.outcome, "verified");
    assert.equal(status.operation_id, operation);
    assert.equal((await f.send(f.begin)).error, "reconciliation_required");
});
test("actual trusted envelope includes expiry/escaping/other fields and must match params", async () => {
    const f = fixture();
    const command = { op: "snapshot", runtime: "test-runtime", scope };
    assert.equal(
        (
            await f.send(command, {
                envelope: {
                    expires_at: 600001,
                    extra: "💾".repeat(5000),
                    params: command,
                },
            })
        ).error,
        "envelope_too_large"
    );
    assert.equal(
        (
            await f.send(command, {
                envelope: {
                    expires_at: 600001,
                    params: { ...command, op: "abort" },
                },
            })
        ).error,
        "invalid_request"
    );
    assert.equal(
        (
            await f.send(command, {
                envelope: JSON.stringify({ params: command }),
            })
        ).error,
        "envelope_too_large"
    );
});
test("begin is exact idempotent, one active, persistent-only and budget/replay admitted", async () => {
    const f = fixture();
    const first = await f.send(f.begin);
    assert.equal((await f.send(f.begin)).transaction_id, first.transaction_id);
    assert.equal(
        (await f.send({ ...f.begin, size_bytes: f.bytes.length + 1 })).error,
        "operation_conflict"
    );
    assert.equal(
        (await f.send({ ...f.begin, operation_id: scope.profileBindingId }))
            .error,
        "busy"
    );
    const g = fixture();
    assert.equal(
        (await g.send({ ...g.begin, persistence: "session-only" })).error,
        "unsupported_persistence"
    );
    g.fresh(false);
    assert.equal((await g.send(g.begin)).error, "reconciliation_required");
    const h = fixture();
    const inspect = h.ports.adapter.inspect;
    h.ports.adapter.inspect = async () => ({
        ...(await inspect()),
        budgetAccepted: false,
    });
    assert.equal((await h.send(h.begin)).error, "limits_exceeded");
});
test("append exact duplicate ACK, changed duplicate conflict, ordering and strict base64", async () => {
    const f = fixture();
    const begin = await f.send(f.begin);
    const chunk = {
        chunk_sha256: hash(f.bytes),
        data_base64: f.bytes.toString("base64"),
        offset: 0,
        op: "append",
        runtime: "test-runtime",
        seq: 0,
        transaction_id: begin.transaction_id,
    };
    assert.equal((await f.send({ ...chunk, seq: 1 })).error, "out_of_order");
    const ack = await f.send(chunk);
    assert.deepEqual(await f.send(chunk), ack);
    assert.equal(
        (await f.send({ ...chunk, offset: 1 })).error,
        "chunk_conflict"
    );
    assert.equal(
        (await f.send({ ...chunk, data_base64: chunk.data_base64 + "\n" }))
            .error,
        "invalid_request"
    );
    assert.equal(
        (await f.send({ ...chunk, chunk_sha256: "0".repeat(64) })).error,
        "hash_mismatch"
    );
});
test("invalid activity never refreshes idle TTL; valid activity cannot exceed absolute TTL", async () => {
    const f = fixture();
    const a = await f.send(f.begin);
    f.advance(119000);
    assert.equal(
        (
            await f.send({
                op: "preview",
                runtime: "test-runtime",
                transaction_id: a.transaction_id,
            })
        ).error,
        "incomplete"
    );
    f.advance(1000);
    assert.equal(
        (
            await f.send({
                op: "status",
                operation_id: operation,
                runtime: "test-runtime",
            })
        ).state,
        "expired"
    );
    assert.equal(f.applies(), 0);
    const g = fixture();
    await g.send(g.begin);
    for (let i = 0; i < 5; i++) {
        g.advance(119000);
        assert.equal(
            (
                await g.send({
                    op: "status",
                    operation_id: operation,
                    runtime: "test-runtime",
                })
            ).state,
            "receiving"
        );
    }
    g.advance(5000);
    assert.equal(
        (
            await g.send({
                op: "status",
                operation_id: operation,
                runtime: "test-runtime",
            })
        ).state,
        "expired"
    );
});
test("valid commit refreshes idle lifetime without extending absolute or request deadlines", async () => {
    const f = fixture();
    const prepared = await f.ready();
    f.advance(119000);
    const apply = f.ports.adapter.apply;
    f.ports.adapter.apply = async (plan, receipt, current) => {
        f.advance(2000);
        assert.equal(
            current(),
            true,
            "commit remains active beyond the previous idle deadline"
        );
        return apply(plan, receipt);
    };
    assert.equal((await commit(f, prepared)).outcome, "verified");
    assert.equal(f.applies(), 1);

    const g = fixture();
    const absolutePlan = await g.ready();
    for (let i = 0; i < 5; i++) {
        g.advance(119000);
        await g.send({
            op: "status",
            operation_id: operation,
            runtime: "test-runtime",
        });
    }
    let absoluteCurrent;
    g.ports.adapter.apply = async (_plan, _receipt, current) => {
        g.advance(6000);
        absoluteCurrent = current();
        return {
            outcome: "not_applied",
            per_store: [],
            persistence: "persistent",
        };
    };
    assert.equal((await commit(g, absolutePlan)).outcome, "unknown");
    assert.equal(
        absoluteCurrent,
        false,
        "absolute lifetime still ends the commit"
    );
    assert.equal(g.applies(), 0);

    const h = fixture();
    const requestPlan = await h.ready();
    h.advance(119000);
    h.ports.adapter.apply = () => new Promise(() => {});
    const pending = h.send(
        {
            op: "commit",
            runtime: "test-runtime",
            ...requestPlan,
            expected_revision: "favorites-20",
            operation_id: operation,
        },
        { deadlineAt: h.ports.now() + 500 }
    );
    for (let i = 0; i < 30; i++) await Promise.resolve();
    h.advance(500);
    assert.equal((await pending).outcome, "unknown");
    assert.equal(h.applies(), 0);
});
test("runtime restart releases old RAM stage and absent receipt remains unknown", async () => {
    const f = fixture();
    await f.send(f.begin);
    f.runtime("replacement-runtime");
    const status = await f.send({
        op: "status",
        operation_id: operation,
        runtime: "replacement-runtime",
    });
    assert.equal(status.state, "expired");
    assert.equal(status.outcome, "not_applied");
    const g = fixture();
    assert.equal(
        (
            await g.send({
                op: "status",
                operation_id: operation,
                runtime: "test-runtime",
            })
        ).outcome,
        "unknown"
    );
    g.fresh(false);
    assert.equal((await g.send(g.begin)).error, "reconciliation_required");
});
test("preview validates entire document, digest and deterministic write plan without writes", async () => {
    const f = fixture();
    const opened = await f.send({
        ...f.begin,
        document_sha256: "0".repeat(64),
    });
    const chunk = {
        chunk_sha256: hash(f.bytes),
        data_base64: f.bytes.toString("base64"),
        offset: 0,
        op: "append",
        runtime: "test-runtime",
        seq: 0,
        transaction_id: opened.transaction_id,
    };
    await f.send(chunk);
    assert.equal(
        (
            await f.send({
                op: "preview",
                runtime: "test-runtime",
                transaction_id: opened.transaction_id,
            })
        ).error,
        "hash_mismatch"
    );
    assert.equal(f.applies(), 0);
    const g = fixture();
    g.ports.codec.validate = () => {
        throw new Error("unsupported entry");
    };
    await assert.rejects(g.ready(), /codec_error/);
    assert.equal(g.applies(), 0);
});
test("commit repeats owner/binding/revision and plan admission before any write", async () => {
    for (const change of ["revision", "binding", "owner"]) {
        const f = fixture();
        const prepared = await f.ready();
        if (change === "revision") f.revision("new");
        else if (change === "binding") f.binding("new");
        else f.owned(false);
        const result = await commit(f, prepared);
        assert(result.error);
        assert.equal(f.applies(), 0);
    }
    const f = fixture();
    const prepared = await f.ready();
    assert.equal(
        (await commit(f, { ...prepared, plan_digest: "0".repeat(64) })).error,
        "not_ready"
    );
    assert.equal(f.applies(), 0);
});
test("lost ACK, partial/unknown writes and missing receipts never authorize blind replay", async () => {
    for (const state of ["partial", "unknown", "throw", "false verified"]) {
        const f = fixture();
        const prepared = await f.ready();
        let writes = 0;
        f.ports.adapter.apply = async () => {
            writes++;
            if (state === "throw") throw new Error("readback unavailable");
            return {
                outcome: state === "false verified" ? "verified" : state,
                per_store: [{ id: "favorites", outcome: "unknown" }],
                persistence: "persistent",
            };
        };
        const result = await commit(f, prepared);
        assert.equal(result.outcome, "unknown");
        assert((await commit(f, prepared)).error);
        assert.equal(writes, 1);
        assert.equal(
            (
                await f.send({
                    op: "status",
                    operation_id: operation,
                    runtime: "test-runtime",
                })
            ).outcome,
            "unknown"
        );
        const aborted = await f.send({
            op: "abort",
            runtime: "test-runtime",
            transaction_id: prepared.transaction_id,
        });
        assert.equal(aborted.error, "reconciliation_required");
    }
});
test("abort is exact/idempotent and cannot mutate favorites", async () => {
    const f = fixture();
    const opened = await f.send(f.begin);
    const request = {
        op: "abort",
        runtime: "test-runtime",
        transaction_id: opened.transaction_id,
    };
    const a = await f.send(request);
    assert.equal(a.state, "aborted");
    assert.equal(a.transaction_id, opened.transaction_id);
    assert.deepEqual(await f.send(request), a);
    assert.equal(f.applies(), 0);
});
test("asynchronous/reentrant ports cannot revive replaced owners or replay a commit", async () => {
    const f = fixture();
    const prepared = await f.ready();
    let release;
    f.ports.adapter.apply = () =>
        new Promise((resolve) => {
            release = resolve;
        });
    const pending = commit(f, prepared);
    for (let i = 0; i < 20 && !release; i++) await Promise.resolve();
    assert.equal((await commit(f, prepared)).error, "busy");
    f.runtime("new-runtime");
    release({
        evidence_complete: true,
        outcome: "not_applied",
        per_store: [{ id: "favorites", outcome: "not_applied" }],
        persistence: "persistent",
    });
    assert.equal((await pending).outcome, "unknown");
});
test("document/chunk bounds and oversized plan diagnostics fail closed", async () => {
    const f = fixture();
    assert.equal(
        (await f.send({ ...f.begin, chunk_count: 129, size_bytes: 1048577 }))
            .error,
        "invalid_request"
    );
    const g = fixture();
    const original = g.ports.adapter.preview;
    g.ports.adapter.preview = async (...args) => ({
        ...(await original(...args)),
        unresolved: ["x".repeat(70000)],
    });
    await assert.rejects(g.ready(), /limits_exceeded/);
    assert.equal(g.applies(), 0);
});

test("public preview mutation cannot redirect its private physical write plan", async () => {
    const f = fixture();
    const prepared = await f.ready();
    const params = {
        op: "preview",
        runtime: "test-runtime",
        transaction_id: prepared.transaction_id,
    };
    const published = await f.engine.execute(params, {
        deadlineAt: 600001,
        envelope: { expires_at: 600001, params },
        runtime: "test-runtime",
    });
    published.stores[0].id = "attacker-store";
    published.coverage.history = "overwrite";
    const result = await commit(f, prepared);
    assert.equal(result.outcome, "verified");
    assert.deepEqual(result.per_store, [
        { id: "favorites", outcome: "verified" },
    ]);
});
test("partial application retains exact bounded per-store evidence", async () => {
    const f = fixture();
    const original = f.ports.adapter.preview;
    f.ports.adapter.preview = async (...args) => ({
        ...(await original(...args)),
        stores: [
            { expected_revision: "one", id: "channels" },
            { expected_revision: "two", id: "media" },
        ],
    });
    const prepared = await f.ready();
    const stores = [
        { id: "channels", outcome: "verified" },
        { id: "media", outcome: "not_applied" },
    ];
    f.ports.adapter.apply = async () => ({
        evidence_complete: true,
        outcome: "partial",
        per_store: stores,
        persistence: "persistent",
    });
    const result = await commit(f, prepared);
    assert.equal(result.outcome, "partial");
    assert.deepEqual(result.per_store, stores);
    assert.equal(
        (
            await f.send({
                op: "abort",
                runtime: "test-runtime",
                transaction_id: prepared.transaction_id,
            })
        ).error,
        "reconciliation_required"
    );
});
test("full 1MiB staging uses actual <=16KiB chunk envelopes, with no entry packing assumptions", async () => {
    const f = fixture();
    const size = 1048576;
    const bytes = Buffer.alloc(size, 32);
    const opened = await f.send({
        ...f.begin,
        chunk_count: 128,
        document_sha256: hash(bytes),
        size_bytes: size,
    });
    assert(!opened.error, opened.error);
    for (let seq = 0; seq < 128; seq++) {
        const chunk = bytes.subarray(seq * 8192, (seq + 1) * 8192);
        const result = await f.send({
            chunk_sha256: hash(chunk),
            data_base64: chunk.toString("base64"),
            offset: seq * 8192,
            op: "append",
            runtime: "test-runtime",
            seq,
            transaction_id: opened.transaction_id,
        });
        assert(!result.error, result.error);
        assert.equal(result.received_bytes, (seq + 1) * 8192);
    }
    assert.equal(f.applies(), 0);
});

test("idle timer releases a stage without a polling request", async () => {
    const f = fixture();
    await f.send(f.begin);
    f.advance(120000);
    const result = await f.send({
        op: "status",
        operation_id: operation,
        runtime: "test-runtime",
    });
    assert.equal(result.state, "expired");
    assert.equal(result.outcome, "not_applied");
    assert.equal(f.applies(), 0);
});
test("commit deadline is unknown and retains an inflight fence until adapter settles", async () => {
    const f = fixture();
    const prepared = await f.ready();
    let release, ownedBytes;
    f.ports.adapter.apply = (_plan, context) => {
        ownedBytes = context.bytes;
        return new Promise((resolve) => {
            release = resolve;
        });
    };
    const pending = commit(f, prepared);
    for (let i = 0; i < 20 && !release; i++) await Promise.resolve();
    assert(release);
    f.advance(120000);
    const result = await pending;
    assert.equal(result.outcome, "unknown");
    assert(
        ownedBytes.some((value) => value !== 0),
        "do not overwrite bytes still used by an unresolved adapter"
    );
    assert.equal(
        (await f.send({ ...f.begin, operation_id: scope.profileBindingId }))
            .error,
        "busy"
    );
    assert.equal(
        (
            await f.send({
                op: "status",
                operation_id: operation,
                runtime: "test-runtime",
            })
        ).outcome,
        "unknown"
    );
    assert.equal(
        (
            await f.send({
                op: "abort",
                runtime: "test-runtime",
                transaction_id: prepared.transaction_id,
            })
        ).error,
        "reconciliation_required"
    );
    release({
        evidence_complete: true,
        outcome: "not_applied",
        per_store: [{ id: "favorites", outcome: "not_applied" }],
        persistence: "persistent",
    });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    assert(
        ownedBytes.every((value) => value === 0),
        "release staged bytes only after adapter settles"
    );
    assert.equal((await f.send(f.begin)).error, "reconciliation_required");
});

test("all wire and generated identifiers require canonical UUIDv4", async () => {
    for (const field of ["operation", "scope", "generated"]) {
        const f = fixture();
        const v1 = "9ac483a8-083e-1ce1-9dca-f31a3514e90f";
        const request = clone(f.begin);
        if (field === "operation") request.operation_id = v1;
        else if (field === "scope") request.scope.profileBindingId = v1;
        else f.ports.uuid = () => v1;
        assert((await f.send(request)).error);
        assert.equal(f.applies(), 0);
    }
});
test("status shapes are exact for receiving/ready and prewrite terminal states", async () => {
    const f = fixture();
    await f.send(f.begin);
    const receiving = await f.send({
        op: "status",
        operation_id: operation,
        runtime: "test-runtime",
    });
    assert.deepEqual(
        Object.keys(receiving).sort(),
        [
            "version",
            "runtime",
            "op",
            "operation_id",
            "transaction_id",
            "state",
            "persistence",
            "next_seq",
            "received_bytes",
            "idle_expires_at",
            "absolute_expires_at",
        ].sort()
    );
    const g = fixture();
    const prepared = await g.ready();
    const ready = await g.send({
        op: "status",
        operation_id: operation,
        runtime: "test-runtime",
    });
    assert.equal(ready.state, "ready");
    assert.equal(ready.ready, true);
    assert.equal(ready.plan_digest, prepared.plan_digest);
    const ended = await g.send({
        op: "abort",
        runtime: "test-runtime",
        transaction_id: prepared.transaction_id,
    });
    assert.equal(ended.persistence, "persistent");
    assert.equal(ended.outcome, "not_applied");
    assert.deepEqual(ended.per_store, []);
});

test("unresolved diagnostics contain only bounded indices and fixed reason codes", async () => {
    const row = {
        collection: "mediaFavorites",
        entry_index: 0,
        reason: "legacy-unportable",
    };
    for (const invalid of [false, true]) {
        const f = fixture(),
            original = f.ports.adapter.preview;
        f.ports.adapter.preview = async (...args) => {
            const plan = await original(...args);
            plan.counts.unresolved = 1;
            plan.unresolved = [
                invalid ? { ...row, raw: "https://secret.invalid/token" } : row,
            ];
            return plan;
        };
        if (invalid) await assert.rejects(f.ready(), /not_ready/);
        else {
            const prepared = await f.ready();
            const preview = await f.send({
                op: "preview",
                runtime: "test-runtime",
                transaction_id: prepared.transaction_id,
            });
            assert.deepEqual(preview.unresolved, [row]);
        }
        assert.equal(f.applies(), 0);
    }
});

test("canonical identifiers and digest syntax reject final newlines before adapter admission", async () => {
    for (const field of [
        "operation_id",
        "profileBindingId",
        "provider",
        "document_sha256",
        "generated",
    ]) {
        const f = fixture();
        const request = clone(f.begin);
        let inspections = 0;
        const inspect = f.ports.adapter.inspect;
        f.ports.adapter.inspect = async (...args) => {
            inspections++;
            return inspect(...args);
        };
        if (field === "profileBindingId" || field === "provider")
            request.scope[field] += "\n";
        else if (field === "generated")
            f.ports.uuid = () => "be3a9ac5-e4f0-4b52-a899-a287f167c116\n";
        else request[field] += "\n";
        assert((await f.send(request)).error);
        assert.equal(inspections, 0);
        assert.equal(f.applies(), 0);
    }
});

test("trusted stage context is minted once after idempotency and reused before commit", async () => {
    const f = fixture(),
        original = f.ports.adapter.inspect,
        contexts = [];
    let minted = 0;
    f.ports.uuid = () => {
        minted++;
        return "be3a9ac5-e4f0-4b52-a899-a287f167c116";
    };
    f.ports.adapter.inspect = async (...args) => {
        contexts.push(args);
        return original(...args);
    };
    const prepared = await f.ready();
    await f.send(f.begin);
    assert.equal(minted, 1);
    assert.equal(contexts.length, 1);
    assert.deepEqual(clone(contexts[0][2]), {
        document_sha256: f.begin.document_sha256,
        operation_id: operation,
        runtime: "test-runtime",
        transaction_id: prepared.transaction_id,
    });
    assert.equal((await commit(f, prepared)).outcome, "verified");
    assert.equal(contexts.length, 2);
    assert.equal(contexts[1][1], operation);
    assert.strictEqual(contexts[1][2], contexts[0][2]);
});

test("prewrite abort and nonready status match frozen peer field sets", async () => {
    // cbaeda0d wire fixture field sets: abort.response and status_fixtures.receiving.
    const abortKeys = [
        "version",
        "runtime",
        "op",
        "transaction_id",
        "operation_id",
        "state",
        "outcome",
        "persistence",
        "per_store",
    ].sort();
    const receivingKeys = [
        "version",
        "runtime",
        "op",
        "operation_id",
        "transaction_id",
        "persistence",
        "state",
        "next_seq",
        "received_bytes",
        "idle_expires_at",
        "absolute_expires_at",
    ].sort();
    for (const expired of [false, true]) {
        const f = fixture(),
            opened = await f.send(f.begin);
        if (expired) f.advance(120001);
        const request = {
            op: "abort",
            runtime: "test-runtime",
            transaction_id: opened.transaction_id,
        };
        const result = await f.send(request);
        assert.deepEqual(Object.keys(result).sort(), abortKeys);
        assert.equal(result.state, "aborted");
        assert.equal(result.outcome, "not_applied");
        assert.deepEqual(result.per_store, []);
        assert.deepEqual(await f.send(request), result);
    }
    const f = fixture(),
        preview = f.ports.adapter.preview;
    f.ports.adapter.preview = async (...args) => ({
        ...(await preview(...args)),
        ready: false,
    });
    await f.ready();
    const status = await f.send({
        op: "status",
        operation_id: operation,
        runtime: "test-runtime",
    });
    assert.equal(status.state, "receiving");
    assert.deepEqual(Object.keys(status).sort(), receivingKeys);
});

test("partial aggregate agrees with peer semantics for every bounded store combination", async () => {
    const states = ["verified", "not_applied", "partial", "unknown"];
    for (const a of states)
        for (const b of states) {
            const f = fixture(),
                preview = f.ports.adapter.preview;
            f.ports.adapter.preview = async (...args) => ({
                ...(await preview(...args)),
                stores: [
                    { expected_revision: "a", id: "favorites" },
                    { expected_revision: "b", id: "receipt" },
                ],
            });
            const prepared = await f.ready();
            const evidence = {
                outcome: "partial",
                per_store: [
                    { id: "favorites", outcome: a },
                    { id: "receipt", outcome: b },
                ],
                persistence: "persistent",
            };
            f.ports.adapter.apply = async () => evidence;
            f.ports.adapter.status = async () => evidence;
            const expected =
                [a, b].includes("unknown") ||
                (a === b && (a === "verified" || a === "not_applied"))
                    ? "unknown"
                    : "partial";
            assert.equal(
                (await commit(f, prepared)).outcome,
                expected,
                `${a}/${b} commit`
            );
            assert.equal(
                (
                    await f.send({
                        op: "status",
                        operation_id: operation,
                        runtime: "test-runtime",
                    })
                ).outcome,
                expected,
                `${a}/${b} status`
            );
            const abort = await f.send({
                op: "abort",
                runtime: "test-runtime",
                transaction_id: prepared.transaction_id,
            });
            assert.deepEqual(
                Object.keys(abort).sort(),
                ["version", "runtime", "op", "error"].sort()
            );
            assert.equal(abort.error, "reconciliation_required");
        }
});
