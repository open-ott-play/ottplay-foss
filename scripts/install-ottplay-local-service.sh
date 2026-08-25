#!/usr/bin/env bash
# Install ottplay-foss locally on macOS: rsync this repo to ~/ottplay-foss-local,
# build the player bundle, register a launchd user agent (autostart + KeepAlive)
# serving python3 server.py, and load it.
#
# Usage: scripts/install-ottplay-local-service.sh
# Env overrides: OTTPLAY_SRC, OTTPLAY_DEST, OTTPLAY_PORT (default 8095 —
#                8080 is taken by hls-proxy), OTTPLAY_HTTPS_PORT
#                (default PORT+348), OTTPLAY_LABEL.
# Binds loopback only (--host 127.0.0.1); docker deployments stay wildcard.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${OTTPLAY_SRC:-$(cd "$SCRIPT_DIR/.." && pwd)}"
DEST="${OTTPLAY_DEST:-$HOME/ottplay-foss-local}"
PORT="${OTTPLAY_PORT:-8095}"
HTTPS_PORT="${OTTPLAY_HTTPS_PORT:-$((PORT + 348))}"   # 8095→8443, 8096→8444, …
LABEL="${OTTPLAY_LABEL:-com.ottplay-foss-local}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PY="$(command -v python3)"
CERT_DIR="$DEST/certs"
CRT="$CERT_DIR/server.crt"
KEY="$CERT_DIR/server.key"

for tool in rsync node npm "$PY"; do
    command -v "$tool" >/dev/null || { echo "error: $tool not found" >&2; exit 1; }
done

echo "[1/5] sync $SRC -> $DEST"
mkdir -p "$DEST"
rsync -a --delete \
    --exclude .git --exclude node_modules --exclude logs \
    --exclude '*.local.py' --exclude 'certs' \
    "$SRC/" "$DEST/"

echo "[2/4] npm install + build"
cd "$DEST"
npm install --no-audit --no-fund 1>&2
npm run build 1>&2

# Self-signed cert for https://localhost (Chrome warning-free once trusted).
# SAN must cover every name the browser will use.
echo "[3/5] certificate"
mkdir -p "$CERT_DIR"
if [ ! -f "$CRT" ] || [ ! -f "$KEY" ]; then
    LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || true)"
    SAN="DNS:localhost,DNS:$(hostname),IP:127.0.0.1,IP:0:0:0:0:0:0:0:1"
    [ -n "$LAN_IP" ] && SAN="$SAN,IP:$LAN_IP"
    openssl req -x509 -newkey rsa:2048 -sha256 -days 825 -nodes \
        -keyout "$KEY" -out "$CRT" \
        -subj "/CN=OTT-play Local" -addext "subjectAltName=$SAN" 1>&2
    echo "generated: $CRT (SAN: $SAN)"
fi
# Trust it system-wide so Chrome/Safari accept https://localhost without a warning.
if security verify-cert -c "$CRT" >/dev/null 2>&1; then
    echo "cert already trusted"
else
    if sudo -n security add-trusted-cert -d -r trustRoot \
        -k /Library/Keychains/System.keychain "$CRT"; then
        echo "trusted: added to System keychain"
    else
        echo "warning: could not add trust automatically; run manually:" >&2
        echo "  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain '$CRT'" >&2
    fi
fi

echo "[4/5] launchd plist ($LABEL, http :$PORT, https :$HTTPS_PORT)"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$PY</string>
        <string>$DEST/server.py</string>
        <string>$PORT</string>
        <string>--host</string>
        <string>127.0.0.1</string>
        <string>--https-port</string>
        <string>$HTTPS_PORT</string>
        <string>--cert</string>
        <string>$CRT</string>
        <string>--key</string>
        <string>$KEY</string>
    </array>
    <key>WorkingDirectory</key>
    <string>$DEST</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$HOME/Library/Logs/ottplay-foss-local.log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/Library/Logs/ottplay-foss-local.log</string>
</dict>
</plist>
EOF

# shellcheck disable=SC2046  # pids are numeric, splitting is safe
kill $(lsof -t -iTCP:"$PORT" -sTCP:LISTEN) 2>/dev/null || true
sleep 1
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "[5/5] verify"
# First start downloads EPG (~1-2 min) before binding; allow up to 3 min.
ok=""
for _ in $(seq 1 60); do
    code="$(curl -s --cacert "$CRT" -o /dev/null -w '%{http_code}' -m 3 "https://localhost:$HTTPS_PORT/")" || true
    [ "$code" = "200" ] && { ok=1; break; }
    sleep 3
done
if [ -z "$ok" ]; then
    echo "warning: service not responding on :$HTTPS_PORT — check ~/Library/Logs/ottplay-foss-local.log" >&2
    exit 1
fi
code_http="$(curl -s -o /dev/null -w '%{http_code}' -m 3 "http://127.0.0.1:$PORT/")"
PID="$(launchctl list "$LABEL" 2>/dev/null | awk -F'[ =;]+' '/"PID"/{print $2}')"
echo "installed: https://localhost:$HTTPS_PORT/ (cert-verified) + http://127.0.0.1:$PORT/ (HTTP $code_http)"
echo "label $LABEL, pid $PID; log: ~/Library/Logs/ottplay-foss-local.log"
