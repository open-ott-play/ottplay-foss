# Porting ottplay-foss to Native Apps

Status: analysis / planning. No implementation.

## What `server.py` Does That the App Must Absorb

`server.py` is a Python HTTP server acting as a local backend companion. Its duties break into three tiers:

### Tier 1 — Static file serving
Serves the built HTML/JS bundle. In a native app this is replaced by embedding the bundle as app assets and loading from `file://` or `app://`. No changes to frontend code needed.

### Tier 2 — XMLTV / EPG proxying
- Fetches one or more XMLTV URLs (`--epg-url`) with gzip decompression
- Caches to `.cache/epg_*.json` (TTL 2h) for instant restarts
- Merges multiple sources, deduplicates by `(start, title)`
- Normalizes channel IDs for fuzzy EPG matching
- Serves `/epg/<hash>` (per-channel EPG slice), `/logo/<hash>` (generated SVG logos)
- `/m3u/match-channels` and `/m3u/match-logos` for M3U provider channel mapping

**App must implement:** XMLTV fetch + gzip + XML parse + cache to local storage (SQLite or IndexedDB). Merging/dedup logic can stay TypeScript. EPG slice endpoint becomes an in-process function call. Logo SVG generation (already in Python) must be ported to TypeScript/canvas.

### Tier 3 — Stalker/Xtream mock portal
`server.py` implements a Stalker Portal-compatible API surface:
- `GET /portal.php?type=stb&action=get_profile` — device profile
- `GET /portal.php?type=account_info&action=get_main_info` — account info
- `GET /portal.php?type=itv&action=get_all_channels` — channel list
- `GET /portal.php?type=itv&action=get_epg_info&period=<days>` — EPG summary
- `GET /portal.php?type=itv&action=get_simple_data_url&chan_id=<id>` — stream URL
- `GET /portal.php?type=tv_archive&action=get_archive_list&chan_id=<id>&day=<date>` — archive manifest
- `GET /portal.php?type=video_vod&action=get_categories` — VOD categories
- `POST /portal.php?type=watching&action=set` — watch time heartbeat
- `POST /report_feedb` — usage reporting

**App must implement:** These are HTTP calls made by provider scripts (`prov/stalker/prov.js`, `prov/xtream/prov.js`) against the configured portal base URL. In a self-contained app there is no external server — the app itself must respond to these requests. Two options:
1. **Embedded HTTP server** — use a Rust-side tiny HTTP server (Tauri) or `capacitor` plugin that intercepts these patterns and responds from local data.
2. **Direct function calls** — refactor provider scripts to call a shim instead of `fetch()`. The shim routes through the native layer (Tauri invoke / Capacitor plugin) which returns the same JSON. Provider code stays unchanged but the transport layer changes.

Option 2 is cleaner and avoids port conflicts.

### Tier 4 — `local_proxy.py` (command queue)
A separate process (`default port 8081`). Exposes:
- `POST /api/webhook/commands` — enqueue command (from Home Assistant, Node-RED, curl)
- `GET /api/webhook/commands` — poll pending commands (player polls this)
- Per-device routing via `?device_id=<id>` query param

Commands include: `{cmd: "key:<keycode>"}`, `{cmd: "ch:<number>"}`, `{cmd: "push:<url>"}`, `{cmd: "reload"}`, etc.

**App must implement:** The player already polls this. In a native app, the command queue should live in the native layer — a Rust-side in-memory store (Tauri state) or a lightweight SQLite table. External POSTs come from the same network, so the native app must bind an HTTP server on a local port (configurable, default `localhost:8081`) that any device on the LAN can reach. This is the one piece that needs a real HTTP server — but it's trivially small (~100 lines of Rust with `tiny_http` or similar).

---

## `local_proxy.py` Proxy Functions

The proxy rewrites stream URLs through the local machine (for CORS bypass, geographic unblocking, etc.) by:
1. Receiving a `POST /m3u/cp.php` with `{cmd: "play", stream_url: "...", ...}`
2. Proxying the stream URL through the local HTTP server
3. Returning the proxied URL to the player

