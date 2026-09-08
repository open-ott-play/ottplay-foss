# Capacitor Mobile — iOS & Android

Capacitor wraps the OTT-play FOSS web frontend for native iOS and Android deployment.
Both platforms share the same TypeScript source and Capacitor configuration.

## Status

Capacitor 4.1–4.6 shipped on `main`. Store readiness prepared; human TestFlight / Play upload still required.

## Shipped

- **4.1 shell** — PR #295 (`capacitor.config`, iOS/Android projects, dist/ embed)
- **4.2 XMLTV/EPG** — PR #309 — `MobileXmltvEpg` (Swift XMLParser + Kotlin streaming XML/OkHttp; TS routing in `getEPGchanelCached()`)
- **4.3 command queue** — PR #305 (Tauri peer #296) — `MobileCommandQueue` on `127.0.0.1:18081` (NWListener / ServerSocket)
- **M3U stream proxy** — PR #307 — `M3UProxy` + web shim for `/m3u/cp.php`
- **Release artifacts** — PR #310 — multiarch Tauri + Capacitor IPA/APK
- **4.4 Native media** — PR #312 + #316 — `MobileNativeMedia` (volume / wake real; iOS PiP via AVPlayer; fullscreen via MainViewController chrome)
- **4.5 Background audio** — PR #313 — AVAudioSession `.playback` + Android `mediaPlayback` FGS
- **4.6 Key / touch mapping** — this PR — Cap tap→ENTER + Android D-Pad/gamepad/media _doKey inject + iOS HW keyboard path

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

## Remaining gaps

- **Store / TestFlight** — prepared below. Human upload still required.
- **Device smoke** — real device/simulator passes for queue / EPG / M3U/media paths.

## Phase 3 — Store / TestFlight readiness

Prepared. Human upload still required.

### Apple (TestFlight / App Store)

- **Team ID**: Set `DEVELOPMENT_TEAM` in Xcode project (`ios/App/App.xcodeproj/project.pbxproj`).
- **Bundle ID**: `play.ott.foss` (matches Android `applicationId`).
- **Capabilities**: Background audio already declared in `Info.plist`. No other capabilities required.
- **Certificates / Profiles**: Distribution certificate + App Store provisioning profile via Xcode or App Store Connect.
- **Info.plist usage strings**: Background audio (`UIBackgroundModes: audio`) — already present. Web content media playback (`NSAppTransportSecurity` with `NSAllowsArbitraryLoadsInWebContent`) — required for HTTP IPTV streams loaded in WKWebView. No camera/photo/mic/contacts strings added because the app does not use those features.
- **Privacy nutrition labels**: No personal data collected. App plays publicly available IPTV streams. No tracking, no analytics, no device info exfiltration.
- **Screenshots**:
  - iPhone 6.7": 1284 × 2778 px
  - iPhone 6.5": 1242 × 2688 px
  - iPhone 5.5": 1242 × 2208 px
  - iPad 12.9": 2048 × 2732 px
- **TestFlight steps**: Build archive in Xcode → Organizer → Distribute → App Store Connect → TestFlight. Add internal testers by Apple ID. External testing requires App Review.
- **App Store review notes**: Mention IPTV streams require active subscriptions from content providers. App does not host or modify content.

### Google Play (internal track)

- **App ID**: `play.ott.foss`
- **AAB preferred**: Build release AAB via `./gradlew bundleRelease`.
- **Upload key vs Play App Signing**:
  - Recommended: Let Google manage signing. Generate upload key locally, upload to Play Console.
  - Not recommended for new apps: Opt out of Play App Signing.
- **Service account**: For CI upload, create service account in Play Console, download JSON, store as GitHub secret.
- **Internal track**: Upload AAB → Internal testing → add tester emails → publish.

### Privacy policy

FOSS apps need a public privacy page. Do NOT invent a live URL. Use placeholder until project publishes one:

`https://example.com/TODO-privacy-policy`

Replace with actual URL before store submission.

### CI relationship to signing

