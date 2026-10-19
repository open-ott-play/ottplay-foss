# Capacitor Android distribution and updates

`ottplay-foss` publishes the **Full Capacitor APK** alongside its web, desktop and
iOS artifacts. It contains the current shared interface, translations, provider
profiles, remote commands and native media bridges. Two APKs share the same Full
features, application ID, settings origin and signing certificate:

- `ottplay-foss-android-full.apk`: Capacitor 8, Android 7 / API 24 and newer.
- `ottplay-foss-android-api22.apk`: Capacitor 6.2.2, Android 5.1 / API 22 and
  newer, including Fire HD 8 (KFDOWI / Fire OS 5). Requires WebView 60 or newer.

Use the modern APK on newer devices. API 22 dependencies are isolated in
`android/compat/package-lock.json` and `android/compat/variables.gradle`; do not
lower the modern application's SDK or override library manifest checks.
Android 4.4 / API 19 still requires the separate legacy kiosk.

Provider and playlist text responses sent through the Android WebView bridge
are limited to 8 MiB. Larger responses fail with `response_too_large` and close
the connection; they are never truncated into a partial playlist or JSON object.
Use a smaller playlist or a paginated catalog if a source exceeds this limit.
Native media streaming and the separate native XMLTV index do not use this text
response path.

The independent Kotlin/Compose app and Play Store submission are maintained in
[ottplay-android](https://github.com/open-ott-play/ottplay-android). That app has a
different identity and does not replace a Capacitor installation in place.

## Optional startup as the Android Home app

The Capacitor app provides an optional `play.ott.foss/.HomeActivity` alias for
`MainActivity`. It is **disabled by default**. Enabling it and selecting OTTPlay
as the default Home app lets Android open the player when it starts its Home
screen. It also changes the **Home button**: Home returns to OTTPlay. This is
not a setting that launches OTT once and then keeps the manufacturer's launcher
as Home. A manufacturer's own boot-to-app option, when available and tested,
can be preferable for that behavior.

No boot receiver, foreground service, overlay permission, accessibility service
or device-owner enrollment is required for this Home mode. Android 10 and newer
restrict background activity launches; permission to receive `BOOT_COMPLETED`
does not by itself permit a receiver to bring the player to the foreground.
See Android's [Home app guidance](https://developer.android.com/work/dpc/dedicated-devices/cookbook#be-the-home-app),
[background activity restrictions](https://developer.android.com/about/versions/10/privacy/changes#background-activity-starts)
and [broadcast exceptions](https://developer.android.com/develop/background-work/background-tasks/broadcasts/broadcast-exceptions).

The commands below target an Android 11 device and its owner user, `0`. They
describe the feature and its verification procedure; **they are not a claim of
a successful hardware reboot test**. Vendor firmware can override Home behavior.
Record the device, APK version, default Home component and observed test results
when validating a particular installation. [Инструкция на русском](android-autostart-RU.md).

### Install and preserve the previous Home app

Use an APK containing the alias, signed with the same certificate as the
installed `play.ott.foss`. Older APKs do not contain this component. An ordinary
signed update preserves the application data, including profiles and remote
registration. Do not uninstall the player, clear its data or force a downgrade
to resolve an installation error.

Select the exact device from `adb devices -l`; never use an unqualified command
when more than one device is connected. The serial placeholder is not a device
address to copy unchanged.
If the device uses a separate ADB server, add its existing `-P PORT` option to
every `adb` command, including device discovery. Keep using the same server and
authorized keys.

```sh
adb devices -l
OTT_ADB_SERIAL='REPLACE_WITH_ADB_DEVICE_SERIAL'
adb -s "$OTT_ADB_SERIAL" install -r /path/to/ottplay-foss-android-full.apk
adb -s "$OTT_ADB_SERIAL" shell am get-current-user
adb -s "$OTT_ADB_SERIAL" shell cmd package resolve-activity --brief --user 0 \
  -a android.intent.action.MAIN -c android.intent.category.HOME
```

If the current user is not `0`, use the correct user in every command below.
Save the previous Home component from the resolver output in an operator record
outside the app and in `OTT_PREVIOUS_HOME`. Use the actual `package/activity`
component, not a guessed package name. If the result is a resolver/chooser or no
activity, establish a known working manufacturer Home choice first. Keep that
launcher installed and enabled.

```sh
OTT_PREVIOUS_HOME='REPLACE_WITH_RECORDED_HOME_COMPONENT'
```

### Enable and verify Home mode

```sh
adb -s "$OTT_ADB_SERIAL" shell pm enable --user 0 play.ott.foss/.HomeActivity
adb -s "$OTT_ADB_SERIAL" shell cmd package set-home-activity --user 0 \
  play.ott.foss/.HomeActivity
adb -s "$OTT_ADB_SERIAL" shell cmd package resolve-activity --brief --user 0 \
  -a android.intent.action.MAIN -c android.intent.category.HOME
adb -s "$OTT_ADB_SERIAL" shell am start --user 0 \
  -a android.intent.action.MAIN -c android.intent.category.HOME
```

The resolved Home component must be the OTTPlay alias, and the player must open.
If the firmware rejects `set-home-activity`, use its default-app/Home selector
and verify the resolver again. Stop if no supported selector accepts the app;
do not disable the manufacturer's launcher to force selection. The Android
[Home role](https://developer.android.com/reference/androidx/core/role/RoleManagerCompat#ROLE_HOME)
is the supported association. The manual `am start` above is only a preflight
check, not evidence that boot startup works.

Before rebooting, check the physical Home and Back buttons, return from another
app and normal launch from the app icon. Confirm there is one functioning
player session, with the existing profile, remote name and playback engine.
System settings and the previous launcher can be opened explicitly:

```sh
adb -s "$OTT_ADB_SERIAL" shell am start --user 0 -a android.settings.SETTINGS
adb -s "$OTT_ADB_SERIAL" shell am start --user 0 -n "$OTT_PREVIOUS_HOME"
```

The latter opens the old launcher without restoring it as the default.

### Verify startup on the actual device

1. Record the installed APK version, current Home resolution and uptime. Reboot
   the device normally, or use `adb -s "$OTT_ADB_SERIAL" reboot` while it is safe
   to interrupt playback.
2. After the device reconnects, inspect `sys.boot_completed`, uptime and the
   foreground activity. **Do not send `am start`, a Home key event or a remote
   launch command during this observation.** Those would invalidate the
   automatic-start test.
3. Confirm that OTT appears by itself, then that the existing remote registration
   reconnects when networking returns. Opening the app and starting a channel
   are separate checks: verify the intended playback behavior, audio and video
   progression instead of treating a splash screen as success.
4. Test a normal power-off/power-on cycle separately from standby/resume. A
   software reboot alone does not establish cold-start behavior on a projector.
5. Check a startup with delayed Wi-Fi availability and recovery when networking
   returns. Confirm that system settings remain reachable.
6. After a later signed APK update, recheck alias enablement, Home resolution,
   profile/remote settings and startup. Do not infer these results from the
   installer reporting success. Force-stop is not a substitute for a reboot test.

Useful read-only observations after reconnecting:

```sh
adb -s "$OTT_ADB_SERIAL" shell getprop sys.boot_completed
adb -s "$OTT_ADB_SERIAL" shell cat /proc/uptime
adb -s "$OTT_ADB_SERIAL" shell dumpsys activity activities
adb -s "$OTT_ADB_SERIAL" shell cmd package resolve-activity --brief --user 0 \
  -a android.intent.action.MAIN -c android.intent.category.HOME
```

### Restore the previous Home app

Restore the recorded Home choice first, then verify that it resolves correctly:

```sh
adb -s "$OTT_ADB_SERIAL" shell cmd package set-home-activity --user 0 \
  "$OTT_PREVIOUS_HOME"
adb -s "$OTT_ADB_SERIAL" shell cmd package resolve-activity --brief --user 0 \
  -a android.intent.action.MAIN -c android.intent.category.HOME
```

Only after the previous Home is restored, disable the optional alias:

```sh
adb -s "$OTT_ADB_SERIAL" shell pm disable --user 0 play.ott.foss/.HomeActivity
adb -s "$OTT_ADB_SERIAL" shell am start --user 0 \
  -a android.intent.action.MAIN -c android.intent.category.HOME
```

The normal OTTPlay app icon remains available. No player data needs to be removed.

## Release identity

Beta and RC use the same `release-build.yml` job and frozen version plan. The
published Full and API 22 APKs are signed with the established Full
certificate. Stable promotion copies the verified RC bytes without rebuilding or
changing the certificate. `android/version.json`, the real APK manifest and bundled
`android-distribution.json` are checked during the build. Native build numbers are
allocated monotonically by the release pipeline. Do not edit them to force a
downgrade or uninstall the old app to bypass a signature mismatch.

The signing key is supplied through the private `CAPACITOR_KEYSTORE_BASE64`,
`CAPACITOR_KEY_ALIAS` and `CAPACITOR_KEY_PASSWORD` repository secrets. A missing or
wrong certificate fails publication instead of producing an unusable update.
Local unsigned builds remain available; see [build instructions](../android/README.md).

## Update through OTT

On Android 5.1–6, the APK downloader supplements the platform trust store with
[ISRG Root X1](https://letsencrypt.org/certificates/), whose self-signed PEM is
bundled from `https://letsencrypt.org/certs/isrgrootx1.pem`. Its SHA-256 certificate
fingerprint is `96bcec06264976f37460779acf28c5a7cfe8a3c0aae11a8ffcee05c0bddf08c6`.
This allows HTTPS downloads from the GitHub release CDN on older Fire tablets.
It applies only to APK download connections on API 22–23; chain validation,
certificate validity, hostname checks and APK hash/signature checks remain active.
Review this bundled root before its published trust horizon of June 2030.
Modern Android uses its platform TLS configuration unchanged.

The first version with `AppUpdate` must be installed normally. Subsequent updates
can be downloaded and installed over Wi-Fi through the authenticated controller:

```sh
ott f10 update status
ott f10 update prepare HTTPS_APK_URL SHA256
ott f10 update status
# After phase becomes ready:
ott f10 update install SHA256
ott f10 update status
```

Use the APK URL and SHA-256 from the same published release. Preparation is
asynchronous and does not interrupt playback. The app downloads over HTTPS,
checks the complete SHA-256, its own application ID, a strictly newer version
code and the installed signing certificate. The package stays in app-private
storage. The controller credentials are never sent to the download server.

Disable kiosk mode and unlock protected settings before starting an update.
The install command waits for the controller acknowledgement before opening the
system installer. Android may first require permission to install from this app:
grant it on the device and send `update install SHA256` again. Confirm installation
on the device if prompted. These are Android permissions; this feature does not
promise silent installation on an unmanaged Fire tablet.

`update status` distinguishes downloading, ready, awaiting_permission,
installing, awaiting_confirmation, installed and failed. An accepted command is
not proof of installation. Verify the installed version after the app reconnects.
The application ID and `https://localhost` WebView origin are retained, preserving
profiles and controller registration. USB is unnecessary for this update path,
but it remains useful for recovery if Android or the WebView cannot start.
