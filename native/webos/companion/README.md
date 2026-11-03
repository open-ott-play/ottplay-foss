# Native webOS companion package

The native player launches the existing Rust `ottplay-companion` as an app-owned
child process. This is the same torrent, storage and plugin implementation used
by the other native players. It is not an HTTP server exposed to the LAN.
`bin/ottplay-companion` listens only on loopback; every API request requires the
per-launch capability in `/companion/<token>/v1`. The launcher owns its lifetime,
cache directory, resource limits and capability.

## Build and verification

Run from the repository root with Python 3.11 or newer, Rust 1.96.1, the
`armv7-unknown-linux-gnueabi` Rust target, libclang, and the pinned SDK archive
identified by `native/webos/upstream.json`. Keep build output outside the source
tree. The wrapper reuses `src-rs/companion/build-webos.py`.

```sh
python3 native/webos/companion/build.py build \
  --sdk "$WEBOS_SDK" \
  --sdk-archive "$WEBOS_SDK_ARCHIVE" \
  --libclang "$LIBCLANG_PATH" \
  --target-dir "$COMPANION_TARGET" \
  --output "$COMPANION_BUNDLE" \
  --jobs 2
```

The bundle contains the executable, a private link map, a deterministic local
source archive, source checksums and a build receipt. The wrapper checks source
inputs before and after compilation, pins the Rust toolchain and SDK archive,
and records the actual SDK executable hashes. Verification reads the binary's
ELF and program headers, plus fresh SDK `readelf` output. It rejects:

- Anything other than ARM ELF32 little-endian EABI5 with the soft-float ABI.
- An interpreter other than `/lib/ld-linux.so.3`.
- Executable stacks, writable executable load segments, runtime search paths,
  text relocations or unexpected shared libraries.
- Requirements newer than `GLIBC_2.12` or `GCC_4.3.0`, private ABI requirements,
  an imported `getauxval`, or linkage to the SDK glibc polyfill archive.

To inspect an existing candidate without assigning it a new source receipt:

```sh
python3 native/webos/companion/build.py inspect \
  --binary "$COMPANION_BINARY" \
  --readelf "$WEBOS_SDK/bin/arm-webos-linux-gnueabi-readelf"
```

Passing these checks establishes the declared binary ABI. It does not prove
that a particular TV firmware provides every symbol, that the child process
starts, or that media plays. Device execution remains explicitly false in the
receipt until the separate device validation records it.

## Native package hook

After the native application files have been assembled, but before the IPK data
archive is written, stage into the application root (the directory containing
`appinfo.json`):

```sh
python3 native/webos/companion/build.py stage \
  --bundle "$COMPANION_BUNDLE" \
  --readelf "$WEBOS_SDK/bin/arm-webos-linux-gnueabi-readelf" \
  --destination "$IPK_APPLICATION_ROOT"
```

The stage step re-verifies the binary and checksums, and refuses source changes
since compilation or an existing companion install path. It adds:

```text
bin/ottplay-companion             executable, mode 0755
companion/manifest.json          ABI and launch contract
companion/receipt.json           binary and source checksums
companion/source.json            source-archive reference
companion/licenses/              companion, QuickJS and shared-core notices
```

No tokens, runtime cache, absolute build paths, SDK, private link map or source
archive are copied into the app. The native IPK verifier must check this
executable as well as the main executable, and bind its bytes to the receipt.
Packages that offer local torrent playback must require this hook; a missing
helper must not silently become a remote-service dependency.

## Corresponding source and release gate

`local-source.tar.gz` contains the exact local Cargo workspace inputs, patched
path dependencies, generated shared-core artifact and build scripts. The source
receipt also lists the entire workspace lock's external package coordinates
and checksums. This is intentionally an input receipt, **not a declaration that
all corresponding source has been collected**.

The release source collector must merge the local archive with all locked
registry/git dependencies used by this build, their licenses, the Rust standard
library sources matching the toolchain, and the SDK runtime source selected by
`ottplay-companion.link.map`. Use the existing runtime-source collection process
to verify each linked SDK input against the pinned SDK archive. Hashing the SDK
archive and compiler executables alone does not prove that an extracted sysroot
was not changed. Publish the completed source artifact alongside the IPK and
include both checksums in the release manifest. Keep this release gate separate
from package staging so a local build cannot incorrectly claim complete source
or device compatibility.

```sh
python3 -m unittest discover -s native/webos/companion -p 'test_*.py'
```
