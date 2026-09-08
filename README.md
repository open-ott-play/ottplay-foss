# OTT-play FOSS

Self-contained IPTV/OTT player with a local Rust HTTP server. Runs on Smart TVs (LG WebOS, Samsung Tizen, Panasonic, Sony, etc.), set-top boxes (Infomir MAG, Dune HD, Enigma2, Android TV), and desktop browsers.

## Features

- **Playback**: HLS, DASH, plain HTTP streams via HLS.js and Shaka Player; soft live reconnect on fatal HLS parse/network
- **EPG**: XMLTV guide with fuzzy channel matching, time-shift/catch-up, denser guide rows, programme-title search (N5 in EPG), reminders before timers
- **Favorites**: Multi-list favorites (switch/add/rename/delete from Actions → Favorite lists); parental PIN
- **Settings**: Export/import settings + favorites as JSON; continue-watching archive resume bookmark
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

```bash
npm install
npm run build:mobile          # vite build + cap copy + cap sync
npm run cap:ios               # open in Xcode
npm run cap:android           # open in Android Studio
```

See [docs/capacitor-mobile.md](docs/capacitor-mobile.md) for prerequisites, configuration, and gaps.

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
# Mode B / Capacitor (default 127.0.0.1:18081)
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
