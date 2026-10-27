# Live stall recovery

An optional watchdog detects a previously playing main live stream whose media
clock stops advancing without a fatal error. It complements engine recovery and
does not replace it. Related proposal: [#854](https://github.com/open-ott-play/ottplay-foss/issues/854).

## Settings

In **Settings → Interface settings**, save **Live recovery attempts** (0–5) and
**Live stall timeout, s** (10, 15, 20 or 30). Defaults are **0 / disabled** and
15 seconds. The existing settings journal, profiles and backups own persistence.
Zero adds no watchdog interval or event subscriptions and preserves engine recovery.

After playback has advanced, the watchdog arms. A stall shows a non-modal OSD
after three seconds, then calls the existing main-video `backend.restart()` at
the configured deadline. OSD seconds come from the same watchdog state. The OSD
shows the attempt number and an exhausted-budget message, and hides on progress.
Decoder replacement does not renew the budget; ten continuous seconds of ready
playback progress do. A failed restart dispatch still consumes its attempt.

## Ownership and compatibility

Only the existing classic/core main-video transport is observed. Archive,
catch-up, VOD, stopped playback and stale channel/source generations are excluded.
Intentional pause, seeking, hidden/offline pages, kiosk and device A/V tests
suppress intervention. Channel changes start a fresh, initially unarmed observer.
The PiP lane is not monitored; native PiP hides the HTML OSD.

Pending or terminal core recovery takes precedence. Changes in core recovery
activity renew observation grace without replenishing the watchdog budget. The
watchdog does not bypass access-denied, DRM or other terminal decisions.

While countdown/restarting OSD is visible, playback-feedback yields presentation
only. Its deadline, expiry, retry ownership and pause behavior are retained.
Hiding the OSD restores its latest status. Exhaustion does not suppress terminal
engine feedback. No second recovery timer is introduced.

Startup that never reaches playback remains with the engine. A picture freeze
with an advancing media clock is outside this watchdog's detection scope. Timer
throttling/sleep and backwards media-time discontinuities receive fresh grace.

## Automated checks

```sh
npm run typecheck
node tests/test_live_recovery.cjs
node tests/test_playback_feedback.cjs
node tests/test_media_backend.cjs
node tests/test_stream_policy.cjs
node tests/test_port_engine_lifecycle.cjs
node tests/test_port_pause_intent.cjs
node tests/test_kiosk.cjs
node tests/test_settings_parity.cjs
node tests/test_localization_catalog.cjs
npm run lint
npm run build:server
node tests/test_classic_linker.cjs
node tests/test_classic_size.cjs
npm run check:test-inventory
```

The browser OSD case in `tests/browser/playback-runtime.spec.cjs` drives the
actual watchdog/OSD with isolated fixture samples and no IPTV account. A passing
headless browser run is not acceptance for a physical TV or hardware decoder.

## Manual device checks

Use a separate browser/device test build and the built-in demo. Enable recovery
with one or two attempts and a ten-second timeout. Wait for confirmed playback.
In that test tab only, freeze the media clock through DevTools:

```js
document.getElementById("video").playbackRate = 0;
```

Verify the OSD after three seconds, the configured restart deadline, bounded
attempts and exhaustion. Restore rate 1 and verify immediate OSD hiding plus
budget renewal only after ten continuous seconds of progress. Some devices do
not support rate 0; use an isolated media fixture on those devices instead.

Do not use `pause()` as a stall simulation. Verify that intentional pause,
archive/VOD, switching channels, native PiP and kiosk retain their behavior.
Test engine retry handoff, terminal failures, standby/wake and settings persistence
on the intended LG webOS firmware before claiming device acceptance.
