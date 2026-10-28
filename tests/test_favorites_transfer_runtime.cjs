"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const clone = (value) => JSON.parse(JSON.stringify(value));
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const scope = {
    profileBindingId: "11111111-1111-4111-8111-111111111111",
    provider: "plex",
    sourceBindingId: "22222222-2222-4222-8222-222222222222",
};
const packet = JSON.parse(
    fs.readFileSync(
        path.join(root, "docs/design/favorites-current-plex-protocol-v1.json"),
        "utf8"
    )
);
const compiled = new Map();
function compile(file) {
    if (!compiled.has(file)) {
        const source = ts.transpileModule(
            fs.readFileSync(path.join(root, file), "utf8"),
            {
                compilerOptions: {
                    module: ts.ModuleKind.CommonJS,
                    target: ts.ScriptTarget.ES5,
                },
            }
        ).outputText;
        require("acorn").parse(source, { ecmaVersion: 5 });
        compiled.set(file, source);
    }
    return compiled.get(file);
}
const flush = async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
};
function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, reject, resolve };
}
function fixture(options = {}) {
    let now = 1000000,
        timerID = 0,
        requestID = 0,
        epoch = 0;
    const timers = new Map();
    const state = {
        applies: 0,
        applyHook: null,
        binding: "8",
        captureHook: null,
        digestHook: null,
        evidence: null,
        inspectHook: null,
        inspections: 0,
        lastApply: null,
        owned: true,
        previewHook: null,
        qualified: true,
        revision: "favorites-20",
        runtime: "runtime-1",
        statusHook: null,
        transportCurrent: true,
    };
    const document = { favorites: ["synthetic"], schema: 1, scope };
    if (options.documentBytes) {
        document.padding = "";
        document.padding = "x".repeat(
            options.documentBytes - Buffer.byteLength(JSON.stringify(document))
        );
    }
    const bytes = Buffer.from(JSON.stringify(document));
    const owned = () => {
        const captured = epoch;
        return () => state.owned && epoch === captured;
    };
    const counts = {
        channelLists: 1,
        channelMemberships: 0,
        mediaFavorites: 1,
        unresolved: 0,
    };
    const w = {
        atob: (text) => Buffer.from(text, "base64").toString("binary"),
        btoa: (text) => Buffer.from(text, "binary").toString("base64"),
        clearTimeout(id) {
            timers.delete(id);
        },
        crypto: {
            getRandomValues: (value) => crypto.randomFillSync(value),
            subtle: {
                async digest(_algorithm, value) {
                    if (state.digestHook) return state.digestHook(value);
                    return new Uint8Array(
                        crypto.createHash("sha256").update(value).digest()
                    ).buffer;
                },
            },
        },
        setTimeout(callback, milliseconds) {
            const id = ++timerID;
            timers.set(id, { callback, due: now + milliseconds });
            return id;
        },
    };
    function verified(receipt) {
        return {
            evidence_complete: true,
            outcome: "verified",
            per_store: [{ id: "plex-media-favorites", outcome: "verified" }],
            persistence: "persistent",
            receipt: {
                counts: receipt.counts,
                document_sha256: receipt.document_sha256,
                new_revision: "favorites-21",
                operation_id: receipt.operation_id,
                outcome: "verified",
                persistence: "persistent",
                plan_digest: receipt.plan_digest,
                scope: receipt.scope,
            },
            receipt_verified: true,
        };
    }
    const host = {
        captureContext: () => {
            if (state.captureHook) state.captureHook();
            return { current: owned() };
        },
        catalog: () => ({
            binding_revision: state.binding,
            bindings: [{ scope, target_id: "plex-test" }],
        }),
        createAdapter(admit) {
            return {
                async apply(_plan, receipt, current) {
                    state.applies++;
                    state.lastApply = { current, receipt };
                    if (state.applyHook)
                        return state.applyHook(receipt, current);
                    assert.equal(current(), true);
                    state.evidence = verified(receipt);
                    return state.evidence;
                },
                async inspect(expected, operationID, context) {
                    state.inspections++;
                    assert.deepEqual(clone(expected), scope);
                    if (state.inspectHook)
                        await state.inspectHook(expected, operationID, context);
                    const admission = operationID
                        ? admit(expected, operationID, context)
                        : {};
                    return {
                        ...admission,
                        binding_revision: state.binding,
                        current: owned(),
                        persistence: "persistent",
                        revision: state.revision,
                    };
                },
                async preview(_bytes, _scope, _admission, current) {
                    if (state.previewHook) await state.previewHook(current);
                    return {
                        base_revision: state.revision,
                        binding_revision: state.binding,
                        counts,
                        coverage: {
                            channelLists: "complete-for-scope",
                            history: "excluded-preserved",
                            mediaFavorites: "complete-for-scope",
                            remoteAliases: "excluded-preserved",
                        },
                        persistence: "persistent",
                        ready: true,
                        stores: [
                            {
                                expected_revision: "store-3",
                                id: "plex-media-favorites",
                            },
                        ],
                        unresolved: [],
                        writePlan: [
                            {
                                after: hash(bytes),
                                before: hash("before"),
                                id: "plex-media-favorites",
                            },
                        ],
                    };
                },
                async snapshot(_expected, current) {
                    assert.equal(current(), true);
                    return {
                        binding_revision: state.binding,
                        bytes: new Uint8Array(bytes),
                        revision: state.revision,
                    };
                },
                async status(operationID, current) {
                    if (state.statusHook)
                        return state.statusHook(operationID, current);
                    return state.evidence;
                },
            };
        },
        document: {
            validate(value, expected) {
                const parsed = JSON.parse(
                    new TextDecoder("utf-8", { fatal: true }).decode(value)
                );
                assert.deepEqual(parsed.scope, clone(expected));
            },
        },
        provision: () => {
            throw new Error("policy_denied");
        },
        qualified: () => state.qualified,
    };
    class FakeDate extends Date {
        static now() {
            return now;
        }
    }
    const context = vm.createContext({
        Date: FakeDate,
        Error,
        Promise,
        Uint8Array,
        window: w,
    });
    const modules = new Map();
    function load(file) {
        if (modules.has(file)) return modules.get(file);
        const exports = {};
        modules.set(file, exports);
        const requireLocal = (name) => {
            const resolved =
                path.posix.normalize(
                    path.posix.join(path.posix.dirname(file), name)
                ) + ".ts";
            if (resolved === "src/settings/favorites-current-plex-host.ts")
                return {
                    createFavoritesCurrentPlexHost: (_window, ports) => {
                        state.storage = ports.storage;
                        return host;
                    },
                };
            return load(resolved);
        };
        const wrapper = vm.runInContext(
            "(function(exports, require){" + compile(file) + "\n})",
            context
        );
        wrapper(exports, requireLocal);
        return exports;
    }
    const runtime = load(
        "src/plugins/favorites-transfer-runtime.ts"
    ).createFavoritesTransferRuntime(w, {
        runtime: () => state.runtime,
        storage: options.storage,
    });
    async function send(params, transport = {}) {
        params = { runtime: state.runtime, ...params };
        const deadlineAt = now + 60000;
        return clone(
            await runtime.execute(params, {
                current: () => state.transportCurrent,
                deadlineAt,
                envelope: {
                    action: "favorites_transfer",
                    expires_at: new Date(deadlineAt).toISOString(),
                    id: (++requestID).toString(16).padStart(32, "0"),
                    params: clone(params),
                },
                runtime: state.runtime,
                ...transport,
            })
        );
    }
    function prepareParams(overrides = {}) {
        return {
            binding_revision: state.binding,
            budget_ms: 300000,
            document_sha256: hash(bytes),
            expected_revision: state.revision,
            op: "prepare",
            scope,
            size_bytes: bytes.length,
            ...overrides,
        };
    }
    async function open(overrides = {}) {
        const admitted = await send(prepareParams(overrides));
        assert.equal(admitted.error, undefined, JSON.stringify(admitted));
        const begin = {
            binding_revision: state.binding,
            chunk_count: Math.ceil(bytes.length / 8192),
            document_sha256: hash(bytes),
            expected_revision: state.revision,
            op: "begin",
            operation_id: admitted.operation_id,
            persistence: "persistent",
            scope,
            size_bytes: bytes.length,
        };
        const opened = await send(begin);
        assert.equal(opened.error, undefined, JSON.stringify(opened));
        return {
            admitted,
            begin,
            opened,
            operation_id: admitted.operation_id,
            transaction_id: opened.transaction_id,
        };
    }
    async function append(stage) {
        for (
            let offset = 0, seq = 0;
            offset < bytes.length;
            offset += 8192, seq++
        ) {
            const part = bytes.subarray(offset, offset + 8192);
            const result = await send({
                chunk_sha256: hash(part),
                data_base64: part.toString("base64"),
                offset,
                op: "append",
                seq,
                transaction_id: stage.transaction_id,
            });
            assert.equal(result.error, undefined, JSON.stringify(result));
        }
    }
    async function ready() {
        const stage = await open();
        await append(stage);
        const plan = await send({
            op: "preview",
            transaction_id: stage.transaction_id,
        });
        assert.equal(plan.error, undefined, JSON.stringify(plan));
        return { ...stage, plan_digest: plan.plan_digest };
    }
    function commit(stage, transport) {
        return send(
            {
                expected_revision: state.revision,
                op: "commit",
                operation_id: stage.operation_id,
                plan_digest: stage.plan_digest,
                transaction_id: stage.transaction_id,
            },
            transport
        );
    }
    function advance(milliseconds) {
        const end = now + milliseconds;
        for (let i = 0; i < 1000; i++) {
            const next = [...timers]
                .filter(([, timer]) => timer.due <= end)
                .sort((a, b) => a[1].due - b[1].due)[0];
            if (!next) {
                now = end;
                return;
            }
            now = next[1].due;
            timers.delete(next[0]);
            next[1].callback();
        }
        throw new Error("timer loop");
    }
    return {
        advance,
        append,
        bytes,
        commit,
        invalidateOwner: () => {
            epoch++;
        },
        load,
        now: () => now,
        open,
        prepareParams,
        ready,
        runtime,
        send,
        state,
        timers,
        verified,
        w,
    };
}

