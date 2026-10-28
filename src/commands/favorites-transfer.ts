/** Pure transfer foundation. No transport registration, provider activation or storage binding. */
export interface FavoritesTransferScope {
    profileBindingId: string;
    provider: string;
    sourceBindingId: string;
}
export interface FavoritesTransferAdmission {
    binding_revision: string;
    /** Actual adapter admission, including whole-operation budget and replay fencing. */
    budgetAccepted?: boolean;
    current(): boolean;
    operationFresh?: boolean;
    persistence: "persistent";
    revision: string;
}
export interface FavoritesTransferCounts {
    channelLists: number;
    channelMemberships: number;
    mediaFavorites: number;
    unresolved: number;
}
export interface FavoritesTransferDiagnostic {
    collection: "channelLists" | "mediaFavorites";
    entry_index: number;
    list_index?: number;
    reason: "missing" | "ambiguous" | "legacy-unportable" | "codec-unavailable";
}
export interface FavoritesTransferPlan {
    base_revision: string;
    binding_revision: string;
    counts: FavoritesTransferCounts;
    coverage: any;
    persistence: "persistent";
    ready: boolean;
    stores: { id: string; expected_revision: string }[];
    unresolved: FavoritesTransferDiagnostic[];
    /** Deterministic exact physical write descriptors/digests; never a public response. */
    writePlan: any;
}
export interface FavoritesTransferOutcome {
    evidence_complete?: boolean;
    outcome: "verified" | "not_applied" | "partial" | "unknown";
    per_store: { id: string; outcome: string }[];
    persistence: "persistent";
    receipt?: any;
    receipt_verified?: boolean;
}
/** Internal trusted stage identity; never accepted from wire metadata. */
export interface FavoritesTransferInspectContext {
    document_sha256: string;
    operation_id: string;
    runtime: string;
    transaction_id: string;
}
export interface FavoritesTransferPorts {
    adapter: {
        /** operationFresh must be proven by replay admission, never missing-receipt inference. */
        inspect(
            scope: FavoritesTransferScope,
            operationId?: string,
            context?: FavoritesTransferInspectContext
        ): Promise<FavoritesTransferAdmission>;
        snapshot(
            scope: FavoritesTransferScope,
            current: () => boolean
        ): Promise<{
            bytes: Uint8Array;
            revision: string;
            binding_revision: string;
        }>;
        preview(
            bytes: Uint8Array,
            scope: FavoritesTransferScope,
            admission: FavoritesTransferAdmission,
            current: () => boolean
        ): Promise<FavoritesTransferPlan>;
        apply(
            plan: FavoritesTransferPlan,
            context: any,
            current: () => boolean
        ): Promise<FavoritesTransferOutcome>;
        /** Read back real covered stores/receipt. Absence is unknown, not permission to replay. */
        status(
            operationId: string,
            current: () => boolean
        ): Promise<FavoritesTransferOutcome | null>;
    };
    /** Strict canonical base64; malformed input must throw. */
    base64Decode(value: string): Uint8Array;
    base64Encode(value: Uint8Array): string;
    clearTimer(timer: any): void;
    /** Strict UTF-8/duplicate-key/schema/locator validation; refuses any lossy subset. */
    codec: { validate(bytes: Uint8Array, scope: FavoritesTransferScope): void };
    now(): number;
    runtime(): string;
    setTimer(callback: () => void, milliseconds: number): any;
    sha256(value: Uint8Array): string | Promise<string>;
    utf8(value: string): Uint8Array;
    /** Host cryptographically random UUIDv4; no Math.random/time fallback is supplied. */
    uuid(): string;
}
export interface FavoritesTransferTransport {
    /** Trusted dispatch cancellation; not a wire parameter. */
    current?(): boolean;
    deadlineAt: number;
    /** Trusted transport's actual parsed envelope including id/action/params/expires_at. Not user params. */
    envelope: { params: any; [key: string]: any };
    runtime: string;
}
export const FAVORITES_TRANSFER_ERRORS = [
    "invalid_request",
    "envelope_too_large",
    "runtime_changed",
    "busy",
    "expired",
    "operation_conflict",
    "transaction_not_found",
    "out_of_order",
    "chunk_conflict",
    "incomplete",
    "hash_mismatch",
    "revision_conflict",
    "binding_changed",
    "policy_denied",
    "unsupported_persistence",
    "codec_error",
    "not_ready",
    "reconciliation_required",
    "storage_unavailable",
    "limits_exceeded",
];
const DOCUMENT_LIMIT = 1048576;
const CHUNK_LIMIT = 8192;
const METADATA_LIMIT = 131072;
const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/;
const SHA = /^[0-9a-f]{64}(?![\s\S])/;
const OUTCOMES = ["verified", "not_applied", "partial", "unknown"];

