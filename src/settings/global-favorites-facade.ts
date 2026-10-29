import {
    parseFavoritesDocumentJson,
    utf8Encode,
} from "../commands/favorites-document-json";

export interface GlobalFavoritesFacadePorts {
    caselessKey(value: string): string;
    store: any;
    codec: any;
    locatorKinds: string[];
    current(): boolean;
    qualify?(): Promise<boolean>;
    uuid(): string;
    sha256(text: string): Promise<string>;
    capture(): Promise<{ value: any; current(): boolean }>;
    captureLegacy(): Promise<{ entry: any; value?: any; current(): boolean }>;
    playEntry(
        id: string,
        current: () => boolean
    ): { result: Promise<any>; cancel(): void };
    playLegacy(
        entry: any,
        current: () => boolean
    ): { result: Promise<any>; cancel(): void };
}
function failure(code: string): never {
    throw new Error(code);
}
function publicLegacy(row: any): any {
    return {
        id: row.id,
        kind: row.kind,
        name: row.name,
        profile_name: row.profile_name,
        profile_number: row.profile_number,
        provider: row.provider,
        title: row.title,
    };
}
/** Shared facade: legacy writes never serialize a projected/limited list. */
export function createGlobalFavoritesFacade(ports: GlobalFavoritesFacadePorts) {
    var caselessKey = ports.caselessKey;
    function current(extra?: () => boolean): boolean {
        return ports.current() && (!extra || extra());
    }
    async function list(cursor: any = null, limit = 100) {
        if (Math.floor(limit) !== limit || limit < 1 || limit > 100)
            failure("invalid_request");
        var view = await ports.store.snapshot();
        if (!current() || !view.current()) failure("context_changed");
        var offset = cursor ? cursor.offset : 0;
        if (
            cursor &&
            (cursor.revision !== view.revision ||
                Math.floor(offset) !== offset ||
                offset < 0 ||
                offset > view.entries.length)
        )
            failure("revision_conflict");
        var end = Math.min(offset + limit, view.entries.length);
        function page() {
            return {
                entries: view.entries.slice(offset, end),
                total: view.entries.length,
                next_cursor:
                    end < view.entries.length
                        ? { revision: view.revision, offset: end }
                        : null,
                revision: view.revision,
                unresolved_legacy_count: view.unresolvedLegacy.length,
            };
        }
        while (
            end > offset &&
            utf8Encode(JSON.stringify(page())).length > 14000
        )
            end--;
        if (offset < view.entries.length && end === offset)
            failure("limits_exceeded");
        return page();
    }
    async function add(admission?: () => boolean) {
        if (ports.qualify) await ports.qualify();
        var captured = await ports.capture();
        if (!current(admission) || !captured.current())
            failure("context_changed");
        var view = await ports.store.snapshot();
        return ports.store.mutate(
            view.revision,
            { op: "put", entries: [captured.value] },
            function () {
                return current(admission) && captured.current();
            }
        );
    }
    async function remove(id: string, admission?: () => boolean) {
        if (ports.qualify) await ports.qualify();
        var view = await ports.store.snapshot();
        if (!current(admission) || !view.current()) failure("context_changed");
        return ports.store.mutate(
            view.revision,
            { op: "remove", ids: [id] },
            function () {
                return current(admission);
            }
        );
    }
    async function legacy(params: any, admission: () => boolean) {
        if (params.op !== "list" && params.op !== "play" && ports.qualify)
            await ports.qualify();
        var view = await ports.store.snapshot();
        if (!current(admission) || !view.current()) failure("context_changed");
        var privateView = view.privateLegacy(),
            rows = privateView.entries;
        if (params.op === "list") return { entries: rows.map(publicLegacy) };
        var selected: any;
        if (params.op !== "add") {
            var query = params.query && caselessKey(params.query.trim());
            var matches = rows.filter(function (row: any) {
                return params.id
                    ? row.id === params.id
                    : caselessKey(row.name) === query;
            });
            if (!matches.length && query)
                matches = rows.filter(function (row: any) {
                    return caselessKey(row.name).indexOf(query) >= 0;
                });
            if (matches.length !== 1)
                failure(
                    matches.length ? "ambiguous_favorite" : "favorite_not_found"
                );
            selected = matches[0];
        }
        if (params.op === "remove") {
            var removed = await ports.store.mutate(
                view.revision,
                { op: "legacy-remove", id: selected.id },
                function () {
                    return current(admission);
                }
            );
            if (removed.outcome !== "verified") failure("storage_unavailable");
            return { entry: publicLegacy(selected), removed: true };
        }
        if (params.op === "add") {
            var captured = await ports.captureLegacy();
            if (!current(admission) || !captured.current())
                failure("context_changed");
            var entry = captured.entry;
            var previous = rows.filter(function (row: any) {
                return (
                    row.provider === entry.provider &&
                    row.profile_number === entry.profile_number &&
                    row.source === entry.source &&
                    row.kind === entry.kind &&
                    JSON.stringify(row.ref) === JSON.stringify(entry.ref)
                );
            })[0];
            entry.id = previous ? previous.id : "fav-" + ports.uuid();
            entry.name =
                params.name !== undefined
                    ? params.name.trim()
                    : previous
                      ? previous.name
                      : entry.name;
            if (!previous && rows.length >= 100) failure("too_many_favorites");
            var change: any = { op: "legacy-put", entry: entry };
            if (captured.value) change.portable = captured.value;
            var added = await ports.store.mutate(
                view.revision,
                change,
                function () {
                    return current(admission) && captured.current();
                }
            );
            if (added.outcome !== "verified") failure("storage_unavailable");
            return { created: !previous, entry: publicLegacy(entry) };
        }
        if (params.op !== "play") failure("invalid_request");
        if (!current(admission) || !view.current()) failure("context_changed");
        var guard = function () {
            return current(admission) && view.current();
        };
        var action = privateView.aliases[selected.id]
            ? ports.playEntry(privateView.aliases[selected.id], guard)
            : ports.playLegacy(selected, guard);
        return {
            cancel: action.cancel,
            result: action.result.then(function (value: any) {
                if (
                    !value ||
                    (value.status !== "ok" && value.dispatched !== true)
                )
                    failure("playback_failed");
                return { dispatched: true, entry: publicLegacy(selected) };
            }),
        };
    }
    async function play(id: string, admission: () => boolean) {
        var view = await ports.store.snapshot();
        if (
            !current(admission) ||
            !view.current() ||
            !view.entries.some(function (row: any) {
                return row.id === id;
            })
        )
            failure("favorite_not_found");
        return ports.playEntry(id, function () {
            return current(admission) && view.current();
        });
    }
    async function exportSnapshot() {
        var view = await ports.store.snapshot();
        if (!current() || !view.current()) failure("context_changed");
        if (view.unresolvedLegacy.length) failure("unportable_export");
        return {
            current: view.current,
            document: {
                version: 1,
                entries: view.entries.map(function (row: any) {
                    return {
                        title: row.title,
                        origin: row.origin,
                        locator: row.locator,
                    };
                }),
            },
        };
    }
    return {
        current: ports.current,
        list: list,
        add: add,
        remove: remove,
        legacy: legacy,
        play: play,
        exportSnapshot: exportSnapshot,
        export: function () {
            return ports.store.portableSnapshot();
        },
    };
}
