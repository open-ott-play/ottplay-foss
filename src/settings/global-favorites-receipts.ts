import {
    globalFavoritesBackendProof,
    verifyGlobalFavoritesAudit,
} from "./global-favorites-recovery";
import { createFavoritesOperationReceipts } from "./favorites-operation-receipts";
import { globalFavoritesReceiptSchema as schema } from "./global-favorites-receipt-codec";
const GLOBAL_FAVORITES_RECEIPTS_KEY = "favorites-global-receipts.v1";
/** Same proven receipt algorithm and real Web Lock, separate strict global ledger. */
export function createGlobalFavoritesCommitter(ports: any) {
    var plans: any = Object.create(null),
        auditProofs: any = Object.create(null),
        auditGrant: any = null,
        activeOperation: string | null = null;
    function fail(code: string): never {
        throw new Error(code);
    }
    function current() {
        return ports.current() === true;
    }
    function uncertain(raw: string | null, grant?: any) {
        return schema.parse(raw).entries.some(function (row: any) {
            return (
                row.operationId !== activeOperation &&
                ["pending", "partial", "unknown"].indexOf(row.state) >= 0 &&
                (!row.recovery_ack ||
                    grant !== auditGrant ||
                    auditProofs[row.operationId] !== JSON.stringify(row))
            );
        });
    }
    function service(
        grant: any,
        proof: string,
        active: () => boolean,
        expectedRefs?: any,
        admission?: () => boolean
    ) {
        return createFavoritesOperationReceipts(
            {
                read: function () {
                    return grant.read(GLOBAL_FAVORITES_RECEIPTS_KEY);
                },
                persistedRead: function () {
                    return grant.read(GLOBAL_FAVORITES_RECEIPTS_KEY);
                },
                now: ports.now,
                current: function (scope: any, refs: any) {
                    return (
                        scope.kind === "global" &&
                        scope.store === "remoteFavorites.v1" &&
                        current() &&
                        (!admission || admission()) &&
                        grant.current() &&
                        (!expectedRefs ||
                            JSON.stringify(refs) ===
                                JSON.stringify(expectedRefs))
                    );
                },
                fence: function () {
                    return {
                        version: 2,
                        backendProof: proof,
                        guardImplementationVersion: 1,
                    };
                },
                writeGuard: function () {
                    return (
                        active() &&
                        current() &&
                        (!admission || admission()) &&
                        grant.current()
                    );
                },
                compareAndSwap: function (
                    before: string | null,
                    after: string
                ) {
                    return active()
                        ? grant.compareAndSwap(
                              GLOBAL_FAVORITES_RECEIPTS_KEY,
                              before,
                              after,
                              function () {
                                  return (
                                      current() && (!admission || admission())
                                  );
                              }
                          )
                        : "conflict";
                },
            },
            schema
        );
    }
    async function proof(grant: any) {
        var value = await globalFavoritesBackendProof(grant, ports.sha256);
        if (!current() || !grant.current()) fail("context_changed");
        return value;
    }
    function receipt(row: any) {
        return {
            version: 1,
            subject: "global",
            operation_id: row.operationId,
            operation_runtime: row.refs.runtimeId,
            transaction_id: row.refs.stageId,
            input_document_sha256: row.payloadHash,
            result_document_sha256: row.receipt.global.result_document_sha256,
            expected_revision: row.receipt.global.expected_revision,
            new_revision: row.receipt.new_revision,
            context_revision: row.receipt.global.context_revision,
            plan_digest: row.receipt.plan_digest,
            counts: row.receipt.counts,
            changed: row.receipt.global.changed,
            outcome: "verified",
            persistence: "persistent",
            required_kinds: row.receipt.global.required_kinds,
        };
    }
    async function qualify() {
        var grant = ports.capture(),
            backend = await proof(grant),
            raw = grant.read(GLOBAL_FAVORITES_RECEIPTS_KEY),
            rows = schema.parse(raw).entries;
        for (var i = 0; i < rows.length; i++)
            if (rows[i].recovery_ack) {
                if (
                    rows[i].fence.backendProof !== backend ||
                    !(await verifyGlobalFavoritesAudit(rows[i], ports.sha256))
                )
                    fail("invalid_ledger");
                auditProofs[rows[i].operationId] = JSON.stringify(rows[i]);
                delete plans[rows[i].operationId];
            }
        if (!current() || grant.read(GLOBAL_FAVORITES_RECEIPTS_KEY) !== raw)
            fail("revision_conflict");
        auditGrant = grant;
        return canWrite();
    }
    async function prepare(args: any) {
        if (!(await qualify())) fail(blocker() || "unsupported_persistence");
        if (plans[args.operation_id]) fail("operation_exists");
        if (Object.keys(plans).length >= 32) fail("limits_exceeded");
        if (
            !current() ||
            !(await ports.freshAdmission(
                args.operation_id,
                args.input_document_sha256
            ))
        )
            fail("operation_exists");
        var captured = await ports.captureContext();
        var admitted = function () {
            return (
                current() &&
                captured.current() &&
                (!args.admission || args.admission())
            );
        };
        var plan = await ports.store.prepare(
            args.expected_revision,
            args.change,
            admitted
        );
        var grant = plan.physical,
            backend = await proof(grant),
            context = captured.revision;
        if (context !== args.expected_context_revision || !plan.current())
            fail("context_changed");
        var raw = grant.read(GLOBAL_FAVORITES_RECEIPTS_KEY);
        if (uncertain(raw, grant)) fail("reconciliation_required");
        var held = false,
            refs = { stageId: args.transaction_id, runtimeId: args.runtime };
        var ledger = service(
            grant,
            backend,
            function () {
                return held;
            },
            refs,
            admitted
        );
        var before = plan.beforeRaw
            ? JSON.parse(plan.beforeRaw)
            : { entries: [] };
        if (before.version === 1)
            before = { entries: [], legacy: before.entries, legacyAliases: {} };
        var legacy = before.legacy || [],
            aliases = before.legacyAliases || {},
            remainingLegacy: any = Object.create(null);
        var after = JSON.parse(plan.afterRaw),
            oldIds: any = Object.create(null),
            newIds: any = Object.create(null);
        before.entries.forEach(function (row: any, index: number) {
            oldIds[row.id] = { row: row, index: index };
        });
        after.entries.forEach(function (row: any, index: number) {
            newIds[row.id] = { row: row, index: index };
        });
        after.legacy.forEach(function (row: any) {
            remainingLegacy[row.id] = true;
        });
        var legacyEffects = { linked_removed: 0, unmapped_retained: 0 };
        legacy.forEach(function (row: any) {
            if (aliases[row.id] && !remainingLegacy[row.id])
                legacyEffects.linked_removed++;
            else if (!aliases[row.id] && remainingLegacy[row.id])
                legacyEffects.unmapped_retained++;
        });
        var counts = {
            before: before.entries.length,
            after: after.entries.length,
            added: 0,
            removed: 0,
            retained: 0,
            updated: 0,
            moved: 0,
            duplicates_skipped: 0,
        };
        after.entries.forEach(function (row: any, index: number) {
            if (!oldIds[row.id]) counts.added++;
            else {
                counts.retained++;
                if (oldIds[row.id].row.title !== row.title) counts.updated++;
                if (oldIds[row.id].index !== index) counts.moved++;
            }
        });
        before.entries.forEach(function (row: any) {
            if (!newIds[row.id]) counts.removed++;
        });
        var identities: any = Object.create(null),
            previousIdentities: any = Object.create(null);
        before.entries.forEach(function (row: any) {
            previousIdentities[
                ports.codec.identity({
                    title: row.title,
                    origin: row.origin,
                    locator: row.locator,
                })
            ] = true;
        });
        args.change.entries.forEach(function (row: any) {
            var key = ports.codec.identity(row);
            if (
                identities[key] ||
                (args.change.op === "put" && previousIdentities[key])
            )
                counts.duplicates_skipped++;
            identities[key] = true;
        });
        var exported = ports.codec.document({
            version: 1,
            entries: after.entries.map(function (row: any) {
                return {
                    title: row.title,
                    origin: row.origin,
                    locator: row.locator,
                };
            }),
        });
        if (!exported) fail("invalid_document");
        var resultHash = await ports.sha256(JSON.stringify(exported));
        var input = ports.codec.document({
            version: 1,
            entries: args.change.entries,
        });
        if (!input) fail("invalid_document");
        var requiredKinds = ports.codec
            .requiredLocatorKinds(input)
            .slice()
            .sort();
        var outcome = {
            state: "verified",
            meta: { code: "none", appliedStores: 2, totalStores: 2 },
            counts: counts,
            newRevision: plan.newRevision,
            persistence: "persistent",
            global: {
                required_kinds: requiredKinds,
                expected_revision: plan.expectedRevision,
                context_revision: context,
                result_document_sha256: resultHash,
                changed: plan.newRevision !== plan.expectedRevision,
            },
        };
        var reservation = ledger.prepareReservation(
            {
                operationId: args.operation_id,
                payloadHash: args.input_document_sha256,
                scope: { kind: "global", store: "remoteFavorites.v1" },
                refs: refs,
            },
            { freshAdmission: true },
            outcome
        );
        var digest = await ports.sha256(
            JSON.stringify({
                domain: "favorites-global-plan-v1",
                operation_id: args.operation_id,
                transaction_id: args.transaction_id,
                context_revision: context,
                expected_revision: plan.expectedRevision,
                new_revision: plan.newRevision,
                after_sha256: await ports.sha256(plan.afterRaw),
                legacy_effects: legacyEffects,
                reservation: reservation,
            })
        );
        if (
            !current() ||
            !plan.current() ||
            grant.read(GLOBAL_FAVORITES_RECEIPTS_KEY) !== raw
        )
            fail("revision_conflict");
        plans[args.operation_id] = {
            plan: plan,
            grant: grant,
            ledger: ledger,
            reservation: reservation,
            digest: digest,
            context: context,
            started: false,
            contextCurrent: captured.current,
            setHeld: function (value: boolean) {
                held = value;
            },
        };
        return {
            plan_digest: digest,
            new_revision: plan.newRevision,
            result_document_sha256: resultHash,
            counts: counts,
            legacy_effects: legacyEffects,
            result_document: exported,
        };
    }
    async function commit(operationId: string, digest: string) {
        var item = plans[operationId];
        if (!item || item.started || item.queued || item.digest !== digest)
            fail("reconciliation_required");
        if (!current() || !item.plan.current() || !item.contextCurrent())
            fail("context_changed");
        item.queued = true;
        return item.plan.underLock(async function (
            apply: () => Promise<any>,
            held: any
        ) {
            if (held !== item.grant) fail("unsupported_persistence");
            item.started = true;
            activeOperation = operationId;
            item.setHeld(true);
            var reserved = false;
            try {
                item.ledger.commitReservation(item.reservation);
                reserved = true;
                var result = await apply();
                if (result.outcome !== "verified")
                    return { outcome: "unknown", receipt: null };
                if (!current() || !held.current() || !item.contextCurrent())
                    return { outcome: "unknown", receipt: null };
                var completion = item.ledger.materializeCompletion(
                    item.reservation.completion,
                    item.digest
                );
                item.ledger.commitCompletion(completion);
                var raw = held.read(GLOBAL_FAVORITES_RECEIPTS_KEY),
                    row = schema.parse(raw).entries.filter(function (row: any) {
                        return row.operationId === operationId;
                    })[0];
                if (
                    !row ||
                    row.state !== "verified" ||
                    !current() ||
                    held.read(GLOBAL_FAVORITES_RECEIPTS_KEY) !== raw
                )
                    return { outcome: "unknown", receipt: null };
                delete plans[operationId];
                return { outcome: "verified", receipt: receipt(row) };
            } catch (error: any) {
                if (
                    !reserved &&
                    error &&
                    [
                        "context_changed",
                        "ledger_changed",
                        "invalid_plan",
                        "unsupported_persistence",
                        "expired",
                    ].indexOf(error.code) >= 0
                ) {
                    delete plans[operationId];
                    return { outcome: "not_applied", receipt: null };
                }
                return { outcome: "unknown", receipt: null };
            } finally {
                item.setHeld(false);
                activeOperation = null;
            }
        });
    }
    async function status(operationId: string) {
        if (!current() || !(await ports.authorizedOperation(operationId)))
            fail("policy_denied");
        var grant = ports.capture(),
            backend = await proof(grant),
            raw = grant.read(GLOBAL_FAVORITES_RECEIPTS_KEY);
        var row = schema.parse(raw).entries.filter(function (row: any) {
            return row.operationId === operationId;
        })[0];
        if (!row || ports.now() >= row.expiresAt)
            return { state: "not_found", outcome: "unknown", receipt: null };
        if (
            !row.fence ||
            row.fence.backendProof !== backend ||
            !current() ||
            grant.read(GLOBAL_FAVORITES_RECEIPTS_KEY) !== raw
        )
            return { state: "unknown", outcome: "unknown", receipt: null };
        if (row.state !== "verified" || !row.receipt)
            return { state: "unknown", outcome: "unknown", receipt: null };
        var target = grant.read("remoteFavorites.v1"),
            revision = await ports.sha256(target === null ? "null" : target);
        if (
            !current() ||
            grant.read(GLOBAL_FAVORITES_RECEIPTS_KEY) !== raw ||
            grant.read("remoteFavorites.v1") !== target ||
            revision !== row.receipt.new_revision
        )
            return { state: "unknown", outcome: "unknown", receipt: null };
        delete plans[operationId];
        return {
            state: "committed",
            outcome: "verified",
            receipt: receipt(row),
        };
    }
    function blocker() {
        try {
            var grant = ports.capture(),
                raw = grant.read(GLOBAL_FAVORITES_RECEIPTS_KEY),
                value = schema.parse(raw);
            if (!current() || !grant.current())
                return "unsupported_persistence";
            if (
                Object.keys(plans).some(function (id) {
                    return id !== activeOperation && plans[id].started;
                }) ||
                uncertain(raw, grant)
            )
                return "reconciliation_required";
            if (
                value.entries.filter(function (row: any) {
                    return (
                        row.recovery_ack ||
                        ["verified", "not_applied"].indexOf(row.state) < 0
                    );
                }).length >= 32
            )
                return "limits_exceeded";
            return null;
        } catch (_) {
            return "storage_unavailable";
        }
    }
    function canWrite() {
        return blocker() === null;
    }
    return {
        prepare: prepare,
        commit: commit,
        status: status,
        qualify: qualify,
        canWrite: canWrite,
        blocker: blocker,
        discard: function (id: string) {
            var plan = plans[id];
            if (plan && (plan.started || plan.queued))
                fail("reconciliation_required");
            delete plans[id];
        },
    };
}