test("capability is the exact frozen packet and is unavailable without crypto or qualified storage", async () => {
    const f = fixture();
    assert.deepEqual(
        clone(await f.runtime.capability()),
        packet.capability.favorites_transfer
    );
    assert.equal(f.timers.size, 0);
    f.state.qualified = false;
    assert.equal(await f.runtime.capability(), null);
    f.state.qualified = true;
    f.w.crypto = null;
    assert.equal(await f.runtime.capability(), null);
    f.runtime.dispose();
});

test("gateway passes main-owned storage helpers privately without invoking or publishing them", async () => {
    const forbidden = () =>
        assert.fail("gateway must not initialize storage or run compression");
    const storage = {
        compress: forbidden,
        decompress: forbidden,
        recoveryRequired: forbidden,
    };
    const f = fixture({ storage });
    assert.equal(f.state.storage, storage);
    assert.equal(Object.values(f.w).includes(storage), false);
    const capability = await f.runtime.capability();
    assert.deepEqual(clone(capability), packet.capability.favorites_transfer);
    assert.equal(
        JSON.stringify(capability).includes("recoveryRequired"),
        false
    );
    f.runtime.dispose();
});

test("one prepare grant, exact begin binding and rejected begin do not consume it", async () => {
    const f = fixture();
    const admitted = await f.send(f.prepareParams());
    assert.match(admitted.operation_id, /^[0-9a-f-]{36}$/);
    assert.equal((await f.send(f.prepareParams())).error, "busy");
    const begin = {
        ...f.prepareParams(),
        chunk_count: 1,
        op: "begin",
        operation_id: admitted.operation_id,
        persistence: "persistent",
    };
    delete begin.budget_ms;
    assert.equal(
        (await f.send({ ...begin, document_sha256: "a".repeat(64) })).error,
        "operation_conflict"
    );
    assert.equal(
        (await f.send({ ...begin, chunk_count: 0 })).error,
        "invalid_request"
    );
    const opened = await f.send(begin);
    assert.equal(opened.error, undefined);
    assert.equal((await f.send(begin)).transaction_id, opened.transaction_id);
    assert.equal(f.state.applies, 0);
    f.runtime.dispose();
    assert.equal(f.timers.size, 0);
});

