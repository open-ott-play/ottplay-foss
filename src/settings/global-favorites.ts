import {
    encodeFavoritesDocumentJson,
    parseFavoritesDocumentJson,
    utf8Encode,
} from "../commands/favorites-document-json";
import type { FavoritesPhysicalStorageGrant } from "../storage/favorites-physical-storage";

export interface GlobalFavoriteValue {
    title: string;
    origin: any;
    locator: any;
}
export interface GlobalFavorite extends GlobalFavoriteValue {
    id: string;
}
export interface GlobalFavoritesPorts {
    capture(): FavoritesPhysicalStorageGrant | null;
    current(): boolean;
    /** Shared global receipt admission; every writer must consult this. */
    canWrite?(): boolean;
    sha256(text: string): Promise<string>;
    /** Cryptographically random UUIDv4, with no timestamp/Math.random fallback. */
    uuid(): string;
    /** Trusted complete-source capture, retained through its one-time migration. */
    migrationCurrent?(id: string): boolean;
    codec: {
        normalize(value: GlobalFavoriteValue): GlobalFavoriteValue | null;
        identity(value: GlobalFavoriteValue): string;
        /** Only an explicit verified mapping may retire a local legacy row. */
        migrateLegacy?(row: any): GlobalFavoriteValue | null;
    };
}
export type GlobalFavoritesChange =
    | { op: "put" | "replace"; entries: GlobalFavoriteValue[] }
    | { op: "legacy-put"; entry: any; portable?: GlobalFavoriteValue }
    | { op: "legacy-remove"; id: string }
    | { op: "remove" | "reorder"; ids: string[] }
    | {
          op: "migrate-source";
          migrationId: string;
          entries: GlobalFavoriteValue[];
      }
    | {
          op: "migrate-membership";
          migrationId: string;
          entries: { token: string; entry: GlobalFavoriteValue }[];
      }
    | { op: "migrate-legacy" };
