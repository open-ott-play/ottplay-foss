"use strict";
const assert = require("node:assert/strict"),
    fs = require("node:fs");
const { fixture, row, hash, load } = require("./global-favorites-fixture.cjs");
async function main() {
    const f = fixture(),
        cases = [];
    let serial = 0;
    const ports = {
        authorized: () => true,
        base64Decode: (x) => new Uint8Array(Buffer.from(x, "base64")),
        base64Encode: (x) => Buffer.from(x).toString("base64"),
        captureContext: async () => ({
            current: () => true,
            revision: f.context,
        }),
        clearTimer() {},
        codec: f.codec,
        committer: f.committer,
        current: () => true,
        facade: {
            exportSnapshot: async () => {
                const s = await f.store.snapshot();
                return {
                    current: s.current,
                    document: f.codec.document({
                        entries: s.entries.map(
                            ({ title, origin, locator }) => ({
                                locator,
                                origin,
                                title,
                            })
                        ),
                        version: 1,
                    }),
                };
            },
        },
        locatorKinds: [
            "vportal-media",
            "channel",
            "plex-media",
            "local-media",
            "channel-name",
        ],
        now: () => 1000000,
        resolve: async (entries) => entries.map(() => "missing"),
        runtime: () => "runtime-one",
        setTimer: () => 1,
        sha256: async (x) => hash(x),
        store: f.store,
        uuid: () =>
            `20000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`,
    };
    const api = load(
        "src/commands/global-favorites-protocol.ts"
    ).createGlobalFavoritesProtocol(ports);
    f.hooks.authority = (id, h) => api.freshAdmission(id, h);
    f.hooks.statusAllowed = true;
    async function call(op, rest = {}) {
        const params = { op, runtime: "runtime-one", ...rest },
            data = await api.execute(params, 512, 1030);
        cases.push({
            data,
            family: "core",
            params,
            status: data.error ? "rejected" : "ok",
        });
        return data;
    }
    async function stage(mode, entries) {
        const d = await call("describe");
        assert.deepEqual(Array.from(d.locator_kinds), [
            "channel",
            "channel-name",
            "local-media",
            "plex-media",
            "vportal-media",
        ]);
        assert.equal(typeof d.export.expires_at, "string");
        const doc = f.codec.document({ entries, version: 1 }),
            bytes = Buffer.from(JSON.stringify(doc)),
            begin = await call("begin", {
                budget_ms: 45000,
                chunk_count: 1,
                document_sha256: hash(bytes),
                expected_context_revision: d.context_revision,
                expected_revision: d.revision,
                mode,
                operation_id: d.admission.operation_id,
                required_kinds: f.codec
                    .requiredLocatorKinds(doc)
                    .slice()
                    .sort(),
                size_bytes: bytes.length,
            });
        assert.equal(begin.error, undefined);
        assert.equal(typeof begin.absolute_expires_at, "string");
        await call("append", {
            chunk_sha256: hash(bytes),
            data_base64: bytes.toString("base64"),
            offset: 0,
            seq: 0,
            transaction_id: begin.transaction_id,
        });
        const preview = await call("preview", {
            max_entries: 64,
            page_offset: 0,
            transaction_id: begin.transaction_id,
        });
        assert.equal(preview.error, undefined);
        return { begin, preview };
    }
    const a = row("A"),
        b = { ...row("B"), locator: { channelId: "002", kind: "channel" } };
    let staged = await stage("merge", [a]);
    let result = await call("commit", {
        operation_id: staged.begin.operation_id,
        plan_digest: staged.preview.plan_digest,
        transaction_id: staged.begin.transaction_id,
    });
    assert.equal(result.receipt.outcome, "verified");
    assert.deepEqual(Array.from(result.receipt.required_kinds), ["channel"]);
    await call("status", { operation_id: staged.begin.operation_id });
    staged = await stage("merge", [b]);
    assert.equal(staged.preview.counts.after, 2);
    assert.equal(staged.preview.rows.length, 2);
    assert.equal(staged.preview.resolution_counts.missing, 2);
    await call("commit", {
        operation_id: staged.begin.operation_id,
        plan_digest: staged.preview.plan_digest,
        transaction_id: staged.begin.transaction_id,
    });
    staged = await stage("merge", [row("Renamed A")]);
    assert.equal(staged.preview.ready, false);
    assert.equal(
        staged.preview.rows[0].metadata_conflict.incoming_entry_index,
        0
    );
    await call("abort", {
        operation_id: staged.begin.operation_id,
        transaction_id: staged.begin.transaction_id,
    });
    staged = await stage("replace", [row("Renamed A")]);
    assert.equal(staged.preview.ready, true);
    assert(
        staged.preview.rows.every((x) => !Object.hasOwn(x, "metadata_conflict"))
    );
    await call("abort", {
        operation_id: staged.begin.operation_id,
        transaction_id: staged.begin.transaction_id,
    });
    const stale = { op: "describe", runtime: "runtime-old" },
        staleData = await api.execute(stale, 128, 1030);
    assert.equal(staleData.runtime, "runtime-old");
    assert(staleData.error);
    cases.push({
        data: staleData,
        family: "core",
        params: stale,
        status: "rejected",
    });
    for (const family of ["core", "recovery"]) {
        let calls = 0,
            value;
        const w = {
            __ottEnsureGlobalFavorites() {
                calls++;
                throw Error("must not initialize on stale runtime");
            },
        };
        const params = {
            op: family === "core" ? "describe" : "inspect",
            runtime: "runtime-old",
            ...(family === "recovery"
                ? { cursor: null, subject: "global" }
                : {}),
        };
        const module = load(
            family === "core"
                ? "src/commands/remote-favorites-global.ts"
                : "src/commands/remote-favorites-global-recovery.ts"
        );
        const execute =
            family === "core"
                ? module.executeGlobalFavorites
                : module.executeGlobalFavoritesRecovery;
        execute(w, "runtime-one", { expires_at: 1030, params }, (r) => {
            value = r;
        });
        assert.equal(calls, 0);
        assert.equal(value.data.runtime, "runtime-old");
        assert.equal(value.data.error, "runtime_changed");
        cases.push({ data: value.data, family, params, status: value.status });
    }
    if (process.argv[2])
        fs.writeFileSync(
            process.argv[2],
            JSON.stringify(cases, null, 2) + "\n"
        );
    console.log(
        "PASS actual global wire outputs: merged result preview, RFC3339, receipt kinds, no-op stale runtime and title conflict semantics"
    );
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
