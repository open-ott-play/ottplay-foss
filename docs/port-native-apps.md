# Porting ottplay-foss to Native Apps

Status: analysis / planning. No implementation.

## Two Operating Modes

The project serves two distinct deployment models:

### Mode A — Legacy STB / Browser (Dune HS5, MAG, etc.)
Player runs in a browser or WebView on the STB hardware. `python3 server.py` provides the backend companion. Both the frontend bundle and the Python server are required. This mode is preserved indefinitely.

### Mode B — Native Apps (iOS, Android, macOS, Windows, Linux)
Self-contained app. No Python server required. All server.py duties are absorbed into the native layer. The app bundles everything and works offline.

These modes are **mutually exclusive at runtime** — a native app does not connect to server.py, and a browser/STB player does not connect to a native command queue. Both share the same TypeScript frontend source.

---

## Mode A Contract — What `server.py` Must Keep Doing

`server.py` is frozen as the backend for all non-native deployments. Any changes to it must not break Dune HS5 / MAG / browser users.

### Endpoints served by `server.py`

| Endpoint | Purpose | Preserved? |
|---|---|---|
| `/` | Static HTML shell | Yes — unchanged |
| `/f/<path>` | Static assets (JS/CSS/images) | Yes — unchanged |
| `/epg/<hash>.json` | Per-channel EPG slice | Yes — unchanged |
| `/logo/<id>.svg` | Generated SVG channel logos | Yes — unchanged |
| `/logo/<id>.svg?ch=<name>` | Logo with fallback letter | Yes — unchanged |
| `/m3u/match-channels` POST | Match M3U channels to EPG | Yes — unchanged |
| `/m3u/match-logos` POST | Match channel names to logo URLs | Yes — unchanged |
| `/m3u/cp.php` POST | Stream URL proxy (CORS bypass) | Yes — unchanged |
| `/tmdb/<path>` GET | TMDB API proxy (avoids CORS) | Yes — unchanged |
| `/version/<rel>` GET | Version info | Yes — unchanged |
| `/feedback/<path>` GET/POST | Feedback tracking | Yes — unchanged |
| `/api/<path>` GET/POST | Feedback/analytics pass-through | Yes — unchanged |
| `/report_feedb` POST | Usage reporting | Yes — unchanged |
| `/webhook/poll` | **403** — disabled | N/A |
| `/webhook/notify` | **403** — disabled | N/A |

### Separate process: `local_proxy.py` (port 8081)

This is **not** part of server.py. It runs as a standalone companion for the webhook-based remote command system (Home Assistant, Node-RED, curl). It is **not** used by the native apps.

| Endpoint | Purpose |
|---|---|
| `POST /api/webhook/commands` | Enqueue a command |
| `GET /api/webhook/commands` | Poll pending commands |

Commands: `{cmd: "key:<keycode>"}`, `{cmd: "ch:<number>"}`, `{cmd: "push:<url>"}`, `{cmd: "reload"}`.

### What `server.py` fetches from the internet

- XMLTV from `--epg-url` URLs (default: `http://epg.it999.ru/epg2.xml.gz`)
- TMDB API proxied through `/tmdb/`
- M3U playlist streams proxied through `/m3u/cp.php`
- Channel logo favicon via Google Favicon API

**Rule:** No changes to server.py that alter these endpoints, their response formats, or the URL structure. If a feature requires a new endpoint, add it alongside the existing ones.

---

## Mode B Contract — What the Native App Must Implement

### Tier 1 — Static bundle (handled by app shell)

The built HTML/JS bundle is embedded as app assets. No server needed.

### Tier 2 — XMLTV / EPG

Port `server.py` XMLTV logic to native:

- Fetch + gzip decompress + XML parse → native HTTP client + gzip library
- Cache TTL 2h → `SQLite` on desktop, `IndexedDB` on mobile
- Logo SVG generation → TypeScript SVG string generation (no native needed)
- Merge + dedup + channel ID normalization → TypeScript (can stay as-is)

All other EPG logic stays in TypeScript. No URL changes needed — in native, the `/epg/<hash>.json` calls become in-process function calls.

### Tier 3 — M3U provider mapping

- `/m3u/match-channels` → native function, same request/response format
- `/m3u/match-logos` → native function
- `/m3u/cp.php` (stream proxy) → native HTTP client with header injection (Referer, User-Agent rewrite)

### Tier 4 — TMDB proxy

`/tmdb/<path>` → native TMDB API calls with same response format.

### Tier 5 — Version + feedback

`/version/<rel>`, `/feedback/*`, `/api/*`, `/report_feedb` → native HTTP calls or no-op (analytics optional for v1).

### Tier 6 — Remote commands

Native app implements its own local command queue (not `local_proxy.py`):
- `POST /api/webhook/commands` → native HTTP server on `localhost:18081` (desktop) or high port (iOS, Android)
- `GET /api/webhook/commands` → poll from the app's web layer

