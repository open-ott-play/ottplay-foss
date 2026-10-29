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
        locator: { kind: "channel", channelId: String(i) },
    }));
    await f.store.mutate(snapshot.revision, { op: "put", entries });
    const factory = load(
        "src/commands/global-favorites-items.ts"
    ).createGlobalFavoritesItems;
    const host = {
        store: f.store,
        captureContext: async () => ({
            revision: contextRevision,
            current: () => contextAlive,
        }),
        currentItem: async () => {
            const s = await f.store.snapshot();
            return {
                revision: s.revision,
                context_revision: contextRevision,
                entry: row(),
                unavailable_reason: null,
                current: () => s.current() && contextAlive,
            };
        },
        playUUID(id, revision, context, admitted) {
            plays++;
            return {
                result: (async () => {
                    assert(admitted());
                    assert.equal((await f.store.snapshot()).revision, revision);
                    assert.equal(context, contextRevision);
                    return { status: playStatus, id };
                })(),
                cancel() {},
            };
        },
    };
    const items = factory({
        host,
        codec: f.codec,
        current: () => true,
        runtime: () => runtime,
        now: () => now,
        authorized: () => true,
        base64Encode: (b) => Buffer.from(b).toString("base64"),
        base64Decode: (s) => Uint8Array.from(Buffer.from(s, "base64")),
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
        const result = await send({ op: "list", cursor, max_entries: 100 });
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
    const first = await send({ op: "list", cursor: null, max_entries: 1 });
    contextRevision = "a".repeat(64);
    assert.equal(
        (await send({ op: "list", cursor: first.next_cursor, max_entries: 1 }))
            .error,
        "context_changed"
    );
    contextRevision = f.context;
    snapshot = await f.store.snapshot();
    await f.store.mutate(snapshot.revision, { op: "remove", ids: [ids[206]] });
    assert.equal(
        (await send({ op: "list", cursor: first.next_cursor, max_entries: 1 }))
            .error,
        "revision_conflict"
    );
    assert.equal(
        (await send({ op: "list", cursor: "invalid", max_entries: 100 })).error,
        "invalid_cursor"
    );
    const current = await send({ op: "current" });
    assert.equal(current.entry.title, "Film");
    assert.equal(f.events.length, 2);
    assert.equal(plays, 0);
    assert.equal(
        (
            await send({
                op: "play",
                id: ids[0],
                expected_revision: current.revision,
                expected_context_revision: f.context,
            })
        ).dispatched,
        true
    );
    assert.equal(plays, 1);
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
                    op: "play",
                    id: ids[0],
                    expected_revision: current.revision,
                    expected_context_revision: f.context,
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
