# Temporary performance capture

Performance capture is off by default. Start a bounded session to investigate a
freeze without enabling the debug HUD or changing playback. The player uses its
existing enabled remote-control connection. Update the player, controller and
CLI together; the separate `perf_capture` version 1 capability advertises support.

```sh
ott f perf status
ott f perf start
ott f perf start --duration 180 --raf
```

Start prints a session ID. The default duration is 120 seconds; the supported
range is 10–600 seconds. Long Tasks observations are requested by default where
supported; `--no-long-tasks` disables them. Animation-frame observations require
`--raf`. Replace the example ID below with the printed value:

```sh
ott f perf status --session aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
ott f perf read aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --after 0 --limit 64 --json
ott f perf stop aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
ott -t 90 f perf export aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --out ./freeze-01
```

A repeated start with the same ID and normalized options returns that session;
it never renews its deadline or restarts a stopped session. A conflicting active
session returns `busy`. Status, capabilities, reads and ordinary debug snapshots
do not start instrumentation. The implementation loads from the versioned
`dist/perf-capture.js` asset; static, native and offline packages must include it.

## Bounded collection and cleanup

Samples run at 1 Hz. The event budget is 20 per second with a burst of 40. The
ring holds at most 1,024 events and 512 KiB, with 2,048 bytes per event and room
reserved for the terminal event. Sequence numbers also advance for dropped
events. Reports distinguish rate drops, overwritten ring entries and oversized
records. A read returns at most 64 events and packs them within 60 KiB of data,
leaving room for the 64 KiB response envelope.

Stop, expiry and page hiding remove sampling timers, media/HLS listeners,
observers and animation callbacks. Stopped evidence remains available for five
minutes; its cleanup timer does not sample. Connection/configuration/runtime
retirement discards evidence. Changing media or replacing HLS continues the same
capture, assigns a fresh local source label and records the change. This does
not restart playback or extend the capture deadline.

The diagnostic-only scheduling loop runs only within this lease. Outside it,
ordinary debug snapshots omit scheduling metrics. Existing passive error/media
history and the player's functional playback watchdogs remain independent.

## Interpreting the evidence

Every event includes a session-relative timestamp and, where available, main or
PiP lane, playback generation, decoder handle and local source label. Labels are
session-local counters, not hashes of media URLs. Event data excludes URLs,
credentials, notification text, image content, arbitrary error messages and
Long Tasks attribution. The bounded buffers remain in memory until explicitly
exported through remote control.

- Samples include position, playback rate, readiness, dimensions, nullable frame
  counters, current/retired engine attempts and up to eight adjacent buffer
  ranges. Contiguous buffer ends at the current range; a later range across a
  gap does not count as playable seconds.
- HLS fragment and part statistics come from their actual owners. Separate
  `fragment_buffered` events report final append/buffer timing. Timing values
  reflect observed HLS timestamps; event arrival time is not substituted for
  network or append duration. HTTP status is nullable, and error detail uses a
  fixed allowlist. Unknown detail is `other`.
- Animation callbacks and Long Tasks are interval aggregates. Unsupported or
  unrequested measurements are null. A nondecreasing wall-clock fallback is
  labelled explicitly; durations crossing a clock rollback or its recovery
  remain unavailable.
- Notification events cover received, DOM creation, media fetch/receipt, image
  load, shown, updated, hidden and dropped. Duplicate delivery is a local drop,
  not proof of server coalescing. Client queueing and server coalescing are not
  observable and are absent from supported stages.
- Fetch, base64 conversion, JPEG validation, Blob creation and combined image
  load/decode have separate observed timing fields. Isolated image decoding and
  opaque server queue time remain null. The collector does not call `decode()`
  or add rendering work. Image metadata remains bounded to 640×360 and 163,840
  bytes; bytes and images themselves are never included.

An API reporting zero frames is still a measured API value. It does not prove
smooth playback, visible pixels or a working frame counter. Require observed
counter advancement and matching identity before using it as progress evidence.
The kiosk `video_progress` owner stops evaluating before reading frame APIs when
contiguous buffer is below two seconds, and also gates on visibility, focus,
readiness and seeking. It can therefore report `unavailable` while ordinary
debug/performance frame APIs report zero, without proving a platform stub.

A notification near a stall establishes timing, not causality. Compare matched
source/generation windows; exclude seeking, initial settling, source replacement
and incomplete/dropped evidence. A freeze that persists with notifications off
requires investigation of network delivery, playlists, buffering and decoding.

## Notification A–B–A trial

```sh
ott f setting notificationsEnabled
ott f setting notificationsEnabled 0
ott f setting notificationsEnabled 1
ott -t 240 f perf trial notifications --out ./notifications-trial-01
```

The integer preference is installation-wide: 0 disables both text and camera
banners; 1 enables them. It uses the existing notification-control policy,
including kiosk mode. Other protected settings retain their normal PIN/kiosk
rules. Typed writes verify persistence before applying the real receiver.

A–B–A uses the original policy, its opposite and the original again. Restoration
uses the exact typed revision produced by the experiment. Every receiver setter,
including a same-value legacy/local setter, invalidates older revisions. If an
external actor intervenes, the experiment reports a conflict instead of
reversing that actor's decision. Restoring an originally absent default may
persist explicit `1`; that restores policy, not the original storage bytes.

## Troubleshooting and verification

If support is missing, compare player/controller versions and verify the optional
asset is packaged. A loading timeout does not start a partial session. A lost
start acknowledgement should be investigated using the same session ID and
status, not by extending the capture repeatedly. Export before the five-minute
retention deadline or a reconnect. Treat dropped records or a source change as
limits on the conclusion.

```sh
node tests/test_perf_capture.cjs
node tests/test_perf_loading.cjs
node tests/test_runtime_debug.cjs
node tests/test_remote_notifications.cjs
node tests/test_notification_media.cjs
node tests/test_remote_settings_extras.cjs
```

The shared wire fixture is `tests/fixtures/remote/perf-capture-v1.json`. See also
[runtime debug](runtime-debug.md), [typed settings](remote-player-settings.md)
and [notification presentation](remote-notifications.md).
