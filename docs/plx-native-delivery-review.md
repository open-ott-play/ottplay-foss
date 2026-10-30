# LG delivery review: PlxNative and webOSbrew

Reviewed 30 October 2026. The reference project is
[GLinnik21/plx-native](https://github.com/GLinnik21/plx-native/tree/aef53a3f6148e41378bb21abd527518a642d733a),
revision **`aef53a3f6148e41378bb21abd527518a642d733a`**. This review separates
reusable distribution concepts from that project's native player architecture.
The resulting OTT-play user workflow is in
[LG webOS installation](lg-webos-installation.md).

## Application architecture

PlxNative draws a native GPU interface and sends media to LG's decoder through
platform libraries. Its [app descriptor](https://github.com/GLinnik21/plx-native/blob/aef53a3f6148e41378bb21abd527518a642d733a/pkg/appinfo.json)
has `type: native`; its [platform implementation](https://github.com/GLinnik21/plx-native/blob/aef53a3f6148e41378bb21abd527518a642d733a/rust-modules/platform/src/webos.rs)
and [build rules](https://github.com/GLinnik21/plx-native/blob/aef53a3f6148e41378bb21abd527518a642d733a/Makefile)
handle firmware-specific interfaces, native dependencies and packaging. Those
requirements explain why its compatibility reports cannot be transferred to
another player merely by adopting its installation method.

OTT-play retains its existing web player and input handling. Its delivery
package is a hosted `type: web` app for the canonical HTTPS player address.
It does not import PlxNative's SDL/Rust renderer, native media interfaces,
storage service, telemetry, or sandbox repair paths. No performance, codec or
firmware compatibility claim from that implementation is inherited.

LG explicitly supports
[hosted web apps](https://webostv.developer.lge.com/develop/getting-started/web-app-types),
and its [metadata reference](https://webostv.developer.lge.com/develop/references/appinfo-json)
defines the persistent app ID and three-component numeric version. Packaging
is separate from approval for the LG Apps store.

## Installation and lifecycle

The useful model in PlxNative's
[installation guide](https://github.com/GLinnik21/plx-native/blob/aef53a3f6148e41378bb21abd527518a642d733a/docs/install-and-verify.md)
is two routes to one app: computer-assisted IPK installation and a Homebrew
Channel catalog. Both should explain what users must maintain after first
installation. In particular, an app installed through Developer Mode can be
removed when that session expires. Installing a catalog app does not remove
the session dependency.

OTT-play documents the official LG Developer Mode workflow and an optional
external desktop installer. The Homebrew route assumes a working Homebrew
Channel. It does not attempt to install firmware, obtain elevated privileges,
disable platform protections, or change another installed app. Stable app ID
`com.openottplay.player` lets package updates target the same launcher entry;
profile backup remains necessary before uninstalling or clearing app storage.

## Package construction

PlxNative's
[package writer](https://github.com/GLinnik21/plx-native/blob/aef53a3f6148e41378bb21abd527518a642d733a/ci/mkipk.py)
shows practical interoperability details: a Debian-style `ar` container,
`debian-binary`, compressed control and data members, the application payload,
and `usr/palm/packages/<id>/packageinfo.json`. Identity must agree across the
control metadata, application descriptor, package descriptor and archive paths.
It also makes archive ordering, ownership and timestamps deterministic.

Those are format and validation requirements for our independent packager,
not a reason to carry native binaries or installation hooks into a hosted
launcher. Release checks should inspect the generated archive, ensure the
expected launcher assets are present, reject unexpected paths, and compare
the resulting size and digest with the manifest. The control `Installed-Size`
uses KiB; the webOSbrew API schema describes manifest `installedSize` in bytes.
Do not conflate those fields.

## Homebrew catalog and package manifest

The protocol was checked independently against
[webosbrew/apps-repo](https://github.com/webosbrew/apps-repo/tree/f3c64646459e9526832fcfc6e61d5c8d009decb4)
at **`f3c64646459e9526832fcfc6e61d5c8d009decb4`** and
[webos-homebrew-channel](https://github.com/webosbrew/webos-homebrew-channel/tree/1a2b969e992617c9ba4b8a891542cb93a9e07b0a)
at **`1a2b969e992617c9ba4b8a891542cb93a9e07b0a`**.

- A [repository response](https://github.com/webosbrew/apps-repo/blob/f3c64646459e9526832fcfc6e61d5c8d009decb4/content/schemas/api/PackagesPage.json)
  contains `packages`. Each [entry](https://github.com/webosbrew/apps-repo/blob/f3c64646459e9526832fcfc6e61d5c8d009decb4/content/schemas/api/PackageInfo.json)
  identifies the app and supplies a manifest or manifest URL.
- The [package manifest](https://github.com/webosbrew/apps-repo/blob/f3c64646459e9526832fcfc6e61d5c8d009decb4/content/schemas/api/PackageManifest.json)
  requires ID, version, type, title, icon, IPK URL and IPK hash. The OTT-play
  entry declares `rootRequired: false`.
- [Settings](https://github.com/webosbrew/webos-homebrew-channel/blob/1a2b969e992617c9ba4b8a891542cb93a9e07b0a/frontend/views/SettingsPanel.js)
  stores the exact repository URL entered. The
  [catalog reader](https://github.com/webosbrew/webos-homebrew-channel/blob/1a2b969e992617c9ba4b8a891542cb93a9e07b0a/frontend/views/BrowserPanel.js)
  downloads that URL and reads `data.packages`. A static JSON release asset is
  sufficient; no special API path is required.
- The [detail view](https://github.com/webosbrew/webos-homebrew-channel/blob/1a2b969e992617c9ba4b8a891542cb93a9e07b0a/frontend/views/DetailsPanel.js)
  resolves the package URL from the manifest and submits its SHA-256 to the
  installer. Absolute URLs bound to an exact release avoid ambiguity when
  repository or manifest downloads redirect.

OTT-play therefore publishes an IPK, an app manifest, a small repository index
and its icon as release assets. A prerelease repository URL is a snapshot, not
an automatic beta subscription. The stable GitHub `latest` URL is useful only
after a stable release includes these assets. Central webOSbrew catalog
inclusion is a separate submission and review; our repository is not a claim
of central catalog membership.

## Release and update design

PlxNative's
[package workflow](https://github.com/GLinnik21/plx-native/blob/aef53a3f6148e41378bb21abd527518a642d733a/.github/workflows/build-package.yml)
checks manifest identity and digest against the built IPK. Its
[release workflow](https://github.com/GLinnik21/plx-native/blob/aef53a3f6148e41378bb21abd527518a642d733a/.github/workflows/release.yml)
publishes matching artifacts, checks the published bytes and records evidence.
Its [nightly catalog generator](https://github.com/GLinnik21/plx-native/blob/aef53a3f6148e41378bb21abd527518a642d733a/ci/nightly.py)
binds a catalog to a complete package rather than pointing users at an
unfinished upload. These are useful release invariants.

OTT-play adds the TV assets to its existing release process and provenance
instead of creating an unrelated release path. Package identity, numeric
version, checksum and exact release URLs must agree. Existing manifest and
candidate validation should fail a release with missing or inconsistent TV
artifacts. Tests should use fixture packages without installing anything on a
television.

A hosted launcher introduces two independent update scopes: replacing the IPK
changes the launcher, while publishing the canonical website changes the
player loaded on a later launch/reload. The IPK does not pin that remote player
to its release. A package downgrade consequently does not roll back the hosted
application. It is important to record both versions during a device check.

## Source quality and limits

The upstream
[webOSbrew submission file](https://github.com/GLinnik21/plx-native/blob/aef53a3f6148e41378bb21abd527518a642d733a/docs/webosbrew-package.yml)
still contains older plaintext-network and playback descriptions that conflict
with its current installation guide and README. It was not used as a current
compatibility or security contract. Our documentation must describe the
delivered package and observed results rather than inherit historical claims.

The package structure, manifest schema and deterministic offline checks do
not prove a successful install or decoder behavior on a physical television.
Record the TV model, webOS version, installation method, installed package
version, loaded player version and actual playback result separately. A
simulator cannot supply that hardware evidence.

## Licensing

PlxNative's [licensing statement](https://github.com/GLinnik21/plx-native/blob/aef53a3f6148e41378bb21abd527518a642d733a/LICENSING.md)
identifies its current own code as GPL-3.0-or-later and describes the matching
source obligations for distributed binaries. This work reviews its design;
it does not copy its source, media, icons, fonts, native libraries or branding.
The OTT-play launcher uses our assets and independently implemented package
and manifest generation. Any future reuse of third-party code or assets needs
its own attribution and license review.