const KEY = "remoteFavorites.v1";
const UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/;
const SHA = /^[0-9a-f]{64}(?![\s\S])/;
function fail(code: string): never {
    throw new Error(code);
}
function object(value: any): boolean {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
function keys(value: any, names: string[]): boolean {
    return (
        object(value) &&
        Object.keys(value).sort().join(",") === names.sort().join(",")
    );
}
function text(value: any, limit: number, blank = false): boolean {
    return (
        typeof value === "string" &&
        (blank || !!value.trim()) &&
        !/[\u0000-\u001f\u007f]/.test(value) &&
        utf8Encode(value).length <= limit
    );
}
function clone(value: any): any {
    return parseFavoritesDocumentJson(encodeFavoritesDocumentJson(value));
}
function empty(): any {
    return {
        version: 2,
        entries: [],
        legacy: [],
        legacyAliases: {},
        migrations: [],
    };
}
function legacy(row: any): boolean {
    return (
        object(row) &&
        /^fav-[a-z0-9-]{1,60}$/.test(row.id) &&
        text(row.name, 160) &&
        text(row.title, 512) &&
        text(row.profile_name, 256, true) &&
        /^[a-z0-9][a-z0-9_.\/-]{0,63}$/.test(row.provider) &&
        (row.profile_number === null ||
            (typeof row.profile_number === "number" &&
                Math.floor(row.profile_number) === row.profile_number &&
                row.profile_number >= 1 &&
                row.profile_number <= 15)) &&
        /^(live|vod)$/.test(row.kind) &&
        text(row.source, 256) &&
        object(row.ref) &&
        text(row.ref.itemId, 8192) &&
        (row.kind === "live" || text(row.ref.sourceId, 256)) &&
        (row.plex_id === undefined || /^[1-9][0-9]{0,19}$/.test(row.plex_id))
    );
}
/** One installation-wide ordered list, reusing the existing physical key. No routing or scans. */
export function createGlobalFavoritesStore(ports: GlobalFavoritesPorts) {
    function normalized(value: any): GlobalFavoriteValue {
        if (!keys(value, ["title", "origin", "locator"])) fail("invalid_entry");
        const normalized = ports.codec.normalize(clone(value));
        if (!normalized || !keys(normalized, ["title", "origin", "locator"]))
            fail("unsupported_entry");
        const result: GlobalFavoriteValue = clone(normalized);
        if (
            JSON.stringify(ports.codec.normalize(clone(result))) !==
            JSON.stringify(result)
        )
            fail("unstable_codec");
        return result;
    }
    function identity(value: GlobalFavoriteValue): string {
        var key = ports.codec.identity(
            clone({
                title: value.title,
                origin: value.origin,
                locator: value.locator,
            })
        );
        if (!text(key, 8192)) fail("invalid_identity");
        return key;
    }
    function document(raw: string | null): any {
        if (raw === null) return empty();
        var value = parseFavoritesDocumentJson(utf8Encode(raw));
        if (keys(value, ["version", "entries"]) && value.version === 1) {
            if (
                !Array.isArray(value.entries) ||
                value.entries.length > 100 ||
                !value.entries.every(legacy)
            )
                fail("invalid_legacy");
            var result = empty();
            result.legacy = value.entries;
            value = result;
        }
        if (
            keys(value, ["version", "entries", "legacy", "migrations"]) &&
            value.version === 2
        )
            value.legacyAliases = {};
        if (
            !keys(value, [
                "version",
                "entries",
                "legacy",
                "legacyAliases",
                "migrations",
            ]) ||
            value.version !== 2 ||
            !Array.isArray(value.entries) ||
            value.entries.length > 1000 ||
            !Array.isArray(value.legacy) ||
            value.legacy.length > 100 ||
            !value.legacy.every(legacy) ||
            !Array.isArray(value.migrations) ||
            value.migrations.length > 8192
        )
            fail("invalid_store");
        var ids: any = Object.create(null),
            identities: any = Object.create(null);
        value.entries.forEach(function (row: any) {
            if (
                !keys(row, ["id", "title", "origin", "locator"]) ||
                !UUID.test(row.id) ||
                ids[row.id]
            )
                fail("invalid_store");
            ids[row.id] = true;
            var entry = normalized({
                title: row.title,
                origin: row.origin,
                locator: row.locator,
            });
            if (
                entry.title !== row.title ||
                JSON.stringify(entry.origin) !== JSON.stringify(row.origin) ||
                JSON.stringify(entry.locator) !== JSON.stringify(row.locator)
            )
                fail("noncanonical_store");
            var key = identity(entry);
            if (identities[key]) fail("duplicate_identity");
            identities[key] = true;
        });
        ids = Object.create(null);
        value.legacy.forEach(function (row: any) {
            if (ids[row.id]) fail("invalid_legacy");
            ids[row.id] = true;
        });
        ids = Object.create(null);
        value.migrations.forEach(function (id: any) {
            if (!SHA.test(id) || ids[id]) fail("invalid_migration");
            ids[id] = true;
        });
        if (!object(value.legacyAliases)) fail("invalid_aliases");
        Object.keys(value.legacyAliases).forEach(function (id) {
            if (
                !value.legacy.some(function (row: any) {
                    return row.id === id;
                }) ||
                !value.entries.some(function (row: any) {
                    return row.id === value.legacyAliases[id];
                })
            )
                fail("invalid_aliases");
        });
        return value;
    }
    function alive(grant: FavoritesPhysicalStorageGrant): boolean {
        return ports.current() && grant.current();
    }
    async function revision(raw: string | null): Promise<string> {
        var value = await ports.sha256(raw === null ? "null" : raw);
        if (!SHA.test(value)) fail("invalid_digest");
        return value;
    }
    async function snapshot() {
        const captured = ports.capture();
        if (!captured || !alive(captured)) fail("unsupported_storage");
        const grant: FavoritesPhysicalStorageGrant = captured;
        var raw = grant.read(KEY),
            value = document(raw),
            rev = await revision(raw);
        function current(): boolean {
            try {
                return alive(grant) && grant.read(KEY) === raw && alive(grant);
            } catch (_) {
                return false;
            }
        }
        if (!current()) fail("revision_conflict");
        return {
            current: current,
            revision: rev,
            entries: clone(value.entries),
            legacyCount: value.legacy.length,
            unresolvedLegacy: value.legacy
                .filter(function (row: any) {
                    return !value.legacyAliases[row.id];
                })
                .map(function (row: any) {
                    return {
                        id: row.id,
                        title: row.title,
                        provider: row.provider,
                        profile: row.profile_name,
                    };
                }),
            privateLegacy: function () {
                if (!current()) fail("revision_conflict");
                return {
                    entries: clone(value.legacy),
                    aliases: clone(value.legacyAliases),
                };
            },
        };
    }
    function apply(value: any, change: GlobalFavoritesChange): void {
        if (!object(change)) fail("invalid_change");
        function put(entries: GlobalFavoriteValue[]) {
            if (!Array.isArray(entries) || entries.length > 1000)
                fail("limits_exceeded");
            var known: any = Object.create(null),
                ids: any = Object.create(null);
            value.entries.forEach(function (row: GlobalFavorite) {
                known[identity(row)] = row.id;
                ids[row.id] = true;
            });
            return entries.map(function (input) {
                var entry = normalized(input),
                    key = identity(entry);
                if (known[key]) return known[key];
                if (value.entries.length === 1000) fail("limits_exceeded");
                var id = ports.uuid();
                if (!UUID.test(id) || ids[id]) fail("invalid_uuid");
                ids[id] = true;
                known[key] = id;
                value.entries.push({
                    id: id,
                    title: entry.title,
                    origin: entry.origin,
                    locator: entry.locator,
                });
                return id;
            });
        }
        function removeGlobals(ids: string[]) {
            var removed: any = Object.create(null);
            ids.forEach(function (id) {
                removed[id] = true;
            });
            value.entries = value.entries.filter(function (
                row: GlobalFavorite
            ) {
                return !removed[row.id];
            });
            value.legacy = value.legacy.filter(function (row: any) {
                return !removed[value.legacyAliases[row.id]];
            });
            Object.keys(value.legacyAliases).forEach(function (id) {
                if (removed[value.legacyAliases[id]])
                    delete value.legacyAliases[id];
            });
        }
        if (change.op === "put" && keys(change, ["op", "entries"]))
            put(change.entries);
        else if (change.op === "replace" && keys(change, ["op", "entries"])) {
            if (!Array.isArray(change.entries) || change.entries.length > 1000)
                fail("limits_exceeded");
            var existing: any = Object.create(null),
                ids: any = Object.create(null),
                seen: any = Object.create(null),
                retained: any = Object.create(null),
                replacement: any[] = [];
            value.entries.forEach(function (row: GlobalFavorite) {
                existing[identity(row)] = row;
                ids[row.id] = true;
            });
            change.entries.forEach(function (input) {
                var entry = normalized(input),
                    key = identity(entry);
                if (seen[key]) return;
                seen[key] = true;
                var previous = existing[key],
                    id = previous ? previous.id : ports.uuid();
                if (!UUID.test(id) || (!previous && ids[id]))
                    fail("invalid_uuid");
                ids[id] = true;
                retained[id] = true;
                replacement.push({
                    id: id,
                    title: entry.title,
                    origin: entry.origin,
                    locator: entry.locator,
                });
            });
            removeGlobals(
                value.entries
                    .filter(function (row: GlobalFavorite) {
                        return !retained[row.id];
                    })
                    .map(function (row: GlobalFavorite) {
                        return row.id;
                    })
            );
            value.entries = replacement;
        } else if (
            change.op === "legacy-put" &&
            (keys(change, ["op", "entry"]) ||
                keys(change, ["op", "entry", "portable"]))
        ) {
            if (!legacy(change.entry)) fail("invalid_legacy");
            var index = value.legacy.findIndex(function (row: any) {
                return row.id === change.entry.id;
            });
            if (index < 0 && value.legacy.length >= 100)
                fail("limits_exceeded");
            if (index < 0) value.legacy.push(clone(change.entry));
            else value.legacy[index] = clone(change.entry);
            if (change.portable)
                value.legacyAliases[change.entry.id] = put([
                    change.portable,
                ])[0];
        } else if (
            change.op === "legacy-remove" &&
            keys(change, ["op", "id"])
        ) {
            if (
                !value.legacy.some(function (row: any) {
                    return row.id === change.id;
                })
            )
                fail("favorite_not_found");
            if (value.legacyAliases[change.id])
                removeGlobals([value.legacyAliases[change.id]]);
            else
                value.legacy = value.legacy.filter(function (row: any) {
                    return row.id !== change.id;
                });
        } else if (
            change.op === "migrate-source" &&
            keys(change, ["op", "migrationId", "entries"])
        ) {
            if (!SHA.test(change.migrationId)) fail("invalid_migration");
            if (value.migrations.indexOf(change.migrationId) >= 0) return;
            if (value.migrations.length === 8192) fail("limits_exceeded");
            put(change.entries);
            value.migrations.push(change.migrationId);
        } else if (
            change.op === "migrate-membership" &&
            keys(change, ["op", "migrationId", "entries"])
        ) {
            if (
                !SHA.test(change.migrationId) ||
                !Array.isArray(change.entries) ||
                change.entries.length > 1000
            )
                fail("invalid_migration");
            var tokens: any = Object.create(null),
                incoming: GlobalFavoriteValue[] = [];
            value.migrations.forEach(function (token: string) {
                tokens[token] = true;
            });
            change.entries.forEach(function (item) {
                if (!keys(item, ["token", "entry"]) || !SHA.test(item.token))
                    fail("invalid_migration");
                var entry = normalized(item.entry);
                if (tokens[item.token]) return;
                if (value.migrations.length === 8192) fail("limits_exceeded");
                tokens[item.token] = true;
                value.migrations.push(item.token);
                incoming.push(entry);
            });
            put(incoming);
        } else if (change.op === "migrate-legacy" && keys(change, ["op"])) {
            if (!ports.codec.migrateLegacy) fail("unsupported_migration");
            value.legacy.forEach(function (row: any) {
                if (value.legacyAliases[row.id]) return;
                var mapped = ports.codec.migrateLegacy!(clone(row));
                if (mapped) value.legacyAliases[row.id] = put([mapped])[0];
            });
        } else if (
            (change.op === "remove" || change.op === "reorder") &&
            keys(change, ["op", "ids"])
        ) {
            if (!Array.isArray(change.ids) || change.ids.length > 1000)
                fail("invalid_ids");
            var selected: any = Object.create(null),
                seen: any = Object.create(null);
            value.entries.forEach(function (row: GlobalFavorite) {
                selected[row.id] = row;
            });
            var ordered = change.ids.map(function (id) {
                if (!UUID.test(id) || !selected[id] || seen[id])
                    fail("invalid_ids");
                seen[id] = true;
                return selected[id];
            });
            if (change.op === "reorder") {
                if (ordered.length !== value.entries.length)
                    fail("invalid_ids");
                value.entries = ordered;
            } else removeGlobals(change.ids);
        } else fail("invalid_change");
    }
    async function prepare(
        expectedRevision: string,
        change: GlobalFavoritesChange,
        admission?: () => boolean
    ) {
        if (!SHA.test(expectedRevision)) fail("invalid_revision");
        var request = clone(change);
        const captured = ports.capture();
        if (!captured || !alive(captured)) fail("unsupported_storage");
        const grant: FavoritesPhysicalStorageGrant = captured;
        function admitted(): boolean {
            return (
                alive(grant) &&
                (!ports.canWrite || ports.canWrite()) &&
                (!admission || admission()) &&
                ((request.op !== "migrate-source" &&
                    request.op !== "migrate-membership") ||
                    !!(
                        ports.migrationCurrent &&
                        ports.migrationCurrent(request.migrationId)
                    ))
            );
        }
        var before = grant.read(KEY),
            value = document(before);
        if (
            (await revision(before)) !== expectedRevision ||
            !admitted() ||
            grant.read(KEY) !== before
        )
            fail("revision_conflict");
        apply(value, request);
        var after = JSON.stringify(value);
        document(after);
        utf8Encode(after);
        var nextRevision = await revision(after);
        if (!admitted() || grant.read(KEY) !== before || !admitted())
            fail("revision_conflict");
        var used = false;
        function current(): boolean {
            try {
                return (
                    !used &&
                    admitted() &&
                    grant.read(KEY) === before &&
                    admitted()
                );
            } catch (_) {
                return false;
            }
        }
        async function underLock(
            work: (
                commit: () => Promise<any>,
                held: FavoritesPhysicalStorageGrant
            ) => Promise<any>
        ): Promise<any> {
            return grant.exclusive(async function (held) {
                if (held !== grant || !current()) fail("revision_conflict");
                async function commit() {
                    if (!current()) fail("revision_conflict");
                    used = true;
                    if (
                        after === before ||
                        (before === null &&
                            !value.entries.length &&
                            !value.legacy.length &&
                            !value.migrations.length)
                    )
                        return {
                            outcome: "verified",
                            changed: false,
                            revision: expectedRevision,
                        };
                    try {
                        var result = grant.compareAndSwap(
                            KEY,
                            before,
                            after,
                            admitted
                        );
                        if (result === "conflict")
                            return {
                                outcome: "not_applied",
                                changed: false,
                                revision: expectedRevision,
                            };
                        if (
                            result !== "confirmed" ||
                            !admitted() ||
                            grant.read(KEY) !== after ||
                            !admitted()
                        )
                            return {
                                outcome: "unknown",
                                changed: null,
                                revision: null,
                            };
                        return {
                            outcome: "verified",
                            changed: true,
                            revision: nextRevision,
                        };
                    } catch (_) {
                        return {
                            outcome: "unknown",
                            changed: null,
                            revision: null,
                        };
                    }
                }
                return work(commit, held);
            });
        }
        return Object.freeze({
            physical: grant,
            beforeRaw: before,
            afterRaw: after,
            expectedRevision: expectedRevision,
            newRevision: nextRevision,
            current: current,
            underLock: underLock,
        });
    }
    async function mutate(
        expectedRevision: string,
        change: GlobalFavoritesChange,
        admission?: () => boolean
    ) {
        var plan = await prepare(expectedRevision, change, admission);
        return plan.underLock(function (commit) {
            return commit();
        });
    }
    async function portableSnapshot() {
        var value = await snapshot();
        if (value.unresolvedLegacy.length) fail("unportable_export");
        return {
            version: 1,
            entries: value.entries.map(function (row: GlobalFavorite) {
                return {
                    title: row.title,
                    origin: row.origin,
                    locator: row.locator,
                };
            }),
        };
    }
    return {
        snapshot: snapshot,
        prepare: prepare,
        mutate: mutate,
        portableSnapshot: portableSnapshot,
    };
}
