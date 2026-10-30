import {
    encodeTorrentCatalog,
    normalizeTorrentCatalog,
    parseTorrentCatalog,
    TORRENT_CATALOG_BYTES,
    torrentFiles,
    torrentId,
    torrentInteger,
    torrentKeys,
    torrentSource,
    torrentUtf8,
} from "./torrent-catalog-codec";

export interface TorrentCatalogPorts {
    capture(): { current(): boolean };
    clearTimeout(timer: any): void;
    decodeBase64(value: string): Uint8Array;
    encodeBase64(bytes: Uint8Array): string;
    invalidate(): void;
    metadata(
        source: string,
        done: (files: any[] | null, reason?: string) => void
    ): () => void;
    nativeAvailable(): boolean;
    now(): number;
    play(
        target: { catalog_id: string; entry_id: string; file_index: number },
        current: () => boolean,
        done: (accepted: boolean) => void
    ): () => void;
    restricted(op: string): boolean;
    runtime(): string;
    setTimeout(callback: () => void, delay: number): any;
    sha256(bytes: Uint8Array): Promise<string>;
    storage(): {
        current(): boolean;
        read(key: string): string | null;
        exclusive<T>(work: (grant: any) => T | Promise<T>): Promise<T>;
        compareAndSwap(
            key: string,
            before: string | null,
            after: string,
            admission?: () => boolean
        ): "confirmed" | "conflict" | "unknown";
    } | null;
    uuid(): string;
}
export interface TorrentCatalogTransport {
    current?(): boolean;
    deadlineAt?: number;
    startedAt?: number;
}
const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/;
const TOKEN = /^[A-Za-z0-9_.:-]{1,128}(?![\s\S])/;
const TTL = 600000;
const MAX_MEMORY = 33554432;
const REASONS =
    "invalid_request unsupported policy_restricted runtime_changed source_changed revision_conflict snapshot_not_found operation_not_found operation_conflict busy expired cancelled metadata_failed metadata_timeout no_files invalid_document document_too_large hash_mismatch offset_mismatch incomplete catalog_mismatch entry_conflict entry_not_found file_not_found storage_failed effect_failed".split(
        " "
    );
