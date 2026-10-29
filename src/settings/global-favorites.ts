import {
    encodeFavoritesDocumentJson,
    parseFavoritesDocumentJson,
    utf8Encode,
} from "../commands/favorites-document-json";
import type { FavoritesPhysicalStorageGrant } from "../storage/favorites-physical-storage";

export interface GlobalFavoriteValue {
    locator: any;
    origin: any;
    title: string;
}
export interface GlobalFavorite extends GlobalFavoriteValue {
    id: string;
}
export interface GlobalFavoritesPorts {
    /** Shared global receipt admission; every writer must consult this. */
    canWrite?(): boolean;
    capture(): FavoritesPhysicalStorageGrant | null;
    codec: {
        normalize(value: GlobalFavoriteValue): GlobalFavoriteValue | null;
        identity(value: GlobalFavoriteValue): string;
        /** Only an explicit verified mapping may retire a local legacy row. */
        migrateLegacy?(row: any): GlobalFavoriteValue | null;
    };
    current(): boolean;
    /** Trusted complete-source capture, retained through its one-time migration. */
    migrationCurrent?(id: string): boolean;
    sha256(text: string): Promise<string>;
    /** Cryptographically random UUIDv4, with no timestamp/Math.random fallback. */
    uuid(): string;
}
export type GlobalFavoritesChange =
    | { op: "put" | "replace"; entries: GlobalFavoriteValue[] }
    | { op: "legacy-put"; entry: any; portable?: GlobalFavoriteValue }
    | { op: "legacy-remove"; id: string }
    | { op: "remove" | "reorder"; ids: string[] }
    | { op: "forget-membership"; ids: string[]; tokens: string[] }
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
const GLOBAL_FAVORITES_KEY = "remoteFavorites.v1";
const GLOBAL_FAVORITES_UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?![\s\S])/;
const GLOBAL_FAVORITES_SHA = /^[0-9a-f]{64}(?![\s\S])/;
function globalFavoritesStoreFail(code: string): never {
    throw new Error(code);
}
function object(value: any): boolean {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
function globalFavoritesStoreKeys(value: any, names: string[]): boolean {
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
    return /* biome-ignore assist/source/useSortedKeys: Preserve the physical empty-store envelope byte order. */ {
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
        if (!globalFavoritesStoreKeys(value, ["title", "origin", "locator"]))
            globalFavoritesStoreFail("invalid_entry");
        const normalized = ports.codec.normalize(clone(value));
        if (
            !normalized ||
            !globalFavoritesStoreKeys(normalized, [
                "title",
                "origin",
                "locator",
            ])
        )
            globalFavoritesStoreFail("unsupported_entry");
        const result: GlobalFavoriteValue = clone(normalized);
        if (
            JSON.stringify(ports.codec.normalize(clone(result))) !==
            JSON.stringify(result)
        )
            globalFavoritesStoreFail("unstable_codec");
        return result;
    }
    function identity(value: GlobalFavoriteValue): string {
        var key = ports.codec.identity(
            clone({
                locator: value.locator,
                origin: value.origin,
                title: value.title,
            })
        );
        if (!text(key, 8192)) globalFavoritesStoreFail("invalid_identity");
        return key;
    }
    function document(raw: string | null): any {
        if (raw === null) return empty();
        var value = parseFavoritesDocumentJson(utf8Encode(raw));
        if (
            globalFavoritesStoreKeys(value, ["version", "entries"]) &&
            value.version === 1
        ) {
            if (
                !Array.isArray(value.entries) ||
                value.entries.length > 100 ||
                !value.entries.every(legacy)
            )
                globalFavoritesStoreFail("invalid_legacy");
            var result = empty();
            result.legacy = value.entries;
            value = result;
        }
        if (
            globalFavoritesStoreKeys(value, [
                "version",
                "entries",
                "legacy",
                "migrations",
            ]) &&
            value.version === 2
        )
            value.legacyAliases = {};
        if (
            !globalFavoritesStoreKeys(value, [
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
            globalFavoritesStoreFail("invalid_store");
        var ids: any = Object.create(null),
            identities: any = Object.create(null);
        value.entries.forEach(function (row: any) {
            if (
                !globalFavoritesStoreKeys(row, [
                    "id",
                    "title",
                    "origin",
                    "locator",
                ]) ||
                !GLOBAL_FAVORITES_UUID.test(row.id) ||
                ids[row.id]
            )
                globalFavoritesStoreFail("invalid_store");
            ids[row.id] = true;
            var entry = normalized({
                locator: row.locator,
                origin: row.origin,
                title: row.title,
            });
            if (
                entry.title !== row.title ||
                JSON.stringify(entry.origin) !== JSON.stringify(row.origin) ||
                JSON.stringify(entry.locator) !== JSON.stringify(row.locator)
            )
                globalFavoritesStoreFail("noncanonical_store");
            var key = identity(entry);
            if (identities[key]) globalFavoritesStoreFail("duplicate_identity");
            identities[key] = true;
        });
        ids = Object.create(null);
        value.legacy.forEach(function (row: any) {
            if (ids[row.id]) globalFavoritesStoreFail("invalid_legacy");
            ids[row.id] = true;
        });
        ids = Object.create(null);
        value.migrations.forEach(function (id: any) {
            if (!GLOBAL_FAVORITES_SHA.test(id) || ids[id])
                globalFavoritesStoreFail("invalid_migration");
            ids[id] = true;
        });
        if (!object(value.legacyAliases))
            globalFavoritesStoreFail("invalid_aliases");
        Object.keys(value.legacyAliases).forEach(function (id) {
            if (
                !value.legacy.some(function (row: any) {
                    return row.id === id;
                }) ||
                !value.entries.some(function (row: any) {
                    return row.id === value.legacyAliases[id];
                })
            )
                globalFavoritesStoreFail("invalid_aliases");
        });
        return value;
    }
    function alive(grant: FavoritesPhysicalStorageGrant): boolean {
        return ports.current() && grant.current();
    }
    async function revision(raw: string | null): Promise<string> {
        var value = await ports.sha256(raw === null ? "null" : raw);
        if (!GLOBAL_FAVORITES_SHA.test(value))
            globalFavoritesStoreFail("invalid_digest");
        return value;
    }
    async function snapshot() {
        const captured = ports.capture();
        if (!captured || !alive(captured))
            globalFavoritesStoreFail("unsupported_storage");
        const grant: FavoritesPhysicalStorageGrant = captured;
        var raw = grant.read(GLOBAL_FAVORITES_KEY),
            value = document(raw),
            rev = await revision(raw);
        function current(): boolean {
            try {
                return (
                    alive(grant) &&
                    grant.read(GLOBAL_FAVORITES_KEY) === raw &&
                    alive(grant)
                );
            } catch (_) {
                return false;
            }
        }
        if (!current()) globalFavoritesStoreFail("revision_conflict");
        return {
            current: current,
            entries: clone(value.entries),
            legacyCount: value.legacy.length,
            privateLegacy: function () {
                if (!current()) globalFavoritesStoreFail("revision_conflict");
                return {
                    aliases: clone(value.legacyAliases),
                    entries: clone(value.legacy),
                };
            },
            revision: rev,
            unresolvedLegacy: value.legacy
                .filter(function (row: any) {
                    return !value.legacyAliases[row.id];
                })
                .map(function (row: any) {
                    return {
                        id: row.id,
                        profile: row.profile_name,
                        provider: row.provider,
                        title: row.title,
                    };
                }),
        };
    }
    function apply(
        value: any,
        change: GlobalFavoritesChange,
        identityTokens: any,
        mappedLegacy: any
    ): void {
        if (!object(change)) globalFavoritesStoreFail("invalid_change");
        function suppress(entry: GlobalFavoriteValue, removed: boolean): void {
            var token = identityTokens[identity(entry)];
            if (!GLOBAL_FAVORITES_SHA.test(token))
                globalFavoritesStoreFail("invalid_digest");
            var at = value.migrations.indexOf(token);
            if (!removed) {
                if (at >= 0) value.migrations.splice(at, 1);
                return;
            }
            if (at >= 0) return;
            if (value.migrations.length === 8192)
                globalFavoritesStoreFail("limits_exceeded");
            value.migrations.push(token);
        }
        function put(entries: GlobalFavoriteValue[], migrating = false) {
            if (!Array.isArray(entries) || entries.length > 1000)
                globalFavoritesStoreFail("limits_exceeded");
            var known: any = Object.create(null),
                ids: any = Object.create(null);
            value.entries.forEach(function (row: GlobalFavorite) {
                known[identity(row)] = row.id;
                ids[row.id] = true;
            });
            return entries.map(function (input) {
                var entry = normalized(input),
                    key = identity(entry);
                if (
                    migrating &&
                    value.migrations.indexOf(identityTokens[key]) >= 0
                )
                    return null;
                if (!migrating) suppress(entry, false);
                if (known[key]) return known[key];
                if (value.entries.length === 1000)
                    globalFavoritesStoreFail("limits_exceeded");
                var id = ports.uuid();
                if (!GLOBAL_FAVORITES_UUID.test(id) || ids[id])
                    globalFavoritesStoreFail("invalid_uuid");
                ids[id] = true;
                known[key] = id;
                value.entries.push(
                    /* biome-ignore assist/source/useSortedKeys: Preserve persisted new-entry byte order used by physical store revisions. */ {
                        id: id,
                        title: entry.title,
                        origin: entry.origin,
                        locator: entry.locator,
                    }
                );
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
                if (!removed[row.id]) return true;
                suppress(row, true);
                return false;
            });
            value.legacy = value.legacy.filter(function (row: any) {
                return !removed[value.legacyAliases[row.id]];
            });
            Object.keys(value.legacyAliases).forEach(function (id) {
                if (removed[value.legacyAliases[id]])
                    delete value.legacyAliases[id];
            });
        }
        if (
            change.op === "put" &&
            globalFavoritesStoreKeys(change, ["op", "entries"])
        )
            put(change.entries);
        else if (
            change.op === "replace" &&
            globalFavoritesStoreKeys(change, ["op", "entries"])
        ) {
            if (!Array.isArray(change.entries) || change.entries.length > 1000)
                globalFavoritesStoreFail("limits_exceeded");
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
                suppress(entry, false);
                seen[key] = true;
                var previous = existing[key],
                    id = previous ? previous.id : ports.uuid();
                if (!GLOBAL_FAVORITES_UUID.test(id) || (!previous && ids[id]))
                    globalFavoritesStoreFail("invalid_uuid");
                ids[id] = true;
                retained[id] = true;
                replacement.push(
                    /* biome-ignore assist/source/useSortedKeys: Preserve persisted replacement-entry byte order used by physical store revisions. */ {
                        id: id,
                        title: entry.title,
                        origin: entry.origin,
                        locator: entry.locator,
                    }
                );
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
            (globalFavoritesStoreKeys(change, ["op", "entry"]) ||
                globalFavoritesStoreKeys(change, ["op", "entry", "portable"]))
        ) {
            if (!legacy(change.entry))
                globalFavoritesStoreFail("invalid_legacy");
            var index = value.legacy.findIndex(function (row: any) {
                return row.id === change.entry.id;
            });
            if (index < 0 && value.legacy.length >= 100)
                globalFavoritesStoreFail("limits_exceeded");
            if (index < 0) value.legacy.push(clone(change.entry));
            else value.legacy[index] = clone(change.entry);
            if (change.portable)
                value.legacyAliases[change.entry.id] = put([
                    change.portable,
                ])[0];
        } else if (
            change.op === "legacy-remove" &&
            globalFavoritesStoreKeys(change, ["op", "id"])
        ) {
            if (
                !value.legacy.some(function (row: any) {
                    return row.id === change.id;
                })
            )
                globalFavoritesStoreFail("favorite_not_found");
            if (value.legacyAliases[change.id])
                removeGlobals([value.legacyAliases[change.id]]);
            else
                value.legacy = value.legacy.filter(function (row: any) {
                    return row.id !== change.id;
                });
        } else if (
            change.op === "migrate-source" &&
            globalFavoritesStoreKeys(change, ["op", "migrationId", "entries"])
        ) {
            if (!GLOBAL_FAVORITES_SHA.test(change.migrationId))
                globalFavoritesStoreFail("invalid_migration");
            if (value.migrations.indexOf(change.migrationId) >= 0) return;
            if (value.migrations.length === 8192)
                globalFavoritesStoreFail("limits_exceeded");
            put(change.entries, true);
            value.migrations.push(change.migrationId);
        } else if (
            change.op === "migrate-membership" &&
            globalFavoritesStoreKeys(change, ["op", "migrationId", "entries"])
        ) {
            if (
                !GLOBAL_FAVORITES_SHA.test(change.migrationId) ||
                !Array.isArray(change.entries) ||
                change.entries.length > 1000
            )
                globalFavoritesStoreFail("invalid_migration");
            var tokens: any = Object.create(null),
                incoming: GlobalFavoriteValue[] = [];
            value.migrations.forEach(function (token: string) {
                tokens[token] = true;
            });
            change.entries.forEach(function (item) {
                if (
                    !globalFavoritesStoreKeys(item, ["token", "entry"]) ||
                    !GLOBAL_FAVORITES_SHA.test(item.token)
                )
                    globalFavoritesStoreFail("invalid_migration");
                var entry = normalized(item.entry);
                if (tokens[item.token]) return;
                if (value.migrations.length === 8192)
                    globalFavoritesStoreFail("limits_exceeded");
                tokens[item.token] = true;
                value.migrations.push(item.token);
                incoming.push(entry);
            });
            put(incoming, true);
        } else if (
            change.op === "migrate-legacy" &&
            globalFavoritesStoreKeys(change, ["op"])
        ) {
            if (!ports.codec.migrateLegacy)
                globalFavoritesStoreFail("unsupported_migration");
            value.legacy.forEach(function (row: any) {
                if (value.legacyAliases[row.id]) return;
                var mapped = mappedLegacy[row.id];
                if (mapped) {
                    var migrated = put([mapped], true)[0];
                    if (migrated) value.legacyAliases[row.id] = migrated;
                }
            });
        } else if (
            ((change.op === "remove" || change.op === "reorder") &&
                globalFavoritesStoreKeys(change, ["op", "ids"])) ||
            (change.op === "forget-membership" &&
                globalFavoritesStoreKeys(change, ["op", "ids", "tokens"]))
        ) {
            if (!Array.isArray(change.ids) || change.ids.length > 1000)
                globalFavoritesStoreFail("invalid_ids");
            var selected: any = Object.create(null),
                seen: any = Object.create(null);
            value.entries.forEach(function (row: GlobalFavorite) {
                selected[row.id] = row;
            });
            var ordered = change.ids.map(function (id) {
                if (
                    !GLOBAL_FAVORITES_UUID.test(id) ||
                    !selected[id] ||
                    seen[id]
                )
                    globalFavoritesStoreFail("invalid_ids");
                seen[id] = true;
                return selected[id];
            });
            if (change.op === "reorder") {
                if (ordered.length !== value.entries.length)
                    globalFavoritesStoreFail("invalid_ids");
                value.entries = ordered;
            } else {
                if (change.op === "forget-membership") {
                    if (
                        !Array.isArray(change.tokens) ||
                        change.tokens.length > 2 ||
                        change.tokens.some(function (token) {
                            return !GLOBAL_FAVORITES_SHA.test(token);
                        })
                    )
                        globalFavoritesStoreFail("invalid_migration");
                    change.tokens.forEach(function (token) {
                        if (value.migrations.indexOf(token) >= 0) return;
                        if (value.migrations.length === 8192)
                            globalFavoritesStoreFail("limits_exceeded");
                        value.migrations.push(token);
                    });
                }
                removeGlobals(change.ids);
            }
        } else globalFavoritesStoreFail("invalid_change");
    }
    async function prepare(
        expectedRevision: string,
        change: GlobalFavoritesChange,
        admission?: () => boolean
    ) {
        if (!GLOBAL_FAVORITES_SHA.test(expectedRevision))
            globalFavoritesStoreFail("invalid_revision");
        var request = clone(change);
        const captured = ports.capture();
        if (!captured || !alive(captured))
            globalFavoritesStoreFail("unsupported_storage");
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
        var before = grant.read(GLOBAL_FAVORITES_KEY),
            value = document(before);
        if (
            (await revision(before)) !== expectedRevision ||
            !admitted() ||
            grant.read(GLOBAL_FAVORITES_KEY) !== before
        )
            globalFavoritesStoreFail("revision_conflict");
        var pending: GlobalFavoriteValue[] = [],
            mappedLegacy: any = Object.create(null),
            identityTokens: any = Object.create(null);
        if (
            request.op === "put" ||
            request.op === "replace" ||
            request.op === "migrate-source"
        )
            pending = Array.isArray(request.entries)
                ? request.entries.slice()
                : [];
        if (request.op === "migrate-membership")
            pending = Array.isArray(request.entries)
                ? request.entries.map(function (row) {
                      return row && row.entry;
                  })
                : [];
        if (request.op === "legacy-put" && request.portable)
            pending.push(request.portable);
        if (
            request.op === "replace" ||
            request.op === "remove" ||
            request.op === "forget-membership" ||
            request.op === "legacy-remove"
        ) {
            value.entries.forEach(function (row: GlobalFavorite) {
                if (
                    request.op === "replace" ||
                    (request.op === "legacy-remove"
                        ? value.legacyAliases[request.id] === row.id
                        : Array.isArray(request.ids) &&
                          request.ids.indexOf(row.id) >= 0)
                )
                    pending.push({
                        locator: row.locator,
                        origin: row.origin,
                        title: row.title,
                    });
            });
        }
        if (request.op === "migrate-legacy" && ports.codec.migrateLegacy) {
            value.legacy.forEach(function (row: any) {
                if (value.legacyAliases[row.id]) return;
                var mapped = ports.codec.migrateLegacy!(clone(row));
                if (mapped) {
                    mappedLegacy[row.id] = normalized(mapped);
                    pending.push(mappedLegacy[row.id]);
                }
            });
        }
        if (pending.length > 2000) globalFavoritesStoreFail("limits_exceeded");
        for (var tokenIndex = 0; tokenIndex < pending.length; tokenIndex++) {
            var canonical = identity(normalized(pending[tokenIndex]));
            if (identityTokens[canonical]) continue;
            var token = await ports.sha256(
                JSON.stringify([
                    "global-favorites-removed-identity-v1",
                    canonical,
                ])
            );
            if (!GLOBAL_FAVORITES_SHA.test(token))
                globalFavoritesStoreFail("invalid_digest");
            identityTokens[canonical] = token;
        }
        if (!admitted() || grant.read(GLOBAL_FAVORITES_KEY) !== before)
            globalFavoritesStoreFail("revision_conflict");
        apply(value, request, identityTokens, mappedLegacy);
        var after = JSON.stringify(value);
        document(after);
        utf8Encode(after);
        var nextRevision = await revision(after);
        if (
            !admitted() ||
            grant.read(GLOBAL_FAVORITES_KEY) !== before ||
            !admitted()
        )
            globalFavoritesStoreFail("revision_conflict");
        var used = false;
        function current(): boolean {
            try {
                return (
                    !used &&
                    admitted() &&
                    grant.read(GLOBAL_FAVORITES_KEY) === before &&
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
                if (held !== grant || !current())
                    globalFavoritesStoreFail("revision_conflict");
                async function commit() {
                    if (!current())
                        globalFavoritesStoreFail("revision_conflict");
                    used = true;
                    if (
                        after === before ||
                        (before === null &&
                            !value.entries.length &&
                            !value.legacy.length &&
                            !value.migrations.length)
                    )
                        return {
                            changed: false,
                            outcome: "verified",
                            revision: expectedRevision,
                        };
                    try {
                        var result = grant.compareAndSwap(
                            GLOBAL_FAVORITES_KEY,
                            before,
                            after,
                            admitted
                        );
                        if (result === "conflict")
                            return {
                                changed: false,
                                outcome: "not_applied",
                                revision: expectedRevision,
                            };
                        if (
                            result !== "confirmed" ||
                            !admitted() ||
                            grant.read(GLOBAL_FAVORITES_KEY) !== after ||
                            !admitted()
                        )
                            return {
                                changed: null,
                                outcome: "unknown",
                                revision: null,
                            };
                        return {
                            changed: true,
                            outcome: "verified",
                            revision: nextRevision,
                        };
                    } catch (_) {
                        return {
                            changed: null,
                            outcome: "unknown",
                            revision: null,
                        };
                    }
                }
                return work(commit, held);
            });
        }
        return Object.freeze({
            afterRaw: after,
            beforeRaw: before,
            current: current,
            expectedRevision: expectedRevision,
            newRevision: nextRevision,
            physical: grant,
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
        if (value.unresolvedLegacy.length)
            globalFavoritesStoreFail("unportable_export");
        return {
            entries: value.entries.map(function (row: GlobalFavorite) {
                return {
                    locator: row.locator,
                    origin: row.origin,
                    title: row.title,
                };
            }),
            version: 1,
        };
    }
    return {
        mutate: mutate,
        portableSnapshot: portableSnapshot,
        prepare: prepare,
        snapshot: snapshot,
    };
}
