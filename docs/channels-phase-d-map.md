# channels/index.ts Phase D1 Cluster Map

**Last updated:** 2026-09-06
**File size:** ~4887 lines

## Cluster Inventory

### 1. Playlist Load / Channel List (lines 1–1100, 4290–4595)

Core channel management, navigation, and list operations.

**State vars:** `channels`, `cats`, `catsArray`, `curList`, `cList`, `providerPrefix`, `favoritesArray`, `favoritesLists`, `parentalArray`, `playType`, `archivePos`, `fileArchive`, `searchText`, `sSortAbc`

**Symbols:**
- `setCurrent`, `nextChannel`, `prevChannel`, `handleNumberInput` — navigation
- `getChannelUrl` — stream URL resolution
- `onChanelsLoaded` — provider load entry point (lines 1268–1418)
- `saveChannelsCats` (1006) — persist cats/favorites/parental
- `channelsList`, `bucketsList` — render lists
- `bucketsKeyHandler` (3230) — key handler for buckets
- `channelsKeyHandler` (4293) — main channel list key handler
- `moveChannel` (4507), `deleteChannel` (4537) — mutation ops
- `showActionsDialog` (3829) — popup for move/delete/sort/parental
- `sortChannels` (4173) — sort mode setter
- `getCHarr`, `execCHarr`, `saveCHarr` (4203, 4221, 4252) — per-channel settings storage

**Window publishes (src/index.ts ~3275–3360):** `setCurrent`, `nextChannel`, `prevChannel`, `getChannelUrl`, `saveChannelsCats`, `channelsList`, `bucketsList`, `channels`, `cats`, `catsArray`, `curList`, `favoritesArray`, `cList`, `providerPrefix`

**Inbound:** Provider clears/loads → `onChanelsLoaded`; `ui/index` uses `getCurProgData`; `index.ts` imports many symbols.

**Risk:** Core hub. High MODULES/strip collision. Do not extract first.

---

### 2. EPG (lines 1075–1920, 2000–2200)

Program guide data, timer management, detailed EPG view.

**State vars:** `epg`, `epgCash`, `epgCashObj`, `epgCashArr`, `epgTimers`, `curEpgData`, `epgArray`, `arrayGetCurProg`

**Symbols:**
- `getEPGchanelCached` (1075), `getEPGchanelCurCached` (1125), `getEpgFromCash` (1136)
- `getCurProgData` (1148), `setCurProg` (1189), `doGetCurProg` — program lookup
- `formatEpgTime` (1426) — timestamp formatting
- `itemEPG` (1449) — HTML renderer for EPG items
- `epgShow_miniproc` (1509), `epgCheckEmpty_miniproc` (1577)
- `epgList` (1594), `selectEpg` (1667), `epgPodval` (1701) — list view
- `epgKeyHandler` (1759) — key handler for EPG view
- `detailEPG` (1881) — detailed EPG dialog
- `renderEpgHTML` (1928)
- `startEpgTimer` (1957), `loadEpgTimers` (2029), `setEpgTimer` (2062), `epgListAlpha` (2119) — timer system

**Window:** `epgList`, `epgListAlpha`, `epgShow_miniproc`, `epgKeyHandler`, `epgPodval`, `detailEPG`, `setEpgTimer`, `itemEPG`, `epgArray`, `setCurProg`, `getCurProgData`

**Inbound:** Heavy from playlist (`onChanelsLoaded` → `loadEpgTimers`); `channelsKeyHandler` → `epgList`; archive/timeshift.

**Risk:** Densest cross-cluster coupling. AVOID for D2 first extract.

---

### 3. Favorites Multi-list (lines 594–730)

Favorites CRUD, multi-list management, alias handling.

**State vars:** `favoritesArray`, `favoritesLists`

**Symbols:**
- `addToFavorites`, `removeFromFavorites` — single-item ops
- `syncFavoritesArrayFromActive` (616) — keep alias in sync
- `activeFavoritesList` (622) — get current list
- `getActiveFavoritesListName`, `setActiveFavoritesList` (628, 633) — switch lists
- `listFavoritesLists` (643), `addFavoritesList` (662), `renameFavoritesList` (671), `deleteFavoritesList` (684) — CRUD
- `refreshFavoritesViewIfActive` (704)

**Window:** `addToFavorites`, `removeFromFavorites`, `popFavLists`, `getActiveFavoritesListName`, `setActiveFavoritesListName/List`, `add/rename/deleteFavoritesList`, `listFavoritesLists`, `favoritesArray`

