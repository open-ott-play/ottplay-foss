# Device resources and playback failures

The browser, OTT server frontend, Tauri and Capacitor share the playback policy.
Hardware transports retain their own capabilities. These changes do not add a
second player engine or a second retry controller.

## Android memory classification

The Capacitor client requests one optional native resource snapshot while the
interface starts. Playback does not wait for the result. The response is accepted
only within 1.5 seconds; a late response, navigation, bridge error or malformed
response leaves the existing browser policy in place.

The existing low-memory profile is selected when Android reports a low-RAM
device, or total physical memory is at most 2 GiB. Older installed APKs can supply
total memory without the newer low-RAM flag. A native high-memory result never
overrides a more conservative browser hint. Temporary system memory pressure is
not treated as a permanent device classification.

The accepted hint affects the next normal engine construction. It does not
recreate a playing decoder, modify an active buffer or poll the device. Existing
user buffer settings, live/VOD distinctions, PiP limits and source-specific
policies still apply. Plain web clients and Tauri keep their existing policy.

## Explain a terminal playback failure

When the compact playback status displays **ERROR!**, press **INFO**, or activate
the status with a mouse or keyboard, to see the current failure explanation.
Messages distinguish unavailable content, a busy source, connection problems,
unsupported media, protected playback, sign-in requirements and quality limits.
They use known error categories, not raw server responses or media URLs.

The details window opens only on request. It does not add a footer row, reopen a
hidden footer or prevent the normal footer timeout. Actual playback progress
clears the error and closes its own details window; it does not close another
screen that has replaced it.

**Retry** is available only when the existing playback backend can restart the
same current live stream. It rechecks the source, session, decoder, pause,
standby, kiosk and parental-access state when activated. VOD/archive failures
can show an explanation without offering an unsupported restart. Selecting a
different channel or opening another source invalidates old retry actions.

## Local files on intermittent storage

The local-file watcher replenishes its two transient retry attempts only after
ten continuous seconds of observed healthy playback. Two seconds of video from
an unreliable network mount is no longer enough to renew the allowance.

This interval measures wall time. Accelerated playback cannot satisfy it early;
pauses, seeks, discontinuities and long gaps between observations break the
healthy interval. Source replacement and stop retire the old watcher. This does
not remount a disconnected SMB/AFP volume or bypass file access permissions.

## Verification

Focused checks exercise the production policies and engine wiring:

```sh
node tests/test_native_memory.cjs
node tests/test_buffer_policy.cjs
node tests/test_playback_failure_details.cjs
node tests/test_playback_feedback.cjs
node tests/test_port_engine_lifecycle.cjs
node tests/test_stream_policy.cjs
```

The memory fixture includes a response that is ready before the deadline but
whose callback runs after it, before the overdue timeout callback. The local-file
fixture covers short recovery, sustained recovery, accelerated playback, pause,
seek and a delayed timer. These deterministic checks are not physical-device
memory measurements or guarantees that every provider stream can be decoded.
