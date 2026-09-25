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

Classic adapter/provider modules share a global scope because separately loaded
scripts use bare public identifiers. `scripts/classic-optimizer.cjs` compresses local
implementation details while preserving every top-level binding, property name,
function name and function arity. Menu preferences persist `callback.name`; these
names must survive optimization. Top-level and property mangling, unsafe rewrites,
getter purity assumptions, and IE-incompatible `typeof` rewrites remain disabled.
The compressor uses three passes. On the measured player, further passes produced
identical bytes; declaration hoisting increased gzip size. Indexed-argument
rewrites and Boolean-to-integer conversion are explicitly disabled because they
change omitted/mapped arguments and native bridge Boolean contracts.
The optimizer parses both input and output as ES5 and rejects missing globals.
Put leaf modules before consumers that use their values during initialization, and avoid
duplicate global declarations when extracting new modules.

`CLASSIC_PRIVATE_MODULES` declares audited implementation boundaries. The debug
controller publishes `window.__ottDebug`; its functions, queue and timer state
run in a private immediate scope at the original module position. The scope
retains the script's receiver and does not introduce strict mode or deferred
initialization. Compiler helpers inside private modules are not shared across
the boundary. Named imports/exports, bare private references and direct named
`window`/global-object property reads fail the build. Aliases, `this` receivers,
computed property names and external device/provider scripts still require a
reachability audit; the linker cannot prove their intent.

The HTML bootstrap owns startup: runtime support, media libraries, player bundle,
selected adapter, then `startPlayer()`. Device detection always returns a
nonempty route. The old empty-device auto-start branch never ran in shipped
profiles and has been removed; there is no competing DOM-ready startup path.

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

Native adapters share Promise-to-jQuery settlement and playback metadata
collection. Platform wrappers retain their own request arguments, lifecycle,
timers and session ownership. The shared Deferred bridge subscribes directly to
the existing thenable and retains callback receivers, completion-before-settlement,
error conversion and return-object identity on legacy and current jQuery.

## Reachability and future module boundaries

Classify entry points before removing code: HTML startup, bare provider/device
globals, `window` publications, saved callback names, native/plugin APIs and
registered event callbacks are roots. A missing TypeScript import does not
establish dead code. All 24 device adapters remain reachable through explicit
`/f/<adapter>` routes; native bridges remain reachable from HTTP-hosted shells.

The removed `_hasLocalizedAlphabet`, `loadProvCallback`, `time2dateStr`,
`positionToText` and its only dependency `secondsToText` had no runtime callers,
publications, documented API or original-player global contract. Preserve
historical globals such as `handleTouchEnd` and the documented `DashExoPlayer`
API even when current automatic playback does not call them.

For further extraction, define the public interface and immediate initialization
effects first, then isolate internal state and test through that interface.
Prefer shared operations behind capability-specific adapters over copied platform
implementations. Lazy loading needs versioned chunk paths, offline/native staging,
failure recovery and ordering tests before it can replace the current bootstrap.
An automatic tree-shaker over all legacy globals would discard supported hooks.

## Build validation and size budgets

Normal builds audit the complete media runtime before reuse. The audit checks
input fingerprints, all asset hashes, licenses, bootstrap URLs, ES5 grammar and
the worker prelude. Missing or stale assets trigger regeneration and another
full audit. `npm run build:media` always rebuilds explicitly. No timestamp or
process-local cache can bypass validation.

The HLS worker contains a synchronous, versioned sibling-runtime import and an
exact readiness/version guard followed by unchanged upstream worker bytes.
The auditor reconstructs that complete sequence; changing an asset and its
manifest hash together cannot authorize another import or a removed guard.
The loader recipe lives in the already-fingerprinted builder. Both runtime and
worker remain staged together, with their licenses, in every web/native root.

