/**
 * Favorites multi-list leaf (Phase D2).
 *
 * List-model helpers extracted from channels/index.ts. Imported by that module;
 * listed on MODULES immediately before channels/index.js so concat+strip keeps
 * a single body per binding (not dual-listed with duplicate declarations).
 */

/** Multi-favorites lists blob — `{ v:1, lists, order, active }`. */
export interface FavoritesListsBlob {
    active: string;
    lists: Record<string, number[]>;
    order: string[];
    v: 1;
}

/**
 * Multi-favorites lists (Smart groups).
 * On first load, migrated from the prior single-array `favoritesArray` shape.
 * `favoritesArray` is kept in sync as the active list for existing readers.
 */
export let favoritesLists: FavoritesListsBlob = {
    active: "Favorites",
    lists: { Favorites: [] },
    order: ["Favorites"],
    v: 1,
};

/** Active-list alias for existing cats["Favorites"] / single-list readers. */
export let favoritesArray: number[] = favoritesLists.lists.Favorites;

/** Optional view refresh (bound from channels/index — avoids circular import). */
var favoritesViewRefresh: (() => void) | null = null;

/** Register Favorites-category view refresh (curList / indices). */
export function bindFavoritesViewRefresh(fn: () => void): void {
    favoritesViewRefresh = fn;
}

function applyFavoritesCatAlias(): void {
    if (typeof window === "undefined") return;
    var w = window as any;
    w.favoritesArray = favoritesArray;
    if (
        w.cats &&
        typeof w._ === "function" &&
        (w.sFavorites || w.cats[w._("Favorites")])
    )
        w.cats[w._("Favorites")] = favoritesArray;
}

export function syncFavoritesArrayFromActive(): void {
    // Keep `favoritesArray` as an alias of the active list so existing readers
    // (cats["Favorites"], single-favorites flows) keep working unchanged.
    favoritesArray = activeFavoritesList();
    applyFavoritesCatAlias();
    if (favoritesViewRefresh) favoritesViewRefresh();
}

export function activeFavoritesList(): number[] {
    return (window as any).OttPlayCore.favoriteListCurrent(favoritesLists);
}

export function getActiveFavoritesListName(): string {
    return favoritesLists.active;
}

/** Switch the active list. Updates `favoritesArray` alias and cats["Favorites"]. */
export function setActiveFavoritesList(name: string): boolean {
    return applyFavoriteListChange("activate", name);
}

export function listFavoritesLists(): string[] {
    return (window as any).OttPlayCore.favoriteListOrder(
        favoritesLists.lists,
        favoritesLists.order
    );
}

export function addFavoritesList(name: string): boolean {
    return applyFavoriteListChange("add", name);
}

export function renameFavoritesList(oldName: string, newName: string): boolean {
    return applyFavoriteListChange("rename", oldName, newName);
}

export function deleteFavoritesList(name: string): boolean {
    return applyFavoriteListChange("delete", name);
}

/** Load `favoritesLists` from storage; migrate from prior single-array shape. */
var favoritesSource = "";
var favoritesWritable = false;
var favoritesGeneration = 0;

function currentFavoritesSource(): string {
    return (window as any).__ottSourceIdentity.current(window);
}

export function saveFavoritesLists(): boolean {
    var w = window as any;
    if (!favoritesWritable || favoritesSource !== currentFavoritesSource())
        return false;
    var source = favoritesSource,
        generation = favoritesGeneration;
    var get = w.providerGetItem,
        set = w.providerSetItem;
    function current(): boolean {
        return (
            generation === favoritesGeneration &&
            source === currentFavoritesSource() &&
            get === w.providerGetItem &&
            set === w.providerSetItem
        );
    }
    try {
        var text = JSON.stringify({
            lists: favoritesLists,
            sourceId: source,
            version: 1,
        });
        var key = "favoritesLibrary:" + source;
        var prior = get.call(w, key);
        if (!current()) return false;
        if (prior !== text) set.call(w, key, text);
        if (!current() || get.call(w, key) !== text || !current()) return false;
        var claim = get.call(w, "favoritesLibrarySource");
        if (!current()) return false;
        if (!claim) set.call(w, "favoritesLibrarySource", source);
        return current();
    } catch (_) {
        return false;
    }
}

export function loadFavoritesLists(): void {
    var w = window as any;
    if (typeof w.providerGetJson !== "function") return;
    var source = currentFavoritesSource(),
        generation = ++favoritesGeneration;
    var get = w.providerGetItem,
        set = w.providerSetItem;
    function current(): boolean {
        return (
            generation === favoritesGeneration &&
            source === currentFavoritesSource() &&
            get === w.providerGetItem &&
            set === w.providerSetItem
        );
    }
    var writable = false;
    var raw: any = null;
    var prior: any[] = [];
    var scoped: any;
    try {
        scoped = get.call(w, "favoritesLibrary:" + source);
        if (scoped) {
            try {
                var envelope = JSON.parse(scoped);
                if (
                    envelope &&
                    envelope.version === 1 &&
                    envelope.sourceId === source &&
                    envelope.lists &&
                    envelope.lists.v === 1
                ) {
                    raw = envelope.lists;
                    writable = true;
                }
            } catch (_) {}
        } else {
            var claim = get.call(w, "favoritesLibrarySource");
            writable = true;
            if (!claim || claim === source) {
                try {
                    raw = w.providerGetJson("favoritesLists", null);
                } catch (_) {}
                if (
                    !(
                        raw &&
                        raw.v === 1 &&
                        raw.lists &&
                        typeof raw.lists === "object"
                    )
                )
                    prior = w.providerGetJson("favoritesArray", []) || [];
            }
        }
    } catch (_) {
        writable = false;
    }
    var loaded = w.OttPlayCore.loadClassicFavoriteLists(raw, prior);
    if (!current()) return;
    favoritesSource = source;
    favoritesWritable = writable;
    favoritesLists = loaded;
    saveFavoritesLists();
    syncFavoritesArrayFromActive();
}

function applyFavoriteListChange(
    operation: string,
    name: string,
    replacement?: string
): boolean {
    var result = (window as any).OttPlayCore.favoriteListChange(
        favoritesLists,
        "classic",
        operation,
        name,
        replacement
    );
    if (result.synchronize) syncFavoritesArrayFromActive();
    return result.accepted;
}
