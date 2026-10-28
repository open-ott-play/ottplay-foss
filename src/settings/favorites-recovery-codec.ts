/** Private ledger v2 codec. Pure: no storage, grants, initialization or clocks. */
const ACK_HEADROOM_BYTES = 1024;
const MAX_LEDGER_BYTES = 65536;
function checks() {
    const retention = 86400000;
    function protectedRow(row: any): boolean {
        return ["pending", "partial", "unknown"].indexOf(row.state) >= 0;
    }
    function validFence(value: any): boolean {
        return (
            exact(value, [
                "version",
                "backendProof",
                "guardImplementationVersion",
            ]) &&
            value.version === 2 &&
            hash(value.backendProof) &&
            value.guardImplementationVersion === 1
        );
    }
    function validAudit(value: any): boolean {
        return (
            exact(value, [
                "acknowledgement_id",
                "runtime",
                "ledger_revision_before",
                "backend_proof",
                "reason",
            ]) &&
            hash(value.acknowledgement_id) &&
            runtime(value.runtime) &&
            hash(value.ledger_revision_before) &&
            hash(value.backend_proof) &&
            value.reason === "accept-unknown-no-replay"
        );
    }
    function runtime(value: any): boolean {
        return (
            typeof value === "string" &&
            /^[a-z0-9-]{1,64}(?![\s\S])/.test(value)
        );
    }
    function exact(
        value: any,
        required: string[],
        optional: string[] = []
    ): boolean {
        if (!value || typeof value !== "object" || Array.isArray(value))
            return false;
        var keys = Object.getOwnPropertyNames(value);
        return (
            required.every(function (key) {
                return keys.indexOf(key) >= 0;
            }) &&
            keys.every(function (key) {
                var d = Object.getOwnPropertyDescriptor(value, key);
                return (
                    !!d &&
                    d.enumerable &&
                    "value" in d &&
                    (required.indexOf(key) >= 0 || optional.indexOf(key) >= 0)
                );
            })
        );
    }
    function integer(value: any): boolean {
        return (
            typeof value === "number" &&
            isFinite(value) &&
            value >= 0 &&
            value <= 9007199254740991 &&
            Math.floor(value) === value
        );
    }
    function uuid(value: any): boolean {
        return (
            typeof value === "string" &&
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/.test(
                value
            )
        );
    }
    function hash(value: any): boolean {
        return (
            typeof value === "string" && /^[0-9a-f]{64}(?![\s\S])/.test(value)
        );
    }
    function scope(value: any): boolean {
        return (
            exact(value, ["profileBindingId", "sourceBindingId", "provider"]) &&
            uuid(value.profileBindingId) &&
            uuid(value.sourceBindingId) &&
            typeof value.provider === "string" &&
            /^[a-z0-9][a-z0-9_.\/-]{0,63}(?![\s\S])/.test(value.provider)
        );
    }
    function refs(value: any): boolean {
        return (
            exact(value, ["stageId", "runtimeId"]) &&
            [value.stageId, value.runtimeId].every(function (v) {
                return (
                    typeof v === "string" &&
                    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}(?![\s\S])/.test(v)
                );
            })
        );
    }
    function meta(value: any): boolean {
        return (
            exact(value, ["code", "appliedStores", "totalStores"]) &&
            [
                "none",
                "cancelled",
                "source_changed",
                "storage_unavailable",
                "conflict",
                "interrupted",
                "target_failed",
            ].indexOf(value.code) >= 0 &&
            integer(value.appliedStores) &&
            integer(value.totalStores) &&
            value.totalStores <= 64 &&
            value.appliedStores <= value.totalStores
        );
    }
    function counts(value: any): boolean {
        return (
            exact(value, [
                "channelLists",
                "channelMemberships",
                "mediaFavorites",
                "unresolved",
            ]) &&
            Object.keys(value).every(function (key) {
                return integer(value[key]) && value[key] <= 1000000;
            })
        );
    }
    function receipt(value: any, entry: any): boolean {
        return (
            exact(value, [
                "operation_id",
                "scope",
                "document_sha256",
                "plan_digest",
                "new_revision",
                "counts",
                "outcome",
                "persistence",
            ]) &&
            value.operation_id === entry.operationId &&
            JSON.stringify(value.scope) === JSON.stringify(entry.scope) &&
            value.document_sha256 === entry.payloadHash &&
            hash(value.plan_digest) &&
            typeof value.new_revision === "string" &&
            /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}(?![\s\S])/.test(
                value.new_revision
            ) &&
            counts(value.counts) &&
            value.outcome === entry.state &&
            value.persistence === "persistent"
        );
    }
    function row(value: any): boolean {
        return (
            exact(
                value,
                [
                    "operationId",
                    "payloadHash",
                    "scope",
                    "refs",
                    "createdAt",
                    "expiresAt",
                    "state",
                ],
                ["meta", "receipt", "fence", "recovery_ack"]
            ) &&
            (!Object.prototype.hasOwnProperty.call(value, "fence") ||
                validFence(value.fence)) &&
            (!Object.prototype.hasOwnProperty.call(value, "recovery_ack") ||
                (validFence(value.fence) &&
                    protectedRow(value) &&
                    validAudit(value.recovery_ack))) &&
            uuid(value.operationId) &&
            hash(value.payloadHash) &&
            scope(value.scope) &&
            refs(value.refs) &&
            integer(value.createdAt) &&
            integer(value.expiresAt) &&
            value.expiresAt === value.createdAt + retention &&
            [
                "pending",
                "verified",
                "not_applied",
                "partial",
                "unknown",
            ].indexOf(value.state) >= 0 &&
            (value.state === "pending"
                ? !Object.prototype.hasOwnProperty.call(value, "meta") &&
                  !Object.prototype.hasOwnProperty.call(value, "receipt")
                : meta(value.meta) && receipt(value.receipt, value)) &&
            (value.state !== "verified" ||
                value.meta.appliedStores === value.meta.totalStores) &&
            (value.state !== "not_applied" || value.meta.appliedStores === 0)
        );
    }
    return {
        counts,
        exact,
        hash,
        integer,
        meta,
        protectedRow,
        refs,
        row,
        runtime,
        scope,
        uuid,
        validAudit,
        validFence,
    };
}
const valid = checks();
export const favoritesReceiptValidators = Object.freeze({
    counts: valid.counts,
    exact: valid.exact,
    hash: valid.hash,
    integer: valid.integer,
    meta: valid.meta,
    refs: valid.refs,
    scope: valid.scope,
    uuid: valid.uuid,
});
function fail(code: string): never {
    const error: any = new Error("Favorites recovery: " + code);
    error.code = code;
    throw error;
}
export function favoritesReceiptUtf8Length(raw: string): number {
    try {
        return encodeURIComponent(raw).replace(/%[0-9A-F]{2}/g, "x").length;
    } catch (_) {
        return Infinity;
    }
}
export function validateFavoritesReceiptRow(row: any): boolean {
    return valid.row(row);
}
export function validateFavoritesReceiptFence(fence: any): boolean {
    return valid.validFence(fence);
}
export function parseFavoritesRecoveryLedger(raw: string | null): any {
    if (raw === null) return { entries: [], version: null };
    if (
        typeof raw !== "string" ||
        favoritesReceiptUtf8Length(raw) > MAX_LEDGER_BYTES
    )
        fail("invalid_ledger");
    let value: any;
    try {
        value = JSON.parse(raw);
    } catch (_) {
        fail("invalid_ledger");
    }
    if (
        !valid.exact(value, ["version", "entries"]) ||
        [1, 2].indexOf(value.version) < 0 ||
        !Array.isArray(value.entries) ||
        value.entries.length > 32 ||
        Object.keys(value.entries).length !== value.entries.length ||
        JSON.stringify(value) !== raw
    )
        fail("invalid_ledger");
    const ids: any = Object.create(null);
    value.entries.forEach(function (row: any) {
        if (
            !valid.row(row) ||
            ids[row.operationId] ||
            (value.version === 1 && (row.fence || row.recovery_ack))
        )
            fail("invalid_ledger");
        ids[row.operationId] = true;
    });
    return value;
}
export function favoritesRecoveryCapacity(raw: string): boolean {
    try {
        const value = parseFavoritesRecoveryLedger(raw);
        const unack = value.entries.filter(function (row: any) {
            return valid.protectedRow(row) && row.fence && !row.recovery_ack;
        }).length;
        return (
            favoritesReceiptUtf8Length(raw) + ACK_HEADROOM_BYTES * unack <=
            MAX_LEDGER_BYTES
        );
    } catch (_) {
        return false;
    }
}
// Fixed field order recursively canonicalizes ALL original data, excluding ONLY audit.
function canonical(value: any): any {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object") {
        const result: any = {};
        Object.keys(value)
            .sort()
            .forEach(function (key: string) {
                result[key] = canonical(value[key]);
            });
        return result;
    }
    return value;
}
export function favoritesReceiptOriginalCanonical(row: any): string {
    if (!valid.row(row)) fail("invalid_ledger");
    const original: any = {};
    Object.keys(row).forEach(function (key: string) {
        if (key !== "recovery_ack") original[key] = row[key];
    });
    return JSON.stringify(canonical(original));
}
interface RecoveryHashPorts {
    sha256(text: string): Promise<string>;
}
export function createFavoritesRecoveryCodec(ports: RecoveryHashPorts) {
    async function digest(text: string): Promise<string> {
        if (!isFinite(favoritesReceiptUtf8Length(text))) fail("invalid_ledger");
        const result = await ports.sha256(text);
        if (!valid.hash(result)) fail("hash_unavailable");
        return result;
    }
    function scopeTuple(row: any): any[] {
        return [
            row.scope.profileBindingId,
            row.scope.sourceBindingId,
            row.scope.provider,
        ];
    }
    async function ackId(
        row: any,
        original: string,
        audit: any
    ): Promise<string> {
        return digest(
            JSON.stringify([
                "ottplay-favorites-recovery-ack-v1",
                audit.runtime,
                row.operationId,
                scopeTuple(row),
                original,
                audit.ledger_revision_before,
                audit.backend_proof,
                audit.reason,
            ])
        );
    }
    async function record(row: any): Promise<any> {
        const original = await digest(favoritesReceiptOriginalCanonical(row));
        if (
            row.recovery_ack &&
            (row.fence.backendProof !== row.recovery_ack.backend_proof ||
                (await ackId(row, original, row.recovery_ack)) !==
                    row.recovery_ack.acknowledgement_id)
        )
            fail("invalid_ledger");
        return {
            acknowledgement: row.recovery_ack
                ? JSON.parse(JSON.stringify(row.recovery_ack))
                : null,
            operation_id: row.operationId,
            original_entry_sha256: original,
            original_outcome: row.state === "pending" ? "unknown" : row.state,
            original_state: row.state,
            scope: JSON.parse(JSON.stringify(row.scope)),
        };
    }
    async function snapshot(raw: string | null): Promise<any> {
        const value = parseFavoritesRecoveryLedger(raw);
        const records: any[] = [];
        for (const row of value.entries
            .filter(valid.protectedRow)
            .sort(function (a: any, b: any) {
                return a.operationId < b.operationId
                    ? -1
                    : a.operationId > b.operationId
                      ? 1
                      : 0;
            }))
            records.push(await record(row));
        return {
            ledgerFormat: value.version === null ? 2 : value.version,
            ledgerRevision: await digest(raw === null ? "null" : raw),
            records,
        };
    }
    async function inspect(raw: string | null, context: any): Promise<any> {
        if (
            !valid.exact(context, ["runtime", "operationId", "backendProof"]) ||
            !valid.runtime(context.runtime) ||
            !valid.uuid(context.operationId) ||
            !(context.backendProof === null || valid.hash(context.backendProof))
        )
            fail("invalid_request");
        const value = parseFavoritesRecoveryLedger(raw),
            state = await snapshot(raw);
        const row = value.entries.filter(function (item: any) {
            return item.operationId === context.operationId;
        })[0];
        const result: any = {
            acknowledgeAllowed: false,
            acknowledgementId: null,
            afterLedgerSha256: null,
            afterRaw: null,
            ledgerFormat: state.ledgerFormat,
            ledgerRevision: state.ledgerRevision,
            planDigest: null,
            record: row && valid.protectedRow(row) ? await record(row) : null,
        };
        if (
            !row ||
            !valid.protectedRow(row) ||
            !row.fence ||
            row.recovery_ack ||
            context.backendProof !== row.fence.backendProof ||
            !favoritesRecoveryCapacity(raw as string)
        )
            return result;
        const reason = "accept-unknown-no-replay",
            audit: any = {
                acknowledgement_id: "",
                backend_proof: context.backendProof,
                ledger_revision_before: state.ledgerRevision,
                reason,
                runtime: context.runtime,
            };
        audit.acknowledgement_id = await ackId(
            row,
            result.record.original_entry_sha256,
            audit
        );
        row.recovery_ack = audit;
        const after = JSON.stringify(value);
        if (!favoritesRecoveryCapacity(after)) return result;
        result.acknowledgeAllowed = true;
        result.acknowledgementId = audit.acknowledgement_id;
        result.afterRaw = after;
        result.afterLedgerSha256 = await digest(after);
        result.planDigest = await digest(
            JSON.stringify([
                "ottplay-favorites-recovery-plan-v1",
                context.runtime,
                row.operationId,
                scopeTuple(row),
                result.record.original_entry_sha256,
                state.ledgerRevision,
                context.backendProof,
                reason,
                result.acknowledgementId,
                result.afterLedgerSha256,
            ])
        );
        return result;
    }
    return {
        backendProof: async function (grant: any): Promise<string> {
            if (
                !grant ||
                grant.kind !== "synchronous-localstorage" ||
                grant.implementationVersion !== 1 ||
                grant.privateLedgerKey !== "favorites-receipts.v1" ||
                grant.lockName !== "ottplay:favorites-ledger" ||
                typeof grant.origin !== "string" ||
                !/^https?:\/\/[^\s/?#]+(?![\s\S])/.test(grant.origin)
            )
                fail("unsupported_persistence");
            return digest(
                JSON.stringify([
                    "ottplay-favorites-recovery-backend-v1",
                    grant.origin,
                    grant.privateLedgerKey,
                    grant.lockName,
                    grant.kind,
                    2,
                    grant.implementationVersion,
                ])
            );
        },
        capacity: favoritesRecoveryCapacity,
        inspect,
        originalCanonical: favoritesReceiptOriginalCanonical,
        parse: parseFavoritesRecoveryLedger,
        snapshot,
    };
}
