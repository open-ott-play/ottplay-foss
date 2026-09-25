# Runtime ownership migration

For the current module map, lifetime contracts, extension recipes and test gates,
start with [Player architecture](architecture.md). This page records migration
decisions and measurements; older iteration sizes are historical baselines.

The player now separates screen, settings, channel, media, guide and decoder state
from the classic renderer. This is a replacement of active state owners and
command paths; historical attribution and retained test oracles are unchanged.

- `ScreenController`, `InputRouter`, `MenuRegistry` and `ClassicScreenPort` own
  screen lifetimes, focus, semantic input and callback cancellation. Provider
  menus enter through the compatibility port. A quality picker temporarily
  suspends its media parent and retires with that parent.
- `AccessSession` owns source- and policy-bound parental grants, deadlines and
  cancellable PIN requests. Per-field settings epochs reject PIN/protection
  changes even when the old value is restored; stale timers cannot revoke a
  renewed grant. The classic keypad and device/provider hooks remain adapters.
- `SettingsStore` owns settings, validation and editor drafts. Compatibility
  properties remain projections for device scripts and menus.
- Cloud settings transfers own their screen, requests and timers. A strict
  raw-storage codec and guarded replacement batch replace clear-first restore;
  see [cloud-settings.md](cloud-settings.md).
- `ChannelLibrary` owns stable channel IDs, groups, ordering and preferences.
  Operator API catalogs use provider identities. The core publishes explicit
  migration metadata separately from current catalog identities.
- `MediaLibrary` and `MediaJournal` own navigation frames and source-scoped media
  history. Stream URLs are resolved afresh; expired URLs are not media IDs.
- `GuideService`, `GuideScreen` and `ReminderService` own request cancellation,
  schedules, screen selection and durable reminders. Shared `GuideTimeline`
  defines half-open programme intervals and deterministic overlap handling.
- `DeviceAdapter` and `MediaBackend` own decoder leases, position observations,
  native events, tracks and PiP. OS media state subscribes through an explicit
  port. Snapshot reads are pure; retained devices use explicit legacy ingress.

Playback source validity is independent of category/list projections. Reordering
or republishing groups does not kill the playing decoder. A change of account,
channel or media identity rejects captured decoder callbacks even before another
playback command increments the generation. Transient UI callbacks additionally
check their originating list context.

## Saved-data migration

Favorites use a version-2 source-scoped envelope of stable channel references;
numeric arrays remain renderer projections. The earlier version-1 envelope is
canonical. Raw legacy arrays are imported using explicit old aliases, including
transitive encoding aliases. Missing references survive list edits and reloads.
Conflicting IDs, ambiguous aliases and cycles remain unresolved, rather than
selecting an unrelated channel. The raw legacy bytes remain available for rollback.

The same conservative policy applies to old playback history and bookmarks,
including unmarked source-scoped version-2 journals. Imported references retain
their origin. New journal writes carry `channelReferences: 1` inside the atomic
write/readback transaction, so current canonical IDs are never reinterpreted as
old hashes. Known ambiguity remains unresolved even if one colliding channel
later disappears. Unique absent references can resolve when their channel returns.

Source claims, storage readback and generation guards prevent an account switch,
reentrant callback or rejected write from publishing another source's data.
Unknown and malformed envelopes remain read-only.

Portable settings JSON v2 exports full stable library documents instead of
reading frozen legacy arrays. V1 restore conservatively translates raw channel
references into canonical libraries. Settings and library writes share readback
and guarded rollback of only attempted keys; source replacement also retires
post-commit callbacks. See [settings-store.md](settings-store.md).

## Compatibility and verification

TypeScript still targets ES5. The classic optimizer retains its ES5/IE8/WebKit
settings and protections for global names, function names/arity and property
names. The existing public device ABI, polyfills and Full/Play policy separation
remain enforced. No optimizer protection was relaxed to reduce artifact size.

Verification covers source specifications and actual optimized artifacts, legacy
and modern VM profiles, Capacitor native/fallback profiles, emitted ES5 grammar,
browser device/navigation scenarios, native CSP scenarios, and matching shared
core JS/JVM receipts. These checks do not substitute for physical retained-TV/STB
validation. Hardware-specific decoder and firmware behavior still requires a
physical-device beta pass before making a device compatibility guarantee.

## Artifact size budget

The cloud transfer rewrite adds about 3.5 KB raw / 1.5 KB gzip for strict,
lossless raw-string decoding, cancellation and verified storage replacement.
The size limits change from 650,000 to 654,000 raw bytes and from 184,500 to
186,000 gzip bytes. This is an explicit allowance for new behavior, not a
compressor-only change. The subsequent search/XML follow-up preserves the
654,000 raw-byte limit and adds 750 gzip bytes (186,750 total) for source/catalog
and editor ownership checks. XML decoding and dead-code removal reduce their
own footprint, while the complete bundle grows slightly to cover the new search
checks; this is not a claim that all delivered artifacts become smaller.
Node 22 is used for the measurements and CI.

