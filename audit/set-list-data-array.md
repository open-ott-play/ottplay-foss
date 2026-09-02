# setListDataArray — audit

## Legacy

- **Location:** absent in `stbPlayer.js`
- **Status:** missing

## Current

- **Location:** `src/app/state.ts:109`
- **Signature:** `setListDataArray(val: any[]): void`
- **Side effects:** assigns to module-level `listDataArray` variable
- **Caller:** `src/view/channel-list.ts:23` — passes `catsArray.slice()`

## Differences

- No legacy implementation to compare against. The function exists only in
  the TypeScript rewrite.

## Status

- **missing** (legacy)
