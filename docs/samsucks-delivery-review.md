# Samsung TV delivery review: SamSUCKS

Reviewed 30 October 2026 at upstream revision
[`6b00e926e163a3154dd1993a26b47482d61ebf40`](https://github.com/rfaile313/samsucks/tree/6b00e926e163a3154dd1993a26b47482d61ebf40).
The resulting OTT-play workflow is in
[Samsung Tizen installation](samsung-tizen-installation.md).

## Useful architecture and delivery patterns

SamSUCKS separates its plain-JavaScript interface, Plex integration, platform
input handling and AVPlay playback. Its setup and deployment scripts turn the
application directory into a WGT and install it through Samsung tooling. The
useful delivery model is a locally packaged application with explicit device
setup, package identity, signing and installation stages.

OTT-play preserves its own shared interface, providers and media engines. It
adds a packaged TV target with local assets and an explicit file-URL boot path.
The same root is used for the initial polyfills, device adapter, provider and
optional modules, translations and fonts. Merely putting the browser bundle
in a ZIP is insufficient: root-relative HTTP paths and `location.origin ===
"null"` can otherwise make a package that installs but never loads its player.

The release WGT contains the player snapshot, while the LG hosted IPK opens the
canonical website. These targets therefore have different update behavior.
Samsung documents that [hosted applications do not support Tizen APIs](https://developer.samsung.com/smarttv/develop/faq/hosted-applications.html);
a redirect wrapper would not preserve the TV application context. It is not
used as a substitute for packaged Samsung delivery.

SamSUCKS's AVPlay implementation and reported performance numbers are not part
of this change. OTT-play's existing HTML video, Hls.js and Shaka paths remain
the playback engines. No native decoder, audio codec, DRM or direct-play
guarantee is inferred from another application's tests.

## Signing must match the target

The upstream setup script creates a generic Tizen author certificate. That is
not a sufficient documented basis for claiming support on every Samsung TV.
[Samsung's certificate instructions](https://developer.samsung.com/smarttv/develop/getting-started/setting-up-sdk/creating-certificates.html)
describe Samsung author and distributor certificates, device DUIDs and the
importance of preserving the author identity for future updates.

OTT-play therefore publishes an explicitly **unsigned** WGT. Its helper verifies
the release payload, delegates signing to an existing official CLI/profile,
checks that signing preserved the application files, and installs only when
the operator separately selects a target. It does not generate certificates,
download an SDK, scan a subnet, store Samsung credentials or silently remove
an existing application after a signing error.

Signing and installation through the helper are qualified for macOS/Linux
command execution. Windows can verify the unsigned package and use the official
Studio signing/install workflow; the helper does not run an unqualified batch
wrapper. Test fixtures exercise command boundaries without claiming a real
Samsung certificate or device acceptance.

The upstream README's broad model-year wording also differs from its descriptor:
the reviewed `app/config.xml` requires Tizen 6.5 and the TV profile. Our initial
5.5 installation floor is declared independently; it is not proof of playback
on all models from a particular year. Physical device acceptance remains
separate from archive, build and browser tests.

## Packaging and release invariants

The WGT is deterministic and bounded. Its configuration, bundled source identity,
numeric widget version and external metadata must agree. The verifier rejects
unexpected paths or types, malformed archives, stale web bundles and accidental
signature material in the unsigned payload. The installer checks the signed
payload against the same verified unsigned package.

Samsung's [configuration reference](https://developer.samsung.com/smarttv/develop/guides/fundamentals/configuring-tv-applications.html?device=htv)
limits numeric version components to `0–255`, `0–255` and `0–65535`. A frozen
build-number projection handles rollover without inserting beta/RC text into
`config.xml`. The original release identity remains separately inspectable.

The WGT, checksum, metadata and standalone helper join the existing web release
receipt. Packaging is mandatory before staging; no signing secret is added to
CI. The same candidate/source checks and unchanged-byte stable promotion apply
as for the other supported release artifacts.

## Family Hub is a separate platform

The presence of Tizen on a refrigerator does not establish TV-profile
compatibility. Samsung's [Smart TV FAQ](https://developer.samsung.com/smarttv/develop/faq/other-features.html)
explicitly distinguishes Family Hub compatibility; its
[consumer refrigerator guide](https://www.samsung.com/us/support/answer/ANS10006847/)
limits normal app installation to the offered catalog. The
[Family Hub developer program](https://developer.samsung.com/family-hub) is the
relevant source for an eventual dedicated package.

The reviewed SamSUCKS descriptor uses `tv-samsung`, TV input, AVPlay and product
information privileges and a landscape UI. None of those establishes a valid
Family Hub package profile, certificate, SDB connection or installation route.
A browser fallback in its source also does not prove WGT compatibility on a
refrigerator. OTT-play retains its existing hosted-browser route for Family Hub;
this release does not create an unverified refrigerator installer.

## Attribution and limits

SamSUCKS is GPL-3.0 licensed. This work reviews its architecture and deployment
approach; the OTT-play package builder, helper and runtime adjustments are
independently implemented. Its source, images, fonts, QR implementation and
branding are not bundled in the OTT-play application.

Record the actual TV model, firmware, certificate profile identity, installed
widget version and playback results during device acceptance. Keep private
keys, passwords and provider tokens out of public reports.
