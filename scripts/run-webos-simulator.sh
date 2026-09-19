#!/usr/bin/env bash
# Run the hosted player in LG's official Simulator; install missing tools.
# Reuse the local stack; never start a second server.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
    cat <<'EOF'
Usage: scripts/run-webos-simulator.sh [options]

  --version NUMBER  webOS TV version (default: 26; WEBOS_VERSION)
  --url URL         Running player (default: http://127.0.0.1:8443/;
                    OTTP_PLAYER_URL, or legacy OTTP_DEVICE_TEST_PORT)
  --sdk DIRECTORY   Simulator directory (WEBOS_SDK_PATH); otherwise reuse a
                    registered installation or install in the user-local path
  --cli PATH        ares-launch executable (WEBOS_CLI; otherwise PATH or
                    ~/.local/share/ottplay/webos-cli/node_modules/.bin/ares-launch)
  --dry-run         Prepare the hosted app and print the command without
                    downloading, checking the server or launching the Simulator
  --no-install      Fail if the Simulator or CLI is missing
  -h, --help        Show this help

Missing LG Simulator 26 (macOS ARM64) and webOS CLI are installed automatically.
Requires Node.js and curl; initial setup also needs Python 3, ditto and npm.
The script does not build, deploy or start the player server.
EOF
}

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
need_value() { [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || die "$1 requires a value"; }

version="${WEBOS_VERSION:-26}"
sdk="${WEBOS_SDK_PATH:-}"
cli="${WEBOS_CLI:-}"
dry_run=0
auto_install=1
while [[ $# -gt 0 ]]; do
    case "$1" in
        --version) need_value "$@"; version="$2"; shift 2 ;;
        --url) need_value "$@"; export OTTP_PLAYER_URL="$2"; shift 2 ;;
        --sdk) need_value "$@"; sdk="$2"; shift 2 ;;
        --cli) need_value "$@"; cli="$2"; shift 2 ;;
        --dry-run) dry_run=1; shift ;;
        --no-install) auto_install=0; shift ;;
        -h|--help) usage; exit 0 ;;
        *) die "Unknown option: $1 (see --help)" ;;
    esac
done

[[ "$version" =~ ^[1-9][0-9]*$ ]] || die "webOS version must be a positive integer"
command -v node >/dev/null || die "Node.js is required"
player_url="$(node "$SCRIPT_DIR/prepare-webos-simulator.cjs" --print-url)"

simulator_ready() {
    local candidate
    [[ -d "$1" ]] || return 1
    for candidate in "$1/webOS_TV_${version}_Simulator_"*; do
        if [[ "$candidate" == *.app && -x "$candidate/Contents/MacOS/$(basename "$candidate" .app)" ]]; then return 0; fi
        if [[ ( "$candidate" == *.appimage || "$candidate" == *.AppImage || "$candidate" == *.exe ) && -x "$candidate" ]]; then return 0; fi
    done
    return 1
}
if [[ -z "$sdk" ]]; then
    registered_sdk="$(node - "$version" <<'JS'
const fs = require('node:fs'), path = require('node:path');
try {
    const config = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.webos/tv/simulator-config.json'), 'utf8'));
    const registered = config[process.argv[2]];
    if (typeof registered === 'string') process.stdout.write(registered);
} catch (_) { /* Missing or stale CLI configuration does not prevent setup. */ }
JS
)"
    for candidate in "$registered_sdk" "$HOME/.local/share/ottplay/webos-tv-simulator/$version" \
        "$HOME/Applications/webOS_TV_${version}_Simulator_"* \
        "${LG_WEBOS_TV_SDK_HOME:-$HOME/.local/share/ottplay/webos-sdk}/Simulator/webOS_TV_${version}_Simulator_"*; do
        if simulator_ready "$candidate"; then sdk="$candidate"; break; fi
    done
    sdk="${sdk:-$HOME/.local/share/ottplay/webos-tv-simulator/$version}"
fi
if [[ -d "$sdk" ]]; then sdk="$(cd "$sdk" && pwd)"; fi
if [[ -z "$cli" ]]; then
    cli="$(command -v ares-launch || true)"
    if [[ -z "$cli" && -x "$HOME/.local/share/ottplay/webos-cli/node_modules/.bin/ares-launch" ]]; then
        cli="$HOME/.local/share/ottplay/webos-cli/node_modules/.bin/ares-launch"
    fi
fi
if [[ -n "$cli" ]]; then
    cli="$(command -v "$cli")" || die "ares-launch is not executable; check --cli or WEBOS_CLI"
    [[ -x "$cli" ]] || die "ares-launch is not executable: $cli"
fi

needs_setup=0
setup_args=(--version "$version" --destination "$sdk")
if ! simulator_ready "$sdk"; then
    needs_setup=1
elif [[ -z "$cli" ]]; then
    needs_setup=1
    setup_args+=(--cli-only)
fi
if [[ "$needs_setup" == 1 && "$auto_install" == 0 ]]; then
    die "LG Simulator or ares-launch is missing; run scripts/setup-webos-simulator.sh or omit --no-install."
fi

if [[ "$dry_run" == 0 ]]; then
    command -v curl >/dev/null || die "curl is required"
    origin="$(OTTP_PLAYER_URL="$player_url" node -e 'process.stdout.write(new URL(process.env.OTTP_PLAYER_URL).origin)')"
    curl --globoff --fail --silent --show-error --connect-timeout 3 --max-time 10 "$origin/health" >/dev/null ||
        die "Player companion is unavailable at $origin. Start the existing local stack first; 8090 is the playlist proxy, not the player."
    curl --globoff --fail --silent --show-error --connect-timeout 3 --max-time 10 "$player_url" >/dev/null ||
        die "The companion is running, but the player page is unavailable."
fi

if [[ "$needs_setup" == 1 ]]; then
    if [[ "$dry_run" == 1 ]]; then
        printf 'Setup:'
        printf ' %q' "$SCRIPT_DIR/setup-webos-simulator.sh" "${setup_args[@]}"
        printf '\n'
    else
        WEBOS_CLI="$cli" bash "$SCRIPT_DIR/setup-webos-simulator.sh" "${setup_args[@]}"
        simulator_ready "$sdk" || die "LG setup finished without a usable Simulator: $sdk"
    fi
fi
if [[ -z "$cli" ]]; then cli="$HOME/.local/share/ottplay/webos-cli/node_modules/.bin/ares-launch"; fi
if [[ "$dry_run" == 0 && ! -x "$cli" ]]; then die "LG setup finished without an executable ares-launch: $cli"; fi

OTTP_PLAYER_URL="$player_url" node "$SCRIPT_DIR/prepare-webos-simulator.cjs"
command_args=("$cli" -s "$version")
if [[ -n "$sdk" ]]; then command_args+=(-sp "$sdk"); fi
command_args+=("$PROJECT_ROOT/build/device-webos-simulator")
printf 'Launch:'
printf ' %q' "${command_args[@]}"
printf '\n'
if [[ "$dry_run" == 0 ]]; then exec "${command_args[@]}"; fi
