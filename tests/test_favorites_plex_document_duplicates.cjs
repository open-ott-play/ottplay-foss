"use strict";
const assert = require("node:assert/strict"),
    fs = require("node:fs"),
    path = require("node:path"),
    vm = require("node:vm"),
    ts = require("typescript"),
    acorn = require("acorn"),
    { createRequire } = require("node:module");
const source = fs.readFileSync(
    path.join(__dirname, "../src/media/favorites-plex-document.ts"),
    "utf8"
);
const compiled = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES5,
    },
    reportDiagnostics: true,
});
assert.equal(compiled.diagnostics.length, 0);
acorn.parse(compiled.outputText, { ecmaVersion: 5 });
const context = { exports: {}, window: {} };
vm.runInNewContext(compiled.outputText, context);
const scope = {
    profileBindingId: "11111111-1111-4111-8111-111111111111",
    provider: "plex",
    sourceBindingId: "22222222-2222-4222-8222-222222222222",
};
let decodes = 0;
const codec = context.exports.createPlexFavoritesDocument({
    current: () => ({
        channelSourceId: "channel-source",
        current: () => true,
        serverId: "server-one",
        sourceId: "media-source",
        verified: true,
    }),
    json: {
        encode: (doc) => new Uint8Array(Buffer.from(JSON.stringify(doc))),
        parse: (bytes) => JSON.parse(Buffer.from(bytes).toString("utf8")),
    },
    plex: {
        decode: (locator) => {
            decodes++;
            return {
                request: { path: "/library/metadata/" + locator.ratingKey },
                sourceId: "media-source",
            };
        },
        encode: () => assert.fail("not used"),
    },
    references: { project: () => null, resolve: () => null },
});
const ref = (key, server = "server-one") => ({
    locator: { kind: "plex-media", ratingKey: key, serverId: server },
    state: "located",
});
const document = (rows) => ({
    channelLists: {
        active: "Favorites",
        default: { present: true, value: "Favorites" },
        lists: [{ entries: [], name: "Favorites" }],
        order: ["Favorites"],
    },
    coverage: {
        channelLists: "complete-for-scope",
        history: "excluded-preserved",
        mediaFavorites: "complete-for-scope",
        remoteAliases: "excluded-preserved",
    },
    mediaFavorites: rows,
    schema: 1,
    scope,
});
const bytes = (doc) => new Uint8Array(Buffer.from(JSON.stringify(doc)));
const before = {
    extra: { keep: true },
    favorites: [],
    history: [{ retained: "history" }],
    sourceId: "media-source",
    version: 1,
};
for (const duplicate of [
    ref("42"),
    { ...ref("42"), title: "different title" },
    {
        locator: {
            kind: "plex-media",
            ratingKey: "42",
            serverId: "server-one",
        },
        state: "located",
    },
]) {
    const doc = document([ref("42"), duplicate]);
    const original = JSON.stringify(doc),
        calls = decodes;
    for (const method of [
        () => codec.validate(bytes(doc), scope),
        () => codec.decode(bytes(doc), scope),
        () => codec.encode(doc),
        () => codec.prepare(bytes(doc), scope, before),
    ])
        assert.throws(method, (e) => e.message === "codec_error");
    assert.equal(
        decodes,
        calls,
        "duplicate import fails before local request construction"
    );
    assert.equal(JSON.stringify(doc), original);
}
const unique = document([ref("42"), ref("43")]);
codec.validate(bytes(unique), scope);
const prepared = codec.prepare(bytes(unique), scope, before);
assert.equal(prepared.ready, true);
assert.equal(prepared.counts.mediaFavorites, 2);
assert.deepEqual(
    JSON.parse(JSON.stringify(prepared.media.history)),
    before.history
);
assert.deepEqual(
    JSON.parse(JSON.stringify(prepared.media.extra)),
    before.extra
);
assert.deepEqual(
    JSON.parse(
        JSON.stringify(
            prepared.media.favorites.map((row) => row.payload.request.path)
        )
    ),
    ["/library/metadata/42", "/library/metadata/43"]
);
const foreign = document([ref("42"), ref("42", "server-two")]);
codec.validate(bytes(foreign), scope);
const unresolved = codec.prepare(bytes(foreign), scope, before);
assert.equal(unresolved.ready, false);
assert.equal(unresolved.counts.unresolved, 1);
const missing = {
    provenance: { legacyId: 4, origin: "raw" },
    reason: "missing",
    state: "unresolved",
};
const ambiguous = document([missing, JSON.parse(JSON.stringify(missing))]);
codec.validate(bytes(ambiguous), scope);
const blocked = codec.prepare(bytes(ambiguous), scope, before);
assert.equal(blocked.ready, false);
assert.equal(blocked.counts.unresolved, 2);
console.log(
    "PASS actual document duplicate checks before request construction; field order/title cannot evade; unique/history/foreign/unresolved preserved"
);
(async () => {
    const file = path.join(__dirname, "test_favorites_current_plex_host.cjs");
    let prefix = fs.readFileSync(file, "utf8");
    prefix = prefix.slice(0, prefix.indexOf("(async () => {"));
    const c = vm.createContext({
        __dirname: path.dirname(file),
        Buffer,
        clearTimeout,
        console,
        require: createRequire(file),
        setTimeout,
    });
    vm.runInContext(prefix + ";this.api={fixture,provision,staged,scope};", c, {
        filename: file,
    });
    const f = c.api.fixture({ populated: true }),
        paired = c.api.provision(f, "import", { scope: c.api.scope });
    const snapshot = await f.host
        .createAdapter(() => ({ budgetAccepted: true, operationFresh: true }))
        .snapshot(paired.scope, () => true);
    const doc = JSON.parse(Buffer.from(snapshot.bytes));
    doc.mediaFavorites.push({
        ...doc.mediaFavorites[0],
        title: "same locator different title",
    });
    const saved = [...f.saved],
        writes = f.writes.length;
    await assert.rejects(
        c.api.staged(f, paired.scope, doc),
        (error) => error.message === "codec_error"
    );
    assert.equal(f.writes.length, writes);
    assert.deepEqual(
        [...f.saved],
        saved,
        "real host failed ingestion preserves all physical stores/history"
    );
    doc.mediaFavorites.pop();
    const accepted = await c.api.staged(f, paired.scope, doc);
    assert.equal(accepted.preview.ready, true);
    assert.equal(accepted.preview.counts.mediaFavorites, 1);
    assert.equal(f.writes.length, writes);
    console.log(
        "PASS real host imported duplicate fails codec_error before reservation/writes; original unique document still preview-ready"
    );
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
