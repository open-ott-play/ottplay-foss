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

## Native command queue

The desktop/local proxy command queue (`POST /api/webhook/commands`, `GET /api/webhook/commands`) is now wired to a native HTTP server on mobile via the `MobileCommandQueue` Capacitor plugin.

**Implementation**:

- **iOS**: Swift plugin (`ios/App/App/Plugins/MobileCommandQueue.swift`) — NWListener-based HTTP server on `127.0.0.1:18081`. Enqueue/poll/expire/CORS/OPTIONS match `local_proxy.py` exactly.
- **Android**: Kotlin plugin (`android/app/src/main/java/play/ott/foss/MobileCommandQueuePlugin.kt`) — `ServerSocket`-based HTTP server on `127.0.0.1:18081` with identical contract.
- **Web layer**: `src/index.ts` detects `window.Capacitor`, sets `local_poll_url` to `http://127.0.0.1:18081/api/webhook/commands`, and polls via `MobileCommandQueue.get()` every 10s.
- **JS package**: `mobile-command-queue/src/index.ts` — real native bridge; WebPlugin remains a no-op fallback for non-Capacitor builds.

**Contract** (same as `local_proxy.py` / Tauri `queue.rs`):

- POST `/api/webhook/commands` (alias `/webhook/notify`) — enqueue JSON body, attach `ts`, optional `?device_id=`, respond `{"status":"ok","queued":N}`
- GET `/api/webhook/commands` (alias `/webhook/poll`) — return pending array then clear; expire entries older than 60s
- Caps: per-device 50 (trim to 25), broadcast 100 (trim to 50)
- CORS headers, OPTIONS handling

See `mobile-command-queue/README.md` for usage.

### XMLTV/EPG caching

Implemented in `mobile-xmltv-epg/`. Provides `MobileXmltvEpg.getEpg()` with parity to Tauri `get_epg`:

- **iOS**: Swift `XMLParser`-based XMLTV parse + `URLSession` fetch + gzip via `compression_stream`. Cache in Documents dir with 2h TTL.
- **Android**: Kotlin streaming XML parse + `OkHttp` fetch + `GZIPInputStream`. Cache in app cache/files dir with 2h TTL.
- **Channel resolution**: `ch` fuzzy-match (exact normalized → substring) → `hash` map/hash-as-id → `channel_id` fallback.
- **Frontend**: `getEPGchanelCached()` in `src/channels/index.ts` detects `window.Capacitor` and routes through `MobileXmltvEpg.getEpg()`. Falls back to Tauri or provider HTTP as before.
- **Offline**: stale cache served on fetch failure.

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

### 4.4 Native media

Implemented. Capacitor plugin `MobileNativeMedia` provides OS-level media + power controls on iOS/Android.

- **Plugin**: `mobile-native-media/src/index.ts` + `ios/App/App/Plugins/MobileNativeMedia.swift` + `android/app/src/main/java/play/ott/foss/MobileNativeMediaPlugin.kt`
- **JS shim**: `src/plugins/mobile-native-media.ts`; wired in `src/index.ts` under `window.Capacitor` gate only.
- **Surface**: wraps `stbGetVolume` / `stbSetVolume` / `stbPlayPip` / `stbStopPip` / `stbToFullScreen` / `stbSetWindow` / `stbToggleStandby` so Mode A/Tauri paths stay untouched.

**Behavior by API**:
- **Volume**: `getVolume` returns `{ok, volume(0-100)}`; `setVolume` clamps 0-100. iOS uses `AVAudioSession.outputVolume` for get; set drives `MPVolumeView` slider (public path, no private APIs). Android uses `AudioManager.STREAM_MUSIC`. Both return `{ok:false, unsupported:true}` on failure.
- **PiP**: `playPip` / `stopPip`. iOS uses `AVPictureInPictureController` with an `AVPlayerLayer` attached to the WKWebView; fails if not supported. Android requires API 26+; uses `PictureInPictureParams` with 16:9 aspect ratio. Loud failure on older platforms.
- **Fullscreen**: `setFullscreen(boolean)`. Android uses `FLAG_FULLSCREEN` + immersive sticky system UI flags on the WebView. iOS returns success; documented limitation: native full-window fullscreen requires a supported WKWebView configuration path; do not fake it.
- **Standby / wake**: `allowSleep` releases idle timer / WakeLock; `preventSleep` disables idle timer / acquires WakeLock. Mirrors Tauri `prevent_sleep` / `allow_sleep` intent.

**Failure contract**: never fake success. Every method resolves with `{ok:false}` or `{unsupported:true}` when native path is unavailable; no silent fallback.

## Mode A and Tauri

Mode A browser/STB and Tauri desktop remain unchanged by this Capacitor scaffold.
