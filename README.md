# OTT-play FOSS

Self-contained IPTV/OTT player with a local Python HTTP server. Runs on Smart TVs (LG WebOS, Samsung Tizen, Panasonic, Sony, etc.), set-top boxes (Infomir MAG, Dune HD, Enigma2, Android TV), and desktop browsers.

## Features

- **Playback**: HLS, DASH, plain HTTP streams via HLS.js and Shaka Player
- **EPG**: XMLTV program guide with fuzzy channel matching, time-shift support
- **Providers**: M3U playlists, Xtream Codes API, Stalker middleware
- **Push commands**: Remote control via webhook — change channel, provider, playlist, show popups
- **Per-device routing**: UUID-based addressing for multi-device setups
- **Local proxy**: Optional local command server for 100% local automation (no central server needed)
- **24 device types**: Per-device remote control key mappings
- **21 languages**: Full localization support

## Quick Start

```bash
# 1. Build the player bundle
npm install
npm run build          # production (minified → dist/stbPlayer.js)

# 2. Start the server
python3 server.py 8080

# 3. Open in browser
# http://localhost:8080
```

On first load: press **F2 (Settings) → Providers → M3U**, enter your playlist URL.

## Build from Source

```
src/
├── polyfills/       # Polyfills for old STBs (String.trim, Math.imul, Array, TextEncoder, Date)
├── utils/           # Utilities (encoding, helpers, LZString compression)
├── storage/         # Storage (localStorage/cookie abstraction)
├── localization/    # Translation (_(), language file loader)
├── settings/        # ~100 player settings with typed interface
├── channels/        # Channel management (data, navigation, favorites, parental)
├── core/            # Playback (HLS.js/Shaka, fullscreen, PiP, audio/subtitle tracks)
├── ui/              # UI (info bar, dialogs, lists, volume, color)
├── keyhandler/      # Remote control key dispatch
├── provider/        # Providers (load, M3U/Xtream/Stalker)
├── commands/        # Push command handler (webhook commands)
└── index.ts         # Entry point, wires all modules
```

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

### Webhook Endpoints (server.py)

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
# Add XMLTV EPG source
python3 server.py 8080 --epg-url http://example.com/epg.xml.gz

# Multiple sources
python3 server.py 8080 --epg-url http://a.com/epg.xml --epg-url http://b.com/epg.xml.gz
```

## Project Structure

```
.
├── server.py              # Local HTTP server (Python)
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

## License

FOSS — free and open source.
