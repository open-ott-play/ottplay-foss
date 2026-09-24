# Runtime ownership migration

The player now separates screen, settings, channel, media, guide and decoder state
from the classic renderer. This is a replacement of active state owners and
command paths; historical attribution and retained test oracles are unchanged.

- `ScreenController`, `InputRouter`, `MenuRegistry` and `ClassicScreenPort` own
  screen lifetimes, focus, semantic input and callback cancellation. Provider
  menus enter through the compatibility port. A quality picker temporarily
  suspends its media parent and retires with that parent.
- `SettingsStore` owns settings, validation and editor drafts. Compatibility
  properties remain projections for device scripts and menus.
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

The combined Full artifact measures 643,739 UTF-8 bytes / 181,565 bytes gzip
(level 9), including all six owners and conservative favorites/journal imports.
The former 610,000/170,000 limit described the previous runtime. This migration
sets a bounded 650,000/184,000 limit: about 1.0% raw and 1.3% gzip headroom above
the measured Full result. Size checking still runs for server, staged Tauri and
Capacitor artifacts and rejects missing, stale or oversized outputs. It is not
replaced by a diagnostic-build exception. Play is measured and checked separately.

The increase pays for explicit lifetime ownership, source-scoped persistence,
rollback-safe migration and compatibility ports. It is not an optimization claim;
physical old-device startup and memory behavior require the beta hardware pass.
