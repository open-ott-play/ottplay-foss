# OTT-play FOSS

Self-contained IPTV/OTT player with a local Rust HTTP server. Runs on Smart TVs (LG WebOS, Samsung Tizen, Panasonic, Sony, etc.), set-top boxes (Infomir MAG, Dune HD, Enigma2, Android TV), and desktop browsers.

## Try the player (web)

Hosted full web player for testing (no local build required):

**https://player.ottplay.here.now/**

Same FOSS player UI as a desktop browser build. Point it at your own M3U / provider after first load (Settings → Providers).

## Features

- **Playback**: HLS, DASH, plain HTTP streams via HLS.js and Shaka Player; soft live reconnect on fatal HLS parse/network
- **EPG**: XMLTV guide with fuzzy channel matching, time-shift/catch-up, denser guide rows, programme-title search (N5 in EPG), reminders before timers
- **Favorites**: Multi-list favorites (switch/add/rename/delete from Actions → Favorite lists); parental PIN
- **Settings**: Export/import settings + favorites as JSON; continue-watching archive resume bookmark
- **Shared interface**: OTT Server, Tauri and Capacitor use the same channel-list theme and visibility settings. Interface settings control highlight and selection colors; Channel list settings control channel names, picons, current programmes, progress and archive markers.
- **Providers**: M3U playlists, Xtream Codes API, Stalker middleware
- **Push commands**: Remote control via webhook — change channel, provider, playlist, show popups
- **Remote text entry (swop)**: Phone keyboard via Cloudflare Worker when TV/phone are on different networks (allowlisted Device UUID; ♥™ on VKB)
- **Per-device routing**: UUID-based addressing for multi-device setups
- **Local proxy**: Optional local command server for 100% local automation (no central server needed)
- **Debug**: Opt-in playback HUD / ring log via `?debug=1`
- **24 device types**: Per-device remote control key mappings
- **21 languages**: Full localization support

## Debug HUD

Enable debug mode via one of:
- URL: `?debug=1` or `?debug=true`
- Local storage: `localStorage.setItem("ottplay_debug", "1")`
- Window property: `window.__OTT_DEBUG__ = true`
- Server: when `/debug/config` returns `{enabled: true}`

When debug is enabled:
- Press **D** to toggle the on-screen HUD strip (`ottDebugSetHud` / `__ottDebug.toggleHud()`)
  - Skips when focus is on INPUT/TEXTAREA/listEdit
  - Uses `e.key` to avoid MAG/Maple PLAY/PREV=68 conflict
- Info menu → **Debug HUD** → calls `__ottDebug.toggleHud()`
- Manage settings → **Debug HUD**:
  - If debug already loaded: toggles HUD visibility
  - Else: sets `ottplay_debug=1` + `ottplay_debug_hud=1` and prompts restart
- Persistence: HUD state saved to `localStorage.ottplay_debug_hud` ("1"/"0") by `ottDebugSetHud`

## Mobile Apps (iOS / Android)

Capacitor wraps the same TypeScript frontend for native iOS and Android.

The mobile interface stays in landscape and supports rotation between both landscape directions. Tablet multitasking and newer operating-system windowing policies can override the requested orientation; see the platform notes below. Use Settings → Lists to adjust the number of visible rows and spacing for smaller screens.

Settings → Buttons preserves the selected seek intervals, and Settings → Interface applies the selected streaming engine when saved. The sleep timer choices are off, 30 minutes, 1 hour, 2 hours and 3 hours of inactivity. Saved button mappings, hidden menu items and parental preferences also survive settings export and subsequent saves.

```bash
npm install
npm run build:mobile          # vite build + cap copy + cap sync
npm run cap:ios               # open in Xcode
npm run cap:android           # open in Android Studio
```

See [docs/capacitor-mobile.md](docs/capacitor-mobile.md) for prerequisites, configuration, and gaps.

Device smoke (Mode B sim/emulator checklist + helper; unpaid store / sideload): [docs/mode-b-device-smoke.md](docs/mode-b-device-smoke.md) — `./scripts/smoke-capacitor-device.sh --help`.

Tauri desktop smoke (Mode B launch/play/PiP checklist + helper; unpaid/unsigned OK): [docs/mode-b-tauri-smoke.md](docs/mode-b-tauri-smoke.md) — `./scripts/smoke-tauri-desktop.sh --help`.

## Installation

| Platform | Package | Notes |
|---|---|---|
| **macOS** | `.dmg` / `.app.zip` | Universal Apple Silicon + Intel; unsigned — remove quarantine |
| **Windows** | `.msi` / `.exe` | x64 |
| **Linux** | `.AppImage`, `.deb`, `.rpm` | Various distributions |
| **iOS** | `.ipa` via AltStore / TestFlight / Xcode | Sideload only — not on App Store yet |
| **Android** | `.apk` direct install or ADB | arm64-v8a, armeabi-v7a, x86_64 |

