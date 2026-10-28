// Native Stage B uses the actual engine, receipt service, codec, dispatcher and physical factory.
// Its tiny adapter represents synthetic Favorites targets only; no Plex server or user data is contacted.
window.installNativeRecovery = async function (runtime) {
    const load = window.nativeFixtureLoad;
    const key = "favorites-receipts.v1";
    const utf8 = (text) => new TextEncoder().encode(text);
    const sha256 = async (value) =>
        Array.from(
            new Uint8Array(
                await crypto.subtle.digest(
                    "SHA-256",
                    typeof value === "string" ? utf8(value) : value
                )
            )
        )
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
    const grant = window.nativeStorageFacade.capture();
    const reader = window.nativeStorageFacade.reader();
    if (!grant || !reader) throw Error("Actual native backend unavailable");
    const codec = load("favorites-recovery-codec").createFavoritesRecoveryCodec(
        { sha256 }
    );
    const backendProof = await codec.backendProof(grant);
    const fence = { backendProof, guardImplementationVersion: 1, version: 2 };
    let writerActive = false;
    const receipts = load(
        "favorites-operation-receipts"
    ).createFavoritesOperationReceipts({
        compareAndSwap: (before, after) =>
            grant.compareAndSwap(
                key,
                before,
                after,
                () => writerActive && grant.current()
            ),
        current: () => grant.current(),
        fence: () => fence,
        now: () => Date.now(),
        persistedRead: () => window.stbGetPersistedItem(key),
        read: () => window.nativeStorageFacade.raw(key),
        writeGuard: (value) =>
            writerActive &&
            grant.current() &&
            JSON.stringify(value) === JSON.stringify(fence),
    });
    const dispatcher = load(
        "favorites-recovery"
    ).createFavoritesRecoveryDispatcher({
        current: () => grant.current(),
        host: { physicalStorage: () => grant, recoveryStorage: () => reader },
        now: () => Date.now(),
        runtime: () => runtime,
        sha256,
        utf8,
    });
    const scope = {
        profileBindingId: "00000000-0000-4000-8000-000000000010",
        provider: "plex",
        sourceBindingId: "00000000-0000-4000-8000-000000000011",
    };
    const state = { entered: false, rpcResult: null, settled: false };
    const ack = (view, operationId) => ({
        accept_unknown: true,
        acknowledgement_id: view.acknowledgementId,
        after_ledger_sha256: view.afterLedgerSha256,
        backend_proof: backendProof,
        expected_ledger_revision: view.ledgerRevision,
        mode: "acknowledge",
        operation_id: operationId,
        original_entry_sha256: view.record.original_entry_sha256,
        plan_sha256: view.planDigest,
        reason: "accept-unknown-no-replay",
        scope: view.record.scope,
    });
    const engine = load("favorites-transfer").createFavoritesTransfer({
        adapter: {
            apply: (_plan, context) =>
                grant.exclusive(async () => {
                    state.ownedBytes = context.bytes;
                    state.documentHash = context.document_sha256;
                    writerActive = true;
                    try {
                        state.ticket = receipts.reserve(
                            {
                                operationId: context.operation_id,
                                payloadHash: context.document_sha256,
                                refs: {
                                    runtimeId: runtime,
                                    stageId: context.transaction_id,
                                },
                                scope,
                            },
                            { freshAdmission: true }
                        );
                        const view = await codec.inspect(reader.read(key), {
                            backendProof,
                            operationId: context.operation_id,
                            runtime: "native-observer",
                        });
                        state.heldAck = ack(view, context.operation_id);
                        state.entered = true;
                        await new Promise((resolve) => {
                            state.release = resolve;
                        });
                        return {
                            outcome: "unknown",
                            per_store: [],
                            persistence: "persistent",
                        };
                    } finally {
                        writerActive = false;
                        state.settled = true;
                    }
                }),
            inspect: async () => ({
                binding_revision: "bindings-before",
                budgetAccepted: true,
                current: () => grant.current(),
                operationFresh: true,
                persistence: "persistent",
                revision: "favorites-before",
            }),
            preview: async () => ({
                base_revision: "favorites-before",
                binding_revision: "bindings-before",
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
                stores: [
                    { expected_revision: "store-before", id: "favorites" },
                ],
                unresolved: [],
                writePlan: [
                    {
                        after: "a".repeat(64),
                        before: "b".repeat(64),
                        id: "favorites",
                    },
                ],
            }),
            status: async () => null,
        },
        base64Decode: (text) =>
            Uint8Array.from(atob(text), (char) => char.charCodeAt(0)),
        base64Encode: (bytes) => btoa(String.fromCharCode(...bytes)),
        clearTimer: (id) => window.clearTimeout(id),
        codec: {
            validate: (bytes) => {
                const value = JSON.parse(new TextDecoder().decode(bytes));
                if (value.synthetic !== true)
                    throw Error("Invalid fixture document");
            },
        },
        now: () => Date.now(),
        runtime: () => runtime,
        setTimer: (callback, milliseconds) =>
            window.setTimeout(callback, milliseconds),
        sha256,
        utf8,
        uuid: () => crypto.randomUUID(),
    });
    function transport(params, milliseconds) {
        const deadlineAt = Date.now() + milliseconds;
        return {
            deadlineAt,
            envelope: {
                action: "favorites_transfer",
                expires_at: deadlineAt / 1000,
                id: "native-fixture",
                params,
            },
            runtime,
        };
    }
    async function send(params, milliseconds = 5000) {
        return engine.execute(params, transport(params, milliseconds));
    }
    async function execute(params) {
        const request = { op: "recovery", runtime, ...params };
        try {
            const result = await dispatcher.execute(
                request,
                () => grant.current(),
                Date.now() + 5000
            );
            if (
                !load("favorites-recovery").validFavoritesRecoveryResponse(
                    result,
                    request
                )
            )
                throw Error("Invalid actual recovery response");
            return result;
        } catch (error) {
            return { error: error.message };
        }
    }
    const api = {
        async bytesPreserved() {
            return (
                !!state.ownedBytes &&
                (await sha256(new TextDecoder().decode(state.ownedBytes))) ===
                    state.documentHash
            );
        },
        execute,
        async freshAck(operationId) {
            const inspected = await execute({
                mode: "inspect",
                operation_id: operationId,
            });
            if (!inspected.acknowledge_allowed)
                throw Error(
                    "Fresh inspect did not allow one ACK: " +
                        JSON.stringify(inspected)
                );
            const params = {
                accept_unknown: true,
                acknowledgement_id: inspected.acknowledgement_id,
                after_ledger_sha256: inspected.after_ledger_sha256,
                backend_proof: inspected.backend_proof,
                expected_ledger_revision: inspected.ledger_revision,
                mode: "acknowledge",
                operation_id: operationId,
                original_entry_sha256: inspected.record.original_entry_sha256,
                plan_sha256: inspected.plan_sha256,
                reason: "accept-unknown-no-replay",
                scope: inspected.record.scope,
            };
            const result = await execute(params);
            const observed = await execute({
                mode: "inspect",
                operation_id: operationId,
            });
            return { inspected, observed, result };
        },
        raw: () => reader.read(key),
        release() {
            state.release();
            return true;
        },
        reserveOnly(operationId) {
            state.entered = false;
            state.settled = false;
            state.closedRealmWork = grant.exclusive(async () => {
                writerActive = true;
                try {
                    receipts.reserve(
                        {
                            operationId,
                            payloadHash: await sha256("closed-native-writer"),
                            refs: { runtimeId: runtime, stageId: operationId },
                            scope,
                        },
                        { freshAdmission: true }
                    );
                    state.entered = true;
                    await new Promise((resolve) => {
                        state.release = resolve;
                    });
                } finally {
                    writerActive = false;
                    state.settled = true;
                }
            });
            return true;
        },
        async start(operationId) {
            state.entered = false;
            state.settled = false;
            state.rpcResult = null;
            const bytes = utf8(JSON.stringify({ scope, synthetic: true }));
            const documentHash = await sha256(new TextDecoder().decode(bytes));
            const begin = await send({
                binding_revision: "bindings-before",
                chunk_count: 1,
                document_sha256: documentHash,
                expected_revision: "favorites-before",
                op: "begin",
                operation_id: operationId,
                persistence: "persistent",
                runtime,
                scope,
                size_bytes: bytes.length,
            });
            if (begin.error) throw Error("Actual begin failed: " + begin.error);
            const transaction_id = begin.transaction_id;
            const appended = await send({
                chunk_sha256: documentHash,
                data_base64: btoa(String.fromCharCode(...bytes)),
                offset: 0,
                op: "append",
                runtime,
                seq: 0,
                transaction_id,
            });
            if (appended.error)
                throw Error("Actual append failed: " + appended.error);
            const preview = await send({
                op: "preview",
                runtime,
                transaction_id,
            });
            if (preview.error || !preview.plan_digest)
                throw Error("Actual preview failed: " + preview.error);
            state.pending = send(
                {
                    expected_revision: "favorites-before",
                    op: "commit",
                    operation_id: operationId,
                    plan_digest: preview.plan_digest,
                    runtime,
                    transaction_id,
                },
                1500
            ).then((result) => {
                state.rpcResult = result;
                return result;
            });
            return true;
        },
        state,
    };
    Object.defineProperty(window, "nativeRecovery", { value: api });
    return { backendProof, initialRaw: reader.read(key), runtime };
};
