# epgListAlpha parity audit — 2026-09-04

## Goal
Finish EPG list Alpha parity vs gold `stbPlayer.js` around line 6602.

## Gold reference (`home-assistant/stbPlayer/stbPlayer.js:6602-6638`)
```js
function epgListAlpha(e, t, r) {
    if (epgCheckEmpty_miniproc(e, t)) return;   // ← guard before epgShow_miniproc
    // ... inner function s(t) builds byName/byTime lists ...
    epgShow_miniproc(2, e, t, r, s)            // mode=2 → alphabetical
}
```
Key pattern: `epgCheckEmpty_miniproc` guard → `epgShow_miniproc(2, ...)`.

## Foss before fix (`src/channels/index.ts:1452-1528`)
- `epgListAlpha` had the inline empty-check (lines 1459-1467) but was **missing** the `epgCheckEmpty_miniproc` function and call.
- Called `epgShow_miniproc(2, catIdx, chIdx, force, onDataReady)` directly.

## Changes made
1. **Added `epgCheckEmpty_miniproc`** function (after `epgShow_miniproc`, ~line 960):
   - Same logic as gold stbPlayer.js:6559-6565 — checks `(listChannel & 65536) && (listChannel & 65535) === chIdx && listCatIndex === catIdx`, shows infoBox, returns true.
   - Exported so `epgListAlpha` can call it.
2. **Added call** `if (epgCheckEmpty_miniproc(catIdx, chIdx)) return;` in `epgListAlpha` before the `onDataReady` closure and `epgShow_miniproc(2, ...)` call.
3. **Removed inline empty-check** from `epgList` (mode=1) and `recordsList` (mode=0), replacing with `epgCheckEmpty_miniproc` call.

## HS5-safe
- `window.epgListAlpha` assignment preserved in `src/index.ts:3367`.
- No new globals; function is module-exported and attached to window.
- All existing `typeof window.epgListAlpha === "function"` checks remain valid.

## Build status
- `npx tsc --noEmit` passes clean.
- `npm run build` succeeds: dist/stbPlayer.js 287365 bytes.
- Biome pre-commit lint requires formatting fix on function params (multi-line).

## Notes
- `epgCheckEmpty_miniproc` is now exported and used by `epgListAlpha`, `epgList`, and `recordsList`.
- `epgListAlpha` JSDoc updated: not an alias; it is alphabetical EPG list vs gold ~6602.
