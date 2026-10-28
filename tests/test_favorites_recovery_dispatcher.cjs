"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const ts = require("typescript");
const acorn = require("acorn");
const cache = {};
function load(file) {
    file = path.resolve(file);
    if (cache[file]) return cache[file];
    const module = { exports: {} };
    cache[file] = module.exports;
    const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES5,
        },
        reportDiagnostics: true,
    });
    assert.equal(output.diagnostics.length, 0);
    acorn.parse(output.outputText, { ecmaVersion: 5 });
    vm.runInNewContext(
        output.outputText,
        {
            exports: module.exports,
            Promise,
            require: (name) =>
                load(path.resolve(path.dirname(file), name + ".ts")),
            Uint8Array,
        },
        { filename: file }
    );
    return module.exports;
}
const api = load(path.join(__dirname, "../src/commands/favorites-recovery.ts"));
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = {
    profileBindingId: id(10),
    provider: "plex",
    sourceBindingId: id(11),
};
const plain = (v) => JSON.parse(JSON.stringify(v));
function fixture() {
    let raw = null,
        calls = 0,
        busy = false,
        live = true,
        full = true,
        clock = 10,
        writeMode = "confirmed",
        hook = null,
        locked = false;
    const grant = {
        compareAndSwap: (key, before, after, admission) => {
            assert(locked);
            assert.equal(key, "favorites-receipts.v1");
            assert.equal(raw, before);
            assert.equal(typeof admission, "function");
            if (writeMode === "prewrite-revoke") live = false;
            if (writeMode === "prewrite-expire") clock = 1000;
            try {
                if (!admission()) return "conflict";
            } catch (_) {
                return "conflict";
            }
            calls++;
            if (writeMode === "throw") throw Error("private diagnostic");
            raw = after;
            if (writeMode === "drift") raw += " ";
            if (writeMode === "postwrite-revoke") live = false;
            try {
                if (!admission()) return "unknown";
            } catch (_) {
                return "unknown";
            }
            return writeMode;
        },
        current: () => live,
        exclusive: async (work) => {
            if (busy) throw Error("busy");
            locked = true;
            try {
                return await work(grant);
            } finally {
                locked = false;
            }
        },
        implementationVersion: 1,
        kind: "synchronous-localstorage",
        lockName: "ottplay:favorites-ledger",
        origin: "https://synthetic.invalid",
        privateLedgerKey: "favorites-receipts.v1",
        read: (key) => {
            assert.equal(key, "favorites-receipts.v1");
            return raw;
        },
    };
    const host = {
        physicalStorage: () => (full ? grant : null),
        recoveryStorage: () => grant,
    };
    const dispatcher = api.createFavoritesRecoveryDispatcher({
        current: () => live,
        host,
        now: () => clock,
        runtime: () => "runtime-1",
        sha256: async (text) => {
            if (hook) {
                const f = hook;
                hook = null;
                f();
            }
            return sha(text);
        },
        utf8: (text) => Buffer.from(text),
    });
    async function seed(fenced = true) {
        const codec = load(
            path.join(__dirname, "../src/settings/favorites-recovery-codec.ts")
        ).createFavoritesRecoveryCodec({ sha256: async (text) => sha(text) });
        const fence = {
            backendProof: await codec.backendProof(grant),
            guardImplementationVersion: 1,
            version: 2,
        };
        raw = JSON.stringify({
            entries: [
                {
                    createdAt: 1,
                    expiresAt: 86400001,
                    ...(fenced ? { fence } : {}),
                    operationId: id(1),
                    payloadHash: "a".repeat(64),
                    refs: { runtimeId: "old-runtime", stageId: "stage-1" },
                    scope,
                    state: "pending",
                },
            ],
            version: fenced ? 2 : 1,
        });
    }
    const request = (mode) => ({
        mode,
        op: "recovery",
        runtime: "runtime-1",
        ...(mode === "list" ? {} : { operation_id: id(1) }),
    });
    const execute = (p) => dispatcher.execute(p, () => live, 1000);
    const inspect = () => execute(request("inspect"));
    async function ack() {
        const view = await inspect();
        return {
            ...request("acknowledge"),
            accept_unknown: true,
            acknowledgement_id: view.acknowledgement_id,
            after_ledger_sha256: view.after_ledger_sha256,
            backend_proof: view.backend_proof,
            expected_ledger_revision: view.ledger_revision,
            original_entry_sha256: view.record.original_entry_sha256,
            plan_sha256: view.plan_sha256,
            reason: "accept-unknown-no-replay",
            scope,
        };
    }
    return {
        ack,
        set busy(v) {
            busy = v;
        },
        get calls() {
            return calls;
        },
        set clock(v) {
            clock = v;
        },
        dispatcher,
        execute,
        set full(v) {
            full = v;
        },
        grant,
        set hook(v) {
            hook = v;
        },
        inspect,
        set live(v) {
            live = v;
        },
        get locked() {
            return locked;
        },
        set mode(v) {
            writeMode = v;
        },
        get raw() {
            return raw;
        },
        set raw(v) {
            raw = v;
        },
        request,
        seed,
    };
}
let groups = 0;
async function test(name, run) {
    await run();
    groups++;
    console.log("PASS " + name);
}
(async () => {
    await test("global absent logical v2 read-only without full grant", async () => {
        const f = fixture();
        f.full = false;
        const v = await f.execute(f.request("list"));
        assert.deepEqual(plain(v.records), []);
        assert.equal(v.ledger_format, 2);
        assert.equal(v.ledger_revision, sha("null"));
        assert.equal(v.backend_proof, null);
        assert.equal(f.raw, null);
        assert.equal(f.calls, 0);
        const i = await f.inspect();
        assert.equal(i.record, null);
        assert.equal(i.acknowledge_allowed, false);
    });
    await test("legacy inspection remains readable but cannot acknowledge", async () => {
        const f = fixture();
        await f.seed(false);
        assert.equal((await f.inspect()).acknowledge_allowed, false);
        assert.equal((await f.inspect()).ledger_format, 1);
        assert.equal(f.calls, 0);
    });
    await test("strict request admission", async () => {
        const f = fixture();
        for (const p of [
            { ...f.request("list"), extra: true },
            { ...f.request("inspect"), operation_id: id(1) + "\n" },
            { ...f.request("list"), runtime: "runtime-1\n" },
            { ...f.request("inspect"), mode: "other" },
        ])
            await assert.rejects(f.execute(p), /invalid_request/);
        await f.seed();
        const p = await f.ack();
        for (const field of [
            "accept_unknown",
            "reason",
            "scope",
            "plan_sha256",
        ]) {
            const q = { ...p, [field]: null };
            await assert.rejects(f.execute(q), /invalid_request/);
        }
        assert.equal(f.calls, 0);
    });
    await test("one exact CAS audit, preserved original unknown, no replay", async () => {
        const f = fixture();
        await f.seed();
        const before = JSON.parse(f.raw);
        const p = await f.ack();
        const v = await f.execute(p);
        assert.equal(v.acknowledged, true);
        assert.equal(f.calls, 1);
        assert.equal(sha(f.raw), p.after_ledger_sha256);
        assert.equal(v.record.original_state, "pending");
        assert.equal(v.record.original_outcome, "unknown");
        const after = JSON.parse(f.raw);
        delete after.entries[0].recovery_ack;
        assert.deepEqual(after, before);
        assert(api.validFavoritesRecoveryResponse(v, p));
        assert.equal((await f.inspect()).acknowledge_allowed, false);
        await assert.rejects(f.execute(p), /revision_conflict/);
        assert.equal(f.calls, 1);
    });
    await test("stale scope/digest/proof/plan never writes", async () => {
        for (const field of [
            "scope",
            "original_entry_sha256",
            "backend_proof",
            "acknowledgement_id",
            "after_ledger_sha256",
            "plan_sha256",
        ]) {
            const f = fixture();
            await f.seed();
            const p = await f.ack();
            p[field] =
                field === "scope"
                    ? { ...scope, sourceBindingId: id(12) }
                    : "c".repeat(64);
            await assert.rejects(f.execute(p), /revision_conflict/);
            assert.equal(f.calls, 0);
        }
    });
    await test("busy unsupported and mutation during await fail closed", async () => {
        const f = fixture();
        await f.seed();
        const p = await f.ack();
        f.busy = true;
        await assert.rejects(f.execute(p), /busy/);
        f.busy = false;
        f.full = false;
        await assert.rejects(f.execute(p), /unsupported_persistence/);
        f.full = true;
        f.hook = () => {
            f.raw += " ";
        };
        await assert.rejects(f.execute(p), /invalid_ledger|revision_conflict/);
        assert.equal(f.calls, 0);
    });
    await test("uncertain CAS/readback cannot claim acknowledged", async () => {
        for (const mode of ["throw", "unknown", "drift"]) {
            const f = fixture();
            await f.seed();
            const p = await f.ack();
            f.mode = mode;
            await assert.rejects(f.execute(p), /storage_unavailable/);
            assert.equal(f.calls, 1);
        }
    });
    await test("deadline and ownership checked before writes", async () => {
        for (const action of [
            (f) => {
                f.clock = 1000;
            },
            (f) => {
                f.live = false;
            },
        ]) {
            const f = fixture();
            await f.seed();
            const p = await f.ack();
            f.hook = () => action(f);
            await assert.rejects(f.execute(p), /expired|runtime_changed/);
            assert.equal(f.calls, 0);
            assert.equal(f.locked, false);
        }
    });
    await test("RAM advisory clears only exact cryptographically verified audit", async () => {
        const f = fixture();
        await f.seed();
        const expected = {
            operationId: id(1),
            payloadHash: "a".repeat(64),
            scope,
        };
        assert.equal(
            await f.dispatcher.acknowledged(expected, () => true, 1000),
            false
        );
        await f.execute(await f.ack());
        assert.equal(
            await f.dispatcher.acknowledged(expected, () => true, 1000),
            true
        );
        assert.equal(
            await f.dispatcher.acknowledged(
                { ...expected, payloadHash: "b".repeat(64) },
                () => true,
                1000
            ),
            false
        );
        assert.equal(
            await f.dispatcher.acknowledged(
                { ...expected, scope: { ...scope, sourceBindingId: id(12) } },
                () => true,
                1000
            ),
            false
        );
        const bad = JSON.parse(f.raw);
        bad.entries[0].recovery_ack.acknowledgement_id = "c".repeat(64);
        f.raw = JSON.stringify(bad);
        await assert.rejects(
            f.dispatcher.acknowledged(expected, () => true, 1000),
            /invalid_ledger/
        );
    });
    await test("CAS rechecks authenticated owner/deadline at prewrite and postwrite boundaries", async () => {
        for (const mode of [
            "prewrite-revoke",
            "prewrite-expire",
            "postwrite-revoke",
        ]) {
            const f = fixture();
            await f.seed();
            const p = await f.ack(),
                before = f.raw;
            f.mode = mode;
            await assert.rejects(f.execute(p), /storage_unavailable/);
            if (mode === "postwrite-revoke") {
                assert.equal(f.calls, 1);
                assert.equal(sha(f.raw), p.after_ledger_sha256);
            } else {
                assert.equal(f.calls, 0);
                assert.equal(f.raw, before);
            }
            assert.equal(f.locked, false);
        }
    });
    await test("response correlation rejects substituted plan, audit, rows, fields", async () => {
        const f = fixture();
        await f.seed();
        const p = await f.ack(),
            v = plain(await f.execute(p));
        for (const q of [
            { ...v, plan_sha256: "c".repeat(64) },
            { ...v, extra: true },
            { ...v, record: { ...v.record, operation_id: id(2) } },
            {
                ...v,
                record: {
                    ...v.record,
                    acknowledgement: {
                        ...v.record.acknowledgement,
                        runtime: "foreign",
                    },
                },
            },
        ])
            assert.equal(api.validFavoritesRecoveryResponse(q, p), false);
    });
    console.log(groups + " recovery dispatcher groups passed");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
