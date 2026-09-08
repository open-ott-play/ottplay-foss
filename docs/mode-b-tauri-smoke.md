# Tauri desktop smoke (Mode B)

> **Mode B desktop (Tauri).** Sibling of Cap device smoke (`docs/mode-b-device-smoke.md`).
> Debug webview often uses `OTTPLAY_WEB_URL=http://127.0.0.1:8095/`.
> Native PiP: always-on-top `play_pip` / `stop_pip` / `set_pip_bounds` (#285). Unpaid/unsigned OK.
> Helper: `./scripts/smoke-tauri-desktop.sh` - does **not** assert headed play/PiP.

Repeatable **macOS / Windows / Linux** smoke for Mode B Tauri desktop.
FOSS closes what can be automated without a headed GUI in CI: toolchain checks,
`src-tauri/` presence, optional unsigned compile, optional companion curl on `:8095`,
and optional command-queue curl on `:18081` when the desktop app is running.
**A human still marks the UI checklist** on a desktop window (debug or built app).

This is **Mode B desktop** (Tauri). Do **not** confuse with Mode A companion smokes
(`./scripts/smoke-modea-companion.sh`, `./scripts/smoke-modea-e2e-play.sh`, etc.) — those need
`ottplay-server` / `local_proxy.py` and are HTTP-only against the companion, not Cap/Tauri UI.

Related:

- Updater / unsigned local build: [`docs/tauri-updater-notarize.md`](tauri-updater-notarize.md)
- Cap device sibling: [`docs/mode-b-device-smoke.md`](mode-b-device-smoke.md)
- Thin helper: `./scripts/smoke-tauri-desktop.sh`

## What is automated vs human

| Step | Automated? | Notes |
| --- | --- | --- |
| Tools present (`node` / `npm`; optional `cargo` / `rustc`) | Yes (helper) | Soft unless `--require-cargo` |
| `src-tauri/` present | Yes (helper) | Scaffold presence only |
| `npm run build` / `npx tauri build --ci` | Optional (`--build`) | Unsigned CI build inside `src-tauri/` |
| Companion curl on `:8095` | Optional (helper flags) | Soft-skip if not up unless `--require-companion` |
| Command-queue POST/GET on `:18081` | Yes when app listening | Soft-skip if not up unless `--require-queue` |
| UI: window launch / paint / play / PiP | **Human** | Debug or built desktop app |
| Paid notarize / code signing | **Out of scope** | Unpaid: unsigned / local debug OK |

## Prerequisites (unpaid signing OK)

Paid Apple Developer / notarization / Authenticode are **not** required for this smoke.

- **macOS**: Node.js >= 18; Rust toolchain (`cargo` / `rustc`) for build; Xcode Command Line Tools for Tauri system deps
- **Windows**: Node.js >= 18; Rust toolchain; Visual Studio Build Tools
- **Linux**: Node.js >= 18; Rust toolchain; system libs (`webkit2gtk`, `libssl`, etc. per Tauri docs)

No Xcode, Android Studio, CocoaPods, `adb`, or Cap/iOS/Android SDK required.

## Build / run

```bash
npm install
npm run build                  # vite production build
npm run tauri dev              # debug window
npm run tauri build            # unsigned release build
```

Or via helper:

```bash
./scripts/smoke-tauri-desktop.sh --help
./scripts/smoke-tauri-desktop.sh --check-src-tauri
./scripts/smoke-tauri-desktop.sh --build
./scripts/smoke-tauri-desktop.sh --check-companion
./scripts/smoke-tauri-desktop.sh --queue
```

Set `OTTPLAY_WEB_URL=http://127.0.0.1:8095` for debug webview pointing at a local Mode A companion.

## Automated companion curl

When a Mode A companion is listening on `:8095`:

```bash
./scripts/smoke-tauri-desktop.sh --check-companion
./scripts/smoke-tauri-desktop.sh --check-companion --require-companion   # fail if down
```

Soft-skip is intentional when the companion is not running — CI without a local companion should not hard-fail.

## Automated command-queue curl

With the Tauri desktop app running (binds `127.0.0.1:18081`):

```bash
./scripts/smoke-tauri-desktop.sh --check-queue
./scripts/smoke-tauri-desktop.sh --check-queue --require-queue   # fail if not listening
```

Expect a popup (or queued command drain) in the app when POST succeeds.

## Manual UI checklist (human marks)

Run on **macOS / Windows / Linux** desktop window. Skip rows that need credentials you do not have; note the skip honestly.

### A. Launch + shell

- [ ] App launches without native crash; web UI paints
- [ ] Settings open (F2 / equivalent)
- [ ] Window title / size / position behave normally

### B. Playback

- [ ] Add an M3U provider (playlist URL you control or a public test list)
- [ ] Channel list loads
- [ ] Start playback on one stream (HLS / progressive as available)
- [ ] Pause / resume; volume or wake-lock behavior sanity-check

### C. PiP (native)

- [ ] Start playback, trigger native PiP (`play_pip`)
- [ ] Window becomes always-on-top compact player
- [ ] Stop PiP (`stop_pip`) returns to normal window
- [ ] Resize / move via `set_pip_bounds` if exercised

### D. EPG / XMLTV

- [ ] Configure a public or operator XMLTV/EPG source you are allowed to use (no secrets in repo)
- [ ] Channel guide / now-next populates for at least one channel
- [ ] Airplane mode or kill network briefly → stale cache still serves if previously warm (honest offline path)

### E. Stalker portal (FOSS JSON-RPC)

- [ ] Configure portal URL + MAC for a portal that speaks FOSS `stalker_portal/api/` JSON-RPC
- [ ] Handshake + channel list without Mode A companion `:8095`
- [ ] Play one portal-built stream URL
- [ ] **Skip** if no portal URL — mark "skipped: no portal"

### F. `host_ott` / swop dealer-cloud

- [ ] With `host_ott` / `host_ott_proto` set, Enter Provider Code (remote) or cloud send/load reaches `swop/a.php` via native shim (no CORS failure)
- [ ] **Skip** if no `host_ott` — mark "skipped: no host_ott"
- [ ] Mag `load.php` classic handshake is **not** expected in FOSS (allowlist only) — do not fail smoke for Mag JsHttpRequest gaps

### G. Optional Mode A companions (do not mix into Mode B pass/fail)

Only when you also run a Mode A companion for comparison:

```bash
# Separate stack — not Tauri UI
./scripts/smoke-modea-companion.sh
./scripts/smoke-modea-e2e-play.sh
```

Record Mode A results separately. Tauri desktop smoke **passes** without Mode A.

## Helper script exit codes

`./scripts/smoke-tauri-desktop.sh`:

| Code | Meaning |
| --- | --- |
| `0` | Checks passed (queue/companion soft-skip counts as pass unless `--require-*`) |
| `1` | Hard failure (missing required tool/dir, build failed, queue/companion required but down) |
| `2` | Queue/companion smoke ran but contract assertion failed |
| `3` | Usage / unknown flag / missing baseline deps (`node`/`npm`/`curl` when needed) |

## Honest remaining human work

- Marking the UI checklist above on desktop window
- Any portal / playlist / `host_ott` credentials (operator-owned; never commit)
- Paid notarize / code signing (store readiness docs only)
- Headless CI that runs a headed Tauri window (intentionally not required here — flaky without xvfb/headless GL)

When the human checklist is done for your targets, the Mode B **desktop smoke** gap is closed for FOSS; DRM and Mag JsHttpRequest remain separate Remaining items in `tauri-updater-notarize.md`.