The native command queue stores commands in memory (expire after 60s, same as `local_proxy.py`).

---

## Recommended Stack Per OS

### macOS, Windows, Linux — Tauri v2

**Why Tauri:** Same stack as `inverter-desktop` (Vue 3 + Tauri v2, Rust backend). Binary size ~10 MB. Rust commands handle all server.py tiers. Proven build pipeline.

**Caveat:** No iOS/Android from the same checkout. Tauri mobile is separate.

Key: embed the TypeScript bundle as `dist/` assets. Rust `include_bytes!` or Tauri `asset_resolver` serves them at startup.

### iOS — Capacitor + Vue 3

**Why Capacitor:** TypeScript-first. Wrap existing web app in WKWebView. One build, two mobile platforms.

**Caveat:** Tauri mobile is real but ecosystem is thinner. Start with Capacitor for derisking.

Media constraints:
- **HLS** — first-class native support. `hls.js` auto-delegates to `<video>` tag on iOS.
- **DASH** — no MSE in WKWebView. Shaka Player falls back to HLS or fails. Most IPTV providers serve HLS.
- **FairPlay** — not accessible from Capacitor JS. Only relevant for premium providers; standard IPTV uses none.
- **Background audio** — `UIBackgroundModes: audio` in Info.plist (Capacitor config).
- **Local command port** — iOS blocks ports < 1024. Use `localhost:18081`.

### Android — Capacitor + Vue 3

Same codebase as iOS.

Media constraints:
- **MSE + Widevine** — available on Chrome WebView (Android 4.4+). HLS.js works. Shaka Player + Widevine works.
- **Background playback** — `foregroundServiceType="mediaPlayback"` in manifest (Capacitor config).
- **Local command port** — any port allowed.

### Summary

| OS | Stack | Rationale |
|---|---|---|
| macOS | Tauri v2 + Vue 3 | Same as inverter-desktop, tiny binary, Rust backend |
| Windows | Tauri v2 + Vue 3 | Same |
| Linux | Tauri v2 + Vue 3 | Same |
| iOS | Capacitor + Vue 3 | Faster to ship, WKWebView HLS, no Rust mobile needed |
| Android | Capacitor + Vue 3 | Same codebase as iOS |

**Why not Electron:** 150 MB binary, high RAM. Tauri wins.
**Why not PWA:** Cannot run a local HTTP server for the command queue. No App Store.
**Why not Capacitor for desktop:** Tauri is smaller and more native. Capacitor desktop exists but is heavier than Tauri for this use case.

---

## Media Playback Constraints

### iOS
- **HLS** — native via `<video>` tag. `hls.js` auto-detects and delegates.
- **DASH** — unavailable (no MSE). Shaka Player fails.
- **FairPlay DRM** — only via native AVPlayer, not accessible from Capacitor.
- **PiP** — `PictureInPicture` Web API on iOS 14+, or Capacitor plugin wrapping `AVPictureInPictureController`.
- **Background audio** — `UIBackgroundModes: audio` in Info.plist.

### Android
- **HLS** — via Chrome WebView MSE.
- **DASH** — via MSE + Widevine L1/L3 on Chrome 74+.
- **ExoPlayer** — not directly accessible. WebView handles most streams.
- **PiP** — `PictureInPicture` Web API on Android 8+.
- **Background** — `foregroundServiceType="mediaPlayback"`.

### Desktop (Tauri)
- **HLS + DASH + DRM** — full MSE support. No constraints.

---

## Storage

| Data | Native storage |
|---|---|
| XMLTV cache | SQLite (desktop), IndexedDB (mobile) |
| Channel favorites / history | `localStorage` via Capacitor Filesystem plugin or Tauri Store plugin |
| Settings | Same — `localStorage` persisted |
| Command queue | In-memory Rust `HashMap` (desktop) / in-memory Swift/Kotlin map (mobile) |

`src/storage/index.ts` already abstracts `localStorage`. Capacitor/Tauri backends persist it to the app's data directory.

---

## Background Modes

### iOS
- `UIBackgroundModes: audio` — background playback
- `UIBackgroundModes: fetch` — background EPG refresh
- Capacitor config: `{ ios: { backgroundAudio: true } }`

