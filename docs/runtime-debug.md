# Runtime diagnostics across platforms

Use `ott PLAYER debug` (short form `dbg`) to inspect an enabled remote-control
connection. No temporary permission or separate debug switch is required on the
player. This is a read-only observation: it does not reload, repair, pause or
change the selected media. Install an updated controller/CLI and player; native
fields additionally require an updated native application.

```sh
ott l debug
ott a1 dbg --json
ott t1 debug --json
ott f10 bundle --out ./f10-case-001
ott report verify ./f10-case-001 --json
ott server debug --json
```

Replace aliases with your registered players. A bundle directory must not already
exist. `debug` uses the web command connection and includes the native producer
inside that observation; it does not require the separate Android maintenance
agent or `--lane native`. `doctor` remains useful for the loaded JavaScript build
identity and UI ownership. `ott PLAYER` lists debug when the player advertises it.

## Evidence collected

While remote control is enabled, a bounded in-memory ring retains the most recent
32 classified events: application error, unhandled rejection, visibility,
focus, connectivity, page suspension/resumption and media waiting/stall/error.
Error messages, stacks, filenames, URLs, console output, credentials and keyboard
input are excluded. `eventsDropped` reports overwritten entries; increasing
sequence numbers expose ordering. Disconnecting or changing the controller
credentials clears history and removes the timers/listeners. Reload loses this
history; save a bundle before requesting a restart.

A single one-second timer measures foreground JavaScript scheduling delay. Hidden
and page-suspended intervals are excluded; a delay of at least 250 ms records
`loop_delay`. Delay is an observation of scheduling, not proof of its cause.
Available JS heap estimates, CPU concurrency, connectivity and command
request/response backlog counters accompany it. Memory estimates are browser
specific, and a missing field means unavailable rather than zero.

Each available HTML video lane supplies bounded position, duration, buffered
seconds, dimensions, media error code, paused/ended/seeking state and frame
counters. `totalFrames` comes from VideoPlaybackQuality, while `decodedFrames`
comes from the WebKit-specific counter; they are distinct metrics. Main playback
generation and decoder handle help correlate observations. PiP does not borrow
main playback generation. Native overlays without an HTML video observation are
not represented as zero frames. Neither clock advancement nor frame counters
prove that the display changed or that audio was audible.

## Native applications

The on-demand `RuntimeDiagnostics.snapshot()` Capacitor plugin and Tauri's
`runtime_diagnostics` command return native app version, available OS/WebView
version, producer age and host-process metrics. JavaScript uses a 1.5-second
native deadline. A timeout preserves the web observation; only one unresolved
native call is retained. Late results cannot be attached to a replacement
connection or runtime. Tauri limits its command to the application's main window.

- Android, including the API 22 compatibility build: Java heap used/limit, PSS,
  total/available system memory, low-memory state, power saver, lifecycle state
  and supported WebView/thermal metadata. WebView package version needs API 26;
  thermal status needs API 29. Thermal values 0–6 mean none, light, moderate,
  severe, critical, emergency and shutdown.
- iOS: host RSS and physical footprint, total system memory, active CPUs,
  foreground scene, low-power mode and thermal state. Thermal values 0–3 mean
  nominal, fair, serious and critical. Producer elapsed time is exported with
  the declared required-reason API use; raw system boot uptime is not exported.
  An independent WebKit package version is unavailable.
- Tauri: native version, WebView version where available, producer age,
  foreground window, CPU count, cached EPG counts and existing native HLS session
  count. Host RSS/system memory are implemented on macOS and Linux. Other systems
  omit unavailable fields. Collection does not start a decoder or refresh EPG.

`uptimeMs` is the age of the diagnostic producer, not a claimed process start
instant. `residentBytes` is RSS, `pssBytes` is Android proportional memory and
`footprintBytes` is the iOS physical footprint. They are not interchangeable.
Host-process memory excludes separately running WebView renderer processes and
does not measure all GPU/video memory. A fully blocked JS event loop cannot
answer the remote command; use the separately provisioned Android agent or local
platform tools when that independent access is needed.

## Servers

`ott server debug` uses the control server's existing administrator credential.
It reports Go heap/goroutines, queue/result counts and bytes, and diagnostic
runtime/session/repair resource counts. Subsystems are sampled independently,
not atomically; retained expired entries remain counted until normal cleanup.
No device names, tokens, queued command parameters or configuration are exported.

The Rust OTTplay companion exposes `GET /debug/runtime`, using its existing
`OTTPLAY_DEBUG_TOKEN` bearer. Unlike log collection, this read-only endpoint does
not require `OTTPLAY_DEBUG=1` or `debug.enabled`. Existing log endpoints retain
those requirements. Example for a server configured with a trusted certificate:

```sh
curl --fail --silent --show-error \
  -H "Authorization: Bearer ${OTTPLAY_DEBUG_TOKEN}" \
  https://player-server.example/debug/runtime
```

The token remains local operator configuration; never put it in a URL or public
report. The response contains the server package version, producer age, supported
memory/CPU data and cached EPG counts. Busy cache locks cause fields to be omitted
instead of blocking the request. Responses disable caching; this endpoint does
not enable log capture or expose arbitrary files/processes.

## Compatibility and troubleshooting

A separate `debug: {version: 1}` capability leaves the original `inspect` section
list unchanged, so older CLI versions continue using their original commands.
The new read uses `inspect`, section `debug`, bound to the exact page runtime.
Old controllers/players report unsupported; restarting old binaries cannot add
the feature. A native `unsupported`, `unavailable`, `timeout` or `invalid` result
must not be interpreted as a measured zero or as permission to repeat repairs.

Bundles retain `manifest.json` and `result.json`; debug is an additional
observation in the versioned report. The new verifier still accepts supported
older reports. Integrity verification does not authenticate a report's origin
or establish physical playback. The report's UI/media observation and native
snapshot are sampled at different times; use their identities and timestamps
when comparing evidence.
