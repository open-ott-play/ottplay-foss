/** Shared mixed list; labels remain text and inaccessible entries stay visible. */
export function createGlobalFavoritesView(ports: any): any {
    var generation = 0,
        shown = false,
        route: any = null;
    var favorite: (() => boolean) | null = null;
    function close(): void {
        generation++;
        favorite = null;
        shown = false;
        if (route) route.cancel();
        route = null;
    }
    async function open(): Promise<void> {
        close();
        shown = true;
        var owner = generation,
            snapshot: any;
        var initial = ports.captureScreen();
        try {
            snapshot = await ports.store.snapshot();
        } catch (_) {
            if (generation === owner && ports.current() && initial())
                ports.error("storage_unavailable");
            return;
        }
        if (!shown || generation !== owner || !ports.current() || !initial())
            return;
        var rows = snapshot.entries
            .map(function (entry: any) {
                return {
                    detail: ports.describe(entry.origin),
                    id: entry.id,
                    label: entry.title,
                };
            })
            .concat(
                (snapshot.unresolvedLegacy || []).map(function (entry: any) {
                    return {
                        detail: ports.translate("Unavailable"),
                        id: entry.id,
                        label: entry.title,
                        unresolved: true,
                    };
                })
            );
        (ports.pendingMigration ? ports.pendingMigration() : []).forEach(
            function (row: any) {
                rows.push({
                    detail: ports.translate("Unavailable"),
                    id: "pending-migration-" + rows.length,
                    label: row.title,
                    pending: true,
                });
            }
        );
        // Empty Favorites is still a selectable category/list on every provider.
        var screen: () => boolean = function () {
            return false;
        };
        var removing = false;
        function owned(): boolean {
            return (
                shown &&
                generation === owner &&
                ports.current() &&
                screen() &&
                ports.canFavorite()
            );
        }
        favorite = function () {
            if (!owned()) return false;
            if (removing) return true;
            var selected = rows[ports.selected()];
            var matches =
                selected &&
                snapshot.entries.filter(function (entry: any) {
                    return entry.id === selected.id;
                });
            if (!matches || matches.length !== 1 || !snapshot.current()) {
                ports.error("unavailable");
                return true;
            }
            var entry = matches[0];
            removing = true;
            Promise.resolve()
                .then(function () {
                    if (!owned() || !snapshot.current()) return null;
                    return ports.remove(entry.id, owned);
                })
                .then(function (result: any) {
                    if (!owned()) return;
                    if (
                        !result ||
                        result.outcome !== "verified" ||
                        result.changed !== true
                    ) {
                        ports.error("storage_unavailable");
                        return;
                    }
                    ports.removed(entry.title);
                    void open();
                })
                .catch(function () {
                    if (owned()) ports.error("storage_unavailable");
                })
                .then(function () {
                    removing = false;
                });
            return true;
        };
        screen = ports.show(
            /* biome-ignore assist/source/useSortedKeys: Preserve translation and navigation ownership callback evaluation order. */ {
                id: "system:global-favorites",
                title: ports.translate("Favorites"),
                rows: rows,
                remove: function (): boolean {
                    return (
                        generation === owner &&
                        shown &&
                        !!favorite &&
                        favorite()
                    );
                },
                selected: ports.navigation.currentId(snapshot.entries),
                playing: function (id: string) {
                    return ports.navigation.isPlaying(id, snapshot.entries);
                },
                select: function (id: string): void {
                    if (
                        !shown ||
                        generation !== owner ||
                        !ports.current() ||
                        !screen()
                    )
                        return;
                    if (!snapshot.current()) {
                        open();
                        return;
                    }
                    if (/^pending-migration-/.test(id)) {
                        ports.error("unavailable");
                        return;
                    }
                    var chosen = rows.filter(function (row: any) {
                        return row.id === id;
                    });
                    if (chosen.length !== 1) return;
                    if (route) route.cancel();
                    if (chosen[0].unresolved) {
                        if (!ports.playLegacy) {
                            ports.error("mapping_required");
                            return;
                        }
                        route = ports.playLegacy(id);
                    } else route = ports.router.select(id);
                    route.result.then(
                        function (result: any) {
                            if (
                                !shown ||
                                generation !== owner ||
                                !ports.current() ||
                                !screen()
                            )
                                return;
                            if (result.status === "ok") {
                                void open();
                                return;
                            }
                            if (
                                result.status !== "ok" &&
                                result.status !== "cancelled"
                            )
                                ports.error(result.status, id);
                        },
                        function () {
                            if (
                                shown &&
                                generation === owner &&
                                ports.current() &&
                                screen()
                            )
                                ports.error("unavailable", id);
                        }
                    );
                },
                close: function () {
                    if (generation === owner) close();
                },
            }
        );
    }
    return {
        category: function () {
            return {
                id: "system:global-favorites",
                label: ports.translate("Favorites"),
                open: open,
            };
        },
        close: close,
        favoriteSelected: function () {
            return !!favorite && favorite();
        },
        open: open,
    };
}
