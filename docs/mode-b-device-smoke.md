# Capacitor device smoke (Mode B)

Repeatable **iOS Simulator / Android emulator** (and optional real-device) smoke for Mode B Capacitor.
FOSS closes what can be automated without a specific physical device in CI: build/sync/open helpers,
native project presence checks, and command-queue curl against Cap loopback while the app runs.
**A human still marks the UI checklist** on a simulator, emulator, or sideloaded device.

This is **Mode B** (Capacitor / Tauri loopback). Do **not** confuse with Mode A companion smokes
(`./scripts/smoke-modea-companion.sh`, `./scripts/smoke-modea-e2e-play.sh`, etc.) — those need
`ottplay-server` / `local_proxy.py` and are HTTP-only against the companion, not Cap UI.

Related:

- Build / store prep: [`docs/capacitor-mobile.md`](capacitor-mobile.md)
- Command-queue curl: `./scripts/smoke-command-queue.sh` (#328)
- Thin helper: `./scripts/smoke-capacitor-device.sh`

## What is automated vs human

| Step | Automated? | Notes |
| --- | --- | --- |
| Tools present (`node` / `npm`; optional `xcrun` / `adb`) | Yes (helper) | Soft unless `--require-*` |
| `android/` + `ios/` dirs after sync | Yes (helper) | Artifact presence only |
| `npm run build:mobile` / `npm run cap:sync` | Optional (helper flags) | Local; flaky in headless CI if Xcode/SDK missing |
| Open Xcode / Android Studio | Optional (helper flags) | Human continues in IDE |
| Command-queue POST/GET on `:18081+` | Yes when app listening | Soft-skip if not up unless `--require-queue`; Cap+Tauri: `--discover` |
| UI: queue drain / EPG / M3U play / Stalker / swop | **Human** | Simulator, emulator, or real device |
| Paid TestFlight / Play upload | **Out of scope** | Unpaid: sim + sideload APK / free Apple ID only |

## Prerequisites (unpaid store)

Paid Apple Developer / Play Console accounts are **not** required for this smoke.

### iOS (Simulator or local device)

- macOS + Xcode 15+ (Simulator)
- Node.js >= 18, CocoaPods
- Free Apple ID is enough for Simulator and limited personal-team device runs
- **No** TestFlight / App Store Connect upload required here (see store readiness in `capacitor-mobile.md`)

### Android (emulator or sideload)

- Android Studio (or SDK + emulator) **or** a physical device with USB debugging
- Node.js >= 18, `$ANDROID_HOME` when using SDK CLI
- Install **unsigned / debug APK** via Android Studio Run or `adb install` — **no** Play Console

### Optional real device

- Same UI checklist as simulator/emulator
- Android USB: `adb forward tcp:18081 tcp:18081` so host curl reaches Cap loopback
- iOS Simulator shares Mac localhost — no forward needed
- Physical iOS device: Cap binds device loopback; host curl from Mac cannot reach it without a tunnel — prefer Simulator for the automated queue curl, or mark queue UI-only on device

## Build + sync + open

```bash
npm install
npm run build:mobile          # vite build + cap copy + cap sync
npm run cap:ios               # open Xcode (macOS)
npm run cap:android           # open Android Studio
```

Or via helper (best-effort; does not boot simulators by itself):

```bash
./scripts/smoke-capacitor-device.sh --help
./scripts/smoke-capacitor-device.sh --check-native
./scripts/smoke-capacitor-device.sh --build-sync
./scripts/smoke-capacitor-device.sh --open-ios      # or --open-android
```

In Xcode: pick an iPhone Simulator → Run.
In Android Studio: pick an AVD (or USB device) → Run.
Wait until the player UI loads and Cap starts `MobileCommandQueue` (prefers `127.0.0.1:18081`, falls back through `18082..=18090` if busy).

## Automated companion: command-queue curl

With the Cap app running (Simulator, or emulator/device after `adb forward`):

```bash
# iOS Simulator (Mac localhost shared)
./scripts/smoke-command-queue.sh
./scripts/smoke-command-queue.sh --aliases

# Android emulator / USB device
adb forward tcp:18081 tcp:18081
./scripts/smoke-command-queue.sh

# Helper wraps the soft-skip behavior
./scripts/smoke-capacitor-device.sh --queue
./scripts/smoke-capacitor-device.sh --queue --require-queue   # fail if not listening
```

Expect a popup (or queued command drain) in the app when POST succeeds. Soft-skip is intentional when the app is not running — CI without a booted sim should not hard-fail.

## Manual UI checklist (human marks)

Run on **iOS Simulator and/or Android emulator** (optional: real device). Skip rows that need credentials you do not have; note the skip honestly.

### A. Launch + shell

- [ ] App launches without native crash; web UI paints
- [ ] Settings open (F2 / equivalent / on-screen)
- [ ] Device ID visible under Player / Remote settings (optional note)

### B. Command queue (Mode B loopback)

- [ ] With app running, `./scripts/smoke-command-queue.sh` returns exit `0`
- [ ] Enqueued `popup_message` appears (or is drained) in the player
- [ ] Android: `adb forward tcp:18081 tcp:18081` used when curling from host

### C. EPG / XMLTV (Cap `MobileXmltvEpg`)

- [ ] Configure a public or operator XMLTV/EPG source you are allowed to use (no secrets in repo)
- [ ] Channel guide / now-next populates for at least one channel
- [ ] Airplane mode or kill network briefly → stale cache still serves if previously warm (honest offline path)

### D. M3U / media play

- [ ] Add an M3U provider (playlist URL you control or a public test list)
- [ ] Channel list loads
- [ ] Start playback on one stream (HLS / progressive as available)
- [ ] Pause / resume; volume or wake-lock behavior sanity-check
- [ ] Optional Android DASH: ExoPlayer path only when content is DASH; iOS honest reject for unsupported DASH is OK

### E. Stalker portal (FOSS JSON-RPC)

- [ ] Configure portal URL + MAC for a portal that speaks FOSS `stalker_portal/api/` JSON-RPC
- [ ] Handshake + channel list without Mode A companion `:8095`
- [ ] Play one portal-built stream URL
- [ ] **Skip** if no portal URL — mark "skipped: no portal"

### F. `host_ott` / swop dealer-cloud

- [ ] With `host_ott` / `host_ott_proto` set, Enter Provider Code (remote) or cloud send/load reaches `swop/a.php` via native shim (no CORS failure)
- [ ] **Skip** if no `host_ott` — mark "skipped: no host_ott"
- [ ] Mag `load.php` classic handshake is **not** expected in FOSS (allowlist only) — do not fail Cap smoke for Mag JsHttpRequest gaps

### G. Optional Mode A companions (do not mix into Mode B pass/fail)

Only when you also run a Mode A companion for comparison:

```bash
# Separate stack — not Cap UI
./scripts/smoke-modea-companion.sh
./scripts/smoke-modea-e2e-play.sh
```

Record Mode A results separately. Cap device smoke **passes** without Mode A.

## Helper script exit codes

`./scripts/smoke-capacitor-device.sh`:

| Code | Meaning |
| --- | --- |
| `0` | Checks passed (queue soft-skip counts as pass unless `--require-queue`) |
| `1` | Hard failure (missing required tool/dir, build/sync failed, queue required but down) |
| `2` | Queue smoke ran but contract assertion failed |
| `3` | Usage / unknown flag / missing baseline deps (`node`/`npm`/`curl` when needed) |

## Honest remaining human work

- Marking the UI checklist above on sim/emulator/device
- Any portal / playlist / `host_ott` credentials (operator-owned; never commit)
- Paid TestFlight / Play Console upload (store readiness docs only)
- Physical iOS device queue curl from a Mac host without a tunnel
- Headless CI that boots Xcode Simulator / Android emulator (intentionally not required here — flaky and account/SDK heavy)

When the human checklist is done for your targets, the Mode B **device smoke** gap is closed for FOSS; DRM and Mag JsHttpRequest remain separate Remaining items in `capacitor-mobile.md`.