**App must implement:** This is the "local proxy" mode. The native app should intercept these stream requests and handle them in the native layer — for example, using a Tauri plugin that runs a local HTTP proxy or handles the stream directly with an in-process HTTP client that adds required headers and handles CORS.

---

## Recommended Stack Per OS

### macOS, Windows, Linux — Tauri v2

**Why Tauri:** Same stack as `inverter-desktop` (Vue 3 + Tauri v2, Rust backend). You get:
- Rust commands via `invoke()` for all native logic (XMLTV parsing, command queue, portal mock, logo generation)
- Tiny binary (~10 MB vs ~150 MB for Electron)
- Full OS integration: system tray, notifications, file dialogs, shell integration
- Updater plugin already in `inverter-desktop` — port to ottplay with same mechanism
- Proven build pipeline (`inverter-desktop/.github/workflows/*.yml`)

**Caveat:** No out-of-the-box iOS/Android support — Tauri mobile is separate and less mature. But desktop is the primary target for STB/TV builds.

**Key files to create:**
```
src-tauri/
  src/
    main.rs           # existing boilerplate from inverter-desktop
    commands/
      xmltv.rs       # XMLTV fetch + parse + cache
      portal.rs      # Stalker/Xtream mock responses
      commands.rs     # local_proxy command queue
      proxy.rs       # stream URL proxy
  tauri.conf.json    # bundle targets: dmg, msi, deb, rpm, appimage
```

### iOS — Capacitor + Vue 3

**Why Capacitor:** Already TypeScript-first Vue project. Capacitor wraps the web app in a WKWebView (no UIWebView) and provides native bridges via plugins. No Rust needed for iOS.

**Why not Tauri mobile (yet):** Tauri v2 mobile is production-ready but requires a separate `src-mobile/` checkout and IPC complexity. For a first port, Capacitor is faster.

**Media constraints on iOS:**
- **No MSE** (Media Source Extensions) — HLS.js works natively (HLS is first-class on iOS). Shaka Player falls back to HLS internally.
- **No FairPlay DRM** in a browser WKWebView — native AVPlayer handles it, but not accessible from Capacitor JS. If providers need FairPlay (rare for IPTV), a native Capacitor plugin is required.
- **PiP** — available via `AVPictureInPictureController`, exposed by `@capacitor/video` or a custom plugin.
- **Background audio** — requires `UIBackgroundModes: audio` in `Info.plist`, handled by Capacitor config.
- **No local HTTP server for `local_proxy`** — iOS blocks binding to ports below 1024 without root. Use a high port (e.g., `localhost:18081`) and configure the router accordingly.

**Key files to create:**
```
ios/                    # generated by `npx cap add ios`
  App/
    AppDelegate.swift
    Info.plist         # UIBackgroundModes: audio, fetch
capacitor.config.ts     # server: { androidScheme: 'https', hostname: 'localhost' }
  plugins/
    ottplay-commands/   # Native Swift plugin for command queue + stream proxy
```

### Android — Capacitor + Vue 3

**Why Capacitor:** Same codebase as iOS. One TypeScript build ships to both.

**Why not Tauri mobile for Android:** Tauri v2 supports Android, but Capacitor is simpler for a web-heavy app that already works in a browser.

**Media constraints on Android:**
- **MSE + Widevine** — available on Android 4.4+ Chrome WebView. HLS.js works. Shaka Player with Widevine CDM works for DRM streams.
- **ExoPlayer vs WebView** — WebView-based playback (HLS.js/Shaka) works fine for most IPTV. For niche codecs (MPEG-2, MPEG-4 Part 2), a Capacitor video plugin wrapping ExoPlayer is needed.
- **Background playback** — `android:foregroundServiceType="mediaPlayback"` in manifest, Capacitor config handles this.
- **Local proxy port** — Android allows binding to any port. No restriction.

