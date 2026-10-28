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
function testLocks() {
    let held = false;
    return {
        request(_name, _options, callback) {
            if (held) return Promise.resolve().then(() => callback(null));
            held = true;
            return Promise.resolve()
                .then(() => callback({}))
                .finally(() => {
                    held = false;
                });
        },
    };
}
function fixture({
    populated = false,
    packed = false,
    instance = false,
    locks = testLocks(),
} = {}) {
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
        location: { origin: "https://player.example" },
        navigator: { locks },
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
        captureFavoritesPhysicalRead:
            storageModule.captureFavoritesPhysicalRead,
        captureFavoritesPhysicalStorage:
            storageModule.captureFavoritesPhysicalStorage,
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
async function retainedOutcome(f, pairedScope, state = "pending") {
    const grant = f.host.physicalStorage();
    const fence = {
        backendProof: hash(
            JSON.stringify([
                "ottplay-favorites-recovery-backend-v1",
                grant.origin,
                grant.privateLedgerKey,
                grant.lockName,
                grant.kind,
                2,
                grant.implementationVersion,
            ])
        ),
        guardImplementationVersion: 1,
        version: 2,
    };
    let held = false;
    const ledger = f
        .load("src/settings/favorites-operation-receipts.ts")
        .createFavoritesOperationReceipts({
            compareAndSwap: (before, after) =>
                grant.compareAndSwap(receiptKey, before, after),
            current: () => true,
            fence: () => fence,
            now: () => 1000,
            persistedRead: () => f.saved.get(receiptKey) || null,
            read: () => f.saved.get(receiptKey) || null,
            writeGuard: (value) =>
                held &&
                grant.current() &&
                JSON.stringify(value) === JSON.stringify(fence),
        });
    return grant.exclusive(() => {
        held = true;
        const ticket = ledger.reserve(
            {
                operationId: "33333333-3333-4333-8333-333333333333",
                payloadHash: "a".repeat(64),
                refs: {
                    runtimeId: "old-runtime",
                    stageId: "44444444-4444-4444-8444-444444444444",
                },
                scope: pairedScope,
            },
            { freshAdmission: true }
        );
        if (state !== "pending")
            ledger.commitCompletion(
                ledger.materializeCompletion(
                    ledger.prepareCompletion(ticket, {
                        counts: {
                            channelLists: 0,
                            channelMemberships: 0,
                            mediaFavorites: 0,
                            unresolved: 0,
                        },
                        meta: {
                            appliedStores: 1,
                            code: "none",
                            totalStores: 2,
                        },
                        newRevision: "favorites-retained",
                        persistence: "persistent",
                        state,
                    }),
                    "b".repeat(64)
                )
            );
        held = false;
        return ledger;
    });
}
const replacementScope = {
    profileBindingId: "55555555-5555-4555-8555-555555555555",
    provider: "plex",
    sourceBindingId: "66666666-6666-4666-8666-666666666666",
};
(async () => {
    {
        const f = fixture();
        const initial = provision(f, "import", { scope });
        const competing = f.createHost(f.storagePorts);
        const otherCat = competing.catalog(),
            cat = f.host.catalog();
        const thirdScope = {
            profileBindingId: "77777777-7777-4777-8777-777777777777",
            provider: "plex",
            sourceBindingId: "88888888-8888-4888-8888-888888888888",
        };
        const driver = f.w.__ottActiveProviderDriver;
        const get = f.w.localStorage.getItem;
        let injected = false,
            concurrentResult,
            concurrentBytes;
        f.w.localStorage.getItem = (key) => {
            // Reenter through the real durable guard AFTER the first CAS byte check.
            if (
                !injected &&
                key === receiptKey &&
                /at cas \(/.test(new Error().stack)
            ) {
                injected = true;
                concurrentResult = competing.provision({
                    codecVersion: 1,
                    expected_binding_revision: otherCat.binding_revision,
                    mode: "replace-current",
                    op: "provision",
                    prior_scope: scope,
                    runtime: "concurrent-runtime",
                    scope: thirdScope,
                    target_id: otherCat.targets[0].target_id,
                });
                concurrentBytes = f.saved.get(bindingKey);
            }
            return get(key);
        };
        assert.throws(
            () =>
                f.host.provision({
                    codecVersion: 1,
                    expected_binding_revision: cat.binding_revision,
                    mode: "replace-current",
                    op: "provision",
                    prior_scope: scope,
                    runtime: "first-runtime",
                    scope: replacementScope,
                    target_id: cat.targets[0].target_id,
                }),
            /binding_changed/
        );
        assert.equal(injected, true);
        assert.equal(initial.binding_revision, "1");
        assert.equal(concurrentResult.outcome, "verified");
        assert.equal(concurrentResult.binding_revision, "2");
        assert.equal(f.w.__ottActiveProviderDriver, driver);
        assert.equal(
            f.saved.get(bindingKey),
            concurrentBytes,
            "outer stale CAS preserves the second real host's exact binding bytes"
        );
        assert.equal(
            f.writes.filter((key) => key === bindingKey).length,
            2,
            "only initial provisioning and the competing host wrote registry"
        );
        assert.equal(f.host.binding(thirdScope).current(), true);
        assert.equal(f.saved.has(receiptKey), false);
    }
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
        const ledger = await retainedOutcome(f, paired.scope);
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
    {
        // Transfer the unchanged export between independent physical stores and runtimes.
        const source = fixture({
                instance: true,
                packed: true,
                populated: true,
            }),
            destination = fixture();
        function client(f, runtime) {
            Object.assign(f.w, {
                atob: (value) =>
                    Buffer.from(value, "base64").toString("binary"),
                btoa: (value) =>
                    Buffer.from(value, "binary").toString("base64"),
                clearTimeout,
                crypto: crypto.webcrypto,
                setTimeout,
            });
            const gateway = f
                .load("src/plugins/favorites-transfer-runtime.ts")
                .createFavoritesTransferRuntime(f.w, {
                    runtime: () => runtime,
                    storage: f.storagePorts,
                });
            return {
                async call(input) {
                    const params = { runtime, ...input };
                    const result = await gateway.execute(params, {
                        current: () => true,
                        deadlineAt: Date.now() + 60000,
                        envelope: { action: "favorites_transfer", params },
                        runtime,
                    });
                    assert.equal(
                        result.error,
                        undefined,
                        JSON.stringify(result)
                    );
                    return result;
                },
                dispose: () => gateway.dispose(),
            };
        }
        const sender = client(source, "roundtrip-source"),
            receiver = client(destination, "roundtrip-destination");
        try {
            assert.notEqual(source.saved, destination.saved);
            assert(source.saved.get(tvKey).startsWith("\x01LZ\x01"));
            assert(source.saved.get(mediaKey).startsWith("\x01LZ\x01"));
            const catalog = await sender.call({ op: "bindingcatalog" });
            const paired = await sender.call({
                codecVersion: 1,
                expected_binding_revision: catalog.binding_revision,
                mode: "create",
                op: "provision",
                target_id: catalog.targets[0].target_id,
            });
            const sourceBefore = [...source.saved];
            source.writes.length = 0;
            const exported = await sender.call({
                op: "snapshot",
                scope: paired.scope,
            });
            const input = Buffer.from(exported.document_base64, "base64");
            assert.equal(hash(input), exported.document_sha256);
            assert.equal(input.length, exported.size_bytes);
            assert.deepEqual(clone(exported.scope), clone(paired.scope));

            const targetCatalog = await receiver.call({ op: "bindingcatalog" });
            assert.equal(destination.saved.size, 0);
            assert.deepEqual(destination.writes, []);
            const imported = await receiver.call({
                codecVersion: 1,
                expected_binding_revision: targetCatalog.binding_revision,
                mode: "import",
                op: "provision",
                scope: paired.scope,
                target_id: targetCatalog.targets[0].target_id,
            });
            assert.deepEqual(clone(imported.scope), clone(paired.scope));
            const targetBefore = [...destination.saved];
            destination.writes.length = 0;
            const empty = await receiver.call({
                op: "snapshot",
                scope: imported.scope,
            });
            assert.equal(
                JSON.parse(Buffer.from(empty.document_base64, "base64"))
                    .mediaFavorites.length,
                0
            );
            const prepared = await receiver.call({
                binding_revision: empty.binding_revision,
                budget_ms: 300000,
                document_sha256: exported.document_sha256,
                expected_revision: empty.revision,
                op: "prepare",
                scope: imported.scope,
                size_bytes: input.length,
            });
            const started = await receiver.call({
                binding_revision: empty.binding_revision,
                chunk_count: 1,
                document_sha256: exported.document_sha256,
                expected_revision: empty.revision,
                op: "begin",
                operation_id: prepared.operation_id,
                persistence: "persistent",
                scope: imported.scope,
                size_bytes: input.length,
            });
            await receiver.call({
                chunk_sha256: exported.document_sha256,
                data_base64: exported.document_base64,
                offset: 0,
                op: "append",
                seq: 0,
                transaction_id: started.transaction_id,
            });
            const preview = await receiver.call({
                op: "preview",
                transaction_id: started.transaction_id,
            });
            assert.equal(preview.ready, true);
            assert.deepEqual(clone(preview.counts), {
                channelLists: 1,
                channelMemberships: 1,
                mediaFavorites: 1,
                unresolved: 0,
            });
            assert.deepEqual([...destination.saved], targetBefore);
            assert.deepEqual(
                destination.writes,
                [],
                "staging must not write the destination"
            );
            const committed = await receiver.call({
                expected_revision: empty.revision,
                op: "commit",
                operation_id: prepared.operation_id,
                plan_digest: preview.plan_digest,
                transaction_id: started.transaction_id,
            });
            assert.equal(committed.outcome, "verified");
            assert.equal(
                committed.receipt.document_sha256,
                exported.document_sha256
            );
            assert.deepEqual(
                clone(committed.receipt.scope),
                clone(paired.scope)
            );
            const status = await receiver.call({
                op: "status",
                operation_id: prepared.operation_id,
            });
            assert.equal(status.outcome, "verified");
            assert.deepEqual(clone(status.receipt), clone(committed.receipt));
            const restored = await receiver.call({
                op: "snapshot",
                scope: imported.scope,
            });
            assert.deepEqual(clone(restored.scope), clone(paired.scope));
            assert.deepEqual(
                JSON.parse(Buffer.from(restored.document_base64, "base64")),
                JSON.parse(input),
                "re-export must preserve the portable document without rewriting the input"
            );
            assert.deepEqual(
                JSON.parse(destination.read("favoritesLibrary:" + tvSource)),
                source.tv
            );
            const restoredMedia = JSON.parse(
                destination.read("mediaJournal.v1:" + mediaSource)
            );
            assert.equal(restoredMedia.favorites.length, 1);
            assert.deepEqual(
                restoredMedia.history,
                [],
                "favorites transfer must not import source viewing history"
            );
            assert.deepEqual([...source.saved], sourceBefore);
            assert.deepEqual(
                source.writes,
                [],
                "export and destination restore must leave the source unchanged"
            );
        } finally {
            sender.dispose();
            receiver.dispose();
        }
    }
    for (const state of ["pending", "partial", "unknown"]) {
        for (const mode of ["create", "import", "pair", "replace-current"]) {
            const f = fixture(),
                paired = provision(f, "import", { scope });
            const ledger = await retainedOutcome(f, paired.scope, state);
            const fresh = f.createHost(f.storagePorts),
                cat = fresh.catalog();
            const before = [...f.saved],
                writes = f.writes.length;
            const args = {
                codecVersion: 1,
                expected_binding_revision: cat.binding_revision,
                mode,
                op: "provision",
                runtime: "fresh-runtime",
                target_id: cat.targets[0].target_id,
            };
            if (mode !== "create")
                args.scope = mode === "pair" ? paired.scope : replacementScope;
            if (mode === "replace-current") args.prior_scope = paired.scope;
            assert.throws(
                () => fresh.provision(args),
                /reconciliation_required/,
                state + ":" + mode
            );
            assert.throws(
                () => fresh.captureContext(),
                /reconciliation_required/
            );
            assert.deepEqual(
                [...f.saved],
                before,
                "protected authority and registry bytes unchanged"
            );
            assert.equal(
                f.writes.length,
                writes,
                "no attempted storage writes"
            );
            assert.equal(
                fresh.binding(paired.scope).current(),
                true,
                "old scope remains bound for reconciliation"
            );
            assert.equal(
                fresh.qualified(),
                true,
                "read-only qualification remains available"
            );
            assert.equal(fresh.catalog().bindings.length, 1);
            assert.equal(
                ledger.status("33333333-3333-4333-8333-333333333333").state,
                state
            );
            await fresh
                .createAdapter(() => null)
                .status("33333333-3333-4333-8333-333333333333", () => true);
            assert.deepEqual(
                [...f.saved],
                before,
                "read-only status never clears protected receipt"
            );
        }
    }
    {
        const f = fixture(),
            paired = provision(f, "import", { scope });
        await retainedOutcome(f, paired.scope);
        const pending = f.saved.get(receiptKey);
        f.saved.delete(receiptKey);
        const fresh = f.createHost(f.storagePorts),
            cat = fresh.catalog();
        const prior = f.saved.get(bindingKey),
            writes = f.writes.length;
        const get = f.w.localStorage.getItem;
        let armed = true;
        f.w.localStorage.getItem = (key) => {
            // Registry read follows the initial ledger check, before actual CAS.
            if (armed && key === bindingKey) {
                armed = false;
                f.saved.set(receiptKey, pending);
            }
            return get(key);
        };
        assert.throws(
            () =>
                fresh.provision({
                    codecVersion: 1,
                    expected_binding_revision: cat.binding_revision,
                    mode: "replace-current",
                    op: "provision",
                    prior_scope: paired.scope,
                    runtime: "fresh-runtime",
                    scope: replacementScope,
                    target_id: cat.targets[0].target_id,
                }),
            /reconciliation_required/
        );
        assert.equal(armed, false, "pending appeared after initial preflight");
        assert.equal(f.saved.get(bindingKey), prior);
        assert.equal(f.saved.get(receiptKey), pending);
        assert.equal(
            f.writes.length,
            writes,
            "CAS boundary fence prevents target write"
        );
        assert.equal(fresh.binding(paired.scope).current(), true);
    }
    {
        const f = fixture({ populated: true });
        const paired = provision(f, "import", { scope });
        const stage = await staged(f, paired.scope);
        // Another guarded operation reserves a protected row after the final
        // inspected/previewed before image and before this apply acquires its lock.
        await retainedOutcome(f, paired.scope);
        const before = [...f.saved],
            writes = f.writes.length;
        await assert.rejects(
            stage.adapter.apply(stage.preview, stage.context, () => true),
            (error) => error.code === "ledger_changed"
        );
        assert.equal(
            f.writes.length,
            writes,
            "competing ledger prevents all native target/reservation writes"
        );
        assert.deepEqual(
            [...f.saved],
            before,
            "complete ledger, TV, media and history bytes remain exact"
        );
    }
    {
        // Exercise the actual engine/runtime classification too, without replacing
        // admission, receipt CAS, physical locking, or the actual port apply.
        const f = fixture({ populated: true });
        const paired = provision(f, "import", { scope });
        Object.assign(f.w, {
            atob: (value) => Buffer.from(value, "base64").toString("binary"),
            btoa: (value) => Buffer.from(value, "binary").toString("base64"),
            clearTimeout,
            crypto: crypto.webcrypto,
            setTimeout,
        });
        const module = f.load("src/settings/favorites-current-plex-host.ts"),
            original = module.createFavoritesCurrentPlexHost;
        let injected = false,
            protectedBefore,
            writesBefore,
            boundaryError;
        module.createFavoritesCurrentPlexHost = (w, ports) => {
            const host = original(w, ports),
                create = host.createAdapter;
            host.createAdapter = (admit) => {
                const adapter = create(admit),
                    apply = adapter.apply;
                adapter.apply = async (...args) => {
                    assert.equal(injected, false);
                    injected = true;
                    await retainedOutcome(f, paired.scope);
                    protectedBefore = [...f.saved];
                    writesBefore = f.writes.length;
                    try {
                        return await apply(...args);
                    } catch (error) {
                        boundaryError = error.code;
                        throw error;
                    }
                };
                return adapter;
            };
            return host;
        };
        const runtime = f
            .load("src/plugins/favorites-transfer-runtime.ts")
            .createFavoritesTransferRuntime(f.w, {
                runtime: () => "runtime-1",
                storage: f.storagePorts,
            });
        async function call(input) {
            const params = { runtime: "runtime-1", ...input };
            const result = await runtime.execute(params, {
                current: () => true,
                deadlineAt: Date.now() + 60000,
                envelope: { action: "favorites_transfer", params },
                runtime: "runtime-1",
            });
            assert.equal(result.error, undefined, JSON.stringify(result));
            return result;
        }
        try {
            const snapshot = await call({
                    op: "snapshot",
                    scope: paired.scope,
                }),
                input = Buffer.from(snapshot.document_base64, "base64");
            const prepared = await call({
                binding_revision: snapshot.binding_revision,
                budget_ms: 300000,
                document_sha256: hash(input),
                expected_revision: snapshot.revision,
                op: "prepare",
                scope: paired.scope,
                size_bytes: input.length,
            });
            const begun = await call({
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
                transaction_id: begun.transaction_id,
            });
            const preview = await call({
                op: "preview",
                transaction_id: begun.transaction_id,
            });
            assert.equal(preview.ready, true);
            const result = await call({
                expected_revision: snapshot.revision,
                op: "commit",
                operation_id: prepared.operation_id,
                plan_digest: preview.plan_digest,
                transaction_id: begun.transaction_id,
            });
            assert.equal(injected, true);
            assert.equal(boundaryError, "ledger_changed");
            assert.equal(
                result.outcome,
                "unknown",
                "actual engine conservatively reports any apply rejection as unknown"
            );
            assert.equal(f.writes.length, writesBefore);
            assert.deepEqual([...f.saved], protectedBefore);
            assert.equal(
                JSON.parse(f.saved.get(receiptKey)).entries.length,
                1,
                "only competing pending reservation exists"
            );
            assert.notEqual(
                JSON.parse(f.saved.get(receiptKey)).entries[0].operationId,
                prepared.operation_id
            );
        } finally {
            runtime.dispose();
        }
    }
    console.log(
        "PASS current Plex host: read-only empty qualification, one-write provisioning, strict DTOs, null/LZ preimages, two-fixture snapshot roundtrip, preserved history/cache, ownership and persisted uncertainty"
    );
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
