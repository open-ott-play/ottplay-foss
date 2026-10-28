import { utf8Encode } from "../commands/favorites-document-json";
import {
    createFavoritesRecoveryDispatcher,
    FAVORITES_RECOVERY_ERRORS,
    validFavoritesRecoveryResponse,
} from "../commands/favorites-recovery";
import {
    createFavoritesTransfer,
    FAVORITES_TRANSFER_ERRORS,
} from "../commands/favorites-transfer";
import { createFavoritesCurrentPlexHost } from "../settings/favorites-current-plex-host";

/** Fixed optional asset. All authority comes from the authenticated dispatcher and current host. */
export function createFavoritesTransferRuntime(
    w: any,
    options: {
        runtime(): string;
        storage?: {
            compress(value: string): string;
            decompress(value: string): string | null;
            recoveryRequired(): boolean;
            captureFavoritesPhysicalStorage?: () => any;
            captureFavoritesPhysicalRead?: () => any;
        };
    }
) {
    var disposed = false,
        running = false,
        grant: any = null,
        grantTimer: any = null;
    var waits: { cancel(): void }[] = [];
    var uncertainOperation: any = null;
    var crypto = w.crypto,
        subtle = crypto && crypto.subtle;
    var instanceRuntime = options.runtime();
    var now = () => Date.now();
    // Wire snapshots include base64 expansion; document codecs keep their own 1-MiB default.
    var utf8 = (text: string) => utf8Encode(text, 2097152);
    function fail(code: string): never {
        throw new Error(code);
    }
    function exact(value: any, fields: string[]): boolean {
        return (
            !!value &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            Object.keys(value).sort().join(",") ===
                fields.slice().sort().join(",")
        );
    }
    function same(a: any, b: any): boolean {
        if (a === b) return true;
        if (!a || !b || typeof a !== "object" || typeof b !== "object")
            return false;
        var keys = Object.keys(a).sort();
        return (
            keys.join(",") === Object.keys(b).sort().join(",") &&
            keys.every((k) => same(a[k], b[k]))
        );
    }
    var uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/;
    function scope(value: any): boolean {
        return (
            exact(value, ["profileBindingId", "sourceBindingId", "provider"]) &&
            value.provider === "plex" &&
            uuidPattern.test(value.profileBindingId) &&
            uuidPattern.test(value.sourceBindingId) &&
            value.profileBindingId !== value.sourceBindingId
        );
    }
    function revision(value: any): boolean {
        return (
            typeof value === "string" &&
            !!value &&
            !/[\u0000-\u001f\u007f]/.test(value) &&
            utf8(value).length <= 256
        );
    }
    function integer(value: any, max: number): boolean {
        return (
            typeof value === "number" &&
            value >= 1 &&
            value <= max &&
            Math.floor(value) === value
        );
    }
    function current(): boolean {
        return (
            !disposed &&
            options.runtime() === instanceRuntime &&
            w.crypto === crypto &&
            !!crypto &&
            crypto.subtle === subtle
        );
    }
    function uuid(): string {
        if (
            !current() ||
            !crypto ||
            typeof crypto.getRandomValues !== "function"
        )
            fail("unsupported_persistence");
        var bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 15) | 64;
        bytes[8] = (bytes[8] & 63) | 128;
        var hex = Array.prototype.map
            .call(bytes, (b: number) => (b + 256).toString(16).slice(1))
            .join("");
        return (
            hex.slice(0, 8) +
            "-" +
            hex.slice(8, 12) +
            "-" +
            hex.slice(12, 16) +
            "-" +
            hex.slice(16, 20) +
            "-" +
            hex.slice(20)
        );
    }
    async function sha256(value: string | Uint8Array): Promise<string> {
        if (!current() || !subtle || typeof subtle.digest !== "function")
            fail("unsupported_persistence");
        var bytes = typeof value === "string" ? utf8(value) : value;
        var hashed = new Uint8Array(await subtle.digest("SHA-256", bytes));
        if (!current()) fail("runtime_changed");
        return Array.prototype.map
            .call(hashed, (b: number) => (b + 256).toString(16).slice(1))
            .join("");
    }
    function encode(bytes: Uint8Array): string {
        var chunks: string[] = [];
        for (var at = 0; at < bytes.length; at += 8192)
            chunks.push(
                String.fromCharCode.apply(
                    null,
                    Array.prototype.slice.call(bytes.subarray(at, at + 8192))
                )
            );
        return w.btoa(chunks.join(""));
    }
    function decode(value: string): Uint8Array {
        if (
            typeof value !== "string" ||
            value.length > 10924 ||
            !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
                value
            )
        )
            fail("invalid_request");
        var text = w.atob(value),
            bytes = new Uint8Array(text.length);
        for (var at = 0; at < text.length; at++)
            bytes[at] = text.charCodeAt(at);
        if (encode(bytes) !== value) fail("invalid_request");
        return bytes;
    }
    var host = createFavoritesCurrentPlexHost(w, {
        now,
        sha256,
        storage: options.storage,
        utf8,
        uuid,
    });
    var recovery = createFavoritesRecoveryDispatcher({
        current,
        host,
        now,
        runtime: () => instanceRuntime,
        sha256,
        utf8,
    });
    async function newAdmission(params: any, transport: any): Promise<void> {
        if (
            uncertainOperation &&
            (await bounded(
                recovery.acknowledged(
                    uncertainOperation,
                    () => authorized(params, transport),
                    transport.deadlineAt
                ),
                transport.deadlineAt
            ))
        ) {
            uncertainOperation = null;
            releaseGrant();
        }
        if (uncertainOperation) fail("reconciliation_required");
        await bounded(host.validateNewAdmission(), transport.deadlineAt);
        if (!authorized(params, transport)) fail("expired");
    }
    function releaseGrant(): void {
        if (grantTimer !== null) w.clearTimeout(grantTimer);
        grantTimer = null;
        grant = null;
    }
    function cleanGrant(): void {
        if (
            grant &&
            !grant.consumed &&
            (!current() ||
                !grant.context.current() ||
                now() >= grant.expires ||
                now() >= grant.deadline)
        )
            releaseGrant();
    }
    function admission(expected: any, operationId: string, context: any) {
        cleanGrant();
        if (
            !grant ||
            !current() ||
            !grant.context.current() ||
            !grant.base.current() ||
            now() >= grant.deadline ||
            operationId !== grant.id ||
            !same(expected, grant.args.scope) ||
            !context ||
            context.runtime !== instanceRuntime ||
            context.operation_id !== operationId ||
            context.document_sha256 !== grant.args.document_sha256
        )
            fail("reconciliation_required");
        if (grant.consumed) {
            if (!same(grant.consumed, context)) fail("reconciliation_required");
        } else {
            if (now() >= grant.expires) fail("expired");
            grant.consumed = JSON.parse(JSON.stringify(context));
            if (grantTimer !== null) w.clearTimeout(grantTimer);
            grantTimer = null;
        }
        return { budgetAccepted: true, operationFresh: true };
    }
    var adapter = host.createAdapter(admission);
    var engine = createFavoritesTransfer({
        adapter,
        base64Decode: decode,
        base64Encode: encode,
        clearTimer: (timer) => w.clearTimeout(timer),
        codec: host.document,
        now,
        runtime: () => (current() ? instanceRuntime : "disposed-runtime"),
        setTimer: (callback, milliseconds) =>
            w.setTimeout(callback, milliseconds),
        sha256,
        utf8,
        uuid,
    });
    function bounded<T>(work: Promise<T>, deadline: number): Promise<T> {
        return new Promise((resolve, reject) => {
            var settled = false;
            var timer: any = null;
            function finish(): boolean {
                if (settled) return false;
                settled = true;
                if (timer !== null) w.clearTimeout(timer);
                var at = waits.indexOf(waiter);
                if (at >= 0) waits.splice(at, 1);
                return true;
            }
            var waiter = {
                cancel: () => {
                    if (finish()) reject(new Error("expired"));
                },
            };
            waits.push(waiter);
            if (disposed) waiter.cancel();
            else
                timer = w.setTimeout(
                    waiter.cancel,
                    Math.max(0, deadline - now())
                );
            Promise.resolve(work).then(
                (value) => {
                    if (finish()) resolve(value);
                },
                (error) => {
                    if (finish()) reject(error);
                }
            );
        });
    }
    function response(op: string, value: any): any {
        return Object.assign({}, value, {
            op,
            runtime: instanceRuntime,
            version: 1,
        });
    }
    function authorized(params: any, transport: any): boolean {
        return (
            current() &&
            /^[a-z0-9-]{1,64}(?![\s\S])/.test(instanceRuntime) &&
            params &&
            params.runtime === instanceRuntime &&
            transport &&
            transport.runtime === instanceRuntime &&
            integer(transport.deadlineAt, 9007199254740991) &&
            now() < transport.deadlineAt &&
            (!transport.current || transport.current()) &&
            transport.envelope &&
            same(transport.envelope.params, params) &&
            utf8(JSON.stringify(transport.envelope)).length <= 16384
        );
    }
    async function execute(params: any, transport: any): Promise<any> {
        var op =
            params && typeof params.op === "string" && params.op.length <= 32
                ? params.op
                : "invalid";
        var busy = running;
        if (!busy) running = true;
        try {
            if (!authorized(params, transport)) fail("expired");
            if (op === "recovery")
                return await bounded(
                    recovery.execute(
                        params,
                        () => authorized(params, transport),
                        transport.deadlineAt
                    ),
                    transport.deadlineAt
                );
            if (busy) fail("busy");
            cleanGrant();
            if (grant && grant.consumed && !engine.busy()) releaseGrant();
            // Reconciliation must survive a partially written store or stale
            // cache. The read-only status adapter validates its own authority.
            if (op !== "status" && !host.qualified())
                fail("unsupported_persistence");
            if (op === "bindingcatalog") {
                if (!exact(params, ["op", "runtime"])) fail("invalid_request");
                return response(op, host.catalog());
            }
            if (op === "bind") {
                if (
                    !exact(params, [
                        "op",
                        "runtime",
                        "scope",
                        "target_id",
                        "expected_binding_revision",
                        "codecVersion",
                    ]) ||
                    !scope(params.scope) ||
                    params.codecVersion !== 1
                )
                    fail("invalid_request");
                var catalog = host.catalog();
                if (
                    catalog.binding_revision !==
                    params.expected_binding_revision
                )
                    fail("binding_changed");
                if (
                    !catalog.bindings.some(
                        (row: any) =>
                            row.target_id === params.target_id &&
                            same(row.scope, params.scope)
                    )
                )
                    fail("policy_denied");
                return response(op, {
                    binding_revision: catalog.binding_revision,
                    paired: true,
                    scope: params.scope,
                    target_id: params.target_id,
                });
            }
            if (op === "provision") {
                if (grant || engine.busy()) fail("busy");
                await newAdmission(params, transport);
                return response(
                    op,
                    await bounded(
                        host.provisionExclusive(params, () =>
                            authorized(params, transport)
                        ),
                        transport.deadlineAt
                    )
                );
            }
            if (op === "prepare") {
                if (
                    !exact(params, [
                        "op",
                        "runtime",
                        "scope",
                        "expected_revision",
                        "binding_revision",
                        "document_sha256",
                        "size_bytes",
                        "budget_ms",
                    ]) ||
                    !scope(params.scope) ||
                    !revision(params.expected_revision) ||
                    !revision(params.binding_revision) ||
                    typeof params.document_sha256 !== "string" ||
                    !/^[a-f0-9]{64}(?![\s\S])/.test(params.document_sha256) ||
                    !integer(params.size_bytes, 1048576) ||
                    !integer(params.budget_ms, 300000)
                )
                    fail("invalid_request");
                if (grant || engine.busy()) fail("busy");
                await newAdmission(params, transport);
                var start = now(),
                    deadline = start + params.budget_ms,
                    context = host.captureContext();
                var base = await bounded(
                    adapter.inspect(params.scope),
                    Math.min(deadline, transport.deadlineAt)
                );
                if (
                    !authorized(params, transport) ||
                    !context.current() ||
                    !base.current() ||
                    now() >= deadline
                )
                    fail("expired");
                if (base.revision !== params.expected_revision)
                    fail("revision_conflict");
                if (base.binding_revision !== params.binding_revision)
                    fail("binding_changed");
                var ttl = Math.min(10000, deadline - now()),
                    id = uuid();
                if (!uuidPattern.test(id)) fail("storage_unavailable");
                grant = {
                    args: JSON.parse(JSON.stringify(params)),
                    base,
                    consumed: null,
                    context,
                    deadline,
                    expires: now() + ttl,
                    id,
                };
                grantTimer = w.setTimeout(cleanGrant, ttl);
                return response(
                    op,
                    Object.assign({}, params, {
                        admission_ttl_ms: ttl,
                        operation_id: id,
                    })
                );
            }
            if (
                [
                    "snapshot",
                    "begin",
                    "append",
                    "preview",
                    "commit",
                    "status",
                    "abort",
                ].indexOf(op) < 0
            )
                fail("invalid_request");
            var stageGrant = grant,
                deadlineAt = transport.deadlineAt;
            if (op === "begin") {
                if (!stageGrant) fail("reconciliation_required");
                if (
                    params.operation_id !== stageGrant.id ||
                    !same(params.scope, stageGrant.args.scope) ||
                    params.expected_revision !==
                        stageGrant.args.expected_revision ||
                    params.binding_revision !==
                        stageGrant.args.binding_revision ||
                    params.document_sha256 !==
                        stageGrant.args.document_sha256 ||
                    params.size_bytes !== stageGrant.args.size_bytes
                )
                    fail("operation_conflict");
            }
            var related =
                stageGrant &&
                (op === "begin" ||
                    (stageGrant.consumed &&
                        params.transaction_id ===
                            stageGrant.consumed.transaction_id));
            if (related) deadlineAt = stageGrant.deadline;
            var result = await engine.execute(params, {
                current: () =>
                    current() &&
                    (!transport.current || transport.current()) &&
                    (!related ||
                        (stageGrant.context.current() &&
                            now() < stageGrant.deadline)),
                deadlineAt,
                envelope: transport.envelope,
                runtime: transport.runtime,
            });
            if (
                op === "commit" &&
                (result.outcome === "unknown" || result.outcome === "partial")
            )
                uncertainOperation = {
                    operationId: params.operation_id,
                    payloadHash: stageGrant && stageGrant.args.document_sha256,
                    scope: stageGrant && stageGrant.args.scope,
                };
            if (
                op === "status" &&
                uncertainOperation &&
                params.operation_id === uncertainOperation.operationId &&
                (result.outcome === "verified" ||
                    result.outcome === "not_applied")
            )
                uncertainOperation = null;
            if (stageGrant && stageGrant.consumed && !engine.busy())
                releaseGrant();
            return result;
        } catch (error) {
            var code = error && ((error as any).code || (error as any).message);
            if (
                (op === "recovery"
                    ? FAVORITES_RECOVERY_ERRORS
                    : FAVORITES_TRANSFER_ERRORS
                ).indexOf(code) < 0 &&
                !(op === "provision" && code === "outcome_unknown")
            )
                code = "storage_unavailable";
            return response(op, { error: code });
        } finally {
            if (!busy) running = false;
        }
    }
    return {
        capability: async function () {
            if (
                !current() ||
                !crypto ||
                typeof crypto.getRandomValues !== "function" ||
                !subtle ||
                typeof subtle.digest !== "function" ||
                typeof w.atob !== "function" ||
                typeof w.btoa !== "function" ||
                !host.qualified()
            )
                return null;
            try {
                if (
                    (await bounded(
                        sha256(new Uint8Array(0)),
                        now() + 15000
                    )) !==
                    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
                )
                    return null;
                return current() &&
                    host.qualified() &&
                    (await recovery.qualified(current, now() + 15000))
                    ? JSON.parse(JSON.stringify(CAPABILITY))
                    : null;
            } catch (_) {
                return null;
            }
        },
        dispose: function () {
            disposed = true;
            releaseGrant();
            waits.slice().forEach((waiter) => waiter.cancel());
            engine.dispose();
        },
        execute,
        recoveryCapability: async function () {
            try {
                return current() &&
                    (await sha256("")) ===
                        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
                    ? { version: 1 }
                    : null;
            } catch (_) {
                return null;
            }
        },
        validateRecoveryResponse: validFavoritesRecoveryResponse,
    };
}
const CAPABILITY = {
    admission: {
        admission_ttl_ms: 10000,
        max_budget_ms: 300000,
        max_unconsumed_grants: 1,
        op: "prepare",
        operation_id: "player-generated-uuidv4",
    },
    codecs: [
        {
            codecVersion: 1,
            coverage: ["channelLists", "mediaFavorites"],
            locatorKinds: ["plex-media"],
            provider: "plex",
            targetScope: "current-verified-source",
        },
    ],
    limits: {
        absolute_ttl_seconds: 600,
        idle_ttl_seconds: 120,
        max_active_stages: 1,
        max_channel_lists: 256,
        max_chunk_bytes: 8192,
        max_chunks: 256,
        max_document_bytes: 1048576,
        max_entries_per_list: 10000,
        max_envelope_bytes: 16384,
        max_json_depth: 20,
        max_json_nodes: 32768,
        max_media_favorites: 1000,
        max_metadata_bytes: 131072,
        max_plan_bytes: 65536,
        max_receipt_entries: 32,
        max_receipt_ledger_bytes: 65536,
        max_retained_admissions_per_adapter_instance: 16,
        max_snapshot_response_bytes: 2097152,
        max_unstarted_drafts: 1,
    },
    persistence: ["persistent"],
    receipt_retention_origin: "logical-reservation-plan",
    receipt_retention_policy: "up-to-count-and-byte-bounded",
    receipt_retention_seconds: 86400,
    version: 1,
};
(window as any).__ottFavoritesTransferRuntime = {
    create: createFavoritesTransferRuntime,
};
