# Remote diagnostics

A connected player can grant a scoped operator access to structured playback,
network, input and EPG observations and two typed repair actions. Diagnostic protocol 2 uses the
existing outbound HTTPS connection to the command server; it opens no listener
on the player. Existing protocol 1 commands and repairs remain compatible.

## Enable and inspect

1. Configure the command server's diagnostic operator and enable diagnostics for
   the exact device in its configuration. Use the control server's diagnostic
   configuration documentation. Operator credentials are separate from both the
   legacy administrator credential and the player's device access code.
2. In the player, open **Settings → Remote control**, connect to an HTTPS command
   server, then select **Allow diagnostics for 10 minutes** for a temporary grant,
   or **Trust this server for remote support** for unattended support after
   reconnecting or restarting. Both choices also authorize stream/player restart
   requests from operators with the separate repair scope. Merely opening
   settings, connecting, querying status or restoring a backup grants no access.
3. Use `ott diagnostics --help` in the control-server repository, or configure
   `cli/diagnostics_mcp.py` as a stdio MCP server. List runtimes for an explicit
   device. Select its exact `runtime_id`, `consent.epoch` and `server_epoch`.
   Start a session with an explicit idempotency key, then inspect session state
   and page through events. A start receipt means queued; `active` confirms that
   the player applied the start.
4. Use **Stop current capture** to finish a capture while preserving trusted
   support, or **Stop diagnostics** / **Disable trusted remote support** to
   revoke support. The visible indicator also revokes support. Request a
   stop through the operator API. `device_stop_confirmed` distinguishes a
   completed device stop from a queued stop or revoked server credential.

In locked kiosk mode, clicking the diagnostic indicator or pressing the remote's
**STOP** key revokes support while leaving the kiosk's channel policy locked.
The indicator remains available while trusted support is suspended offline, so
touch-only devices can also remove saved permission without a network connection.
These controls remain available even though ordinary menu/navigation input is
blocked. Stopping support also cancels pending diagnostic repair work.

The temporary grant is in memory for the current foreground page. Hiding, freezing or
leaving the page, losing connectivity, changing/disconnecting its saved
controller, disabling the local logger, an authentication failure, or the
ten-minute limit ends access. Enable again on the player for a fresh grant.
Trusted support saves a binding to the exact HTTPS controller and device
credential in a separate device-local IndexedDB database, outside portable/cloud
settings. It does not persist runtime credentials, active captures or repair
commands. Each reconnect creates a fresh runtime and consent epoch; an operator
must issue a new action. Collection and repairs stop while hidden/offline;
registration resumes with bounded backoff after recovery. Changing controller
credentials, disconnecting it in settings, or explicitly revoking support clears
trust. Devices without usable IndexedDB retain the temporary mode. Storage errors
are displayed, including when durable revocation cannot be completed.
If removal fails, capture and repairs stop immediately, but the visible indicator
retains the storage error and a retry action until the saved permission is
successfully removed. This also works in locked kiosk mode. Resolve that error
before restarting the player: a failed deletion may leave the old permission on
the device.

There is no remote action that grants local consent. The existing local HUD has
independent ownership: a remote session ending does not disable a HUD enabled
locally. `window.__ottDebug.disable()` stops all logger consumers and removes
instrumentation; `enable()` enables local diagnostics.

## What is observed

- Playback state and finite media counters: position, buffer ahead, dimensions,
  dropped frames, stalls, waiting, error/recovery counts and media error codes.
- Observed HLS fragment byte/latency counters and HTTP error status, with late
  attachment to an already-running HLS instance.
- LG input delivery counts and optional producer-owned EPG availability. These
  are advertised only when their snapshot adapter is available; a missing
  observation is not represented as a measured zero.

