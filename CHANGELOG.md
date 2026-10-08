# Changelog

## [1.1.53] - Development line

### Changes

- The 1.1.53 development line adds ordered remote Plex queues, preserves an
  explicit native Play request while buffering, and improves contextual Unicode
  search and grapheme-safe editor input.
- Remote diagnostics now expose read-only UI/media snapshots, capability
  reasons, loaded-bundle identity and a bounded journal of operation receipts.
  Inspection does not create a playback backend, capture a screen or change
  saved settings.
- Release publication now reads this version's reviewed notes from the exact
  source commit and verifies them before writing publication evidence or
  advancing the durable publication counter.

### Upgrade

Retain provider profiles and exported settings before replacing a web, desktop or
container installation. Follow the platform-specific build/install instructions;
Android APK/AAB packages are maintained in ottplay-android. Automatic updating is
not configured, and unsigned iOS packages require operator signing/sideloading.
Validate playback, remote input and saved settings on the intended TV/STB/native
platform; automated tests do not establish physical-device acceptance.

Use a controller and CLI revision supporting `inspect` v1 for the new workbench
commands. Older combinations report unsupported capabilities. The operation
journal retains at most 128 request IDs; retained entries expire after ten
minutes, while eviction or reload makes them unknown. Never replay a mutation
automatically because its receipt is missing.

### Security

Release artifacts retain their immutable build provenance and checksums. The new
notes validation rejects incomplete publication metadata before modifying durable
publication state. It does not announce a new application CVE. Protect provider
credentials and remote-control consent codes, and keep local server access within
the documented trust boundary.

Diagnostic snapshots omit DOM text, media titles/URLs, settings and credentials.
Runtime and section checks validate inspection responses under the existing
authorized connection; they do not introduce a new authentication mechanism or
exclusive routing for mutation commands. An `accepted` receipt records a queued
effect and can remain after transport cancellation. `invoked` is not proof of
the effect, and the journal does not emit `observed`. Decoder progress does not
prove physical screen or audio output.