**Inbound:** `index.ts` popupActions.push(popFavLists); provider clears `favoritesArray`; settings export/import.

**Risk:** Medium. Mutates `cats["Favorites"]`, calls `saveChannelsCats`. Multi-list CRUD (~616–700) is relatively leaf-like.

---

### 4. Archive / Records / Media (lines 2500–3430)

Timeshift, playback resume, media history.

**State vars:** `archivePos`, `fileArchive`, `mediaListArr`, `mediaNames`, `mediaRecords`, `mediaName`, `medHistory`

**Symbols:**
- `playArchive` (541), `updateArchiveInfo` (2602), `liveStop` (2810)
- `shiftArchive` (2874), `shiftArchiveSelect` (2976), `timeShift` (3078)
- `recordsList` (2195), `selectREC` (2260), `detailREC` (2274), `catRecordsList` (2292)
- `mediaKeyHandler` (2351), `addToMedFavorites` (2391)
- `selectMedia` (2419), `showMediaList` (2452), `getMediaDescr` (2507)

**Window:** `playArchive`, `fileArchive`, `shiftArchive`, `shiftArchiveSelect`, `timeShift`, `recordsList`, `updateArchiveInfo`

**Inbound:** `restoreContinueWatch` → `playArchive`; `ui/index` uses `mediaKeyHandler`.

**Risk:** Medium-high; ties to player/EPG timeshift.

---

### 5. Search (lines 3600–4070)

Filter helpers, history search, media search.

**Symbols:**
- `searchChannel` (3601) — filters current channel list by name
- `getFilteredChannelList` (3979) — returns filtered ID array
- `searchHistoryChannel` (3957), `getFilteredHistory` (3965) — history history search
- `searchEpgByTitle` (3432) — EPG programme title search
- `searchMedia` (3991), `searchRec` (4035) — media/records search
- `showActionsDialog` (3829) — also used for search button in popup

**Risk:** Low-medium. Search helpers are relatively isolated.

---

### 6. Parental Control (lines 1024–4760)

PIN entry, lock checking, access management.

**Symbols:**
- `hasParentalLock` (1024), `ifParentalAccess` (1037), `ifParentalAccessChId` (1058)
- `getEPGchanelCached` (1075) — EPG fetch
- `_enterPinCode` (4571), `enterPinCode` (4676)
- `setParentAccess` (4699), `enterPinAndSetAccess` (4721)
- `parentControlSetup` (4751)

**Window:** parent control APIs from index.ts (~3099–3103).

---

## Recommended D2 Target

**Extract favorites multi-list leaf** as `src/channels/favorites-lists.ts`.

**Rationale:**
- CRUD helpers (lines 643–696) are the most isolated non-EPG functions
- No `window.*` dual-publishing risk
- `favoritesArray` alias pattern preserved by importing, not duplicating
- Avoids EPG coupling

**Extract these exports only:**
- `getActiveFavoritesListName`
- `setActiveFavoritesList`
- `listFavoritesLists`
- `addFavoritesList`
- `renameFavoritesList`
- `deleteFavoritesList`
- `syncFavoritesArrayFromActive`
- `activeFavoritesList`

**Keep in channels/index.ts:**
- `addToFavorites`, `removeFromFavorites` (wires to `popupActions`)
- `refreshFavoritesViewIfActive`, `popFavLists` (UI-heavy)
- `favoritesArray`, `favoritesLists` state vars (re-exported via import)

**Import pattern (strip-safe):**
```ts
// No redeclaration: import the bindings themselves
export {
   getActiveFavoritesListName,
    setActiveFavoritesList,
    ...etc
} from "./favorites-lists";
```

---

## NOT Recommended for D2

- **EPG cluster** — densest coupling, AVOID
- **Playlist load** — core hub, MODULES collision risk
- **Archive/Records** — ties to player/EPG
- **Search** — low priority vs favorites; `searchEpgByTitle` lives in EPG cluster

---

## D2 Implementation Checklist

- [ ] Create `src/channels/favorites-lists.ts` with extracted favorites multi-list functions
- [ ] Add file to `vite.config.ts` MODULES before `channels/index.ts` (if strip-safe) OR import from channels/index.ts
- [ ] Verify `favoritesArray` alias behavior preserved
- [ ] Run `npx tsc --noEmit` for type check
- [ ] Run `npm run build` and verify bundle identifiers
- [ ] Test on Chrome desktop + one HS5/`prov.js` path
- [ ] Single squash PR (no code moves in other files)