- **#310 path (default)**: CI builds unsigned IPA/APK. Suitable for AdHoc/TestFlight manual upload or internal testing.
- **Signed builds**: When `KEYSTORE_FILE`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD` env vars are present (local dev or GitHub secrets), `android/app/build.gradle` configures `signingConfigs.release`. CI can produce signed AAB for Play upload.
- **iOS signing**: Always requires Xcode / codesign locally or in CI with p12 + provisioning profile. No automated signing in current CI.

### Screenshot sizes

| Platform | Size | Dimensions |
|----------|------|------------|
| iPhone 6.7" | Required | 1284 × 2778 px |
| iPhone 6.5" | Required | 1242 × 2688 px |
| iPhone 5.5" | Required | 1242 × 2208 px |
| iPad 12.9" | Recommended | 2048 × 2732 px |
| Android phone | Required | 1080 × 1920 min |
| Android tablet | Recommended | 1200 × 1920 min |

### Versioning

Single source of truth: `package.json` version. `scripts/bump-mobile-version.sh` syncs to Android `build.gradle` and iOS `project.pbxproj`. Current aligned version: `1.0.0`.

### 4.4 Native media

Implemented. Capacitor plugin `MobileNativeMedia` provides OS-level media + power controls on iOS/Android.

- **Plugin**: `src/plugins/mobile-native-media.ts` (inlined under `src/` for tsc) + `ios/App/App/Plugins/MobileNativeMedia.swift` + `android/app/src/main/java/play/ott/foss/MobileNativeMediaPlugin.kt`
- **JS shim**: wired in `src/index.ts` under `window.Capacitor` gate only.
- **Surface**: wraps `stbGetVolume` / `stbSetVolume` / `stbPlayPip` / `stbStopPip` / `stbToFullScreen` / `stbSetWindow` / `stbToggleStandby` so Mode A/Tauri paths stay untouched.
- **Call shape**: Cap methods take option objects — `setVolume({ volume })`, `setFullscreen({ fullscreen })` — matching native `getInt`/`getBool`.

**Behavior by API**:
- **Volume**: `getVolume` returns `{ok, volume(0-100)}`; `setVolume({ volume })` clamps 0-100. iOS uses `AVAudioSession.outputVolume` for get; set drives `MPVolumeView` slider (public path, no private APIs). Android uses `AudioManager.STREAM_MUSIC`. Both return `{ok:false, unsupported:true}` on failure.
- **PiP**: `playPip` / `stopPip`. Android requires API 26+; uses `PictureInPictureParams` with 16:9 aspect ratio (`supportsPictureInPicture` on the activity); wraps `enterPictureInPictureMode` in try/catch and fails loudly on older platforms. iOS uses real `AVPlayer` + `AVPlayerLayer` + `AVPictureInPictureController` pipeline: `playPip({ url })` requires non-empty URL, creates native player/item, attaches layer to bridge view, observes `status` via KVO, starts PiP when `isPictureInPicturePossible` or times out after 5s. Returns `{ok:false, error:"pip not possible"}` instead of fake success. `stopPip` tears down player/layer/controller.
- **Fullscreen**: `setFullscreen({ fullscreen })`. Android uses `FLAG_FULLSCREEN` + immersive sticky system UI flags on the WebView. iOS drives `MainViewController` status bar + home-indicator visibility via plugin flag — honest `prefersStatusBarHidden` / `prefersHomeIndicatorAutoHidden` overrides (subclass, not an invalid extension override); no fake `ok:true`. Cap JS only hides `#videopip` when `playPip` returns `{ok:true}` — otherwise CSS PiP fallback.
- **Standby / wake**: `allowSleep` releases idle timer / clears `keepScreenOn`; `preventSleep` disables idle timer / sets `keepScreenOn`. Web fallbacks return `{ok:false, unsupported:true}` (not fake ok). Cap standby shim uses a real `_standby` flag (same pattern as Tauri), not a `backgroundColor` heuristic. Mirrors Tauri `prevent_sleep` / `allow_sleep` intent.

