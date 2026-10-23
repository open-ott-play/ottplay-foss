# Updater ZIP compatibility regression

This standalone workspace exercises the exact `Update::extract_zip` method
from the vendored Tauri updater against ZIP 9.0.0. `build.rs` reads the method
from the production source at compile time; it does not maintain a second copy.
The small test adapter supplies a temporary directory, error conversions and
installer result types. It never downloads or launches an installer.

```sh
python3 scripts/check-updater-backport.py
cargo test --locked --manifest-path tests/updater-zip-regression/Cargo.toml
python3 scripts/check-updater-features.py
```

Rust 1.88 or newer is required by ZIP 9. The tests run on Linux and Windows in
the existing CI jobs; they can also run locally on macOS. They cover stored
NSIS/MSI archives, Unicode and spaces, support files, nested/missing installers,
an empty archive, malformed input and a destination IO failure. The real
filesystem and ZIP reader are used. Linux/macOS also verify that privileged
Unix mode bits are cleared and an archive symlink cannot expose or change the
permissions/content of a sibling file outside the extraction directory. All
fixtures stay in one temporary directory, with no elevation or execution.
This qualifies extraction compatibility and those two security boundaries;
it is not a proof of every security property of the ZIP library.

The app's Windows updater keeps ZIP support **disabled** and continues to use
the raw MSI/NSIS flow. `check-updater-features.py` verifies this target-specific
policy and the existing native Windows CI still builds, installs and uninstalls
both package types. These tests do not replace that full application check.

## Strict TLS policy

The same isolated crate compiles `enforce_tls_verification` directly from the
vendored production source. HTTPS tests create ephemeral certificates and a
loopback-only server: a trusted certificate for `localhost` succeeds, an
untrusted certificate fails, and a trusted certificate for a different hostname
fails. A custom preconfigured TLS connector cannot replace the normal verifier,
while explicit root-certificate additions still pass the positive test. The
default test feature matches the application’s Rustls backend with its ring
provider. `check-updater-backport.py` also requires this helper immediately after
both optional client callbacks and reconstructs the exact upstream source.
The tests create no persistent private keys and make no external requests.
