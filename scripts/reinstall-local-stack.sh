#!/usr/bin/env bash
# Rebuild the whole local macOS stack from scratch, in order:
#   1. pull live hls-proxy config from Synology docker
#   2. install hls-proxy launchd agent (:8080)
#   3. install base player (~/ottplay-foss-local, :8095 / :8443)
#      - rsync code, npm build, self-signed cert (kept across runs),
#        System keychain trust, launchd agent
#   4. install extra players (:8096/:8444, :8097/:8445)
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
"$SCRIPT_DIR/install-ottplay-extra-instances.sh"

echo
echo "=== local stack rebuilt ==="
echo "hls-proxy :8080 | players http :8095-8097 / https :8443-8445"
