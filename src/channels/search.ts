/**
 * Search filter helpers leaf (Phase D).
 *
 * Pure/filter helpers extracted from channels/index.ts. Imported by that module;
 * listed on MODULES immediately before channels/index.js so concat+strip keeps
 * a single body per binding (not dual-listed with duplicate declarations).
 * Edit-key / heavy UI (searchChannel, searchMedia, searchRec) stays in index.
 */

/** Minimal history row shape used by getFilteredHistory. */
export interface SearchHistoryEntry {
    name?: string;
    title?: string;
}

/** Channel-name filter string (also set by searchMedia in index). */
export let searchText = "";

/** Assign searchText (index cannot assign to an import binding). */
export function setSearchText(value: string): void {
    searchText = value || "";
}

/** History filter string (set via searchHistoryChannel). */
export let historySearchText = "";

/* Ambient: provided by channels/index.js later in the classic concat bundle. */
declare var curList: number[];
declare var channels: Record<number, { channel_name?: string; name?: string }>;
declare var medHistory: SearchHistoryEntry[];

/**
 * Set the history search query string.
 * @param query - The search text to filter history entries by.
 * Side effects: Sets `historySearchText`.
 */
export function searchHistoryChannel(query: string): void {
    historySearchText = query;
}

/**
 * Returns history entries that match `historySearchText` (case-insensitive).
 * If the filter is empty, returns a copy of `medHistory`.
 */
export function getFilteredHistory(): SearchHistoryEntry[] {
    if (!historySearchText) return medHistory.slice();
    const lower = historySearchText.toLowerCase();
    return medHistory.filter(
        (entry) =>
            (entry.name?.toLowerCase().includes(lower) ?? false) ||
            (entry.title?.toLowerCase().includes(lower) ?? false)
    );
}

/**
 * Returns channel IDs that match `searchText` (case-insensitive) within the
 * current category. If the filter is empty, returns a copy of `curList`.
 */
export function getFilteredChannelList(): number[] {
    if (!searchText) return curList.slice();
    const lower = searchText.toLowerCase();
    return curList.filter((chId) => {
        const ch = channels[chId];
        return (
            (ch?.channel_name?.toLowerCase().includes(lower) ?? false) ||
            (ch?.name?.toLowerCase().includes(lower) ?? false)
        );
    });
}
