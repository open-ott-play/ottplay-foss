# Local metadata resource limits

This directory preserves the published librqbit 9.1.0 package with a local
resource-budget patch. It is not a new upstream version.

Upstream: <https://github.com/ikatson/rqbit/tree/4309d38769ef93f6ee4f01a1ab147009a197fa8f/crates/librqbit>

Archive: <https://static.crates.io/crates/librqbit/librqbit-9.1.0.crate>

Archive SHA-256: `4e35a06e481e854f69141928d067406397b3ad7a47bfdc095bc31325f44f5d13`.
The registry package declares Apache-2.0. The complete upstream license is
included alongside this file because the registry archive omits it.

The adapter's normal `peer_limit` does not cover magnet metadata acquisition.
Its post-download metadata check also cannot bound a peer's earlier allocation.
Two dependency internals therefore enforce limits before work is admitted:

- At most 16 concurrent metadata readers per resolution.
- At most 1,024 distinct admitted peers, including initial peers and pending jobs.
  Duplicate addresses do not add jobs, and initial input inspection is bounded.
- Each peer metadata buffer must contain 1 byte through 1 MiB. Empty or larger
  announced sizes are rejected before allocation.

The adapter admits at most two resolutions and retains its total deadlines and
post-download validation. These limits describe metadata buffers and admitted
work, not a hard process-wide memory limit. Peer protocol buffers, decoded
metadata, transport state and the player have their own overhead.

The full source diff and hashes are recorded in
`../librqbit-9.1.0-metadata-bounds.patch` and
`../librqbit-9.1.0.provenance.json`. Published manifests, feature flags and dependency
requirements are unchanged. The workspace uses a Cargo path override; it does
not modify the shared registry cache.

Validation:

```sh
node scripts/check-librqbit-backport.cjs
cargo test --locked --manifest-path tests/librqbit-resource-regression/Cargo.toml --no-default-features --features rust-tls --lib resource_bounds_tests
cargo test --locked -p ottplay-core companion
```

Tests exercise allocation boundaries, peer admission and real loopback metadata
connections exceeding the reader limit. The core fixture downloads and seeks a
selected file from a local seed and verifies independent cancellation.
Remove this override when a compatible upstream release provides equivalent
configurable limits, then retain the integration checks against that release.