export function createFavoritesTransfer(ports: FavoritesTransferPorts) {
    var stage: any = null;
    var terminal: any = null;
    var executing = false;
    var inflight: any = null;
    var operationDeadline = 0;
    var disposed = false;
    var waits: { cancel(): void }[] = [];
    var operationCurrent = () => true;
    function fail(code: string): never {
        throw new Error(code);
    }
    function object(value: any): boolean {
        return !!value && typeof value === "object" && !Array.isArray(value);
    }
    function exact(
        value: any,
        required: string[],
        optional: string[] = []
    ): boolean {
        return (
            object(value) &&
            required.every((key) =>
                Object.prototype.hasOwnProperty.call(value, key)
            ) &&
            Object.keys(value).every(
                (key) =>
                    required.indexOf(key) >= 0 || optional.indexOf(key) >= 0
            )
        );
    }
    function text(value: any, max = 256): boolean {
        return (
            typeof value === "string" &&
            value.length > 0 &&
            ports.utf8(value).length <= max &&
            !/[\u0000-\u001f\u007f]/.test(value)
        );
    }
    function integer(value: any, min: number, max: number): boolean {
        return (
            typeof value === "number" &&
            isFinite(value) &&
            Math.floor(value) === value &&
            value >= min &&
            value <= max
        );
    }
    function scopeValid(value: any): boolean {
        return (
            exact(value, ["profileBindingId", "sourceBindingId", "provider"]) &&
            UUID.test(value.profileBindingId) &&
            UUID.test(value.sourceBindingId) &&
            /^[a-z][a-z0-9-]{0,31}(?![\s\S])/.test(value.provider)
        );
    }
    function canonical(value: any, depth = 0): string {
        if (depth > 32) fail("limits_exceeded");
        if (
            value === null ||
            typeof value === "string" ||
            typeof value === "boolean"
        )
            return JSON.stringify(value);
        if (typeof value === "number") {
            if (!isFinite(value)) fail("invalid_request");
            return JSON.stringify(value);
        }
        if (Array.isArray(value)) {
            if (Object.keys(value).length !== value.length)
                fail("invalid_request");
            return (
                "[" +
                value.map((part) => canonical(part, depth + 1)).join(",") +
                "]"
            );
        }
        if (!object(value)) fail("invalid_request");
        return (
            "{" +
            Object.keys(value)
                .sort()
                .map(
                    (key) =>
                        JSON.stringify(key) +
                        ":" +
                        canonical(value[key], depth + 1)
                )
                .join(",") +
            "}"
        );
    }
    function bounded(value: any, max = METADATA_LIMIT): any {
        var serialized = canonical(value);
        if (ports.utf8(serialized).length > max) fail("limits_exceeded");
        return JSON.parse(serialized);
    }
    function clearBytes(value: any): void {
        if (!value || !value.bytes) return;
        for (var i = 0; i < value.bytes.length; i++) value.bytes[i] = 0;
        value.bytes = null;
        value.chunks = [];
    }
    function finish(state: string, outcome?: any): void {
        var value = stage;
        terminal = Object.assign(
            {
                operation_id: value.args.operation_id,
                scope: value.args.scope,
                state: state,
                transaction_id: value.id,
            },
            typeof outcome === "object"
                ? bounded(outcome)
                : {
                      outcome: outcome || "not_applied",
                      per_store: [],
                      persistence: "persistent",
                  }
        );
        if (value.timer !== null) ports.clearTimer(value.timer);
        if (!inflight || inflight.value !== value || !inflight.pending)
            clearBytes(value);
        stage = null;
    }
    function abortResult(): any {
        if (!terminal || terminal.state === "committed")
            fail("reconciliation_required");
        return {
            operation_id: terminal.operation_id,
            outcome: "not_applied",
            per_store: [],
            persistence: "persistent",
            state: "aborted",
            transaction_id: terminal.transaction_id,
        };
    }
    function expire(): void {
        if (
            stage &&
            !stage.writesStarted &&
            (stage.runtime !== ports.runtime() ||
                ports.now() >= stage.idle ||
                ports.now() >= stage.absolute)
        )
            finish("expired");
    }
    function active(value: any, runtime: string): boolean {
        return (
            !disposed &&
            operationCurrent() &&
            stage === value &&
            value.runtime === runtime &&
            ports.runtime() === runtime &&
            ports.now() < value.idle &&
            ports.now() < value.absolute &&
            value.admission.current()
        );
    }
    function check(value: any, runtime: string): void {
        if (ports.runtime() !== runtime) fail("runtime_changed");
        if (!active(value, runtime)) fail("expired");
    }
    function arm(value: any): void {
        if (value.timer !== null) ports.clearTimer(value.timer);
        value.timer = ports.setTimer(
            function () {
                value.timer = null;
                if (stage !== value) return;
                expire();
                if (stage === value && !value.writesStarted) arm(value);
            },
            Math.max(0, Math.min(value.idle, value.absolute) - ports.now())
        );
    }
    function touch(value: any): void {
        value.idle = Math.min(value.absolute, ports.now() + 120000);
        arm(value);
    }
    function wait<T>(
        promise: Promise<T>,
        deadline = operationDeadline
    ): Promise<T> {
        return new Promise(function (resolve, reject) {
            var settled = false;
            var timer: any = null;
            function finishWait(): boolean {
                if (settled) return false;
                settled = true;
                if (timer !== null) ports.clearTimer(timer);
                var at = waits.indexOf(waiter);
                if (at >= 0) waits.splice(at, 1);
                return true;
            }
            var waiter = {
                cancel: function () {
                    if (finishWait()) reject(new Error("expired"));
                },
            };
            waits.push(waiter);
            if (disposed) waiter.cancel();
            else
                timer = ports.setTimer(
                    waiter.cancel,
                    Math.max(0, deadline - ports.now())
                );
            Promise.resolve(promise).then(
                function (value) {
                    if (finishWait()) resolve(value);
                },
                function (error) {
                    if (finishWait()) reject(error);
                }
            );
        });
    }
    function ack(value: any): any {
        return {
            next_seq: value.next,
            received_bytes: value.received,
            transaction_id: value.id,
        };
    }
    function admissionValid(value: any): boolean {
        return (
            value &&
            text(value.revision) &&
            text(value.binding_revision) &&
            typeof value.current === "function" &&
            value.current()
        );
    }
    async function digest(bytes: Uint8Array): Promise<string> {
        var value = await wait(Promise.resolve(ports.sha256(bytes)));
        if (!SHA.test(value)) fail("storage_unavailable");
        return value;
    }
    function countsValid(value: any): boolean {
        return (
            exact(value, [
                "channelLists",
                "channelMemberships",
                "mediaFavorites",
                "unresolved",
            ]) &&
            Object.keys(value).every((key) => integer(value[key], 0, 1000000))
        );
    }
    function diagnosticsValid(rows: any, counts: any): boolean {
        return (
            Array.isArray(rows) &&
            rows.length <= 128 &&
            rows.length <= counts.unresolved &&
            rows.every(
                (row) =>
                    exact(
                        row,
                        ["collection", "entry_index", "reason"],
                        ["list_index"]
                    ) &&
                    ["channelLists", "mediaFavorites"].indexOf(
                        row.collection
                    ) >= 0 &&
                    integer(row.entry_index, 0, 1000000) &&
                    (row.collection === "channelLists"
                        ? integer(row.list_index, 0, 1000000)
                        : row.list_index === undefined) &&
                    [
                        "missing",
                        "ambiguous",
                        "legacy-unportable",
                        "codec-unavailable",
                    ].indexOf(row.reason) >= 0
            )
        );
    }
    function planPublic(value: FavoritesTransferPlan): any {
        return {
            base_revision: value.base_revision,
            binding_revision: value.binding_revision,
            counts: value.counts,
            coverage: value.coverage,
            persistence: value.persistence,
            ready: value.ready,
            stores: value.stores,
            unresolved: value.unresolved,
        };
    }
    function outcome(value: any, expected?: any): FavoritesTransferOutcome {
        if (
            !value ||
            OUTCOMES.indexOf(value.outcome) < 0 ||
            value.persistence !== "persistent" ||
            !Array.isArray(value.per_store)
        )
            fail("storage_unavailable");
        if (
            !exact(
                value,
                ["outcome", "persistence", "per_store"],
                ["evidence_complete", "receipt_verified", "receipt"]
            )
        )
            fail("storage_unavailable");
        var result = bounded(value);
        if (
            result.per_store.length > 64 ||
            result.per_store.some(
                (row: any) =>
                    !exact(row, ["id", "outcome"]) ||
                    !text(row.id) ||
                    OUTCOMES.indexOf(row.outcome) < 0
            )
        )
            fail("limits_exceeded");
        var names = result.per_store.map((row: any) => row.id);
        if (names.some((name: string, i: number) => names.indexOf(name) !== i))
            fail("storage_unavailable");
        if (expected) {
            var ids = expected.plan.stores.map((row: any) => row.id).sort();
            if (canonical(names.slice().sort()) !== canonical(ids))
                result.outcome = "unknown";
            if (result.outcome === "verified") {
                var receipt = result.receipt;
                if (
                    !result.receipt_verified ||
                    !result.evidence_complete ||
                    result.per_store.some(
                        (row: any) => row.outcome !== "verified"
                    ) ||
                    !receipt ||
                    receipt.operation_id !== expected.args.operation_id ||
                    canonical(receipt.scope) !==
                        canonical(expected.args.scope) ||
                    receipt.document_sha256 !== expected.args.document_sha256 ||
                    receipt.plan_digest !== expected.planDigest ||
                    canonical(receipt.counts) !==
                        canonical(expected.plan.counts) ||
                    !text(receipt.new_revision)
                )
                    result.outcome = "unknown";
            }
        }
        if (
            result.outcome === "verified" &&
            (!result.receipt_verified ||
                !result.evidence_complete ||
                !result.receipt ||
                !UUID.test(result.receipt.operation_id) ||
                !scopeValid(result.receipt.scope) ||
                !SHA.test(result.receipt.document_sha256) ||
                !SHA.test(result.receipt.plan_digest) ||
                !text(result.receipt.new_revision) ||
                !countsValid(result.receipt.counts) ||
                result.receipt.outcome !== "verified" ||
                result.receipt.persistence !== "persistent" ||
                !result.per_store.length ||
                result.per_store.some((row: any) => row.outcome !== "verified"))
        )
            result.outcome = "unknown";
        if (
            result.outcome === "partial" &&
            (result.per_store.some((row: any) => row.outcome === "unknown") ||
                !(
                    result.per_store.some(
                        (row: any) => row.outcome === "partial"
                    ) ||
                    (result.per_store.some(
                        (row: any) => row.outcome === "verified"
                    ) &&
                        result.per_store.some(
                            (row: any) => row.outcome === "not_applied"
                        ))
                ))
        )
            result.outcome = "unknown";
        if (
            result.outcome === "not_applied" &&
            (!result.evidence_complete ||
                result.per_store.some(
                    (row: any) => row.outcome !== "not_applied"
                ))
        )
            result.outcome = "unknown";
        return result;
    }
    function publicOutcome(value: FavoritesTransferOutcome): any {
        var result: any = {
            outcome: value.outcome,
            per_store: value.per_store,
            persistence: value.persistence,
        };
        if (
            value.outcome === "verified" &&
            value.receipt_verified &&
            value.receipt
        ) {
            result.receipt = {
                counts: value.receipt.counts,
                document_sha256: value.receipt.document_sha256,
                new_revision: value.receipt.new_revision,
                operation_id: value.receipt.operation_id,
                outcome: "verified",
                persistence: "persistent",
                plan_digest: value.receipt.plan_digest,
                scope: value.receipt.scope,
            };
        }
        return result;
    }
    async function run(
        params: any,
        transport: FavoritesTransferTransport
    ): Promise<any> {
        var runtime = ports.runtime(),
            op =
                params &&
                typeof params.op === "string" &&
                params.op.length <= 32
                    ? params.op
                    : "invalid";
        var response = (value: any) => {
            var result = Object.assign({}, value, {
                op: op,
                runtime: runtime,
                version: 1,
            });
            if (ports.utf8(JSON.stringify(result)).length > 2097152)
                fail("limits_exceeded");
            return bounded(result, 2097152);
        };
        var busy = executing;
        if (!busy) executing = true;
        try {
            if (
                disposed ||
                !object(params) ||
                !text(runtime) ||
                params.runtime !== runtime ||
                !transport ||
                transport.runtime !== runtime ||
                !integer(transport.deadlineAt, 1, 9007199254740991) ||
                transport.deadlineAt <= ports.now()
            )
                fail("runtime_changed");
            if (
                !object(transport.envelope) ||
                ports.utf8(JSON.stringify(transport.envelope)).length > 16384
            )
                fail("envelope_too_large");
            if (canonical(transport.envelope.params) !== canonical(params))
                fail("invalid_request");
            if (inflight?.pending) {
                if (
                    op === "status" &&
                    exact(params, ["op", "runtime", "operation_id"]) &&
                    params.operation_id === inflight.value.args.operation_id
                )
                    return response({
                        operation_id: params.operation_id,
                        outcome: "unknown",
                        per_store: [],
                        persistence: "persistent",
                        state: "committed",
                    });
                if (
                    op === "abort" &&
                    exact(params, ["op", "runtime", "transaction_id"]) &&
                    params.transaction_id === inflight.value.id
                )
                    fail("reconciliation_required");
                fail("busy");
            }
            if (busy) fail("busy");
            operationCurrent = () =>
                !disposed && (!transport.current || transport.current());
            if (!operationCurrent()) fail("expired");
            operationDeadline = transport.deadlineAt;
            expire();
            var common = ["op", "runtime"];
            if (op === "snapshot") {
                if (
                    !exact(params, common.concat(["scope"])) ||
                    !scopeValid(params.scope)
                )
                    fail("invalid_request");
                var admitted = await wait(ports.adapter.inspect(params.scope));
                if (ports.runtime() !== runtime || !admissionValid(admitted))
                    fail("policy_denied");
                if (admitted.persistence !== "persistent")
                    fail("unsupported_persistence");
                var current = () =>
                    operationCurrent() &&
                    ports.runtime() === runtime &&
                    ports.now() < transport.deadlineAt &&
                    admitted.current();
                var snapshot = await wait(
                    ports.adapter.snapshot(params.scope, current)
                );
                if (!current()) fail("runtime_changed");
                if (
                    !snapshot.bytes ||
                    snapshot.bytes.length < 1 ||
                    snapshot.bytes.length > DOCUMENT_LIMIT
                )
                    fail("limits_exceeded");
                try {
                    ports.codec.validate(snapshot.bytes, params.scope);
                } catch (_) {
                    fail("codec_error");
                }
                if (
                    snapshot.revision !== admitted.revision ||
                    snapshot.binding_revision !== admitted.binding_revision
                )
                    fail("revision_conflict");
                var hash = await digest(snapshot.bytes);
                if (!current()) fail("runtime_changed");
                return response(
                    bounded(
                        {
                            binding_revision: snapshot.binding_revision,
                            document_base64: ports.base64Encode(snapshot.bytes),
                            document_sha256: hash,
                            revision: snapshot.revision,
                            scope: params.scope,
                            size_bytes: snapshot.bytes.length,
                        },
                        2097152 - 1024
                    )
                );
            }
            if (op === "begin") {
                if (
                    !exact(
                        params,
                        common.concat([
                            "operation_id",
                            "scope",
                            "expected_revision",
                            "binding_revision",
                            "document_sha256",
                            "size_bytes",
                            "chunk_count",
                            "persistence",
                        ])
                    ) ||
                    !UUID.test(params.operation_id) ||
                    !scopeValid(params.scope) ||
                    !text(params.expected_revision) ||
                    !text(params.binding_revision) ||
                    !SHA.test(params.document_sha256) ||
                    !integer(params.size_bytes, 1, DOCUMENT_LIMIT) ||
                    !integer(params.chunk_count, 1, 256) ||
                    params.chunk_count > params.size_bytes ||
                    params.size_bytes > params.chunk_count * CHUNK_LIMIT
                )
                    fail("invalid_request");
                if (params.persistence !== "persistent")
                    fail("unsupported_persistence");
                var fingerprint = canonical(params);
                if (stage) {
                    if (stage.args.operation_id !== params.operation_id)
                        fail("busy");
                    if (stage.fingerprint !== fingerprint)
                        fail("operation_conflict");
                    check(stage, runtime);
                    touch(stage);
                    return response(
                        Object.assign(ack(stage), {
                            absolute_expires_at: new Date(
                                stage.absolute
                            ).toISOString(),
                            idle_expires_at: new Date(stage.idle).toISOString(),
                            operation_id: params.operation_id,
                        })
                    );
                }
                if (terminal && terminal.operation_id === params.operation_id)
                    fail("reconciliation_required");
                var id = ports.uuid();
                if (
                    !UUID.test(id) ||
                    (terminal && terminal.transaction_id === id)
                )
                    fail("storage_unavailable");
                var inspectContext: FavoritesTransferInspectContext = {
                    document_sha256: params.document_sha256,
                    operation_id: params.operation_id,
                    runtime: runtime,
                    transaction_id: id,
                };
                var admission = await wait(
                    ports.adapter.inspect(
                        params.scope,
                        params.operation_id,
                        inspectContext
                    )
                );
                if (ports.runtime() !== runtime || !admissionValid(admission))
                    fail("policy_denied");
                if (admission.persistence !== "persistent")
                    fail("unsupported_persistence");
                if (admission.operationFresh !== true)
                    fail("reconciliation_required");
                if (admission.budgetAccepted !== true) fail("limits_exceeded");
                if (admission.revision !== params.expected_revision)
                    fail("revision_conflict");
                if (admission.binding_revision !== params.binding_revision)
                    fail("binding_changed");
                if (!operationCurrent() || ports.now() >= transport.deadlineAt)
                    fail("expired");
                stage = {
                    absolute: Math.min(
                        transport.deadlineAt,
                        ports.now() + 600000
                    ),
                    admission: admission,
                    args: bounded(params),
                    bytes: new Uint8Array(params.size_bytes),
                    chunks: [],
                    fingerprint: fingerprint,
                    id: id,
                    idle: Math.min(transport.deadlineAt, ports.now() + 120000),
                    inspectContext: inspectContext,
                    next: 0,
                    plan: null,
                    received: 0,
                    runtime: runtime,
                    timer: null,
                    writesStarted: false,
                };
                arm(stage);
                return response(
                    Object.assign(ack(stage), {
                        absolute_expires_at: new Date(
                            stage.absolute
                        ).toISOString(),
                        idle_expires_at: new Date(stage.idle).toISOString(),
                        operation_id: params.operation_id,
                    })
                );
            }
            if (op === "status") {
                if (
                    !exact(params, common.concat(["operation_id"])) ||
                    !UUID.test(params.operation_id)
                )
                    fail("invalid_request");
                if (stage && stage.args.operation_id === params.operation_id) {
                    check(stage, runtime);
                    touch(stage);
                    var progress: any = Object.assign(ack(stage), {
                        absolute_expires_at: new Date(
                            stage.absolute
                        ).toISOString(),
                        idle_expires_at: new Date(stage.idle).toISOString(),
                        operation_id: params.operation_id,
                        persistence: "persistent",
                        state: stage.plan?.ready ? "ready" : "receiving",
                    });
                    if (stage.plan?.ready)
                        Object.assign(progress, {
                            base_revision: stage.plan.base_revision,
                            binding_revision: stage.plan.binding_revision,
                            plan_digest: stage.planDigest,
                            ready: stage.plan.ready,
                        });
                    return response(progress);
                }
                if (
                    terminal &&
                    terminal.operation_id === params.operation_id &&
                    terminal.state !== "committed"
                )
                    return response(terminal);
                var evidence = await wait(
                    ports.adapter.status(
                        params.operation_id,
                        () =>
                            operationCurrent() &&
                            ports.runtime() === runtime &&
                            ports.now() < transport.deadlineAt
                    )
                );
                if (
                    !operationCurrent() ||
                    ports.runtime() !== runtime ||
                    ports.now() >= transport.deadlineAt
                )
                    fail("runtime_changed");
                var observed: any = evidence
                    ? outcome(evidence)
                    : {
                          outcome: "unknown",
                          per_store: [],
                          persistence: "persistent",
                      };
                if (
                    observed.receipt &&
                    observed.receipt.operation_id !== params.operation_id
                )
                    observed = {
                        outcome: "unknown",
                        per_store: observed.per_store,
                        persistence: "persistent",
                    };
                return response(
                    Object.assign(
                        {
                            operation_id: params.operation_id,
                            state: "committed",
                        },
                        publicOutcome(observed)
                    )
                );
            }
            if (["append", "preview", "commit", "abort"].indexOf(op) < 0)
                fail("invalid_request");
            if (!UUID.test(params.transaction_id)) fail("invalid_request");
            if (!stage || stage.id !== params.transaction_id) {
                if (
                    op === "abort" &&
                    exact(params, common.concat(["transaction_id"])) &&
                    terminal &&
                    terminal.transaction_id === params.transaction_id
                )
                    return response(abortResult());
                fail("transaction_not_found");
            }
            var value = stage;
            check(value, runtime);
            if (op === "abort") {
                if (!exact(params, common.concat(["transaction_id"])))
                    fail("invalid_request");
                finish("aborted");
                return response(abortResult());
            }
            if (op === "append") {
                if (
                    !exact(
                        params,
                        common.concat([
                            "transaction_id",
                            "seq",
                            "offset",
                            "chunk_sha256",
                            "data_base64",
                        ])
                    ) ||
                    !integer(params.seq, 0, 255) ||
                    !integer(params.offset, 0, DOCUMENT_LIMIT) ||
                    !SHA.test(params.chunk_sha256) ||
                    typeof params.data_base64 !== "string" ||
                    params.data_base64.length > 10924
                )
                    fail("invalid_request");
                var bytes = ports.base64Decode(params.data_base64);
                if (
                    !bytes.length ||
                    bytes.length > CHUNK_LIMIT ||
                    ports.base64Encode(bytes) !== params.data_base64
                )
                    fail("invalid_request");
                var chunkHash = await digest(bytes);
                check(value, runtime);
                if (chunkHash !== params.chunk_sha256) fail("hash_mismatch");
                if (params.seq < value.next) {
                    var prior = value.chunks[params.seq];
                    if (
                        !prior ||
                        prior.offset !== params.offset ||
                        prior.hash !== chunkHash ||
                        prior.size !== bytes.length
                    )
                        fail("chunk_conflict");
                    touch(value);
                    return response(prior.ack);
                }
                if (
                    value.plan ||
                    params.seq !== value.next ||
                    params.offset !== value.received
                )
                    fail("out_of_order");
                if (
                    value.next >= value.args.chunk_count ||
                    value.received + bytes.length > value.args.size_bytes
                )
                    fail("limits_exceeded");
                var acknowledged = {
                    next_seq: value.next + 1,
                    received_bytes: value.received + bytes.length,
                    transaction_id: value.id,
                };
                var chunkRecord = {
                    ack: acknowledged,
                    hash: chunkHash,
                    offset: params.offset,
                    size: bytes.length,
                };
                if (
                    ports.utf8(canonical(value.chunks.concat([chunkRecord])))
                        .length >
                    METADATA_LIMIT / 2
                )
                    fail("limits_exceeded");
                value.bytes.set(bytes, value.received);
                value.received += bytes.length;
                value.next++;
                value.chunks.push(chunkRecord);
                touch(value);
                return response(acknowledged);
            }
            if (op === "preview") {
                if (!exact(params, common.concat(["transaction_id"])))
                    fail("invalid_request");
                if (
                    value.received !== value.args.size_bytes ||
                    value.next !== value.args.chunk_count
                )
                    fail("incomplete");
                if ((await digest(value.bytes)) !== value.args.document_sha256)
                    fail("hash_mismatch");
                check(value, runtime);
                try {
                    ports.codec.validate(value.bytes, value.args.scope);
                } catch (_) {
                    fail("codec_error");
                }
                var plan = await wait(
                    ports.adapter.preview(
                        value.bytes,
                        value.args.scope,
                        value.admission,
                        () => active(value, runtime)
                    ),
                    Math.min(value.idle, value.absolute, transport.deadlineAt)
                );
                check(value, runtime);
                if (
                    !plan ||
                    plan.persistence !== "persistent" ||
                    plan.base_revision !== value.args.expected_revision ||
                    plan.binding_revision !== value.args.binding_revision ||
                    !Array.isArray(plan.stores) ||
                    plan.stores.length < 1 ||
                    plan.stores.length > 64 ||
                    !Array.isArray(plan.unresolved) ||
                    typeof plan.ready !== "boolean"
                )
                    fail("not_ready");
                plan = bounded(plan, METADATA_LIMIT / 2);
                if (
                    !countsValid(plan.counts) ||
                    !diagnosticsValid(plan.unresolved, plan.counts)
                )
                    fail("not_ready");
                if (
                    plan.stores.some(
                        (row: any, index: number) =>
                            !exact(row, ["id", "expected_revision"]) ||
                            !text(row.id) ||
                            !text(row.expected_revision) ||
                            plan.stores.some(
                                (other: any, at: number) =>
                                    at < index && other.id === row.id
                            )
                    )
                )
                    fail("not_ready");
                var planDigest = await digest(
                    ports.utf8(
                        canonical({
                            base_revision: plan.base_revision,
                            binding_revision: plan.binding_revision,
                            coverage: plan.coverage,
                            document_sha256: value.args.document_sha256,
                            scope: value.args.scope,
                            stores: plan.stores,
                            writePlan: plan.writePlan,
                        })
                    )
                );
                check(value, runtime);
                value.plan = plan;
                value.planDigest = planDigest;
                touch(value);
                return response(
                    Object.assign(planPublic(plan), {
                        plan_digest: planDigest,
                        transaction_id: value.id,
                    })
                );
            }
            if (
                !exact(
                    params,
                    common.concat([
                        "transaction_id",
                        "operation_id",
                        "expected_revision",
                        "plan_digest",
                    ])
                ) ||
                params.operation_id !== value.args.operation_id ||
                params.expected_revision !== value.args.expected_revision ||
                !SHA.test(params.plan_digest)
            )
                fail("invalid_request");
            if (value.writesStarted) fail("reconciliation_required");
            if (
                !value.plan ||
                !value.plan.ready ||
                value.planDigest !== params.plan_digest
            )
                fail("not_ready");
            var latest = await wait(
                ports.adapter.inspect(
                    value.args.scope,
                    value.args.operation_id,
                    value.inspectContext
                ),
                Math.min(value.idle, value.absolute, transport.deadlineAt)
            );
            check(value, runtime);
            if (!admissionValid(latest)) fail("policy_denied");
            if (latest.revision !== value.args.expected_revision)
                fail("revision_conflict");
            if (latest.binding_revision !== value.args.binding_revision)
                fail("binding_changed");
            if (latest.persistence !== "persistent")
                fail("unsupported_persistence");
            value.writesStarted = true;
            var applied: any;
            try {
                var work = { pending: true, value: value };
                inflight = work;
                var pendingApply = Promise.resolve().then(function () {
                    return ports.adapter.apply(
                        value.plan,
                        {
                            bytes: value.bytes,
                            counts: value.plan.counts,
                            document_sha256: value.args.document_sha256,
                            operation_id: value.args.operation_id,
                            plan_digest: value.planDigest,
                            scope: value.args.scope,
                            transaction_id: value.id,
                        },
                        () => active(value, runtime) && latest.current()
                    );
                });
                var settled = function (): void {
                    work.pending = false;
                    if (inflight === work) inflight = null;
                    if (stage !== value) clearBytes(value);
                };
                pendingApply.then(settled, settled);
                applied = outcome(
                    await wait(
                        pendingApply,
                        Math.min(
                            value.idle,
                            value.absolute,
                            transport.deadlineAt
                        )
                    ),
                    value
                );
                if (!active(value, runtime) || !latest.current())
                    applied = {
                        outcome: "unknown",
                        per_store: applied.per_store,
                        persistence: "persistent",
                    };
            } catch (_) {
                applied = {
                    outcome: "unknown",
                    per_store: [],
                    persistence: "persistent",
                };
            }
            var publicApplied = publicOutcome(applied);
            if (applied.outcome === "verified")
                Object.assign(publicApplied, {
                    counts: value.plan.counts,
                    document_sha256: value.args.document_sha256,
                    new_revision: applied.receipt.new_revision,
                    plan_digest: value.planDigest,
                });
            var result = response(
                Object.assign(
                    {
                        operation_id: value.args.operation_id,
                        scope: value.args.scope,
                        transaction_id: value.id,
                    },
                    publicApplied
                )
            );
            if (stage === value) finish("committed", publicApplied);
            return result;
        } catch (error) {
            var code =
                error instanceof Error ? error.message : "storage_unavailable";
            return response({
                error:
                    FAVORITES_TRANSFER_ERRORS.indexOf(code) >= 0
                        ? code
                        : "storage_unavailable",
            });
        } finally {
            if (!busy) executing = false;
        }
    }
    return {
        /** Private lifecycle hooks; the seven public operation shapes are unchanged. */
        busy: function () {
            expire();
            return !!(executing || stage || (inflight && inflight.pending));
        },
        dispose: function () {
            disposed = true;
            waits.slice().forEach((waiter) => waiter.cancel());
            if (stage)
                finish(stage.writesStarted ? "committed" : "expired", {
                    outcome: stage.writesStarted ? "unknown" : "not_applied",
                    per_store: [],
                    persistence: "persistent",
                });
            // An apply still settling retains its bytes and write fence until settled().
        },
        execute: run,
    };
}
