# Native webOS development moved to ottplay-lg

The experimental SDL/PlxNative client is maintained exclusively in
[open-ott-play/ottplay-lg](https://github.com/open-ott-play/ottplay-lg).
Use that project's build, installation, update, acceptance and release guides.
This repository no longer builds or publishes that native application.

The classic [LG hosted webOS wrapper](lg-webos-installation.md), Tauri player,
Capacitor apps and generic Rust media companion remain in OTTPlay FOSS.
Removing the duplicate native producer does not remove these supported targets.

## Source and license continuity

The native source at FOSS commit
[`47adabad66b41b33e126925f7f00b17c7bf19b58`](https://github.com/open-ott-play/ottplay-foss/tree/47adabad66b41b33e126925f7f00b17c7bf19b58/native/webos)
was imported into LG with all 38 overlay patches preserved byte-for-byte.
LG records the import in its SOURCE-PROVENANCE receipt. The application and
patches retain GPL-3.0-or-later and upstream notices; the FOSS root MIT license
does not relicense them. Existing FOSS tags, matching source archives and release
assets remain historical records; no history rewrite or asset deletion is part
of this migration.

A documentation-only [source relocation pointer](../native/webos/README.md)
remains at the historical `native/webos` path. Existing application legal/source
links keep resolving to the maintained repository and immutable historical
source; the duplicate runtime, native build scripts and producer workflows are
retired.

LG still imports its generic companion packaging helper from that immutable
FOSS commit. The historical pin remains resolvable after removing the duplicate
producer from new FOSS source. A future LG repin must relocate the helper or
update and verify those paths; this migration does not claim LG is self-contained.

## Compatibility tools retained here

- `scripts/webos-cli-compat.cjs` preserves the source-guarded CLI 3.2.6 workaround.
  It does not edit the installed SDK or relax credentials/host verification.
- `scripts/check-global-favorites-conformance.cjs` checks the actual browser codec
  against the shared native interoperability vectors.
- The read-only metadata gateway retains historical native release routes for
  existing installers. It does not build native packages or follow a mutable
  latest tag. No gateway deployment is implied by this source change.

## Retained tool provenance

The compatibility tools are retained from the immutable
[FOSS 1.1.70 source](https://github.com/open-ott-play/ottplay-foss/tree/a8c386eef0654c3ddbf9ea429b636bd148f4f0e5/native/webos),
with only the required path adjustments:

- `native/webos/ares-compat.cjs` → `scripts/webos-cli-compat.cjs`.
- `native/webos/test_ares_compat.cjs` → `tests/test_webos_cli_compat.cjs`.
- `native/webos/test_favorites_conformance.cjs` → `scripts/check-global-favorites-conformance.cjs`.

Relocation changes no existing license or attribution and strips no per-file
notice. The historical [native README license scope](https://github.com/open-ott-play/ottplay-foss/blob/a8c386eef0654c3ddbf9ea429b636bd148f4f0e5/native/webos/README.md#source-and-license)
and [COPYING](https://github.com/open-ott-play/ottplay-foss/blob/a8c386eef0654c3ddbf9ea429b636bd148f4f0e5/native/webos/COPYING)
remain available. The root MIT license does not relicense GPL-covered native
runtime code or patches.
