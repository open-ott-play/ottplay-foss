interface MediaJournalPorts {
    core: any;
    current?(): boolean;
    enabled?(): boolean;
    importRows(rows: any[]): any[];
    legacyId?: string;
    limit(): number;
    read(key: string): string | null;
    sourceId: string;
    write(key: string, value: string): void;
}

/** Versioned source-scoped data. Legacy rows may be adopted by only one account. */
function createMediaJournal(ports: MediaJournalPorts) {
    var key = "mediaJournal.v1:" + ports.sourceId;
    var ownerKey =
        "mediaJournalLegacyOwner:" + (ports.legacyId || ports.sourceId);
    var state: any = {
        favorites: [],
        history: [],
        sourceId: ports.sourceId,
        version: 1,
    };
    var writable = true;
    var loaded = false;
    function detached(value: any) {
        return JSON.parse(JSON.stringify(value));
    }
    function write(key: string, value: string) {
        ports.write(key, value);
        if (ports.read(key) !== value)
            throw new Error("Media journal write was not retained");
    }
    function valid(rows: any): boolean {
        return (
            Array.isArray(rows) &&
            rows.length <= 1000 &&
            rows.every(function (row: any) {
                return (
                    row &&
                    row.sourceId === ports.sourceId &&
                    typeof row.itemId === "string" &&
                    row.itemId &&
                    typeof row.position === "number" &&
                    isFinite(row.position) &&
                    row.position >= 0 &&
                    row.payload &&
                    typeof row.payload === "object"
                );
            })
        );
    }
    function read() {
        if (ports.enabled && !ports.enabled()) return;
        if (loaded) return;
        loaded = true;
        try {
            var raw = ports.read(key);
            if (raw) {
                var parsed = JSON.parse(raw);
                if (
                    parsed.version !== 1 ||
                    parsed.sourceId !== ports.sourceId ||
                    !valid(parsed.history) ||
                    !valid(parsed.favorites)
                ) {
                    writable = false;
                    return;
                }
                state = parsed;
                return;
            }
            var owner = ports.read(ownerKey);
            if (owner && owner !== ports.sourceId) return;
            function legacy(name: string) {
                var text = ports.read(name);
                if (!text) return [];
                try {
                    var rows = JSON.parse(text);
                    return Array.isArray(rows) ? ports.importRows(rows) : [];
                } catch (_) {
                    return [];
                }
            }
            var imported = {
                favorites: legacy("medFavorites"),
                history: legacy("medHistory"),
                sourceId: ports.sourceId,
                version: 1,
            };
            // Claim before publishing imported data; storage failure never grants a second account.
            write(ownerKey, ports.sourceId);
            write(key, JSON.stringify(imported));
            state = imported;
        } catch (_) {
            writable = false;
        }
    }
    function peek(reader = ports.read) {
        if (
            (ports.current && !ports.current()) ||
            (ports.enabled && !ports.enabled()) ||
            !writable
        )
            return { document: null, writable: false };
        try {
            var raw = reader(key),
                parsed =
                    raw === null
                        ? {
                              favorites: [],
                              history: [],
                              sourceId: ports.sourceId,
                              version: 1,
                          }
                        : JSON.parse(raw);
            if (raw === null) {
                var owner = reader(ownerKey);
                if (!owner || owner === ports.sourceId) {
                    for (var name of ["medFavorites", "medHistory"]) {
                        var legacy = reader(name);
                        if (legacy !== null && legacy !== "[]")
                            return { document: null, writable: false };
                    }
                }
            }
            if (
                !parsed ||
                parsed.version !== 1 ||
                parsed.sourceId !== ports.sourceId ||
                !valid(parsed.history) ||
                !valid(parsed.favorites) ||
                (loaded && JSON.stringify(state) !== JSON.stringify(parsed))
            )
                return { document: null, writable: false };
            return { document: detached(parsed), writable: true };
        } catch (_) {
            return { document: null, writable: false };
        }
    }
    return {
        // Source-owned, read-only export. It neither claims legacy data nor initializes storage.
        captureFavorites: function () {
            if (!ports.current || !ports.current()) return null;
            try {
                var raw = ports.read(key);
                if (raw === null || raw.length > 2 * 1024 * 1024) return null;
                var parsed = JSON.parse(raw);
                if (
                    parsed.version !== 1 ||
                    parsed.sourceId !== ports.sourceId ||
                    !valid(parsed.history) ||
                    !valid(parsed.favorites)
                )
                    return null;
                if (!ports.current() || ports.read(key) !== raw) return null;
                return {
                    sourceId: ports.sourceId,
                    favorites: detached(parsed.favorites),
                    raw: raw,
                    current: function () {
                        return (
                            !!ports.current &&
                            ports.current() &&
                            ports.read(key) === raw &&
                            ports.current()
                        );
                    },
                };
            } catch (_) {
                return null;
            }
        },
        // Adopt verified external bytes without writing or replaying a mutation.
        adopt: function (
            raw: string,
            transferRead?: (key: string) => string | null
        ): boolean {
            if (
                (!loaded && !transferRead) ||
                !writable ||
                !ports.current ||
                !ports.current() ||
                (ports.enabled && !ports.enabled())
            )
                return false;
            try {
                if (typeof raw !== "string" || raw.length > 2 * 1024 * 1024)
                    return false;
                var parsed = JSON.parse(raw);
                if (
                    !parsed ||
                    parsed.version !== 1 ||
                    parsed.sourceId !== ports.sourceId ||
                    !valid(parsed.history) ||
                    !valid(parsed.favorites)
                )
                    return false;
                if (
                    (transferRead || ports.read)(key) !== raw ||
                    !ports.current() ||
                    (ports.enabled && !ports.enabled())
                )
                    return false;
                state = parsed;
                loaded = true;
                return true;
            } catch (_) {
                return false;
            }
        },
        change: function (operation: string, entry: any): boolean {
            if (ports.enabled && !ports.enabled()) return false;
            read();
            if (!writable || !entry || entry.sourceId !== ports.sourceId)
                return false;
            var changed = ports.core.mediaCollectionChange(
                state.history,
                state.favorites,
                operation,
                entry,
                ports.limit()
            );
            var next = {
                favorites: changed.favorites,
                history: changed.history,
                sourceId: ports.sourceId,
                version: 1,
            };
            try {
                var text = JSON.stringify(next);
                write(key, text);
                state = JSON.parse(text);
                return true;
            } catch (_) {
                return false;
            }
        },
        // Explicit read-only path: never claims legacy rows or initializes the cache.
        peek: peek,
        read: function () {
            read();
            return { document: detached(state), writable: writable };
        },
    };
}

(window as any).__ottMediaJournal = { create: createMediaJournal };
