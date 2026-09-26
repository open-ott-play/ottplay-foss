# Archived Android bridge fixtures

This directory is **not an Android build project**. APK/AAB creation, signing and
publication moved to [open-ott-play/ottplay-android](https://github.com/open-ott-play/ottplay-android).
The new repository is currently a private preview and requires access.

The old Capacitor Kotlin/Java sources, manifests and resources remain here because
the shared player has regression tests for their bridge behavior, command queue,
EPG cache, playback lifecycle, input handling and security configuration.

Gradle configuration, Gradle Wrapper, APK/AAB packaging tools and Android release
jobs have been removed. Do not run `cap sync android` here. Capacitor scripts in
this repository now target iOS explicitly. `@capacitor/android` is a development
dependency used by legacy JVM/security test harnesses, not an application target.

The shared TypeScript Android/STB profiles and native bridge contracts are retained.
The standalone native application owns its own UI, media stack and Android tests;
the archived Full/Play wrapper configuration does not describe that application.

The XMLTV Kotlin fixture has one maintained source at
`mobile-xmltv-epg/src/android/play/ott/foss/plugin/MobileXmltvEpgPlugin.kt`.
The JVM regression harness compiles that file directly. Do not restore a copy
under `android/app`: this tree does not build an application.
