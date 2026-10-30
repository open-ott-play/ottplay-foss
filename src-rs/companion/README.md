# Standalone media companion

`ottplay-companion` runs the existing `ottplay-core::companion::Companion`
service without the player server. Its only listener is HTTP on `127.0.0.1`.
It does not publish discovery data or expose player, proxy, health, or control
routes. The existing token authentication protects every companion request.

Build and test from the repository root:

```sh
cargo test -p ottplay-companion
cargo build --release -p ottplay-companion
```

The caller supplies `OTT_COMPANION_DIR` as an absolute private storage path and
`OTT_COMPANION_TOKEN` as 32–128 URL-safe characters. Optional
`OTT_COMPANION_PLUGIN_DIR` must also be absolute. `OTT_COMPANION_PORT` defaults
to `8793`; `0` requests an ephemeral port. The endpoint has the existing form
`http://127.0.0.1:<port>/companion/<token>/v1`.

The process writes only its non-secret listener address to standard error.
It never prints the token or complete endpoint. `OTT_COMPANION_HOST` may only
be `127.0.0.1`, and `OTT_COMPANION_ALLOW_REMOTE=1` is rejected. This binary has
no remote-bind or TLS mode.

The caller owns startup and termination. `SIGTERM` on Unix and `Ctrl-C` shut
down the service and its sessions before exit. An application embedding this
binary must supervise the child and stop it when the application closes.
Automatic parent-death detection and a private endpoint IPC channel are not
implemented here. No browser code starts this binary automatically.

## ARM webOS build status

The target is `armv7-unknown-linux-gnueabi`. The standalone crate enables
QuickJS's supported `bindgen` feature only for ARM Linux because its 0.14
pre-generated ARM bindings have an outdated `JS_NewArrayBuffer` signature.
Cross-builds therefore need host libclang and target sysroot arguments for
bindgen, in addition to the target C compiler and archiver.

Install Rust's `armv7-unknown-linux-gnueabi` standard-library target, then run:

```sh
python3 src-rs/companion/build-webos.py --sdk /absolute/path/to/webos-sdk --libclang /absolute/path/to/libclang-directory
```

The build script supplies the SDK sysroot explicitly, enables the legacy
feature, and records the final link map and ELF metadata beside the binary.
It does not run SDK setup scripts or alter the SDK. An optional `--target-dir`
keeps these artifacts in a separate build directory.

The inspected webOS SDK uses the soft-float ARM EABI and glibc 2.12. Its
compiler needs an explicit sysroot path after relocation. The prebuilt Rust
1.96 standard library additionally requires `getauxval`, which this SDK does
not provide. The explicit `webos-legacy-glibc` feature supplies that function
only on ARM Linux. General Linux and host builds retain standard libc symbol
resolution.

The compatibility code reads this process's auxiliary vector using the native
word-pair ABI documented in [proc_pid_auxv(5)](https://man7.org/linux/man-pages/man5/proc_pid_auxv.5.html).
It uses fixed stack storage, bounds the scan, handles partial/interrupted reads,
and closes the descriptor once. Missing entries return zero with `ENOENT`, as
specified by [getauxval(3)](https://man7.org/linux/man-pages/man3/getauxval.3.html).
Errors remain errors; the code does not substitute invented auxiliary values or
change operating-system access restrictions. Linux consumes the descriptor on
an interrupted [close(2)](https://man7.org/linux/man-pages/man2/close.2.html), so
that operation is not retried.

The Rust 1.96.1 release build was linked with the inspected SDK on 2026-10-30:
ELF32 ARM EABI5, soft-float calling convention, interpreter `/lib/ld-linux.so.3`.
Its required glibc symbol versions stop at `GLIBC_2.12`; `libgcc_s.so.1` also
needs `GCC_3.0`, `GCC_3.5`, and `GCC_4.3.0`. The link map contains the local
`getauxval` definition and no SDK `libglibc_polyfills` archive. This is build
evidence, not TV runtime validation. Firmware symbol checks, child-process
supervision, and device playback tests remain necessary before packaging.

The container's server-only workspace intentionally excludes this standalone
binary and its build-only dependencies.
