#!/usr/bin/env bash
# Smoke-test the Mode A / Mode B / Capacitor command-queue HTTP contract via curl.
#
# Contract (mirrors local_proxy.py, src-tauri/src/commands/queue.rs,
# MobileCommandQueue on iOS/Android):
#   POST /api/webhook/commands  (alias POST /webhook/notify)
#   GET  /api/webhook/commands  (alias GET  /webhook/poll)
#   Optional ?device_id=<id> for per-device routing (else broadcast)
#   Body: JSON object with a "command" field (Content-Type: application/json)
#   Response POST: {"status":"ok","queued":N}
#   Response GET:  JSON array of pending commands (drained; expire >60s)
#
# Defaults target Mode B / Capacitor loopback (127.0.0.1:18081).
# Mode A companion (local_proxy.py) usually listens on :8081 — override BASE_URL.
#
# Usage:
#   ./scripts/smoke-command-queue.sh
#   BASE_URL=http://127.0.0.1:8081 ./scripts/smoke-command-queue.sh
#   DEVICE_ID=dev_abc123 ./scripts/smoke-command-queue.sh
#   ./scripts/smoke-command-queue.sh --aliases   # also hit /webhook/notify + /webhook/poll
#   ./scripts/smoke-command-queue.sh --help
#
# Exit codes:
#   0  smoke passed
#   1  queue not listening / connection failed
#   2  unexpected HTTP/JSON response
#   3  usage / missing dependency
set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:18081}"
DEVICE_ID="${DEVICE_ID:-}"
COMMAND_JSON="${COMMAND_JSON:-{\"command\":\"popup_message\",\"message\":\"cmd-queue smoke\",\"popup_duration\":3}}"
CONNECT_TIMEOUT="${CONNECT_TIMEOUT:-2}"
TEST_ALIASES=0

usage() {
  cat <<'USAGE'
smoke-command-queue.sh — POST then GET /api/webhook/commands against a live queue.

Env:
  BASE_URL          Default http://127.0.0.1:18081 (Mode B Tauri / Cap).
                    Mode A local_proxy.py: http://127.0.0.1:8081 (or LAN host:8081).
  DEVICE_ID         Optional ?device_id= for per-device routing (empty = broadcast).
  COMMAND_JSON      JSON body to enqueue (default: popup_message smoke).
  CONNECT_TIMEOUT   curl --connect-timeout seconds (default 2).

Flags:
  --aliases         Also smoke POST /webhook/notify and GET /webhook/poll.
  -h, --help        Show this help.

Modes (how to get a listener up before running this script):
  Mode A companion  python3 local_proxy.py 8081
                    BASE_URL=http://127.0.0.1:8081 ./scripts/smoke-command-queue.sh
                    Player: Settings → Remote control → Local command URL =
                      http://<host>:8081/api/webhook/commands
  Tauri Mode B      Launch the desktop app (binds 127.0.0.1:18081). Then:
                    ./scripts/smoke-command-queue.sh
  Capacitor         Run the iOS Simulator app (Mac localhost shared) or Android
                    emulator/device with: adb forward tcp:18081 tcp:18081
                    Then: ./scripts/smoke-command-queue.sh
                    (Cap/Tauri bind loopback only — HA on another host cannot
                    reach :18081 without a tunnel; use Mode A local_proxy for LAN HA.)

Home Assistant (curl-equivalent rest_command; no secrets):
  rest_command:
    ott_tv_command:
      url: "http://127.0.0.1:18081/api/webhook/commands"
      method: POST
      headers:
        Content-Type: application/json
      payload: '{"command":"popup_message","message":"{{ message }}","popup_duration":5}'
  For Mode A / LAN HA, point url at http://<proxy-host>:8081/api/webhook/commands
  (optional ?device_id= from Player settings → Device ID).
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --aliases) TEST_ALIASES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage >&2
      exit 3
      ;;
  esac
done

if ! command -v curl >/dev/null 2>&1; then
  echo "error: curl is required" >&2
  exit 3
fi

# Strip trailing slash from base.
BASE_URL="${BASE_URL%/}"

qs=""
if [[ -n "$DEVICE_ID" ]]; then
  # Query-only; native + proxy do not read device id from headers/body.
  qs="?device_id=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$DEVICE_ID" 2>/dev/null || printf '%s' "$DEVICE_ID")"
fi

primary_post="${BASE_URL}/api/webhook/commands${qs}"
primary_get="${BASE_URL}/api/webhook/commands${qs}"
alias_post="${BASE_URL}/webhook/notify${qs}"
alias_get="${BASE_URL}/webhook/poll${qs}"

curl_common=(
  --silent
  --show-error
  --connect-timeout "$CONNECT_TIMEOUT"
  --max-time 10
  -w "\n%{http_code}"
)