**Failure contract**: never fake success. Every method resolves with `{ok:false}` and/or `{unsupported:true}` when the native path is unavailable; no silent fallback.


### 4.5 Background audio

Implemented. Cap-only wiring keeps HLS/`<video>` audio alive when the app backgrounds.

- **Config (already on main)**: `capacitor.config.ts` `ios.backgroundAudio: true` / `android.backgroundAudio: true`; iOS `Info.plist` `UIBackgroundModes` → `audio`.
- **Plugin extensions**: `startBackgroundAudio` / `pauseBackgroundAudio` / `resumeBackgroundAudio` / `stopBackgroundAudio` on `MobileNativeMedia`.
- **JS shim**: Cap gate in `src/index.ts` wraps `stbPlay` / `stbStop` / `stbPause` / `stbContinue` only when `window.Capacitor` is defined. Mode A + Tauri unchanged.

**iOS**
- Confirms `UIBackgroundModes: audio` remains.
- Configures `AVAudioSession` category `.playback` (mode `.moviePlayback`, AirPlay / A2DP options) on plugin load and on `startBackgroundAudio` / `resumeBackgroundAudio`.
- Publishes `MPNowPlayingInfoCenter` metadata (title/artist) and best-effort `MPRemoteCommandCenter` play/pause/stop via `evaluateJavaScript` on the WKWebView `<video>`.
- **Caveat / follow-up**: remote commands are not a native `AVPlayer` pipeline. Seeking, artwork, and rock-solid lock-screen sync without a native player remain open.

**Android**
- Manifest: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `WAKE_LOCK`, `POST_NOTIFICATIONS`.
- Service: `MediaPlaybackService` with `android:foregroundServiceType="mediaPlayback"`; started via real `ContextCompat.startForegroundService` (no no-op stub).
- Notification + `MediaSession` skeleton (title/artist, play/pause/stop actions on the session).
- **Caveat / follow-up**: richer notification transport controls that drive the WebView `<video>` (and Android 13+ runtime notification permission UX) still need device polish.

**Failure contract**: start/stop report `{ok:false, error}` when the native start/stop path throws; web fallbacks return `{ok:false, unsupported:true}`.

### 4.6 Key / touch mapping

Shipped. Hardware keyboard, D-Pad/gamepad, and mobile touch gestures now feed the same keyhandler path used by browser/STB and Tauri.

- **Touch layer (JS)** — `src/keyhandler/index.ts` swipe → arrows (`_doKey(37/38/39/40)`), 2-finger tap → ENTER, 3-finger tap → SETUP remain global (Mode A/Tauri unchanged). Cap-only: 1-finger tap → ENTER via `_doKey` (Mode A keeps synthetic `MouseEvent` click).
- **Android D-Pad/media/gamepad** — `MainActivity.dispatchKeyEvent` intercepts `DPAD_*`, `ENTER/CENTER`, `BACK`→EXIT (`_doKey(27)`), `VOLUME_*`, `MEDIA_*`, `BUTTON_A/SELECT`→ENTER, `BUTTON_B`→EXIT on `ACTION_DOWN` and calls `WebView.evaluateJavascript("window._doKey(<code>)")` (consumes only when inject succeeds). EXIT confirm Yes uses Cap `App.exitApp()` / bridge finish (not bare `window.close()`). Everything else falls through to `super`.
- **iOS hardware keyboard** — WKWebView delivers `keydown` into the page by default. Arrow/Enter/Escape/media-ish keys already map via `stbEventToKeyCode` → `keyHandler`. No extra Siri Remote / Apple TV remote stack is built here; that remains out of scope for the Capacitor phone targets.

**Caveat**: iOS `MainViewController.swift` SourceKit may show `UIKit` import error in non-Xcode tooling; the module is correct inside the Xcode build context.

## Mode A and Tauri

Mode A browser/STB and Tauri desktop remain unchanged by this Capacitor scaffold.
