#!/usr/bin/env bash
# Mode B Tauri desktop-smoke helper (thin).
# Automates what FOSS can without a headed GUI in CI: toolchain checks,
# native project dir presence, optional build/sync/open, and command-queue curl
# against companion :8095 when listening. Human still marks the UI checklist in
# docs/mode-b-tauri-smoke.md.
#
# Usage:
#   ./scripts/smoke-tauri-desktop.sh --help
#   ./scripts/smoke-tauri-desktop.sh --check-src-tauri
#   ./scripts/smoke-tauri-desktop.sh --build
#   ./scripts/smoke-tauri-desktop.sh --check-companion
#   ./scripts/smoke-tauri-desktop.sh --check-companion --require-companion
#   ./scripts/smoke-tauri-desktop.sh --check-ios-tools
#   ./scripts/smoke-tauri-desktop.sh --check-android-tools
#   ./scripts/smoke-tauri-desktop.sh --adb-forward
#   ./scripts/smoke-tauri-desktop.sh --open-ios
#   ./scripts/smoke-tauri-desktop.sh --open-android
#
# Env:
#   BASE_URL           Default http://127.0.0.1:8095 (OTTPLAY_WEB_URL companion).
#   CONNECT_TIMEOUT    curl connect timeout seconds (default 2).
#   DEVICE_ID          Unused for Tauri companion soft curl.
#
# Exit codes:
#   0  ok (queue soft-skip counts as ok unless --require-companion)
#   1  hard failure (missing required tool/dir, build/sync failed, queue required but down)
#   2  queue smoke ran but contract assertion failed
#   3  usage / unknown flag / missing baseline deps
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BASE_URL="${BASE_URL:-${OTTPLAY_WEB_URL:-http://127.0.0.1:8095}}"
BASE_URL="${BASE_URL%/}"
DO_CHECK_SRC=0
DO_BUILD=0
DO_SYNC_ONLY=0
DO_CHECK_COMPANION=0
REQUIRE_COMPANION=0
QUEUE_ALIASES=0
CHECK_IOS_TOOLS=0
CHECK_ANDROID_TOOLS=0
REQUIRE_IOS_TOOLS=0
REQUIRE_ANDROID_TOOLS=0
DO_ADB_FORWARD=0
DO_OPEN_IOS=0
DO_OPEN_ANDROID=0
# Default: always verify node/npm when no action flags given → check-native + soft queue probe
EXPLICIT_ACTION=0

usage() {
  cat <<USAGE
smoke-tauri-desktop.sh — Mode B Tauri desktop-smoke helper (checklist companion).

Does NOT boot simulators/emulators (flaky in CI). Prefer docs/mode-b-tauri-smoke.md
for the human UI checklist; this script automates build/sync/open helpers, dir
presence, toolchain checks, and command-queue curl when Cap is listening.

Flags:
  --check-src-tauri         Verify src-tauri/ and src-tauri/ project dirs exist
  --build           Run: ( cd "$ROOT/src-tauri" && npx tauri build --ci )
  --sync-only            Run: npm run cap:sync  (no vite rebuild)
  --check-companion                Soft curl companion if BASE_URL / OTTPLAY_WEB_URL listening
  --require-companion        With --check-companion: exit 1 if not listening (default: soft-skip)
  --aliases              Pass --aliases through to smoke-command-queue.sh
  --check-ios-tools      Warn if xcrun missing (soft)
  --check-android-tools  Warn if adb missing (soft)
  --require-ios-tools    Fail if xcrun missing
  --require-android-tools Fail if adb missing
  --adb-forward          Run: adb forward tcp:18081 tcp:18081
  --open-ios             Run: npm run cap:ios
  --open-android         Run: npm run cap:android
  -h, --help             Show this help

Env:
  BASE_URL  Default http://127.0.0.1:8095
  DEVICE_ID / CONNECT_TIMEOUT / COMMAND_JSON — forwarded to smoke-command-queue.sh

Default (no action flags): --check-src-tauri + soft --check-companion probe.

Exit: 0 ok, 1 hard fail, 2 queue assertion fail, 3 usage/deps.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check-src-tauri) DO_CHECK_SRC=1; EXPLICIT_ACTION=1; shift ;;
    --build) DO_BUILD=1; EXPLICIT_ACTION=1; shift ;;
    --sync-only) DO_SYNC_ONLY=1; EXPLICIT_ACTION=1; shift ;;
    --check-companion) DO_CHECK_COMPANION=1; EXPLICIT_ACTION=1; shift ;;
    --require-companion) REQUIRE_COMPANION=1; shift ;;
    --aliases) QUEUE_ALIASES=1; shift ;;
    --check-ios-tools) CHECK_IOS_TOOLS=1; EXPLICIT_ACTION=1; shift ;;
    --check-android-tools) CHECK_ANDROID_TOOLS=1; EXPLICIT_ACTION=1; shift ;;
    --require-ios-tools) REQUIRE_IOS_TOOLS=1; CHECK_IOS_TOOLS=1; EXPLICIT_ACTION=1; shift ;;
    --require-android-tools) REQUIRE_ANDROID_TOOLS=1; CHECK_ANDROID_TOOLS=1; EXPLICIT_ACTION=1; shift ;;
    --adb-forward) DO_ADB_FORWARD=1; EXPLICIT_ACTION=1; shift ;;
    --open-ios) DO_OPEN_IOS=1; EXPLICIT_ACTION=1; shift ;;
    --open-android) DO_OPEN_ANDROID=1; EXPLICIT_ACTION=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 3
      ;;
  esac
done

if [[ "$EXPLICIT_ACTION" -eq 0 ]]; then
  DO_CHECK_SRC=1
  DO_CHECK_COMPANION=1
