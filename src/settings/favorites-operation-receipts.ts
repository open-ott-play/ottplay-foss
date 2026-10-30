import {
    favoritesReceiptValidators,
    favoritesRecoveryCapacity,
    parseFavoritesRecoveryLedger,
    validateFavoritesReceiptFence,
    validateFavoritesReceiptRow,
} from "./favorites-recovery-codec";

/** Pure, whole-physical-ledger service. Ports do not imply cross-tab/fsync atomicity. */
interface FavoritesOperationReceiptPorts {
    compareAndSwap(
        before: string | null,
        after: string
    ): "confirmed" | "conflict" | "unknown";
    current(scope: any, refs: any): boolean;
    fence?(): any;
    now(): number;
    persistedRead(): string | null;
    read(): string | null;
    writeGuard?(fence: any): boolean;
}

export function createFavoritesOperationReceipts(
    ports: FavoritesOperationReceiptPorts,
    schema?: any
) {
    var active = false;
    var retention = 86400000;
    function fail(code: string): never {
        var error = new Error("Favorites receipts: " + code);
        (error as any).code = code;
        throw error;
    }
    function copy(value: any): any {
        return JSON.parse(JSON.stringify(value));
    }
    var validators = schema ? schema.validators : favoritesReceiptValidators;
    var capacity = schema ? schema.capacity : favoritesRecoveryCapacity;
    var exact = validators.exact,
        integer = validators.integer,
        uuid = validators.uuid,
        hash = validators.hash,
        scope = validators.scope,
        refs = validators.refs,
        meta = validators.meta,
        counts = validators.counts;
    function row(value: any): boolean {
        return schema ? schema.row(value) : validateFavoritesReceiptRow(value);
    }
    function fence(): any {
        var value: any;
        try {
            value = ports.fence && ports.fence();
        } catch (_) {}
        if (!validateFavoritesReceiptFence(value))
            fail("unsupported_persistence");
        return copy(value);
    }
    function writeAdmission(entry: any): void {
        if (
            !entry.fence ||
            entry.recovery_ack ||
            JSON.stringify(fence()) !== JSON.stringify(entry.fence)
        )
            fail("unsupported_persistence");
        var allowed = false;
        try {
            allowed =
                !!ports.writeGuard &&
                ports.writeGuard(copy(entry.fence)) === true;
        } catch (_) {}
        if (!allowed) fail("unsupported_persistence");
    }
    function bounded(raw: any): boolean {
        if (typeof raw !== "string" || raw.length > 65536) return false;
        try {
            return (
                encodeURIComponent(raw).replace(/%[0-9A-F]{2}/g, "x").length <=
                65536
            );
        } catch (_) {
            return false;
        }
    }
    function parse(raw: string | null): any {
        return schema ? schema.parse(raw) : parseFavoritesRecoveryLedger(raw);
    }
    function now(): number {
        var time: any;
        try {
            time = ports.now();
        } catch (_) {
            fail("clock_unavailable");
        }
        if (!integer(time) || time > 9007199254740991 - retention)
            fail("clock_unavailable");
        return time;
    }
    function read(persisted: boolean): string | null {
        var raw: any;
        try {
            raw = persisted ? ports.persistedRead() : ports.read();
        } catch (_) {
            fail("storage_unavailable");
        }
        if (raw !== null && typeof raw !== "string") fail("invalid_ledger");
        parse(raw);
        return raw;
    }
    function current(entry: any): void {
        var valid = false;
        try {
            valid = ports.current(copy(entry.scope), copy(entry.refs)) === true;
        } catch (_) {}
        if (!valid) fail("context_changed");
    }
    function find(value: any, id: string): any {
        for (var i = 0; i < value.entries.length; i++)
            if (value.entries[i].operationId === id) return value.entries[i];
        return null;
    }
    function ticket(entry: any): any {
        return {
            createdAt: entry.createdAt,
            fence: copy(entry.fence),
            operationId: entry.operationId,
            payloadHash: entry.payloadHash,
            refs: copy(entry.refs),
            scope: copy(entry.scope),
        };
    }
    function pending(value: any, proof: any): any {
        if (
            !exact(proof, [
                "operationId",
                "payloadHash",
                "scope",
                "refs",
                "createdAt",
                "fence",
            ]) ||
            !uuid(proof.operationId)
        )
            fail("invalid_ticket");
        var entry = find(value, proof.operationId);
        if (
            !entry ||
            entry.state !== "pending" ||
            !entry.fence ||
            entry.recovery_ack ||
            JSON.stringify(ticket(entry)) !== JSON.stringify(proof)
        )
            fail("invalid_ticket");
        if (now() >= entry.expiresAt) fail("expired");
        current(entry);
        return entry;
    }
    function owned(run: () => any): any {
        if (active) fail("busy");
        active = true;
        try {
            return run();
        } finally {
            active = false;
        }
    }
    function completionOwned(run: () => any): any {
        try {
            return owned(run);
        } catch (error: any) {
            // Receipt failure says nothing about target stores already written.
            var code =
                error &&
                typeof error.code === "string" &&
                /^[a-z_]{1,32}(?![\s\S])/.test(error.code)
                    ? error.code
                    : "outcome_unknown";
            var failure = new Error("Favorites receipts: " + code);
            (failure as any).code = code;
            (failure as any).outcome = "unknown";
            throw failure;
        }
    }
    function write(before: string | null, after: string, entry: any): void {
        if (!capacity(after) || (before !== null && !capacity(before)))
            fail("capacity");
        writeAdmission(entry);
        current(entry);
        if (read(false) !== before || read(true) !== before)
            fail("ledger_changed");
        current(entry);
        writeAdmission(entry);
        var result: string;
        try {
            result = ports.compareAndSwap(before, after);
        } catch (_) {
            fail("outcome_unknown");
        }
        if (result === "conflict") fail("ledger_changed");
        if (result !== "confirmed") fail("outcome_unknown");
        try {
            if (read(true) !== after || read(false) !== after)
                fail("outcome_unknown");
            writeAdmission(entry);
            current(entry);
            if (read(true) !== after || read(false) !== after)
                fail("outcome_unknown");
        } catch (_) {
            fail("outcome_unknown");
        }
    }
    function plan(proof: any, outcome: any): any {
        var before = read(false);
        if (read(true) !== before) fail("ledger_changed");
        return completionPlan(before, proof, outcome);
    }
    function completionPlan(
        before: string | null,
        proof: any,
        outcome: any
    ): any {
        if (
            !exact(
                outcome,
                ["state", "meta", "counts", "newRevision", "persistence"],
                schema ? schema.outcomeKeys : []
            ) ||
            (schema && !schema.outcome(outcome)) ||
            ["verified", "not_applied", "partial", "unknown"].indexOf(
                outcome.state
            ) < 0 ||
            !meta(outcome.meta) ||
            !counts(outcome.counts) ||
            outcome.persistence !== "persistent"
        )
            fail("invalid_outcome");
        if (before !== null && !capacity(before)) fail("capacity");
        var value = parse(before),
            entry = pending(value, proof);
        entry.state = outcome.state;
        entry.meta = copy(outcome.meta);
        entry.receipt = {
            counts: copy(outcome.counts),
            document_sha256: entry.payloadHash,
            new_revision: outcome.newRevision,
            operation_id: entry.operationId,
            outcome: entry.state,
            persistence: outcome.persistence,
            plan_digest: new Array(65).join("0"),
            scope: copy(entry.scope),
        };
        if (schema)
            entry.receipt = schema.receipt(entry, outcome, entry.receipt);
        if (!row(entry)) fail("invalid_outcome");
        var after = JSON.stringify(value);
        if (!capacity(after)) fail("capacity");
        entry.receipt.plan_digest = { computed: "plan_digest", width: 64 };
        return {
            afterTemplate: copy(value),
            beforeRaw: before,
            operationId: proof.operationId,
        };
    }
    function reservation(
        input: any,
        admission: any,
        completionOutcome?: any,
        plannedAt?: number,
        capturedBefore?: string | null
    ): any {
        if (
            !exact(admission, ["freshAdmission"]) ||
            admission.freshAdmission !== true
        )
            fail("fresh_admission_required");
        if (
            !exact(input, ["operationId", "payloadHash", "scope", "refs"]) ||
            !uuid(input.operationId) ||
            !hash(input.payloadHash) ||
            !scope(input.scope) ||
            !refs(input.refs)
        )
            fail("invalid_request");
        var time = plannedAt === undefined ? now() : plannedAt;
        if (!integer(time) || time > now() || now() >= time + retention)
            fail("expired");
        var before =
            capturedBefore === undefined ? read(false) : capturedBefore;
        if (read(false) !== before || read(true) !== before)
            fail("ledger_changed");
        if (before !== null && !capacity(before)) fail("capacity");
        var value = parse(before);
        value.version = schema ? schema.version : 2;
        var provenance = fence();
        if (find(value, input.operationId)) fail("operation_exists");
        var entry = {
            createdAt: time,
            expiresAt: time + retention,
            fence: provenance,
            operationId: input.operationId,
            payloadHash: input.payloadHash,
            refs: copy(input.refs),
            scope: copy(input.scope),
            state: "pending",
        };
        current(entry);
        // Only proved terminal rows may be discarded, oldest first, and only
        // when necessary for this exact pending/completion plan to fit.
        var candidates = value.entries
            .filter(function (old: any) {
                return (
                    (old.state === "verified" || old.state === "not_applied") &&
                    !old.recovery_ack
                );
            })
            .sort(function (a: any, b: any) {
                return (
                    a.createdAt - b.createdAt ||
                    a.operationId.localeCompare(b.operationId)
                );
            });
        value.entries.push(entry);
        var completion: any = null,
            pendingRaw: string;
        while (true) {
            pendingRaw = JSON.stringify(value);
            var fits = value.entries.length <= 32 && capacity(pendingRaw);
            if (fits && completionOutcome !== undefined) {
                try {
                    completion = completionPlan(
                        pendingRaw,
                        ticket(entry),
                        completionOutcome
                    );
                } catch (error: any) {
                    if (!error || error.code !== "capacity") throw error;
                    fits = false;
                }
            }
            if (fits) break;
            if (!candidates.length) fail("capacity");
            var evict = candidates.shift();
            value.entries = value.entries.filter(function (old: any) {
                return old.operationId !== evict.operationId;
            });
        }
        if (read(false) !== before || read(true) !== before)
            fail("ledger_changed");
        current(entry);
        var prepared: any = {
            beforeRaw: before,
            operationId: entry.operationId,
            pendingRaw: pendingRaw,
            ticket: ticket(entry),
        };
        if (completion) prepared.completion = completion;
        return prepared;
    }
    function verifyReservationPlan(prepared: any): any {
        if (
            !exact(
                prepared,
                ["operationId", "beforeRaw", "pendingRaw", "ticket"],
                ["completion"]
            ) ||
            !uuid(prepared.operationId)
        )
            fail("invalid_plan");
        var pendingValue = parse(prepared.pendingRaw),
            proof = prepared.ticket,
            entry = pending(pendingValue, proof);
        if (entry.operationId !== prepared.operationId) fail("invalid_plan");
        var completionOutcome: any;
        if (prepared.completion !== undefined) {
            var c = prepared.completion;
            if (
                !exact(c, ["operationId", "beforeRaw", "afterTemplate"]) ||
                c.operationId !== prepared.operationId ||
                c.beforeRaw !== prepared.pendingRaw
            )
                fail("invalid_plan");
            var final = find(c.afterTemplate, prepared.operationId);
            if (!final || !final.receipt) fail("invalid_plan");
            completionOutcome = {
                counts: final.receipt.counts,
                meta: final.meta,
                newRevision: final.receipt.new_revision,
                persistence: final.receipt.persistence,
                state: final.state,
            };
            if (schema)
                completionOutcome = schema.outcomeFromReceipt(
                    final.receipt,
                    completionOutcome
                );
        }
        var expected = reservation(
            {
                operationId: entry.operationId,
                payloadHash: entry.payloadHash,
                refs: entry.refs,
                scope: entry.scope,
            },
            { freshAdmission: true },
            completionOutcome,
            entry.createdAt,
            prepared.beforeRaw
        );
        if (JSON.stringify(expected) !== JSON.stringify(prepared))
            fail("invalid_plan");
        return entry;
    }
    return {
        commitCompletion: function (descriptor: any) {
            return completionOwned(function () {
                if (
                    !exact(descriptor, [
                        "operationId",
                        "beforeRaw",
                        "afterRaw",
                    ]) ||
                    !uuid(descriptor.operationId) ||
                    !bounded(descriptor.afterRaw)
                )
                    fail("invalid_plan");
                var before = parse(descriptor.beforeRaw),
                    after = parse(descriptor.afterRaw);
                var original = find(before, descriptor.operationId),
                    final = find(after, descriptor.operationId);
                if (
                    !original ||
                    original.state !== "pending" ||
                    !original.fence ||
                    original.recovery_ack ||
                    !final ||
                    final.state === "pending" ||
                    JSON.stringify(ticket(original)) !==
                        JSON.stringify(ticket(final))
                )
                    fail("invalid_plan");
                var expected = copy(before);
                var target = find(expected, descriptor.operationId);
                target.state = final.state;
                target.meta = final.meta;
                target.receipt = final.receipt;
                if (JSON.stringify(expected) !== descriptor.afterRaw)
                    fail("invalid_plan");
                pending(before, ticket(original));
                write(descriptor.beforeRaw, descriptor.afterRaw, original);
                return {
                    receipt: copy(final.receipt),
                    replayAllowed: false,
                    state: final.state,
                };
            });
        },
        commitReservation: function (prepared: any) {
            return owned(function () {
                var entry = verifyReservationPlan(prepared);
                write(prepared.beforeRaw, prepared.pendingRaw, entry);
                return ticket(entry);
            });
        },
        materializeCompletion: function (template: any, digest: string) {
            return owned(function () {
                if (
                    !exact(template, [
                        "operationId",
                        "beforeRaw",
                        "afterTemplate",
                    ]) ||
                    !uuid(template.operationId) ||
                    !hash(digest)
                )
                    fail("invalid_plan");
                // Bound serialized input before copying; this is private, not a wire document.
                var raw = JSON.stringify(template.afterTemplate);
                if (!bounded(raw)) fail("capacity");
                var value = copy(template.afterTemplate),
                    entry = find(value, template.operationId);
                if (
                    !entry ||
                    !entry.receipt ||
                    !exact(entry.receipt.plan_digest, ["computed", "width"]) ||
                    entry.receipt.plan_digest.computed !== "plan_digest" ||
                    entry.receipt.plan_digest.width !== 64
                )
                    fail("invalid_plan");
                entry.receipt.plan_digest = digest;
                var after = JSON.stringify(value);
                parse(after);
                if (!capacity(after)) fail("capacity");
                return {
                    afterRaw: after,
                    beforeRaw: template.beforeRaw,
                    operationId: template.operationId,
                };
            });
        },
        prepareCompletion: function (proof: any, outcome: any) {
            return owned(function () {
                return plan(proof, outcome);
            });
        },
        /** Pure logical reservation: retention is UP TO 24h from this plan's timestamp.
         * Trusted fresh admission is required; missing/evicted receipts never grant replay. */
        prepareReservation: function (
            input: any,
            admission: any,
            outcome?: any
        ) {
            return owned(function () {
                return reservation(input, admission, outcome);
            });
        },
        // Existing immediate callers retain the same explicit admission requirement.
        reserve: function (input: any, admission: any) {
            return owned(function () {
                var prepared = reservation(input, admission);
                var entry = pending(
                    parse(prepared.pendingRaw),
                    prepared.ticket
                );
                write(prepared.beforeRaw, prepared.pendingRaw, entry);
                return ticket(entry);
            });
        },
        status: function (operationId: string) {
            return owned(function () {
                if (!uuid(operationId)) fail("invalid_request");
                var raw = read(true),
                    entry = find(parse(raw), operationId);
                if (read(false) !== raw || read(true) !== raw)
                    fail("ledger_changed");
                if (!entry || now() >= entry.expiresAt)
                    return { replayAllowed: false, state: "unknown" };
                current(entry);
                if (read(true) !== raw || read(false) !== raw)
                    fail("ledger_changed");
                return {
                    receipt:
                        entry.state === "pending" ? null : copy(entry.receipt),
                    replayAllowed: false,
                    state: entry.state,
                };
            });
        },
        verifyPending: function (proof: any) {
            return owned(function () {
                var raw = read(true),
                    entry = pending(parse(raw), proof);
                if (read(false) !== raw || read(true) !== raw)
                    fail("ledger_changed");
                current(entry);
                if (read(true) !== raw || read(false) !== raw)
                    fail("ledger_changed");
                return true;
            });
        },
        verifyReservation: function (prepared: any) {
            return owned(function () {
                verifyReservationPlan(prepared);
                return true;
            });
        },
    };
}
