#!/usr/bin/env bash
# Install two extra ottplay-foss player instances as launchd services:
#   :8096 (https://localhost:8444, label com.ottplay-foss-local-2)
#   :8097 (https://localhost:8445, label com.ottplay-foss-local-3)
# Same code directory as the base instance; browser settings are isolated
# per origin. Each instance downloads its own EPG copy at first start.
#
# Usage: scripts/install-ottplay-extra-instances.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for spec in "2 8096" "3 8097"; do
    # shellcheck disable=SC2086  # intentional word split of "idx port"
    set -- $spec
    echo "=== instance $1: port $2 ==="
    OTTPLAY_LABEL="com.ottplay-foss-local-$1" OTTPLAY_PORT="$2" \
        "$SCRIPT_DIR/install-ottplay-local-service.sh"
done
