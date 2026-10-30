# LG webOS hosted application

This directory contains the small, unprivileged launcher for the canonical
`https://player.ottplay.here.now/` player. It follows LG's documented
[hosted web app](https://webostv.developer.lge.com/develop/getting-started/web-app-types)
model. The player code, provider support and updates come from that HTTPS site;
the IPK does not include an offline player or native decoder.

`appinfo.json` is a template. The packager stamps its numeric version from the
frozen release build number, includes a matching package descriptor, and embeds
the release identity in `build-info.json`. No credentials, services, install
scripts or elevated permissions are included. The simulator's separate test
launcher is not used in releases.

`icon.png` (80 × 80) and `largeIcon.png` (130 × 130) are resized from the existing
project artwork at `images/player-logo.png`. The original remains there; no
third-party artwork was added.

Build and installation instructions are in the main LG webOS installation
guide. The separate metadata HTTP adapter is described in
[Homebrew feed operations](../docs/webos-feed-operations.md); its Wrangler
configuration is not part of the IPK. An ordinary local build requires the
explicit `--local` option and uses version `1.0.0`; it must not be published in a
release feed.
