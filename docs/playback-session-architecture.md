# Playback sessions and provider lifetimes

The player now delegates playback history and seek decisions to the Kotlin
shared core. The classic view consumes those decisions through an explicit
compatibility adapter. This is an incremental architecture migration: provider
scripts, view state and persisted version-1 records still use their existing
contracts.

## Responsibilities

`PlaybackSession.kt` in `ottplay-core/shared-core` defines source/channel
identities, explicit live/archive/VOD modes, departure history, position effects
and seek plans. It does not read DOM elements, storage, device globals or timers.
Archive origins are epoch seconds; media positions are elapsed seconds. A
history kind filter is applied before truncation so VOD cannot consume a slot
in a channel-only journal.

`src/playback/session.ts` owns pending operations. It receives observation,
clock/timer and effect ports, and uses opaque core ownership tickets. A later
selection or stop invalidates earlier callbacks even if the selected ID is
reused. Offset seeks accumulate for 500 ms and are planned from the current
position when applied. Guards can start without a current channel, enabling
history restoration after a catalog removes the previous selection.

`src/playback/classic-adapter.ts` translates the classic host into that model.
This is the only new playback module that interprets numeric mode sentinels,
positional history records or storage keys. The host context check also binds
catalog/channel/list objects and storage accessors: replacing a source with the
same identifiers must not revive old effects. Native finite channel media and
medHistory VOD are different legacy cases and retain their different histories.

`src/provider/runtime.ts` owns provider and catalog generations independently.
Replacing a generation retires it before cleanup, so synchronous abort callbacks
cannot write into the replacement. Resources are disposed in reverse order;
cleanup failures do not prevent other resources from being released. Reentrant
source selections retain the latest requested selection.

The classic provider adapter scopes AJAX callbacks, jqXHR/deferred callbacks
and function timers created while a provider call executes, including nested
asynchronous work. Catalog fetches have their own reload lifetime. Subsequent
guide, media and stream URL entrypoints retain the provider lifetime.

## Integration and deliberate behavior changes

`setCurrent` and `shiftArchive` delegate to the new boundary. Stop, source and
catalog changes invalidate pending playback work. Timeshift, live pause, archive
history selection and delayed resume seek use guarded callbacks. History binds
the selected channel before PIN/EPG completion and resolves its current category
position. Archive access is rechecked if it expires while EPG is loading.

The following corrections are intentional:

- Live destination history is deduplicated consistently when an optional archive
  argument is omitted.
- Empty channel history is persisted instead of retaining an old stored journal.
- Malformed stored rows do not enter the typed model; missing categories cannot
  crash history selection.
- A stopped or superseded operation cannot seek, pause or start an old stream.
- Replacing the catalog or channel while reusing its ID invalidates callbacks.

Version-1 bookmarks and extra history fields remain readable. The existing
bookmark convention associates the selected channel with the outgoing playback
mode; changing that convention requires a separately versioned persistence
migration. License notices and repository history are retained.

## Verification

`npm test` includes real shipped-core playback, history and provider regressions.
The provider suite also runs actual Xtream provider code with an unabortable
late response. A canceled transport is therefore not assumed to be sufficient
protection. New tests live in `test_playback_session.cjs`,
`test_history_selection.cjs` and `test_provider_runtime.cjs`.

Run `npm run typecheck`, `npm run lint`, `npm run build` and
`npm run check:bundle`. Full-bundle smoke loads only the vendored core before
executing the built artifact, verifies private module publication and exercises
history and delayed seeks on modern and legacy JavaScript profiles. This checks
wiring and behavior with simulated host ports; it does not verify decoding on a
physical TV. The build also validates ES5 grammar and native staging receipts.

The first integrated build increases the classic bundle from 475,644 to 484,540
bytes (gzip: 130,016 to 132,972). The explicit budget is now 490,000 bytes / 134,000
gzip bytes. The separately loaded shared-core JavaScript grows from 1,201,145 to
1,239,827 bytes. Both domain APIs and the temporary compatibility layer contribute
to this cost; extracting modules alone does not reduce download size.

Core validation is `./gradlew jvmTest jsNodeTest`, followed by distribution and
JavaScript-profile checks documented in the shared-core README. Install the
result through `scripts/distribute.cjs`; do not manually edit vendor artifacts.

## Remaining migration

The new boundaries do not make the entire application independent of its
classic contracts. Remaining work is to replace global provider scripts with
explicit driver objects, move playback source-of-truth out of view globals,
introduce versioned durable state, and give views/key handling a command API.

The transitional provider scope does not intercept arbitrary raw UI closures,
native Promise continuations, cached transport functions or global writes made
by an external script while it evaluates. Script loading is serialized so the
next reset occurs after the previous script finishes. If the loader never calls
either completion callback, replacement waits; allowing the next script to
run on a timeout alone would let late evaluation overwrite the active driver.
Removing this limitation requires drivers that publish an isolated instance
instead of mutating globals.

Structural independence must be assessed against these remaining dependencies,
not identifier changes or a target percentage of textual similarity. This work
does not erase or disprove historical source relationships.
