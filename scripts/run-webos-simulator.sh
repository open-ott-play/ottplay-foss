#!/usr/bin/env bash
# Run the hosted player in LG's separately installed official Simulator.
# Reuse the local stack; never start a second server or download an SDK.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
    cat <<'EOF'
Usage: scripts/run-webos-simulator.sh [options]

  --version NUMBER  webOS TV version (default: 26; WEBOS_VERSION)
  --url URL         Running player (default: http://127.0.0.1:8443/;
                    OTTP_PLAYER_URL, or legacy OTTP_DEVICE_TEST_PORT)
  --sdk DIRECTORY   Simulator directory (WEBOS_SDK_PATH); otherwise the CLI
                    uses its previously registered SDK location
  --cli PATH        ares-launch executable (WEBOS_CLI; otherwise PATH or
                    ~/.local/share/ottplay/webos-cli/node_modules/.bin/ares-launch)
  --dry-run         Prepare the hosted app and print the command without
                    checking the server or launching the Simulator
  -h, --help        Show this help

Requires Node.js, curl, @webos-tools/cli and the official LG Simulator.
The script does not build, deploy or start the player server.
EOF
}

die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
need_value() { [[ $# -ge 2 && -n "$2" ]] || die "$1 requires a value"; }

version="${WEBOS_VERSION:-26}"
sdk="${WEBOS_SDK_PATH:-}"
cli="${WEBOS_CLI:-}"
dry_run=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --version) need_value "$@"; version="$2"; shift 2 ;;
        --url) need_value "$@"; export OTTP_PLAYER_URL="$2"; shift 2 ;;
        --sdk) need_value "$@"; sdk="$2"; shift 2 ;;
        --cli) need_value "$@"; cli="$2"; shift 2 ;;
        --dry-run) dry_run=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) die "Unknown option: $1 (see --help)" ;;
    esac
done

[[ "$version" =~ ^[1-9][0-9]*$ ]] || die "webOS version must be a positive integer"
command -v node >/dev/null || die "Node.js is required"
player_url="$(node "$SCRIPT_DIR/prepare-webos-simulator.cjs" --print-url)"

if [[ -n "$sdk" ]]; then
    [[ -d "$sdk" ]] || die "Simulator directory not found: $sdk"
    sdk="$(cd "$sdk" && pwd)"
fi
if [[ -z "$cli" ]]; then
    cli="$(command -v ares-launch || true)"
    if [[ -z "$cli" && -x "$HOME/.local/share/ottplay/webos-cli/node_modules/.bin/ares-launch" ]]; then
        cli="$HOME/.local/share/ottplay/webos-cli/node_modules/.bin/ares-launch"
    fi
fi
if [[ -n "$cli" ]]; then
    cli="$(command -v "$cli")" || die "ares-launch is not executable; check --cli or WEBOS_CLI"
    [[ -x "$cli" ]] || die "ares-launch is not executable: $cli"
elif [[ "$dry_run" == 1 ]]; then
    cli=ares-launch
else
    die "ares-launch not found. Install @webos-tools/cli or set WEBOS_CLI (see docs/device-detection-testing.md)."
fi

if [[ "$dry_run" == 0 ]]; then
    command -v curl >/dev/null || die "curl is required"
    origin="$(OTTP_PLAYER_URL="$player_url" node -e 'process.stdout.write(new URL(process.env.OTTP_PLAYER_URL).origin)')"
    curl --globoff --fail --silent --show-error --connect-timeout 3 --max-time 10 "$origin/health" >/dev/null ||
        die "Player companion is unavailable at $origin. Start the existing local stack first; 8090 is the playlist proxy, not the player."
    curl --globoff --fail --silent --show-error --connect-timeout 3 --max-time 10 "$player_url" >/dev/null ||
        die "The companion is running, but the player page is unavailable."
fi

OTTP_PLAYER_URL="$player_url" node "$SCRIPT_DIR/prepare-webos-simulator.cjs"
command_args=("$cli" -s "$version")
if [[ -n "$sdk" ]]; then command_args+=(-sp "$sdk"); fi
command_args+=("$PROJECT_ROOT/build/device-webos-simulator")
printf 'Launch:'
printf ' %q' "${command_args[@]}"
printf '\n'
if [[ "$dry_run" == 0 ]]; then exec "${command_args[@]}"; fi