The remote event schema excludes URLs, provider/account configuration, headers,
credentials, key text, coordinates, raw console lines, stacks, DOM and images.
Remote screenshots are a separate, locally granted protocol-1 command, described
in [Remote screenshots](remote-command-server.md#remote-screenshots). Trusting a
server for diagnostic telemetry never grants screenshots, and screenshot images
are not diagnostic events or attachments.
Collection and server retention have independent byte/event/rate bounds, and
readers receive sequence gaps and drop counters. Diagnostic delivery uses a
separate control loop and upload lane, so a pending legacy command or upload
cannot block an ordinary remote stop. A ten-second connectivity lease stops
capture if successful control polls cease. A blocked JS event loop can delay
local timers; no browser-side agent can guarantee stop latency in that case.

Each registration receives its own server-issued credential kept in that
runtime's memory. Two tabs sharing the same configured device credential remain
separate diagnostic targets, even with identical metadata. Runtime IDs and
reported UUIDs are selectors, not authentication. Process restarts invalidate
old credentials and operator mutations require the discovered server epoch.

## Repair and platform coverage

Existing `ott PLAYER restart stream`, `ott PLAYER restart player`, profile and
playback commands remain the typed repair interface. They use the existing
protocol 1 device queue. Diagnostic runtime selection does not make that legacy
queue tab-specific: avoid sharing a command credential across independent
players when applying repairs. An unknown mutation result is not permission to
blindly repeat it.

For exact runtime targeting use `ott diagnostics repair` or the MCP tool
`diagnostics_repair`, with `restart_stream` or `reload_player`. The runtime must
advertise `repairs`; the operator needs `repairs.start` and `repairs.read` to inspect
the receipt with `diagnostics_repair_status`. Every request names its runtime,
consent epoch, server epoch, idempotency key and a deadline of at most 30 seconds.
The existing owned-backend and parental guards still apply. Stream restart
`applied` means the effect was invoked, not that playback recovered. Player reload
is dispatched only after its `accepted` result reaches the server and the exact
ACK reaches the still-authorized client. That receipt does not prove a completed
reload; rediscover the new runtime and inspect new observations. A newer repair
can supersede an older unacknowledged intent. Unknown outcomes must not be
blindly repeated, even after a receipt expires.

The MCP adapter exposes discovery, capture, status, events, stop, revocation
and these two repairs. It has no arbitrary JavaScript execution,
shell, native invocation, file access or general HTTP request tool.

Browser, LG webOS, Tauri and Capacitor use the same frontend diagnostic lifecycle.
Native platforms reuse their existing protected HTTP bridge. Native decoders,
Rust server internals and OS logs require separate platform-specific producers;
this frontend feature does not claim to inspect or repair them. Older WebViews
without the required monotonic clock or secure transport report unavailable.
Local Chrome DevTools, webOS inspection and native debugging remain useful for
those deeper cases.

Runtime instance labels include a bounded platform/build prefix to distinguish
browser, webOS, Tauri and Capacitor instances without sending raw user agents,
device names or URLs. Labels are informational; server-issued runtime credentials
remain the authority.

## Verification and operation

`npm run test:diagnostics` exercises the real logger, LG input lifecycle, bounded
buffer, transport and local consent controller with deterministic clocks and
synthetic transports. Existing redaction, settings navigation, transport and
bundle tests remain enabled. All diagnostic code must also pass ES5 output,
localization, type, lint and measured bundle-size checks.

Cross-repository acceptance uses actual Go, HTTPS with a temporary trusted test
CA, the production TS secure transport, two runtimes, Python CLI and stdio MCP:

```sh
OTT_CONTROL_BINARY=/absolute/path/to/ottplay-control-server \
OTT_DIAGNOSTICS_CLI=/absolute/path/to/control/cli/diagnostics.py \
node scripts/smoke-diagnostics.cjs
```

This test has no real provider, installed player or persistent user credential.
It includes exact-runtime stream/reload repairs and lost result acknowledgements.
The required CI workflow runs both cross-repository smoke tests against a pinned
control-server commit. Chromium acceptance tests exercise the production bundle,
real IndexedDB permission, settings navigation, reload and offline recovery.
Run the existing `scripts/smoke-remote-cli.cjs` separately to verify legacy repairs.
Deterministic tests and builds do not substitute for hardware-specific release
canaries. Record the exact app/server versions and platform for each such run.
Deploy server support before exposing the player feature; diagnostics defaults
to disabled. Disabling the per-device server setting and restarting the server
revokes runtime credentials. Older server builds leave protocol 1 operational,
while the diagnostic client stops and reports that a new grant is required.
