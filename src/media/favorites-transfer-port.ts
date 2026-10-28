/** Current verified Plex source; exact TV/media/receipt stores, no atomicity or routing claim. */
interface CurrentPlexFavoritesPorts {
    admitOperation?(
        scope: any,
        operationId: string,
        context: any
    ): { operationFresh: boolean; budgetAccepted: boolean };
    binding(scope: any): { revision: string; current(): boolean } | null;
    capture?(scope: any): any;
    document: {
        snapshot(scope: any, tv: any, media: any): Uint8Array;
        decode(bytes: Uint8Array, scope: any): any;
        prepare(bytes: Uint8Array, scope: any, media: any): any;
    };
    now(): number;
    receipts: {
        physicalKey: string;
        service: any;
        factory(ports: any): any;
        current(): boolean;
    };
    sha256(value: string | Uint8Array): string | Promise<string>;
    utf8(value: string): Uint8Array;
}
export function createCurrentPlexFavoritesTransferPort(
    host: any,
    ports: CurrentPlexFavoritesPorts
) {
    var tvId = "plex-channel-favorites",
        mediaId = "plex-media-favorites",
        receiptId = "favorites-operation-receipts";
    var admissions: Record<string, any> = Object.create(null);
    var provisional: any = null;
    function fail(code: string): never {
        throw new Error(code);
    }
    function copy(value: any) {
        return JSON.parse(JSON.stringify(value));
    }
    function same(a: any, b: any): boolean {
        if (a === b) return true;
        if (!a || !b || typeof a !== "object" || typeof b !== "object")
            return false;
        var keys = Object.keys(a).sort();
        return (
            keys.join("\n") === Object.keys(b).sort().join("\n") &&
            keys.every((key) => same(a[key], b[key]))
        );
    }
    function scope(value: any): boolean {
        var uuid =
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/;
        return (
            !!value &&
            Object.keys(value).sort().join(",") ===
                "profileBindingId,provider,sourceBindingId" &&
            value.provider === "plex" &&
            uuid.test(value.profileBindingId) &&
            uuid.test(value.sourceBindingId)
        );
    }
    async function digest(value: string | Uint8Array): Promise<string> {
        var hash = await ports.sha256(value);
        if (!/^[a-f0-9]{64}(?![\s\S])/.test(hash)) fail("storage_unavailable");
        return hash;
    }
    function capture(expected: any) {
        if (!scope(expected)) fail("policy_denied");
        if (ports.capture) return ports.capture(expected);
        var binding = ports.binding(expected),
            driver = host.__ottActiveProviderDriver,
            storage = host.ottpStorage;
        var get = host.stbGetItem,
            set = host.stbSetItem,
            del = host.stbDelItem,
            persisted = host.stbGetPersistedItem;
        if (
            !binding ||
            !binding.current() ||
            !driver ||
            driver.id !== "plex" ||
            typeof driver.favoritesSource !== "function" ||
            host.p_pref !== "plex" ||
            !storage ||
            storage.get !== get ||
            storage.set !== set ||
            storage.del !== del ||
            typeof persisted !== "function" ||
            (storage.localPlayback && storage.localPlayback.active()) ||
            !ports.receipts ||
            !ports.receipts.current()
        )
            fail("unsupported_persistence");
        var provenance = driver.favoritesSource,
            proof = provenance.call(driver);
        if (!proof || proof.verified !== true || !proof.current())
            fail("policy_denied");
        var prefix = host.p_pref,
            keyFunction = driver.storageKey;
        function physical(logical: string) {
            return keyFunction
                ? keyFunction.call(driver, logical)
                : prefix + logical;
        }
        var identity = host.__ottSourceIdentity,
            channelSource = identity && identity.current(host);
        if (
            typeof channelSource !== "string" ||
            !channelSource ||
            typeof proof.sourceId !== "string" ||
            !proof.sourceId
        )
            fail("policy_denied");
        var favorites = host.__ottFavoritesLibrary,
            media = host.__ottMedia;
        var tvTransfer = favorites && favorites.transfer,
            mediaTransfer = media && media.favoritesTransfer;
        var tv = typeof tvTransfer === "function" && tvTransfer.call(favorites);
        var journal =
            typeof mediaTransfer === "function" &&
            mediaTransfer.call(media, proof.sourceId);
        var tvKey = physical("favoritesLibrary:" + channelSource),
            mediaKey = physical("mediaJournal.v1:" + proof.sourceId),
            receiptKey = ports.receipts.physicalKey;
        if (
            !tv ||
            tv.sourceId !== channelSource ||
            !journal ||
            ![tvKey, mediaKey, receiptKey].every(
                (key) =>
                    typeof key === "string" &&
                    !!key &&
                    key.length <= 1024 &&
                    !/[\u0000-\u001f\u007f]/.test(key)
            ) ||
            tvKey === mediaKey ||
            receiptKey === tvKey ||
            receiptKey === mediaKey
        )
            fail("unsupported_persistence");
        var receiptPort = ports.receipts,
            ledger = receiptPort.service;
        function bindingCurrent(): boolean {
            var latest = ports.binding(expected);
            return (
                !!latest &&
                latest.revision === binding!.revision &&
                latest.current() &&
                binding!.current()
            );
        }
        function current(): boolean {
            try {
                return (
                    driver === host.__ottActiveProviderDriver &&
                    driver.favoritesSource === provenance &&
                    proof.current() &&
                    bindingCurrent() &&
                    host.ottpStorage === storage &&
                    host.stbGetItem === get &&
                    host.stbSetItem === set &&
                    host.stbDelItem === del &&
                    storage.get === get &&
                    storage.set === set &&
                    storage.del === del &&
                    host.stbGetPersistedItem === persisted &&
                    host.p_pref === prefix &&
                    driver.storageKey === keyFunction &&
                    physical("favoritesLibrary:" + channelSource) === tvKey &&
                    physical("mediaJournal.v1:" + proof.sourceId) ===
                        mediaKey &&
                    host.__ottSourceIdentity === identity &&
                    identity.current(host) === channelSource &&
                    host.__ottFavoritesLibrary === favorites &&
                    favorites.transfer === tvTransfer &&
                    tv.current() &&
                    host.__ottMedia === media &&
                    media.favoritesTransfer === mediaTransfer &&
                    journal.current() &&
                    host.sFavorites !== -1 &&
                    ports.receipts === receiptPort &&
                    receiptPort.service === ledger &&
                    receiptPort.physicalKey === receiptKey &&
                    receiptPort.current() &&
                    !(
                        storage.localPlayback && storage.localPlayback.active()
                    ) &&
                    proof.current() &&
                    driver === host.__ottActiveProviderDriver &&
                    host.stbGetItem === get &&
                    host.stbSetItem === set &&
                    host.stbDelItem === del
                );
            } catch (_) {
                return false;
            }
        }
        function read(key: string): string {
            var raw = get(key);
            if (
                !current() ||
                typeof raw !== "string" ||
                ports.utf8(raw).length > 1048576 ||
                persisted(key) !== raw ||
                !current()
            )
                fail("unsupported_persistence");
            return raw;
        }
        if (!current()) fail("binding_changed");
        var tvRaw = read(tvKey),
            mediaRaw = read(mediaKey),
            tvValue: any,
            mediaValue: any;
        try {
            tvValue = JSON.parse(tvRaw);
            mediaValue = JSON.parse(mediaRaw);
        } catch (_) {
            return fail("storage_unavailable");
        }
        if (
            !same(tv.snapshot(), tvValue) ||
            !same(JSON.parse(journal.snapshot()), mediaValue) ||
            !current()
        )
            fail("revision_conflict");
        if (
            tvValue.version !== 2 ||
            tvValue.sourceId !== channelSource ||
            mediaValue.version !== 1 ||
            mediaValue.sourceId !== proof.sourceId
        )
            fail("binding_changed");
        return {
            binding,
            channelSource,
            current,
            get,
            journal,
            ledger,
            mediaKey,
            mediaRaw,
            mediaValue,
            persisted,
            proof,
            receiptKey,
            scope: copy(expected),
            set,
            tv,
            tvKey,
            tvRaw,
            tvValue,
        };
    }
    function check(owner: any, current: () => boolean) {
        if (!owner.current() || !current()) fail("binding_changed");
    }
    function canonical(value: any): string {
        if (value === null || typeof value !== "object")
            return JSON.stringify(value);
        if (Array.isArray(value))
            return "[" + value.map(canonical).join(",") + "]";
        return (
            "{" +
            Object.keys(value)
                .sort()
                .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
                .join(",") +
            "}"
        );
    }
    async function revision(
        owner: any,
        tv: any = owner.tvValue,
        media: any = owner.mediaValue
    ) {
        if (typeof tv === "string") tv = JSON.parse(tv);
        if (typeof media === "string") media = JSON.parse(media);
        // Hash the complete portable favorites projection, not history, expiring
        // transport fields or resume positions. Raw before-hashes still fence writes.
        var bytes = ports.document.snapshot(owner.scope, tv, media);
        return digest(
            canonical(ports.document.decode(bytes, owner.scope).document)
        );
    }
    function verifiedRaw(
        owner: any,
        key: string,
        expected: string | null
    ): boolean {
        try {
            return (
                owner.current() &&
                owner.get(key) === expected &&
                owner.current() &&
                owner.persisted(key) === expected &&
                owner.current()
            );
        } catch (_) {
            return false;
        }
    }
    function result(state: string, states: string[], extra?: any) {
        return Object.assign(
            {
                outcome: state,
                per_store: [tvId, mediaId, receiptId].map((id, at) => ({
                    id,
                    outcome: states[at],
                })),
                persistence: "persistent" as const,
            },
            extra
        );
    }
    return {
        apply: async function (
            plan: any,
            context: any,
            current: () => boolean
        ) {
            var admitted = provisional,
                prepared = admitted && admitted.preview;
            if (
                !admitted ||
                admitted.context.operation_id !== context.operation_id ||
                admissions[context.operation_id] ||
                admitted.started ||
                !prepared ||
                !admitted.current() ||
                !same(admitted.scope, context.scope)
            )
                fail("reconciliation_required");
            var owner = prepared.owner;
            if (
                !plan.ready ||
                !same(plan.writePlan, prepared.writePlan) ||
                !same(plan.stores, prepared.stores) ||
                !same(plan.counts, prepared.counts) ||
                !same(context.counts, prepared.counts) ||
                context.document_sha256 !== admitted.context.document_sha256 ||
                (await digest(context.bytes)) !== context.document_sha256 ||
                !/^[a-f0-9]{64}$/.test(context.plan_digest)
            )
                fail("revision_conflict");
            check(owner, current);
            owner.ledger.verifyReservation(prepared.reservation);
            if (
                !verifiedRaw(
                    owner,
                    owner.receiptKey,
                    prepared.reservation.beforeRaw
                ) ||
                !verifiedRaw(owner, owner.tvKey, owner.tvRaw) ||
                !verifiedRaw(owner, owner.mediaKey, owner.mediaRaw)
            )
                fail("revision_conflict");
            var descriptor = owner.ledger.materializeCompletion(
                prepared.completion,
                context.plan_digest
            );
            if (
                descriptor.beforeRaw !== prepared.completion.beforeRaw ||
                descriptor.operationId !== context.operation_id
            )
                fail("revision_conflict");
            check(owner, current);
            if (Object.keys(admissions).length >= 16) fail("limits_exceeded");
            admitted.started = true;
            admissions[context.operation_id] = admitted;
            if (provisional === admitted) provisional = null;
            var states = ["not_applied", "not_applied", "unknown"];
            try {
                admitted.ticket = owner.ledger.commitReservation(
                    prepared.reservation
                );
                owner.ledger.verifyPending(admitted.ticket);
            } catch (_) {
                return result("unknown", states);
            }
            states[2] = "partial";
            var keys = [owner.tvKey, owner.mediaKey],
                before = [owner.tvRaw, owner.mediaRaw],
                after = [prepared.tvAfter, prepared.mediaAfter];
            for (var at = 0; at < 2; at++) {
                if (
                    !owner.current() ||
                    !current() ||
                    !verifiedRaw(owner, keys[at], before[at])
                )
                    return result("unknown", states);
                try {
                    owner.set(keys[at], after[at]);
                } catch (_) {
                    /* classify persisted bytes, never replay */
                }
                if (verifiedRaw(owner, keys[at], after[at]))
                    states[at] = "verified";
                else if (verifiedRaw(owner, keys[at], before[at]))
                    return result("partial", states, {
                        evidence_complete: true,
                    });
                else {
                    states[at] = "unknown";
                    return result(at ? "partial" : "unknown", states);
                }
            }
            if (
                !owner.current() ||
                !current() ||
                !owner.tv.adopt(prepared.tvLogical || prepared.tvAfter) ||
                !owner.current() ||
                !current() ||
                !owner.journal.adopt(
                    prepared.mediaLogical || prepared.mediaAfter
                ) ||
                !owner.current() ||
                !current()
            )
                return result("partial", states);
            var completed;
            try {
                completed = owner.ledger.commitCompletion(descriptor);
            } catch (_) {
                states[2] = "unknown";
                return result("unknown", states);
            }
            if (
                !completed ||
                completed.state !== "verified" ||
                !verifiedRaw(owner, owner.receiptKey, descriptor.afterRaw) ||
                !verifiedRaw(owner, owner.tvKey, prepared.tvAfter) ||
                !verifiedRaw(owner, owner.mediaKey, prepared.mediaAfter) ||
                !current()
            ) {
                states[2] = "unknown";
                return result("unknown", states);
            }
            var stored = owner.ledger.status(context.operation_id),
                receipt = stored && stored.receipt;
            if (
                !receipt ||
                receipt.plan_digest !== context.plan_digest ||
                receipt.document_sha256 !== context.document_sha256 ||
                receipt.new_revision !== prepared.nextRevision ||
                !same(receipt.counts, prepared.counts) ||
                !same(receipt.scope, context.scope) ||
                receipt.outcome !== "verified" ||
                receipt.persistence !== "persistent"
            ) {
                states[2] = "unknown";
                return result("unknown", states);
            }
            states[2] = "verified";
            // Persisted final receipt retains replay protection; only uncertain or
            // still-pending operations need an active in-memory admission slot.
            if (admissions[context.operation_id] === admitted)
                delete admissions[context.operation_id];
            return result("verified", states, {
                evidence_complete: true,
                receipt,
                receipt_verified: true,
            });
        },
        inspect: async function (
            expected: any,
            operationId?: string,
            context?: any
        ) {
            var owner = capture(expected),
                base = await revision(owner);
            check(owner, () => true);
            var admitted: any = null;
            if (operationId) {
                if (
                    !context ||
                    context.operation_id !== operationId ||
                    !/^[a-f0-9]{64}$/.test(context.document_sha256) ||
                    admissions[operationId]
                )
                    fail("reconciliation_required");
                if (
                    provisional &&
                    provisional.context.operation_id === operationId
                ) {
                    admitted = provisional;
                    if (
                        admitted.started ||
                        !same(admitted.context, context) ||
                        !same(admitted.scope, expected) ||
                        !admitted.current()
                    )
                        fail("reconciliation_required");
                    owner.ledger.verifyReservation(admitted.reservation);
                } else {
                    var authority =
                        ports.admitOperation &&
                        ports.admitOperation(expected, operationId, context);
                    if (!authority || authority.operationFresh !== true)
                        fail("reconciliation_required");
                    if (
                        authority.budgetAccepted !== true ||
                        Object.keys(admissions).length >= 16
                    )
                        fail("limits_exceeded");
                    check(owner, () => true);
                    var reservation = owner.ledger.prepareReservation(
                        {
                            operationId,
                            payloadHash: context.document_sha256,
                            refs: {
                                runtimeId: context.runtime,
                                stageId: context.transaction_id,
                            },
                            scope: copy(expected),
                        },
                        { freshAdmission: true }
                    );
                    owner.ledger.verifyReservation(reservation);
                    admitted = provisional = {
                        base,
                        binding: owner.binding!.revision,
                        context: copy(context),
                        current: owner.current,
                        reservation,
                        scope: copy(expected),
                        started: false,
                    };
                }
            }
            check(owner, () => true);
            return {
                binding_revision: owner.binding!.revision,
                budgetAccepted: !!admitted,
                current: owner.admissionCurrent || owner.current,
                operation_id: operationId,
                operationFresh: !!admitted,
                persistence: "persistent" as const,
                provisional: admitted,
                revision: base,
            };
        },
        preview: async function (
            bytes: Uint8Array,
            expected: any,
            admission: any,
            current: () => boolean
        ) {
            var admitted = admission.provisional,
                owner = capture(expected),
                base = await revision(owner);
            if (
                !admitted ||
                admitted !== provisional ||
                admitted.started ||
                !admitted.current()
            )
                fail("reconciliation_required");
            if (
                base !== admission.revision ||
                base !== admitted.base ||
                owner.binding!.revision !== admission.binding_revision
            )
                fail("revision_conflict");
            if ((await digest(bytes)) !== admitted.context.document_sha256)
                fail("hash_mismatch");
            check(owner, current);
            owner.ledger.verifyReservation(admitted.reservation);
            var prepared = ports.document.prepare(
                    bytes,
                    expected,
                    owner.mediaValue
                ),
                parsed = ports.document.decode(bytes, expected);
            var receiptBefore = owner.get(owner.receiptKey);
            if (receiptBefore !== owner.persisted(owner.receiptKey))
                fail("unsupported_persistence");
            var receiptRevision = await digest(
                JSON.stringify({ value: receiptBefore })
            );
            var stores = [
                {
                    expected_revision: await digest(
                        owner.physicalHash
                            ? owner.physicalHash(owner.tvRaw)
                            : owner.tvRaw
                    ),
                    id: tvId,
                },
                {
                    expected_revision: await digest(
                        owner.physicalHash
                            ? owner.physicalHash(owner.mediaRaw)
                            : owner.mediaRaw
                    ),
                    id: mediaId,
                },
                { expected_revision: receiptRevision, id: receiptId },
            ];
            check(owner, current);
            if (!prepared.ready)
                return {
                    base_revision: base,
                    binding_revision: admission.binding_revision,
                    counts: prepared.counts,
                    coverage: parsed.document.coverage,
                    persistence: "persistent" as const,
                    ready: false,
                    stores,
                    unresolved: prepared.unresolved,
                    writePlan: {},
                };
            var tvLogical = JSON.stringify(prepared.tv),
                mediaLogical = JSON.stringify(prepared.media),
                nextRevision = await revision(owner, tvLogical, mediaLogical),
                tvAfter = owner.encodePhysical
                    ? owner.encodePhysical(tvLogical)
                    : tvLogical,
                mediaAfter = owner.encodePhysical
                    ? owner.encodePhysical(mediaLogical)
                    : mediaLogical;
            var reservation = owner.ledger.prepareReservation(
                {
                    operationId: admitted.context.operation_id,
                    payloadHash: admitted.context.document_sha256,
                    refs: {
                        runtimeId: admitted.context.runtime,
                        stageId: admitted.context.transaction_id,
                    },
                    scope: copy(expected),
                },
                { freshAdmission: true },
                {
                    counts: prepared.counts,
                    meta: { appliedStores: 3, code: "none", totalStores: 3 },
                    newRevision: nextRevision,
                    persistence: "persistent" as const,
                    state: "verified",
                }
            );
            var completion = reservation.completion;
            if (
                reservation.beforeRaw !== receiptBefore ||
                completion.beforeRaw !== reservation.pendingRaw ||
                !verifiedRaw(owner, owner.receiptKey, receiptBefore)
            )
                fail("revision_conflict");
            var targets = [
                {
                    after_sha256: await digest(
                        owner.physicalHash
                            ? owner.physicalHash(tvAfter)
                            : tvAfter
                    ),
                    before_sha256: stores[0].expected_revision,
                    id: tvId,
                    physical_key: owner.tvKey,
                },
                {
                    after_sha256: await digest(
                        owner.physicalHash
                            ? owner.physicalHash(mediaAfter)
                            : mediaAfter
                    ),
                    before_sha256: stores[1].expected_revision,
                    id: mediaId,
                    physical_key: owner.mediaKey,
                },
            ];
            var writePlan = {
                receipt: {
                    after_template: copy(completion.afterTemplate),
                    before_sha256: receiptRevision,
                    id: receiptId,
                    pending_sha256: await digest(reservation.pendingRaw),
                    physical_key: owner.receiptKey,
                },
                targets,
            };
            check(owner, current);
            admitted.reservation = reservation;
            admitted.preview = {
                completion,
                counts: copy(prepared.counts),
                mediaAfter,
                mediaLogical,
                nextRevision,
                owner,
                reservation,
                stores: copy(stores),
                tvAfter,
                tvLogical,
                writePlan: copy(writePlan),
            };
            return {
                base_revision: base,
                binding_revision: admission.binding_revision,
                counts: prepared.counts,
                coverage: parsed.document.coverage,
                persistence: "persistent" as const,
                ready: true,
                stores,
                unresolved: [],
                writePlan,
            };
        },
        snapshot: async function (expected: any, current: () => boolean) {
            var owner = capture(expected),
                base = await revision(owner);
            check(owner, current);
            var bytes = ports.document.snapshot(
                expected,
                owner.tvValue,
                owner.mediaValue
            );
            ports.document.decode(bytes, expected);
            check(owner, current);
            return {
                binding_revision: owner.binding!.revision,
                bytes,
                revision: base,
            };
        },
        status: async function (operationId: string, current: () => boolean) {
            // Fresh read-only authorization never revives the old runtime/stage's write ticket.
            var receipts: any = ports.receipts,
                storage = host.ottpStorage,
                get = host.stbGetItem,
                persisted = host.stbGetPersistedItem;
            if (
                !receipts ||
                typeof receipts.factory !== "function" ||
                !receipts.current() ||
                !storage ||
                get !== storage.get ||
                host.stbSetItem !== storage.set ||
                host.stbDelItem !== storage.del ||
                typeof persisted !== "function"
            )
                return null;
            var owner: any = null;
            function granted() {
                return (
                    current() &&
                    ports.receipts === receipts &&
                    receipts.current() &&
                    host.ottpStorage === storage &&
                    host.stbGetItem === get &&
                    storage.get === get &&
                    host.stbGetPersistedItem === persisted &&
                    (!owner || owner.current())
                );
            }
            var reader = receipts.factory({
                compareAndSwap: () => fail("policy_denied"),
                current: (expected: any) => {
                    try {
                        owner = capture(expected);
                        return granted() && owner.current();
                    } catch (_) {
                        return false;
                    }
                },
                now: ports.now,
                persistedRead: () =>
                    granted()
                        ? persisted(receipts.physicalKey)
                        : fail("binding_changed"),
                read: () =>
                    granted()
                        ? get(receipts.physicalKey)
                        : fail("binding_changed"),
            });
            var stored, receiptRaw;
            try {
                receiptRaw = get(receipts.physicalKey);
                if (
                    !granted() ||
                    persisted(receipts.physicalKey) !== receiptRaw
                )
                    return result("unknown", ["unknown", "unknown", "unknown"]);
                stored = reader.status(operationId);
            } catch (_) {
                return result("unknown", ["unknown", "unknown", "unknown"]);
            }
            if (
                !stored ||
                stored.state !== "verified" ||
                !stored.receipt ||
                !owner ||
                !granted()
            )
                return null;
            var receipt = stored.receipt,
                actual = await revision(owner);
            if (
                !granted() ||
                !verifiedRaw(owner, owner.tvKey, owner.tvRaw) ||
                !verifiedRaw(owner, owner.mediaKey, owner.mediaRaw) ||
                !verifiedRaw(owner, owner.receiptKey, receiptRaw)
            )
                return result("unknown", ["unknown", "unknown", "unknown"]);
            if (
                actual !== receipt.new_revision ||
                receipt.outcome !== "verified" ||
                receipt.persistence !== "persistent"
            )
                return result("unknown", ["unknown", "unknown", "verified"]);
            return result("verified", ["verified", "verified", "verified"], {
                evidence_complete: true,
                receipt,
                receipt_verified: true,
            });
        },
    };
}
