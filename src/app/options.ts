/**
 * Options / settings menu system for OTT-play FOSS.
 *
 * Provides a small data structure of menu entries (action + label +
 * description) plus index/removal/insertion helpers. `optionsArr` is
 * the live, mutable list — UI code mutates it in place.
 */

export interface OptionEntry {
    action: any;
    desc?: string;
    name?: string;
}

/**
 * Live list of menu entries shown in the settings submenu.
 * Mutated by delOption / addBtn2menu / etc.
 */
export const optionsArr: OptionEntry[] = [];

/**
 * Find the index of `action` in an array of `{ action }` objects.
 * @returns -1 if not found.
 */
export function indexOfAction(arr: OptionEntry[], action: any): number {
    for (let i = 0; i < arr.length; i++) if (arr[i].action === action) return i;
    return -1;
}

/** Convenience: find `action` in the global optionsArr. */
export function optIndexOf(action: any): number {
    return indexOfAction(optionsArr, action);
}

/**
 * Remove the entry matching `action` from optionsArr, if present.
 */
export function delOption(action: any): void {
    const idx = indexOfAction(optionsArr, action);
    if (idx !== -1) optionsArr.splice(idx, 1);
}

/**
 * Append a `{ action, name }` entry to `arr`. (Legacy signature — the
 * caller passes the target array; for optionsArr, use `addBtn2menu(arr, action, label)`.)
 */
export function addBtn2menu(
    arr: OptionEntry[],
    action: any,
    label: string
): void {
    arr.push({ action, name: label });
}
