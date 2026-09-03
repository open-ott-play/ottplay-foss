# Build Pipeline — Phase 5.3.5

## Current pipeline

`npm run build` → Vite (`vite.config.ts`) → `tsc` → strip ES module syntax → concat (`MODULES` order) → terser → `dist/stbPlayer.js`.

Vite handles orchestration; Rollup bundler is **not** used. The concat + strip + terser steps live inline in `vite.config.ts` (`generateBundle` hook), invoked via the `enforce: "post"` plugin.

## Bundle size

~268 KB minified. ~130 window globals written by `src/index.ts`.

## Build scripts (package.json)

| Script | Entrypoint | Notes |
|--------|-----------|-------|
| `build` | `vite.config.ts` | Only build script — `vite build` |