All installers are attached to every tagged release: [https://github.com/open-ott-play/ottplay-foss/releases/latest](https://github.com/open-ott-play/ottplay-foss/releases/latest)

> **Note:** Desktop, iOS, and Android packages are **unsigned** unless a release was built with the project's signing secrets. On macOS this means Gatekeeper quarantine; on iOS the IPA must be sideloaded; on Android you must allow unknown sources. The player itself works without signing.

---

### macOS

1. Download `OttPlay.FOSS_*_aarch64-apple-darwin.dmg` (Apple Silicon) or `OttPlay.FOSS_*_x86_64-apple-darwin.dmg` (Intel) from [Releases](https://github.com/open-ott-play/ottplay-foss/releases/latest)
2. Open the `.dmg`
3. Drag **OttPlay FOSS.app** to Applications
4. On first run: Right-click → Open → Open

If you see "OttPlay FOSS.app is damaged and can't be opened", macOS has quarantined the download. Remove the attribute and retry:

```bash
# On the downloaded .dmg:
xattr -d com.apple.quarantine ~/Downloads/OttPlay.FOSS_*_aarch64-apple-darwin.dmg

# Or on the .app after copying to Applications:
xattr -cr /Applications/OttPlay\ FOSS.app
```

---

### Windows

1. Download `.msi` or `.exe` from [Releases](https://github.com/open-ott-play/ottplay-foss/releases/latest)
2. Run installer, follow prompts
3. Launch from Start Menu or Desktop shortcut

---

### Linux

**AppImage (recommended):**

```bash
chmod +x OttPlay.FOSS_*_x86_64.AppImage
./OttPlay.FOSS_*_x86_64.AppImage
```

**Debian/Ubuntu (.deb):**

```bash
sudo dpkg -i ottplay-foss_*.deb
sudo apt-get install -f
```

**RHEL/Fedora (.rpm):**

```bash
sudo rpm -i ottplay-foss_*.rpm
```

---

### iOS Installation

iOS requires sideloading since the app is not on the App Store. Two options:

#### Option 1: AltStore (Recommended for personal use)

AltStore allows sideloading apps with a free Apple ID (no paid developer account needed).

**Prerequisites:**

- iPhone/iPad running iOS 14 or later
- A free [Apple ID](https://appleid.apple.com/)
- AltServer installed on your Mac or PC

**Step 1: Install AltServer**

1. Download AltServer for your platform:
   - **macOS**: Download from [AltStore.io](https://altstore.io/) or via Homebrew:
     ```bash
     brew install --cask altstore
     ```
   - **Windows**: Download from [AltStore.io](https://altstore.io/)

2. Start AltServer (it runs in the menu bar/system tray)

**Step 2: Install AltStore on your device**

1. Open AltServer on your Mac/PC
2. Connect your iPhone/iPad via USB
3. On iOS: Go to Settings → General → Device Management → tap your Apple ID
4. Trust the profile if prompted

**Step 3: Sideload the app**

1. Download the `.ipa` from [Releases](https://github.com/open-ott-play/ottplay-foss/releases/latest)
2. Double-click the `.ipa` to open it in AltStore
3. Select your connected device
4. Wait for installation to complete

**Refresh requirement:** AltStore apps expire after 7 days. Keep AltServer running to auto-refresh, or right-click AltStore icon → Refresh apps.

**Step 4: Trust the app**

1. On iOS: Settings → General → VPN & Device Management
2. Find "OttPlay FOSS" under your Apple ID
3. Tap Trust → Confirm

#### Option 2: TestFlight (If available)

If a TestFlight beta is available:

1. Accept the TestFlight invite
2. Install TestFlight from App Store
3. Open the beta link and tap "Install"

#### Option 3: Xcode (For developers)

1. Download `.ipa` from [Releases](https://github.com/open-ott-play/ottplay-foss/releases/latest)
2. Connect your device via USB
3. Open Xcode → Window → Devices and Simulators
4. Select your device → Click "+" → Select the `.ipa`
5. On first install, enable "Trust this app" in device settings

**Troubleshooting iOS:**

- App won't open: Settings → General → Device Management → Trust the app
- AltStore offline: Ensure AltServer is running and device connected
- Refresh failed: Check internet connection, try again

---

### Android Installation

#### Option 1: Direct Install (APK)

1. Download the `.apk` from [Releases](https://github.com/open-ott-play/ottplay-foss/releases/latest)
2. Transfer to your Android device
3. Open the APK file
4. If prompted about unknown sources: Settings → Security → Allow unknown sources
5. Tap Install

**Note:** You may need to enable "Install unknown apps" for your browser or file manager.

#### Option 2: ADB Installation (Recommended for developers)

ADB gives you more control and is useful for debugging.

**Prerequisites:**

```bash
# macOS
brew install android-platform-tools

# Ubuntu/Debian
sudo apt install adb

# Windows — download from:
# https://developer.android.com/studio/releases/platform-tools
```

**Step 1: Enable USB Debugging**

1. Go to Settings → About Phone
2. Tap "Build Number" 7 times → Developer mode enabled
3. Go back to Settings → Developer Options
4. Enable "USB Debugging"
5. Connect your device via USB

**Step 2: Verify connection**

```bash
adb devices
# Should show: "xxxxxxxx    device"
```

If you see "unauthorized", check your phone for a pairing confirmation dialog.

**Step 3: Install APK**

```bash
wget https://github.com/open-ott-play/ottplay-foss/releases/latest/download/ottplay-foss-android-unsigned.apk

adb install ottplay-foss-android-unsigned.apk
```

**Step 4: Launch**

```bash
# Option A: From command line
adb shell am start -n play.ott.foss/.MainActivity

# Option B: Tap the app icon on your device
```

**Useful ADB Commands**

```bash
# View logs (for debugging)
adb logcat -s "OttPlay FOSS"

# Reinstall (keeps app data)
adb install -r ottplay-foss-android-unsigned.apk

# Uninstall
adb uninstall play.ott.foss
```

#### Option 3: Via Local Network (Wireless ADB)

```bash
# Connect via USB first, then enable wireless
adb tcpip 5555

# Disconnect USB, find device IP on phone
# Settings → About Phone → Status → IP address

# Connect wirelessly
adb connect <device-ip>:5555

# Install
adb install ottplay-foss-android-unsigned.apk
```

---

## Quick Start

```bash
# 1. Build the player bundle
npm install
npm run build          # production (minified → dist/stbPlayer.js)

# 2. Build + start the Rust server
cargo build --release -p ottplay-server
./target/release/ottplay-server --port 8080

# 3. Open in browser
# http://localhost:8080
```

Or skip the local build and open the hosted full player: **https://player.ottplay.here.now/**

On first load: press **F2 (Settings) → Providers → M3U**, enter your playlist URL.

## Mode A companion smoke

Curl-based smoke for the Mode A companion (`ottplay-server` / `archive/server.py` parity): index, static dirs, `/logo`, `/version`, optional `/epg`, and a no-fetch probe of `POST /m3u/cp.php`.

```bash
# Local install default (:8095 — scripts/install-ottplay-local-service.sh)
./scripts/smoke-modea-companion.sh

# Docker / cargo CLI default (:8080)
BASE_URL=http://127.0.0.1:8080 ./scripts/smoke-modea-companion.sh

# Optional EPG slice (empty cache → warning, not failure)
EPG_HASH=<channel-hash> ./scripts/smoke-modea-companion.sh
```

Checks live in `scripts/modea-smoke-checks.json`. No secrets. Command-queue / `local_proxy.py` (:8081) is covered separately by `scripts/smoke-command-queue.sh` (when present).

## M3U stream-proxy header smoke

Compares upstream request headers that Mode A companion `POST /m3u/cp.php` injects when fetching a controllable echo URL (local mock by default — no IPTV providers, no secrets).

Contract (from `src-rs/core/src/m3u.rs` + `archive/server.py`):
- Injects **User-Agent** only (`OTT-play-FOSS/1.0` default, or presets `webos` / `tizen` / `viera` / `mag` / `dune`).
- Does **not** inject **Referer** (Capacitor `M3UProxy` does; Mode A does not).
- Strips a leading `@` from `url` (provider jQuery form).

```bash
# Companion must be listening (local install default :8095)
./scripts/smoke-m3u-stream-proxy-headers.sh

# Docker / cargo CLI default (:8080) — echo must be reachable from the companion process
BASE_URL=http://127.0.0.1:8080 ./scripts/smoke-m3u-stream-proxy-headers.sh

# Optional public echo (httpbin /headers JSON shape)
ECHO_URL=https://httpbingo.org/headers ./scripts/smoke-m3u-stream-proxy-headers.sh

# Also exercise JSON {url,ua} body
./scripts/smoke-m3u-stream-proxy-headers.sh --json
```

Exit: `0` pass, `1` not listening, `2` header/HTTP mismatch, `3` usage/deps. Sibling of `smoke-modea-companion.sh` / `smoke-command-queue.sh`.

## Logo concurrent bench smoke

Concurrent `GET /logo/<id>.svg` (optional `?ch=`) latency smoke against Mode A companion. Reports OK/fail counts and p50/p95/p99. Default is CI-local practical load (`CONCURRENCY=200`, `TOTAL=1000`); full 10k soak is optional (`--full` / `LOGO_BENCH_FULL=1` / `TOTAL=10000`).

```bash
# Companion must be listening (local install default :8095)
./scripts/smoke-logo-concurrent-bench.sh

# Docker / cargo CLI default (:8080)
BASE_URL=http://127.0.0.1:8080 ./scripts/smoke-logo-concurrent-bench.sh

# Tune load
CONCURRENCY=100 TOTAL=500 ./scripts/smoke-logo-concurrent-bench.sh
./scripts/smoke-logo-concurrent-bench.sh --concurrency 100 --total 500

# Optional soak (machine must tolerate it)
./scripts/smoke-logo-concurrent-bench.sh --full
# LOGO_BENCH_FULL=1 ./scripts/smoke-logo-concurrent-bench.sh
```

Exit: `0` pass, `1` not listening / connection failed, `2` high error rate, `3` usage. Sibling of `smoke-modea-companion.sh` / `smoke-m3u-stream-proxy-headers.sh` / `smoke-command-queue.sh`.


## XMLTV cache refresh / warm-up smoke

Verifies Mode A companion XMLTV/EPG cache behavior honestly against `src-rs` (no invented APIs):

- In-memory `EPG_CACHE` served via `GET /epg/:hash` → always `{"epg_data":[...]}` (HTTP 200).
- Process start fetches `EPG_URLS` **before** binding the listener; background refresh every **2h**.
- Optional SQLite persist when `DATABASE_URL` is set (no public cache-status endpoint).
- `GET /health` → `OK` is the automated warm-up gate after an optional restart.

Default path only curls — **does not kill processes**. Pass `--restart-cmd` / `RESTART_CMD` for automated kill+restart, or follow the manual `launchctl` steps in `--help`.

```bash
# Companion must be listening (local install default :8095)
./scripts/smoke-xmltv-cache-refresh.sh

# Docker / cargo CLI default (:8080)
BASE_URL=http://127.0.0.1:8080 ./scripts/smoke-xmltv-cache-refresh.sh

# Optional real channel hash (before/after restart if --restart-cmd set)
EPG_HASH=<channel-hash> ./scripts/smoke-xmltv-cache-refresh.sh

# Optional restart + wait for /health (warm-up). Example macOS local install:
./scripts/smoke-xmltv-cache-refresh.sh --restart-cmd \
  'launchctl unload ~/Library/LaunchAgents/com.ottplay-foss-local.plist && launchctl load ~/Library/LaunchAgents/com.ottplay-foss-local.plist'

# Optional local peek at archive/server.py .cache (Python companion only)
./scripts/smoke-xmltv-cache-refresh.sh --check-disk-cache /path/to/workdir/.cache
```

Exit: `0` pass, `1` not listening, `2` assertion / warm-up failed, `3` usage. Sibling of `smoke-modea-companion.sh` / `smoke-m3u-stream-proxy-headers.sh` / `smoke-logo-concurrent-bench.sh` / `smoke-command-queue.sh`.


## Mode A E2E play-path smoke

Companion-side **play-path / stream readiness** smoke (HTTP only — **not** headed UI E2E). Against a running Mode A companion it checks:

- Health or index reachable
- Static player-shell assets (`/`, `/stbPlayer/1280.css`, `/js/jquery-…`, `/f/…`)
- Optional `GET /epg/<hash>.json` when `EPG_HASH` is set
- `POST /m3u/match-channels` with a secret-free JSON fixture (empty list + one synthetic channel)
- Stream-proxy **play**: `POST /m3u/cp.php` to a controllable media fixture (local HLS playlist by default, or `MEDIA_URL`) and assert HTTP 200 + non-empty body / expected `Content-Type` (first bytes through the proxy)

No private IPTV credentials. Sibling of `smoke-modea-companion.sh` (presence), `smoke-m3u-stream-proxy-headers.sh` (UA/Referer), `smoke-xmltv-cache-refresh.sh`.

```bash
# Companion must be listening (local install default :8095)
./scripts/smoke-modea-e2e-play.sh

# Docker / cargo CLI default (:8080) — fixture host must be reachable from the companion
BASE_URL=http://127.0.0.1:8080 ./scripts/smoke-modea-e2e-play.sh

# Optional EPG slice
EPG_HASH=<channel-hash> ./scripts/smoke-modea-e2e-play.sh

# Optional external media/echo (skips body equality; still requires HTTP 200 + non-empty)
MEDIA_URL=https://httpbingo.org/bytes/64 ./scripts/smoke-modea-e2e-play.sh

# Tiny MPEG-TS fixture + leading '@' strip on the play POST
./scripts/smoke-modea-e2e-play.sh --ts-fixture --with-at-strip
```

Exit: `0` pass, `1` not listening, `2` assertion failed, `3` usage/deps.

## Capacitor device smoke (Mode B)

Simulator / emulator (optional real-device) **checklist** for Mode B Cap — not Mode A companion HTTP.
Human marks UI passes; helper automates toolchain / native dirs / soft command-queue curl.

```bash
./scripts/smoke-capacitor-device.sh --help
./scripts/smoke-capacitor-device.sh --check-native
./scripts/smoke-capacitor-device.sh --queue          # soft-skip if Cap :18081 down
```

Details: [docs/mode-b-device-smoke.md](docs/mode-b-device-smoke.md). Sibling of `smoke-command-queue.sh` (Cap loopback) — do not confuse with Mode A smokes above.


## Tauri desktop smoke (Mode B)

Desktop checklist + helper for Mode B Tauri (window / channel play / PiP). Not Mode A companion HTTP and not Cap device smoke.

```bash
./scripts/smoke-tauri-desktop.sh --help
./scripts/smoke-tauri-desktop.sh
./scripts/smoke-tauri-desktop.sh --check-companion
```

Details: [docs/mode-b-tauri-smoke.md](docs/mode-b-tauri-smoke.md). Unpaid/unsigned OK; human still marks headed launch/play/PiP.

## Docker

Multi-arch images (amd64/arm64) are published to Docker Hub on every push to `main`, on `v*` tags, and via `workflow_dispatch`.

The server binary is built on **musl** (Alpine) and shipped on Alpine — it does **not** require GLIBC_2.38+. That keeps `alvit/ottplay-foss` runnable on Synology DSM Docker (x86_64) and other older-glibc hosts.

```bash
docker run -d -p 8080:8080 alvit/ottplay-foss
# with EPG source(s) (semicolon-separated):
docker run -d -p 8080:8080 -e EPG_URLS="http://example.com/epg.xml.gz" alvit/ottplay-foss
```

Tags: `latest` (main), `1.2.3` / `1.2` (semver from `v*` tags), `sha-<short>`.

## Build from Source

```
src/
├── polyfills/       # Polyfills for old STBs (String.trim, Math.imul, Array, TextEncoder, Date)
├── utils/           # Utilities (encoding, helpers, LZString compression)
├── storage/         # Storage (localStorage/cookie abstraction)
├── localization/    # Translation (_(), language file loader)
├── settings/        # ~100 player settings with typed interface (+ export/import envelope)
├── channels/        # Channels, EPG, favorites lists, timers, continue-watching
├── debug/           # Opt-in playback HUD / ring / ingest (`?debug=1`)
├── core/            # Playback (HLS.js/Shaka, fullscreen, PiP, audio/subtitle, soft live restart)
├── ui/              # UI (info bar, dialogs, lists, volume, color)
├── keyhandler/      # Remote control key dispatch
├── provider/        # Providers (load, M3U/Xtream/Stalker)
├── commands/        # Push command handler (webhook commands)
├── app/             # Device + init helpers
└── index.ts         # Entry point, wires modules + window.* publish (concat last in MODULES)
```

> Note: there is no `src/benchy/` — legacy developer CSS/JS live-reload and Maple `pperf_*` stamps were removed from the tree; they were never on the concat `MODULES` list.

## Device Detection

Player supports 24 device types. Detection: by URL `/f/{device_id}/` first, then User-Agent.

| Device ID | Device |
|---|---|
| `pc` | PC browser |
| `pc2` | videojs web player |
| `nodejs` | Windows app (Electron) |
| `lg/webos` | LG WebOS TVs |
| `samsung/tizen` | Samsung Tizen TVs |
| `samsung/maple` | Samsung Orsay TVs |
| `mag` | Infomir MAG boxes |
| `dune` | Dune HD boxes |
| `android` | Android TV / tablets |
| `hbbtv` | HbbTV TVs |
| `panasonic` | Panasonic Viera TVs |
| `philips` | Philips TVs |
| `sony` | Sony TVs |
| `sharp` | Sharp TVs |
| `toshiba` | Toshiba TVs |
| `hisense` | Hisense TVs |
| `skyworth` | Skyworth TVs |
| `tcl` | TCL TVs |
| `vewd` | Vewd devices |
| `spark` | Spark receivers |

## Push Command System

The player polls a webhook endpoint every 10 seconds for commands. Commands are JSON objects with a `"command"` field.

### Architecture

#### Local Command URL (Recommended)

Set a local URL in **Player settings → Remote control → Local command URL**. The player polls this URL every 10 seconds. Use with Home Assistant webhooks, Node-RED, or the included `local_proxy.py`.

```
Player → GET http://192.168.1.50:8081/api/webhook/commands  (every 10s)
HA/curl → POST http://192.168.1.50:8081/api/webhook/commands  (on demand)
```

#### Device UUID

The player generates a unique device UUID on first run (stored in localStorage). **Player settings → Remote control** shows your Device ID (e.g., `dev_a1b2c3d4e5`). Use this ID for per-device routing with `local_proxy.py` or your own backend.

#### Remote text entry (swop)

Purpose: type on a phone for ♥™ / remote virtual keyboard when the TV and phone
are on **different networks**, via a Cloudflare Worker session handoff.

- Worker repo: [ottplay-swop](https://github.com/open-ott-play/ottplay-swop)
- **Client id** = this player Device UUID (`deviceId` / `ott_device_uuid`); the
  Worker operator must **allowlist** it before `POST /session` / `GET /val` succeed
- Setting: `swopBaseUrl` (empty = ♥™ shows “not configured” / no-op). Edit under
  **Settings → Remote control** (key **2**), or inject via gitignored
  `/local/swop.json` on operator installs
- Headers on `/session` and `/val`: `X-Swop-Client-Id` (Device UUID)
- **Local inject:** `scripts/install-ottplay-local-service.sh` writes
  `$DEST/local/swop.json` when `SWOP_BASE_URL` is set in the environment, and
  allowlists `clientId` when `SWOP_ADMIN_TOKEN` is set. Never commit private
  Worker hostnames or tokens into git / the public image.
- **`deploy.sh` today** only pulls/runs Docker — it does **not** register clients.
  Optional `SWOP_*` env on the deploy host can auto-allow + inject an id for
  *operator* installs (see [ottplay-swop Access control](https://github.com/open-ott-play/ottplay-swop#access-control)).
  Not enabled by default; never bake `ADMIN_TOKEN` into the image.
- **Status:** Worker allowlist + foss client ♥™ wiring landed

> **Security note**: The central server's `/webhook/poll` and `/webhook/notify` endpoints have been disabled because unauthenticated broadcast polling is a security risk — any client can send/receive commands for any device_id. For local use, `local_proxy.py` provides the same functionality within your trusted home network.

### Available Commands

All examples below use `http://192.168.1.50:8081/api/webhook/commands` as the local proxy URL. Replace with your actual proxy address.

#### `popup_message` — Show notification popup

```bash
curl -X POST http://192.168.1.50:8081/api/webhook/commands \
  -H "Content-Type: application/json" \
  -d '{"command":"popup_message","message":"Hello TV!","popup_duration":10}'
```

| Field | Type | Default | Description |
|---|---|---|---|
| `message` | string | required | Text to display |
| `popup_duration` | number | 5 | Seconds to show (top-right corner) |

#### `channel_by_number` — Switch to channel by list position

```bash
curl -X POST http://192.168.1.50:8081/api/webhook/commands \
  -H "Content-Type: application/json" \
  -d '{"command":"channel_by_number","channel_number":42}'
```

| Field | Type | Default | Description |
|---|---|---|---|
| `channel_number` | number | required | 1-based channel position in list |

#### `channel_by_name` — Switch to channel by (partial) name

```bash
curl -X POST http://192.168.1.50:8081/api/webhook/commands \
  -H "Content-Type: application/json" \
  -d '{"command":"channel_by_name","channel_name":"discovery"}'
```

Case-insensitive substring search. First match wins.

| Field | Type | Default | Description |
|---|---|---|---|
| `channel_name` | string | required | Channel name or partial name |

#### `random_channel` — Switch to random channel

```bash
# Random from all channels
curl -X POST http://192.168.1.50:8081/api/webhook/commands \
  -H "Content-Type: application/json" \
  -d '{"command":"random_channel"}'

# Random from range (1-2000)
curl -X POST http://192.168.1.50:8081/api/webhook/commands \
  -H "Content-Type: application/json" \
  -d '{"command":"random_channel","random_range":[1,2000]}'
```

| Field | Type | Default | Description |
|---|---|---|---|
| `random_range` | [start, end] | all channels | 1-based range |

#### `change_provider` — Switch IPTV provider

```bash
curl -X POST http://192.168.1.50:8081/api/webhook/commands \
  -H "Content-Type: application/json" \
  -d '{"command":"change_provider","provider":0}'
```

| Field | Type | Default | Description |
|---|---|---|---|
| `provider` | number | required | Index in provider array (0=m3u, 1=stalker, 2=xtream, ...) |

#### `change_playlist` — Load new M3U playlist

```bash
curl -X POST http://192.168.1.50:8081/api/webhook/commands \
  -H "Content-Type: application/json" \
  -d '{"command":"change_playlist","playlist":"http://example.com/playlist.m3u"}'
```

| Field | Type | Default | Description |
|---|---|---|---|
| `playlist` | string | required | M3U playlist URL |

#### `change_provider_settings` — Update provider configuration

```bash
curl -X POST http://192.168.1.50:8081/api/webhook/commands \
  -H "Content-Type: application/json" \
  -d '{"command":"change_provider_settings","provider_settings":"{\"url\":\"http://example.com\",\"login\":\"user\",\"password\":\"pass\"}"}'
```

| Field | Type | Default | Description |
|---|---|---|---|
| `provider_settings` | string | required | JSON string with provider config |

#### `set_volume` — Set or adjust volume

```bash
# Set absolute volume (0-100)
curl -X POST http://192.168.1.50:8081/api/webhook/commands \
  -H "Content-Type: application/json" \
  -d '{"command":"set_volume","volume":75}'

# Increase by 10
curl -X POST http://192.168.1.50:8081/api/webhook/commands \
  -H "Content-Type: application/json" \
  -d '{"command":"set_volume","volume_step":10}'

# Decrease by 5
curl -X POST http://192.168.1.50:8081/api/webhook/commands \
  -H "Content-Type: application/json" \
  -d '{"command":"set_volume","volume_step":-5}'
```

Silently ignored on clients without volume control support.

| Field | Type | Default | Description |
|---|---|---|---|
| `volume` | number | — | Absolute level 0-100 |
| `volume_step` | number | — | Relative change, e.g. +10 or -5 |

#### `exit_player` — Exit / shutdown player

```bash
curl -X POST http://192.168.1.50:8081/api/webhook/commands \
  -H "Content-Type: application/json" \
  -d '{"command":"exit_player"}'
```

Tries standby mode first (if supported), otherwise exits the player. No fields needed.

## Local Proxy Server

`local_proxy.py` is a standalone local command server. Run it on any machine in your home network (e.g., the Home Assistant server).

### Start the proxy

```bash
python3 local_proxy.py 8081
```

### Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/webhook/commands` | Queue a command |
| `GET` | `/api/webhook/commands` | Retrieve queued commands (player poll) |
| `POST` | `/api/webhook/commands?device_id=dev_xxx` | Queue for specific device |
| `GET` | `/api/webhook/commands?device_id=dev_xxx` | Retrieve for specific device |

### Smoke script (all modes)

```bash
# Mode B / Capacitor (prefer 127.0.0.1:18081; fallback 18082..=18090)
# Cap+Tauri dual-run: ./scripts/smoke-command-queue.sh --discover
./scripts/smoke-command-queue.sh

# Mode A local_proxy on :8081
BASE_URL=http://127.0.0.1:8081 ./scripts/smoke-command-queue.sh
```

Android emulator/device: `adb forward tcp:18081 tcp:18081` first. Cap/Tauri are loopback-only — use this Mode A proxy for LAN Home Assistant. Details: `docs/capacitor-mobile.md` § Smoke test.

### CORS

The proxy sends full CORS headers (`Access-Control-Allow-Origin: *`), so the player can poll it from any domain.

### Example: Home Assistant webhook → local proxy → player

```bash
# 1. Start proxy
python3 local_proxy.py 8081 &

# 2. In player settings, set Local command URL to:
#    http://192.168.1.50:8081/api/webhook/commands

# 3. Send commands from HA or curl:
curl -X POST http://192.168.1.50:8081/api/webhook/commands \
  -H "Content-Type: application/json" \
  -d '{"command":"popup_message","message":"Motion detected!","popup_duration":5}'

curl -X POST http://192.168.1.50:8081/api/webhook/commands \
  -H "Content-Type: application/json" \
  -d '{"command":"channel_by_name","channel_name":"BBC"}'

curl -X POST http://192.168.1.50:8081/api/webhook/commands \
  -H "Content-Type: application/json" \
  -d '{"command":"random_channel","random_range":[1,2000]}'
```

### Home Assistant automation examples

```yaml
rest_command:
  tv_command:
    url: "http://192.168.1.50:8081/api/webhook/commands"
    method: POST
    headers:
      Content-Type: application/json
    payload: >-
      {{ {'command': command} | combine(payload | default({})) | tojson }}

automation:
  # Show popup when door opens
  - alias: "TV: Door alert"
    trigger:
      platform: state
      entity_id: binary_sensor.front_door
      to: "on"
    action:
      - service: rest_command.tv_command
        data:
          command: popup_message
          payload:
            message: "Front door opened!"
            popup_duration: 5

  # Switch to random channel in the evening
  - alias: "TV: Evening random channel"
    trigger:
      platform: time
      at: "20:00:00"
    action:
      - service: rest_command.tv_command
        data:
          command: random_channel
          payload:
            random_range: [1, 500]

  # Volume up
  - alias: "TV: Volume up"
    trigger:
      platform: event
      event_type: volume_up_button
    action:
      - service: rest_command.tv_command
        data:
          command: set_volume
          payload:
            volume_step: 10

  # Put TV to standby at night
  - alias: "TV: Night standby"
    trigger:
      platform: time
      at: "23:00:00"
    action:
      - service: rest_command.tv_command
        data:
          command: exit_player
```

## Server API Reference

### Webhook Endpoints (Rust `ottplay-server`)

> The original `server.py` implementation is preserved under `archive/server.py`
> for reference and as a STB fallback. The Rust binary serves the same
> webhook paths; for production use the binary.

| Method | Path | Description |
|---|---|---|
| `POST` | `/webhook/notify?device_id=<uuid>` | Send command to device |
| `GET` | `/webhook/poll?device_id=<uuid>` | Poll commands for device |
| `POST` | `/webhook/notify` | Legacy broadcast (all devices) |
| `GET` | `/webhook/poll` | Legacy broadcast poll |

### Other Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/epg/<hash>.json` | EPG data for channel |
| `GET` | `/logo/<id>.svg` | Generated channel logo |
| `GET` | `/version/<path>` | File version hash |
| `POST` | `/m3u/match-channels` | Channel-to-EPG matching |
| `POST` | `/m3u/match-logos` | Channel logo matching |
| `POST` | `/m3u/cp.php` | Stream proxy |
| `GET/POST` | `/feedback/` | Feedback logging |
| `GET` | `/tmdb/*` | TMDb API proxy |

### EPG

```bash
# Add XMLTV EPG source(s) via env var (semicolon-separated)
EPG_URLS="http://example.com/epg.xml.gz" ./target/release/ottplay-server --port 8080
```

## Project Structure

```
.
├── archive/
│   └── server.py          # Original Python server (frozen for STB fallback)
├── local_proxy.py         # Standalone local command proxy
├── index.html             # Player entry point (device detection + poller)
├── dist/
│   └── stbPlayer.js       # Built player bundle (TypeScript → ES5, minified)
├── src/                   # TypeScript sources (13 modules)
├── stb/
│   ├── core.js            # Shared STB implementation
│   └── {device}/stb.js    # Per-device key mappings (24 types)
├── stbPlayer/
│   ├── 1280.css           # Player styles
│   ├── _*.js              # Localization files (21 languages)
│   ├── icon.png           # Player icon
│   └── buffering.gif      # Loading indicator
├── prov/                  # IPTV provider scripts
├── js/                    # CDN libraries (HLS.js, Shaka, jQuery)
└── fonts/                 # Local fonts
```

## STB Key Mappings

- **Samsung Tizen**: `RETURN=10009`, `ENTER=10008`, color 10300-10303
- **Samsung Maple**: dpad 4/5/6/8, original SDK codes
- **LG WebOS**: `RETURN=461`, HbbTV-compatible colors
- **LG NetCast**: `RETURN=8`, HbbTV codes
- **MAG**: `RETURN=8`, gSTB API for MAC
- **Dune HD**: standard codes, Dune API
- **Android TV**: Android keycodes (`BACK=4`, `DPAD_*` 19-22, `ENTER=66`)
- **HbbTV/Panasonic/Philips/Sony/etc.**: HbbTV codes (`RED=403`, `BLUE=406`, `VOL_UP=447`)

## Documentation

- [System Architecture](./.github/docs/system-architecture.md) — End-to-end architecture: startup sequence, key-press dispatch, channel tuning, PiP, EPG, archive/timeshift, and per-provider data flows.
- [Channels Phase D Cluster Map](./docs/channels-phase-d-map.md) — clusters in `src/channels/index.ts` with extract recommendations (Phase D1).

## License

FOSS — free and open source.

## Desktop updater / notarization (Mode B)

Optional Tauri auto-updater (GitHub Releases) and macOS notarization hooks are documented in [docs/tauri-updater-notarize.md](docs/tauri-updater-notarize.md). Release CI skips signing/notarize when secrets are absent.

## Local Mac build helpers

See [docs/local-build-scripts.md](docs/local-build-scripts.md).
