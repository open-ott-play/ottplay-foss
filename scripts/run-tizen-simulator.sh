#!/usr/bin/env bash
# Launch Samsung's separately installed TV Web Simulator (NW.js).
# This is a UI/API simulator; it does not run the Tizen TV firmware.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
    cat <<'EOF'
Usage: scripts/run-tizen-simulator.sh [options]

  --sdk DIRECTORY   Tizen Studio root, sec-tv-simulator directory, or nwjs.app
                    (TIZEN_SIMULATOR_SDK; otherwise the user-local package or
                    ~/tizen-studio)
  --url URL         Running player (default: http://127.0.0.1:8443/;
                    OTTP_PLAYER_URL)
  --app FILE        Open another local Tizen app with adjacent config.xml
  --home            Open the simulator home instead of the player
  --dry-run         Prepare the player app and print the command without
                    checking the server or launching the simulator
  -h, --help        Show this help

Requires Samsung TV Web Simulator for macOS. Intel builds use macOS Rosetta.
The script does not install an SDK, accept licenses, build or serve the player.
By default it prepares a manifest/redirect app for the existing local stack.
--url, --app and --home are mutually exclusive. If the simulator is already
running, quit it normally before launching a different app.
Hosted web applications, DRM and real HLS playback are not supported by this
simulator. Use a separate local Tizen app directory with config.xml for UI/API
checks; the SDK copies the entire directory containing the HTML entry point.
EOF
}

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
need_value() { [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || die "$1 requires a value"; }

sdk="${TIZEN_SIMULATOR_SDK:-}"
app=""
launch_mode=""
dry_run=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --sdk) need_value "$@"; sdk="$2"; shift 2 ;;
        --url)
            need_value "$@"; [[ -z "$launch_mode" ]] || die "--url, --app and --home are mutually exclusive"
            launch_mode=player; export OTTP_PLAYER_URL="$2"; shift 2 ;;
        --app)
            need_value "$@"; [[ -z "$launch_mode" ]] || die "--url, --app and --home are mutually exclusive"
            launch_mode=app; app="$2"; shift 2 ;;
        --home)
            [[ -z "$launch_mode" ]] || die "--url, --app and --home are mutually exclusive"
            launch_mode=home; shift ;;
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

if [[ -z "$launch_mode" || "$launch_mode" == player ]]; then
    command -v node >/dev/null || die "Node.js is required"
    player_url="$(node "$SCRIPT_DIR/prepare-tizen-simulator.cjs" --print-url)"
    if [[ "$dry_run" == 0 ]]; then
        command -v curl >/dev/null || die "curl is required"
        origin="$(OTTP_PLAYER_URL="$player_url" node -e 'process.stdout.write(new URL(process.env.OTTP_PLAYER_URL).origin)')"
        curl --globoff --fail --silent --show-error --connect-timeout 3 --max-time 10 "$origin/health" >/dev/null ||
            die "Player companion is unavailable at $origin. Start the existing local stack first; 8090 is the playlist proxy, not the player."
        curl --globoff --fail --silent --show-error --connect-timeout 3 --max-time 10 "$player_url" >/dev/null ||
            die "The companion is running, but the player page is unavailable."
    fi
    OTTP_PLAYER_URL="$player_url" node "$SCRIPT_DIR/prepare-tizen-simulator.cjs"
    app="$PROJECT_ROOT/build/device-tizen-simulator/index.html"
fi

command_args=("$simulator")
if [[ -n "$app" ]]; then
    [[ -f "$app" ]] || die "Local HTML entry point not found: $app"
    case "$app" in
        *.html|*.htm|*.HTML|*.HTM) ;;
        *) die "--app must name a local HTML entry point, not a URL or .wgt package" ;;
    esac
    app_directory="$(dirname -- "$app")"
    [[ -f "$app_directory/config.xml" ]] || die "Local Tizen app manifest not found: $app_directory/config.xml. --app requires an HTML entry point with an adjacent config.xml."
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