test("snapshot and staged preview/abort never write; abort is stable and later grant has a fresh ID", async () => {
    const f = fixture();
    const snapshot = await f.send({ op: "snapshot", scope });
    assert.equal(snapshot.document_sha256, hash(f.bytes));
    assert.deepEqual(Buffer.from(snapshot.document_base64, "base64"), f.bytes);
    const stage = await f.ready();
    assert.equal(
        (await f.send({ op: "status", operation_id: stage.operation_id }))
            .state,
        "ready"
    );
    const aborted = await f.send({
        op: "abort",
        transaction_id: stage.transaction_id,
    });
    assert.equal(aborted.state, "aborted");
    assert.equal(aborted.outcome, "not_applied");
    assert.deepEqual(
        await f.send({ op: "abort", transaction_id: stage.transaction_id }),
        aborted
    );
    assert.equal(f.state.applies, 0);
    assert.equal(f.timers.size, 0);
    const next = await f.send(f.prepareParams());
    assert.notEqual(next.operation_id, stage.operation_id);
    f.runtime.dispose();
});

test("300-second operation budget survives original 60-second delivery TTL without renewal", async () => {
    const f = fixture();
    const start = f.now(),
        stage = await f.open();
    assert.equal(Date.parse(stage.opened.absolute_expires_at), start + 300000);
    f.advance(61000);
    await f.append(stage);
    f.advance(100000);
    assert.equal(
        (await f.send({ op: "status", operation_id: stage.operation_id }))
            .state,
        "receiving"
    );
    f.advance(100000);
    const plan = await f.send({
        op: "preview",
        transaction_id: stage.transaction_id,
    });
    assert.equal(plan.ready, true);
    f.advance(39000);
    const expired = await f.send({
        op: "status",
        operation_id: stage.operation_id,
    });
    assert.equal(expired.state, "expired");
    assert.equal(expired.outcome, "not_applied");
    assert.equal(f.state.applies, 0);
    f.runtime.dispose();
});

