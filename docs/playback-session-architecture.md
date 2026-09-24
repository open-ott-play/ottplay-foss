# Playback sessions and provider lifetimes

The player now delegates playback history and seek decisions to the Kotlin
shared core. The classic view consumes those decisions through an explicit
compatibility adapter. Normal playback commands own a typed state store; a
versioned journal owns channel history and the resume target. Forty
provider entrypoints use injected driver instances. Remaining providers and
views retain an explicit compatibility boundary.

## Responsibilities

`PlaybackSession.kt` in `ottplay-core/shared-core` defines source/channel
identities, explicit live/archive/VOD modes, departure history, position effects
and seek plans. It does not read DOM elements, storage, device globals or timers.
Archive origins are epoch seconds; media positions are elapsed seconds. A
history kind filter is applied before truncation so VOD cannot consume a slot
in a channel-only journal.

`src/playback/session.ts` owns a state store (typed target, phase, position and
generation) and pending operations. Live/archive/VOD open, pause, resume, stop
and measured-position commands update the store; legacy mode fields are
projected at the host edge. Browser event handlers bind to both the media
request and state generation, and detach when replaced. A pending new source
cannot borrow the previous decoder's position. Native finite-channel discovery
reclassifies the same session without retiring its active event handlers.

The operation controller receives observation,
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

The remaining classic provider adapter scopes AJAX callbacks, jqXHR/deferred callbacks
and function timers created while a provider call executes, including nested
asynchronous work. Catalog fetches have their own reload lifetime. Subsequent
guide, media and stream URL entrypoints retain the provider lifetime.

`src/playback/archive.ts` independently owns archive requests, schedule snapshots,
programme selection and the active media resource's bounds. Its ports receive
decoded source/channel context and implement guide requests, authorization,
URL resolution, device effects and rendering. The common core selects programmes
using half-open intervals and latest-start precedence for overlaps. A file is
reused only when its source, channel, programme identity and time bounds match;
changing a UI row index cannot reopen it or seek into a different resource.

`classic-archive.ts` is the compatibility edge. The renderer consumes a selected
programme and timeline model; it no longer chooses transport or starts guide
requests. Missing/last-programme refresh has its own request lifetime and retry
interval, independent of whether the visible row changed. Source replacement,
Stop and a newer intent retire pending guide and URL callbacks. Authorization
and archive retention are checked again before delayed playback effects.

EPG selection also binds the exact chosen row, destination and playback context
before requesting a PIN. Manual seek dialogs bind their callback, accumulated
delta and timer revision to the session that opened them. A queued old callback
cannot seek a new channel or hide a replacement dialog.

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

## Driver instances and release boundary

`src/provider/drivers.ts` implements factories supplied with storage, transport,
clock, hashing, shared-core and lifetime ports. The declarative inventory in
`driver-profiles.ts` covers Demo, standalone Xtream and 33 API/M3U operator
profiles, including the nested `d/maxtv` entrypoint. Each source owns its requests,
configuration and catalog. Catalog snapshots are detached from driver state;
failed reloads cannot republish streams from the previous account.

Generic profiles retain their established storage prefixes, four credential
fields, API/M3U fallback and empty-EPG capability. Standalone Xtream preserves
its catalog, live/archive URL and short-guide operations; it did not expose a
media catalog before migration. The view codec publishes the narrow callbacks
that the current renderer still consumes. Managed loading never evaluates
`prov.js` or temporarily patches global AJAX/timer functions.

Five additional profiles use explicit session drivers: `1ott`, `only4`,
`shara-tv`, `tvteam` and `bestlist/stalker`. They retain their distinct credential
editors, playlist/authentication chains, guide and archive behavior, and Only4
mode switching. Despite its name, `bestlist/stalker` uses an Xtream/M3U fallback
contract; it is separate from the remaining MAC-based Stalker integration.

`provider-assets.cjs` derives the same 40 IDs from the declarative inventory.
Vite and Play packaging omit their old executable scripts from browser, Tauri
and Capacitor roots. UI metadata and logos remain. The original files stay in
source control as provenance and compatibility test oracles; they are not
runtime fallbacks for managed drivers. The eight remaining entrypoints keep their
explicit legacy path until equivalent drivers are implemented.

## Version-2 playback journal

