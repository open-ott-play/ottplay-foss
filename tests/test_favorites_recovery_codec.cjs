const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const acorn = require("acorn");
const context = { exports: {}, Promise };
const output = ts.transpileModule(
    fs.readFileSync(
        path.join(__dirname, "../src/settings/favorites-recovery-codec.ts"),
        "utf8"
    ),
    {
        compilerOptions: { target: ts.ScriptTarget.ES5 },
        reportDiagnostics: true,
    }
);
assert.equal(output.diagnostics.length, 0);
acorn.parse(output.outputText, { ecmaVersion: 5 });
vm.runInNewContext(output.outputText, context);
const exportsApi = context.exports;
const sha = (text) =>
    crypto.createHash("sha256").update(text, "utf8").digest("hex");
const codec = exportsApi.createFavoritesRecoveryCodec({
    sha256: async (text) => sha(text),
});
const plain = (value) => JSON.parse(JSON.stringify(value));
const id = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const fence = {
    backendProof: "b".repeat(64),
    guardImplementationVersion: 1,
    version: 2,
};
const row = (n = 1, fenced = true) => ({
    createdAt: 1,
    expiresAt: 86400001,
    ...(fenced ? { fence: { ...fence } } : {}),
    operationId: id(n),
    payloadHash: "a".repeat(64),
    refs: { runtimeId: "original-runtime", stageId: "stage-1" },
    scope: {
        profileBindingId: id(100),
        provider: "plex",
        sourceBindingId: id(101),
    },
    state: "pending",
});
const raw = (entries, version = 2) => JSON.stringify({ entries, version });
const ask = (
    operationId = id(1),
    runtime = "runtime-now",
    backendProof = fence.backendProof
) => ({ backendProof, operationId, runtime });
let groups = 0;
async function test(name, run) {
    await run();
    groups++;
    console.log("PASS " + name);
}
(async () => {
    await test("missing ledger is logical v2, null digest, no rows or producer claim", async () => {
        assert.deepEqual(plain(await codec.snapshot(null)), {
            ledgerFormat: 2,
            ledgerRevision: sha("null"),
            records: [],
        });
        const result = await codec.inspect(null, ask());
        assert.equal(result.record, null);
        assert.equal(result.acknowledgeAllowed, false);
        for (const key of [
            "afterRaw",
            "acknowledgementId",
            "afterLedgerSha256",
            "planDigest",
        ])
            assert.equal(result[key], null);
    });
    await test("legacy rows remain inspect-only even in v2 envelopes and with qualified backend", async () => {
        for (const version of [1, 2]) {
            const before = raw([row(1, false)], version);
            const result = await codec.inspect(before, ask());
            assert.equal(result.record.original_state, "pending");
            assert.equal(result.acknowledgeAllowed, false);
            assert.equal(result.afterRaw, null);
            assert.equal(result.ledgerRevision, sha(before));
        }
    });
    await test("exact independent ACK and PLAN domains; original excludes audit only", async () => {
        const before = raw([row()]);
        const result = await codec.inspect(before, ask());
        assert.equal(result.acknowledgeAllowed, true);
        const original = codec.originalCanonical(row());
        const E = sha(original),
            L = sha(before),
            S = [id(100), id(101), "plex"],
            R = "accept-unknown-no-replay";
        const ACK = sha(
            JSON.stringify([
                "ottplay-favorites-recovery-ack-v1",
                "runtime-now",
                id(1),
                S,
                E,
                L,
                fence.backendProof,
                R,
            ])
        );
        assert.equal(result.acknowledgementId, ACK);
        const after = JSON.parse(before);
        after.entries[0].recovery_ack = {
            acknowledgement_id: ACK,
            backend_proof: fence.backendProof,
            ledger_revision_before: L,
            reason: R,
            runtime: "runtime-now",
        };
        assert.equal(result.afterRaw, JSON.stringify(after));
        assert.equal(result.afterLedgerSha256, sha(result.afterRaw));
        assert.equal(
            result.planDigest,
            sha(
                JSON.stringify([
                    "ottplay-favorites-recovery-plan-v1",
                    "runtime-now",
                    id(1),
                    S,
                    E,
                    L,
                    fence.backendProof,
                    R,
                    ACK,
                    sha(result.afterRaw),
                ])
            )
        );
        assert.equal(codec.originalCanonical(after.entries[0]), original);
        assert.equal(after.entries[0].state, "pending");
        const audit = after.entries[0].recovery_ack;
        assert.deepEqual(
            Object.keys(audit),
            [
                "acknowledgement_id",
                "backend_proof",
                "ledger_revision_before",
                "reason",
                "runtime",
            ],
            "frozen private audit physical key order"
        );
        assert.deepEqual(Object.keys(audit).sort(), [
            "acknowledgement_id",
            "backend_proof",
            "ledger_revision_before",
            "reason",
            "runtime",
        ]);
    });
    await test("nonselected original rows and physical ordering remain exact; only audit appended", async () => {
        const before = raw([row(2), row(1), row(3, false)]);
        const result = await codec.inspect(before, ask());
        const a = JSON.parse(result.afterRaw),
            b = JSON.parse(before);
        assert.equal(
            JSON.stringify(a.entries[0]),
            JSON.stringify(b.entries[0])
        );
        assert.equal(
            JSON.stringify(a.entries[2]),
            JSON.stringify(b.entries[2])
        );
        delete a.entries[1].recovery_ack;
        assert.equal(JSON.stringify(a), before);
        assert.deepEqual(
            plain(
                (await codec.snapshot(before)).records.map(
                    (x) => x.operation_id
                )
            ),
            [id(1), id(2), id(3)]
        );
    });
    await test("observing runtime may differ while stored audit is authenticated from original context", async () => {
        const first = await codec.inspect(raw([row()]), ask());
        const second = await codec.inspect(
            first.afterRaw,
            ask(id(1), "other-runtime")
        );
        assert.equal(second.acknowledgeAllowed, false);
        assert.equal(second.afterRaw, null);
        assert.equal(second.record.acknowledgement.runtime, "runtime-now");
        const changed = JSON.parse(first.afterRaw);
        changed.entries.push(row(2));
        const result = await codec.snapshot(JSON.stringify(changed));
        assert.equal(
            result.records[0].acknowledgement.acknowledgement_id,
            first.acknowledgementId
        );
        for (const field of [
            "runtime",
            "backend_proof",
            "ledger_revision_before",
            "acknowledgement_id",
        ]) {
            const bad = JSON.parse(first.afterRaw);
            bad.entries[0].recovery_ack[field] =
                field === "runtime" ? "other-runtime" : "c".repeat(64);
            await assert.rejects(
                codec.snapshot(JSON.stringify(bad)),
                (e) => e.code === "invalid_ledger"
            );
        }
    });
    await test("backend mismatch, absent qualification, missing target and acknowledged rows never plan", async () => {
        for (const q of [
            ask(id(1), "runtime-now", null),
            ask(id(1), "runtime-now", "c".repeat(64)),
            ask(id(9)),
        ]) {
            const r = await codec.inspect(raw([row()]), q);
            assert.equal(r.acknowledgeAllowed, false);
            assert.equal(r.planDigest, null);
        }
    });
    await test("strict UUID/runtime/fence/schema and exact private raw serialization", async () => {
        for (const value of [
            "{",
            '{"entries":[],"version":2,"version":2}',
            raw([row()], 3),
            raw([row(), row()]),
            raw([{ ...row(), extra: 1 }]),
            raw([
                {
                    ...row(),
                    fence: { ...fence, guardImplementationVersion: 2 },
                },
            ]),
            raw([{ ...row(), recovery_ack: {} }]),
            raw([row()], 1),
            raw([{ ...row(), payloadHash: "x" }]),
            raw([]) + "\n",
            raw([{ ...row(), refs: { runtimeId: "bad\ud800", stageId: "x" } }]),
        ])
            assert.throws(
                () => codec.parse(value),
                (e) => e.code === "invalid_ledger"
            );
        for (const q of [
            ask(id(1) + "\n"),
            ask(id(1), "UPPER"),
            ask(id(1), "x".repeat(65)),
            { ...ask(), extra: 1 },
        ])
            await assert.rejects(
                codec.inspect(raw([row()]), q),
                (e) => e.code === "invalid_request"
            );
    });
    await test("maximum entire acknowledgement growth fits reserved1024 bytes", async () => {
        const before = raw([row()]);
        const result = await codec.inspect(before, ask(id(1), "x".repeat(64)));
        const delta =
            Buffer.byteLength(result.afterRaw) - Buffer.byteLength(before);
        assert.equal(delta, 393);
        assert(delta <= 1024);
        assert.equal(
            Buffer.byteLength(
                JSON.stringify(
                    JSON.parse(result.afterRaw).entries[0].recovery_ack
                )
            ),
            377
        );
    });
    await test("every protected unack v2 row reserves1024, acknowledged history stillcounts32", async () => {
        let entries = Array.from({ length: 32 }, (_, i) => row(i + 1));
        const before = raw(entries);
        assert.equal(
            codec.capacity(before),
            Buffer.byteLength(before) + 32 * 1024 <= 65536
        );
        const result = await codec.inspect(before, ask());
        assert(result.acknowledgeAllowed);
        assert.equal(JSON.parse(result.afterRaw).entries.length, 32);
        assert(codec.capacity(result.afterRaw));
        assert.throws(
            () => codec.parse(raw([...entries, row(33)])),
            (e) => e.code === "invalid_ledger"
        );
        // Nonconforming old ledger is inspectable, but cannot authorize acknowledgement.
        entries = Array.from({ length: 32 }, (_, i) => ({
            ...row(i + 1),
            meta: { appliedStores: 1, code: "interrupted", totalStores: 2 },
            receipt: {
                counts: {
                    channelLists: 0,
                    channelMemberships: 0,
                    mediaFavorites: 0,
                    unresolved: 0,
                },
                document_sha256: "a".repeat(64),
                new_revision: "r".repeat(128),
                operation_id: id(i + 1),
                outcome: "unknown",
                persistence: "persistent",
                plan_digest: "c".repeat(64),
                scope: { ...row().scope, provider: "p".repeat(64) },
            },
            refs: { runtimeId: "r".repeat(128), stageId: "s".repeat(128) },
            scope: { ...row().scope, provider: "p".repeat(64) },
            state: "unknown",
        }));
        const full = raw(entries);
        assert(Buffer.byteLength(full) < 65536);
        assert.equal(codec.capacity(full), false);
        const denied = await codec.inspect(full, ask());
        assert.equal(denied.acknowledgeAllowed, false);
        assert.equal(denied.afterRaw, null);
    });
    await test("hash backend failure cannot yield a plan; backend commitment exact grant tuple", async () => {
        const grant = {
            implementationVersion: 1,
            kind: "synchronous-localstorage",
            lockName: "ottplay:favorites-ledger",
            origin: "https://synthetic.invalid",
            privateLedgerKey: "favorites-receipts.v1",
        };
        assert.equal(
            await codec.backendProof(grant),
            sha(
                JSON.stringify([
                    "ottplay-favorites-recovery-backend-v1",
                    grant.origin,
                    grant.privateLedgerKey,
                    grant.lockName,
                    grant.kind,
                    2,
                    1,
                ])
            )
        );
        await assert.rejects(
            codec.backendProof({ ...grant, implementationVersion: 2 })
        );
        const bad = exportsApi.createFavoritesRecoveryCodec({
            sha256: async () => "not-a-hash",
        });
        await assert.rejects(
            bad.inspect(raw([row()]), ask()),
            (e) => e.code === "hash_unavailable"
        );
    });
    console.log(`Favorites recovery codec: ${groups} groups passed`);
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