test("admission TTL expires an unused grant, while short whole budget cannot be extended", async () => {
    const f = fixture();
    const granted = await f.send(f.prepareParams({ budget_ms: 7000 }));
    assert.equal(granted.admission_ttl_ms, 7000);
    assert.equal(f.timers.size, 1);
    f.advance(7000);
    assert.equal(f.timers.size, 0);
    assert.equal(
        (
            await f.send({
                ...f.prepareParams(),
                op: "begin",
                operation_id: granted.operation_id,
            })
        ).error,
        "reconciliation_required"
    );
    assert.equal((await f.send(f.prepareParams())).error, undefined);
    f.runtime.dispose();
});

test("ownership, runtime and dispatch cancellation refuse staging and do not write", async () => {
    for (const mutate of [
        (f) => {
            f.state.transportCurrent = false;
        },
        (f) => {
            f.state.runtime = "runtime-2";
        },
        (f) => f.invalidateOwner(),
    ]) {
        const f = fixture(),
            stage = await f.ready();
        mutate(f);
        const result = await f.commit(stage);
        assert(result.error);
        assert.equal(f.state.applies, 0);
        f.runtime.dispose();
        assert.equal(f.timers.size, 0);
    }
});

test("prepare inspect is deadline-bounded and a late resolution cannot mint admission", async () => {
    const f = fixture(),
        pending = deferred();
    f.state.inspectHook = () => pending.promise;
    const request = f.send(f.prepareParams(), { deadlineAt: f.now() + 2500 });
    await flush();
    assert.equal(f.timers.size, 1);
    f.advance(2500);
    assert.equal((await request).error, "expired");
    pending.resolve();
    await flush();
    assert.equal(f.timers.size, 0);
    f.state.inspectHook = null;
    assert.equal((await f.send(f.prepareParams())).error, undefined);
    f.runtime.dispose();
});

test("verified commit has bound receipt and status; commit replay and late abort never apply again", async () => {
    const f = fixture(),
        stage = await f.ready();
    const result = await f.commit(stage);
    assert.equal(result.outcome, "verified");
    assert.equal(result.operation_id, stage.operation_id);
    assert.equal(result.document_sha256, hash(f.bytes));
    assert.equal(result.receipt.plan_digest, stage.plan_digest);
    assert.equal(result.receipt.operation_id, stage.operation_id);
    assert.equal(f.state.applies, 1);
    assert.equal((await f.commit(stage)).error, "transaction_not_found");
    assert.equal(
        (await f.send({ op: "abort", transaction_id: stage.transaction_id }))
            .error,
        "reconciliation_required"
    );
    assert.equal(
        (await f.send({ op: "status", operation_id: stage.operation_id }))
            .outcome,
        "verified"
    );
    assert.equal(f.state.applies, 1);
    assert.equal(f.timers.size, 0);
    f.runtime.dispose();
});

