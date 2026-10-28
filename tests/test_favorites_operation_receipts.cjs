const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const source = fs.readFileSync(
    path.join(__dirname, "../src/settings/favorites-operation-receipts.ts"),
    "utf8"
);
const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES5 },
    reportDiagnostics: true,
});
assert.equal(output.diagnostics.length, 0);
const codecHost = { exports: {} };
vm.runInNewContext(
    ts.transpileModule(
        fs.readFileSync(
            path.join(__dirname, "../src/settings/favorites-recovery-codec.ts"),
            "utf8"
        ),
        { compilerOptions: { target: ts.ScriptTarget.ES5 } }
    ).outputText,
    codecHost
);
const host = {
    exports: {},
    require: (name) => {
        assert.equal(name, "./favorites-recovery-codec");
        return codecHost.exports;
    },
};
vm.runInNewContext(output.outputText, host);
const plain = (v) => JSON.parse(JSON.stringify(v));
const id = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const input = (n = 1) => ({
    operationId: id(n),
    payloadHash: "a".repeat(64),
    refs: { runtimeId: "page-123", stageId: "stage-1" },
    scope: {
        profileBindingId: id(100),
        provider: "plex",
        sourceBindingId: id(101),
    },
});
const outcome = (state = "verified") => ({
    counts: {
        channelLists: 2,
        channelMemberships: 1,
        mediaFavorites: 3,
        unresolved: 0,
    },
    meta: {
        appliedStores: state === "not_applied" ? 0 : 2,
        code: "none",
        totalStores: 2,
    },
    newRevision: "favorites-21",
    persistence: "persistent",
    state,
});
function fixture() {
    const state = { current: true, raw: null, time: 1000, writes: 0 };
    const ports = {
        compareAndSwap: (before, after) => {
            state.writes++;
            if (state.raw !== before) return "conflict";
            state.raw = after;
            return "confirmed";
        },
        current: () => state.current,
        fence: () => ({
            backendProof: "f".repeat(64),
            guardImplementationVersion: 1,
            version: 2,
        }),
        now: () => state.time,
        persistedRead: () => state.raw,
        read: () => state.raw,
        writeGuard: () => true,
    };
    return { api: host.createFavoritesOperationReceipts(ports), ports, state };
}
function reject(code, run) {
    assert.throws(run, (e) => e.code === code && !e.message.includes("secret"));
}
function rejectCompletion(code, run) {
    assert.throws(
        run,
        (error) => error.code === code && error.outcome === "unknown"
    );
}
function reserve(f, n = 1) {
    return f.api.reserve(input(n), { freshAdmission: true });
}
function completion(f, ticket, value = outcome()) {
    return f.api.materializeCompletion(
        f.api.prepareCompletion(ticket, value),
        "b".repeat(64)
    );
}
let passed = 0;
function test(name, run) {
    run();
    passed++;
    console.log("PASS " + name);
}
test("fresh reservation is persisted pending; restart never authorizes replay", () => {
    const f = fixture();
    assert.deepEqual(plain(f.api.status(id(1))), {
        replayAllowed: false,
        state: "unknown",
    });
    reject("fresh_admission_required", () => f.api.reserve(input(), {}));
    const t = reserve(f);
    assert.equal(f.api.verifyPending(t), true);
    const reload = host.createFavoritesOperationReceipts(f.ports);
    assert.deepEqual(plain(reload.status(id(1))), {
        receipt: null,
        replayAllowed: false,
        state: "pending",
    });
    reject("operation_exists", () =>
        reload.reserve(input(), { freshAdmission: true })
    );
    assert.equal(f.state.writes, 1);
});
test("whole-ledger completion template resolves only the explicit digest field", () => {
    const f = fixture(),
        t = reserve(f),
        before = f.state.raw;
    const template = f.api.prepareCompletion(t, outcome());
    assert.equal(template.beforeRaw, before);
    assert.deepEqual(
        plain(template.afterTemplate.entries[0].receipt.plan_digest),
        { computed: "plan_digest", width: 64 }
    );
    assert.equal(f.state.raw, before, "preparation performs no write");
    const descriptor = f.api.materializeCompletion(template, "b".repeat(64));
    assert.equal(descriptor.beforeRaw, before);
    const receipt = f.api.commitCompletion(descriptor).receipt;
    assert.deepEqual(plain(receipt), {
        counts: outcome().counts,
        document_sha256: "a".repeat(64),
        new_revision: "favorites-21",
        operation_id: id(1),
        outcome: "verified",
        persistence: "persistent",
        plan_digest: "b".repeat(64),
        scope: input().scope,
    });
    assert.deepEqual(plain(f.api.status(id(1)).receipt), plain(receipt));
    assert.equal(f.api.status(id(1)).replayAllowed, false);
});
test("failed or uncertain reserve never returns target-write admission", () => {
    for (const result of ["conflict", "unknown", "confirmed"]) {
        const f = fixture();
        let admitted = false;
        f.ports.compareAndSwap = () => result;
        reject(
            result === "conflict" ? "ledger_changed" : "outcome_unknown",
            () => {
                reserve(f);
                admitted = true;
            }
        );
        assert.equal(admitted, false);
    }
    const f = fixture();
    f.ports.compareAndSwap = () => {
        throw Error("secret");
    };
    reject("outcome_unknown", () => reserve(f));
});
test("terminal receipt write failure is unknown, including after actual write", () => {
    const f = fixture(),
        t = reserve(f),
        descriptor = completion(f, t);
    const write = f.ports.compareAndSwap;
    f.ports.compareAndSwap = (before, after) => {
        write(before, after);
        throw Error("secret");
    };
    rejectCompletion("outcome_unknown", () =>
        f.api.commitCompletion(descriptor)
    );
    assert.equal(
        f.api.status(id(1)).state,
        "verified",
        "later persisted readback may establish the actual outcome"
    );
    const g = fixture(),
        gt = reserve(g),
        gd = completion(g, gt);
    g.ports.persistedRead = () => {
        throw Error("secret");
    };
    rejectCompletion("storage_unavailable", () => g.api.commitCompletion(gd));
    assert.equal(g.state.writes, 1);
});
test("concurrent whole-ledger change invalidates prepared completion", () => {
    const f = fixture(),
        t = reserve(f),
        d = completion(f, t);
    reserve(f, 2);
    const changed = f.state.raw,
        writes = f.state.writes;
    rejectCompletion("ledger_changed", () => f.api.commitCompletion(d));
    assert.equal(f.state.raw, changed);
    assert.equal(f.state.writes, writes);
});
test("CAS-time competing writer is preserved", () => {
    const f = fixture(),
        t = reserve(f),
        d = completion(f, t);
    const competing = f.state.raw.replace('"stage-1"', '"stage-other"');
    f.ports.compareAndSwap = () => {
        f.state.raw = competing;
        return "conflict";
    };
    rejectCompletion("ledger_changed", () => f.api.commitCompletion(d));
    assert.equal(f.state.raw, competing);
});
test("pending unknown and partial entries cannot be evicted to admit new work", () => {
    for (const state of ["pending", "unknown", "partial"]) {
        const f = fixture();
        let admitted = 0;
        for (let n = 1; n <= 33; n++) {
            let plan;
            try {
                plan = f.api.prepareReservation(
                    input(n),
                    { freshAdmission: true },
                    state === "pending" ? undefined : outcome(state)
                );
            } catch (error) {
                assert.equal(error.code, "capacity");
                break;
            }
            f.api.commitReservation(plan);
            if (state !== "pending")
                f.api.commitCompletion(
                    f.api.materializeCompletion(plan.completion, "b".repeat(64))
                );
            admitted++;
        }
        assert(admitted > 0 && admitted <= 32);
        assert.equal(JSON.parse(f.state.raw).entries.length, admitted);
        assert(
            JSON.parse(f.state.raw).entries.every(
                (entry) => entry.state === state
            )
        );
        f.state.time += 86400001;
        assert.equal(f.api.status(id(1)).state, "unknown");
        const raw = f.state.raw;
        reject("capacity", () =>
            f.api.prepareReservation(
                input(34),
                { freshAdmission: true },
                state === "pending" ? undefined : outcome(state)
            )
        );
        assert.equal(f.state.raw, raw);
    }
});
test("expired completed receipt remains until pressure; status stays unknown", () => {
    const f = fixture(),
        t = reserve(f);
    f.api.commitCompletion(completion(f, t));
    f.state.time += 86400000;
    assert.deepEqual(plain(f.api.status(id(1))), {
        replayAllowed: false,
        state: "unknown",
    });
    reject("operation_exists", () => reserve(f, 1));
    reserve(f, 2);
    assert.equal(JSON.parse(f.state.raw).entries.length, 2);
    assert.equal(f.api.status(id(1)).state, "unknown");
});
test("source changes and reentry prevent admission or terminal write", () => {
    const f = fixture();
    f.state.current = false;
    reject("context_changed", () => reserve(f));
    assert.equal(f.state.writes, 0);
    f.state.current = true;
    const t = reserve(f),
        d = completion(f, t);
    f.state.current = false;
    rejectCompletion("context_changed", () => f.api.commitCompletion(d));
    assert.equal(f.state.writes, 1);
    const g = fixture();
    g.ports.current = () => {
        reject("busy", () => g.api.status(id(1)));
        return true;
    };
    reserve(g);
});
test("malformed and oversized ledger is fail closed", () => {
    const f = fixture();
    for (const raw of [
        "{",
        "[]",
        " ".repeat(65537),
        '{"version":1,"version":1,"entries":[]}',
        '{"version":1,"entries":[],"extra":"secret"}',
    ]) {
        f.state.raw = raw;
        reject("invalid_ledger", () => f.api.status(id(1)));
        reject("invalid_ledger", () => reserve(f));
    }
    assert.equal(f.state.writes, 0);
});
test("no URLs documents freeform diagnostics or unsafe references are retained", () => {
    const f = fixture();
    for (const value of [
        { ...input(), operationId: "not-uuid" },
        { ...input(), payloadHash: "https://secret" },
        { ...input(), document: "secret" },
        { ...input(), refs: { runtimeId: "page", stageId: "https://secret" } },
    ])
        reject("invalid_request", () =>
            f.api.reserve(value, { freshAdmission: true })
        );
    const t = reserve(f);
    reject("invalid_outcome", () =>
        f.api.prepareCompletion(t, {
            ...outcome(),
            meta: { ...outcome().meta, message: "secret" },
        })
    );
    reject("invalid_outcome", () =>
        f.api.prepareCompletion(t, {
            ...outcome(),
            persistence: "session-only",
        })
    );
    assert.equal(f.state.raw.includes("secret"), false);
});
test("unresolved digest marker and tampered unrelated rows never reach writer", () => {
    const f = fixture(),
        t = reserve(f);
    reserve(f, 2);
    const template = f.api.prepareCompletion(t, outcome());
    reject("invalid_plan", () => f.api.materializeCompletion(template, "bad"));
    const d = f.api.materializeCompletion(template, "b".repeat(64));
    const value = JSON.parse(d.afterRaw);
    value.entries[1].refs.stageId = "changed";
    d.afterRaw = JSON.stringify(value);
    rejectCompletion("invalid_plan", () => f.api.commitCompletion(d));
    assert.equal(f.state.writes, 2);
});
console.log(`Favorites operation receipts: ${passed} tests passed`);
test("pure inspect/preview plans perform no writes and can be discarded without capacity loss", () => {
    const f = fixture();
    for (let n = 1; n <= 40; n++) {
        const p = f.api.prepareReservation(input(n), { freshAdmission: true });
        assert.equal(f.api.verifyReservation(p), true);
        const ready = f.api.prepareReservation(
            input(n),
            { freshAdmission: true },
            outcome()
        );
        assert.equal(ready.completion.beforeRaw, ready.pendingRaw);
        assert.equal(ready.beforeRaw, null);
        assert.equal(f.state.raw, null);
        assert.equal(f.state.writes, 0);
    }
    reject("fresh_admission_required", () =>
        f.api.prepareReservation(input(), {})
    );
});
test("exact prepared pending CAS precedes any completion and survives restart as no-replay pending", () => {
    const f = fixture(),
        p = f.api.prepareReservation(
            input(),
            { freshAdmission: true },
            outcome()
        );
    const descriptor = f.api.materializeCompletion(
        p.completion,
        "b".repeat(64)
    );
    rejectCompletion("ledger_changed", () =>
        f.api.commitCompletion(descriptor)
    );
    assert.equal(f.state.writes, 0);
    const ticket = f.api.commitReservation(p);
    assert.deepEqual(plain(ticket), plain(p.ticket));
    assert.equal(f.state.raw, p.pendingRaw);
    assert.equal(f.state.writes, 1);
    assert.equal(f.api.verifyPending(ticket), true);
    const reader = host.createFavoritesOperationReceipts(f.ports);
    assert.deepEqual(plain(reader.status(id(1))), {
        receipt: null,
        replayAllowed: false,
        state: "pending",
    });
    reject("operation_exists", () =>
        reader.prepareReservation(input(), { freshAdmission: true })
    );
    f.api.commitCompletion(descriptor);
    assert.equal(reader.status(id(1)).state, "verified");
});
test("reservation rejects raw drift, changed descriptors, stale source and uncertain CAS", () => {
    for (const [change, expected] of [
        ["pending", "invalid_ledger"],
        ["completion", "invalid_outcome"],
        ["before", "ledger_changed"],
        ["source", "context_changed"],
        ["clock", "expired"],
        ["CAS", "outcome_unknown"],
    ]) {
        const f = fixture(),
            p = f.api.prepareReservation(
                input(),
                { freshAdmission: true },
                outcome()
            );
        if (change === "pending")
            p.pendingRaw = p.pendingRaw.replace('"pending"', '"unknown"');
        if (change === "completion")
            p.completion.afterTemplate.entries[0].receipt.counts.mediaFavorites =
                -1;
        if (change === "before")
            f.state.raw = JSON.stringify({ entries: [], version: 1 });
        if (change === "source") f.state.current = false;
        if (change === "clock") f.state.time += 86400000;
        if (change === "CAS")
            f.ports.compareAndSwap = (_before, after) => {
                f.state.writes++;
                f.state.raw = after;
                return "unknown";
            };
        assert.throws(
            () => f.api.commitReservation(p),
            (error) => error.code === expected,
            change
        );
        assert.equal(f.state.writes, change === "CAS" ? 1 : 0);
        if (change === "CAS")
            assert.equal(f.api.status(id(1)).state, "pending");
    }
});
test("more than32 completed operations evict oldest proved completion only under pressure", () => {
    const f = fixture();
    for (let n = 1; n <= 70; n++) {
        f.state.time++;
        const p = f.api.prepareReservation(
            input(n),
            { freshAdmission: true },
            outcome(n % 2 ? "verified" : "not_applied")
        );
        f.api.commitReservation(p);
        f.api.commitCompletion(
            f.api.materializeCompletion(p.completion, "b".repeat(64))
        );
        assert.equal(JSON.parse(f.state.raw).entries.length, Math.min(n, 32));
    }
    assert.equal(f.api.status(id(1)).state, "unknown");
    assert.equal(f.api.status(id(70)).state, "not_applied");
    assert.equal(f.api.status(id(1)).replayAllowed, false);
    reject("fresh_admission_required", () =>
        f.api.prepareReservation(input(1), {})
    );
});
test("pressure preserves mixed pending partial unknown rows while evicting completed rows", () => {
    const f = fixture();
    for (let n = 1; n <= 32; n++) {
        const p = f.api.prepareReservation(
            input(n),
            { freshAdmission: true },
            n <= 3 ? undefined : outcome()
        );
        const ticket = f.api.commitReservation(p);
        if (n === 2 || n === 3)
            f.api.commitCompletion(
                completion(f, ticket, outcome(n === 2 ? "partial" : "unknown"))
            );
        else if (n > 3)
            f.api.commitCompletion(
                f.api.materializeCompletion(p.completion, "b".repeat(64))
            );
    }
    for (let n = 33; n <= 65; n++) {
        const p = f.api.prepareReservation(
            input(n),
            { freshAdmission: true },
            outcome()
        );
        f.api.commitReservation(p);
        f.api.commitCompletion(
            f.api.materializeCompletion(p.completion, "b".repeat(64))
        );
    }
    const entries = JSON.parse(f.state.raw).entries;
    assert.equal(entries.length, 32);
    assert.deepEqual(
        entries.slice(0, 3).map((e) => e.state),
        ["pending", "partial", "unknown"]
    );
    for (const n of [1, 2, 3])
        assert.equal(
            entries.some((e) => e.operationId === id(n)),
            true
        );
});
console.log("NEW TOTAL " + passed);

