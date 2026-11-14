# Experimental multiview foundation

This is gated source infrastructure, not a delivered player feature. The default
server does not expose a private multiview listener. Explicit experimental operator
configuration can register the isolated private router; see the broker runbook
for the listener and authorization restrictions. Production capabilities remain
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

When adding or renaming Python tests, run
`python3 scripts/test-python.py --check-inventory` from the repository root before
pushing. It checks exact suite registration without executing tests or writing
reports; a passing inventory check is not test-execution evidence.

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

The initial pre-publication isolated harness passed 129 tests and left three
media/lifecycle tests ignored. These are historical counts, not the current test
inventory; the current compiler listing and receipts determine which tests ran. It imported the actual source modules and used dependency versions
from the root lockfile; this is not full-workspace, all-platform or device
qualification. Normal Cargo integration-test discovery includes both server test
files. Windows jobs alone do not exercise the Linux/macOS encoder implementation.

## Explicit media and process fixtures

The five opt-in tests in `src-rs/server/tests/multiview_fixtures.rs` cover finite
media composition, owned-worker cancellation/cleanup, authenticated in-memory HLS
source replacement/retirement, and bounded streamed-session continuity with two
audio owners, plus real streamed-decoder short-track completion and subsequent
failure, revocation and cancellation. They run separately from the ordinary tests.

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

The decoder fixture additionally requires `OTTPLAY_MULTIVIEW_PENDING_INPUTS`
(an immutable two-input manifest with SHA-256 hashes, 96×64/10 FPS geometry and
exact audio/video counts) and a fresh `OTTPLAY_MULTIVIEW_PENDING_CASE_DIR`.
Its command-local private `TMPDIR` must contain a space, apostrophe, colon and
backslash to exercise filter-path escaping. The Unix CI helper generates these
synthetic inputs and supplies the environment. See
[`streamed_decoder.rs`](../../../server/tests/support/streamed_decoder.rs)
for the manifest schema and complete prerequisites. Invoke the exact entry with
`--ignored --exact --test-threads=1`, as above, using
`streamed_decoder_short_track_pending_and_failure` as the test name.

The decoder fixture uses generated 48 kHz stereo TS inputs with short audio and
short video in turn. A validated per-track terminal watermark can permit trailing
silence or an ended-video slate while its sibling continues. This is provisional
terminal state, not proof of clean source EOF or permission to retire custody.
Later decoder failure, cancellation or revocation invalidates that state. Positive
cases require successful owned-process completion and input-pump completion;
negative cases verify late failure, revocation and cancellation. These fixtures do
not qualify every resampler or variable-frame-rate source.

## Capture-time output scheduling

Persistent Session uses a common wall-capture clock for audio/video output. The
compositor freezes source views before recording `captured_at`; a newly captured
image cannot be assigned to an earlier output tick. Complete-write counters,
limited catch-up and bounded reuse of an earlier committed image preserve encoded
output time. A bounded three-target window retains eligible captures for the
current output tick and the next two ticks, rather than discarding all intermediate
captures while one image waits for a delayed writer. Each target uses a capture
whose timestamp is no later than that target. The current bucket remains leased
through a partial write; the window advances only after the full frame write has
completed and the previous committed reference has been replaced. Captured images
may remain eligible for two rational video periods,
including naturally sparse 1–4 FPS output. A committed image can be reused for at
most two ticks. Physical writes and pacer debt retain the stricter minimum of two
video periods, 200 ms and the configured stall limit; excess pressure terminates
that output. Each image retains its first visual-invalidation boundary even across
several rapid source changes. Nonvisual focus/audio changes preserve
an otherwise valid in-flight image with its original capture timestamp and visual
owner. Visual changes still invalidate it at their recorded boundary.
Static pictures are valid content and are not identified as scheduler repetitions
by pixel equality. This is a capture-time contract, not reconstruction of unknown
input PTS or file audio/video offsets.

Startup uses only source-free black video and silent audio with equal encoded
pre-roll duration. Their indices continue into the shared epoch. A one-way
initialization phase continues synthetic output until FFmpeg reports closed HLS
output and encoding progress; accepting bytes into an OS pipe alone is not
readiness. Source audio remains inactive until the atomic transition to steady
scheduling. Constructor success also requires complete steady writes from both
lanes. Initialization keeps the configured absolute startup deadline; it cannot
be re-entered after steady operation. The compositor starts before encoder
readiness; failed startup stops and joins it. Existing
standalone legacy encoder constructors retain their previous scheduling path.

Session reserves six output canvases, per-source storage and the existing small
buffer allowance within its configured frame-buffer cap. Transition black frames
use fixed-size zero chunks. This reservation does not bound FFmpeg RSS, operating
system pipe buffers or total process memory. Source and media fixture qualification
remains separate from source-level scheduler tests.

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
names, then execute the five opt-in fixtures individually. They also execute the
complete broker boundary target and listener namespace, plus ordinary activation
tests for the explicitly configured private listener.

Both FFmpeg tools must expose input `fd`, and the required codecs and filters must
be present. Receipts bind source, lockfile, tool and test-binary hashes and retain
test logs and owned-process cleanup results. A missing capability or incomplete
cleanup fails qualification. The streamed fixture checks a finite selected-owner
interval, including motion, timestamps, every-50-ms audio energy/phase and the
return-audio tail. It does not establish full-film lifetime, private-v1/native-client
or TV acceptance.

Encoder diagnostics retain the first terminal error together with a closed failure
site and originating lane. If one lane forwards a failure from another, its
original site and lane remain intact. This records the first globally latched
terminal failure, not necessarily the earliest detection by wall-clock time.
Existing error getters retain their behavior; the detailed getters are read-only
and do not change snapshots or the wire protocol. The streamed fixture records
only these closed labels and its existing safe counters before cleanup.

For a selection-age failure, bounded numeric evidence records the selected
capture, retained buckets, committed sequence and most recent feed publication
attempt relative to the failing target. These are observations, not permission
to reuse an expired frame. The publication attempt covers only calls reaching
the feed mutex; it does not measure compositor work or calls rejected earlier
by the state barrier. The last-capture field may also be a visual-invalidation boundary, not a
publication attempt. Absolute clock instants and source data are not exposed.
RGB ownership conversion completes before the session control mutex is acquired;
the visual fence is still checked while publishing under that mutex.
