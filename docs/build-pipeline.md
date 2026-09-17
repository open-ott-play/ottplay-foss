# Classic ES5 build pipeline

`npm run build` runs Vite, TypeScript compilation, the classic linker in
`scripts/classic-bundle.cjs`, and Terser. The result is `dist/stbPlayer.js`.
Vite uses an empty build entry to avoid transforming an unused second module
graph, then stages the web roots and validates the actual shipped scripts as ES5.

`CLASSIC_MODULES` in `scripts/classic-bundle.cjs` is the ordered list of runtime
modules. Every emitted runtime import must resolve to a listed module or an
explicit checked ABI bridge. Missing dependencies fail the build. The linker
uses TypeScript syntax trees and bound symbols to remove module syntax; it
supports multiline named imports and resolves renamed imports without confusing
local variables or object property names.

Imported aliases use small ES5 reader functions, so mutable values stay live
and cannot capture a same-named parameter in the caller. An alias such as
`video as videoElement` continues to read the current `video` after initialization
or replacement. Default and namespace imports are rejected with a diagnostic;
use named imports for this classic output.

The modules still share a global scope because STB adapters and provider scripts
use bare public identifiers. `scripts/classic-optimizer.cjs` compresses local
implementation details while preserving every top-level binding, property name,
function name and function arity. Menu preferences persist `callback.name`; these
names must survive optimization. Top-level and property mangling, unsafe rewrites,
getter purity assumptions, and IE-incompatible `typeof` rewrites remain disabled.
The optimizer parses both input and output as ES5 and rejects missing globals.
Put leaf modules before consumers that use their values during initialization, and avoid
duplicate global declarations when extracting new modules. This linker preserves
the public ABI; it does not make internal modules independent scopes.

`src/app/state.ts` remains an ESM-only state mirror. Its three provider popup
imports (`popupActions`, `popupArray`, `popupDetail`) explicitly resolve to the
classic arrays owned by `src/index.ts`. The linker checks those declarations and
rejects any additional implicit bridge. Listing the state mirror itself would
reinitialize the shared popup arrays and break provider mutations.

`npm run check:bundle` validates public identifiers and executes the emitted
bundle in legacy, modern and Capacitor profiles. `npm run check:es5` checks
JavaScript grammar and staged copies. `npm test` includes linker regressions for
live aliases, lexical shadowing, multiline imports, missing dependencies and the
explicit state bridge. See `docs/es5-compatibility.md` for runtime API constraints
and `docs/mode-a-test-bundle.md` for the standalone device package.

## Shared helpers and native fallbacks

The linker recognizes `__awaiter` and `__generator` against actual output from
its installed TypeScript compiler. It retains the first initialization at its
original position and removes only identical repeated helpers. Unknown helpers
are preserved; conflicting shared bindings fail the build. Dynamic evaluation
prevents this optimization. Independently emitted modules retain their own
helpers, so they remain usable by tests and other consumers.

Native web fallbacks use `nativeWebFallback` instead of `async` methods without
`await`. Its Promise executor runs immediately, converts throws into rejections
and adopts returned thenables. This avoids unnecessary ES5 generator machines
without delaying warnings or changing the native registration/proxy interfaces.

The HTTP player can execute inside Tauri or Capacitor, so native bridges remain
in the shared bundle. Splitting them requires an explicit capability bootstrap,
versioned chunk loading, offline packaging and cross-chunk ABI tests first.
Do not select code solely by URL or development computer identity.

## Build validation and size budgets

Normal builds audit the complete media runtime before reuse. The audit checks
input fingerprints, all asset hashes, licenses, bootstrap URLs, ES5 grammar and
the worker prelude. Missing or stale assets trigger regeneration and another
full audit. `npm run build:media` always rebuilds explicitly. No timestamp or
process-local cache can bypass validation.

Each final classic bundle is limited to 470,000 UTF-8 bytes and 125,000 bytes
compressed with gzip level 9. Both limits apply independently to server, Tauri
and Capacitor artifacts. Native transformations are measured after staging.
`npm run check:size` reads the actual artifacts; it does not trust a prior report.
These budgets cover `stbPlayer.js`, not external media libraries or the complete
application download. Raise a budget only with a reviewed feature/size tradeoff.

`build/reports/classic-bundle.json` records module order, optimizer version/options,
public bindings, source/output hashes and final artifact sizes. CI publishes it
alongside the normal checks. It lives outside the served roots and is deterministic
for identical inputs and toolchain; it records Node/zlib versions and contains no
absolute machine paths, timestamps or performance claims.

Run `npm test`, `npm run check:bundle`, `npm run check:size`, `npm run check:es5`,
`npm run test:devices:browser` and `npm run test:native:ui` when changing this
pipeline. Differential optimizer tests cover late provider mutations, reentrant
callbacks, eval, function identity/arity, getters, side effects and sloppy-mode
behavior. Actual device codec/DRM acceptance remains a separate playback check.
