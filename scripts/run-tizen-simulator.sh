#!/usr/bin/env bash
# Launch Samsung's separately installed TV Web Simulator (NW.js).
# This is a UI/API simulator; it does not run the Tizen TV firmware.
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: scripts/run-tizen-simulator.sh [options]

  --sdk DIRECTORY   Tizen Studio root, sec-tv-simulator directory, or nwjs.app
                    (TIZEN_SIMULATOR_SDK; otherwise the user-local package or
                    ~/tizen-studio)
  --app FILE        Local HTML entry point to open; omit for the simulator home
  --dry-run         Print the command without launching the simulator
  -h, --help        Show this help

Requires Samsung TV Web Simulator for macOS. Intel builds use macOS Rosetta.
The script does not install an SDK, accept licenses, build or serve the player.
Hosted web applications, DRM and real HLS playback are not supported by this
simulator. Use a local application bundle for UI/API checks.
EOF
}

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
need_value() { [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || die "$1 requires a value"; }

sdk="${TIZEN_SIMULATOR_SDK:-}"
app=""
dry_run=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --sdk) need_value "$@"; sdk="$2"; shift 2 ;;
        --app) need_value "$@"; app="$2"; shift 2 ;;
        --dry-run) dry_run=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) die "Unknown option: $1 (see --help)" ;;
    esac
done

if [[ -z "$sdk" ]]; then
    sdk="$HOME/.local/share/ottplay/tizen-tv-simulator/10.0.6"
    if [[ ! -d "$sdk" ]]; then sdk="$HOME/tizen-studio"; fi
fi
if [[ -d "$sdk" ]]; then
    sdk="$(cd "$sdk" && pwd)"
fi
simulator="$sdk/tools/sec-tv-simulator/nwjs.app/Contents/MacOS/nwjs"
if [[ -x "$sdk/nwjs.app/Contents/MacOS/nwjs" ]]; then
    simulator="$sdk/nwjs.app/Contents/MacOS/nwjs"
elif [[ -x "$sdk/Contents/MacOS/nwjs" ]]; then
    simulator="$sdk/Contents/MacOS/nwjs"
elif [[ -x "$sdk/data/tools/sec-tv-simulator/nwjs.app/Contents/MacOS/nwjs" ]]; then
    simulator="$sdk/data/tools/sec-tv-simulator/nwjs.app/Contents/MacOS/nwjs"
elif [[ -f "$sdk/simulator-app-path.txt" ]]; then
    simulator_relative_path="$(cat "$sdk/simulator-app-path.txt")"
    case "$simulator_relative_path" in
        ""|/*|..|../*|*/..|*/../*|*$'\n'*|*$'\r'*|*\\*) die "Invalid local simulator path marker" ;;
    esac
    case "$simulator_relative_path" in
        nwjs.app|*/nwjs.app) ;;
        *) die "Invalid local simulator path marker" ;;
    esac
    simulator="$sdk/$simulator_relative_path/Contents/MacOS/nwjs"
fi
if [[ ! -x "$simulator" && "$dry_run" == 0 ]]; then
    die "Samsung TV Web Simulator not found at $simulator. Install the TV Extensions simulator package or set --sdk."
fi

command_args=("$simulator")
if [[ -n "$app" ]]; then
    [[ -f "$app" ]] || die "Local HTML entry point not found: $app"
    case "$app" in
        *.html|*.htm|*.HTML|*.HTM) ;;
        *) die "--app must name a local HTML entry point, not a URL or .wgt package" ;;
    esac
    command -v node >/dev/null || die "Node.js is required with --app"
    app_url="$(node -e 'process.stdout.write(require("node:url").pathToFileURL(require("node:path").resolve(process.argv[1])).href)' "$app")"
    # Same --file argument used by Samsung/webIDE-common-tizentv's
    # TVWebApp.launchOnSimulator; keep the URL as one argument.
    command_args+=("--file=$app_url")
fi

printf 'Samsung TV Web Simulator (UI/API checks; not firmware emulation)\n'
printf 'Launch:'
printf ' %q' "${command_args[@]}"
printf '\n'
if [[ "$dry_run" == 0 ]]; then exec "${command_args[@]}"; fi
