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
export let favoritesArray: number[] = [];

/** Optional view refresh (bound from channels/index — avoids circular import). */
var favoritesViewRefresh: (() => void) | null = null;

/** Register Favorites-category view refresh (curList / indices). */
export function bindFavoritesViewRefresh(fn: () => void): void {
    favoritesViewRefresh = fn;
}

function applyFavoritesCatAlias(): void {
    if (typeof window === "undefined") return;
    var w = window as any;
    if (w.cats && typeof w._ === "function")
        w.cats[w._("Favorites")] = favoritesArray;
}

export function syncFavoritesArrayFromActive(): void {
    // Keep `favoritesArray` as an alias of the active list so existing readers
    // (cats["Favorites"], single-favorites flows) keep working unchanged.
    favoritesArray = activeFavoritesList().slice();
}

export function activeFavoritesList(): number[] {
    if (!favoritesLists.lists[favoritesLists.active])
        favoritesLists.lists[favoritesLists.active] = [];
    return favoritesLists.lists[favoritesLists.active];
}

export function getActiveFavoritesListName(): string {
    return favoritesLists.active;
}

/** Switch the active list. Updates `favoritesArray` alias and cats["Favorites"]. */
export function setActiveFavoritesList(name: string): boolean {
    if (!favoritesLists.lists[name]) return false;
    favoritesLists.active = name;
    syncFavoritesArrayFromActive();
    applyFavoritesCatAlias();
    if (favoritesViewRefresh) favoritesViewRefresh();
    return true;
}

export function listFavoritesLists(): string[] {
    // Stable order: declared `order` first, then any lists added out-of-band.
    var seen: Record<string, boolean> = {};
    var out: string[] = [];
    favoritesLists.order.forEach(function (n) {
        if (favoritesLists.lists[n] && !seen[n]) {
            out.push(n);
            seen[n] = true;
        }
    });
    Object.keys(favoritesLists.lists).forEach(function (n) {
        if (!seen[n]) {
            out.push(n);
            seen[n] = true;
        }
    });
    return out;
}

export function addFavoritesList(name: string): boolean {
    name = (name || "").trim();
    if (!name || favoritesLists.lists[name]) return false;
    favoritesLists.lists[name] = [];
    if (favoritesLists.order.indexOf(name) === -1)
        favoritesLists.order.push(name);
    return true;
}

export function renameFavoritesList(oldName: string, newName: string): boolean {
    newName = (newName || "").trim();
    if (!newName || newName === oldName) return false;
    if (!favoritesLists.lists[oldName] || favoritesLists.lists[newName])
        return false;
    favoritesLists.lists[newName] = favoritesLists.lists[oldName];
    delete favoritesLists.lists[oldName];
    var oi = favoritesLists.order.indexOf(oldName);
    if (oi !== -1) favoritesLists.order[oi] = newName;
    if (favoritesLists.active === oldName) favoritesLists.active = newName;
    return true;
}

export function deleteFavoritesList(name: string): boolean {
    if (!favoritesLists.lists[name]) return false;
    if (Object.keys(favoritesLists.lists).length <= 1) return false; // keep >=1
    delete favoritesLists.lists[name];
    var oi = favoritesLists.order.indexOf(name);
    if (oi !== -1) favoritesLists.order.splice(oi, 1);
    if (favoritesLists.active === name)
        favoritesLists.active = favoritesLists.order[0] || "Favorites";
    syncFavoritesArrayFromActive();
    applyFavoritesCatAlias();
    return true;
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
    if (raw && raw.v === 1 && raw.lists && typeof raw.lists === "object") {
        favoritesLists = {
            active:
                raw.active || Object.keys(raw.lists || {})[0] || "Favorites",
            lists: raw.lists || {},
            order: Array.isArray(raw.order)
                ? raw.order
                : Object.keys(raw.lists || {}),
            v: 1,
        };
        if (!favoritesLists.lists[favoritesLists.active])
            favoritesLists.active =
                Object.keys(favoritesLists.lists)[0] || "Favorites";
        syncFavoritesArrayFromActive();
        return;
    }
    // Migrate from prior single-array favoritesArray storage.
    var prior: number[] =
        (window as any).providerGetJson("favoritesArray", []) || [];
    favoritesLists = {
        active: "Favorites",
        lists: { Favorites: prior.slice() },
        order: ["Favorites"],
        v: 1,
    };
    favoritesArray = prior.slice();
}
