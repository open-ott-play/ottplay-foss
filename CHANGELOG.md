# Changelog

## [1.1.53] - Development line

### Changes

- The 1.1.53 development line adds ordered remote Plex queues, preserves an
  explicit native Play request while buffering, and improves contextual Unicode
  search and grapheme-safe editor input.
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

### Security

Release artifacts retain their immutable build provenance and checksums. The new
notes validation rejects incomplete publication metadata before modifying durable
publication state. It does not announce a new application CVE. Protect provider
credentials and remote-control consent codes, and keep local server access within
the documented trust boundary.
