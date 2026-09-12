# Classic ES5 build pipeline

`npm run build` runs Vite, TypeScript compilation, the classic linker in
`scripts/classic-bundle.cjs`, and Terser. The result is `dist/stbPlayer.js`.
Vite then stages the web roots and validates the actual shipped scripts as ES5.

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
use bare public identifiers. Keep Terser `ecma: 5` and `mangle: false`. Put leaf
modules before consumers that use their values during initialization, and avoid
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
