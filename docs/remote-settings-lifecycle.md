# Remote language and connection settings

The typed settings API uses the real language, command-server, local HTTP and SWOP owners. These fields advertise `apply: "after_ack"`. Saving first commits a verified desired configuration; the player applies it only after the control server acknowledges the result. Normal kiosk and PIN policy still applies.

## Interface language

```sh
ott t1 setting ottplaylang _eng
ott t1 setting ottplaylangmode system
ott t1 setting ottplaylangmode manual
```

`ottplaylang` accepts a packaged language ID from the schema and selects manual mode. `ottplaylangmode system` resolves the device language and saves that language with system mode. The owner loads the actual dictionary and updates language/direction metadata. Existing text is refreshed through its normal UI redraws; playback is not restarted. A failed dictionary load restores the previous selection and dictionary.

## Atomic connection changes

The `player_settings_patch` version 1 capability advertises two groups, each with at most three fields:

- `command_server`: `commandServerAddress` (string), `commandServerToken` (string), `commandServerEnabled` (integer `0` or `1`).
- `local_http`: `localCmdUrl` (string), `localHttpDeviceCode` (string), `localHttpEnabled` (integer `0` or `1`).

A patch can change one or several fields, but its revision always binds all three. The final tuple must be valid. Do not use JSON booleans for the integer toggles. A token/device code is 32–256 letters, digits, underscores or hyphens. A browser served over HTTPS cannot connect to an HTTP endpoint. A native local HTTP listener can operate without a polling URL; a browser needs a valid URL when local HTTP control is enabled.

Read a group before changing it:

```sh
ott t1 settings patch command_server
ott t1 settings patch local_http
```

Create a private JSON file with only the values to change. For a command-server migration its contents might be:

```json
{
  "commandServerAddress": "https://control.example/api/webhook/commands?device_id=example-player",
  "commandServerToken": "REPLACE_WITH_THE_NEW_DEVICE_TOKEN",
  "commandServerEnabled": 1
}
```

```sh
chmod 600 /absolute/private/connection.json
ott t1 settings patch command_server --value-file /absolute/private/connection.json
```

The example token is a placeholder; provision the new server/device before requesting a migration. Keep credentials out of command-line arguments. Group reads redact addresses and credentials, returning only whether each is configured. The group revision is opaque and expires after 120 seconds; a changed companion field invalidates it even if that field was omitted from the patch.

Scalar enable/disable commands still work:

```sh
ott t1 setting commandServerEnabled 0
ott t1 setting localHttpEnabled 0
```

Disabling the command server intentionally disconnects remote control after acknowledgment. To enable it again, use another working control path or the local player UI. Changing an active group's address or credentials with a scalar command returns `atomic_patch_required`; use its group patch so related fields cannot be split across disconnected requests.

## Observe the outcome

A changed patch reports `persisted: true`, `changed: true`, `application: {"state":"deferred","reason":"after_ack"}` and transition `pending`. This confirms durable desired settings, not a successful new connection. Read the group again to inspect its transition:

- `applied`: the real owner completed. A command-server handover requires a successful authenticated response from the new server generation.
- `rolled_back`: the handover failed and the previous configuration was restored through its owner. The bounded reason explains the failure, such as `authorization_failed` or `handshake_timeout`.
- `failed`: restoration or application could not be confirmed, or a newer local change superseded this request. Read current state before retrying.

An unchanged tuple is still verified and persisted. If the actual owner already has that configuration ready, the reply reports `changed: false`, completed application and transition `applied` without reconnecting. Otherwise it reports `changed: false`, deferred application and transition `pending`, then reconnects after acknowledgment. Saved equality alone never proves a live connection. Use the connection diagnostics to check the live transport. Another write to a pending group is rejected with `revision_conflict`.

Command-server handshakes have a 30-second limit. Missing acknowledgment on a running page rolls back the saved intent after 120 seconds. Startup reconciles a still-owned pending transition, including a crash between persistence and acknowledgment. Rollback never overwrites a newer tuple. Temporary rollback records live in the same installation storage as connection credentials; they are excluded from portable settings exports and replaced by a sanitized outcome after completion. Diagnostic operation records never contain their previous/desired values.

## SWOP and device identity

`swopBaseUrl` and `deviceUuid` use the scalar file-value workflow:

```sh
ott t1 setting swopBaseUrl --value-file /absolute/private/swop-url.txt
ott t1 setting deviceUuid --value-file /absolute/private/device-id.txt
```

After acknowledgment the owner retires an existing SWOP session. Identity changes update and verify the runtime UUID and both durable identity aliases. The configured SWOP URL is used by subsequent sessions. An installation's `/local/swop.json` remains a provisioning override on startup; update that file too if it intentionally supplies a different URL or identity.

## Troubleshooting

- **`atomic_patch_required`:** place the related values in one private JSON file and use the advertised group.
- **`revision_conflict`:** refresh the group; wait for a pending transition to finish before a new write.
- **`authorization_failed`:** provision the exact device token on the destination before retrying. The previous route is restored when its configuration is still owned.
- **`handshake_timeout`:** verify destination routing, TLS and browser origin policy. A saved address alone does not prove connectivity.
- **`storage_failed`:** inspect installation storage availability. A native listener or UUID alias that cannot be verified is not reported as applied.
- **Optional module unavailable:** deploy `dist/remote-settings-lifecycle.js` from the same build as `player.js` and `remote-settings.js`. Web, Tauri and Capacitor distributions must include it.

The machine-readable contract is [the shared patch fixture](../tests/fixtures/remote/player-settings-patch-v1.json). See [typed remote settings](remote-player-settings.md) for ordinary preferences and source-bound revisions.
