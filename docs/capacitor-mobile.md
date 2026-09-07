# Capacitor Mobile — iOS & Android

Capacitor wraps the OTT-play FOSS web frontend for native iOS and Android deployment.
Both platforms share the same TypeScript source and Capacitor configuration.

## Build

```bash
# Install dependencies
npm install

# Build web + sync to native
npm run build:mobile

# Sync after manual web edits (no rebuild)
npm run cap:sync
```

## Open in IDE

```bash
# Open Xcode (macOS only)
npm run cap:ios

# Open Android Studio
npm run cap:android
```

## Prerequisites

### iOS

- macOS with Xcode (Xcode 15+)
- Node.js >= 18
- CocoaPods: `sudo gem install cocoapods`
- Apple Developer account (for device/sidestore deployment)

### Android

- Android Studio (or Gradle CLI)
- Node.js >= 18
- Android SDK (via Android Studio SDK Manager)
- Set `$ANDROID_HOME` if not auto-detected

## App ID & Name

- **App ID**: `play.ott.foss`
- **App Name**: `OTT-play FOSS`

## Configuration

See `capacitor.config.ts`:

- `webDir: "dist"` — built web assets
- `ios.backgroundAudio: true` — background playback (Info.plist `UIBackgroundModes: audio`)
- `android.backgroundAudio: true` — foreground service for media
- `android.minSdkVersion: 24` — effective minSdk 24 (matches android/variables.gradle)
- `server.hostname: "localhost"` — app-relative URL resolution

## Gaps (Phase 3+)

### Native command queue

The desktop/local proxy command queue (`POST /api/webhook/commands`, `GET /api/webhook/commands`) is not yet wired to a native HTTP server on mobile.

**Current state**: The web layer polls a configurable command URL from player settings. For mobile, the native layer must host an HTTP server on `localhost:18081` and the web layer must point to it.

**What is needed**:

- **iOS**: Swift Capacitor plugin hosting a lightweight HTTP server on port 18081. Exposes `POST /api/webhook/commands` (queue command) and `GET /api/webhook/commands` (return + clear queue). Same 60s expiry logic as `local_proxy.py`.
- **Android**: Kotlin Capacitor plugin — same HTTP server logic.
- **Web layer**: Detect Capacitor environment, set default command URL to `http://localhost:18081/api/webhook/commands`.
- **Package**: `@capacitor-community/local-server` or custom plugin.

See `docs/port-native-apps.md` Phase 2 for full contract.

### XMLTV/EPG caching

XMLTV fetch + gzip + parse currently happens in the web layer via `server.py` endpoints. For full offline support:

- Fetch + cache XMLTV in native layer (Capacitor Filesystem plugin)
- Same EPG merge/dedup logic stays in TypeScript
- Cache TTL: 2 hours in IndexedDB

### M3U stream proxy

Implemented. Capacitor plugin `M3UProxy` provides native HTTP client for `/m3u/cp.php` on iOS/Android.

- **Plugin**: `src/plugins/m3u-proxy.ts` + `ios/App/App/M3UProxy.swift` + `android/app/src/main/java/play/ott/foss/M3UProxyPlugin.kt`
- **Web shim**: `setupCapacitorCompanionShim()` intercepts jQuery `$.ajax` calls to `/m3u/cp.php`, extracts target URL + `ua`/`referer` from POST body, routes through `M3UProxy.proxyFetch()`.
- **UA presets**: webos, tizen, viera, mag, dune — mirrored from `src-rs/core/src/m3u.rs` and `archive/server.py`.
- **Referer**: defaults to URL origin if not provided.
- **Return**: response body as text string (text playlists).
- **Smoke**: Capacitor app → provider POST `/m3u/cp.php` → native fetch returns body; Tauri/Mode A unchanged.

### App Store submission

- iOS TestFlight / App Store: icon 1024×1024, screenshots, privacy policy URL
- Android internal track: same icons, app signing key
- Touch vs remote input already separate in `src/keyhandler/`

## Mode A and Tauri

Mode A browser/STB and Tauri desktop remain unchanged by this Capacitor scaffold.
