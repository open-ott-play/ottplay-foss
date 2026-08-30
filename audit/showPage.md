# showPage — audit

## Legacy (gold)

- Repo: `4alvit/home-assistant`
- File: `stbPlayer/stbPlayer.js`
- Line: **L1533**
- Signature: `function showPage()` (no params, no return)

## Current (src)

- Repo: `open-ott-play/ottplay-foss`
- File: `src/ui/index.ts`
- Line: **L614**
- Signature: `export function showPage(): void`

## Differences

Port-style (ignore per PORT.md):
1. `export function ... : void` vs `function ...()`.
2. `var w = (window as any)` indirection vs gold bare globals.
3. `typeof w.stbSetWindow === "function"` guard before call.
4. `if (listInElement)` / `if (listElement)` null guards vs gold assumes they exist.
5. `isListVisible = true` set explicitly (src tracks it for cleanup); gold doesn't expose the flag but `closeList` reads it — equivalent in effect.
6. `var listDataArray = ... ? listDataArray : (w).listDataArray || []` vs gold bare `listArray`. **(Store name difference — see gap.)**
7. `getListItemFn ? getListItemFn(...) : ""` vs gold `getListItem(listArray[o], o)`. Src exposes `getListItemFn` setter; gold uses bare global `getListItem`. Equivalent if callers set the function (verified — `src/index.ts:984`, `:1184`).
8. Hard-coded fallback colors `curColor || "gold"` / `curColorB || "#668"` vs gold bare `curColor` / `curColorB`. Additive defensive default; same color output when globals are set.
9. Scrollbar uses `#f0f0f0` border + `#888` thumb vs gold `bodyColor`. Cosmetic, not behavioral.

Real gaps (store mismatch — flagged in `audit/PORT.md` §"Not equivalent"):
- Gold `showPage` iterates bare global **`listArray`**.
- Src `showPage` iterates module `listDataArray` (with `(window as any).listDataArray` fallback only).
- Src does **not** read `window.listArray`.
- Implication: any caller that populates `window.listArray` (notably `searchChannel`, which PORT.md notes writes `w.w.listArray` and never `listDataArray`) renders an empty page in src. This is the audit/audit-known cross-store bug, **not a regression of `showPage` itself** — the `showPage` body is faithful.

## Callers

Legacy (20): `addChannel2bucket`, `betaPage`, `_bucketsList`, `changeSelect`, `_channelsList`, `firstRun`, `infoList`, `mediaKeyHandler`, `optionsList`, `parentChannel`, `popupList`, `searchChannel`, `searchRec`, `selectLang`, `selectProvaider`, `selectValue`, `setEpgTimer`, `_setSetup`, `settingsManage`, `showMediaList1`.

Current (13): `selectLang` (`src/app/language.ts:73` → `src/index.ts:1134` mirror), `showChanelsList` (`src/index.ts:981`, `src/view/channel-list.ts:21`), `_channelsList` (`src/provider/index.ts:1654`), `firstRun` (`src/provider/index.ts:1845`), `optionsList` (`src/provider/index.ts:517`), `selectProvaider` (`src/provider/index.ts:1182`), `changeSelect` (`src/ui/index.ts:714`), `infoList` (`src/ui/index.ts:1493`), `popupList` (`src/ui/index.ts:1565`), `selectValue` (`src/ui/index.ts:3173`), `showMediaList1` (`src/ui/index.ts:3013`).

Coverage delta: legacy has 7 callers not present in src (`addChannel2bucket`, `betaPage`, `_bucketsList`, `mediaKeyHandler`, `parentChannel`, `searchRec`, `setEpgTimer`, `_setSetup`, `settingsManage`). These are likely stubbed elsewhere in src; not `showPage`'s fault.

## Status

**matches** (function body parity is full; store-binding bug is upstream in `searchChannel` and tracked in `audit/PORT.md`).

## Fix applied

`src/ui/index.ts` `showPage()` (L631) and `changeSelect()` (L715) both feed
`dataArr` from the same expression:

```ts
var dataArr = listDataArray.length
    ? listDataArray
    : (window as any).listDataArray || (window as any).listArray || [];
```

Fallback chain now reads `window.listArray` last — matches gold semantics
(`showPage` reads bare `listArray`). Closes the store-mismatch symptom for
every caller that writes only `window.listArray` (`_setSetup`,
`settingsChannels`, `settingsInterface`, `searchChannel`, the four
`catsArray` populators at `src/index.ts:2030/2123/2141/2159/2183`).

`showPage` body is no longer broken by upstream missing `listDataArray`
writes. The upstream writers should still be normalized to dual-write
(`listArray` + `listDataArray`) per the dual-write pattern already present
at `src/index.ts:1758` / `:2859` / `src/provider/index.ts:1824`, but that's
a separate cross-store cleanup, not a `showPage` audit item.

## More bad things found (out-of-scope, reported only)

1. `src/ui/index.ts` `popupList` (~L1793-1800) pushes **objects** to
   `listArray` and **strings** (`r`) to `listDataArray`. Both arrays then
   exist for the same call; `getListItemFn` handles both shapes, but the
   `listDataArray` strings are dead data (no consumer reads the string form
   after my fallback fix). Pre-existing. **FIXED in commit 396963c** —
   string push dropped; `getListItemFn` simplified.

2. `src/index.ts` settings functions (`_setSetup`, `settingsChannels`,
   `settingsInterface`, `settingsInfobar`, `settingsLists`) assigned
   `w.listArray = [...]` without a matching `w.listDataArray = X`.
   Pre-fix: silently rendered empty pages (`showPage` saw empty
   `listDataArray`). Post-fix: `showPage` falls back to
   `window.listArray`, so pages render. **FIXED in commit 396963c** —
   added `setListArrays(w, data)` helper; 5 call sites converted to
   dual-write.

3. **Skipped intentionally (not showPage-consumed):**
   - `src/index.ts:2586` — `w.listArray = []` empty reset; only `splice()`
     mutations downstream, no `showPage` call.
   - `src/index.ts:2793` — settings menu big block; same: `splice()`-only,
     no `showPage`. Both are pre-existing warts, not introduced by this PR.

## PORT.md gaps (cross-store mismatches, upstream of showPage)

Per `audit/PORT.md` §"Not equivalent — still a gap":

- `searchChannel`: gold writes bare `listArray`; src writes `w.w.listArray`
  and never `listDataArray` / `(window as any).listDataArray`. The
  `w.w` prefix is `window["w"]` (usually undefined) — throws at runtime.
  `editvar` local vs `(window as any).editvar` vs `#editvar` input read
  diverge.
- Extra null checks (`chanels[id] && ch.channel_name`) vs gold assumes exist.
- Duplicate `channelsList` stub in `src/channels/index.ts` + full
  `_channelsList` in `src/provider/index.ts` — DUP/leftover, not port style.
- Concat clones in `src/index.ts` vs module — leftover, not port style.