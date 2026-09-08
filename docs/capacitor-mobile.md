# Capacitor Mobile — iOS & Android

Capacitor wraps the OTT-play FOSS web frontend for native iOS and Android deployment.
Both platforms share the same TypeScript source and Capacitor configuration.

## Status

Capacitor 4.1–4.6 + follow-ons shipped on `main` through store readiness (#315), iOS AVPlayer PiP (#316), Stalker portal (#317), MediaSession (#318+#321), DASH ExoPlayer (#319), Tauri updater/notarize (#320), and Stalker `host_ott/swop` (#322). Remaining: human TestFlight/Play upload, Mag `load.php`/VOD, device smoke, DRM. Cap tvOS is **unsupported upstream** (documented; no stub target).

## Shipped

- **4.1 shell** — PR #295 (`capacitor.config`, iOS/Android projects, dist/ embed)
- **4.2 XMLTV/EPG** — PR #309 — `MobileXmltvEpg` (Swift XMLParser + Kotlin streaming XML/OkHttp; TS routing in `getEPGchanelCached()`)
- **4.3 command queue** — PR #305 (Tauri peer #296) — `MobileCommandQueue` on `127.0.0.1:18081` (NWListener / ServerSocket)
- **M3U stream proxy** — PR #307 — `M3UProxy` + web shim for `/m3u/cp.php`
- **Release artifacts** — PR #310 — multiarch Tauri + Capacitor IPA/APK
- **4.4 Native media** — PR #312 + #316 — `MobileNativeMedia` (volume / wake real; iOS PiP via AVPlayer; fullscreen via MainViewController chrome)
- **4.5 Background audio + MediaSession** — PR #313 + #318 + #321 — AVAudioSession `.playback` + Android `mediaPlayback` FGS; lock-screen WebView/AVPlayer drive + Tauri souvlaki; channel artwork + honest live-vs-VOD seek
- **4.6 Key / touch mapping** — PR #314 + tvOS follow-up — Cap tap→ENTER + Android D-Pad/gamepad/media `_doKey` inject + iOS HW keyboard + UIPress play/menu/select; Cap tvOS documented unsupported
- **Store readiness** — PR #315 — TestFlight/Play checklist, signing hooks, icons, version bump script (human upload still required)
- **Stalker portal shim** — PR #317 — Cap/Tauri native HTTP for `<portal>/stalker_portal/api/` (handshake + channel list)
- **Stalker `host_ott/swop`** — PR #322 — dealer/cloud `swop/a.php` form-urlencoded POSTs via same Cap/Tauri shim (no proprietary `host_ott` default)
- **4.7 DASH native playback** — PR #319 — Android ExoPlayer/Media3 `DashExoPlayer` plugin + iOS honest reject
- **Tauri updater / notarize** — PR #320 — desktop updater plugin + optional notarize/signing CI hooks (see `docs/tauri-updater-notarize.md`)

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

### Stalker portal + host_ott swop shim

Implemented (Option A-style ajax routing → native HTTP). Stalker provider scripts POST JSON-RPC to `<portal>/stalker_portal/api/`; dealer/cloud entry (`edit_dealer_remote`, cloud settings) POSTs form-urlencoded bodies to `host_ott/swop/a.php`. Mode B has no companion and WebView CORS would block those origins.

- **Web shim**: `setupStalkerPortalShim()` in `src/plugins/stalker-portal.ts` intercepts jQuery `$.ajax` for `/stalker_portal/api/` (and `/stalker_portal/stream/` text fetches) **and** `/swop/a.php`. Mode A never installs the shim.
- **Tauri**: `stalker_portal_fetch` (`src-tauri/src/commands/stalker.rs`) — POST/GET with 15s timeout; optional `contentType` (JSON for portal, `application/x-www-form-urlencoded` for swop).
- **Capacitor**: `StalkerPortal.portalRequest` — `ios/App/App/Plugins/StalkerPortalPlugin.swift` + `android/.../StalkerPortalPlugin.kt` (passes through `contentType`).
- **Works**: portal handshake + `get_channels` / channel-list load + provider-built stream URLs (player still opens stream URL directly); Mode B `host_ott/swop/a.php` dealer/cloud POSTs when `host_ott` / `host_ott_proto` are set (same contract as STB firmware). Response body is returned to existing JS (`edit_dealer_remote` still `getScriptDOM`s dealer script from same-origin `host`).
- **Still limited / TODO**: Classic Mag `c/portal` / `load.php` flavors, token/cookie auth variants, and VOD are outside the FOSS `prov/stalker` JSON-RPC path. No proprietary `host_ott` default is baked into FOSS builds — Mode B callers must set those globals (STB firmware does on Mag). Cloud settings UI already no-ops when unset.
- **Smoke**: Mode B → configure portal URL + MAC → handshake + channel list without companion `:8095`. With `host_ott` set → Enter Provider Code (remote) / cloud send-load POSTs reach `swop/a.php` via native HTTP. Mode A browser+`server.py` unchanged (talks to real `host_ott` over normal XHR).

## Remaining gaps

- **Store / TestFlight / Play** — prepared (#315 / section below). Human upload still required.
- **Mag `load.php` / VOD** — classic Mag `c/portal` / `load.php` flavors, token/cookie auth variants, and VOD remain outside the FOSS `prov/stalker` JSON-RPC path.
- **Cap tvOS** — **does not work** / unsupported upstream (see §Cap tvOS below). No stub target.
- **Device smoke** — real device/simulator passes for queue / EPG / M3U/media / Stalker / swop paths.
- **DRM** — Widevine / FairPlay / encrypted DASH out of scope for current Cap/Tauri paths.

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
- Publishes `MPNowPlayingInfoCenter` metadata (title/artist) and `MPRemoteCommandCenter` play/pause/toggle/stop/next/prev.
- **Target switch**: when native AVPlayer PiP (#316) is active (`pipPlayer != nil`), remote commands drive `AVPlayer` play/pause/stop (teardown). When only in-app WKWebView video is playing, commands `evaluateJavaScript` on `<video>` (and `_doKey` 35/36 for next/prev).
- **Artwork / seek**: `artworkUrl` fetched into `MPMediaItemArtwork` when the URL is reachable (http/https or data:). `changePlaybackPositionCommand` enabled only when JS reports `seekable` with a finite duration (archive/VOD). Live IPTV leaves seek disabled and returns `.noActionableNowPlayingItem` (honest no-op). Position ticks via `updateBackgroundAudio`.

**Android**
- Manifest: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `WAKE_LOCK`, `POST_NOTIFICATIONS`.
- Service: `MediaPlaybackService` with `android:foregroundServiceType="mediaPlayback"`; started via real `ContextCompat.startForegroundService` (no no-op stub).
- Notification + `MediaSession` transport (play/pause/stop/next/prev) drives Cap WebView via `evaluateJavascript` on bound `WebView` ( `<video>` play/pause/stop; `_doKey` 35/36 for next/prev). Plugin binds/clears the WebView weak ref on load/resume/destroy.
- Android 13+ (`TIRAMISU`): `POST_NOTIFICATIONS` requested at runtime when starting/resuming the FGS if missing (best-effort; service still starts if the user has not granted yet).
- **Artwork / seek**: optional `artworkUrl` decoded to notification `largeIcon` + `METADATA_KEY_ART` / `ALBUM_ART`. `ACTION_SEEK_TO` advertised only when `seekable` + duration known; live ignores `onSeekTo` without claiming success. Timeline refresh via `updateBackgroundAudio` / `ACTION_UPDATE`. Notification may stay quiet until the user grants POST_NOTIFICATIONS.

**Failure contract**: start/stop report `{ok:false, error}` when the native start/stop path throws; web fallbacks return `{ok:false, unsupported:true}`.

### 4.6 Key / touch mapping

Shipped. Hardware keyboard, D-Pad/gamepad, and mobile touch gestures now feed the same keyhandler path used by browser/STB and Tauri.

- **Touch layer (JS)** — `src/keyhandler/index.ts` swipe → arrows (`_doKey(37/38/39/40)`), 2-finger tap → ENTER, 3-finger tap → SETUP remain global (Mode A/Tauri unchanged). Cap-only: 1-finger tap → ENTER via `_doKey` (Mode A keeps synthetic `MouseEvent` click).
- **Android D-Pad/media/gamepad** — `MainActivity.dispatchKeyEvent` intercepts `DPAD_*`, `ENTER/CENTER`, `BACK`→EXIT (`_doKey(27)`), `VOLUME_*`, `MEDIA_*`, `BUTTON_A/SELECT`→ENTER, `BUTTON_B`→EXIT on `ACTION_DOWN` and calls `WebView.evaluateJavascript("window._doKey(<code>)")` (consumes only when inject succeeds). EXIT confirm Yes uses Cap `App.exitApp()` / bridge finish (not bare `window.close()`). Everything else falls through to `super`.
- **iOS hardware keyboard** — WKWebView delivers `keydown` into the page by default. Arrow/Enter/Escape already map via `stbEventToKeyCode` → `keyHandler`. Shared `stbEventToKeyCode` also maps `MediaPlayPause`/`MediaPlay`/`MediaPause`→80, `MediaStop`→83, `GoBack`/`BrowserBack`→27 when hosts report `event.key` with `keyCode` 0.
- **iOS UIPress (iPad-adjacent remotes)** — `MainViewController.pressesBegan` injects `_doKey` for `.playPause`→80, `.menu`→27, `.select`→13. Arrows/Escape stay on the WKWebView keydown path to avoid double-fire. This is **not** Apple TV / Siri Remote on tvOS.

**Caveat**: iOS `MainViewController.swift` SourceKit may show `UIKit` import error in non-Xcode tooling; the module is correct inside the Xcode build context.

### Cap tvOS / Apple TV — **does not work**

**Verdict: unsupported.** There is no production Capacitor tvOS path for this project (Capacitor **8.5.x**), and none upstream for Cap 7/8.

| Check | Result |
|---|---|
| `npx cap add tvos` | **Does not exist.** Cap CLI platforms are `ios` / `android` / `web` only. No `@capacitor/tvos` package. |
| Capacitor runtime | Built on **WKWebView**. Apple marks `WKWebView` `__TVOS_PROHIBITED` (since tvOS 9); App Store rejects private-API webview workarounds. |
| Ionic / Cap team | Confirmed on the Capacitor forum: Apple TV apps with Capacitor are not possible for this reason. |
| This repo | Phone/iPad Cap targets only. **No stub tvOS Xcode target** (a non-building stub would be worse than honest docs). |

**What works on Cap iOS/Android instead**

- iPhone / iPad: touch gestures + hardware keyboard → `_doKey` / `stbEventToKeyCode` / `keyHandler` (#314 + UIPress gaps above).
- Android TV / D-Pad / gamepad / media keys: `MainActivity.dispatchKeyEvent` → `_doKey` (#314).
- Lock-screen / Now Playing transport: MediaSession / `MPRemoteCommandCenter` (#318/#321) — play/pause/next/prev, not a lean-back Siri Remote UI.

**If a real Apple TV app is required later**

- Separate native **SwiftUI + AVKit** client (or `react-native-tvos`), not Capacitor.
- Waiting for Capacitor tvOS is not a plan — WKWebView prohibition is an Apple platform constraint, not a Cap feature gap.

Mode A browser/STB and Tauri desktop are unchanged by this decision (shared `stbEventToKeyCode` media-key string maps are additive only).

### 4.7 DASH native playback

Implemented. Capacitor plugin `DashExoPlayer` provides native DASH (and HLS) playback on Android via Media3/ExoPlayer with a `PlayerView` overlay on the Cap Activity; iOS returns honest `{ok:false, unsupported:true}` because WKWebView lacks MSE and this app does not ship an AVPlayer DASH path.

- **Android plugin**: `android/app/src/main/java/play/ott/foss/DashExoPlayerPlugin.kt` (Media3 exoplayer + dash + hls + ui)
- **iOS plugin**: `ios/App/App/Plugins/DashExoPlayer.swift` — unsupported reject only (registered in `MainViewController`)
- **JS**: `src/plugins/dash-exo-player.ts` + Capacitor `stbPlay` wrapper in `src/index.ts`: `.mpd` URLs call `isDashSupported` → `playDash`; `_nativeDash` routes stop/pause/continue to native methods
- **Mode A / Tauri**: unchanged (desktop MSE / Shaka still used)

**Failure contract**: never fake success. Android resolves `{ok:true}` only after ExoPlayer prepare/play starts; iOS rejects DASH up-front so UI can show a clear error instead of SRC_NOT_SUPPORTED from Shaka.

**Out of scope**: Widevine/DRM, FairPlay, encrypted DASH.


## Mode A and Tauri

Mode A browser/STB remains unchanged by Capacitor media paths (gated on `window.Capacitor`).

Tauri Mode B OS media controls (separate from Cap): `start_media_session` / `pause_media_session` / `resume_media_session` / `update_media_session` / `stop_media_session` via **souvlaki** (MPRIS / macOS Now Playing / Windows SMTC). Wired from `stbPlay` / `stbStop` / `stbPause` / `stbContinue` under `__TAURI__` only; transport events eval `<video>` / `_doKey` on the main webview. `artworkUrl` maps to souvlaki `cover_url` when the backend supports it. Seek (`SetPosition` / `Seek` / `SeekBy`) runs only when JS marks `seekable` (finite duration / non-live); live is an honest no-op.
