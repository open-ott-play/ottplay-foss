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

The independent Kotlin/Compose app and Play Store submission are maintained in
[ottplay-android](https://github.com/open-ott-play/ottplay-android). That app has a
different identity and does not replace a Capacitor installation in place.

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