Size checking still covers server and staged native artifacts and rejects
missing, stale or oversized outputs. Play is measured and checked separately.
The ES5 optimizer options, public names, function arity and property protections
are unchanged. Exact measurements are emitted into the build report.

Tauri fullscreen shares native completion and fallback
code. Unused TypeScript-only filters, presentation helpers, language loader and
user-agent utilities remain in optional ESM modules outside classic delivery;
the active search, guide, translation and native transport paths remain in the
player. No historical device ABI or optimizer safety guard was removed.

These size checks are not a physical-device startup or memory measurement.

## Search and playlist follow-up

Channel search owns its editor request and source/catalog lifetime. Results are
published synchronously after accepted input. Actions retain stable group and
channel IDs and resolve fresh positions at execution; stale editors, reordered
lists, replaced catalogs and delayed PIN/playback callbacks cannot select a
different channel. Accepted results remain usable after cancelling another
search. Returning from the category picker explicitly creates a new result
handler with the selected stable ID; callbacks from retired pickers stay inert.
Preview, query storage, parental policy and device keys are preserved.

The shared core scanner now handles quoted commas and blank lines before a URI
in generic M3U/provider and media playlists. Display labels keep their full text;
historical numeric hashes, companion EPG/logo request bodies, archive behavior
and saved references remain compatible. Historical fixture files remain intact,
with explicit expected display corrections tested separately. The eight special
operator dialects retain their existing parser behavior and snapshot coverage.

Provider XML decoding now projects the DOM directly into detached objects,
without constructing and parsing an intermediate JSON string. This also fixes
quoted attributes and Unicode entity recovery. Compatibility tests preserve
existing mixed-content and repeated-element shapes, including empty nodes.

On Node 22.23.3, the final server bundle is 653,905 raw / 186,501 gzip bytes;
Tauri and Capacitor are 653,863 / 186,572. Against the preceding main build,
this adds 659 raw and 818 gzip bytes per artifact. The isolated optimized XML
module decreases from 4,104 / 1,648 to 3,166 / 1,417 bytes (isolated gzip level 6;
complete-artifact gates use level 9). A local jsdom catalog
benchmark (1,500 channels, 502,246 XML bytes, three warmups and nine alternating
samples) measured median decoding at 67.771 ms before and 49.388 ms after;
other runs gave 21–27% improvement. This measures XML parsing, normalization
and DOM projection on Node/jsdom, not network transfer or physical-device startup.

The active search and XML paths have source and optimized-artifact regression
coverage. Further operator-dialect consolidation and physical old-device
measurements remain separate follow-ups.

## Provider delivery and render follow-up

The provider audit matched all 48 nonempty Full menu IDs to registered profiles.
Play admits only Demo, M3U, Stalker and Xtream. Its build now removes the operator
and named-playlist implementations and the Full-only factory, settings and error
branches. Full retains all profiles and the scoped external dealer-script path.
Retained `prov.js` oracles were already excluded from delivery and were not
counted as new runtime savings. The unused private `ClassicScreenPort.guard`
forwarder was removed; active screen-owner guards and cancellation remain.

