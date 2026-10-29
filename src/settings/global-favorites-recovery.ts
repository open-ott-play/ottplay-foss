import { globalFavoritesReceiptSchema as schema } from "./global-favorites-receipt-codec";
const LEDGER = "favorites-global-receipts.v1",
    STORE = "remoteFavorites.v1",
    REASON = "accept-unknown-no-replay";
const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/;
const HASH = /^[0-9a-f]{64}(?![\s\S])/;
function fail(code: string): never {
    throw new Error(code);
}
function canonical(value: any): string {
    if (value === null || typeof value !== "object")
        return JSON.stringify(value);
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    return (
        "{" +
        Object.keys(value)
            .sort()
            .map(function (key) {
                return JSON.stringify(key) + ":" + canonical(value[key]);
            })
            .join(",") +
        "}"
    );
}
function protectedRow(row: any): boolean {
    return ["pending", "partial", "unknown"].indexOf(row.state) >= 0;
}
export async function globalFavoritesBackendProof(
    grant: any,
    sha256: (text: string) => Promise<string>
): Promise<string> {
    return sha256(
        JSON.stringify([
            "ottplay-favorites-global-backend-v1",
            grant.origin,
            LEDGER,
            STORE,
            grant.lockName,
            grant.kind,
            1,
            grant.implementationVersion,
        ])
    );
}
export async function verifyGlobalFavoritesAudit(
    row: any,
    sha256: (text: string) => Promise<string>
): Promise<boolean> {
    if (!row.recovery_ack) return false;
    var copy: any = {};
    Object.keys(row).forEach(function (key) {
        if (key !== "recovery_ack") copy[key] = row[key];
    });
    var original = await sha256(canonical(copy)),
        audit = row.recovery_ack;
    var expected = await sha256(
        JSON.stringify([
            "ottplay-favorites-global-recovery-ack-v1",
            audit.runtime,
            "global",
            row.operationId,
            row.refs.runtimeId,
            original,
            audit.ledger_revision_before,
            audit.store_revision,
            audit.context_revision,
            audit.backend_proof,
            audit.reason,
        ])
    );
    return (
        expected === audit.acknowledgement_id &&
        row.fence &&
        row.fence.backendProof === audit.backend_proof
    );
}
/** Separate global family: audit-only one-CAS recovery, never original operation replay. */
export function createGlobalFavoritesRecovery(ports: any) {
    async function hash(value: string) {
        var result = await ports.sha256(value);
        if (!HASH.test(result)) fail("hash_unavailable");
        return result;
    }
    async function original(row: any) {
        var copy: any = {};
        Object.keys(row).forEach(function (key) {
            if (key !== "recovery_ack") copy[key] = row[key];
        });
        return hash(canonical(copy));
    }
    async function record(row: any) {
        var digest = await original(row),
            audit = row.recovery_ack || null;
        if (audit) {
            var expected = await hash(
                JSON.stringify([
                    "ottplay-favorites-global-recovery-ack-v1",
                    audit.runtime,
                    "global",
                    row.operationId,
                    row.refs.runtimeId,
                    digest,
                    audit.ledger_revision_before,
                    audit.store_revision,
                    audit.context_revision,
                    audit.backend_proof,
                    audit.reason,
                ])
            );
            if (expected !== audit.acknowledgement_id) fail("invalid_ledger");
        }
        return {
            operation_id: row.operationId,
            operation_runtime: row.refs.runtimeId,
            subject: "global",
            original_state: row.state,
            original_outcome: row.state === "partial" ? "partial" : "unknown",
            original_entry_sha256: digest,
            acknowledgement: audit,
        };
    }
    async function view(
        grant: any,
        runtime: string,
        context: any,
        current: () => boolean
    ) {
        var raw = grant.read(LEDGER),
            store = grant.read(STORE),
            parsed = schema.parse(raw);
        var ledgerRevision = await hash(raw === null ? "null" : raw),
            storeRevision = await hash(store === null ? "null" : store),
            proof = await globalFavoritesBackendProof(grant, hash);
        if (
            !current() ||
            grant.read(LEDGER) !== raw ||
            grant.read(STORE) !== store ||
            !current()
        )
            fail("revision_conflict");
        var rows = parsed.entries.filter(protectedRow).sort(function (
            a: any,
            b: any
        ) {
            return a.operationId < b.operationId
                ? -1
                : a.operationId > b.operationId
                  ? 1
                  : 0;
        });
        var records: any[] = [];
        for (var i = 0; i < rows.length; i++)
            records.push(await record(rows[i]));
        if (
            !current() ||
            grant.read(LEDGER) !== raw ||
            grant.read(STORE) !== store
        )
            fail("revision_conflict");
        return {
            raw: raw,
            store: store,
            parsed: parsed,
            rows: rows,
            records: records,
            meta: {
                version: 1,
                runtime: runtime,
                op: "inspect",
                subject: "global",
                ledger_format: 1,
                ledger_revision: ledgerRevision,
                store_revision: storeRevision,
                context_revision: context.revision,
                backend_proof: proof,
            },
        };
    }
    async function selected(state: any, id: string, runtime: string) {
        var index = state.rows.findIndex(function (row: any) {
                return row.operationId === id;
            }),
            row = index < 0 ? null : state.rows[index],
            record = index < 0 ? null : state.records[index];
        var result: any = Object.assign({}, state.meta, {
            operation_id: id,
            record: record,
            acknowledge_allowed: false,
            acknowledgement_id: null,
            after_ledger_sha256: null,
            plan_sha256: null,
        });
        if (
            !ports.authorized("acknowledge") ||
            !row ||
            row.recovery_ack ||
            !row.fence ||
            row.fence.backendProof !== state.meta.backend_proof
        )
            return { result: result, after: null };
        var acknowledgement = await hash(
            JSON.stringify([
                "ottplay-favorites-global-recovery-ack-v1",
                runtime,
                "global",
                id,
                row.refs.runtimeId,
                record.original_entry_sha256,
                state.meta.ledger_revision,
                state.meta.store_revision,
                state.meta.context_revision,
                state.meta.backend_proof,
                REASON,
            ])
        );
        var after = JSON.parse(state.raw),
            target = after.entries.filter(function (entry: any) {
                return entry.operationId === id;
            })[0];
        target.recovery_ack = {
            acknowledgement_id: acknowledgement,
            runtime: runtime,
            ledger_revision_before: state.meta.ledger_revision,
            store_revision: state.meta.store_revision,
            context_revision: state.meta.context_revision,
            backend_proof: state.meta.backend_proof,
            reason: REASON,
        };
        var afterRaw = JSON.stringify(after);
        if (!schema.capacity(afterRaw) || afterRaw === state.raw)
            fail("capacity");
        if (utf8Size(afterRaw) - utf8Size(state.raw) > 1024) fail("capacity");
        var afterHash = await hash(afterRaw),
            plan = await hash(
                JSON.stringify([
                    "ottplay-favorites-global-recovery-plan-v1",
                    runtime,
                    "global",
                    id,
                    row.refs.runtimeId,
                    record.original_entry_sha256,
                    state.meta.ledger_revision,
                    state.meta.store_revision,
                    state.meta.context_revision,
                    state.meta.backend_proof,
                    REASON,
                    acknowledgement,
                    afterHash,
                ])
            );
        Object.assign(result, {
            acknowledge_allowed: true,
            acknowledgement_id: acknowledgement,
            after_ledger_sha256: afterHash,
            plan_sha256: plan,
        });
        return { result: result, after: afterRaw };
    }
    function utf8Size(raw: string) {
        return encodeURIComponent(raw).replace(/%[0-9A-F]{2}/g, "x").length;
    }
    async function execute(request: any, admission?: () => boolean) {
        var runtime = ports.runtime(),
            deadline = Math.floor(request.expires_at * 1000),
            p = request.params;
        if (
            !p ||
            p.runtime !== runtime ||
            p.subject !== "global" ||
            ["inspect", "acknowledge"].indexOf(p.op) < 0
        )
            fail("invalid_request");
        if (!ports.authorized(p.op)) fail("policy_denied");
        if (p.operation_id !== undefined && !UUID.test(p.operation_id))
            fail("invalid_request");
        var grant = ports.capture(),
            context = await ports.captureContext();
        if (
            !grant ||
            !context ||
            !HASH.test(context.revision) ||
            typeof context.current !== "function"
        )
            fail("unsupported_persistence");
        function current() {
            return (
                ports.current() &&
                (!admission || admission()) &&
                ports.runtime() === runtime &&
                ports.now() < deadline &&
                grant.current() &&
                context.current() &&
                ports.authorized(p.op)
            );
        }
        if (!current()) fail("context_changed");
        return grant.exclusive(async function (held: any) {
            if (held !== grant || !current()) fail("context_changed");
            var state = await view(grant, runtime, context, current);
            if (
                p.op === "inspect" &&
                Object.prototype.hasOwnProperty.call(p, "cursor")
            ) {
                if (
                    Object.keys(p).sort().join(",") !==
                    "cursor,op,runtime,subject"
                )
                    fail("invalid_request");
                var offset = 0;
                if (p.cursor !== null) {
                    var cursor = p.cursor;
                    if (
                        Object.keys(cursor).sort().join(",") !==
                        "after_operation_id,backend_proof,context_revision,ledger_revision,store_revision"
                    )
                        fail("invalid_request");
                    for (var name of [
                        "backend_proof",
                        "context_revision",
                        "ledger_revision",
                        "store_revision",
                    ])
                        if (cursor[name] !== state.meta[name])
                            fail("revision_conflict");
                    var at = state.rows.findIndex(function (row: any) {
                        return row.operationId === cursor.after_operation_id;
                    });
                    if (
                        at < 0 ||
                        (at + 1) % 16 !== 0 ||
                        at >= state.rows.length - 1
                    )
                        fail("invalid_cursor");
                    offset = at + 1;
                }
                var end = Math.min(state.records.length, offset + 16),
                    next =
                        end < state.records.length
                            ? Object.assign(
                                  {
                                      after_operation_id:
                                          state.rows[end - 1].operationId,
                                  },
                                  {
                                      backend_proof: state.meta.backend_proof,
                                      context_revision:
                                          state.meta.context_revision,
                                      ledger_revision:
                                          state.meta.ledger_revision,
                                      store_revision: state.meta.store_revision,
                                  }
                              )
                            : null;
                return Object.assign({}, state.meta, {
                    total: state.records.length,
                    records: state.records.slice(offset, end),
                    next_cursor: next,
                });
            }
            var planned = await selected(state, p.operation_id, runtime);
            if (p.op === "inspect") {
                if (
                    Object.keys(p).sort().join(",") !==
                    "op,operation_id,runtime,subject"
                )
                    fail("invalid_request");
                if (
                    !current() ||
                    grant.read(LEDGER) !== state.raw ||
                    grant.read(STORE) !== state.store
                )
                    fail("revision_conflict");
                return planned.result;
            }
            if (
                Object.keys(p).sort().join(",") !==
                    "accept_unknown,acknowledgement_id,after_ledger_sha256,backend_proof,expected_context_revision,expected_ledger_revision,expected_store_revision,op,operation_id,operation_runtime,original_entry_sha256,plan_sha256,reason,runtime,subject" ||
                p.accept_unknown !== true ||
                p.reason !== REASON ||
                !planned.result.acknowledge_allowed
            )
                fail("invalid_request");
            var expected = {
                operation_runtime: planned.result.record.operation_runtime,
                original_entry_sha256:
                    planned.result.record.original_entry_sha256,
                expected_ledger_revision: state.meta.ledger_revision,
                expected_store_revision: state.meta.store_revision,
                expected_context_revision: state.meta.context_revision,
                backend_proof: state.meta.backend_proof,
                acknowledgement_id: planned.result.acknowledgement_id,
                after_ledger_sha256: planned.result.after_ledger_sha256,
                plan_sha256: planned.result.plan_sha256,
            };
            for (var key of Object.keys(expected))
                if (p[key] !== expected[key]) fail("revision_conflict");
            if (
                !current() ||
                grant.read(LEDGER) !== state.raw ||
                grant.read(STORE) !== state.store ||
                !current()
            )
                fail("revision_conflict");
            var conditional = function () {
                return current() && grant.read(STORE) === state.store;
            };
            var outcome: string;
            try {
                outcome = grant.compareAndSwap(
                    LEDGER,
                    state.raw,
                    planned.after,
                    conditional
                );
            } catch (_) {
                fail("outcome_unknown");
            }
            if (outcome === "conflict") fail("revision_conflict");
            try {
                if (
                    outcome !== "confirmed" ||
                    !current() ||
                    grant.read(LEDGER) !== planned.after ||
                    grant.read(STORE) !== state.store
                )
                    fail("outcome_unknown");
                var afterState = await view(grant, runtime, context, current),
                    row = afterState.records.filter(function (row: any) {
                        return row.operation_id === p.operation_id;
                    })[0];
                if (
                    afterState.raw !== planned.after ||
                    afterState.store !== state.store ||
                    !current()
                )
                    fail("outcome_unknown");
                return {
                    version: 1,
                    runtime: runtime,
                    op: "acknowledge",
                    subject: "global",
                    operation_id: p.operation_id,
                    operation_runtime: p.operation_runtime,
                    acknowledgement_id: p.acknowledgement_id,
                    plan_sha256: p.plan_sha256,
                    acknowledged: true,
                    persistence: "persistent",
                    ledger_revision: planned.result.after_ledger_sha256,
                    store_revision: state.meta.store_revision,
                    context_revision: state.meta.context_revision,
                    record: row,
                };
            } catch (_) {
                fail("outcome_unknown");
            }
        });
    }
    return { execute: execute };
}