**Key files to create:**
```
android/                # generated by `npx cap add android`
  app/src/main/AndroidManifest.xml  # foregroundServiceType, INTERNET
capacitor.config.ts
  plugins/
    ottplay-commands/   # Native Kotlin plugin for command queue + stream proxy
```

### Summary table

| OS | Stack | Rationale |
|---|---|---|
| macOS | Tauri v2 + Vue 3 | Proven (`inverter-desktop`), tiny binary, Rust backend |
| Windows | Tauri v2 + Vue 3 | Same as above |
| Linux | Tauri v2 + Vue 3 | Same, `appimage`/`deb`/`rpm` targets |
| iOS | Capacitor + Vue 3 | Faster to ship, no Rust mobile needed, WKWebView HLS |
| Android | Capacitor + Vue 3 | Same codebase as iOS, WebView MSE works |

**Why not Electron:** Binary size (~150 MB), security sandbox headaches, high RAM. Tauri is objectively better for this use case. Capacitor for mobile is a pragmatic middle ground between native and web.

**Why not PWA/WKWebView standalone:** PWAs cannot run a local HTTP server — the `local_proxy.py` command queue (which must be reachable from LAN devices) requires a real native process. Also: no App Store distribution, no background audio on iOS, no push notifications.

---

## Media Playback Constraints

### iOS

- **HLS** — first-class native support. `hls.js` detects iOS and delegates to `<video>` tag which uses native HLS. No extra config.
- **DASH** — not supported natively. Shaka Player falls back to HLS (if stream has HLS variant) or fails. Most IPTV providers serve HLS anyway.
- **MSE** — not available in WKWebView. DASH, Widevine, PlayReady all unavailable in JS context.
- **FairPlay DRM** — requires AVPlayer with FairPlay license server. Not accessible from Capacitor JS. Only relevant for premium providers; most IPTV does not use DRM.
- **PiP** — available via `AVPictureInPictureController`. Capacitor plugin needed. iOS 14+ required for web PiP API.
- **Background audio** — works with `UIBackgroundModes: audio` in Info.plist. Player must use `<audio>` element (not video) when screen is locked, or use AVPlayer via plugin.

### Android

- **HLS** — works via Chrome WebView (Android 4.4+). `hls.js` uses MSE under the hood.
- **DASH** — works via MSE in Chrome WebView. Widevine L1/L3 available on Chrome 74+.
- **ExoPlayer** — not accessible from Capacitor JS directly. A native plugin is needed for streams that fail in WebView (rare codec, DRM edge cases).
- **PiP** — supported via `PictureInPicture` Web API on Android 8+. Capacitor plugin wraps `PictureInPictureManager`.
- **Background playback** — foregroundService with `mediaPlayback` type required. Capacitor config handles manifest injection.

### Desktop (Tauri)

- **HLS** — `hls.js` uses MSE, fully supported.
- **DASH** — `shaka-player` via MSE, fully supported.
- **DRM** — Widevine/PlayReady via `CDM` (Content Decryption Module) in Chromium. Works in Tauri since it embeds Chromium/WebView.
- **No constraints** — desktop is the easiest target. All features work as in a browser.

---

## Storage

| Data | Storage mechanism |
|---|---|
| XMLTV cache | SQLite (Rust) on desktop; IndexedDB on mobile |
| Channel favorites / history | `localStorage`/`providerSetItem` (already uses `localStorage`) — no change needed |
| Settings | `localStorage`/`providerSetItem` — already abstracted |
| Command queue (local_proxy) | In-memory Rust `HashMap` keyed by device_id (lost on restart — this is fine, commands expire after 60s anyway) |
| Stream proxy cache | None needed; passthrough by default |

Existing `src/storage/index.ts` uses browser `localStorage`. On mobile Capacitor, this persists across sessions via the filesystem plugin. On desktop Tauri, the same `localStorage` backed by the app's data directory.

---

## Background / Background Modes