Each final classic bundle is limited to 654,000 UTF-8 bytes and 187,200 bytes
compressed with gzip level 9. Both limits apply independently to server, Tauri
and Capacitor artifacts. Native transformations are measured after staging.
`npm run check:size` reads the actual artifacts; it does not trust a prior report.
These budgets cover `stbPlayer.js`, not external media libraries or the complete
application download. Raise a budget only with a reviewed feature/size tradeoff.

### Historical feature measurements

The following measurements record earlier integration steps, not current build
ceilings. The active limits are the 654,000 raw / 186,750 gzip bytes stated above
and enforced by `scripts/classic-size.cjs`.

The command-server connection and compatibility boundary measured 466,901 raw
bytes / 126,699 gzip bytes against the prior 445,756 / 120,643 baseline with the
same optimizer and version substitution: +6,056 gzip bytes (5.02%). This includes
the outbound transport, retry/acknowledgement state, settings UI, command fixes,
and live provider aliases. Direct unshadowed global reads save 167 gzip bytes
without changing compression options or shadowed-binding behavior. The raw
ceiling was unchanged at that step; its gzip allowance covered the measured growth.

The shared-domain integration measured 473,261 raw / 129,329 gzip bytes after
version substitution. Rebuilding baseline `b3c8cc0` with the same Terser 5.51.2
options and version produces 466,922 raw / 126,848 gzip bytes: +6,339 raw bytes
(1.36%) and +2,481 gzip bytes (1.96%). The integration adds the common operator
transport adapter and generated wire validators to the classic bundle while
removing more than 5,000 duplicated lines from separately loaded provider scripts.
Its historical ceilings were 475,000 raw / 130,000 gzip bytes. Current checks still
measure all three staged artifacts independently. The separate shared-core script
is pinned and checked by its artifact receipt and ES5 runtime checks, and is not
included in these bundle measurements.

### Reproducing a comparison

Rebuild the base and candidate with the same Node/zlib version, lockfile,
optimizer settings and application version. Compare raw bytes and gzip level 9
for each final server, Tauri and Capacitor bundle. Measure Play separately after
its distribution filter and native staging; a pre-staging result is not the
shipped artifact.

Record the other delivered JavaScript paths and content hashes as well. Moving
code to a shared-core, vendor or separately loaded file does not reduce the total
delivery merely because `stbPlayer.js` becomes smaller. Duplicate nested paths
in a staging tree are packaging contracts, not evidence that a page downloads
the same script twice. Keep startup-transfer claims separate from per-file and
package-size comparisons.

`build/reports/classic-bundle.json` records module order, optimizer version/options,
public bindings, private-module interfaces, source/output hashes and final artifact sizes. CI publishes it
alongside the normal checks. It lives outside the served roots and is deterministic
for identical inputs and toolchain; it records Node/zlib versions and contains no
absolute machine paths, timestamps or performance claims.

Run `npm test`, `npm run check:bundle`, `npm run check:size`, `npm run check:es5`,
`npm run test:devices:browser` and `npm run test:native:ui` when changing this
pipeline. Differential optimizer tests cover late provider mutations, reentrant
callbacks, eval, function identity/arity, getters, side effects and sloppy-mode
behavior. Actual device codec/DRM acceptance remains a separate playback check.

## Comparing minifier options

`npm run measure:classic` compiles fresh ES5 modules and compares bounded Terser
profiles against an explicit one-pass baseline. It writes candidate scripts to
`build/experiments/classic-options` and measurements to
`build/reports/minify-options.json`, without changing shipped bundles. Use
`npm run measure:classic -- --rounds 2` to check reproducible output across two
runs. Timings are local samples, not stable build-speed measurements. Brotli
quality 11 is a comparison metric, not the native packager's compression profile.

Diagnostic profiles deliberately include options rejected by runtime contracts.
ES5 parsing and preserved global declarations alone do not make them safe. The
optimizer tests compare original and optimized behavior, including the real HTTP
remote bridge, and prove the assertions reject changed getter, argument and
Boolean behavior. Keep these tests and the emitted-bundle/browser checks passing
before adopting a different profile.
