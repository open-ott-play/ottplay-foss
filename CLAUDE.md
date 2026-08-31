## ottplay-foss (open-ott-play/ottplay-foss)

**Repository:** `open-ott-play/ottplay-foss` (under the `4alvit` organization)
**Primary language:** TypeScript
**Key paths:** `src/channels/index.ts` (channel management, EPG, history)

### Prerequisites & Setup
- Node.js >= 18 (use `nvm` or similar)
- Install dependencies: `npm ci` (or `yarn install`)
- Build: `npm run build` (invokes `tsc`)
- Lint/Formatting: Biome (configured via `ultracite`); run `npm run lint` and `npm run format`
- Test: `npm test` (Jest)

### Important implementation notes (from graph and code analysis)

- **Channel state:**
  - `channels: Record<number, Channel>` – map of channel ID → Channel object.
  - `chanels` is an alias for `channels` (legacy compatibility).
  - `medHistory: MediaHistoryEntry[]` stores recently played items (see interface `MediaHistoryEntry` with fields `ch_id`, `name`, `t
itle`, `stream_url`, etc.).
  - `medFavorites` stores favorite media items.

- **Search infrastructure (pre‑fix):**
  - Functions `searchChannel`, `searchMedia`, `searchRec` only set the global `searchText` (or `historySearchText` after our changes)
 but were never used to filter lists.
  - The channel list UI used `curList` (category channel IDs) directly; media/history views used `medHistory` directly.

- **Missing functionality – historical search:**
  - No way to filter `medHistory` by name/title.
  - No way to filter the channel list by a search term.

### Changes made (added to `src/channels/index.ts`)

1. **History‑search state**
   ```typescript
   export let historySearchText = "";
   ```

2. **Search function for history**
   ```typescript
   /**
    * Set the history search query string.
    * @param query - The search text to filter history entries by.
    * Side effects: Sets `historySearchText`.
    */
   export function searchHistoryChannel(query: string): void {
       historySearchText = query;
   }
   ```

3. **Filtered‑history getter**
   ```typescript
   /**
    * Returns history entries that match `historySearchText` (case‑insensitive).
    * If the filter is empty, returns a copy of `medHistory`.
    */
   export function getFilteredHistory(): MediaHistoryEntry[] {
       if (!historySearchText) return medHistory.slice();
       const lower = historySearchText.toLowerCase();
       return medHistory.filter(
           entry =>
               (entry.name?.toLowerCase().includes(lower) ?? false) ||
               (entry.title?.toLowerCase().includes(lower) ?? false)
       );
   }
   ```

4. **Filtered‑channel getter (leverages existing `searchChannel`/`searchText`)**
   ```typescript
   /**
    * Returns channel IDs that match `searchText` (case‑insensitive) within the current category.
    * If the filter is empty, returns a copy of `curList`.
    */
   export function getFilteredChannelList(): number[] {
       if (!searchText) return curList.slice();
       const lower = searchText.toLowerCase();
       return curList.filter(chId => {
           const ch = chanels[chId];
           return (
               (ch?.channel_name?.toLowerCase().includes(lower) ?? false) ||
               (ch?.name?.toLowerCase().includes(lower) ?? false)
           );
       });
   }
   ```

## Ottplay-foss function lookup procedure

If the question is about the contents of the `ottplay-foss` folder/project — proceed as follows:

1. **Graphify search both repos:**
   - `4alvit/home-assistant` (legacy monolithic JS: `stbPlayer.js`, `keyHandler()` L7088)
   - `open-ott-play/ottplay-foss` (TS rewrite: `src/keyhandler/index.ts`, `keyHandler()` L90)

2. **If the output/function is found in only one repo:**
   - Analyze why the same behavior is missing/incomplete in the other
   - Compare: legacy JS uses inline switch with all key cases; new TS delegates to `handleMainKey` which may be empty/no-op
   - Port missing cases/logic from the legacy repo into the new one fully

3. **Deliver:** diff analysis (what differs, what's incomplete), then propose a complete port from the legacy project to the new one.

### How to use (host/pseudocode)

- **Channel search input:** call `searchChannel(query)` on input change, then refresh the channel list with `getFilteredChannelList()
` instead of `curList`.
- **History search input:** call `searchHistoryChannel(query)` on input change, then refresh the history view with `getFilteredHistor
y()` instead of `medHistory`.
- The existing `searchMedia` and `searchRec` can be wired similarly if media/records views need search.

These changes make the search feature functional while keeping the existing API consistent. No other files were modified.