### Android
- `foregroundServiceType="mediaPlayback"` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK` permission
- Capacitor config: `{ android: { backgroundAudio: true } }`

### Desktop
- No special handling — app runs indefinitely.

---

## App Store / Play Store / Sideload

### iOS
- **TestFlight** — internal testing, 100 devices, no review
- **App Store** — $99/yr developer account, 1-3 day review
- **AltStore sideload** — 3 apps, 7-day certs (refreshable)

### Android
- **Google Play** — $25 one-time, 1-3 day review
- **APK sideload** — direct install, enable "Unknown apps" in settings

### Desktop
- **macOS** — App Store (same account) or notarized DMG
- **Windows** — Microsoft Store ($19) or direct EXE/MSI
- **Linux** — direct download, `.deb`/`.rpm`, Flathub

---

## Phased Plan — Preserving STB/TV Builds

### Phase 0 — Tauri desktop skeleton (weeks 1-2)

Goal: build + ship a working desktop Tauri app with zero frontend changes.

1. `npm install @tauri-apps/cli && npx tauri init` → `src-tauri/`
2. Copy patterns from `inverter-desktop`: `Cargo.toml`, `tauri.conf.json`, `src/main.rs`
3. Embed `dist/` as app assets. Rust serves them at `app://` URLs.
4. Build `.dmg` / `.msi` — verify app launches and plays HLS
5. **What breaks:** Nothing in `src/`. Build system only.
6. **What is preserved:** `server.py` untouched. STB/TV builds unaffected.

### Phase 1 — Rust backend for server.py tiers (weeks 3-5)

Goal: eliminate Python for desktop builds.

1. **XMLTV** → `src-tauri/src/commands/xmltv.rs`
   - Rust: `ureq` (HTTP), `flate2` (gzip), `quick-xml` (XML), `serde_json` (cache)
   - Cache: `{app_data_dir}/epg_cache/`
   - Same response format as `server.py` — frontend unchanged

2. **Logo SVG** → `src-tauri/src/commands/logo.rs`
   - TypeScript SVG string generation (no Rust needed — SVG is text)

3. **M3U mapping** → `src-tauri/src/commands/m3u.rs`
   - `POST /m3u/match-channels`, `POST /m3u/match-logos`, `POST /m3u/cp.php`
   - Same request/response format

4. **TMDB proxy** → `src-tauri/src/commands/tmdb.rs`
   - Forward to TMDB API, return same JSON

5. **Version + feedback** → `src-tauri/src/commands/misc.rs`
   - `GET /version/<rel>`, `/feedback/*`, `/api/*`, `/report_feedb`

6. **Command queue** → `src-tauri/src/commands/queue.rs`
   - `tiny_http` server on `localhost:18081`
   - `RwLock<HashMap<String, Vec<Command>>>` — expire > 60s
   - Expose as `#[tauri::command]` for direct JS call too

7. **What is preserved:** `server.py` stays for STB/TV. STB/TV users see zero change.

### Phase 2 — Capacitor mobile (weeks 6-10)

Goal: iOS + Android from the same TypeScript source.

1. `npm install @capacitor/core @capacitor/cli && npx cap init`
2. `npx cap add ios && npx cap add android`
3. Configure `capacitor.config.ts`:
   ```ts
   {
     server: { hostname: 'localhost' },
     ios: { backgroundAudio: true },
     android: { backgroundAudio: true, minSdkVersion: 22 },
   }
   ```
4. **Native plugin for command queue:**
   - iOS: Swift plugin on `localhost:18081`
   - Android: Kotlin plugin
5. **Build:** `npm run build && npx cap copy ios && npx cap copy android && npx cap sync`

**What breaks:** Nothing. `server.py` untouched. STB/TV unchanged.

### Phase 3 — App Store / Play Store submission (weeks 11-14)

- iOS TestFlight → fix crashes + permission prompts
- Android internal track → same
- Touch vs remote: device profiles in `src/keyhandler/` already separate input modes
- Store listing: icon 1024×1024, screenshots, privacy policy URL

### Phase 4 — STB/TV builds (ongoing, unchanged)

STB/TV builds continue as today:
- Browser/WebView on MAG, Dune HS5, etc.
- `python3 server.py` as companion backend
- No native app involvement

**Key:** `server.py` is never removed or changed in a breaking way while any STB/TV user depends on it. Changes to server.py require a compatibility check against the current Dune HS5 / MAG workflows.

---

## Key Risks

1. **Dune HS5 compatibility** — Dune HS5 runs the player in a browser/WebView. `server.py` must keep serving the same URLs with the same response formats. Any backend change must be tested against a real Dune HS5 device.

2. **iOS DASH** — if any provider serves DASH-only streams (no HLS fallback), Capacitor WKWebView cannot play them. Verify target providers before committing. Workaround: native ExoPlayer Capacitor plugin.

3. **Stalker portal interception** — provider scripts in `src/provider/index.ts` call `host_ott/swop/a.php` and the configured portal base URL. In native apps there's no external portal server. Provider scripts must route through a shim (Option A: `window.__ottplay_rpc` calls → native `#[tauri::command]`; Option B: native HTTP server intercepts portal patterns). Option A is cleaner, requires small refactor of `src/provider/index.ts`.

4. **Tauri mobile** — Tauri v2 mobile is production-ready but ecosystem is smaller than Capacitor. Phase 2 uses Capacitor. Revisit Tauri mobile in a future phase.

5. **Biome config drift** — `biome.json` schema (2.5.10) doesn't match installed CLI (2.4.16). Fix: `npx biome migrate` or align versions. Blocks pre-push hooks. Unrelated to native app work but should be resolved separately.