`src/playback/journal.ts` owns the `playbackJournal` provider key. One envelope
stores schema version, source identity, typed bookmark, channel history and
bookmark timestamp. Entries use channel and group identities, not category
indices or numeric playback sentinels. M3U storage scopes this key to the active
playlist slot; the compatibility source identity also includes the slot.

The importer reads version-1 `prevArr` and live/archive `continueWatch` without
changing their original bytes. Canonical data takes precedence after the first
successful envelope write. Unknown versions, corrupt envelopes and mismatched
sources are read-only, with an empty safe view instead of reviving stale mirrors.
Writes verify the resulting value. Channel hash migration updates eligible
version-2 channel references but never VOD identities or unsupported envelopes.

New semantic checkpoints record the mode actually entered, fixing the old
mixed outgoing-mode/incoming-channel bookmark. That ambiguity in existing
version-1 data cannot be reconstructed reliably. Existing media-library history
is still an opaque legacy contract because provider-specific replay metadata
must be retained. Old channel keys remain rollback mirrors while compatibility
consumers exist.

Playing-position writes are limited to one per five seconds; target/phase
changes checkpoint immediately. Clearing or restoring storage suspends both
canonical and compatibility saves until the next source hydration, preventing
unload/stop callbacks from recreating erased history. Hiding a page saves the
active archive/VOD target without relabeling it as live.

License notices and repository history are retained.

## Verification

`npm test` includes real shipped-core playback, history and provider regressions.
The provider suite also runs actual Xtream provider code with an unabortable
late response. A canceled transport is therefore not assumed to be sufficient
protection. New tests live in `test_playback_session.cjs`,
`test_history_selection.cjs`, `test_playback_state.cjs`,
`test_playback_journal.cjs`, `test_provider_runtime.cjs` and
`test_provider_drivers.cjs`. Archive request/entrypoint tests and
`test_named_provider_drivers.cjs` cover the next migration stage. Driver transport
contracts are also checked against
the captured generic operator cases; `test_provider_assets.cjs --bundle` audits
the absence of retired scripts in all built roots.

Run `npm run typecheck`, `npm run lint`, `npm run build` and
`npm run check:bundle`. Full-bundle smoke loads only the vendored core before
executing the built artifact, verifies private module publication and exercises
history and delayed seeks on modern and legacy JavaScript profiles. This checks
wiring and behavior with simulated host ports; it does not verify decoding on a
physical TV. The build also validates ES5 grammar and native staging receipts.

`npm run test:devices:browser` includes a full-player Chromium test that decodes
frames from the checked-in HLS fixture and exercises the actual pause, seek,
resume and stop APIs plus the canonical journal. Its unload event is dispatched
synthetically; it does not establish real shutdown/restart or device-decoder
behavior. All external media/provider requests are intercepted or blocked.

The session-only iteration increased the classic bundle from 475,644 to 484,540
bytes (gzip: 130,016 to 132,972). Adding owned playback state, the journal and
35 drivers brought it to 514,070 bytes (140,915 gzip). The archive coordinator
and five further drivers bring the bundle to 530,635 bytes / 145,879 gzip bytes; the
explicit budget is 535,000 bytes / 148,000 gzip bytes. Packaging removes 252,549 raw bytes of
retired provider scripts from each Full asset root. That asset total is not a
claim about transfer savings: the previous loader fetched provider scripts on
demand. The separately loaded shared-core JavaScript remains at 1,239,827 bytes
after the first iteration. Domain APIs and the temporary compatibility layer
both contribute to the bundle cost.

Core validation is `./gradlew jvmTest jsNodeTest`, followed by distribution and
JavaScript-profile checks documented in the shared-core README. Install the
result through `scripts/distribute.cjs`; do not manually edit vendor artifacts.

## Remaining migration

The new boundaries do not make the entire application independent of its
classic contracts. Remaining work is to replace the eight specialized provider
scripts, migrate opaque media history and the rest of settings, and give all
views/device adapters a command-and-snapshot API. The current renderer still
uses classic linking and published globals. Explicit reconciliation accepts
external writes from retained scripts; removing that input path requires their
conversion, not just changing field names.

The remaining provider entrypoints are `antifriz`, `edem`, `itv`, `kb-team`,
`m3u`, `ottclub`, `shura` and `stalker`. Their remaining contracts include MAC and
playlist-slot identity, progressive metadata, provider-specific media catalogs,
and asynchronous media navigation. They are explicitly retained rather than
silently dropping those capabilities.

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
