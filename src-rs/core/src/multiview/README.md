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

## Local pre-push checks

Before pushing new or changed JSON, use Node 22 and the existing lockfile-installed
npm dependencies to run `npm run lint` from the repository root. This runs both the
whole-project Biome check and the separate source-correctness check. Rust tests do
not cover JSON formatting. After a formatting-only change, verify that parsed old
and new JSON are equivalent, rejecting duplicate keys and non-finite values;
array order and value types must remain unchanged.

For JavaScript, workflow or portable-fixture changes, reuse the existing targeted
gate rather than creating another check runner:

```sh
PYTHON=/path/to/python3.12 npm run check:windows-readiness -- \
  --report-dir /absolute/fresh/report-directory
```

Use the existing hash-locked Python workflow dependencies and installed Playwright
Chromium. The default includes a JavaScript build, delayed-PIN cases and the
headless direct-media fixture. For unrelated changes only, `--skip-browser` runs
the portable checks and records that narrower scope. Neither mode compiles native
code or launches an installed player. Run against the admitted commit and retain
its passing receipt with matching `head`, `dirty: false` and
`sourceUnchanged: true`; changes after that check require revalidation. Local
portable results do not replace actual Windows/Linux/macOS or device qualification.

## Ordinary tests

From the repository root, with the existing locked workspace dependencies:

```sh
cargo test --locked -p ottplay-core multiview::
cargo test --locked -p ottplay-server --test multiview_fixtures
cargo test --locked -p ottplay-server --test multiview_broker_boundary
```

The pre-publication isolated harness passed 129 tests and left three media/lifecycle
tests ignored. It imported the actual source modules and used dependency versions
from the root lockfile; this is not full-workspace, all-platform or device
qualification. Normal Cargo integration-test discovery includes both server test
files. Windows jobs alone do not exercise the Linux/macOS encoder implementation.

## Explicit media and process fixtures

The three opt-in tests in `src-rs/server/tests/multiview_fixtures.rs` cover finite media
composition, owned-worker cancellation/cleanup, and authenticated in-memory HLS
source replacement/retirement. They are not counted in the 129 executed tests.

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

## Scoped Unix CI

Relevant multiview, dependency and qualification-workflow changes select hosted
Linux/macOS checks; a complete unrelated diff skips that matrix. An unknown or
incomplete diff cannot silently skip it. These checks run the actual ordinary
core multiview and server fixture suites, require the cleanup/lease/plan regression
names, then execute the three existing opt-in fixtures individually.

Both FFmpeg tools must expose input `fd`, and the required codecs and filters must
be present. Receipts bind source, lockfile, tool and test-binary hashes and retain
test logs and owned-process cleanup results. A missing capability or incomplete
cleanup fails qualification. These are fixture checks, not sustained-playback,
private-v1/native-client or TV acceptance.
