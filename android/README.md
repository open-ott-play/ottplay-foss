# Capacitor Android

This project packages the current shared TypeScript player as a **Full Capacitor
APK**, with application ID `play.ott.foss`, for Android 7 (API 24) and later.
It is separate from the Kotlin/Compose application in
[ottplay-android](https://github.com/open-ott-play/ottplay-android).

Use Node 22, Java 21, Android SDK 36 and Build Tools 36.0.0:

```sh
npm ci
npm run android:full          # debug APK
npm run android:full:release  # unsigned release APK, unless KEYSTORE_FILE is set
npm run cap:android          # Android Studio
```

The build synchronizes native plugins, generates isolated assets from the current
frontend, then audits the final APK. Do not use `cap copy android` or copy an old
`dist-mobile` tree into the application. `android/version.json` is the input for
native version metadata; release CI projects the frozen version plan into it.

Beta and RC builds publish `ottplay-foss-android-full.apk`, signed with the existing
Full certificate. Stable promotes the verified RC bytes. iOS remains part of the
same release pipeline. Play Store AAB publication belongs to the native repository.

The maintained XMLTV plugin lives in
`mobile-xmltv-epg/src/android/play/ott/foss/plugin/MobileXmltvEpgPlugin.kt` and is
included directly in the Gradle source set. Do not add another copy.

See [Android distributions and remote updates](../docs/android-distributions.md).
