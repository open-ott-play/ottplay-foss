# mobile-command-queue

Capacitor plugin for the native HTTP command queue (prefer `localhost:18081`, fall back through `18082..=18090` when busy).

Implements the same HTTP contract as `local_proxy.py` and Tauri `queue.rs`:
- `POST /api/webhook/commands` (alias `/webhook/notify`) — enqueue a command
- `GET /api/webhook/commands` (alias `/webhook/poll`) — poll + drain pending commands
- `?device_id=<id>` — per-device routing
- Commands expire after 60s; caps: per-device 50 (trim 25), broadcast 100 (trim 50)
- CORS headers + OPTIONS preflight

## Platforms

- **iOS**: `ios/App/App/Plugins/MobileCommandQueue.swift` — NWListener TCP server
- **Android**: `android/app/src/main/java/play/ott/foss/MobileCommandQueuePlugin.kt` — ServerSocket TCP server
- **Web fallback**: `src/index.ts` — no-op WebPlugin for non-Capacitor builds

## Usage

```typescript
import { MobileCommandQueue } from "mobile-command-queue";

// Start local HTTP server (prefer :18081; auto-started on Capacitor load)
await MobileCommandQueue.start();

// Enqueue a command
await MobileCommandQueue.post({ command: "popup_message", message: "Hello" }, "device-123");

// Poll pending commands (player poller)
const { commands } = await MobileCommandQueue.get("device-123");
commands.forEach(cmd => handleCommand(cmd));
```

## Frontend wiring

`src/index.ts` detects `window.Capacitor` + `MobileCommandQueue`, calls `start()`, and drains via `MobileCommandQueue.get()` every 10s. It does **not** set `local_poll_url` (avoids double-polling the HTTP port).

Mode A (browser/STB) and Tauri Mode B are unaffected.

## Smoke test

```bash
# App (or iOS Simulator) listening on 127.0.0.1:18081
./scripts/smoke-command-queue.sh

# Android emulator / device
adb forward tcp:18081 tcp:18081
./scripts/smoke-command-queue.sh
```

See `docs/capacitor-mobile.md` § Smoke test (curl) + Home Assistant.
