#!/usr/bin/env bash
# Rebuild the whole local macOS stack from scratch, in order:
#   1. pull live hls-proxy config from Synology docker
#   2. install hls-proxy launchd agent (:8090)
#   3. install the single player process (~/ottplay-foss-local, http :8095,
#      https :8443-8446 — one HTTPS port per browser origin = isolated
#      player settings; ports via OTTPLAY_HTTPS_PORTS)
#      - rsync code, npm build, self-signed cert (kept across runs),
#        System keychain trust, launchd agent
# Every step is idempotent and safe to run over a live stack.
#
# Usage: scripts/reinstall-local-stack.sh
# Env: SKIP_SYNC=1 (skip step 1), SYNC_ONLY=1 (only refresh config)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ "${SYNC_ONLY:-0}" = "1" ]; then
    exec "$SCRIPT_DIR/sync-hls-proxy-config.sh"
fi

[ "${SKIP_SYNC:-0}" = "1" ] || "$SCRIPT_DIR/sync-hls-proxy-config.sh"

"$SCRIPT_DIR/install-hls-proxy-service.sh"
"$SCRIPT_DIR/install-ottplay-local-service.sh"

echo
echo "=== local stack rebuilt ==="
echo "hls-proxy :8090 | player http :8095, https :${OTTPLAY_HTTPS_PORTS:-8443 8444 8445 8446}"