not_listening() {
  local url="$1"
  local detail="${2:-}"
  echo "not listening: cannot reach ${url}" >&2
  if [[ -n "$detail" ]]; then
    echo "  detail: ${detail}" >&2
  fi
  echo "hint: start Mode A (python3 local_proxy.py 8081), Tauri Mode B app, or Cap app;" >&2
  echo "      for Android emulator/device use: adb forward tcp:18081 tcp:18081" >&2
  echo "      override with BASE_URL=... (Mode A often http://127.0.0.1:8081)" >&2
  exit 1
}

# Returns body\nhttp_code on stdout; sets CURL_EC to curl exit status.
do_curl() {
  local out ec
  set +e
  out="$(curl "${curl_common[@]}" "$@" 2>/tmp/ott-cq-smoke-curl.err)"
  ec=$?
  set -e
  if [[ $ec -ne 0 ]]; then
    return 1
  fi
  printf '%s' "$out"
  return 0
}

# Parse curl output that ends with a newline + HTTP status code.
# Sets globals BODY and CODE. Avoids pipe-subshell so callers see the values.
split_body_code() {
  local raw="$1"
  if [[ "$raw" == *$'\n'* ]]; then
    CODE="${raw##*$'\n'}"
    BODY="${raw%$'\n'*}"
  else
    BODY=""
    CODE="$raw"
  fi
}

post_and_check() {
  local url="$1"
  local label="$2"
  local raw err
  echo "==> POST ${label}: ${url}"
  if ! raw="$(do_curl -X POST -H 'Content-Type: application/json' -d "$COMMAND_JSON" "$url")"; then
    err="$(cat /tmp/ott-cq-smoke-curl.err 2>/dev/null || true)"
    not_listening "$url" "$err"
  fi
  BODY=""; CODE=""
  split_body_code "$raw"
  if [[ "$CODE" != "200" ]]; then
    echo "error: POST ${label} expected HTTP 200, got ${CODE}" >&2
    echo "body: ${BODY}" >&2
    exit 2
  fi
  if ! printf '%s' "$BODY" | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'; then
    echo "error: POST ${label} response missing status=ok" >&2
    echo "body: ${BODY}" >&2
    exit 2
  fi
  if ! printf '%s' "$BODY" | grep -q '"queued"'; then
    echo "error: POST ${label} response missing queued count" >&2
    echo "body: ${BODY}" >&2
    exit 2
  fi
  echo "    ok: ${BODY}"
}

get_and_check() {
  local url="$1"
  local label="$2"
  local expect_nonempty="$3" # 1 = expect at least one command with our marker
  local raw err
  echo "==> GET  ${label}: ${url}"
  if ! raw="$(do_curl -X GET -H 'Accept: application/json' "$url")"; then
    err="$(cat /tmp/ott-cq-smoke-curl.err 2>/dev/null || true)"
    not_listening "$url" "$err"
  fi
  BODY=""; CODE=""
  split_body_code "$raw"
  if [[ "$CODE" != "200" ]]; then
    echo "error: GET ${label} expected HTTP 200, got ${CODE}" >&2
    echo "body: ${BODY}" >&2
    exit 2
  fi
  # Must be a JSON array.
  if [[ "${BODY}" != \[* ]]; then
    echo "error: GET ${label} expected JSON array" >&2
    echo "body: ${BODY}" >&2
    exit 2
  fi
  if [[ "$expect_nonempty" == "1" ]]; then
    if ! printf '%s' "$BODY" | grep -q 'popup_message'; then
      echo "error: GET ${label} did not return the enqueued popup_message" >&2
      echo "body: ${BODY}" >&2
      echo "hint: another poller may have drained the queue (player polls ~10s);" >&2
      echo "      re-run quickly, or stop the player poller / use a unique DEVICE_ID." >&2
      exit 2
    fi
  fi
  echo "    ok: ${BODY}"
}

echo "Command queue smoke"
echo "  BASE_URL=${BASE_URL}"
if [[ -n "$DEVICE_ID" ]]; then
  echo "  DEVICE_ID=${DEVICE_ID}"
else
  echo "  DEVICE_ID=(broadcast)"
fi
echo

# Probe reachability with a cheap GET first (empty drain is fine).
echo "==> probe GET ${primary_get}"
if ! raw="$(do_curl -X GET -H 'Accept: application/json' "$primary_get")"; then
  err="$(cat /tmp/ott-cq-smoke-curl.err 2>/dev/null || true)"
  not_listening "$primary_get" "$err"
fi
BODY=""; CODE=""
split_body_code "$raw"
if [[ "$CODE" != "200" ]]; then
  echo "error: probe GET expected HTTP 200, got ${CODE}" >&2
  echo "body: ${BODY}" >&2
  exit 2
fi
echo "    listening (probe body: ${BODY})"
echo

post_and_check "$primary_post" "/api/webhook/commands"
get_and_check "$primary_get" "/api/webhook/commands" 1

if [[ "$TEST_ALIASES" -eq 1 ]]; then
  echo
  post_and_check "$alias_post" "/webhook/notify"
  get_and_check "$alias_get" "/webhook/poll" 1
fi

echo
echo "PASS: command queue POST→GET smoke against ${BASE_URL}"
rm -f /tmp/ott-cq-smoke-curl.err
