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
export function loadFavoritesLists(): void {
    if (
        typeof window === "undefined" ||
        typeof (window as any).providerGetJson !== "function"
    )
        return;
    var raw: any = null;
    try {
        raw = (window as any).providerGetJson("favoritesLists", null);
    } catch (_) {}
    // The old single-array read is only performed when this is not a v1 envelope.
    var prior =
        raw && raw.v === 1 && raw.lists && typeof raw.lists === "object"
            ? []
            : (window as any).providerGetJson("favoritesArray", []) || [];
    favoritesLists = (window as any).OttPlayCore.loadClassicFavoriteLists(
        raw,
        prior
    );
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
