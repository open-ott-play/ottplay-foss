const realCaselessKey =
    require("./helpers/global-favorites-main-ports.cjs").actualModule(
        "src/utils/caseless.ts",
        {}
    ).caselessKey;
const assert = require("node:assert/strict");
const { fixture, row, hash, load } = require("./global-favorites-fixture.cjs");
async function main() {
    const f = fixture(),
        // biome-ignore assist/source/useSortedKeys: Preserve the legacy fixture bytes used as migration input.
        old = {
            id: "fav-original",
            name: "Old",
            title: "Old TV",
            provider: "m3u",
            profile_name: "TV",
            profile_number: 1,
            kind: "live",
            source: "private",
            ref: { itemId: "001" },
        };
    f.data.set(
        "remoteFavorites.v1",
        // biome-ignore assist/source/useSortedKeys: Preserve the legacy fixture bytes used as migration input.
        JSON.stringify({ version: 1, entries: [old] })
    );
    const rows = Array.from({ length: 205 }, (_, i) => ({
        ...row("Item " + i),
        locator: { channelId: String(i + 1), kind: "channel" },
    }));
    let view = await f.store.snapshot();
    await f.store.mutate(view.revision, { entries: rows, op: "put" });
    let played = null;
    const facade = load(
        "src/settings/global-favorites-facade.ts"
    ).createGlobalFavoritesFacade({
        capture: async () => ({ current: () => true, value: rows[0] }),
        captureLegacy: async () => ({
            current: () => true,
            entry: { ...old },
            value: rows[0],
        }),
        caselessKey: realCaselessKey,
        codec: f.codec,
        current: () => true,
        locatorKinds: ["channel"],
        playEntry: (id, current) => ({
            cancel() {},
            result: Promise.resolve().then(() => {
                assert(current());
                played = id;
                return { status: "ok" };
            }),
        }),
        playLegacy: () => ({
            cancel() {},
            result: Promise.resolve({ status: "ok" }),
        }),
        qualify: () => f.committer.qualify(),
        sha256: async (s) => hash(s),
        store: f.store,
        uuid: () => "30000000-0000-4000-8000-000000000001",
    });
    const legacy = await facade.legacy({ op: "list" }, () => true);
    assert.equal(legacy.entries.length, 1);
    assert.equal(legacy.entries[0].id, "fav-original");
    assert.deepEqual(Object.keys(legacy.entries[0]).sort(), [
        "id",
        "kind",
        "name",
        "profile_name",
        "profile_number",
        "provider",
        "title",
    ]);
    const first = await facade.list(null, 100);
    assert.equal(first.total, 205);
    assert(first.entries.length <= 100);
    const second = await facade.list(first.next_cursor, 100);
    assert.equal(
        second.entries[0].id,
        (await f.store.snapshot()).entries[first.entries.length].id
    );
    await facade.legacy({ op: "add" }, () => true);
    view = await f.store.snapshot();
    assert.equal(view.entries.length, 205);
    assert.equal(view.privateLegacy().entries[0].id, "fav-original");
    const play = await facade.legacy(
        { id: "fav-original", op: "play" },
        () => true
    );
    const result = await play.result;
    assert.equal(played, view.entries[0].id);
    assert.equal(result.dispatched, true);
    assert.equal(result.entry.id, "fav-original");
    await facade.legacy({ id: "fav-original", op: "remove" }, () => true);
    view = await f.store.snapshot();
    assert.equal(view.entries.length, 204);
    assert.equal(view.privateLegacy().entries.length, 0);
    const stable = view.entries[0],
        input = {
            entries: [
                {
                    locator: stable.locator,
                    origin: stable.origin,
                    title: "Changed title",
                },
                {
                    ...row("New"),
                    locator: { channelId: "999", kind: "channel" },
                },
            ],
            version: 1,
        };
    view = await f.store.snapshot();
    await f.store.mutate(view.revision, { entries: input.entries, op: "put" });
    view = await f.store.snapshot();
    assert.equal(view.entries[0].title, stable.title);
    assert.equal(view.entries.at(-1).title, "New");
    const raw = f.data.get("remoteFavorites.v1"),
        ids = view.entries.slice(0, 2).map((x) => x.id);
    await f.store.mutate(view.revision, {
        entries: [view.entries[1], view.entries[0]].map(
            ({ title, origin, locator }) => ({ locator, origin, title })
        ),
        op: "replace",
    });
    view = await f.store.snapshot();
    assert.deepEqual(
        Array.from(view.entries.map((x) => x.id)),
        Array.from(ids).reverse()
    );
    assert.notEqual(f.data.get("remoteFavorites.v1"), raw);
    const wrapper = load("src/commands/remote-favorites-global.ts"),
        w = {
            __ottGlobalFavoritesFacade: facade,
            __ottGlobalFavoritesPorts: { runtime: () => "runtime" },
        };
    const before = f.events.length;
    const listed = await new Promise((done) =>
        wrapper.executeLegacySharedFavorites(
            w,
            "runtime",
            { params: { op: "list" } },
            done,
            () => true
        )
    );
    assert.equal(listed.status, "ok");
    assert.equal(f.events.length, before);
    const rejected = await new Promise((done) =>
        wrapper.executeLegacySharedFavorites(
            w,
            "runtime",
            { params: { op: "add" } },
            done,
            () => false
        )
    );
    assert.equal(rejected.status, "rejected");
    assert.equal(f.events.length, before);
    console.log(
        "PASS shared facade: legacy100 fields/IDs + global205, full-store CAS preservation, alias routing, stable order/title conflict and replace"
    );
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
