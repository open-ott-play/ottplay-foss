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
