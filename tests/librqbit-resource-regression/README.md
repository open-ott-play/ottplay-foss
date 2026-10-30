# Torrent metadata resource regression

This isolated package points its library target at the actual vendored
`librqbit` sources. It gives the dependency its test-only prerequisites without
adding it to the production workspace or changing the application's default
build targets. The manifest is derived mechanically from the published package;
the integrity checker rejects manifest drift.

Run only the local resource regressions:

```sh
cargo test --locked --manifest-path tests/librqbit-resource-regression/Cargo.toml --no-default-features --features rust-tls --lib resource_bounds_tests
```

The tests validate metadata allocation bounds, peer admission and concurrent
loopback connections. They do not contact public peers. Do not remove the test
filter or enable the optional web UI feature in CI. The harness lockfile starts
from the application lockfile; extra entries support upstream test-only and
optional features. The checker verifies shared torrent-library package versions
and checksums against the production lockfile.