### iOS
- `UIBackgroundModes: audio` — background audio playback
- `UIBackgroundModes: fetch` — background data refresh (EPG update)
- Handled via Capacitor config (`{ ios: { backgroundAudio: true } }`)

### Android
- `foregroundServiceType="mediaPlayback"` — keeps playback alive
- `android.permission.FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_MEDIA_PLAYBACK`
- Capacitor config handles manifest merging

### Desktop
- No special handling — apps can run indefinitely in the background

---

## App Store / Play Store / Sideload

### iOS
- **TestFlight** — internal testing, up to 100 devices, no App Store review
- **App Store** — requires Apple Developer account ($99/yr), app review (1-3 days typically)
- **Sideload (AltStore)** — requires AltServer + Mac/PC companion app, max 3 apps, 7-day certificates (refreshable)
- **Sideload (Xcode)** — sideloaded .ipa, max 3 apps on one device (registered devices)

### Android
- **Google Play** — requires $25 one-time dev account, app review for new apps, 1-3 days
- **Sideload (APK)** — direct APK install, no review, users must enable "Install unknown apps"
- **F-Droid** — open source only, requires source code submission + build verification

### Desktop
- **macOS** — App Store (same Apple account as iOS), or direct DMG download + notarization
- **Windows** — Microsoft Store (requires Microsoft account + $19 one-time fee), or direct EXE/MSI
- **Linux** — direct download, `.deb`/`.rpm` repos, Flathub submission

---

## Phased Plan — Preserving STB/TV Builds

### Phase 0 — Tauri desktop skeleton (weeks 1-2)

Goal: build and ship a working desktop Tauri app with zero functional changes to the frontend.

1. `npm install @tauri-apps/cli && npx tauri init` — creates `src-tauri/`
2. Copy `Cargo.toml`, `tauri.conf.json`, `src/main.rs` patterns from `inverter-desktop`
3. Add minimal Tauri commands that wrap `localStorage` and pass through to the web layer unchanged
4. Build for macOS (`.dmg`), verify it launches, loads the existing bundle
5. Verify HLS playback works (hls.js + Tauri WebViewWindow)

**What breaks:** Nothing in `src/`. Build system changes only.

**Keep:** All existing `npm run build` output. Tauri serves `dist/` as file:// URLs internally.

### Phase 1 — Rust backend for server.py duties (weeks 3-5)

Goal: eliminate Python runtime dependency for desktop builds.

1. Port XMLTV fetch + gzip + XML parse + cache → `src-tauri/src/commands/xmltv.rs`
   - Same logic as `server.py` `_fetch_single_xmltv()` / `parse_xmltv_time()` / `match_channel_to_xmltv()`
   - Use Rust crates: `ureq` (HTTP), `flate2` (gzip), `quick-xml` (XML), `serde` + `serde_json` (cache)
   - Cache to `{app_data_dir}/epg_cache/` as JSON

2. Port logo generation → `src-tauri/src/commands/logo.rs`
   - Current Python generates SVG strings. Port to Rust string building or use embedded SVG templates.
   - Or generate logos on the TypeScript side (SVG is text, no native needed).

3. Port Stalker portal mock → `src-tauri/src/commands/portal.rs`
   - All `GET /portal.php?...` responses as `#[tauri::command]` functions
   - Provider scripts call these via `fetch()` to the portal base URL — need to intercept.
   - **Option A:** Refactor provider scripts to call `window.__ottplay_rpc.get_simple_data_url(chan_id)` instead of `fetch(portal_url)`.
   - **Option B:** Use Tauri HTTP server plugin (embed a tiny `tiny_http` listener on a port within the app).
   - Option A is cleaner but touches provider code. Option B is more transparent.

4. Port `local_proxy.py` command queue → `src-tauri/src/commands/queue.rs`
   - `tiny_http` server on `localhost:18081` (configurable)
   - `POST /api/webhook/commands` → store in `RwLock<HashMap<String, Vec<Command>>>`
   - `GET /api/webhook/commands` → drain and return, expire entries > 60s old
   - Expose as `#[tauri::command]` for the web layer to also call directly

