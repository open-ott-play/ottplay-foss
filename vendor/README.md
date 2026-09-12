# GLib 0.18.5 security backport

The Linux Tauri / GTK3 dependency graph requires the `glib` 0.18 series.
Upgrading only this transitive dependency to 0.20 does not satisfy GTK3's
version requirement. The workspace therefore patches crates.io `glib` to
`vendor/glib-0.18.5`, with the upstream version retained unchanged.

The directory contains the complete published [glib 0.18.5 crate](https://crates.io/crates/glib/0.18.5),
including its MIT `LICENSE`, `Cargo.toml.orig`, tests and `.cargo_vcs_info.json`.
The source archive SHA256 is
`233daaf6e83ae6a12a52055f568f9d7cf4671dabb78ff9560ab6da230ce00ee5`,
which matches the original workspace Cargo.lock registry checksum.
`glib-0.18.5.provenance.json` records every published file hash and the sole
patched source hash. The shared Cargo registry cache is never modified.

The only change inside the published crate is the two-line fix in
`src/variant_iter.rs` from [upstream PR #1343](https://github.com/gtk-rs/gtk-rs-core/pull/1343),
commit `b5a4071e439bef2b5eea76c3aa25e5ae84839e34`. The pointer passed as a C
out-parameter is declared mutable and passed as `&mut p`. This removes the
invalid write through an immutable Rust reference identified by
[RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html).
`glib-0.18.5-RUSTSEC-2024-0429.patch` records the exact source diff.

Validation:

```sh
node scripts/check-glib-backport.cjs
cargo test --locked --release --manifest-path tests/glib-variant-regression/Cargo.toml
```

Differential verification on Rust 1.96.1 with system GLib 2.88.3: the same
release test against the unmodified published 0.18.5 source exits with SIGSEGV
(signal 11); the backported source passes. The reproduction uses separate
temporary build fixtures and never edits the shared Cargo cache.

The optimized regression exercises forward, reverse, mixed-direction, `nth`,
`nth_back` and `last` borrowed-string iteration using actual GLib FFI. It needs
Rust, pkg-config and the system GLib development package (for example
`libglib2.0-dev` on Debian/Ubuntu). It is a small standalone Cargo workspace,
so it does not compile the Tauri application or all upstream GLib tests.

No advisory is ignored, no check is disabled, and no upstream version is
invented. A scanner that only compares package name/version may continue to
report 0.18.5; the provenance and exact patch document the code mitigation.
Remove this override and its regression fixture when the application can
move to a supported GTK dependency graph with the upstream fix, or a
compatible official 0.18 security release becomes available. All release
builds must include `vendor/`; Docker copies it before resolving Rust packages.