/** Retained, headless operations. No UI owner or active-provider mutation is needed to manage storage. */
export function createTorrentCatalogRuntime(ports: TorrentCatalogPorts) {
    var runtime = ports.runtime(),
        disposed = false,
        operations: any[] = [],
        snapshots: any[] = [];
    var pendingSnapshots = 0;
    var memory = 0,
        known = false,
        lastRaw: string | null = null,
        revision = "",
        serial = 0;
    function fail(reason: string): never {
        throw new Error(reason);
    }
    function clone(value: any): any {
        return JSON.parse(JSON.stringify(value));
    }
    function uuid(value: any): boolean {
        return typeof value === "string" && UUID.test(value);
    }
    function token(value: any): boolean {
        return typeof value === "string" && TOKEN.test(value);
    }
    function terminal(operation: any): boolean {
        return ["pending", "uploading"].indexOf(operation.state) < 0;
    }
    function release(operation: any): void {
        if (operation.timer !== undefined) ports.clearTimeout(operation.timer);
        operation.timer = undefined;
        var cancel = operation.cancel;
        operation.cancel = null;
        if (cancel) {
            try {
                cancel();
            } catch (_) {}
        }
    }
    function discardBytes(operation: any): void {
        if (operation.bytes) {
            memory -= operation.bytes.length + operation.boundaries.length;
            operation.boundaries = null;
            operation.bytes = null;
        }
    }
    function markBoundary(operation: any, at: number): void {
        operation.boundaries[at >> 3] |= 1 << (at & 7);
    }
    function exactChunk(operation: any, at: number, size: number): boolean {
        function boundary(index: number): boolean {
            return !!(operation.boundaries[index >> 3] & (1 << (index & 7)));
        }
        if (
            at + size > operation.offset ||
            !boundary(at) ||
            !boundary(at + size)
        )
            return false;
        for (var i = at + 1; i < at + size; i++) if (boundary(i)) return false;
        return true;
    }
    function finish(
        operation: any,
        state: string,
        reason: string | null = null
    ): void {
        operation.state = state;
        operation.reason = reason;
        operation.touched = ports.now();
        release(operation);
        if (state !== "uploading") discardBytes(operation);
        var waiting = operation.waiting || [];
        operation.waiting = [];
        waiting.forEach(function (done: () => void) {
            done();
        });
    }
    function sweep(): void {
        var now = ports.now();
        operations = operations.filter(function (operation) {
            if (now - operation.touched < TTL && now >= operation.touched)
                return true;
            finish(operation, "cancelled");
            return false;
        });
        snapshots = snapshots.filter(function (snapshot) {
            if (now - snapshot.touched < TTL && now >= snapshot.touched)
                return true;
            memory -= snapshot.bytes.length;
            return false;
        });
    }
    function requireRuntime(): void {
        if (disposed || ports.runtime() !== runtime) fail("runtime_changed");
        if (!ports.nativeAvailable()) fail("unsupported");
    }
    function admitted(op: string): void {
        requireRuntime();
        if (ports.restricted(op)) fail("policy_restricted");
    }
    function guard(transport?: TorrentCatalogTransport): void {
        requireRuntime();
        if (
            transport &&
            ((transport.current && !transport.current()) ||
                (transport.deadlineAt !== undefined &&
                    ports.now() >= transport.deadlineAt))
        )
            fail("expired");
    }
    function storage(): any {
        var grant = ports.storage();
        if (!grant || !grant.current()) fail("storage_failed");
        return grant;
    }
    function read(): any {
        var grant = storage(),
            raw: string | null;
        try {
            raw = grant.read("torrentcfg");
        } catch (_) {
            return fail("storage_failed");
        }
        if (raw !== null && typeof raw !== "string") fail("storage_failed");
        var document: any = null;
        if (raw !== null) {
            if (raw.length > TORRENT_CATALOG_BYTES) fail("document_too_large");
            try {
                document = parseTorrentCatalog(torrentUtf8(raw));
            } catch (_) {
                return fail("invalid_document");
            }
        }
        if (!known || raw !== lastRaw) {
            known = true;
            lastRaw = raw;
            revision = "torrent:" + ++serial + ":" + ports.uuid();
        }
        return {
            document: document,
            grant: grant,
            raw: raw,
            revision: revision,
        };
    }
    function descriptor(snapshot: any): any {
        return clone(snapshot.descriptor);
    }
    async function snapshot(
        bytes: Uint8Array,
        kind: string,
        rev: string | null
    ): Promise<any> {
        sweep();
        var existing = snapshots.filter(function (item) {
            return (
                kind === "catalog" &&
                item.descriptor.kind === kind &&
                item.descriptor.revision === rev
            );
        })[0];
        if (existing) {
            existing.touched = ports.now();
            return existing;
        }
        if (
            memory + bytes.length > MAX_MEMORY ||
            snapshots.length + pendingSnapshots >= 64
        )
            fail("busy");
        memory += bytes.length;
        pendingSnapshots++;
        try {
            var digest = await ports.sha256(bytes);
            requireRuntime();
            var value = {
                bytes: bytes,
                descriptor: {
                    id: ports.uuid(),
                    kind: kind,
                    revision: rev,
                    sha256: digest,
                    size_bytes: bytes.length,
                },
                touched: ports.now(),
            };
            snapshots.push(value);
            return value;
        } catch (error) {
            memory -= bytes.length;
            throw error;
        } finally {
            pendingSnapshots--;
        }
    }
    function operationView(operation: any): any {
        var value: any = {
            id: operation.id,
            kind: operation.kind,
            next_offset:
                operation.state === "uploading" ? operation.offset : null,
            reason: operation.state === "failed" ? operation.reason : null,
            snapshot: operation.snapshot
                ? descriptor(operation.snapshot)
                : null,
            state: operation.state,
        };
        if (operation.kind === "play") value.target = clone(operation.target);
        return value;
    }
    function find(id: string, touch = true): any {
        var operation = operations.filter(function (item) {
            return item.id === id;
        })[0];
        if (!operation) fail("operation_not_found");
        if (touch) {
            operation.touched = ports.now();
            if (operation.snapshot) operation.snapshot.touched = ports.now();
        }
        return operation;
    }
    function existing(id: string, signature: string): any {
        var operation = operations.filter(function (item) {
            return item.id === id;
        })[0];
        if (!operation) return null;
        if (operation.signature !== signature) fail("operation_conflict");
        return find(id);
    }
    function create(id: string, kind: string, signature: string): any {
        if (operations.length >= 16) fail("busy");
        var operation = {
            capture: ports.capture(),
            id: id,
            kind: kind,
            offset: 0,
            reason: null,
            signature: signature,
            snapshot: null,
            started: ports.now(),
            state: kind === "write" ? "uploading" : "pending",
            touched: ports.now(),
        };
        operations.push(operation);
        return operation;
    }
    function operationCurrent(operation: any, op: string): boolean {
        return (
            !disposed &&
            ports.runtime() === runtime &&
            ports.nativeAvailable() &&
            !terminal(operation) &&
            operation.capture.current() &&
            !ports.restricted(op) &&
            (!operation.transport ||
                ((!operation.transport.current ||
                    operation.transport.current()) &&
                    (operation.transport.deadlineAt === undefined ||
                        ports.now() < operation.transport.deadlineAt)))
        );
    }
    function watch(operation: any): void {
        if (terminal(operation)) return;
        if (
            !operationCurrent(
                operation,
                operation.kind === "write" ? "write_commit" : operation.kind
            )
        ) {
            finish(operation, "cancelled");
            return;
        }
        if (ports.now() - operation.started >= 75000) {
            finish(
                operation,
                "failed",
                operation.kind === "metadata"
                    ? "metadata_timeout"
                    : "effect_failed"
            );
            return;
        }
        operation.timer = ports.setTimeout(function () {
            watch(operation);
        }, 100);
    }
    function beginMetadata(operation: any, source: string): void {
        watch(operation);
        if (terminal(operation)) return;
        var cancel = ports.metadata(source, function (files, reason) {
            if (!operationCurrent(operation, "metadata")) {
                if (!terminal(operation)) finish(operation, "cancelled");
                return;
            }
            if (operation.resolved) return;
            operation.resolved = true;
            if (!files) {
                finish(
                    operation,
                    "failed",
                    REASONS.indexOf(reason || "") >= 0
                        ? reason!
                        : "metadata_failed"
                );
                return;
            }
            var normalized = torrentFiles(files);
            if (!normalized) {
                finish(operation, "failed", "invalid_document");
                return;
            }
            if (!normalized.length) {
                finish(operation, "failed", "no_files");
                return;
            }
            var bytes: Uint8Array;
            try {
                bytes = torrentUtf8(
                    JSON.stringify({
                        files: normalized,
                        schema: 1,
                        source: source,
                    })
                );
            } catch (_) {
                finish(operation, "failed", "document_too_large");
                return;
            }
            snapshot(bytes, "metadata", null).then(
                function (value) {
                    if (!operationCurrent(operation, "metadata")) {
                        if (!terminal(operation))
                            finish(operation, "cancelled");
                        return;
                    }
                    operation.snapshot = value;
                    finish(operation, "ready");
                },
                function (error) {
                    if (!terminal(operation))
                        finish(
                            operation,
                            "failed",
                            REASONS.indexOf(error.message) >= 0
                                ? error.message
                                : "metadata_failed"
                        );
                }
            );
        });
        if (terminal(operation)) cancel();
        else operation.cancel = cancel;
    }
    function merge(before: any, incoming: any): any {
        if (!before) return incoming;
        if (before.id !== incoming.id) fail("catalog_mismatch");
        var output = clone(before);
        incoming.entries.forEach(function (entry: any) {
            var found = output.entries.filter(function (item: any) {
                return item.id === entry.id;
            })[0];
            if (found) {
                if (JSON.stringify(found) !== JSON.stringify(entry))
                    fail("entry_conflict");
            } else output.entries.push(entry);
        });
        if (!normalizeTorrentCatalog(output)) fail("invalid_document");
        return output;
    }
    async function execute(
        params: any,
        transport?: TorrentCatalogTransport
    ): Promise<any> {
        sweep();
        guard(transport);
        var op = params.op,
            operation: any;
        if (params.runtime !== runtime) fail("runtime_changed");
        var fields: any = {
            cancel: ["operation_id"],
            metadata: ["operation_id", "source"],
            play: ["operation_id", "revision", "entry_id", "file_index"],
            read: [],
            read_chunk: ["snapshot_id", "offset", "max_bytes"],
            status: ["operation_id"],
            write_begin: [
                "operation_id",
                "revision",
                "mode",
                "size_bytes",
                "sha256",
            ],
            write_chunk: ["operation_id", "offset", "data_b64"],
            write_commit: ["operation_id"],
        };
        if (
            !Object.prototype.hasOwnProperty.call(fields, op) ||
            !torrentKeys(params, ["op", "runtime"].concat(fields[op])) ||
            !token(params.runtime) ||
            (fields[op].indexOf("operation_id") >= 0 &&
                !uuid(params.operation_id))
        )
            fail("invalid_request");
        try {
            torrentUtf8(JSON.stringify(params), 16384);
        } catch (_) {
            return fail("invalid_request");
        }
        if (
            [
                "metadata",
                "write_begin",
                "write_chunk",
                "write_commit",
                "play",
            ].indexOf(op) >= 0
        )
            admitted(op);
        if (op === "read") {
            var saved = read(),
                bytes = saved.document
                    ? encodeTorrentCatalog(saved.document)
                    : torrentUtf8("null");
            var result = await snapshot(bytes, "catalog", saved.revision);
            guard(transport);
            return { snapshot: descriptor(result) };
        }
        if (op === "read_chunk") {
            if (
                !uuid(params.snapshot_id) ||
                !torrentInteger(params.offset, TORRENT_CATALOG_BYTES) ||
                !torrentInteger(params.max_bytes, 6144) ||
                !params.max_bytes
            )
                fail("invalid_request");
            var found = snapshots.filter(function (item) {
                return item.descriptor.id === params.snapshot_id;
            })[0];
            if (!found) fail("snapshot_not_found");
            if (params.offset >= found.bytes.length) fail("offset_mismatch");
            found.touched = ports.now();
            var end = Math.min(
                found.bytes.length,
                params.offset + params.max_bytes
            );
            return {
                data_b64: ports.encodeBase64(
                    found.bytes.slice(params.offset, end)
                ),
                next_offset: end === found.bytes.length ? null : end,
                offset: params.offset,
                snapshot_id: params.snapshot_id,
            };
        }
        if (op === "metadata") {
            if (!torrentSource(params.source)) fail("invalid_request");
            var signature = JSON.stringify([op, params.source]);
            operation = existing(params.operation_id, signature);
            if (!operation) {
                operation = create(params.operation_id, op, signature);
                if (transport && transport.startedAt !== undefined)
                    operation.started = transport.startedAt;
                beginMetadata(operation, params.source);
            }
            return { operation: operationView(operation) };
        }
        if (op === "write_begin") {
            if (
                !token(params.revision) ||
                ["merge", "replace"].indexOf(params.mode) < 0 ||
                !torrentInteger(params.size_bytes, TORRENT_CATALOG_BYTES) ||
                !params.size_bytes ||
                typeof params.sha256 !== "string" ||
                !/^[0-9a-f]{64}(?![\s\S])/.test(params.sha256)
            )
                fail("invalid_request");
            var signature = JSON.stringify([
                op,
                params.revision,
                params.mode,
                params.size_bytes,
                params.sha256,
            ]);
            operation = existing(params.operation_id, signature);
            if (!operation) {
                var saved = read();
                if (saved.revision !== params.revision)
                    fail("revision_conflict");
                var boundaryBytes = Math.ceil((params.size_bytes + 1) / 8);
                if (memory + params.size_bytes + boundaryBytes > MAX_MEMORY)
                    fail("busy");
                operation = create(params.operation_id, "write", signature);
                operation.before = saved.raw;
                operation.revision = saved.revision;
                operation.mode = params.mode;
                operation.digest = params.sha256;
                operation.bytes = new Uint8Array(params.size_bytes);
                operation.boundaries = new Uint8Array(boundaryBytes);
                memory += params.size_bytes + boundaryBytes;
            }
            return { operation: operationView(operation) };
        }
        if (op === "play") {
            if (
                !token(params.revision) ||
                !torrentId(params.entry_id) ||
                !torrentInteger(params.file_index, 999999999)
            )
                fail("invalid_request");
            var signature = JSON.stringify([
                op,
                params.revision,
                params.entry_id,
                params.file_index,
            ]);
            operation = existing(params.operation_id, signature);
            if (!operation) {
                var saved = read();
                if (saved.revision !== params.revision)
                    fail("revision_conflict");
                var entry =
                    saved.document &&
                    saved.document.entries.filter(function (item: any) {
                        return item.id === params.entry_id;
                    })[0];
                if (!entry) fail("entry_not_found");
                if (
                    !entry.files.some(function (file: any) {
                        return file.index === params.file_index;
                    })
                )
                    fail("file_not_found");
                operation = create(params.operation_id, "play", signature);
                operation.transport = transport;
                operation.target = {
                    catalog_id: saved.document.id,
                    entry_id: entry.id,
                    file_index: params.file_index,
                };
                // The host owns source changes caused by this explicit play. Storage, runtime and policy remain fenced.
                var before = saved.raw;
                operation.capture = {
                    current: function () {
                        try {
                            return storage().read("torrentcfg") === before;
                        } catch (_) {
                            return false;
                        }
                    },
                };
                watch(operation);
                var play = operation;
                var cancel = ports.play(
                    clone(operation.target),
                    function () {
                        return (
                            play.state === "accepted" ||
                            operationCurrent(play, "play")
                        );
                    },
                    function (accepted) {
                        if (terminal(play)) return;
                        var ok = accepted && operationCurrent(play, "play");
                        finish(
                            play,
                            ok ? "accepted" : "failed",
                            ok ? null : "effect_failed"
                        );
                    }
                );
                if (terminal(operation)) cancel();
                else operation.cancel = cancel;
            }
            if (!terminal(operation))
                await new Promise<void>(function (resolve) {
                    (operation.waiting || (operation.waiting = [])).push(
                        resolve
                    );
                });
            if (operation.state !== "accepted") {
                if (operation.state === "failed")
                    fail(operation.reason || "effect_failed");
                if (operation.state === "cancelled") fail("cancelled");
                fail("busy");
            }
            return {
                accepted: true,
                catalog_id: operation.target.catalog_id,
                entry_id: operation.target.entry_id,
                file_index: operation.target.file_index,
                operation_id: operation.id,
            };
        }
        operation = find(
            params.operation_id,
            op === "status" || op === "cancel"
        );
        if (op === "status") return { operation: operationView(operation) };
        if (op === "cancel") {
            if (!terminal(operation)) finish(operation, "cancelled");
            return { operation: operationView(operation) };
        }
        if (operation.kind !== "write") fail("operation_conflict");
        if (op === "write_chunk") {
            if (operation.state !== "uploading" || operation.committing)
                fail("operation_conflict");
            if (
                !torrentInteger(params.offset, TORRENT_CATALOG_BYTES) ||
                typeof params.data_b64 !== "string" ||
                !params.data_b64 ||
                params.data_b64.length > 8192
            )
                fail("invalid_request");
            var chunk: Uint8Array;
            try {
                chunk = ports.decodeBase64(params.data_b64);
            } catch (_) {
                return fail("invalid_request");
            }
            if (
                !chunk.length ||
                chunk.length > 6144 ||
                ports.encodeBase64(chunk) !== params.data_b64
            )
                fail("invalid_request");
            if (params.offset < operation.offset) {
                if (
                    !exactChunk(operation, params.offset, chunk.length) ||
                    ports.encodeBase64(
                        operation.bytes.slice(
                            params.offset,
                            params.offset + chunk.length
                        )
                    ) !== params.data_b64
                )
                    fail("offset_mismatch");
                operation.touched = ports.now();
                return { operation: operationView(operation) };
            }
            if (
                params.offset !== operation.offset ||
                params.offset + chunk.length > operation.bytes.length
            )
                fail("offset_mismatch");
            operation.bytes.set(chunk, params.offset);
            markBoundary(operation, params.offset);
            markBoundary(operation, params.offset + chunk.length);
            operation.touched = ports.now();
            operation.offset += chunk.length;
            return { operation: operationView(operation) };
        }
        if (
            operation.state === "committed" ||
            operation.state === "failed" ||
            operation.state === "cancelled"
        )
            return { operation: operationView(operation) };
        if (operation.committing) fail("busy");
        if (operation.offset !== operation.bytes.length) fail("incomplete");
        operation.committing = true;
        try {
            var digest = await ports.sha256(operation.bytes);
            if (terminal(operation))
                return { operation: operationView(operation) };
            if (digest !== operation.digest) fail("hash_mismatch");
            guard(transport);
            var incoming: any;
            try {
                incoming = parseTorrentCatalog(operation.bytes);
            } catch (_) {
                return fail("invalid_document");
            }
            if (!operation.capture.current()) fail("source_changed");
            var saved = read();
            if (
                saved.raw !== operation.before ||
                saved.revision !== operation.revision
            )
                fail("revision_conflict");
            var document =
                operation.mode === "merge"
                    ? merge(saved.document, incoming)
                    : incoming;
            var bytes: Uint8Array;
            try {
                bytes = encodeTorrentCatalog(document);
            } catch (_) {
                return fail("document_too_large");
            }
            // Reserve and hash the receipt before any persistent mutation.
            var receipt = await snapshot(
                bytes,
                "catalog",
                "pending:" + operation.id
            );
            var after =
                operation.mode === "merge" &&
                saved.document &&
                JSON.stringify(saved.document) === JSON.stringify(document)
                    ? saved.raw
                    : JSON.stringify(document);
            var outcome = await saved.grant.exclusive(function (grant: any) {
                guard(transport);
                admitted("write_commit");
                if (
                    !operation.capture.current() ||
                    operation.state !== "uploading"
                )
                    fail("source_changed");
                if (grant.read("torrentcfg") !== operation.before)
                    fail("revision_conflict");
                if (after === operation.before) return "confirmed";
                return grant.compareAndSwap(
                    "torrentcfg",
                    operation.before,
                    after,
                    function () {
                        try {
                            guard(transport);
                            admitted("write_commit");
                            return (
                                operation.capture.current() &&
                                operation.state === "uploading"
                            );
                        } catch (_) {
                            return false;
                        }
                    }
                );
            });
            if (outcome !== "confirmed")
                fail(
                    outcome === "conflict"
                        ? "revision_conflict"
                        : "storage_failed"
                );
            var confirmed = read();
            if (confirmed.raw !== after) fail("storage_failed");
            receipt.descriptor.revision = confirmed.revision;
            operation.snapshot = receipt;
            finish(operation, "committed");
            try {
                ports.invalidate();
            } catch (_) {}
            return { operation: operationView(operation) };
        } catch (error) {
            var reason = error && (error as any).message;
            if (terminal(operation))
                return { operation: operationView(operation) };
            finish(
                operation,
                "failed",
                REASONS.indexOf(reason) >= 0 ? reason : "storage_failed"
            );
            return { operation: operationView(operation) };
        } finally {
            operation.committing = false;
        }
    }
    return {
        dispose: function (): void {
            disposed = true;
            operations.forEach(function (operation) {
                if (!terminal(operation)) finish(operation, "cancelled");
                else {
                    release(operation);
                    discardBytes(operation);
                }
            });
            operations = [];
            snapshots = [];
            memory = 0;
        },
        request: async function (
            params: any,
            transport?: TorrentCatalogTransport
        ): Promise<any> {
            var common = {
                op: params && params.op,
                runtime: params && params.runtime,
                version: 1,
            };
            try {
                if (
                    !params ||
                    typeof params !== "object" ||
                    Array.isArray(params)
                )
                    fail("invalid_request");
                return Object.assign(common, await execute(params, transport));
            } catch (error) {
                var reason = error && (error as any).message;
                return Object.assign(common, {
                    error: "Torrent catalog request failed.",
                    reason:
                        REASONS.indexOf(reason) >= 0
                            ? reason
                            : "storage_failed",
                });
            }
        },
    };
}
