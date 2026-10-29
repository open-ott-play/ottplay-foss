import {
    favoritesReceiptValidators as base,
    favoritesReceiptUtf8Length,
    validateFavoritesReceiptFence,
} from "./favorites-recovery-codec";
/** Strict private schema adapter. The old scoped receipt parser/wire is unchanged. */
function globalFavoritesReceiptScope(value: any): boolean {
    return (
        base.exact(value, ["kind", "store"]) &&
        value.kind === "global" &&
        value.store === "remoteFavorites.v1"
    );
}
function counts(value: any): boolean {
    return (
        base.exact(value, [
            "before",
            "after",
            "added",
            "removed",
            "retained",
            "updated",
            "moved",
            "duplicates_skipped",
        ]) &&
        Object.keys(value).every(function (key) {
            return base.integer(value[key]) && value[key] <= 1000;
        })
    );
}
function context(value: any): boolean {
    return (
        base.exact(value, [
            "expected_revision",
            "context_revision",
            "result_document_sha256",
            "changed",
            "required_kinds",
        ]) &&
        base.hash(value.expected_revision) &&
        base.hash(value.context_revision) &&
        base.hash(value.result_document_sha256) &&
        typeof value.changed === "boolean" &&
        Array.isArray(value.required_kinds) &&
        value.required_kinds.length <= 5 &&
        value.required_kinds.every(function (kind: any, index: number) {
            return (
                [
                    "channel",
                    "channel-name",
                    "local-media",
                    "plex-media",
                    "vportal-media",
                ].indexOf(kind) >= 0 &&
                (index === 0 || value.required_kinds[index - 1] < kind)
            );
        })
    );
}
function row(value: any): boolean {
    if (
        !base.exact(
            value,
            [
                "operationId",
                "payloadHash",
                "scope",
                "refs",
                "createdAt",
                "expiresAt",
                "state",
                "fence",
            ],
            ["meta", "receipt", "recovery_ack"]
        ) ||
        !base.uuid(value.operationId) ||
        !base.hash(value.payloadHash) ||
        !globalFavoritesReceiptScope(value.scope) ||
        !base.refs(value.refs) ||
        !base.integer(value.createdAt) ||
        !base.integer(value.expiresAt) ||
        value.expiresAt !== value.createdAt + 86400000 ||
        !validateFavoritesReceiptFence(value.fence) ||
        ["pending", "verified", "not_applied", "partial", "unknown"].indexOf(
            value.state
        ) < 0
    )
        return false;
    if (
        value.recovery_ack !== undefined &&
        !globalFavoritesReceiptAudit(value.recovery_ack)
    )
        return false;
    if (
        value.recovery_ack !== undefined &&
        ["pending", "partial", "unknown"].indexOf(value.state) < 0
    )
        return false;
    if (value.state === "pending")
        return value.meta === undefined && value.receipt === undefined;
    var r = value.receipt;
    return (
        base.meta(value.meta) &&
        base.exact(r, [
            "operation_id",
            "scope",
            "document_sha256",
            "plan_digest",
            "new_revision",
            "counts",
            "outcome",
            "persistence",
            "global",
        ]) &&
        r.operation_id === value.operationId &&
        globalFavoritesReceiptScope(r.scope) &&
        r.document_sha256 === value.payloadHash &&
        base.hash(r.plan_digest) &&
        base.hash(r.new_revision) &&
        counts(r.counts) &&
        context(r.global) &&
        r.outcome === value.state &&
        r.persistence === "persistent" &&
        (value.state !== "verified" ||
            value.meta.appliedStores === value.meta.totalStores) &&
        (value.state !== "not_applied" || value.meta.appliedStores === 0)
    );
}
function globalFavoritesReceiptAudit(value: any): boolean {
    return (
        base.exact(value, [
            "acknowledgement_id",
            "runtime",
            "ledger_revision_before",
            "store_revision",
            "context_revision",
            "backend_proof",
            "reason",
        ]) &&
        base.hash(value.acknowledgement_id) &&
        base.refs({ stageId: "audit", runtimeId: value.runtime }) &&
        base.hash(value.ledger_revision_before) &&
        base.hash(value.store_revision) &&
        base.hash(value.context_revision) &&
        base.hash(value.backend_proof) &&
        value.reason === "accept-unknown-no-replay"
    );
}
function parse(raw: string | null): any {
    if (raw === null) return { version: null, entries: [] };
    if (typeof raw !== "string" || favoritesReceiptUtf8Length(raw) > 65536)
        throw new Error("invalid_ledger");
    var value = JSON.parse(raw);
    if (
        !base.exact(value, ["version", "entries"]) ||
        value.version !== 1 ||
        !Array.isArray(value.entries) ||
        value.entries.length > 32
    )
        throw new Error("invalid_ledger");
    if (JSON.stringify(value) !== raw) throw new Error("noncanonical_ledger");
    var ids: any = Object.create(null);
    value.entries.forEach(function (entry: any) {
        if (!row(entry) || ids[entry.operationId])
            throw new Error("invalid_ledger");
        ids[entry.operationId] = true;
    });
    return value;
}
export const globalFavoritesReceiptSchema = Object.freeze({
    version: 1,
    validators: Object.assign({}, base, {
        scope: globalFavoritesReceiptScope,
        counts: counts,
    }),
    row: row,
    parse: parse,
    capacity: function (raw: string) {
        try {
            var value = parse(raw);
            return (
                favoritesReceiptUtf8Length(raw) +
                    1024 *
                        value.entries.filter(function (row: any) {
                            return (
                                !row.recovery_ack &&
                                ["pending", "partial", "unknown"].indexOf(
                                    row.state
                                ) >= 0
                            );
                        }).length <=
                65536
            );
        } catch (_) {
            return false;
        }
    },
    outcomeFromReceipt: function (receipt: any, outcome: any) {
        return Object.assign({}, outcome, {
            global: JSON.parse(JSON.stringify(receipt.global)),
        });
    },
    outcomeKeys: ["global"],
    outcome: function (value: any) {
        return context(value.global);
    },
    receipt: function (_entry: any, outcome: any, receipt: any) {
        return Object.assign({}, receipt, {
            global: JSON.parse(JSON.stringify(outcome.global)),
        });
    },
});
