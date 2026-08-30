gold: stbPlayer/stbPlayer.js:2307
src: src/channels/index.ts:2188
verdict: lost-var

Kimi (fcc-fn-searchChannel-010701) wrote `match`. That is wrong — it treated the store mismatch as PORT.md noise.

Real gap:
- Gold `searchChannel` assigns the filtered ids to bare global `listArray`. Gold `showPage` iterates `listArray`.
- Src `searchChannel` writes `w.w.listArray` (src/channels/index.ts:2209) and never `listDataArray` / `setListDataArray`.
- Src `showPage` (src/ui/index.ts:558) reads module `listDataArray` (fallback `window.listDataArray` only). It does not read `window.listArray`.
- Filter is computed then thrown away. Search OK still shows the full category list.
- #60 (521cd95) fixed #editvar input, caption, `$("#listEdit").hide()`. It did not wire the filtered array into `listDataArray`.

Not a gap (PORT.md): `var w = window as any`, typeof guards, extra null checks, `showEditKey()` is present behind typeof at 2396, TS export.

Fix: after computing the filtered ids, also `setListDataArray(filtered)` (src/app/state.ts) so `showPage` sees them. Keep `w.w.listArray` if listKeyHandler still uses it, or point that handler at the same store.

Fix: searchChannel now also writes `w.w.listDataArray` (src/channels/index.ts) so showPage sees the filtered ids; `listArray` kept for listKeyHandler. PR: https://github.com/open-ott-play/ottplay-foss/pull/61
