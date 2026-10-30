import {
    parseFavoritesDocumentJson,
    utf8Encode,
} from "./favorites-document-json";

const OPS = [
    "describe",
    "export",
    "begin",
    "append",
    "preview",
    "commit",
    "status",
    "abort",
];
const GLOBAL_PROTOCOL_ERRORS = [
    "invalid_request",
    "envelope_too_large",
    "unsupported",
    "runtime_changed",
    "busy",
    "expired",
    "operation_conflict",
    "transaction_not_found",
    "snapshot_not_found",
    "out_of_order",
    "chunk_conflict",
    "incomplete",
    "hash_mismatch",
    "revision_conflict",
    "context_changed",
    "invalid_document",
    "unportable_export",
    "not_ready",
    "policy_denied",
    "unsupported_persistence",
    "storage_unavailable",
    "limits_exceeded",
    "reconciliation_required",
];
const LIMITS = {
    absolute_ttl_seconds: 600,
    idle_ttl_seconds: 120,
    max_active_transactions: 1,
    max_append_bytes: 8192,
    max_chunks: 256,
    max_document_bytes: 1048576,
    max_entries: 1000,
    max_envelope_bytes: 16384,
    max_export_bytes: 65536,
    max_metadata_bytes: 131072,
    max_preview_rows: 64,
    max_receipt_ledger_bytes: 65536,
    max_receipts: 32,
};
const GLOBAL_PROTOCOL_UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/;
const GLOBAL_PROTOCOL_HASH = /^[0-9a-f]{64}(?![\s\S])/;
function globalFavoritesProtocolFail(code: string): never {
    throw new Error(code);
}
function globalFavoritesProtocolExact(value: any, keys: string[]): boolean {
    return (
        !!value && Object.keys(value).sort().join(",") === keys.sort().join(",")
    );
}
function globalFavoritesProtocolInteger(
    value: any,
    min: number,
    max: number
): boolean {
    return (
        typeof value === "number" &&
        isFinite(value) &&
        Math.floor(value) === value &&
        value >= min &&
        value <= max
    );
}
/** Pure staged protocol. Ports are trusted runtime/physical/receipt boundaries, not wire fields. */
export function createGlobalFavoritesProtocol(ports: any) {
    var snapshot: any = null,
        stage: any = null,
        terminal: any = null,
        admission: any = null,
        busy = false,
        disposed = false,
        requestAdmission: any = null;
    function clearBytes(value: any) {
        if (value && value.bytes) {
            for (var i = 0; i < value.bytes.length; i++) value.bytes[i] = 0;
            value.bytes = null;
        }
    }
    function expire() {
        if (snapshot && ports.now() >= snapshot.expires) {
            clearBytes(snapshot);
            snapshot = null;
        }
        if (
            stage &&
            !stage.started &&
            (ports.now() >= stage.idle || ports.now() >= stage.absolute)
        ) {
            ports.committer.discard(stage.args.operation_id);
            terminal = {
                operation_id: stage.args.operation_id,
                operation_runtime: stage.runtime,
                outcome: "not_applied",
                receipt: null,
                state: "expired",
                transaction_id: stage.id,
            };
            clearBytes(stage);
            ports.clearTimer(stage.timer);
            stage = null;
        }
    }
    function arm(value: any) {
        ports.clearTimer(value.timer);
        value.timer = ports.setTimer(
            expire,
            Math.max(1, Math.min(value.idle, value.absolute) - ports.now())
        );
    }
    function check(value: any, runtime: string) {
        expire();
        if (disposed || !ports.current() || ports.runtime() !== runtime)
            globalFavoritesProtocolFail("runtime_changed");
        if (
            stage !== value ||
            ports.now() >= value.absolute ||
            ports.now() >= value.idle
        )
            globalFavoritesProtocolFail("expired");
        if (!value.grant.current())
            globalFavoritesProtocolFail("context_changed");
        if (!value.started && !value.view.current())
            globalFavoritesProtocolFail("revision_conflict");
    }
    async function context() {
        var value = await ports.captureContext();
        if (
            !value ||
            !GLOBAL_PROTOCOL_HASH.test(value.revision) ||
            typeof value.current !== "function" ||
            !value.current()
        )
            globalFavoritesProtocolFail("context_changed");
        return value;
    }
    function current(runtime: string, deadline: number) {
        if (
            disposed ||
            !ports.current() ||
            ports.runtime() !== runtime ||
            (requestAdmission && !requestAdmission())
        )
            globalFavoritesProtocolFail("runtime_changed");
        if (ports.now() >= deadline) globalFavoritesProtocolFail("expired");
    }
    function metadata(value: any) {
        if (
            utf8Encode(JSON.stringify(value)).length > LIMITS.max_metadata_bytes
        )
            globalFavoritesProtocolFail("limits_exceeded");
        return value;
    }
    async function execute(
        params: any,
        envelopeBytes: number,
        expiresAt: number,
        admission?: () => boolean
    ) {
        var runtime = ports.runtime(),
            replyRuntime =
                params && typeof params.runtime === "string"
                    ? params.runtime
                    : runtime,
            op = params && params.op,
            deadline = Math.min(
                ports.now() + 30000,
                Math.floor(expiresAt * 1000)
            );
        if (busy)
            return {
                error: "busy",
                op: op,
                runtime: replyRuntime,
                subject: "global",
                version: 1,
            };
        busy = true;
        requestAdmission = admission;
        try {
            expire();
            if (
                !globalFavoritesProtocolInteger(
                    envelopeBytes,
                    1,
                    LIMITS.max_envelope_bytes
                )
            )
                globalFavoritesProtocolFail("envelope_too_large");
            if (
                !params ||
                params.runtime !== runtime ||
                OPS.indexOf(op) < 0 ||
                !isFinite(deadline)
            )
                globalFavoritesProtocolFail("invalid_request");
            current(runtime, deadline);
            if (!ports.authorized(op))
                globalFavoritesProtocolFail("policy_denied");
            var data = await operation(params, runtime, deadline);
            current(runtime, deadline);
            return metadata(
                Object.assign(
                    {
                        op: op,
                        runtime: replyRuntime,
                        subject: "global",
                        version: 1,
                    },
                    data
                )
            );
        } catch (error: any) {
            var code = error && (error.code || error.message);
            return {
                error:
                    GLOBAL_PROTOCOL_ERRORS.indexOf(code) >= 0
                        ? code
                        : "storage_unavailable",
                op: op,
                runtime: replyRuntime,
                subject: "global",
                version: 1,
            };
        } finally {
            busy = false;
            requestAdmission = null;
        }
    }
    async function operation(
        p: any,
        runtime: string,
        deadline: number
    ): Promise<any> {
        if (
            p.op === "describe" &&
            globalFavoritesProtocolExact(p, ["op", "runtime"])
        ) {
            var view = await ports.store.snapshot(),
                contextSnapshot = await context(),
                contextRevision = contextSnapshot.revision;
            current(runtime, deadline);
            if (!view.current() || !contextSnapshot.current())
                globalFavoritesProtocolFail("revision_conflict");
            var descriptor: any = null,
                error: any = null;
            try {
                var exported = await ports.facade.exportSnapshot(),
                    doc = ports.codec.document(exported.document);
                if (!doc) globalFavoritesProtocolFail("unportable_export");
                var bytes = utf8Encode(JSON.stringify(doc)),
                    hash = await ports.sha256(bytes);
                current(runtime, deadline);
                if (!exported.current())
                    globalFavoritesProtocolFail("revision_conflict");
                clearBytes(snapshot);
                snapshot =
                    /* biome-ignore assist/source/useSortedKeys: Preserve UUID generation before the snapshot expiry clock sample. */ {
                        id: ports.uuid(),
                        bytes: bytes,
                        hash: hash,
                        revision: view.revision,
                        expires: ports.now() + 600000,
                    };
                if (!GLOBAL_PROTOCOL_UUID.test(snapshot.id))
                    globalFavoritesProtocolFail("invalid_request");
                descriptor = {
                    document_sha256: hash,
                    entries: doc.entries.length,
                    expires_at: new Date(snapshot.expires).toISOString(),
                    size_bytes: bytes.length,
                    snapshot_id: snapshot.id,
                };
            } catch (e: any) {
                error =
                    e.message === "unportable_export"
                        ? "unportable_export"
                        : "storage_unavailable";
            }
            if (!view.current() || !contextSnapshot.current())
                globalFavoritesProtocolFail("revision_conflict");
            await ports.committer.qualify();
            current(runtime, deadline);
            if (!view.current())
                globalFavoritesProtocolFail("revision_conflict");
            if (!contextSnapshot.current())
                globalFavoritesProtocolFail("context_changed");
            var ready =
                !stage &&
                ports.committer.canWrite() &&
                ports.authorized("begin");
            admission = null;
            if (ready) {
                var id = ports.uuid();
                if (!GLOBAL_PROTOCOL_UUID.test(id))
                    globalFavoritesProtocolFail("unsupported");
                admission =
                    /* biome-ignore assist/source/useSortedKeys: Preserve captured revision reads before sampling the admission expiry clock. */ {
                        id: id,
                        runtime: runtime,
                        revision: view.revision,
                        context: contextRevision,
                        expires: ports.now() + 10000,
                    };
            }
            return /* biome-ignore assist/source/useSortedKeys: Preserve policy and blocker callback evaluation relative to response state reads. */ {
                admission: admission
                    ? { operation_id: admission.id, ttl_ms: 10000 }
                    : null,
                revision: view.revision,
                context_revision: contextRevision,
                write_ready: ready,
                write_blocker: ready
                    ? null
                    : stage
                      ? "busy"
                      : !ports.authorized("begin")
                        ? "policy_denied"
                        : ports.committer.blocker(),
                export: descriptor,
                export_error: error,
                limits: LIMITS,
                locator_kinds: ports.locatorKinds.slice().sort(),
            };
        }
        if (
            p.op === "export" &&
            globalFavoritesProtocolExact(p, [
                "op",
                "runtime",
                "snapshot_id",
                "offset",
                "max_bytes",
            ])
        ) {
            if (!snapshot || snapshot.id !== p.snapshot_id)
                globalFavoritesProtocolFail("snapshot_not_found");
            if (
                !globalFavoritesProtocolInteger(
                    p.offset,
                    0,
                    snapshot.bytes.length - 1
                ) ||
                !globalFavoritesProtocolInteger(p.max_bytes, 1, 65536)
            )
                globalFavoritesProtocolFail("invalid_request");
            var end = Math.min(snapshot.bytes.length, p.offset + p.max_bytes),
                exportBytes = snapshot.bytes.slice(p.offset, end),
                hash = await ports.sha256(exportBytes);
            current(runtime, deadline);
            return {
                chunk_sha256: hash,
                data_base64: ports.base64Encode(exportBytes),
                document_sha256: snapshot.hash,
                eof: end === snapshot.bytes.length,
                next_offset: end,
                offset: p.offset,
                revision: snapshot.revision,
                size_bytes: snapshot.bytes.length,
                snapshot_id: snapshot.id,
            };
        }
        if (
            p.op === "begin" &&
            globalFavoritesProtocolExact(p, [
                "op",
                "runtime",
                "operation_id",
                "mode",
                "expected_revision",
                "expected_context_revision",
                "document_sha256",
                "size_bytes",
                "chunk_count",
                "budget_ms",
                "required_kinds",
            ])
        ) {
            if (stage) {
                if (
                    !stage.started &&
                    stage.runtime === runtime &&
                    stage.args.operation_id === p.operation_id &&
                    JSON.stringify(
                        Object.keys(p)
                            .sort()
                            .map(function (key) {
                                return [key, p[key]];
                            })
                    ) ===
                        JSON.stringify(
                            Object.keys(stage.args)
                                .sort()
                                .map(function (key) {
                                    return [key, stage.args[key]];
                                })
                        )
                ) {
                    check(stage, runtime);
                    return stage.beginResult;
                }
                if (stage.args.operation_id === p.operation_id)
                    globalFavoritesProtocolFail("operation_conflict");
                globalFavoritesProtocolFail("busy");
            }
            if (!ports.committer.canWrite())
                globalFavoritesProtocolFail("reconciliation_required");
            if (
                !GLOBAL_PROTOCOL_UUID.test(p.operation_id) ||
                !["merge", "replace"].includes(p.mode) ||
                !GLOBAL_PROTOCOL_HASH.test(p.expected_revision) ||
                !GLOBAL_PROTOCOL_HASH.test(p.expected_context_revision) ||
                !GLOBAL_PROTOCOL_HASH.test(p.document_sha256) ||
                !globalFavoritesProtocolInteger(p.size_bytes, 1, 1048576) ||
                !globalFavoritesProtocolInteger(p.chunk_count, 1, 256) ||
                p.size_bytes > p.chunk_count * 8192 ||
                !globalFavoritesProtocolInteger(p.budget_ms, 1, 600000)
            )
                globalFavoritesProtocolFail("invalid_request");
            if (
                !Array.isArray(p.required_kinds) ||
                p.required_kinds.length > 5 ||
                p.required_kinds.some(function (kind: any, index: number) {
                    return (
                        ports.locatorKinds.indexOf(kind) < 0 ||
                        p.required_kinds.indexOf(kind) !== index ||
                        (index > 0 && p.required_kinds[index - 1] >= kind)
                    );
                })
            )
                globalFavoritesProtocolFail("unsupported");
            if (p.budget_ms < 1500 * (p.chunk_count + 5) + 10000)
                globalFavoritesProtocolFail("invalid_request");
            if (
                !admission ||
                admission.id !== p.operation_id ||
                admission.runtime !== runtime ||
                ports.now() >= admission.expires ||
                admission.revision !== p.expected_revision ||
                admission.context !== p.expected_context_revision
            )
                globalFavoritesProtocolFail("operation_conflict");
            var view = await ports.store.snapshot(),
                contextSnapshot = await context(),
                revision = contextSnapshot.revision;
            current(runtime, deadline);
            if (!view.current() || view.revision !== p.expected_revision)
                globalFavoritesProtocolFail("revision_conflict");
            if (revision !== p.expected_context_revision)
                globalFavoritesProtocolFail("context_changed");
            if (!admission || ports.now() >= admission.expires)
                globalFavoritesProtocolFail("operation_conflict");
            admission = null;
            var grant = {
                current: function () {
                    return (
                        !!stage &&
                        stage.args.operation_id === p.operation_id &&
                        stage.runtime === runtime &&
                        ports.current() &&
                        ports.runtime() === runtime &&
                        ports.now() < stage.absolute &&
                        contextSnapshot.current()
                    );
                },
            };
            stage =
                /* biome-ignore assist/source/useSortedKeys: Preserve UUID, request copy, allocation and the two deadline clock samples. */ {
                    id: ports.uuid(),
                    runtime: runtime,
                    args: JSON.parse(JSON.stringify(p)),
                    bytes: new Uint8Array(p.size_bytes),
                    grant: grant,
                    view: view,
                    next: 0,
                    received: 0,
                    chunks: [],
                    plan: null,
                    started: false,
                    idle: ports.now() + Math.min(120000, p.budget_ms),
                    absolute: ports.now() + p.budget_ms,
                    timer: null,
                };
            if (!GLOBAL_PROTOCOL_UUID.test(stage.id))
                globalFavoritesProtocolFail("invalid_request");
            arm(stage);
            stage.beginResult = {
                absolute_expires_at: new Date(stage.absolute).toISOString(),
                chunk_count: p.chunk_count,
                context_revision: revision,
                document_sha256: p.document_sha256,
                expected_revision: p.expected_revision,
                idle_expires_at: new Date(stage.idle).toISOString(),
                next_seq: 0,
                operation_id: p.operation_id,
                received_bytes: 0,
                required_kinds: p.required_kinds,
                size_bytes: p.size_bytes,
                transaction_id: stage.id,
            };
            return stage.beginResult;
        }
        var value = stage;
        if (
            p.op === "status" &&
            globalFavoritesProtocolExact(p, ["op", "runtime", "operation_id"])
        ) {
            if (!GLOBAL_PROTOCOL_UUID.test(p.operation_id))
                globalFavoritesProtocolFail("invalid_request");
            if (
                value &&
                value.runtime === runtime &&
                value.args.operation_id === p.operation_id
            )
                return {
                    operation_id: p.operation_id,
                    operation_runtime: value.runtime,
                    outcome: value.started ? "unknown" : "not_applied",
                    receipt: null,
                    state: value.started
                        ? "applying"
                        : value.plan
                          ? "ready"
                          : "receiving",
                    transaction_id: value.id,
                };
            if (
                terminal &&
                terminal.operation_id === p.operation_id &&
                ["aborted", "expired"].indexOf(terminal.state) >= 0
            )
                return terminal;
            var result = await ports.committer.status(p.operation_id);
            return {
                operation_id: p.operation_id,
                operation_runtime: result.receipt
                    ? result.receipt.operation_runtime
                    : null,
                outcome: result.outcome,
                receipt: result.receipt,
                state: result.state,
                transaction_id: result.receipt
                    ? result.receipt.transaction_id
                    : null,
            };
        }
        if (!value || p.transaction_id !== value.id)
            globalFavoritesProtocolFail("transaction_not_found");
        check(value, runtime);
        value.idle = Math.min(value.absolute, ports.now() + 120000);
        arm(value);
        if (
            p.op === "append" &&
            globalFavoritesProtocolExact(p, [
                "op",
                "runtime",
                "transaction_id",
                "seq",
                "offset",
                "chunk_sha256",
                "data_base64",
            ])
        ) {
            if (
                !globalFavoritesProtocolInteger(p.seq, 0, 255) ||
                !globalFavoritesProtocolInteger(p.offset, 0, 1048575) ||
                !GLOBAL_PROTOCOL_HASH.test(p.chunk_sha256)
            )
                globalFavoritesProtocolFail("invalid_request");
            var appendBytes = ports.base64Decode(p.data_base64);
            if (
                !(appendBytes instanceof Uint8Array) ||
                !appendBytes.length ||
                appendBytes.length > 8192 ||
                ports.base64Encode(appendBytes) !== p.data_base64
            )
                globalFavoritesProtocolFail("invalid_request");
            var hash = await ports.sha256(appendBytes);
            current(runtime, deadline);
            check(value, runtime);
            if (hash !== p.chunk_sha256)
                globalFavoritesProtocolFail("hash_mismatch");
            if (p.seq < value.next) {
                var prior = value.chunks[p.seq];
                if (
                    !prior ||
                    prior.offset !== p.offset ||
                    prior.hash !== hash ||
                    prior.size !== appendBytes.length
                )
                    globalFavoritesProtocolFail("chunk_conflict");
                return {
                    chunk_sha256: hash,
                    duplicate: true,
                    next_seq: value.next,
                    offset: p.offset,
                    operation_id: value.args.operation_id,
                    received_bytes: value.received,
                    seq: p.seq,
                    transaction_id: value.id,
                };
            }
            if (p.seq !== value.next || p.offset !== value.received)
                globalFavoritesProtocolFail("out_of_order");
            if (
                value.started ||
                value.plan ||
                value.next >= value.args.chunk_count ||
                value.received + appendBytes.length > value.bytes.length
            )
                globalFavoritesProtocolFail("limits_exceeded");
            value.bytes.set(appendBytes, value.received);
            value.chunks.push({
                hash: hash,
                offset: p.offset,
                size: appendBytes.length,
            });
            value.received += appendBytes.length;
            value.next++;
            return {
                chunk_sha256: hash,
                duplicate: false,
                next_seq: value.next,
                offset: p.offset,
                operation_id: value.args.operation_id,
                received_bytes: value.received,
                seq: p.seq,
                transaction_id: value.id,
            };
        }
        if (
            p.op === "preview" &&
            globalFavoritesProtocolExact(p, [
                "op",
                "runtime",
                "transaction_id",
                "page_offset",
                "max_entries",
            ])
        ) {
            if (
                !globalFavoritesProtocolInteger(p.page_offset, 0, 1000) ||
                !globalFavoritesProtocolInteger(p.max_entries, 1, 64)
            )
                globalFavoritesProtocolFail("invalid_request");
            if (
                value.next !== value.args.chunk_count ||
                value.received !== value.bytes.length
            )
                globalFavoritesProtocolFail("incomplete");
            if (!value.plan) {
                if (
                    (await ports.sha256(value.bytes)) !==
                    value.args.document_sha256
                )
                    globalFavoritesProtocolFail("hash_mismatch");
                current(runtime, deadline);
                check(value, runtime);
                var doc = ports.codec.document(
                    parseFavoritesDocumentJson(value.bytes)
                );
                if (!doc) globalFavoritesProtocolFail("invalid_document");
                if (
                    !ports.codec.supports(doc, ports.locatorKinds) ||
                    JSON.stringify(
                        ports.codec.requiredLocatorKinds(doc).slice().sort()
                    ) !==
                        JSON.stringify(value.args.required_kinds.slice().sort())
                )
                    globalFavoritesProtocolFail("unsupported");
                var before = await ports.store.snapshot();
                if (before.revision !== value.args.expected_revision)
                    globalFavoritesProtocolFail("revision_conflict");
                var known: any = Object.create(null),
                    conflicts: any = Object.create(null),
                    conflict = false;
                before.entries.forEach(function (row: any) {
                    known[
                        ports.codec.identity({
                            locator: row.locator,
                            origin: row.origin,
                            title: row.title,
                        })
                    ] = row;
                });
                doc.entries.forEach(function (row: any, index: number) {
                    var prior = known[ports.codec.identity(row)];
                    if (prior && prior.title !== row.title) {
                        conflict = true;
                        conflicts[ports.codec.identity(row)] = {
                            incoming_entry_index: index,
                            reason: "title_mismatch",
                        };
                    }
                });
                var planned = await ports.committer.prepare({
                    admission: function () {
                        return (
                            stage === value &&
                            ports.current() &&
                            ports.runtime() === runtime &&
                            ports.now() < value.absolute &&
                            value.grant.current() &&
                            (!value.commitAdmission || value.commitAdmission())
                        );
                    },
                    change: {
                        entries: doc.entries,
                        op: value.args.mode === "merge" ? "put" : "replace",
                    },
                    expected_context_revision:
                        value.args.expected_context_revision,
                    expected_revision: value.args.expected_revision,
                    input_document_sha256: value.args.document_sha256,
                    operation_id: value.args.operation_id,
                    runtime: runtime,
                    transaction_id: value.id,
                });
                check(value, runtime);
                value.plan = planned;
                var resultEntries = planned.result_document.entries;
                var statuses = await ports.resolve(resultEntries);
                current(runtime, deadline);
                check(value, runtime);
                if (
                    !Array.isArray(statuses) ||
                    statuses.length !== resultEntries.length ||
                    statuses.some(function (x: any) {
                        return (
                            [
                                "resolved",
                                "missing",
                                "ambiguous",
                                "unsupported",
                            ].indexOf(x) < 0
                        );
                    })
                )
                    globalFavoritesProtocolFail("context_changed");
                value.ready = !(value.args.mode === "merge" && conflict);
                value.rows = statuses.map(function (
                    state: string,
                    index: number
                ) {
                    var detail =
                        !value.ready &&
                        conflicts[ports.codec.identity(resultEntries[index])];
                    return Object.assign(
                        { entry_index: index, state: state },
                        detail ? { metadata_conflict: detail } : {}
                    );
                });
                value.resolution = {
                    ambiguous: 0,
                    missing: 0,
                    resolved: 0,
                    unsupported: 0,
                };
                statuses.forEach(function (state: string) {
                    value.resolution[state]++;
                });
                value.ready = !(value.args.mode === "merge" && conflict);
                value.blocker = value.ready ? null : "metadata_conflict";
            }
            if (p.page_offset > value.rows.length)
                globalFavoritesProtocolFail("invalid_request");
            var end = Math.min(
                value.rows.length,
                p.page_offset + p.max_entries
            );
            return {
                blocker: value.blocker,
                context_revision: value.args.expected_context_revision,
                counts: value.plan.counts,
                expected_revision: value.args.expected_revision,
                input_document_sha256: value.args.document_sha256,
                legacy_effects: value.plan.legacy_effects,
                next_offset: end < value.rows.length ? end : null,
                operation_id: value.args.operation_id,
                page_offset: p.page_offset,
                plan_digest: value.plan.plan_digest,
                ready: value.ready,
                required_kinds: value.args.required_kinds,
                resolution_counts: value.resolution,
                result_document_sha256: value.plan.result_document_sha256,
                rows: value.rows.slice(p.page_offset, end),
                transaction_id: value.id,
            };
        }
        if (
            p.op === "commit" &&
            globalFavoritesProtocolExact(p, [
                "op",
                "runtime",
                "transaction_id",
                "operation_id",
                "plan_digest",
            ])
        ) {
            if (
                p.operation_id !== value.args.operation_id ||
                !value.plan ||
                !value.ready ||
                p.plan_digest !== value.plan.plan_digest
            )
                globalFavoritesProtocolFail("not_ready");
            if (value.started)
                globalFavoritesProtocolFail("reconciliation_required");
            var admitted = requestAdmission;
            value.commitAdmission = function () {
                return ports.now() < deadline && (!admitted || admitted());
            };
            value.started = true;
            var result: any;
            try {
                result = await ports.committer.commit(
                    p.operation_id,
                    p.plan_digest
                );
            } catch (_) {
                result = { outcome: "unknown", receipt: null };
            }
            terminal = {
                operation_id: p.operation_id,
                operation_runtime: runtime,
                outcome: result.outcome,
                receipt: result.receipt,
                state:
                    result.outcome === "verified"
                        ? "committed"
                        : result.outcome === "not_applied"
                          ? "aborted"
                          : "unknown",
                transaction_id: value.id,
            };
            ports.clearTimer(value.timer);
            clearBytes(value);
            stage = null;
            if (result.outcome !== "verified")
                globalFavoritesProtocolFail(
                    result.outcome === "not_applied"
                        ? "revision_conflict"
                        : "reconciliation_required"
                );
            return {
                operation_id: p.operation_id,
                receipt: result.receipt,
                transaction_id: value.id,
            };
        }
        if (
            p.op === "abort" &&
            globalFavoritesProtocolExact(p, [
                "op",
                "runtime",
                "transaction_id",
                "operation_id",
            ])
        ) {
            if (p.operation_id !== value.args.operation_id)
                globalFavoritesProtocolFail("operation_conflict");
            if (value.started)
                globalFavoritesProtocolFail("reconciliation_required");
            ports.committer.discard(p.operation_id);
            terminal = {
                operation_id: p.operation_id,
                operation_runtime: runtime,
                outcome: "not_applied",
                receipt: null,
                state: "aborted",
                transaction_id: value.id,
            };
            ports.clearTimer(value.timer);
            clearBytes(value);
            stage = null;
            return {
                operation_id: p.operation_id,
                outcome: "not_applied",
                state: "aborted",
                transaction_id: value.id,
            };
        }
        globalFavoritesProtocolFail("invalid_request");
    }
    return {
        capability: function () {
            return { version: 1 };
        },
        dispose: function () {
            disposed = true;
            if (stage && !stage.started) {
                ports.committer.discard(stage.args.operation_id);
                ports.clearTimer(stage.timer);
                clearBytes(stage);
                stage = null;
            }
            clearBytes(snapshot);
            snapshot = null;
        },
        execute: execute,
        freshAdmission: function (id: string, hash: string) {
            return (
                !!stage &&
                !stage.started &&
                stage.args.operation_id === id &&
                stage.args.document_sha256 === hash &&
                stage.grant.current()
            );
        },
    };
}
