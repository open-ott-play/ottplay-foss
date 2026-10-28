"use strict";
const assert = require("node:assert/strict"),
    fs = require("node:fs"),
    path = require("node:path"),
    vm = require("node:vm"),
    crypto = require("node:crypto"),
    ts = require("typescript");
const root = path.resolve(__dirname, "..");
const clone = (value) => JSON.parse(JSON.stringify(value));
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const scope = {
    profileBindingId: "11111111-1111-4111-8111-111111111111",
    provider: "plex",
    sourceBindingId: "22222222-2222-4222-8222-222222222222",
};
const tvSource = "plex@channel-source",
    mediaSource = "plex@media-source";
const tvKey = "plexfavoritesLibrary:" + tvSource,
    mediaKey = "plexmediaJournal.v1:" + mediaSource;
const bindingKey = "favorites-bindings.v1",
    receiptKey = "favorites-receipts.v1";
function fixture({ populated = false, packed = false, instance = false } = {}) {
    const saved = new Map(),
        writes = [];
    let active = true,
        failure = null,
        counter = 10;
    const localStorage = {
        clear: () => saved.clear(),
        getItem: (key) => (saved.has(key) ? saved.get(key) : null),
        key: (i) => [...saved.keys()][i],
        get length() {
            return saved.size;
        },
        removeItem: (key) => saved.delete(key),
        setItem: (key, value) => {
            writes.push(key);
            if (failure === key) throw Error("synthetic private failure");
            saved.set(key, String(value));
        },
    };
    const w = {
        _: (x) => x,
        channels: {
            "plex-42": {
                __ottMediaItem: {
                    plexSource: mediaSource,
                    request: { path: "/library/metadata/42" },
                },
            },
        },
        localStorage,
        p_pref: "plex",
        sFavorites: 1,
    };
    const modules = new Map();
    function load(file) {
        file = path.resolve(root, file);
        if (modules.has(file)) return modules.get(file);
        const exports = {},
            context = vm.createContext({
                console,
                Date,
                document: { cookie: "" },
                Error,
                exports,
                Promise,
                require: (name) => {
                    if (!name.startsWith(".")) return require(name);
                    let next = path.resolve(path.dirname(file), name);
                    if (!path.extname(next)) next += ".ts";
                    return load(next);
                },
                Uint8Array,
                window: w,
            });
        modules.set(file, exports);
        vm.runInContext(
            ts.transpileModule(fs.readFileSync(file, "utf8"), {
                compilerOptions: {
                    module: ts.ModuleKind.CommonJS,
                    target: ts.ScriptTarget.ES2018,
                },
            }).outputText,
            context,
            { filename: file }
        );
        return exports;
    }
    const lz = load("src/utils/lzstring.ts");
    const tv = {
        defaultList: "Favorites",
        lists: {
            active: "Favorites",
            lists: { Favorites: [{ itemId: "channel:plex-42" }] },
            order: ["Favorites"],
            v: 1,
        },
        sourceId: tvSource,
        version: 2,
    };
    const row = {
        itemId: 'request:{"path":"/library/metadata/42"}',
        payload: {
            request: { path: "/library/metadata/42" },
            title: "Synthetic title",
        },
        position: 17,
        sourceId: mediaSource,
    };
    const media = {
        extra: { retained: true },
        favorites: [row],
        history: [clone(row)],
        sourceId: mediaSource,
        version: 1,
    };
    const encode = (value) =>
        packed
            ? "\x01LZ\x01" + lz.compress(JSON.stringify(value))
            : JSON.stringify(value);
    if (populated) {
        saved.set(tvKey, encode(tv));
        saved.set(mediaKey, encode(media));
    }
    const storageModule = load("src/storage/index.ts"),
        storage = storageModule.storage;
    Object.assign(w, {
        ottpStorage: storage,
        stbDelItem: storage.del,
        stbGetItem: storage.get,
        stbGetPersistedItem: storageModule.stbGetPersistedItem,
        stbSetItem: storage.set,
    });
    const read = (key) => {
        const value = storage.get("plex" + key);
        return value && value.startsWith("\x01LZ\x01")
            ? lz.decompress(value.slice(4))
            : value;
    };
    w.providerGetItem = read;
    w.providerGetPersistedItem = read;
    w.providerSetItem = (key, value) => storage.set("plex" + key, value);
    w.providerGetJson = (key, fallback) => {
        const value = read(key);
        return value === null ? fallback : JSON.parse(value);
    };
    w.__ottSourceIdentity = {
        current: () => tvSource,
        legacy: () => "plex",
        media: () => mediaSource,
    };
    const proof = {
        current: () => active,
        serverId: "server-one",
        sourceId: mediaSource,
        verified: true,
    };
    w.__ottActiveProviderDriver = {
        favoritesSource: () => (active ? proof : null),
        id: "plex",
    };
    const core = vm.createContext({});
    core.window = core;
    w.OttPlayCore = require("./helpers/shared-core-runtime.cjs")(core, {
        vendorOnly: true,
    });
    load("src/channels/channel-references.ts");
    load("src/channels/favorites-plex-references.ts");
    const favorites = load("src/channels/favorites-lists.ts");
    if (populated) favorites.loadFavoritesLists();
    if (populated) {
        saved.set(tvKey, encode(tv));
        saved.set(mediaKey, encode(media));
    }
    load("src/media/journal.ts");
    const journal = w.__ottMediaJournal.create({
        core: w.OttPlayCore,
        current: () => active,
        enabled: () => true,
        importRows: () => [],
        legacyId: "plex",
        limit: () => 1000,
        read,
        sourceId: mediaSource,
        write: w.providerSetItem,
    });
    const source = ts.createSourceFile(
        "classic-adapter.ts",
        fs.readFileSync(root + "/src/media/classic-adapter.ts", "utf8"),
        ts.ScriptTarget.Latest,
        true
    );
    let instanceProperty, globalProperty;
    function visit(node) {
        if (
            ts.isPropertyAssignment(node) &&
            node.name.getText(source) === "favoritesTransfer"
        ) {
            if (node.getText(source).includes("journal.adopt"))
                instanceProperty = node.getText(source);
            else if (node.getText(source).includes("No runtime is created"))
                globalProperty = node.getText(source);
        }
        ts.forEachChild(node, visit);
    }
    visit(source);
    assert(instanceProperty && globalProperty);
    const bridge = vm.createContext({
        collections() {},
        context: null,
        current: () => active,
        JSON,
        journal,
        source: mediaSource,
        w,
    });
    vm.runInContext(
        ts.transpileModule(
            "var api = {" +
                instanceProperty +
                "}; var mediaClassicInstance = " +
                (instance ? "api" : "null") +
                "; var external = {" +
                globalProperty +
                "};",
            { compilerOptions: { target: ts.ScriptTarget.ES2018 } }
        ).outputText,
        bridge
    );
    w.__ottMedia = bridge.external;
    const factory = load(
        "src/settings/favorites-current-plex-host.ts"
    ).createFavoritesCurrentPlexHost;
    const storagePorts = {
        compress: lz.compress,
        decompress: lz.decompress,
        recoveryRequired: storageModule.settingsRecoveryRequired,
    };
    const hostPorts = {
        now: () => 1000,
        sha256: hash,
        storage: storagePorts,
        utf8: (value) => new Uint8Array(Buffer.from(value, "utf8")),
        uuid: () =>
            "00000000-0000-4000-8000-" + String(counter++).padStart(12, "0"),
    };
    const host = factory(w, hostPorts);
    const createHost = (storage) => factory(w, { ...hostPorts, storage });
    writes.length = 0;
    return {
        bridge,
        createHost,
        failWrite: (key) => {
            failure = key;
        },
        favorites,
        host,
        hostPorts,
        journal,
        load,
        lz,
        media,
        read,
        revoke: () => {
            active = false;
        },
        saved,
        storagePorts,
        tv,
        w,
        writes,
    };
}
function provision(f, mode = "create", supplied = {}) {
    const cat = f.host.catalog();
    return f.host.provision(
        Object.assign(
            {
                codecVersion: 1,
                expected_binding_revision: cat.binding_revision,
                mode,
                op: "provision",
                runtime: "runtime-1",
                target_id: cat.targets[0].target_id,
            },
            supplied
        )
    );
}
function bytes(value) {
    return new Uint8Array(Buffer.from(JSON.stringify(value)));
}
async function staged(f, s, document) {
    const adapter = f.host.createAdapter(() => ({
        budgetAccepted: true,
        operationFresh: true,
    }));
    const snapshot = await adapter.snapshot(s, () => true);
    const input = document ? bytes(document) : snapshot.bytes;
    const context = {
        document_sha256: hash(input),
        operation_id: "33333333-3333-4333-8333-333333333333",
        runtime: "runtime-1",
        scope: s,
        transaction_id: "44444444-4444-4444-8444-444444444444",
    };
    const admission = await adapter.inspect(s, context.operation_id, context);
    const preview = await adapter.preview(input, s, admission, () => true);
    Object.assign(context, {
        bytes: input,
        counts: preview.counts,
        plan_digest: "a".repeat(64),
    });
    return { adapter, context, input, preview, snapshot };
}
(async () => {
    {
        const f = fixture();
        for (const storage of [
            undefined,
            null,
            {},
            { ...f.storagePorts, compress: null },
            { ...f.storagePorts, decompress: "invalid" },
            { ...f.storagePorts, recoveryRequired: () => undefined },
            { ...f.storagePorts, recoveryRequired: () => true },
        ]) {
            assert.equal(f.createHost(storage).qualified(), false);
        }
        assert.equal(f.saved.size, 0);
        assert.equal(f.writes.length, 0);
        assert.equal(f.host.qualified(), true);
        const paired = provision(f);
        const owner = f.host.captureContext();
        const binding = f.host.binding(paired.scope);
        const before = [...f.saved];
        f.hostPorts.storage = { ...f.storagePorts };
        assert.equal(f.host.qualified(), false);
        assert.equal(owner.current(), false);
        assert.equal(binding.current(), false);
        assert.deepEqual([...f.saved], before);
        f.hostPorts.storage = f.storagePorts;
        f.storagePorts.compress = (value) => value;
        assert.equal(f.host.qualified(), false);
        assert.equal(owner.current(), false);
        assert.deepEqual([...f.saved], before);
    }
    {
        const f = fixture();
        assert.equal(f.host.qualified(), true);
        assert.equal(f.saved.size, 0);
        assert.equal(f.host.catalog().bindings.length, 0);
        assert.equal(f.saved.size, 0);
        const paired = provision(f);
        assert.equal(paired.changed, true);
        assert.equal(paired.binding_revision, "1");
        assert.notEqual(
            paired.scope.profileBindingId,
            paired.scope.sourceBindingId
        );
        assert.deepEqual([...f.saved.keys()], [bindingKey]);
        assert.equal(f.host.catalog().bindings.length, 1);
        assert.equal(
            provision(f, "pair", { scope: paired.scope }).changed,
            false
        );
        const captured = f.host.captureContext();
        const stage = await staged(f, paired.scope);
        assert.equal(stage.preview.ready, true);
        assert.deepEqual(
            [...f.saved.keys()],
            [bindingKey],
            "snapshot/inspect/preview must not create missing stores or reserve durable receipt"
        );
        assert.equal(
            stage.preview.stores[0].expected_revision,
            hash(JSON.stringify({ value: null }))
        );
        const result = await stage.adapter.apply(
            { ...stage.preview, plan_digest: "a".repeat(64) },
            stage.context,
            captured.current
        );
        assert.equal(result.outcome, "verified");
        assert(
            f.saved.has(tvKey) &&
                f.saved.has(mediaKey) &&
                f.saved.has(receiptKey)
        );
        assert.equal(f.host.qualified(), true);
        assert.equal(captured.current(), true);
        assert.equal(f.host.captureContext().current(), true);
    }
    {
        const f = fixture({ instance: true, packed: true, populated: true });
        const physicalBefore = f.saved.get(mediaKey);
        assert.equal(f.host.qualified(), true);
        assert.equal(f.writes.length, 0);
        assert.equal(f.saved.get(mediaKey), physicalBefore);
        const paired = provision(f, "import", { scope });
        const snapshot = await f.host
            .createAdapter(() => null)
            .snapshot(paired.scope, () => true);
        const document = JSON.parse(Buffer.from(snapshot.bytes));
        document.mediaFavorites = [];
        const stage = await staged(f, paired.scope, document);
        assert.equal(
            stage.preview.stores[1].expected_revision,
            hash(JSON.stringify({ value: physicalBefore }))
        );
        const result = await stage.adapter.apply(
            { ...stage.preview, plan_digest: "b".repeat(64) },
            stage.context,
            () => true
        );
        assert.equal(result.outcome, "verified");
        const after = JSON.parse(f.read("mediaJournal.v1:" + mediaSource));
        assert.deepEqual(after.history, f.media.history);
        assert.deepEqual(after.extra, f.media.extra);
        assert.deepEqual(after.favorites, []);
        assert.deepEqual(
            clone(f.journal.peek().document.history),
            f.media.history
        );
        assert.equal(f.host.qualified(), true);
    }
    {
        const f = fixture();
        f.saved.set("plexmedHistory", JSON.stringify([{ private: "legacy" }]));
        assert.equal(f.host.qualified(), false);
        assert.equal(f.writes.length, 0);
        assert.equal(f.saved.size, 1);
    }
    {
        const f = fixture();
        f.saved.set(
            mediaKey,
            JSON.stringify({
                favorites: [],
                history: [{ position: -1 }],
                sourceId: mediaSource,
                version: 1,
            })
        );
        assert.equal(f.host.qualified(), false);
        assert.equal(f.writes.length, 0);
    }
    {
        const f = fixture();
        const cat = f.host.catalog();
        const args = {
            codecVersion: 1,
            expected_binding_revision: "0",
            mode: "create",
            op: "provision",
            runtime: "runtime-1",
            target_id: cat.targets[0].target_id,
        };
        for (const target of [
            "bad target",
            "/private/path",
            "x?token=secret",
            "-bad",
        ])
            assert.throws(
                () => f.host.provision({ ...args, target_id: target }),
                /invalid_request/
            );
        assert.throws(
            () =>
                f.host.provision({ ...args, expected_binding_revision: "01" }),
            /invalid_request/
        );
        assert.throws(
            () =>
                f.host.provision({
                    ...args,
                    expected_binding_revision: "9007199254740992",
                }),
            /invalid_request/
        );
        assert.equal(f.writes.length, 0);
        f.revoke();
        assert.equal(f.host.qualified(), false);
        assert.throws(() => f.host.provision(args));
        assert.equal(f.writes.length, 0);
    }
    {
        const f = fixture();
        const paired = provision(f, "import", { scope });
        const context = f.host.captureContext();
        f.saved.set(
            bindingKey,
            f.saved.get(bindingKey).replace('"revision":1', '"revision":2')
        );
        assert.equal(context.current(), false);
        assert.equal(f.host.binding(paired.scope).revision, "2");
    }
    {
        const f = fixture();
        const paired = provision(f, "import", { scope });
        const stage = await staged(f, paired.scope);
        f.failWrite(mediaKey);
        const result = await stage.adapter.apply(
            { ...stage.preview, plan_digest: "c".repeat(64) },
            stage.context,
            () => true
        );
        assert.notEqual(result.outcome, "verified");
        assert.throws(() => f.host.captureContext(), /unsupported_persistence/);
        assert.equal(
            f.host.qualified(),
            false,
            "memory fallback must not masquerade as durable storage"
        );
    }
    {
        const f = fixture();
        const paired = provision(f, "import", { scope });
        const ledger = f
            .load("src/settings/favorites-operation-receipts.ts")
            .createFavoritesOperationReceipts({
                compareAndSwap: (before, after) => {
                    if ((f.saved.get(receiptKey) || null) !== before)
                        return "conflict";
                    f.saved.set(receiptKey, after);
                    return "confirmed";
                },
                current: () => true,
                now: () => 1000,
                persistedRead: () => f.saved.get(receiptKey) || null,
                read: () => f.saved.get(receiptKey) || null,
            });
        ledger.reserve(
            {
                operationId: "33333333-3333-4333-8333-333333333333",
                payloadHash: "a".repeat(64),
                refs: {
                    runtimeId: "old-runtime",
                    stageId: "44444444-4444-4444-8444-444444444444",
                },
                scope: paired.scope,
            },
            { freshAdmission: true }
        );
        const before = f.saved.get(receiptKey);
        assert.throws(() => f.host.captureContext(), /reconciliation_required/);
        assert.equal(
            f.host.qualified(),
            true,
            "persisted pending blocks new admission, not read-only status"
        );
        assert.equal(f.saved.get(receiptKey), before);
    }
    {
        const f = fixture();
        const paired = provision(f, "import", { scope });
        const stage = await staged(f, paired.scope);
        const before = [...f.saved];
        f.w.__ottFavoritesLibrary.reset();
        await assert.rejects(
            stage.adapter.apply(stage.preview, stage.context, () => true),
            /reconciliation_required/
        );
        assert.deepEqual(
            [...f.saved],
            before,
            "stable admission must not weaken the actual write owner's cache fence"
        );
    }
    {
        // Compose the real gateway, registry, codecs, port and storage, not only adapter calls.
        const f = fixture();
        Object.assign(f.w, {
            atob: (value) => Buffer.from(value, "base64").toString("binary"),
            btoa: (value) => Buffer.from(value, "binary").toString("base64"),
            clearTimeout,
            crypto: crypto.webcrypto,
            setTimeout,
        });
        const gateway = f
            .load("src/plugins/favorites-transfer-runtime.ts")
            .createFavoritesTransferRuntime(f.w, {
                runtime: () => "runtime-1",
                storage: f.storagePorts,
            });
        async function call(input) {
            const params = { runtime: "runtime-1", ...input };
            const result = await gateway.execute(params, {
                current: () => true,
                deadlineAt: Date.now() + 60000,
                envelope: { action: "favorites_transfer", params },
                runtime: "runtime-1",
            });
            assert.equal(result.error, undefined, JSON.stringify(result));
            return result;
        }
        try {
            assert.equal((await gateway.capability()).version, 1);
            const catalog = await call({ op: "bindingcatalog" });
            assert.equal(f.saved.size, 0);
            const paired = await call({
                codecVersion: 1,
                expected_binding_revision: catalog.binding_revision,
                mode: "create",
                op: "provision",
                target_id: catalog.targets[0].target_id,
            });
            assert.deepEqual([...f.saved.keys()], [bindingKey]);
            const snapshot = await call({
                op: "snapshot",
                scope: paired.scope,
            });
            const document = JSON.parse(
                Buffer.from(snapshot.document_base64, "base64")
            );
            document.mediaFavorites = [
                {
                    locator: {
                        kind: "plex-media",
                        ratingKey: "42",
                        serverId: "server-one",
                    },
                    state: "located",
                    title: "Saved item",
                },
            ];
            const input = Buffer.from(JSON.stringify(document));
            const prepared = await call({
                binding_revision: snapshot.binding_revision,
                budget_ms: 300000,
                document_sha256: hash(input),
                expected_revision: snapshot.revision,
                op: "prepare",
                scope: paired.scope,
                size_bytes: input.length,
            });
            const started = await call({
                binding_revision: snapshot.binding_revision,
                chunk_count: 1,
                document_sha256: hash(input),
                expected_revision: snapshot.revision,
                op: "begin",
                operation_id: prepared.operation_id,
                persistence: "persistent",
                scope: paired.scope,
                size_bytes: input.length,
            });
            await call({
                chunk_sha256: hash(input),
                data_base64: input.toString("base64"),
                offset: 0,
                op: "append",
                seq: 0,
                transaction_id: started.transaction_id,
            });
            const preview = await call({
                op: "preview",
                transaction_id: started.transaction_id,
            });
            assert.equal(preview.ready, true);
            assert.deepEqual([...f.saved.keys()], [bindingKey]);
            const committed = await call({
                expected_revision: snapshot.revision,
                op: "commit",
                operation_id: prepared.operation_id,
                plan_digest: preview.plan_digest,
                transaction_id: started.transaction_id,
            });
            assert.equal(
                committed.outcome,
                "verified",
                JSON.stringify(committed)
            );
            assert.equal(committed.counts.mediaFavorites, 1);
            assert.equal(
                (
                    await call({
                        op: "status",
                        operation_id: prepared.operation_id,
                    })
                ).outcome,
                "verified"
            );
            assert.equal(
                JSON.parse(f.read("mediaJournal.v1:" + mediaSource)).favorites
                    .length,
                1
            );
            assert.equal((await gateway.capability()).version, 1);
        } finally {
            gateway.dispose();
        }
    }
    console.log(
        "PASS current Plex host: read-only empty qualification, one-write provisioning, strict DTOs, null/LZ preimages, preserved history/cache, ownership and persisted uncertainty"
    );
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
