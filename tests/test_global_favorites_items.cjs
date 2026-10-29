"use strict";
const assert = require("node:assert/strict");
const { load, fixture, row } = require("./global-favorites-fixture.cjs");
async function main() {
    const f = fixture(),
        runtime = "runtime-1";
    let now = 1000,
        contextRevision = f.context,
        contextAlive = true,
        plays = 0,
        playStatus = "ok";
    let snapshot = await f.store.snapshot();
    const entries = Array.from({ length: 207 }, (_, i) => ({
        ...row(`Film ${i}`),
        locator: { channelId: String(i), kind: "channel" },
    }));
    await f.store.mutate(snapshot.revision, { entries, op: "put" });
    const factory = load(
        "src/commands/global-favorites-items.ts"
    ).createGlobalFavoritesItems;
    const host = {
        captureContext: async () => ({
            current: () => contextAlive,
            revision: contextRevision,
        }),
        currentItem: async () => {
            const s = await f.store.snapshot();
            return {
                context_revision: contextRevision,
                current: () => s.current() && contextAlive,
                entry: row(),
                revision: s.revision,
                unavailable_reason: null,
            };
        },
        playUUID(id, revision, context, admitted) {
            plays++;
            return {
                cancel() {},
                result: (async () => {
                    assert(admitted());
                    assert.equal((await f.store.snapshot()).revision, revision);
                    assert.equal(context, contextRevision);
                    return { id, status: playStatus };
                })(),
            };
        },
        store: f.store,
    };
    const items = factory({
        authorized: () => true,
        base64Decode: (s) => Uint8Array.from(Buffer.from(s, "base64")),
        base64Encode: (b) => Buffer.from(b).toString("base64"),
        codec: f.codec,
        current: () => true,
        host,
        now: () => now,
        runtime: () => runtime,
    });
    const send = (p) =>
        items.execute(
            { runtime, subject: "global", ...p },
            256,
            20,
            () => true
        );
    let cursor = null,
        ids = [],
        revision;
    do {
        const result = await send({ cursor, max_entries: 100, op: "list" });
        assert.equal(result.error, undefined);
        assert.equal(result.total, 207);
        assert(result.entries.length <= 100);
        assert(Buffer.byteLength(JSON.stringify(result)) <= 65536);
        assert.equal(result.page_offset, ids.length);
        revision = result.revision;
        ids.push(...result.entries.map((x) => x.id));
        cursor = result.next_cursor;
    } while (cursor);
    assert.equal(new Set(ids).size, 207);
    assert.equal(plays, 0);
    assert.equal(f.events.length, 1);
    const first = await send({ cursor: null, max_entries: 1, op: "list" });
    contextRevision = "a".repeat(64);
    assert.equal(
        (await send({ cursor: first.next_cursor, max_entries: 1, op: "list" }))
            .error,
        "context_changed"
    );
    contextRevision = f.context;
    snapshot = await f.store.snapshot();
    await f.store.mutate(snapshot.revision, { ids: [ids[206]], op: "remove" });
    assert.equal(
        (await send({ cursor: first.next_cursor, max_entries: 1, op: "list" }))
            .error,
        "revision_conflict"
    );
    assert.equal(
        (await send({ cursor: "invalid", max_entries: 100, op: "list" })).error,
        "invalid_cursor"
    );
    const current = await send({ op: "current" });
    assert.equal(current.entry.title, "Film");
    assert.equal(f.events.length, 2);
    assert.equal(plays, 0);
    assert.equal(
        (
            await send({
                expected_context_revision: f.context,
                expected_revision: current.revision,
                id: ids[0],
                op: "play",
            })
        ).dispatched,
        true
    );
    assert.equal(plays, 1);
    // biome-ignore assist/source/useSortedKeys: Preserve the sequential stateful error-case exercise order.
    for (const [status, error] of Object.entries({
        cancelled: "cancelled",
        timeout: "expired",
        blocked: "policy_denied",
        changed: "context_changed",
        missing: "favorite_not_found",
        unsupported: "unsupported_item",
        ambiguous: "ambiguous_source",
        unavailable: "item_unavailable",
    })) {
        playStatus = status;
        assert.equal(
            (
                await send({
                    expected_context_revision: f.context,
                    expected_revision: current.revision,
                    id: ids[0],
                    op: "play",
                })
            ).error,
            error
        );
    }
    playStatus = "ok";
    assert.equal(
        (await send({ op: "current", unexpected: true })).error,
        "invalid_request"
    );
    now = 20000;
    assert.equal((await send({ op: "current" })).error, "expired");
    assert.equal(
        (
            await items.execute(
                { op: "current", runtime, subject: "global" },
                16385,
                50,
                () => true
            )
        ).error,
        "envelope_too_large"
    );
    assert.equal(
        f.events.length,
        2,
        "list/current/play never write membership"
    );
    console.log("Global Favorites items source tests passed");
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