test("v2 provenance and actual held write grant are mandatory; pure missing reads never initialize", () => {
    const f = fixture();
    assert.equal(f.api.status(id(1)).state, "unknown");
    assert.equal(f.state.raw, null);
    assert.equal(f.state.writes, 0);
    delete f.ports.fence;
    reject("unsupported_persistence", () =>
        f.api.prepareReservation(input(), { freshAdmission: true })
    );
    assert.equal(f.state.writes, 0);
    const g = fixture();
    const plan = g.api.prepareReservation(
        input(),
        { freshAdmission: true },
        outcome()
    );
    g.ports.writeGuard = () => false;
    reject("unsupported_persistence", () => g.api.commitReservation(plan));
    assert.equal(g.state.writes, 0);
    g.ports.writeGuard = () => true;
    g.ports.fence = () => ({
        backendProof: "c".repeat(64),
        guardImplementationVersion: 1,
        version: 2,
    });
    reject("invalid_plan", () => g.api.commitReservation(plan));
    assert.equal(g.state.writes, 0);
});
test("legacy rows remain readonly and acknowledged rows reject all late mutation paths", () => {
    const f = fixture();
    const proof = reserve(f);
    const descriptor = completion(f, proof);
    const legacy = JSON.parse(f.state.raw);
    delete legacy.entries[0].fence;
    legacy.version = 1;
    f.state.raw = JSON.stringify(legacy);
    assert.equal(f.api.status(id(1)).state, "pending");
    reject("invalid_ticket", () => f.api.verifyPending(proof));
    rejectCompletion("invalid_plan", () =>
        f.api.commitCompletion({ ...descriptor, beforeRaw: f.state.raw })
    );
    const current = fixture();
    const t = reserve(current);
    const d = completion(current, t);
    const value = JSON.parse(current.state.raw);
    value.entries[0].recovery_ack = {
        acknowledgement_id: "a".repeat(64),
        backend_proof: "f".repeat(64),
        ledger_revision_before: "b".repeat(64),
        reason: "accept-unknown-no-replay",
        runtime: "observer",
    };
    current.state.raw = JSON.stringify(value);
    const raw = current.state.raw;
    reject("invalid_ticket", () => current.api.verifyPending(t));
    rejectCompletion("invalid_plan", () =>
        current.api.commitCompletion({ ...d, beforeRaw: raw })
    );
    assert.equal(current.state.raw, raw);
    assert.equal(current.state.writes, 1);
    assert.equal(current.api.status(id(1)).replayAllowed, false);
});
