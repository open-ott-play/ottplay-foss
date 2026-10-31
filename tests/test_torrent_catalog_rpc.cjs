const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const acorn = require("acorn");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const compiled = new Map();
const LIMIT = 8388608;
const SOURCE = "https://media.example/public.torrent?edition=original";
const copy = (value) => JSON.parse(JSON.stringify(value));
const bytes = (value) => new Uint8Array(Buffer.from(value, "utf8"));
const digest = (value) =>
    crypto.createHash("sha256").update(value).digest("hex");
const uuid = (index) =>
    `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

// Real modules share a realm; only external effects are replaced by fixture ports.
function modules(overrides = {}, globals = {}) {
    const cache = new Map();
    const context = vm.createContext({
        clearTimeout,
        console,
        setTimeout,
        TextDecoder,
        TextEncoder,
        Uint8Array,
        URL,
        window: {},
        ...globals,
    });
    function load(relative) {
        const filename = path.resolve(root, relative);
        if (Object.hasOwn(overrides, filename)) return overrides[filename];
        if (cache.has(filename)) return cache.get(filename).exports;
        const source = fs.readFileSync(filename, "utf8");
        let entry = compiled.get(filename);
        if (!entry || entry.source !== source) {
            const code = ts.transpileModule(source, {
                compilerOptions: {
                    module: ts.ModuleKind.CommonJS,
                    target: ts.ScriptTarget.ES5,
                },
            }).outputText;
            acorn.parse(code, { ecmaVersion: 5 });
            entry = { code, source };
            compiled.set(filename, entry);
        }
        const module = { exports: {} };
        cache.set(filename, module);
        const run = vm.runInContext(
            `(function(require, module, exports) { ${entry.code}\n})`,
            context,
            { filename }
        );
        run(
            (name) => {
                assert.ok(
                    name.startsWith("."),
                    `Unexpected dependency: ${name}`
                );
                let target = path.resolve(path.dirname(filename), name);
                if (!path.extname(target)) {
                    target += fs.existsSync(target + ".ts")
                        ? ".ts"
                        : "/index.ts";
                }
                return load(target);
            },
            module,
            module.exports
        );
        return module.exports;
    }
    return { context, load };
}

function catalog() {
    return {
        entries: [
            {
                category: "Original category",
                files: [
                    { index: 3, length: 0, name: "Folder/First film.MKV" },
                    { index: 17, length: 1234, name: "Folder/Second film.mp4" },
                ],
                id: "entry-one",
                source: SOURCE,
                title: "Original title",
            },
        ],
        id: "catalog-one",
        name: "Saved films",
        schema: 1,
    };
}

function sizedCatalog(size) {
    const value = catalog();
    value.entries[0].files = Array.from({ length: 2100 }, (_, index) => ({
        index,
        length: 1,
        name: ".mp4",
    }));
    let remaining = size - Buffer.byteLength(JSON.stringify(value));
    assert.ok(remaining >= 0);
    for (const file of value.entries[0].files) {
        const count = Math.min(4092, remaining);
        file.name = "a".repeat(count) + file.name;
        remaining -= count;
    }
    assert.equal(remaining, 0);
    assert.equal(Buffer.byteLength(JSON.stringify(value)), size);
    return value;
}

test("strict codec preserves source spelling, Unicode and native file indices", () => {
    const codec = modules().load("src/provider/torrent-catalog-codec.ts");
    const value = catalog();
    value.entries[0].title = "日本語 — Café 🎞";
    value.entries[0].source = "https://MEDIA.example/A.TORRENT?q=%2F&v=1";
    const reordered = {
        entries: value.entries,
        id: value.id,
        name: value.name,
        schema: 1,
    };
    const parsed = codec.parseTorrentCatalog(bytes(JSON.stringify(reordered)));
    assert.deepEqual(copy(parsed), value);
    assert.equal(
        Buffer.from(codec.encodeTorrentCatalog(parsed)).toString("utf8"),
        JSON.stringify(value)
    );
    assert.deepEqual(
        copy(
            codec.parseTorrentCatalog(
                bytes(JSON.stringify({ ...value, entries: [] }))
            )
        ),
        { ...value, entries: [] }
    );
});

test("strict codec rejects duplicate keys, invalid UTF-8, numbers, depth and extra fields", () => {
    const codec = modules().load("src/provider/torrent-catalog-codec.ts");
    const encoded = JSON.stringify(catalog());
    for (const malformed of [
        encoded.replace('"schema":1', '"schema":1,"schema":1'),
        encoded.replace('"index":3', '"index":3,"index":3'),
        encoded.replace('"index":3', '"index":1e999'),
        encoded.replace('"index":3', '"index":03'),
        encoded.replace('"length":1234', '"length":9007199254740992'),
        encoded.replace('"Original title"', '"\\ud800"'),
        encoded.replace('"Original title"', '"bad\\u0000label"'),
        encoded + " null",
        "[".repeat(9) + "0" + "]".repeat(9),
    ])
        assert.throws(() => codec.parseTorrentCatalog(bytes(malformed)));
    for (const invalid of [
        [0xc0, 0xaf],
        [0xed, 0xa0, 0x80],
        [0xf4, 0x90, 0x80, 0x80],
        [0xe2, 0x82],
    ]) {
        const prefix = bytes(
            encoded.slice(0, encoded.indexOf("Original title"))
        );
        const suffix = bytes(
            encoded.slice(
                encoded.indexOf("Original title") + "Original title".length
            )
        );
        assert.throws(() =>
            codec.parseTorrentCatalog(
                new Uint8Array([...prefix, ...invalid, ...suffix])
            )
        );
    }
    for (const mutate of [
        (v) => (v.companionEndpoint = "http://private.example/secret"),
        (v) => (v.entries[0].stream_url = "http://private.example/lease"),
        (v) => (v.entries[0].files[0].extra = true),
        (v) => v.entries.push(copy(v.entries[0])),
        (v) => v.entries[0].files.push(copy(v.entries[0].files[0])),
        (v) => (v.entries[0].files[0].index = 0.5),
        (v) => (v.entries[0].files[0].name = "readme.txt"),
        (v) => (v.entries[0].files[0].name = "a".repeat(4093) + ".mp4"),
        (v) => (v.entries[0].title = " padded "),
        (v) =>
            (v.entries[0].source =
                "https://user:password@media.example/a.torrent"),
        (v) => (v.entries[0].source = "https://media.example/stream.mp4"),
    ]) {
        const value = catalog();
        mutate(value);
        assert.throws(() =>
            codec.parseTorrentCatalog(bytes(JSON.stringify(value)))
        );
    }
});

test("Torrent accepts 10,000 files and exactly 8 MiB without raising Favorites limits", () => {
    const loader = modules();
    const codec = loader.load("src/provider/torrent-catalog-codec.ts");
    const favorites = loader.load("src/commands/favorites-document-json.ts");
    const value = catalog();
    value.entries = [4000, 4000, 2000].map((count, group) => ({
        ...copy(value.entries[0]),
        files: Array.from({ length: count }, (_, index) => ({
            index,
            length: index,
            name: "a".repeat(110) + ".mp4",
        })),
        id: `entry-${group}`,
    }));
    const many = codec.encodeTorrentCatalog(value);
    assert.ok(many.length > 1048576);
    assert.equal(codec.parseTorrentCatalog(many).entries[2].files.length, 2000);
    assert.throws(() => favorites.parseFavoritesDocumentJson(many));
    const exact = codec.encodeTorrentCatalog(sizedCatalog(LIMIT));
    assert.equal(exact.length, LIMIT);
    assert.equal(
        codec.parseTorrentCatalog(exact).entries[0].files.length,
        2100
    );
    assert.throws(() =>
        codec.parseTorrentCatalog(
            new Uint8Array(Buffer.concat([exact, Buffer.from(" ")]))
        )
    );
    assert.throws(() => codec.encodeTorrentCatalog(sizedCatalog(LIMIT + 1)));
});

async function flush() {
    for (let i = 0; i < 24; i++) await Promise.resolve();
}

function fixture(initial = JSON.stringify(catalog())) {
    const loader = modules();
    const c = {
        dispatched: [],
        fault: null,
        invalidations: 0,
        metadata: [],
        native: true,
        now: 1000,
        owner: 1,
        plays: [],
        policy: false,
        raw: initial,
        readError: false,
        runtime: "runtime:one",
        sequence: 1000,
        storageCurrent: true,
        timers: new Map(),
        writes: [],
    };
    const actualStorage = {
        getItem(key) {
            assert.equal(key, "torrentcfg");
            if (c.readError)
                throw new Error("private /path token=secret read failure");
            return c.raw;
        },
        removeItem() {
            throw new Error("RPC must not delete storage");
        },
        setItem(key, value) {
            assert.equal(key, "torrentcfg");
            if (c.fault === "throw")
                throw new Error("private /path token=secret write failure");
            c.writes.push(value);
            if (c.fault !== "drop")
                c.raw = c.fault === "corrupt" ? "{}" : value;
        },
    };
    const storageHost = {
        localStorage: actualStorage,
        location: { origin: "https://player.test" },
        navigator: {
            locks: {
                request(_name, _options, callback) {
                    if (c.beforeLock) c.beforeLock();
                    return callback({});
                },
            },
        },
    };
    const grant = loader
        .load("src/storage/favorites-physical-storage.ts")
        .createFavoritesPhysicalStorageGrant(
            storageHost,
            actualStorage,
            () => c.storageCurrent
        );
    assert.ok(
        grant,
        "Use the production physical storage grant and verified CAS"
    );
    const ports = {
        capture() {
            const owner = c.owner;
            return { current: () => c.owner === owner };
        },
        clearTimeout(id) {
            c.timers.delete(id);
        },
        decodeBase64: (value) => new Uint8Array(Buffer.from(value, "base64")),
        encodeBase64: (value) => Buffer.from(value).toString("base64"),
        invalidate() {
            c.invalidations++;
        },
        metadata(source, done) {
            const call = { cancels: 0, done, source };
            c.metadata.push(call);
            return () => call.cancels++;
        },
        nativeAvailable: () => c.native,
        now: () => c.now,
        play(target, current, done) {
            const call = {
                accept() {
                    const admitted = current();
                    if (admitted) c.dispatched.push(copy(target));
                    done(admitted);
                },
                cancels: 0,
                current,
                done,
                target: copy(target),
            };
            c.plays.push(call);
            if (c.autoPlay) call.accept();
            return () => call.cancels++;
        },
        restricted: (op) =>
            typeof c.policy === "function" ? c.policy(op) : c.policy,
        runtime: () => c.runtime,
        setTimeout(fn, delay) {
            const id = ++c.sequence;
            c.timers.set(id, { at: c.now + delay, fn });
            return id;
        },
        async sha256(value) {
            if (c.onHash) await c.onHash(value);
            return digest(value);
        },
        storage: () => grant,
        uuid: () => uuid(++c.sequence),
    };
    const api = loader
        .load("src/provider/torrent-catalog.ts")
        .createTorrentCatalogRuntime(ports);
    const request = (op, data = {}, transport) =>
        api.request({ op, runtime: c.runtime, ...data }, transport);
    async function advance(ms) {
        const end = c.now + ms;
        for (;;) {
            const next = [...c.timers]
                .filter(([, timer]) => timer.at <= end)
                .sort((a, b) => a[1].at - b[1].at)[0];
            if (!next) break;
            c.now = next[1].at;
            c.timers.delete(next[0]);
            next[1].fn();
            await flush();
        }
        c.now = end;
        await flush();
    }
    return { advance, api, c, loader, ports, request };
}

function error(result, reason) {
    assert.deepEqual(
        Object.keys(result).sort(),
        ["version", "op", "runtime", "error", "reason"].sort()
    );
    assert.equal(result.version, 1);
    assert.equal(result.error, "Torrent catalog request failed.");
    assert.equal(result.reason, reason);
    assert.equal(JSON.stringify(result).includes("secret"), false);
}

function operation(result, state, kind = "write") {
    assert.equal(result.error, undefined, JSON.stringify(result));
    assert.deepEqual(
        Object.keys(result).sort(),
        ["version", "op", "runtime", "operation"].sort()
    );
    const value = result.operation;
    assert.deepEqual(
        Object.keys(value).sort(),
        [
            "id",
            "kind",
            "state",
            "next_offset",
            "snapshot",
            "reason",
            ...(kind === "play" ? ["target"] : []),
        ].sort()
    );
    assert.equal(value.kind, kind);
    assert.equal(value.state, state);
    if (state !== "uploading") assert.equal(value.next_offset, null);
    if (!["ready", "committed"].includes(state))
        assert.equal(value.snapshot, null);
    if (state !== "failed") assert.equal(value.reason, null);
    else assert.equal(typeof value.reason, "string");
    return value;
}

async function snapshotBytes(f, snapshot, chunkSize = 6144) {
    assert.deepEqual(
        Object.keys(snapshot).sort(),
        ["id", "kind", "revision", "sha256", "size_bytes"].sort()
    );
    const chunks = [];
    let offset = 0;
    for (;;) {
        const result = await f.request("read_chunk", {
            max_bytes: chunkSize,
            offset,
            snapshot_id: snapshot.id,
        });
        assert.equal(result.error, undefined, JSON.stringify(result));
        const chunk = Buffer.from(result.data_b64, "base64");
        assert.ok(chunk.length > 0 && chunk.length <= chunkSize);
        assert.equal(result.offset, offset);
        chunks.push(chunk);
        offset += chunk.length;
        if (result.next_offset === null) break;
        assert.equal(result.next_offset, offset);
    }
    const value = Buffer.concat(chunks);
    assert.equal(value.length, snapshot.size_bytes);
    assert.equal(digest(value), snapshot.sha256);
    return value;
}

async function begin(f, value = catalog(), options = {}) {
    const body =
        typeof value === "string" ? bytes(value) : bytes(JSON.stringify(value));
    const revision =
        options.revision || (await f.request("read")).snapshot.revision;
    const params = {
        mode: options.mode || "replace",
        operation_id: options.id || uuid(1),
        revision,
        sha256: options.sha256 || digest(body),
        size_bytes: body.length,
    };
    const result = await f.request("write_begin", params);
    operation(result, "uploading");
    return { body, params, result };
}

async function upload(f, value = catalog(), options = {}) {
    const pending = await begin(f, value, options);
    for (let offset = 0; offset < pending.body.length; offset += 6144) {
        const result = await f.request("write_chunk", {
            data_b64: Buffer.from(
                pending.body.slice(offset, offset + 6144)
            ).toString("base64"),
            offset,
            operation_id: pending.params.operation_id,
        });
        operation(result, "uploading");
    }
    return pending;
}

test("read snapshots are immutable, revision-bound and have no provider or network effects", async () => {
    const f = fixture(null);
    const empty = (await f.request("read")).snapshot;
    assert.equal((await snapshotBytes(f, empty, 2)).toString(), "null");
    f.c.raw = JSON.stringify(catalog());
    const saved = (await f.request("read")).snapshot;
    assert.notEqual(saved.revision, empty.revision);
    assert.deepEqual(JSON.parse(await snapshotBytes(f, saved, 113)), catalog());
    assert.equal((await snapshotBytes(f, empty)).toString(), "null");
    const value = catalog();
    value.entries[0].title = "Changed elsewhere";
    f.c.raw = JSON.stringify(value);
    const changed = (await f.request("read")).snapshot;
    assert.notEqual(changed.revision, saved.revision);
    assert.deepEqual(JSON.parse(await snapshotBytes(f, saved)), catalog());
    error(
        await f.request("read_chunk", {
            max_bytes: 1,
            offset: saved.size_bytes,
            snapshot_id: saved.id,
        }),
        "offset_mismatch"
    );
    assert.equal(
        f.c.writes.length +
            f.c.metadata.length +
            f.c.plays.length +
            f.c.invalidations,
        0
    );
});

test("absent storage differs from corrupt or unavailable storage and errors stay private", async () => {
    for (const raw of [
        "",
        "null",
        "{}",
        "{broken",
        JSON.stringify({ ...catalog(), endpoint: "secret" }),
    ]) {
        const f = fixture(raw);
        error(await f.request("read"), "invalid_document");
        assert.equal(f.c.raw, raw);
        assert.equal(f.c.writes.length, 0);
    }
    const f = fixture();
    f.c.readError = true;
    error(await f.request("read"), "storage_failed");
    f.c.readError = false;
    f.c.storageCurrent = false;
    error(await f.request("read"), "storage_failed");
});

test("strict RPC grammar, runtime and native capability checks reject before effects", async () => {
    const f = fixture();
    for (const data of [
        { arbitrary: true, op: "read", runtime: f.c.runtime },
        { op: "unknown", runtime: f.c.runtime },
        { op: "constructor", runtime: f.c.runtime },
        { op: "toString", runtime: f.c.runtime },
        { op: "status", operation_id: uuid(1) + "\n", runtime: f.c.runtime },
        { op: "status", operation_id: "not-a-uuid", runtime: f.c.runtime },
        {
            op: "metadata",
            operation_id: uuid(1),
            runtime: f.c.runtime,
            source: "https://user:secret@media.example/a.torrent",
        },
        {
            op: "metadata",
            operation_id: uuid(1),
            runtime: f.c.runtime,
            source: "magnet:?" + "x".repeat(16384),
        },
    ])
        error(await f.api.request(data), "invalid_request");
    error(
        await f.request("read", { runtime: "old-runtime" }),
        "runtime_changed"
    );
    f.c.native = false;
    error(await f.request("read"), "unsupported");
    f.c.native = true;
    f.c.policy = true;
    error(
        await f.request("metadata", { operation_id: uuid(1), source: SOURCE }),
        "policy_restricted"
    );
    assert.ok(
        (await f.request("read")).snapshot,
        "Read-only operations do not wake or change restricted playback"
    );
    assert.equal(f.c.writes.length + f.c.metadata.length + f.c.plays.length, 0);
});

test("catalog identifiers reject line terminators instead of accepting a prefix", () => {
    const codec = modules().load("src/provider/torrent-catalog-codec.ts");
    for (const field of ["catalog", "entry"]) {
        const value = catalog();
        if (field === "catalog") value.id += "\n";
        else value.entries[0].id += "\n";
        assert.throws(() =>
            codec.parseTorrentCatalog(bytes(JSON.stringify(value)))
        );
    }
});

test("chunk retries advance once; commit and write_begin recover one retained receipt", async () => {
    const f = fixture();
    const value = catalog();
    value.entries[0].title = "Imported title";
    const pending = await begin(f, value);
    const send = (offset, data) =>
        f.request("write_chunk", {
            data_b64: Buffer.from(data).toString("base64"),
            offset,
            operation_id: pending.params.operation_id,
        });
    const first = pending.body.slice(0, 97);
    operation(await send(0, first), "uploading");
    const middle = operation(
        await send(97, pending.body.slice(97, 200)),
        "uploading"
    );
    assert.equal(middle.next_offset, 200);
    assert.equal(operation(await send(0, first), "uploading").next_offset, 200);
    error(await send(0, bytes("different")), "offset_mismatch");
    error(await send(0, pending.body.slice(0, 200)), "offset_mismatch");
    error(await send(201, bytes("x")), "offset_mismatch");
    error(
        await f.request("write_chunk", {
            data_b64: "eA",
            offset: 200,
            operation_id: uuid(1),
        }),
        "invalid_request"
    );
    error(
        await f.request("write_chunk", {
            data_b64: "eA==\n",
            offset: 200,
            operation_id: uuid(1),
        }),
        "invalid_request"
    );
    error(
        await f.request("write_commit", { operation_id: uuid(1) }),
        "incomplete"
    );
    assert.equal(f.c.writes.length, 0);
    operation(await send(200, pending.body.slice(200)), "uploading");
    const committed = operation(
        await f.request("write_commit", { operation_id: uuid(1) }),
        "committed"
    );
    assert.deepEqual(JSON.parse(f.c.raw), value);
    assert.deepEqual(
        JSON.parse(await snapshotBytes(f, committed.snapshot)),
        value
    );
    assert.deepEqual(
        copy(
            operation(
                await f.request("write_commit", { operation_id: uuid(1) }),
                "committed"
            )
        ),
        copy(committed)
    );
    assert.deepEqual(
        copy(
            operation(
                await f.request("write_begin", pending.params),
                "committed"
            )
        ),
        copy(committed)
    );
    error(
        await f.request("write_begin", { ...pending.params, mode: "merge" }),
        "operation_conflict"
    );
    error(
        await f.request("metadata", { operation_id: uuid(1), source: SOURCE }),
        "operation_conflict"
    );
    assert.equal(f.c.writes.length, 1);
    assert.equal(f.c.invalidations, 1);
    assert.equal(f.c.plays.length + f.c.metadata.length, 0);
});

test("concurrent imports compare the original bytes and never overwrite another commit", async () => {
    const f = fixture();
    const first = catalog();
    first.name = "First writer";
    const second = catalog();
    second.name = "Second writer";
    await upload(f, first, { id: uuid(1) });
    await upload(f, second, { id: uuid(2) });
    operation(
        await f.request("write_commit", { operation_id: uuid(1) }),
        "committed"
    );
    const result = operation(
        await f.request("write_commit", { operation_id: uuid(2) }),
        "failed"
    );
    assert.equal(result.reason, "revision_conflict");
    assert.equal(JSON.parse(f.c.raw).name, "First writer");
    assert.equal(f.c.writes.length, 1);
});

test("merge preserves destination name/order, appends new IDs, and rejects conflicts atomically", async () => {
    const f = fixture();
    const incoming = catalog();
    incoming.name = "Ignored incoming name";
    incoming.entries.push({
        ...copy(incoming.entries[0]),
        id: "entry-two",
        title: "New entry",
    });
    await upload(f, incoming, { mode: "merge" });
    operation(
        await f.request("write_commit", { operation_id: uuid(1) }),
        "committed"
    );
    const merged = JSON.parse(f.c.raw);
    assert.equal(merged.name, "Saved films");
    assert.deepEqual(
        merged.entries.map((entry) => entry.id),
        ["entry-one", "entry-two"]
    );
    for (const [reason, mutate] of [
        [
            "entry_conflict",
            (value) => {
                value.entries[0].title = "Collision";
            },
        ],
        [
            "catalog_mismatch",
            (value) => {
                value.id = "foreign-catalog";
            },
        ],
    ]) {
        const g = fixture();
        const value = catalog();
        mutate(value);
        await upload(g, value, { mode: "merge" });
        assert.equal(
            operation(
                await g.request("write_commit", { operation_id: uuid(1) }),
                "failed"
            ).reason,
            reason
        );
        assert.equal(g.c.writes.length, 0);
    }
    const empty = fixture(null);
    await upload(empty, incoming, { mode: "merge" });
    operation(
        await empty.request("write_commit", { operation_id: uuid(1) }),
        "committed"
    );
    assert.deepEqual(JSON.parse(empty.c.raw), incoming);
    const noop = fixture();
    await upload(noop, catalog(), { mode: "merge" });
    operation(
        await noop.request("write_commit", { operation_id: uuid(1) }),
        "committed"
    );
    assert.equal(noop.c.writes.length, 0);
});

test("merging identical content preserves original bytes and revision despite JSON key order", async () => {
    const value = catalog();
    const raw = JSON.stringify({
        entries: value.entries,
        id: value.id,
        name: value.name,
        schema: 1,
    });
    const f = fixture(raw);
    const revision = (await f.request("read")).snapshot.revision;
    await upload(f, value, { mode: "merge", revision });
    const committed = operation(
        await f.request("write_commit", { operation_id: uuid(1) }),
        "committed"
    );
    assert.equal(f.c.raw, raw);
    assert.equal(f.c.writes.length, 0);
    assert.equal(committed.snapshot.revision, revision);
});

test("hash mismatch, invalid documents and unconfirmed writes cannot claim committed", async () => {
    for (const scenario of ["hash", "document", "throw", "drop", "corrupt"]) {
        const f = fixture();
        const value = catalog();
        value.name = "New name";
        await upload(
            f,
            scenario === "document" ? '{"schema":1,"schema":1}' : value,
            scenario === "hash" ? { sha256: "0".repeat(64) } : {}
        );
        if (["throw", "drop", "corrupt"].includes(scenario))
            f.c.fault = scenario;
        const failed = operation(
            await f.request("write_commit", { operation_id: uuid(1) }),
            "failed"
        );
        assert.equal(
            failed.reason,
            scenario === "hash"
                ? "hash_mismatch"
                : scenario === "document"
                  ? "invalid_document"
                  : "storage_failed"
        );
        assert.equal(f.c.invalidations, 0);
        assert.deepEqual(
            copy(
                operation(
                    await f.request("write_commit", { operation_id: uuid(1) }),
                    "failed"
                )
            ),
            copy(failed)
        );
    }
});

test("commit rechecks source, runtime, policy and physical revision after asynchronous work", async () => {
    for (const scenario of [
        "source",
        "runtime",
        "policy",
        "revision",
        "transport",
    ]) {
        const f = fixture();
        const value = catalog();
        value.name = "Attempted import";
        await upload(f, value);
        let current = true;
        f.c.beforeLock = () => {
            if (scenario === "source") f.c.owner++;
            if (scenario === "runtime") f.c.runtime = "runtime:two";
            if (scenario === "policy") f.c.policy = true;
            if (scenario === "revision")
                f.c.raw = JSON.stringify({
                    ...catalog(),
                    name: "External writer",
                });
            if (scenario === "transport") current = false;
        };
        const failed = operation(
            await f.request(
                "write_commit",
                { operation_id: uuid(1) },
                { current: () => current }
            ),
            "failed"
        );
        assert.equal(
            failed.reason,
            {
                policy: "policy_restricted",
                revision: "revision_conflict",
                runtime: "runtime_changed",
                source: "source_changed",
                transport: "expired",
            }[scenario]
        );
        assert.equal(f.c.writes.length, 0);
        assert.equal(f.c.invalidations, 0);
    }
});

test("cancelling a commit during hashing remains terminal and cannot write later", async () => {
    const f = fixture();
    const value = catalog();
    value.name = "Cancelled import";
    await upload(f, value);
    let resume;
    f.c.onHash = () =>
        new Promise((resolve) => {
            resume = resolve;
        });
    const pending = f.request("write_commit", { operation_id: uuid(1) });
    await flush();
    assert.equal(typeof resume, "function");
    operation(
        await f.request("cancel", { operation_id: uuid(1) }),
        "cancelled"
    );
    f.c.onHash = null;
    resume();
    await pending;
    operation(
        await f.request("status", { operation_id: uuid(1) }),
        "cancelled"
    );
    assert.equal(f.c.writes.length, 0);
});

test("metadata retries share one task; cancellation releases only that task and ignores late callbacks", async () => {
    const f = fixture();
    const params = { operation_id: uuid(1), source: SOURCE };
    operation(await f.request("metadata", params), "pending", "metadata");
    operation(await f.request("metadata", params), "pending", "metadata");
    assert.equal(f.c.metadata.length, 1);
    error(
        await f.request("metadata", {
            ...params,
            source: SOURCE + "&different=1",
        }),
        "operation_conflict"
    );
    operation(
        await f.request("metadata", { ...params, operation_id: uuid(2) }),
        "pending",
        "metadata"
    );
    operation(
        await f.request("cancel", { operation_id: uuid(1) }),
        "cancelled",
        "metadata"
    );
    assert.equal(f.c.metadata[0].cancels, 1);
    assert.equal(f.c.metadata[1].cancels, 0);
    f.c.metadata[0].done(catalog().entries[0].files);
    f.c.metadata[1].done(catalog().entries[0].files);
    await flush();
    operation(
        await f.request("status", { operation_id: uuid(1) }),
        "cancelled",
        "metadata"
    );
    const ready = operation(
        await f.request("status", { operation_id: uuid(2) }),
        "ready",
        "metadata"
    );
    assert.equal(ready.snapshot.kind, "metadata");
    assert.equal(ready.snapshot.revision, null);
    assert.deepEqual(JSON.parse(await snapshotBytes(f, ready.snapshot)), {
        files: catalog().entries[0].files,
        schema: 1,
        source: SOURCE,
    });
    assert.deepEqual(
        copy(
            operation(
                await f.request("cancel", { operation_id: uuid(2) }),
                "ready",
                "metadata"
            )
        ),
        copy(ready)
    );
    assert.equal(f.c.writes.length + f.c.plays.length + f.c.invalidations, 0);
});

test("metadata source loss, native loss and disposal release work before late results", async () => {
    for (const cause of ["source", "native", "runtime", "policy", "dispose"]) {
        const f = fixture();
        await f.request("metadata", { operation_id: uuid(1), source: SOURCE });
        if (cause === "source") f.c.owner++;
        if (cause === "native") f.c.native = false;
        if (cause === "runtime") f.c.runtime = "runtime:new";
        if (cause === "policy") f.c.policy = true;
        if (cause === "dispose") f.api.dispose();
        await f.advance(100);
        assert.equal(f.c.metadata[0].cancels, 1, cause);
        f.c.metadata[0].done(catalog().entries[0].files);
        await flush();
        if (["source", "policy"].includes(cause))
            operation(
                await f.request("status", { operation_id: uuid(1) }),
                "cancelled",
                "metadata"
            );
        assert.equal(f.c.writes.length + f.c.plays.length, 0);
        assert.equal(f.c.timers.size, 0);
    }
});

test("metadata has a 75-second hard deadline and bounded, sanitized producer output", async () => {
    const f = fixture();
    await f.request("metadata", { operation_id: uuid(1), source: SOURCE });
    await f.advance(74999);
    operation(
        await f.request("status", { operation_id: uuid(1) }),
        "pending",
        "metadata"
    );
    await f.advance(1);
    const timedOut = operation(
        await f.request("status", { operation_id: uuid(1) }),
        "failed",
        "metadata"
    );
    assert.equal(timedOut.reason, "metadata_timeout");
    assert.equal(f.c.metadata[0].cancels, 1);
    f.c.metadata[0].done(catalog().entries[0].files);
    await flush();
    assert.deepEqual(
        copy(
            operation(
                await f.request("status", { operation_id: uuid(1) }),
                "failed",
                "metadata"
            )
        ),
        copy(timedOut)
    );
    for (const [files, reason] of [
        [[], "no_files"],
        [null, "metadata_failed"],
        [
            [{ index: 0, length: 1, name: "not-a-video.txt" }],
            "invalid_document",
        ],
        [
            Array.from({ length: 2100 }, (_, index) => ({
                index,
                length: 1,
                name: "a".repeat(4092) + ".mp4",
            })),
            "document_too_large",
        ],
    ]) {
        const g = fixture();
        await g.request("metadata", { operation_id: uuid(1), source: SOURCE });
        g.c.metadata[0].done(
            files,
            "private /path token=secret backend failure"
        );
        await flush();
        assert.equal(
            operation(
                await g.request("status", { operation_id: uuid(1) }),
                "failed",
                "metadata"
            ).reason,
            reason
        );
        assert.equal(g.c.writes.length, 0);
    }
});

test("valid activity extends 600-second retention; expiry frees records without replay", async () => {
    const f = fixture();
    await begin(f);
    await f.advance(599999);
    operation(
        await f.request("status", { operation_id: uuid(1) }),
        "uploading"
    );
    await f.advance(599999);
    operation(
        await f.request("status", { operation_id: uuid(1) }),
        "uploading"
    );
    await f.advance(600000);
    const expired = await f.request("status", { operation_id: uuid(1) });
    assert.ok(["expired", "operation_not_found"].includes(expired.reason));
    assert.equal(f.c.writes.length, 0);
    const snapshot = (await f.request("read")).snapshot;
    await f.advance(599999);
    await snapshotBytes(f, snapshot);
    await f.advance(599999);
    await snapshotBytes(f, snapshot);
    await f.advance(600000);
    error(
        await f.request("read_chunk", {
            max_bytes: 1,
            offset: 0,
            snapshot_id: snapshot.id,
        }),
        "snapshot_not_found"
    );
});

test("rejected chunks do not extend an upload's idle retention", async () => {
    const f = fixture();
    await begin(f);
    await f.advance(599999);
    error(
        await f.request("write_chunk", {
            data_b64: "invalid base64",
            offset: 0,
            operation_id: uuid(1),
        }),
        "invalid_request"
    );
    await f.advance(1);
    const result = await f.request("status", { operation_id: uuid(1) });
    assert.ok(["expired", "operation_not_found"].includes(result.reason));
    assert.equal(f.c.writes.length, 0);
});

test("active operations and staged bytes are bounded without evicting admitted work", async () => {
    const f = fixture();
    for (let i = 1; i <= 16; i++)
        operation(
            await f.request("metadata", {
                operation_id: uuid(i),
                source: SOURCE,
            }),
            "pending",
            "metadata"
        );
    error(
        await f.request("metadata", { operation_id: uuid(17), source: SOURCE }),
        "busy"
    );
    assert.equal(f.c.metadata.length, 16);
    operation(
        await f.request("status", { operation_id: uuid(1) }),
        "pending",
        "metadata"
    );
    assert.equal(f.c.metadata[0].cancels, 0);
    f.api.dispose();
    assert.ok(f.c.metadata.every((call) => call.cancels === 1));
    const g = fixture();
    const revision = (await g.request("read")).snapshot.revision;
    const params = {
        mode: "replace",
        revision,
        sha256: "0".repeat(64),
        size_bytes: LIMIT,
    };
    for (let i = 1; i <= 3; i++)
        operation(
            await g.request("write_begin", {
                ...params,
                operation_id: uuid(i),
            }),
            "uploading"
        );
    error(
        await g.request("write_begin", { ...params, operation_id: uuid(4) }),
        "busy"
    );
    operation(
        await g.request("cancel", { operation_id: uuid(1) }),
        "cancelled"
    );
    operation(
        await g.request("write_begin", { ...params, operation_id: uuid(4) }),
        "uploading"
    );
    assert.equal(g.c.writes.length, 0);
    g.api.dispose();
});

test("concurrent snapshot digests reserve slots and rejection does not leak byte capacity", async () => {
    const f = fixture();
    for (let i = 0; i < 63; i++) {
        f.c.raw = JSON.stringify({ ...catalog(), name: `Snapshot ${i}` });
        assert.ok((await f.request("read")).snapshot);
    }
    const resumed = [];
    f.c.onHash = () => new Promise((resolve) => resumed.push(resolve));
    const large = sizedCatalog(1048576);
    f.c.raw = JSON.stringify({ ...large, name: "Concurrent A" });
    const first = f.request("read");
    await flush();
    f.c.raw = JSON.stringify({ ...large, name: "Concurrent B" });
    const second = f.request("read");
    await flush();
    f.c.onHash = null;
    resumed.forEach((resolve) => resolve());
    const replies = await Promise.all([first, second]);
    assert.equal(replies.filter((reply) => !!reply.snapshot).length, 1);
    error(
        replies.find((reply) => !reply.snapshot),
        "busy"
    );
    await f.advance(600000);
    f.c.raw = JSON.stringify(catalog());
    const fresh = (await f.request("read")).snapshot;
    assert.ok(fresh);
    const params = {
        mode: "replace",
        revision: fresh.revision,
        sha256: "0".repeat(64),
    };
    for (let i = 1; i <= 4; i++) {
        operation(
            await f.request("write_begin", {
                ...params,
                operation_id: uuid(i),
                // Leave room for the bounded chunk index. A leaked rejected
                // 1 MiB snapshot reservation would prevent this last upload.
                size_bytes: i === 4 ? LIMIT / 2 : LIMIT,
            }),
            "uploading"
        );
    }
    f.api.dispose();
});

test("play uses the saved native index once; status recovers acceptance without stopping it", async () => {
    const f = fixture();
    const revision = (await f.request("read")).snapshot.revision;
    const params = {
        entry_id: "entry-one",
        file_index: 17,
        operation_id: uuid(1),
        revision,
    };
    const pending = f.request("play", params);
    await flush();
    const retry = f.request("play", params);
    await flush();
    assert.equal(f.c.plays.length, 1);
    const waiting = operation(
        await f.request("status", { operation_id: uuid(1) }),
        "pending",
        "play"
    );
    assert.deepEqual(copy(waiting.target), {
        catalog_id: "catalog-one",
        entry_id: "entry-one",
        file_index: 17,
    });
    f.c.plays[0].accept();
    const result = await pending;
    assert.deepEqual(copy(result), {
        accepted: true,
        op: "play",
        operation_id: uuid(1),
        runtime: f.c.runtime,
        version: 1,
        ...waiting.target,
    });
    assert.deepEqual(copy(await retry), copy(result));
    const accepted = operation(
        await f.request("status", { operation_id: uuid(1) }),
        "accepted",
        "play"
    );
    const cancels = f.c.plays[0].cancels;
    assert.deepEqual(
        copy(
            operation(
                await f.request("cancel", { operation_id: uuid(1) }),
                "accepted",
                "play"
            )
        ),
        copy(accepted)
    );
    assert.equal(f.c.plays[0].cancels, cancels);
    assert.equal(f.c.dispatched.length, 1);
    assert.deepEqual(copy(await f.request("play", params)), copy(result));
    assert.equal(f.c.dispatched.length, 1);
    error(
        await f.request("play", { ...params, file_index: 3 }),
        "operation_conflict"
    );
    error(
        await f.request("metadata", { operation_id: uuid(1), source: SOURCE }),
        "operation_conflict"
    );
});

test("pending play is cancellable and guarded against changed catalogs and restrictions", async () => {
    for (const change of ["cancel", "catalog", "policy", "native", "runtime"]) {
        const f = fixture();
        const revision = (await f.request("read")).snapshot.revision;
        const pending = f.request("play", {
            entry_id: "entry-one",
            file_index: 3,
            operation_id: uuid(1),
            revision,
        });
        await flush();
        if (change === "cancel")
            operation(
                await f.request("cancel", { operation_id: uuid(1) }),
                "cancelled",
                "play"
            );
        if (change === "catalog")
            f.c.raw = JSON.stringify({ ...catalog(), id: "other-catalog" });
        if (change === "policy") f.c.policy = true;
        if (change === "native") f.c.native = false;
        if (change === "runtime") f.c.runtime = "runtime:new";
        assert.equal(f.c.plays[0].current(), false, change);
        f.c.plays[0].accept();
        const result = await pending;
        assert.equal(result.accepted, undefined);
        assert.equal(f.c.dispatched.length, 0);
        assert.equal(f.c.writes.length, 0);
    }
    const f = fixture();
    const revision = (await f.request("read")).snapshot.revision;
    for (const [entry_id, file_index, reason] of [
        ["entry-one", 0, "file_not_found"],
        ["missing", 3, "entry_not_found"],
    ]) {
        error(
            await f.request("play", {
                entry_id,
                file_index,
                operation_id: uuid(1),
                revision,
            }),
            reason
        );
    }
    assert.equal(f.c.plays.length, 0);
});

function hostFixture(options = {}) {
    const f = fixture();
    const effects = {
        checkpoint: 0,
        ensured: [],
        feature: [],
        plays: [],
        reload: 0,
        select: 0,
    };
    let selected = "demo";
    const w = {
        __ottActiveProviderDriver: { id: "demo" },
        __ottChannels: { index: () => 0 },
        __ottClassicPlayback: { checkpointNow: () => effects.checkpoint++ },
        __ottCommandChannelLoad: {},
        __ottKiosk: { enabled: () => f.c.policy },
        __ottParental: { needs: () => !!f.c.parental },
        __ottProviderRuntime: {
            classic: { current: () => ({ active: () => true }) },
        },
        __ottStandby: { blocked: () => !!f.c.standby },
        atob: (value) => Buffer.from(value, "base64").toString("binary"),
        btoa: (value) => Buffer.from(value, "binary").toString("base64"),
        cats: {
            All: [
                "torrent:catalog-one:entry-one:3",
                "torrent:catalog-one:entry-one:17",
            ],
        },
        catsArray: ["All"],
        clearTimeout: f.ports.clearTimeout,
        commandChannelsReady: true,
        crypto: {
            getRandomValues: (value) => crypto.randomFillSync(value),
            subtle: {
                digest: async (_algorithm, value) =>
                    new Uint8Array(Buffer.from(digest(value), "hex")).buffer,
            },
        },
        loadChannels() {
            effects.reload++;
        },
        playChannel(
            group,
            index,
            fullscreen,
            admission,
            _seek,
            _a,
            _b,
            done,
            stillCurrent
        ) {
            assert.equal(fullscreen, true);
            if (!admission() || !stillCurrent()) return false;
            effects.plays.push(w.cats[w.catsArray[group]][index]);
            done(true);
            return true;
        },
        setTimeout: f.ports.setTimeout,
        settings: {
            companionEndpoint: "http://external.example/companion/private/v1",
        },
        stbGetItem: (key) =>
            key === "ottplayprov"
                ? selected
                : key === "torrentcfg"
                  ? f.c.raw
                  : null,
    };
    const client = { metadata: f.ports.metadata };
    w.__ottMediaCompanion = {
        ensure(owned) {
            effects.ensured.push(owned);
            return options.deferEnsure
                ? new Promise((resolve) => {
                      f.c.resolveEnsure = () => resolve(client);
                  })
                : Promise.resolve(client);
        },
        nativePending: () => false,
        providerAvailable: () => f.c.native,
    };
    let loader;
    const overrides = {
        [path.join(root, "src/provider/index.ts")]: {
            isProviderAllowed: () => !f.c.denied,
            providerIds: ["demo", "torrent"],
            selectProviderByIndex(index) {
                assert.equal(index, 1);
                effects.select++;
                selected = "torrent";
                w.__ottActiveProviderDriver = {
                    id: "torrent",
                    invalidateCatalog: () => f.c.invalidations++,
                };
                w.__ottCommandChannelLoad = {};
                return true;
            },
        },
        [path.join(root, "src/storage/index.ts")]: {
            captureFavoritesPhysicalStorage: f.ports.storage,
        },
        [path.join(root, "src/commands/remote-restart.ts")]: {
            remotePlayerInfo: () => ({ runtime: f.c.runtime }),
        },
        [path.join(root, "src/commands/remote-feature.ts")]: {
            loadRemoteFeature(_host, name, done) {
                assert.equal(name, "provider-torrent");
                effects.feature.push(() => {
                    loader.load("src/plugins/torrent-catalog-runtime.ts");
                    done();
                });
                if (!options.deferFeature) effects.feature.at(-1)();
            },
        },
    };
    class ClockDate extends Date {
        static now() {
            return f.c.now;
        }
    }
    loader = modules(overrides, { Date: ClockDate, window: w });
    const route = loader.load(
        "src/commands/remote-torrent-catalog.ts"
    ).executeRemoteTorrentCatalog;
    function dispatch(op, data = {}) {
        let cancel;
        const result = new Promise((resolve) => {
            cancel = route(
                w,
                {
                    action: "torrent_catalog",
                    expires_at: (f.c.now + 120000) / 1000,
                    params: { op, runtime: f.c.runtime, ...data },
                },
                resolve
            );
        });
        return { cancel, result };
    }
    return {
        ...f,
        dispatch,
        effects,
        loader,
        request: (op, data) =>
            dispatch(op, data).result.then((result) => result.data),
        w,
    };
}

test("real command route performs headless writes without selecting or reloading a provider", async () => {
    const f = hostFixture();
    const originalDriver = f.w.__ottActiveProviderDriver;
    const originalLoad = f.w.__ottCommandChannelLoad;
    const value = catalog();
    value.name = "Remote import";
    await upload(f, value);
    operation(
        await f.request("write_commit", { operation_id: uuid(1) }),
        "committed"
    );
    assert.equal(f.w.__ottActiveProviderDriver, originalDriver);
    assert.equal(f.w.__ottCommandChannelLoad, originalLoad);
    assert.equal(
        f.effects.select +
            f.effects.reload +
            f.effects.checkpoint +
            f.effects.plays.length +
            f.effects.ensured.length,
        0
    );
    assert.equal(f.c.writes.length, 1);
    f.c.native = false;
    const denied = await f.dispatch("read").result;
    assert.equal(denied.status, "unsupported");
    error(denied.data, "unsupported");
});

test("real command route admits saved file playback through provider selection and its guard", async () => {
    const f = hostFixture();
    const revision = (await f.request("read")).snapshot.revision;
    const params = {
        entry_id: "entry-one",
        file_index: 17,
        operation_id: uuid(1),
        revision,
    };
    const result = await f.dispatch("play", params).result;
    assert.equal(result.status, "ok", JSON.stringify(result));
    assert.equal(result.data.accepted, true);
    assert.deepEqual(f.effects.plays, ["torrent:catalog-one:entry-one:17"]);
    assert.equal(f.effects.select, 1);
    assert.equal(f.effects.checkpoint, 1);
    assert.deepEqual(copy(await f.request("play", params)), copy(result.data));
    assert.equal(f.effects.plays.length, 1);
    operation(
        await f.request("cancel", { operation_id: uuid(1) }),
        "accepted",
        "play"
    );
    for (const condition of ["policy", "standby", "parental", "denied"]) {
        const g = hostFixture();
        const rev = (await g.request("read")).snapshot.revision;
        g.c[condition] = true;
        const rejected = await g.dispatch("play", { ...params, revision: rev })
            .result;
        assert.equal(rejected.data.accepted, undefined, condition);
        assert.equal(g.effects.plays.length, 0, condition);
    }
});

test("owned metadata loading stays cancellable before ensure resolves", async () => {
    const f = hostFixture({ deferEnsure: true });
    operation(
        await f.request("metadata", { operation_id: uuid(1), source: SOURCE }),
        "pending",
        "metadata"
    );
    assert.deepEqual(f.effects.ensured, [true]);
    operation(
        await f.request("cancel", { operation_id: uuid(1) }),
        "cancelled",
        "metadata"
    );
    f.c.resolveEnsure();
    await flush();
    assert.equal(f.c.metadata.length, 0);
    assert.equal(
        f.effects.select + f.effects.reload + f.effects.plays.length,
        0
    );
});

test("optional asset loading is fenced against source changes and cancelled requests", async () => {
    for (const cancel of [false, true]) {
        const f = hostFixture({ deferFeature: true });
        let replies = 0;
        const pending = f.dispatch("metadata", {
            operation_id: uuid(1),
            source: SOURCE,
        });
        pending.result.then(() => replies++);
        if (cancel) pending.cancel();
        else f.w.__ottCommandChannelLoad = {};
        f.effects.feature[0]();
        await flush();
        if (!cancel) error((await pending.result).data, "source_changed");
        assert.equal(replies, cancel ? 0 : 1);
        assert.equal(f.effects.ensured.length + f.c.metadata.length, 0);
    }
});

test("metadata's 75-second deadline includes loading its optional asset", async () => {
    const f = hostFixture({ deferFeature: true });
    const pending = f.dispatch("metadata", {
        operation_id: uuid(1),
        source: SOURCE,
    });
    await f.advance(10000);
    f.effects.feature[0]();
    operation((await pending.result).data, "pending", "metadata");
    await f.advance(65000);
    assert.equal(
        operation(
            await f.request("status", { operation_id: uuid(1) }),
            "failed",
            "metadata"
        ).reason,
        "metadata_timeout"
    );
    assert.equal(f.c.metadata[0].cancels, 1);
});

test("Torrent Favorites resolves large saved catalogs with the same strict document boundary", () => {
    const loader = modules();
    const api = loader.load("src/media/global-favorites-providers.ts");
    const value = sizedCatalog(1100000);
    const row = {
        id: "torrent",
        kind: "torrent",
        prefix: "torrent",
        title: "Torrent",
    };
    let raw = JSON.stringify(value);
    const w = { stbGetItem: () => raw };
    assert.deepEqual(
        copy(api.globalFavoriteBuiltinConfiguration(w, row, null)),
        { name: "Torrent", slot: null, values: [value.id] }
    );
    raw = raw.replace('"schema":1', '"schema":1,"schema":1');
    assert.equal(api.globalFavoriteBuiltinConfiguration(w, row, null), null);
    raw = JSON.stringify({
        ...value,
        companionEndpoint: "http://private.example/secret",
    });
    assert.equal(api.globalFavoriteBuiltinConfiguration(w, row, null), null);
});
