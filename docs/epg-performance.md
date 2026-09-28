# EPG performance and release acceptance

The standalone server must make programme data available promptly after a cold
start and keep repeated playlist requests independent of catalogue-index setup.
The browser and TV use the same M3U HTTP endpoints, so backend latency affects
both clients even when the web files are hosted separately.

## Regression and original intent

The architectural change shipped in v1.1.44, in
[PR #511](https://github.com/open-ott-play/ottplay-foss/pull/511)
(`900be00019b9d2de33a56b48b3eac399df9a5522`). It replaced separate guide rules with
the receipt-pinned Kotlin core compiled to ES5 and executed through QuickJS in
Rust. The goal was matching behaviour across browser, Android, iOS and Rust,
with one implementation and captured compatibility fixtures. It was not a Rust
EPG speed improvement. The Rust guide bridge is identical in v1.1.44 and v1.1.46.

Earlier migration measurements did detect extra CPU cost, but lacked blocking
performance budgets. Small synthetic feeds and a reused-index microbenchmark
did not represent the shipping musl image processing a large public feed and
rebuilding its VM/index on every HTTP request. Correct output alone was therefore
insufficient release evidence.

## Repeated request work

The old server copied all channels and rebuilt the matching index for every
channel/logo request, including a one-channel readiness probe. In the shared
implementation this also created a QuickJS runtime and evaluated the entire
core bundle. A programme query using `?ch=` repeated this work on an async worker.

The server now builds an immutable `EpgSnapshot` containing its cache and index
once per successful refresh. Requests retain an `Arc` to one coherent generation;
publishing the next generation is an atomic swap. Failed/panicking index builds
retain the previous generation. Matching does not hold the publication lock, and
CPU work runs on blocking workers. The same index serves typed and legacy text
matching, logos, and programme lookup by name. Existing standalone matching APIs
remain available for other clients.

Name/shift primitives and programme slicing also use that index's existing core
context. Otherwise a fresh blocking worker would still initialize its separate
thread-local scalar VM on its first request. Parallel API tests verify that the
indexed request paths leave that scalar slot uninitialized.

Refresh releases its reference to the previous generation on a blocking worker,
after releasing the publication lock. Freeing a large guide is substantial work
too, even when the new generation has already been built.

## Parser CPU work

Shared XMLTV date conversion formerly used general integer parsing on already
validated ASCII fields, then Kotlin/JS emulated `Long` division to produce decimal
timestamps. The shared core now uses direct validated decimal arithmetic and an
integer fast path where its range permits it. Unicode/legacy timestamp profiles
and far-date fallbacks remain covered by the existing contract fixtures.

An identity fast path also avoids copying already-trimmed titles/descriptions
through the Rust string callback. The Rust primitive remains authoritative for
values that either whitespace definition could change, including NEL and FEFF
edge cases. All Rust Unicode whitespace boundaries and mixed edges are tested.

The Rust adapter still owns XML decoding and transport; the shared core still
owns record rules. File reads are asynchronous, and decompression plus parsing
run on a blocking worker rather than blocking Tokio's request workers.

## Reproducible measurements

The investigation froze the public `https://cdn.epg.one/epg2.xml.gz` input:

- Decompressed bytes: 354,823,568.
- XML SHA-256: `8ee9536f39e2236fa5fb1d66ebcc5096a893539c3f3fc07bd6c9c17a1ad06b5e`.
- Parsed result: 3,247 channels and 565,973 programmes.
- Complete parsed-output fingerprint: `abec71663068b5a9`, identical for v1.1.43,
  v1.1.46 and the optimized parser in the local comparison.

Release-mode local macOS ARM measurements on the same frozen file found v1.1.43
parse time 0.595 seconds and v1.1.46 25.021 seconds. Independent repeated baseline
measurement was 32.855 seconds; the optimized shared parser measured 16.001
seconds. These are individual runs with ordinary host load, not a statistical
cross-platform benchmark. Do not compare them directly with Linux timings.

A separate alternating host/guard/guard/host comparison of the trim fast path
used one diagnostic executable and the same input. Host-callback runs took
17.010/16.254 seconds; guarded runs took 15.532/15.717 seconds. All four produced
the same complete output fingerprint. This is a modest additional saving,
not a replacement for removing VM/index setup from request handling.

The final local full-feed HTTP check loaded all programmes in 16.323 seconds.
Repeated РЕН ТВ matching had a 4.905 ms median (12.557 ms first request), matching
500 channels took 17.972 ms, and four concurrent РЕН ТВ requests finished within
7.821 ms. The earlier v1.1.46 HTTP run on this file took 24.754 seconds to load
and 110.574 ms median for РЕН ТВ matching. These are observed local timings;
shipping-container checks and target-node acceptance are separate requirements.

On the same `mp` Linux node, exact published images with local files and the same
2 CPU / 2 GiB limits loaded 3,247 channels plus 10,000 real programmes in 0.86
seconds (v1.1.43) and 50.65 seconds (v1.1.46). CPU quota throttling and memory
pressure did not account for the difference. This excludes source-download,
Cloudflare and browser latency from the reproduction.

The node is a VirtualBox VM with a Xeon E5-2690 v2 CPU model. Concurrent unrelated
video processing and substantial CPU pressure were observed during follow-up
tests. A full-feed candidate run exceeded a 180-second diagnostic bound there;
passing CI is therefore not sufficient evidence to replace the working v1.1.43
deployment. Same-node controls and complete programme readiness remain required.

Run a local parser/index benchmark with:

```sh
cargo run --locked --release -p ottplay-core --example epg_bench -- feed.xml match
```

The fingerprint is a lightweight deterministic output comparison, not an
authentication hash. Input provenance uses SHA-256 separately. Benchmarks must
hold the file, architecture, compiler profile and resource limits fixed.

## Linux musl allocator

The standalone musl server uses mimalloc, and rquickjs's supported `rust-alloc`
feature routes QuickJS allocations through the same Rust global allocator.
Other platform allocators are unchanged. No custom unsafe allocator is added.

One static QuickJS C probe, with identical code and 3,247 input rows, took
9.215/10.493 seconds to build the index using libc and 5.754/6.106 seconds using
mimalloc on `mp`. Its Zig-provided musl differs from the release toolchain, so
this establishes the mechanism rather than the shipping server's total gain.
Exact native-image controls additionally remove only the allocator wiring while
retaining the lockfile, source and build flags. The first clean 10,000-programme
pair took 56.53 seconds without the allocator change and 46.51 seconds with it;
process CPU differed much less (29.21 versus 27.50 seconds). Allocation helps,
but it does not restore the native v1.1.43 parser's cost.

## Blocking HTTP and container checks

```sh
cargo build --locked --release -p ottplay-server
python3 scripts/check-epg-performance.py --server target/release/ottplay-server
python3 scripts/check-epg-performance.py --image an-already-loaded-image
```

The offline fixture contains 3,247 channels and 100,000 programmes with diverse
dates, Cyrillic text, entities and CDATA. The check requires complete cold load,
real legacy channel/logo responses, programme JSON, and concurrent readers. It
measures first and repeated requests and enforces a 90-second cold-load budget
and 2-second request budget. Container runs use 2 CPU / 2 GiB, a read-only fixture,
an ephemeral loopback port, and automatic cleanup. `--feed` accepts a local,
decompressed XMLTV file; `--probe-name` defaults to РЕН ТВ HD.

CI runs the release binary check. Container validation and each native release
platform additionally import and verify the exact OCI image and run the same
acceptance check against it before publishing the native archive as a release
input. JSON evidence is retained even when a performance budget fails. Never use
an HTTP `/health` success alone as evidence that XMLTV has finished loading.
