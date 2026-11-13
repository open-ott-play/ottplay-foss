# Experimental multiview foundation

This is gated source infrastructure, not a delivered player feature. The server
main/router does not register these adapters. Production capabilities remain
`max_inputs = 0`, `qualified_input_adapters = []`, and `output_profiles = []`.
Existing public player/controller commands and playback paths are unchanged.

The core contains pixel geometry, bounded frame queues, owned decoder/encoder
lifecycles, a persistent compositor, and a private source broker. The server files
are imported by isolated integration tests; constructing a router does not start
a listener. See [the broker runbook](broker/README.md) for authority, source
provisioning, revocation and retirement rules. Never use household credentials,
profiles or media for these fixtures.

## Ordinary tests

From the repository root, with the existing locked workspace dependencies:

```sh
cargo test --locked -p ottplay-core multiview::
cargo test --locked -p ottplay-server --test multiview_fixtures
cargo test --locked -p ottplay-server --test multiview_broker_boundary
```

The pre-publication isolated harness passed 96 tests and left three media/lifecycle
tests ignored. It imported the actual source modules and used dependency versions
from the root lockfile; this is not full-workspace, all-platform or device
qualification. Normal Cargo integration-test discovery includes both server test
files. Windows validation does not exercise the Linux/macOS encoder implementation.

## Explicit media and process fixtures

The three opt-in tests in `src-rs/server/tests/multiview_fixtures.rs` cover finite media
composition, owned-worker cancellation/cleanup, and authenticated in-memory HLS
source replacement/retirement. They are not counted in the 96 executed tests.

Run them only in an isolated environment using disposable generated media and
explicit absolute `OTTPLAY_MULTIVIEW_FFMPEG` and `OTTPLAY_MULTIVIEW_FFPROBE` tool
paths. Inspect the test source first; it starts owned subprocesses and uses
scratch output directories. Run one test at a time with `--ignored --exact` and
`--test-threads=1`, for example:

```sh
cargo test --locked -p ottplay-server --test multiview_fixtures \
  fixture_http_source_cas_dedupe_media_custody_and_retirement \
  -- --ignored --exact --test-threads=1
```

A separate bounded steady-state media run is evidence only for its selected-source
interval. Startup, switching, full-film lifetime, native UI/RPC and hardware
playback require their own qualification. Keep failures as evidence rather than
relabelling them as successful playback.

## Activation gates

Before production registration, qualify request admission limits, server-owned
live input streaming/demuxing, checked Plex range access, Local file custody,
credential expiry, renewable output authority, complete provider/decoder retirement,
and native end-to-end playback. Fixture `from_root` custody is not a production
Library grant; frame-buffer limits do not bound FFmpeg RSS. No existing successful
fixture or favorite digest grants permission to enable production capacity.
