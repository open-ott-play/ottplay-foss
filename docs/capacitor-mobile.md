# Capacitor iOS

The shared TypeScript player is packaged with Capacitor for iOS in this repository.
Android APK/AAB creation, signing and publication moved to
[ottplay-android](https://github.com/open-ott-play/ottplay-android), currently a private
preview requiring repository access. Android browser/STB profiles and legacy bridge
behavior remain in the shared frontend.

## Build and open

Install the Node version used by CI, npm dependencies and Xcode. Then run:

```bash
npm ci
npm run build:ios
npm run cap:ios
```

`build:ios` builds and audits `dist-mobile`, syncs only iOS, then audits the copied
runtime. `build:mobile` is a compatibility alias for `build:ios`; `cap:copy` and
`cap:sync` also target iOS explicitly. No Android Gradle project or packaging command
is maintained here. `build-ios-local.sh` and `build-ios-sim-local.sh` remain available;
see [local build scripts](local-build-scripts.md).

## Configuration and native behavior

`capacitor.config.ts` defines the iOS container. The app uses the same provider,
settings, channel-list and playback logic as the shared player. Native Swift plugins
supply command-queue HTTP control, authenticated stream proxying, XMLTV cache and
native media/PiP integration. HTTP remote control remains off until explicit opt-in.

The iOS target requests landscape orientation and background audio. Tablet windowing
may override orientation. Device signing, background playback, real streams and
physical-device PiP require device validation; unsigned CI compilation alone does
not establish those behaviors.

Use [the device checklist](mode-b-device-smoke.md) and
`./scripts/smoke-capacitor-device.sh --check-native --check-ios-tools` for setup.
`--build-sync` builds iOS; `--open-ios` opens Xcode. Queue probing remains available
for existing legacy installations. `--open-android` only reports the new repository.

## Compatibility references

The `android/` tree now contains [archived source fixtures](../android/README.md).
Their JVM/security tests continue to check the shared TypeScript/native bridge
contracts; they do not assemble an Android application.