fi

need_cmd() {
  local c="$1"
  if ! command -v "$c" >/dev/null 2>&1; then
    echo "error: missing required command: $c" >&2
    exit 3
  fi
}

# Baseline: node + package manager always required for Cap workflow honesty
need_cmd node
need_cmd npm

echo "ok: node=$(command -v node)  npm=$(command -v npm)"

if [[ "$CHECK_IOS_TOOLS" -eq 1 || "$REQUIRE_IOS_TOOLS" -eq 1 ]]; then
  if command -v xcrun >/dev/null 2>&1; then
    echo "ok: xcrun=$(command -v xcrun)"
  else
    if [[ "$REQUIRE_IOS_TOOLS" -eq 1 ]]; then
      echo "error: xcrun not found (install Xcode / CLT)" >&2
      exit 1
    fi
    echo "soft-skip: xcrun not found (iOS Simulator tools unavailable on this host)"
  fi
fi

if [[ "$CHECK_ANDROID_TOOLS" -eq 1 || "$REQUIRE_ANDROID_TOOLS" -eq 1 ]]; then
  if command -v adb >/dev/null 2>&1; then
    echo "ok: adb=$(command -v adb)"
  else
    if [[ "$REQUIRE_ANDROID_TOOLS" -eq 1 ]]; then
      echo "error: adb not found (install Android platform-tools)" >&2
      exit 1
    fi
    echo "soft-skip: adb not found (Android emulator/device tools unavailable)"
  fi
fi

if [[ "$DO_CHECK_SRC" -eq 1 ]]; then
  missing=0
  if [[ ! -d "$ROOT/src-tauri" ]]; then
    echo "error: missing src-tauri/ — run ( cd "$ROOT/src-tauri" && npx tauri build --ci ) or npm run cap:sync first" >&2
    missing=1
  else
    echo "ok: src-tauri/ present"
  fi
  if [[ ! -d "$ROOT/src-tauri" ]]; then
    echo "error: missing src-tauri/ — run ( cd "$ROOT/src-tauri" && npx tauri build --ci ) or npm run cap:sync first" >&2
    missing=1
  else
    echo "ok: src-tauri/ present"
  fi
  if [[ "$missing" -ne 0 ]]; then
    exit 1
  fi
fi

if [[ "$DO_BUILD" -eq 1 ]]; then
  echo "running: ( cd "$ROOT/src-tauri" && npx tauri build --ci )"
  ( cd "$ROOT/src-tauri" && npx tauri build --ci )
  echo "ok: build-sync finished"
fi

if [[ "$DO_SYNC_ONLY" -eq 1 ]]; then
  echo "running: npm run cap:sync"
  npm run cap:sync
  echo "ok: sync-only finished"
fi

if [[ "$DO_ADB_FORWARD" -eq 1 ]]; then
  need_cmd adb
  echo "running: adb forward tcp:18081 tcp:18081"
  adb forward tcp:18081 tcp:18081
  echo "ok: port forward set"
fi

if [[ "$DO_OPEN_IOS" -eq 1 ]]; then
  echo "running: npm run cap:ios"
  npm run cap:ios
fi

if [[ "$DO_OPEN_ANDROID" -eq 1 ]]; then
  echo "running: npm run cap:android"
  npm run cap:android
fi

companion_listening() {
  # TCP-only probe — do NOT HTTP GET /api/webhook/commands (that drains the queue).
  local url="$1"
  local host port
  host="$(python3 -c 'import sys,urllib.parse;u=urllib.parse.urlparse(sys.argv[1]);print(u.hostname or "")' "$url")"
  port="$(python3 -c 'import sys,urllib.parse;u=urllib.parse.urlparse(sys.argv[1]);print(u.port or (443 if u.scheme=="https" else 80))' "$url")"
  if [[ -z "$host" || -z "$port" ]]; then
    return 1
  fi
  if command -v curl >/dev/null 2>&1; then
    # Connect to root path; ignore HTTP status — only care that TCP works.
    curl --silent --output /dev/null --connect-timeout "${CONNECT_TIMEOUT:-2}" --max-time 5 \
      "http://${host}:${port}/" >/dev/null 2>&1
    return $?
  fi
  (echo >/dev/tcp/"$host"/"$port") >/dev/null 2>&1
}

if [[ "$DO_CHECK_COMPANION" -eq 1 ]]; then
  need_cmd curl
  BASE_URL="${BASE_URL%/}"
  probe_url="${BASE_URL}/"
  if ! companion_listening "$probe_url"; then
    echo "soft-skip: companion not listening at ${BASE_URL}"
    echo "  hint: start Mode A companion on :8095 for debug webview, or soft-skip;"
    echo "        release builds embed frontendDist - companion optional"
    echo "        then re-run with --check-companion (or --check-companion --require-companion)"
    if [[ "$REQUIRE_COMPANION" -eq 1 ]]; then
      echo "error: --require-companion set and companion is down" >&2
      exit 1
    fi
  else
  set +e
  code="$(curl --silent --output /dev/null --write-out "%{http_code}" --connect-timeout "${CONNECT_TIMEOUT:-2}" --max-time 5 "${BASE_URL}/" 2>/dev/null)"
  curl_ec=$?
  set -e
  if [[ "$curl_ec" -ne 0 || -z "$code" || "$code" == "000" ]]; then
    echo "error: companion check failed (curl_ec=$curl_ec http=$code)" >&2
    exit 2
  fi
  echo "ok: companion appears reachable at ${BASE_URL} (http $code)"
fi
fi

echo "ok: tauri desktop-smoke helper finished"
echo "reminder: mark the human UI checklist in docs/mode-b-tauri-smoke.md"
exit 0