List and detail rendering now read the validated SettingsStore directly. They no
longer parse and write the same preferences back through bare globals, `window`
and typed settings. Artifact tests use the shipped store and assert zero setting
observation writes while rendering, including after legacy property updates.
Guide observation/publication and category membership edits have semantic source
names with retained classic aliases; see [the ABI contract](architecture.md#public-compatibility-abi-versus-internal-code).

QR SVG output combines horizontal dark runs without changing the encoder, payload,
correction level, dimensions or border. Differential tests compare every rendered
cell and exercise the optimized legacy/modern artifacts. A 33-by-33 invitation
matrix uses 282 rectangles instead of 563 and 4,083 SVG bytes instead of 7,896;
a 173-by-173 sample drops from 219,176 to 114,431 SVG bytes. These are generated
SVG savings, not a claim about device decoding speed. Public QR encoder methods
and their license remain intact.

Compared with main `770ff3d`, Node 22.23.3 produces server JS of 653,275 raw /
186,381 gzip bytes (630 / 120 fewer); Tauri and Capacitor produce 653,233 /
186,446 (630 / 126 fewer). The final staged Play frontend produces 592,577 / 169,494, down from
607,664 / 173,528 (15,087 / 4,034 fewer). Gzip uses level 9; separately loaded
libraries and shared core are unchanged. The 654,000 / 186,750 size ceilings and
ES5 optimizer protections were not increased or relaxed.

## Semantic entrypoints and distribution-specific reachability

The next audit distinguishes built-in managed providers from Full's explicit
external dealer extension. The existing dealer integration test proves that a
script can append a provider ID and use the scoped loader; no normal menu profile
needs it, but it is not globally dead. Play's closed four-profile policy excludes
that entrypoint, so the scoped script loader/AJAX/timer interception is removed
from Play output while provider/catalog lifetime cancellation remains. Full keeps
its tested extension contract. A missing built-in factory now fails startup rather
than fetching an excluded old script; only Full extension IDs outside the managed
inventory can use the fallback. Retained provider scripts remain immutable oracles.

The unused `matchNativeXmltvChannel` convenience wrapper was removed after checking
provider, device, native bridge, linker and sibling Android/shared-core consumers.
It had no caller or published compatibility binding. Native M3U matching still
uses `createNativeXmltvMatcher`, retained per source group, through
`matchCapacitorM3u`; `test-native-epg-parity.ts` verifies that integration. An exported
declaration alone is not evidence of runtime reachability, just as an absent
TypeScript import alone is not evidence of dead code in a classic global ABI.

Source names now describe the archive operation: `pauseLivePlayback`,
`replayFromLiveOffset` and `showPlaybackSeekDialog`. The classic bindings remain
`liveStop`, `timeShift` and `shiftArchiveSelect`, including arity and late device
replacement through live aliases. No new playback algorithm or second state owner
is introduced. Tests exercise actual source operations and optimized declarations.
The [playback command/clock contract](playback-session-architecture.md#commands-observations-and-clocks)
and [guide request/cache contract](guide-architecture.md#request-cache-and-projection-are-different-operations)
record the non-obvious semantics rather than leaving misleading getter/stop names
as the architecture. Size gates and optimizer protections remain unchanged.

Rebuilt against `3e138aa` with the same lockfile, version, Node 22.23.3 and gzip
level 9, final Full server JavaScript is 653,542 raw / 186,482 gzip bytes
(+267 / +101). The final Tauri and Capacitor copies are 653,500 / 186,557
(+267 / +111). Play after native staging is 590,052 / 168,706, down from
592,577 / 169,494 (2,525 raw / 788 gzip bytes removed). All remain within the
unchanged 654,000 / 186,750 ceilings. The delivered JavaScript inventories and
hashes outside `stbPlayer.js` are unchanged in all four outputs; no removed code
was shifted into another downloaded script. Duplicate packaging copies are not
counted as separate startup transfers.

## Media reads, UI consolidation and credential admission

Media highlighting and screen cleanup now read a scalar library revision.
Highlighting no longer copies a complete catalog or returns a discarded detached
item. A 1,000-record regression checks zero metadata reads for revision/highlight,
while `select()` and `snapshot()` still publish detached data. Favorite actions
capture their frame once, and recursive metadata copying creates one ancestor
array per object rather than per property. This measures avoided work, not
elapsed time or decoder performance on physical devices.

Menu rendering samples playback status at most once when needed and avoids
allocating capability/key arrays for each row or key event. List pagination reads
the existing screen/settings owners directly and preserves data-array precedence
and live compatibility writes. Three color dialogs share their input handler;
progress click and drag release share seek logic. The unused private `seekStartX`
value and an unreachable duplicate EPG-tooltip branch were removed. Click and
mouseup remain separate events, including their existing combined behavior.
Provider reachability review did not justify deleting additional runtime
functions or retained device/provider globals.

The credential fixes reject old editor effects after abort reentry, defer loads
during multi-key writes, verify rollback before releasing those loads and recheck
ownership after catalog decoding and guide credential reads. A recursive Save
returns cancellation and never commits later behind the editor. Independent
regressions reproduce mixed-account requests and stale publication on the
preceding implementation. Full-artifact smoke exercises six credential scenarios
in Full and four in Play; editor retry behavior has separate source coverage.

Source names `importGuideReminder`, `openSelectedChannelRecordings` and
`serializeMediaIdentity` describe their actual effects. The first two retain
their historical global names, arity and live aliases; the serializer is private.
Architecture and media documentation distinguish scalar reads from detached
publication, describe credential admission and explain callback/profile-aware
dead-code analysis.

Against main `067f546`, Node 22.23.3 produces final server JS of 652,848 raw /
187,048 gzip bytes: 694 raw bytes fewer and 566 gzip bytes more (0.30%). Tauri and
Capacitor produce 652,806 / 187,116: 694 fewer raw and 559 more gzip bytes (0.30%).
The final staged Play frontend is 588,660 / 168,946: 1,392 fewer raw and 240 more
gzip bytes (0.14%). Its intermediate build output is not the native delivery size.
Gzip uses level 9 with the same Node/zlib versions for both revisions. The raw
ceiling remains 654,000; the gzip ceiling increases explicitly from 186,750 to
187,200 bytes to cover credential checks after the UI savings. Optimizer settings,
ES5 grammar, public ABI protections and separate vendor/shared-core assets are
unchanged. These are final-artifact sizes, not source-line estimates.