5. Port stream proxy (`local_proxy.py` `cp.php` mode) → `src-tauri/src/commands/proxy.rs`
   - Intercept stream URL requests, proxy through app
   - Handle required header injection (Referer, Origin, User-Agent rewriting)

**What breaks:** `server.py` still needed for non-Tauri builds (STB, TV, existing browser deployments). Deprecate it for desktop only.

### Phase 2 — Capacitor mobile (weeks 6-10)

Goal: iOS + Android apps from the same TypeScript codebase.

1. `npm install @capacitor/core @capacitor/cli && npx cap init`
2. `npx cap add ios && npx cap add android`
3. Configure `capacitor.config.ts`:
   ```ts
   {
     server: { hostname: 'localhost' },
     ios: { backgroundAudio: true, contentCapable: true },
     android: { backgroundAudio: true, minSdkVersion: 22 },
   }
   ```
4. Build: `npm run build && npx cap copy ios && npx cap copy android`

**Native plugin for command queue:**
- iOS: Swift plugin in `ios/Plugin/OttplayCommands/` with `CapacitorPlugin` subclass
- Android: Kotlin plugin in `android/app/src/main/java/com/ottplay/commands/`
- Exposes `OttplayCommands.startServer(port)` and `OttplayCommands.postCommand(cmd)` to JS

**What changes:** `local_proxy.py` ported to Swift/Kotlin as a local HTTP server plugin. All other logic stays TypeScript.

**What breaks:** Nothing. Mobile builds are additive.

### Phase 3 — App Store / Play Store submission (weeks 11-14)

- iOS TestFlight first (fast, internal). Address crashes, permissions prompts.
- Android internal testing track (fast). Same.
- Iterate on UX for touch vs remote (mobile uses touch, TV uses remote keys — device profiles already separate these).
- Prepare store listing assets: screenshots, icon (1024×1024), description, privacy policy URL.

**No functional changes** — this phase is store compliance only.

### Phase 4 — STB/TV builds (ongoing)

STB/TV builds (MAG, Android TV, Samsung Tizen, etc.) are not native apps in the mobile sense. They use:
- The existing browser-based build (`npm run build`)
- `server.py` as the local companion server
- Device profiles in `src/stb/` (note: `src/stb/` directory does not yet exist — device profiles were described in `docs/device-profiles.md` but the actual `src/stb/` directory was not present in the current checkout. If device profiles exist elsewhere, they are preserved and continue to work.)

These builds are **unchanged** by the native app work. They remain as they are.

---

## Key Risks

1. **Stalker portal interceptor** — provider scripts `fetch()` the portal base URL. In a native app there's no external server. The portal mock must live inside the app. Refactoring provider scripts to use an RPC shim (Option A above) is the cleanest path but requires changes to `prov/stalker/prov.js` and `prov/xtream/prov.js`. Test thoroughly with real provider credentials.

2. **MSE on iOS** — DASH won't work. Most IPTV providers serve HLS variants. Verify your target providers' stream formats before committing to Capacitor. If DASH is essential, a native ExoPlayer Capacitor plugin is needed.

3. **FairPlay DRM** — if any provider requires FairPlay, Capacitor's WKWebView cannot handle it. Native AVPlayer integration or a dedicated streaming app (using AVKit directly) would be needed. Unlikely for typical IPTV.

4. **Tauri mobile maturity** — while Tauri v2 mobile is production-ready, the ecosystem (plugins, documentation) is thinner than Capacitor. Start with Capacitor for mobile to derisk. Revisit Tauri mobile in a future phase.

5. **Binary size vs features** — Capacitor apps bundle the web assets + a thin native shell (~30-50 MB). Tauri apps are smaller (~10 MB) but require Rust development. The phase plan starts with Tauri desktop (where Rust is already justified) and Capacitor mobile (where adding Rust to a TypeScript mobile project adds complexity without benefit).
