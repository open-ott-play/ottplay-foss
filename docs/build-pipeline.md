# Build Pipeline — Phase 5.3.5

## Current pipeline

`npm run build` → Vite (`vite.config.ts`) → `tsc` → strip ES module syntax → concat → terser → `dist/stbPlayer.js`.

Vite handles orchestration; Rollup bundler is **not** used. Both builds are identical.

## Legacy fallback

`npm run build:legacy` → `node build-concat.cjs` → same `tsc → strip → concat → terser` steps.

Kept for emergency — same output, different entry point.

## Bundle size

~268 KB minified (identical between both builds). ~130 window globals written.

## Migration path

Drop `build:legacy` when `build` proves stable across all device targets.

## Build scripts (package.json)

| Script | Entrypoint | Notes |
|--------|-----------|-------|
| `build` | `vite.config.ts` | Primary — `vite build` triggers `build:build` hook |
| `build:legacy` | `build-concat.cjs` | Fallback — identical output |
| `build:vite` | `vite.config.ts` | Alias for `build` |
