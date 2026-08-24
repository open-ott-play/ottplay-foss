#!/usr/bin/env bash
#
# Deploy ottplay-foss Docker container (run on the Synology NAS, or pipe it:
#   ssh synology 'bash -s' < deploy.sh
# )
#
# Pulls the latest image, replaces any existing container, then verifies
# startup via port availability and HTTP endpoint responses.
#
# Configuration via env:
#   IMAGE       image tag            (default alvit/ottplay-foss:latest)
#   CONTAINER   container name       (default ottplay-foss)
#   PORT        host port            (default 8080)
#   EXTRA_ARGS  extra docker run args (e.g. EPG: '-e OTP_EPG_URL=...')
#

set -euo pipefail

IMAGE="${IMAGE:-alvit/ottplay-foss:latest}"
CONTAINER="${CONTAINER:-ottplay-foss}"
PORT="${PORT:-8080}"
EXTRA_ARGS="${EXTRA_ARGS:-}"
BASE_URL="http://localhost:${PORT}"

log() { echo "[deploy] $*"; }
fail() { echo "[deploy] FAIL: $*" >&2; exit 1; }

command -v docker >/dev/null || fail "docker not found"
command -v curl >/dev/null || fail "curl not found"

# --- pull latest ---
log "Pulling ${IMAGE}..."
docker pull "$IMAGE" || fail "docker pull failed"

# --- replace existing container (running or stopped) ---
if docker ps -a --format '{{.Names}}' | grep -qx "${CONTAINER}"; then
    log "Removing existing container '${CONTAINER}'..."
    docker rm -f "$CONTAINER" >/dev/null || fail "failed to remove old container"
fi

# shellcheck disable=SC2086
docker run -d \
    --name "$CONTAINER" \
    --restart unless-stopped \
    -p "${PORT}:8080" \
    $EXTRA_ARGS \
    "$IMAGE" >/dev/null || fail "docker run failed"

# --- wait for port + HTTP endpoints ---
wait_for() {
    local url="$1" tries="${2:-30}" code=""
    for _ in $(seq 1 "$tries"); do
        code="$(curl -s -o /dev/null -w '%{http_code}' -m 3 "$url" || true)"
        [ "$code" = "200" ] && return 0
        sleep 2
    done
    return 1
}

log "Waiting for ${BASE_URL}/ ..."
wait_for "${BASE_URL}/" || {
    docker logs --tail 20 "$CONTAINER" >&2 || true
    fail "endpoint ${BASE_URL}/ did not return HTTP 200"
}

wait_for "${BASE_URL}/dist/stbPlayer.js" 15 || fail "player bundle endpoint not reachable"

# --- summary ---
log "OK: container '${CONTAINER}' is up."
log "  Image:     $(docker inspect -f '{{.Config.Image}}' "$CONTAINER")"
log "  Started:   $(docker inspect -f '{{.State.StartedAt}}' "$CONTAINER")"
log "  URL:       ${BASE_URL}/"
