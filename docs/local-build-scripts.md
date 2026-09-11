# Local build scripts (Mac)

Same idea as `inverter-desktop`’s `build-*-local.sh`, adapted for OttPlay FOSS (**Tauri** desktop + **Capacitor** mobile).

| Script | What it does |
| --- | --- |
| `./build-local.sh` | `npm ci` → Tauri release build → install `/Applications/OttPlay FOSS.app` → `open` |
| `./run-tauri-local.sh` | Alias for `build-local.sh` |
| `./build-android-local.sh` | Capacitor Android release/debug APK (and AAB when available) → `dist/android/` |
| `./build-ios-local.sh` | Capacitor unsigned device IPA → `dist/ios/` (sideload; no paid Apple Developer needed) |
| `./build-ios-sim-local.sh` | Capacitor build for Simulator → boot → install → launch |

Common flags: `--clean`, `--update-deps`. Android/iOS also support `--dev`. iOS sim: `--device 'iPhone 16'` or `IOS_SIM_DEVICE=…`.

Tauri: `./build-local.sh --no-open` to skip launch.

`build-local.sh` / `run-tauri-local.sh` pass `--bundles app` so Tauri skips DMG packaging (unreliable in some CI/agent environments). The `.app` under `target/release/bundle/macos/` is what gets copied to `/Applications`.
