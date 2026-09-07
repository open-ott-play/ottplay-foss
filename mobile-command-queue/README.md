# mobile-command-queue

Thin Capacitor plugin stub for the mobile command queue on `localhost:18081`.

Implements the same HTTP contract as `local_proxy.py`:
- `POST /api/webhook/commands` — enqueue a command
- `GET /api/webhook/commands` — poll + drain pending commands
- `?device_id=<id>` — per-device routing

Commands expire after 60s (same as `local_proxy.py`).

## Status

**Stub** — Phase 2 scaffold. Native HTTP server not yet implemented.
The web layer polls a configurable command URL from player settings.

## What is needed

- **iOS**: Swift plugin hosting a lightweight HTTP server on port 18081
- **Android**: Kotlin plugin — same HTTP server logic
- **Web layer**: detect Capacitor environment, default command URL to `http://localhost:18081/api/webhook/commands`

## Usage

```typescript
import { MobileCommandQueue } from "mobile-command-queue";

// Start local HTTP server on localhost:18081
await MobileCommandQueue.start();

// Enqueue a command
await MobileCommandQueue.post({ command: "popup_message", message: "Hello" });

// Poll pending commands (player poller)
const commands = await MobileCommandQueue.get();
```

See `docs/capacitor-mobile.md` for full contract.
