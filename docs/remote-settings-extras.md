# Remaining interface and diagnostic preferences

These settings use the same typed `player_settings` protocol as ordinary preferences. Read a setting before writing it; the CLI carries its runtime, source and revision receipt into the write. Existing parental and kiosk restrictions still apply. The exact `notificationsEnabled` preference follows the existing notification-control policy, including kiosk mode.

| Setting | Values | Scope and application |
| --- | --- | --- |
| `notificationsEnabled` | `0` off, `1` on (default) | Application; applies the text and image receiver immediately |
| `noSelProv` | `0` show, `1` hide | Application; reload after the acknowledgement |
| `noProvParam` | `0` show, `1` hide | Application; reload after the acknowledgement |
| `localMediaEndpoint` | HTTP(S) URL or empty string | Browser media library; next library read |
| `debugEnabled` | `0` off, `1` on | Persistent playback debug collector |
| `debugHud` | `0` hidden, `1` visible | Persistent HUD preference; requires the collector |
| `sortAlphabetically` | `0` provider order, `1` alphabetical | Current provider's channel lists |

```sh
ott t1 setting noSelProv 0
ott t1 setting noProvParam 0
ott t1 setting localMediaEndpoint --value-file /absolute/private/media-library-url.txt
ott t1 setting debugEnabled 1
ott t1 setting debugHud 0
ott t1 setting debugEnabled 0
ott t1 setting sortAlphabetically 1
```

Visibility settings use the existing PIN policy and checkpoint current playback before their acknowledged reload. A successful save invalidates an older local confirmation, so it cannot silently reverse a newer remote change. Reload happens only after the response is acknowledged and the saved value, source and authorization still match. Retrying an acknowledgement does not reload twice.

The browser library URL is private: reads and acknowledgements redact it. Its existing owner validates the URL and invalidates its cached catalogue after verified storage. Saving does not scan folders, open a permission prompt, activate the local provider or start playback. An already-open local URL editor becomes stale after the remote save.

On Tauri and native Capacitor players, the browser library URL does not control native file access. Its descriptor reports `local_action_required`. Use the device's existing local-library picker and permission workflow. Remote configuration cannot manufacture a filesystem grant.

The collector and HUD are separate preferences. Turning on the collector preserves the saved HUD choice. Changing the HUD while the collector is off stores the choice and reports deferred application; enable the collector to display it. Disabling the collector invokes its normal cleanup, including active diagnostic subscriptions.

Alphabetical ordering is saved under the current provider's storage scope. Switching provider while a request is being saved rejects the stale request. The next provider's ordering is not changed.

## Platform boundaries

- `autorun` has no supported operating-system startup owner in this player. Its descriptor is unavailable for remote writes. A compatibility helper now prefers the registered `sAutorun` key and reads the old `stb_autorun` key only when the new key is absent. That helper can initialize a player; it does not install an OS startup task.
- `hdmiSupport` has no corresponding HDMI apply implementation in this build and is unavailable for remote writes.
- Native file selection and filesystem permission grants remain local actions. Existing connected-source/profile operations remain available where advertised.

## Troubleshooting

A revision conflict means another setting owner changed the value or scope. Read it again instead of replaying the old receipt. A storage failure produces no owner effect. If storage succeeds but an owner effect fails, the result explicitly reports a saved value with `effect_failed`; inspect the current value before retrying.

If a field is missing, update the matching player, controller and CLI. Static and offline packages must include the matching optional settings assets. See [typed settings](remote-player-settings.md) and [provider settings and Plex folders](remote-provider-settings.md).

The notification preference uses the receiver's revision as well as saved bytes. Even a same-value legacy/local setter invalidates an older typed receipt, so an interrupted experiment cannot undo a newer decision. See [bounded performance capture](performance-capture.md).
