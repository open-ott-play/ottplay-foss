#!/usr/bin/env bash
# Remove the ottplay-foss-local launchd user agents and stop the services.
# By default removes ALL instances (base :8095, extra :8096/:8097).
# ~/ottplay-foss-local is left untouched.
#
# Usage: scripts/uninstall-ottplay-local-service.sh
# Env overrides: OTTPLAY_LABEL (single label only), OTTPLAY_PORT (single port)
set -euo pipefail

if [ -n "${OTTPLAY_LABEL:-}" ]; then
    LABELS="${OTTPLAY_LABEL}"
else
    LABELS="com.ottplay-foss-local com.ottplay-foss-local-2 com.ottplay-foss-local-3"
fi

for LABEL in $LABELS; do
    PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
    if [ -f "$PLIST" ]; then
        launchctl unload "$PLIST" 2>/dev/null || true
        rm -f "$PLIST"
        echo "removed: $PLIST"
    else
        echo "not installed: $PLIST"
    fi
done

pkill -f "$HOME/ottplay-foss-local/ottplay-server" 2>/dev/null \
    && echo "stopped leftover process(es)" || true
for PORT in ${OTTPLAY_PORT:-8095 8096 8097}; do
    # shellcheck disable=SC2046  # pids are numeric, splitting is safe
    kill $(lsof -t -iTCP:"$PORT" -sTCP:LISTEN) 2>/dev/null || true
done

# Best-effort: drop the self-signed cert from System keychain trust.
CRT="$HOME/ottplay-foss-local/certs/server.crt"
if [ -f "$CRT" ]; then
    sudo -n security delete-certificate -c "OTT-play Local" /Library/Keychains/System.keychain 2>/dev/null \
        && echo "cert removed from System keychain" || true
fi
echo "done (~/ottplay-foss-local kept; reinstall with scripts/install-local-stack.sh)"
