# Capacitor Mobile — iOS & Android

Capacitor wraps the OTT-play FOSS web frontend for native iOS and Android deployment.
Both platforms share the same TypeScript source and Capacitor configuration.

## Try the player (web)

Hosted full web player for UI/regression testing without a device build: **https://player.ottplay.here.now/**

## Status

Capacitor 4.1–4.6 + follow-ons shipped on `main` through store readiness (#315), iOS AVPlayer PiP (#316), Stalker portal (#317), MediaSession (#318+#321), DASH ExoPlayer (#319), Tauri updater/notarize (#320), Stalker `host_ott/swop` (#322), Mag `load.php` path allowlist + cookie/header hooks (#324), Cap tvOS unsupported docs + iOS UIPress remote gaps (#325), Dev PC input-line editor `showEditKey2` (#326), command-queue curl/HA smoke (#328), Mode A companion HTTP smoke (#329), M3U stream-proxy header smoke (#332), Mode A `/logo` concurrent bench smoke (#333), XMLTV cache refresh / warm-up smoke (#334), Mode A E2E play-path smoke (#336), Capacitor device-smoke checklist + helper (see `docs/mode-b-device-smoke.md`), and Tauri desktop-smoke checklist + helper (see `docs/mode-b-tauri-smoke.md`). Tauri frameless window drag from top chrome shipped in #348. PC/Tauri native `<input>` editor (`showEditKey2`) default when `sEditor` unset shipped in #352; #389 forces native `showEditKey2` on PC/Tauri/desktop (bundle `sEditor=0` override). iOS Xcode 26 archive Swift fixes shipped in #349 + #351; unsigned IPA green on v1.1.5. Tauri player polish 1.1.20–1.1.23 shipped (#380–#387, #389): whole-surface drag, EPG camelCase, channel row parity, L/Escape simple FS, settings submenu flex, list cursor/paging + `listFitPageSize`, video cover/center, Category All playing-channel cursor, capture-phase L when video focused. ottplay-server HTTPS via rustls aws-lc-rs `CryptoProvider` shipped in #388. Remaining: human TestFlight/Play upload, Mag JsHttpRequest client/VOD, human UI marks on the device-smoke checklist, DRM. Cap tvOS is **unsupported upstream** (documented; no stub target).

## Shipped

- **4.1 shell** — PR #295 (`capacitor.config`, iOS/Android projects, dist/ embed)
- **4.2 XMLTV/EPG** — PR #309 — `MobileXmltvEpg` (Swift XMLParser + Kotlin streaming XML/OkHttp; TS routing in `getEPGchanelCached()`)
- **4.3 command queue** — PR #305 (Tauri peer #296) — `MobileCommandQueue` prefers `127.0.0.1:18081`, falls back through `18082..=18090` (NWListener / ServerSocket)
- **M3U stream proxy** — PR #307 — `M3UProxy` + web shim for `/m3u/cp.php`
- **Release artifacts** — PR #310 — multiarch Tauri + Capacitor IPA/APK
- **4.4 Native media** — PR #312 + #316 — `MobileNativeMedia` (volume / wake real; iOS PiP via AVPlayer; fullscreen via MainViewController chrome)
- **4.5 Background audio + MediaSession** — PR #313 + #318 + #321 — AVAudioSession `.playback` + Android `mediaPlayback` FGS; lock-screen WebView/AVPlayer drive + Tauri souvlaki; channel artwork + honest live-vs-VOD seek
- **4.6 Key / touch mapping** — PR #314 + tvOS follow-up — Cap tap→ENTER + Android D-Pad/gamepad/media `_doKey` inject + iOS HW keyboard + UIPress play/menu/select; Cap tvOS documented unsupported
- **Store readiness** — PR #315 — TestFlight/Play checklist, signing hooks, icons, version bump script (human upload still required)
- **Stalker portal shim** — PR #317 — Cap/Tauri native HTTP for `<portal>/stalker_portal/api/` (handshake + channel list)
- **Stalker `host_ott/swop`** — PR #322 — dealer/cloud `swop/a.php` form-urlencoded POSTs via same Cap/Tauri shim (no proprietary `host_ott` default)
- **4.7 DASH playback** — normal playback uses the shared TS/WebView player; the ExoPlayer plugin from #319 remains an explicit standalone API, without automatic OTT takeover
- **Tauri updater / notarize** — PR #320 — desktop updater plugin + optional notarize/signing CI hooks (see `docs/tauri-updater-notarize.md`)
- **Mag `load.php` path allowlist** — PR #324 — Mode B allowlist for `/load.php` + `/c/portal` with Cookie/Authorization forward + `Set-Cookie` jar (honest Mag gap; **no** JsHttpRequest client)
- **Cap tvOS unsupported + iOS UIPress** — PR #325 — Cap tvOS documented N/A; iOS UIPress play/menu/select + `stbEventToKeyCode` media/back string maps
- **Dev PC input-line editor** — PR #326 — restore `showEditKey2` / window publish for native input-line editor path
- **Tauri frameless window drag** — PR #348 — top chrome/menu header is draggable when `decorations: false`
- **PC/Tauri native editor default** — PR #352 — unset `sEditor` defaults to `1` (native `<input>` / `showEditKey2`)
- **PC/Tauri force native editor** — PR #389 — always `showEditKey2` on PC/Tauri/desktop; bundle `sEditor=0` override so concat/`pullSettingsFromWindow` cannot reopen OSK
- **Cap force native editor + ottpStorage** — 1.1.35 — Capacitor iOS/Android force `showEditKey2`/`sEditor=1` (same as #389); early global `ottpStorage` so M3U `providerHasItemValue` → `setPlayer` does not ReferenceError
- **iOS Xcode 26 archive fix** — PRs #349 + #351 — Swift compile fixes; removed `prefersHomeIndicatorAutoHidden` override (Xcode 26 non-open across modules); unsigned IPA green on v1.1.5
- **Tauri player polish 1.1.20–1.1.23** — PRs #380–#387 — whole-surface drag (#380), settings submenu inline flex (#381), L/Escape simple fullscreen (#382), channel list row parity (#383), EPG invoke camelCase (#384), list cursor/paging 1.1.21 (#387), video cover/center + `listFitPageSize` + Category All playing-channel cursor + capture-phase L when video focused 1.1.22 (#386)
- **ottplay-server rustls CryptoProvider** — PR #388 — install aws-lc-rs `CryptoProvider` so HTTPS companions work
- **Command-queue curl smoke + HA docs** — PR #328 — `scripts/smoke-command-queue.sh` + HA usage notes (all modes)
- **Mode A companion smoke** — PR #329 — `scripts/smoke-modea-companion.sh` (EPG/M3U/static)
- **M3U stream-proxy header smoke** — PR #332 — `scripts/smoke-m3u-stream-proxy-headers.sh` (UA inject / no Referer)
- **Mode A `/logo` concurrent bench smoke** — PR #333 — `scripts/smoke-logo-concurrent-bench.sh` (p50/p95/p99)
- **XMLTV cache refresh / warm-up smoke** — PR #334 — `scripts/smoke-xmltv-cache-refresh.sh` (optional `--restart-cmd`)
- **Mode A E2E play-path smoke** — PR #336 — `scripts/smoke-modea-e2e-play.sh` (companion HTTP play-path; not Cap UI)
- **Capacitor device smoke checklist + helper** — `docs/mode-b-device-smoke.md` + `scripts/smoke-capacitor-device.sh` (sim/emulator checklist; soft queue curl; human UI marks remain)
- **Tauri desktop smoke checklist + helper** — `docs/mode-b-tauri-smoke.md` + `scripts/smoke-tauri-desktop.sh` (desktop toolchain/artifact/companion helpers; human launch/play/PiP marks remain)

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

- `webDir: "dist"` — built web assets (boot URL `/dist/stbPlayer.js` needs nested `dist/dist/stbPlayer.js`; vite nests this for Cap, matching Tauri `stageTauriFrontend`)
- `ios.backgroundAudio: true` — background playback (Info.plist `UIBackgroundModes: audio`)
- `android.backgroundAudio: true` — foreground service for media
- `android.minSdkVersion: 24` — effective minSdk 24 (matches android/variables.gradle)
- `server.hostname: "localhost"` — app-relative URL resolution

## Native command queue

The `MobileCommandQueue` plugin provides an internal queue through native
`post()` and `get()` calls. Ordinary `load()`/`start()` does not open an HTTP
socket. The player drains this internal queue without enabling HTTP command
polling against the device.

Enable **Settings → Remote control → Local HTTP remote control** to generate
a unique device code. The setting is off by default. The player calls
`start({ httpEnabled: true, token })` with that code; configure the controlling
proxy with the same Bearer token. Disabling closes HTTP and revokes the code.
Re-enabling generates a new code; backups never export credentials or consent. The optional HTTP listener binds only
to loopback; each request requires `Authorization: Bearer <token>`. Wildcard CORS
is not enabled. Stopping the plugin closes its listener and clears the queue.
Do not place real tokens in source, logs, screenshots or command examples.

The Swift implementation is in `ios/App/App/Plugins/MobileCommandQueue.swift`;
the Kotlin implementation is in
`android/app/src/main/java/play/ott/foss/MobileCommandQueuePlugin.kt`.
See [the plugin contract](../mobile-command-queue/README.md) for methods, request
limits and authenticated integration examples. The internal queue does not
require a token or an open socket because it is accessed through the app bridge.

### Device smoke and remote integrations

A fresh mobile app should expose no command HTTP listener. Test internal queue
operations first, then explicit HTTP enablement, missing/wrong token rejection,
authorized requests and Stop. A curl smoke that assumes an automatically
listening unauthenticated port does not validate this mobile contract.

The [device checklist](mode-b-device-smoke.md) distinguishes simulator/emulator
results from physical-device validation. For Android, an explicitly enabled
loopback listener can be inspected through a scoped `adb forward`; forwarding
does not remove its authentication requirement. A mobile loopback listener is
not directly reachable from another LAN host. Use a deliberately configured
companion service for remote automation, with that service's own authentication
and transport policy. Android Play remote services must use HTTPS.

Full Mode A command catalog + longer HA examples live in the root `README.md` (Push Command System / Local Proxy Server).

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

- **Web shim**: `setupStalkerPortalShim()` in `src/plugins/stalker-portal.ts` intercepts jQuery `$.ajax` for `/stalker_portal/api/` (and `/stalker_portal/stream/` text fetches), `/swop/a.php`, and Mag path shapes `/load.php` + `/c/portal`. Mode A never installs the shim.
- **Tauri**: `stalker_portal_fetch` (`src-tauri/src/commands/stalker.rs`) — POST/GET with 15s timeout; optional `contentType`; optional `headers` (Cookie / Authorization / …); returns `setCookie[]`.
- **Capacitor**: `StalkerPortal.portalRequest` — same contract on iOS/Android (allowlist + header forward + `setCookie`).
- **Cookie jar (Mode B only)**: shim merges returned `Set-Cookie` into `window.__ottStalkerCookieJar` per host and re-attaches as `Cookie` on later shimmed requests when the caller did not set Cookie.
- **Works**: FOSS JSON-RPC portal handshake + `get_channels` / channel-list load + provider-built stream URLs (player still opens stream URL directly); Mode B `host_ott/swop/a.php` dealer/cloud POSTs when `host_ott` / `host_ott_proto` are set. Response body is returned to existing JS (`edit_dealer_remote` still `getScriptDOM`s dealer script from same-origin `host`).
- **Mag path allowlist (enabling hook, not a Mag client)**: `/load.php` and `/c/portal` URLs are proxied with caller-supplied headers/cookies. FOSS `prov/stalker/prov.js` does **not** call those URLs and does **not** speak JsHttpRequest / Mag `get_profile`. No proprietary `host_ott` / CPS host / Mag token default is baked into FOSS builds.
- **Smoke**: Mode B → configure portal URL + MAC → handshake + channel list without companion `:8095`. With `host_ott` set → Enter Provider Code (remote) / cloud send-load POSTs reach `swop/a.php` via native HTTP. Mode A browser+`server.py` unchanged (talks to real `host_ott` over normal XHR). Mag `load.php` handshake/channel-list is **not** expected to succeed from FOSS alone.

### Classic Mag `load.php` / `c/portal` — not available in FOSS

Typical Mag / Ministra STB middleware is a different protocol from FOSS JSON-RPC:

| Mag (firmware / proprietary provider) | FOSS (`prov/stalker/prov.js`) |
| --- | --- |
| `…/stalker_portal/server/load.php?JsHttpRequest=1-xml&type=…&action=…` | `POST …/stalker_portal/api/` JSON-RPC (`handshake`, `get_channels`, `get_epg`) |
| `Authorization: Bearer <token>` + `Cookie: mac=<MAC>; path=/;` (often via CPS/`cps.php` proxy or native header inject) | MAC in JSON-RPC `params.mac` only; FOSS does not send Mag Bearer/Cookie |
| Multi-step `handshake` → Mag-fingerprint `get_profile` → `get_genres` / `get_all_channels` → `create_link` | Single JSON-RPC handshake + `get_channels`; stream URL built in JS |
| Depends on Mag STB middleware client + cookie/token jar | Works against portals that expose the FOSS JSON-RPC API |

**What FOSS ships for Mag paths:** Mode B allowlist + safe Cookie/Authorization header forward + in-memory `Set-Cookie` jar. **What FOSS does not ship:** JsHttpRequest client, Mag `get_profile` STB fingerprint strings, CPS proxy, baked Mag tokens/hosts, or fake-success stubs. Operators needing classic Mag portals should use STB firmware Mode A or a portal that speaks FOSS JSON-RPC. VOD over Mag `load.php` remains out of scope.

## Remaining gaps

- **Store / TestFlight / Play** — prepared (#315 / section below). Human upload still required.
- **Mag JsHttpRequest client / VOD** — classic Mag handshake/channel-list/VOD client is **not** in FOSS (see section above). Mode B only allowlists Mag URL shapes + header/cookie forward (#324).
- **Cap tvOS** — **does not work** / unsupported upstream (see §Cap tvOS below; #325). No stub target — not an open Cap work item.
- **Device smoke** — FOSS checklist + helper shipped: [`docs/mode-b-device-smoke.md`](mode-b-device-smoke.md) + `scripts/smoke-capacitor-device.sh` (native dir / toolchain checks, optional build-sync/open, soft command-queue curl on `:18081`). **Human still marks** sim/emulator/device UI passes (queue / EPG / M3U/media / Stalker / swop). Unpaid store only (Simulator + sideload APK). Curl companions (#328/#329/#332/#333/#334/#336) remain separate.
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

The app ID is `play.ott.foss`. The separate **Android Play upload bundle** workflow builds and verifies an AAB with a dedicated upload key, then stores it as a GitHub Actions artifact for manual Play Console submission. See [Play upload signing](play-upload-signing.md) for the four required secrets, certificate checks, version-code requirements, and the distinction between upload signing and Play App Signing. It does not register or publish the app and does not need a Play service account.

### Privacy policy

Public stub (store listings / Play & App Store privacy URL):

[`docs/privacy-policy.md`](privacy-policy.md) —
`https://github.com/open-ott-play/ottplay-foss/blob/main/docs/privacy-policy.md`

Honest FOSS summary: on-device playback; optional user-configured playlist/EPG/portal URLs; no baked-in analytics/ads/crash SDKs; streams and EPG go to operator-configured endpoints. Not legal advice — fuller policy may replace the stub later.

### CI relationship to signing

- The existing GitHub release workflow builds unsigned Android and iOS artifacts. An unsigned APK requires signing before installation; an unsigned IPA requires a separate provisioning/signing process before device installation or TestFlight submission.
- The separate manual Play workflow produces an upload-signed AAB only when all four dedicated `PLAY_UPLOAD_*` secrets are configured. It does not change direct APK signing.
- For local Gradle builds, `KEYSTORE_FILE`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, and `KEY_PASSWORD` configure release signing. These environment variables are not automatically populated from GitHub secrets by the existing release workflow.
- iOS signing still requires an appropriate certificate and provisioning profile; the Android Play workflow does not change it.

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
- **OTT second-channel PiP**: Android uses the same muted `#videopip` and requested channel URL as the TS browser build, with the same size/position settings. Opening or closing that channel leaves the main Activity and main stream in place. iOS retains its URL-aware `playPip({ url })` / `stopPip` AVPlayer pipeline and web fallback: it observes readiness and PiP availability, then resolves on start or fails after 5 seconds.
- **Android system PiP**: the separate explicit `MobileNativeMedia.enterSystemPip()` operation minimizes the current Activity without loading a second URL. It requires Android API 26+ and device support, runs on the UI thread, and returns the actual entry result. Exit/restore uses Android's system PiP controls. The OTT second-channel buttons never call this operation; the former Android `playPip` / `stopPip` Activity shortcuts have been removed.
- **Fullscreen**: `setFullscreen({ fullscreen })`. Android uses `FLAG_FULLSCREEN` + immersive sticky system UI flags on the WebView. iOS drives `MainViewController` status bar visibility via plugin flag — honest `prefersStatusBarHidden` override (subclass, not an invalid extension override); home-indicator auto-hide removed (#351, Xcode 26 non-open across modules); no fake `ok:true`. Cap JS only hides `#videopip` when `playPip` returns `{ok:true}` — otherwise CSS PiP fallback.
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

### 4.7 DASH playback and backend parity

Normal Capacitor playback now uses the same selected HTML5, HLS.js or Shaka backend as the TS browser build, including `.mpd` URLs. Choose Shaka for DASH where the device WebView and stream codecs support it. The player uses one shared video surface for state, pause/resume, seek, volume/mute, track selection and OTT menu/preview layout. Switching formats does not start an independent ExoPlayer overlay. Stop, pause and a replacement play request cancel pending background-metadata updates.

- **Shared playback**: `src/core/index.ts`; the Capacitor wrapper in `src/index.ts` adds background media-session updates without changing the playback backend.
- **Standalone native API**: `DashExoPlayerPlugin.kt` and `src/plugins/dash-exo-player.ts` remain available to explicit callers. Their native overlay does not implement the full OTT state/control/layout contract and is not selected by channel, archive or VOD playback.
- **iOS native DASH API**: `ios/App/App/Plugins/DashExoPlayer.swift` continues to return unsupported; this app does not ship an AVPlayer DASH path.

**Coverage**: this change restores the browser player's behavior; it does not add codec, DRM or DASH support to a WebView that lacks it. A working ExoPlayer codec path is not evidence of equivalent WebView support. Unsupported streams follow the shared player's existing error handling.

**Regression check**: `node tests/test_capacitor_playback_parity.cjs` executes the real core functions and Capacitor wrapper with controlled media backends. It covers shared state/seek/mute/track controls, DOM preview bounds, format switching, stop/pause callback cancellation, Android second-channel URL routing, and preservation of iOS native PiP routing. Native rendering and codec playback still require the device smoke checks.

**Out of scope**: Widevine/DRM, FairPlay, encrypted DASH.


## Mode A and Tauri

Mode A browser/STB remains unchanged by Capacitor media paths (gated on `window.Capacitor`).

Tauri Mode B OS media controls (separate from Cap): `start_media_session` / `pause_media_session` / `resume_media_session` / `update_media_session` / `stop_media_session` via **souvlaki** (MPRIS / macOS Now Playing / Windows SMTC). Wired from `stbPlay` / `stbStop` / `stbPause` / `stbContinue` under `__TAURI__` only; transport events eval `<video>` / `_doKey` on the main webview. `artworkUrl` maps to souvlaki `cover_url` when the backend supports it. Seek (`SetPosition` / `Seek` / `SeekBy`) runs only when JS marks `seekable` (finite duration / non-live); live is an honest no-op.


## Mobile orientation

The Capacitor Android and iOS apps use landscape in either direction for menus,
settings and playback. Android's native DASH overlay shares `MainActivity`, so it
inherits the same orientation. iOS constrains both the bridge and presented native
video controllers. System picture-in-picture windows remain controlled by the OS.

Android uses `sensorLandscape`, including the documented activity-level compatibility
opt-out for the current target SDK 36 on Android 16 tablets. Android removes that
opt-out for apps targeting SDK 37 on displays at least 600dp wide; user or device
windowing overrides can also take precedence. See the [Android orientation rules](https://developer.android.com/about/versions/16/behavior-changes-16#adaptive-layouts).

On iPad, landscape-only support requests `UIRequiresFullScreen` compatibility mode.
Split View is unavailable on older iPads in this mode. Stage Manager and iPadOS 26
Windowed Apps may show a scaled landscape scene alongside other apps rather than
true full screen. Apple has deprecated this compatibility mode, so unrestricted
future window sizes cannot be prevented by an orientation mask alone. See
[Apple's compatibility-mode behavior](https://developer.apple.com/documentation/bundleresources/information-property-list/uirequiresfullscreen).

Validate on iPhone, iPad and Android phone/tablet: cold launch while held portrait,
rotate through both landscape directions, open settings and native playback, then
return from picture-in-picture and the background. The app scene should remain
landscape wherever the platform honors the orientation request.