test("uncertain commit owns its pending apply, blocks grants and only verified status clears the fence", async () => {
    const f = fixture(),
        pending = deferred(),
        stage = await f.ready();
    f.state.applyHook = () => pending.promise;
    const request = f.commit(stage);
    await flush();
    assert.equal(f.state.applies, 1);
    assert.equal(
        (await f.send({ op: "abort", transaction_id: stage.transaction_id }))
            .error,
        "busy"
    );
    f.advance(120000);
    assert.equal((await request).outcome, "unknown");
    assert.equal((await f.send(f.prepareParams())).error, "busy");
    assert.equal(
        (await f.send({ op: "abort", transaction_id: stage.transaction_id }))
            .error,
        "reconciliation_required"
    );
    assert.equal(f.state.lastApply.current(), false);
    f.state.evidence = f.verified(f.state.lastApply.receipt);
    pending.resolve(f.state.evidence);
    await flush();
    assert.equal(
        (await f.send(f.prepareParams())).error,
        "reconciliation_required"
    );
    assert.equal(
        (await f.send({ op: "status", operation_id: stage.operation_id }))
            .outcome,
        "verified"
    );
    assert.equal((await f.send(f.prepareParams())).error, undefined);
    assert.equal(f.state.applies, 1);
    f.runtime.dispose();
});

test("unqualified stores retain read-only status reconciliation without admitting mutations", async () => {
    const f = fixture(),
        stage = await f.ready();
    let statusReads = 0;
    f.state.applyHook = () => {
        f.state.qualified = false;
        return {
            outcome: "unknown",
            per_store: [{ id: "plex-media-favorites", outcome: "unknown" }],
            persistence: "persistent",
        };
    };
    assert.equal((await f.commit(stage)).outcome, "unknown");
    f.state.statusHook = (operationID, current) => {
        statusReads++;
        assert.equal(operationID, stage.operation_id);
        assert.equal(current(), true);
        return f.state.evidence;
    };
    const pending = await f.send({
        op: "status",
        operation_id: stage.operation_id,
    });
    assert.equal(pending.error, undefined, JSON.stringify(pending));
    assert.equal(pending.outcome, "unknown");
    assert.equal(statusReads, 1);
    const inspections = f.state.inspections;
    for (const params of [
        f.prepareParams(),
        { op: "snapshot", scope },
        { op: "provision" },
    ])
        assert.equal((await f.send(params)).error, "unsupported_persistence");
    assert.equal(f.state.inspections, inspections);
    assert.equal(
        (await f.send({ op: "status", operation_id: "not-an-id" })).error,
        "invalid_request"
    );
    assert.equal(statusReads, 1);
    // Unknown evidence did not clear the write fence when qualification returns.
    f.state.qualified = true;
    assert.equal(
        (await f.send(f.prepareParams())).error,
        "reconciliation_required"
    );
    f.state.qualified = false;
    f.state.evidence = f.verified(f.state.lastApply.receipt);
    assert.equal(
        (await f.send({ op: "status", operation_id: stage.operation_id }))
            .outcome,
        "verified"
    );
    assert.equal(
        (await f.send(f.prepareParams())).error,
        "unsupported_persistence"
    );
    f.state.transportCurrent = false;
    assert.equal(
        (await f.send({ op: "status", operation_id: stage.operation_id }))
            .error,
        "expired"
    );
    assert.equal(statusReads, 2);
    f.state.transportCurrent = true;
    f.state.runtime = "runtime-2";
    assert.equal(
        (await f.send({ op: "status", operation_id: stage.operation_id }))
            .error,
        "expired"
    );
    assert.equal(statusReads, 2);
    assert.equal(f.state.applies, 1);
    f.runtime.dispose();
    assert.equal(f.timers.size, 0);
});

