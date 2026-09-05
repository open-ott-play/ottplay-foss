# Build Pipeline — Phase 5.3.5

## Current pipeline

`npm run build` → Vite (`vite.config.ts`) → `tsc` → strip ES module syntax → concat (`MODULES` order) → terser → `dist/stbPlayer.js`.

Vite handles orchestration; Rollup bundler is **not** used. The concat + strip + terser steps live inline in `vite.config.ts` (`generateBundle` hook), invoked via the `enforce: "post"` plugin.

## Why concat + strip

HS5 / MAG devices load `dist/stbPlayer.js` as a classic (non-module) `<script>`. Their `prov.js` plugins are also classic scripts using **bare** identifiers (`popupActions.splice`, `listKeyHandler = …`, `chanels`). The `stripModule()` function removes `import`/`export` statements so the concat produces one valid classic-script bundle.

**No dual ESM/classic emit.** There is only one build artifact: `dist/stbPlayer.js`. The `vite.config.ts` `stripModule()` step does not produce a separate ESM output — it transforms the TypeScript-compiled JS to classic form before concatenation. Classic `stbPlayer.js` is the sole runtime artifact.

`terser` minifies with `mangle: false` — `function.name` introspection is still used at runtime by some prov.js stubs and the info-panel key path.

## Bundle size

~268 KB minified. ~339 window globals published by `src/index.ts`.

## MODULES load-order checklist

The `MODULES` array in `vite.config.ts` defines concatenation order. All files are built by `tsc` first, then concatenated in array order. New files added to the bundle must be placed **before** any file that consumes them — never after `build/index.js` if index redeclares the same `function` name (that causes a `var` overwrite at best, a SyntaxError at worst for `const`/`let`).

| # | Member | Must load before |
|---|--------|-----------------|
| 1 | `build/polyfills/index.js` | everything (polyfills) |
| 2 | `build/utils/lzstring.js` | anything using `lzstring` |
| 3 | `build/storage/index.js` | anything using `ottpStorage` |
| 4 | `build/localization/index.js` | anything using localized strings |
| 5 | `build/settings/index.js` | anything using `settings.*` |
| 6 | `build/utils/helpers.js` | most of the app (utility helpers) |
| 7 | `build/utils/encoding.js` | anything encoding base64 |
| 8 | `build/channels/types.js` | channels/index.js |
| 9 | `build/channels/index.js` | core, ui, keyhandler |
| 10 | `build/debug/playback-debug.js` | core (debug wiring) |
| 11 | `build/core/index.js` | ui, keyhandler, commands |
| 12 | `build/ui/index.js` | keyhandler, provider |
| 13 | `build/keyhandler/index.js` | provider |
| 14 | `build/provider/index.js` | commands, app/init |
| 15 | `build/commands/index.js` | app/init, app/device |
| 16 | `build/app/init.js` | app/device |
| 17 | `build/app/device.js` | — |
| 18 | `build/index.js` | last (assembler; imports all) |

Adding a new leaf module: put it before `build/index.js` at the correct depth. Do not add a module to MODULES that redeclares a `const`/`let` already in `build/index.js`.

## Bundle identifier check

After `vite build`, `scripts/check-bundle-identifiers.sh` verifies the classic bundle still contains the six HS5/plugin identifiers required by prov.js and the boot entry:

```
startPlayer  popupActions  noProvParam  optionsList  listKeyHandler  chanels
```

These are the bare identifiers that classic prov.js scripts reference. If this check fails on main, fix the build — not the check.

## Build scripts (package.json)

| Script | Entrypoint | Notes |
|--------|-----------|-------|
| `build` | `vite.config.ts` | Only build script — `vite build` |