test("protected receipt denial during prepare preserves the frozen reconciliation error and creates no grant", async () => {
    const f = fixture();
    f.state.captureHook = () => {
        throw new Error("reconciliation_required");
    };
    const refused = await f.send(f.prepareParams());
    assert.deepEqual(refused, {
        error: "reconciliation_required",
        op: "prepare",
        runtime: "runtime-1",
        version: 1,
    });
    assert.equal(f.state.inspections, 0);
    assert.equal(f.state.applies, 0);
    assert.equal(f.timers.size, 0);
    f.state.captureHook = null;
    assert.equal((await f.send(f.prepareParams())).error, undefined);
    f.runtime.dispose();
});

test("exact 1-MiB document snapshot fits its distinct 2-MiB wire response budget", async () => {
    const f = fixture({ documentBytes: 1048576 });
    assert.equal(f.bytes.length, 1048576);
    const result = await f.send({ op: "snapshot", scope });
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.equal(result.size_bytes, 1048576);
    assert.deepEqual(Buffer.from(result.document_base64, "base64"), f.bytes);
    assert(Buffer.byteLength(JSON.stringify(result)) < 2097152);
    assert.throws(
        () =>
            f
                .load("src/commands/favorites-document-json.ts")
                .utf8Encode("x".repeat(1048577)),
        /codec_error/
    );
    f.runtime.dispose();
});

test("explicit wire UTF-8 allowance remains bounded in bytes and never weakens the document default", () => {
    const f = fixture(),
        encode = f.load("src/commands/favorites-document-json.ts").utf8Encode;
    assert.equal(encode("é".repeat(1048576), 2097152).length, 2097152);
    assert.throws(
        () => encode("é".repeat(1048576) + "a", 2097152),
        /codec_error/
    );
    assert.throws(() => encode("é".repeat(524288) + "a"), /codec_error/);
    for (const cap of [0, -1, 0.5, Infinity, NaN, 2097153, true])
        assert.throws(() => encode("small", cap), /codec_error/);
    f.runtime.dispose();
});

test("dispose settles pending prepare and capability waits and clears all gateway timers", async () => {
    for (const operation of ["prepare", "capability"]) {
        const f = fixture(),
            pending = deferred();
        if (operation === "prepare")
            f.state.inspectHook = () => pending.promise;
        else f.state.digestHook = () => pending.promise;
        const request =
            operation === "prepare"
                ? f.send(f.prepareParams())
                : f.runtime.capability();
        await flush();
        assert.equal(f.timers.size, 1);
        f.runtime.dispose();
        assert.equal(f.timers.size, 0, operation);
        const result = await request;
        if (operation === "prepare") assert.equal(result.error, "expired");
        else assert.equal(result, null);
        pending.resolve(new Uint8Array(32).buffer);
        await flush();
        assert.equal(f.timers.size, 0);
        assert.equal(f.state.applies, 0);
    }
});

test("dispose cancels foundation waits and fences a still-settling commit without discarding its bytes", async () => {
    for (const operation of ["snapshot", "preview", "commit"]) {
        const f = fixture(),
            pending = deferred();
        let request;
        if (operation === "snapshot") {
            f.state.inspectHook = () => pending.promise;
            request = f.send({ op: "snapshot", scope });
        } else {
            const stage = await f.ready();
            if (operation === "preview") {
                f.state.previewHook = () => pending.promise;
                request = f.send({
                    op: "preview",
                    transaction_id: stage.transaction_id,
                });
            } else {
                f.state.applyHook = () => pending.promise;
                request = f.commit(stage);
            }
        }
        await flush();
        assert(f.timers.size > 0);
        f.runtime.dispose();
        assert.equal(f.timers.size, 0, operation);
        const result = await request;
        if (operation === "commit") {
            assert.equal(result.outcome, "unknown");
            assert.equal(f.state.lastApply.current(), false);
            assert.deepEqual(
                Buffer.from(f.state.lastApply.receipt.bytes),
                f.bytes
            );
            pending.resolve(f.verified(f.state.lastApply.receipt));
            await flush();
            assert(
                f.state.lastApply.receipt.bytes.every((value) => value === 0)
            );
            assert.equal(f.state.applies, 1);
        } else {
            assert(result.error);
            assert.equal(f.state.applies, 0);
            pending.resolve();
        }
        await flush();
        assert.equal(f.timers.size, 0);
    }
});
