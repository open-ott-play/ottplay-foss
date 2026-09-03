#!/usr/bin/env bash
# Install ottplay-foss locally on macOS: rsync this repo to ~/ottplay-foss-local,
# build the player bundle + Rust server binary, register a launchd user agent
# (autostart + KeepAlive) serving ottplay-server, and load it.
#
# Usage: scripts/install-ottplay-local-service.sh
# Env overrides: OTTPLAY_SRC, OTTPLAY_DEST, OTTPLAY_PORT (default 8095 —
#                8090 is taken by hls-proxy), OTTPLAY_HTTPS_PORTS
#                (default "8443 8444 8445 8446" — one process, several HTTPS
#                ports; each port is a separate browser origin, so Chrome
#                keeps isolated player settings per port), OTTPLAY_LABEL,
#                OTTPLAY_RUST_SRC (default ~/victron/ottplay-foss-rust).
# Binds loopback only (--host 127.0.0.1); docker deployments stay wildcard.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${OTTPLAY_SRC:-$(cd "$SCRIPT_DIR/.." && pwd)}"
RUST_SRC="${OTTPLAY_RUST_SRC:-$HOME/victron/ottplay-foss-rust}"
DEST="${OTTPLAY_DEST:-$HOME/ottplay-foss-local}"
PORT="${OTTPLAY_PORT:-8095}"
# OTTPLAY_HTTPS_PORTS: space-separated list of HTTPS ports (one per browser origin).
# Default: 8443 8444 8445 8446 (four origins for isolated player settings).
HTTPS_PORTS="${OTTPLAY_HTTPS_PORTS:-8443 8444 8445 8446}"
LABEL_BASE="${OTTPLAY_LABEL:-com.ottplay-foss-local}"
CERT_DIR="$DEST/certs"
CRT="$CERT_DIR/server.crt"
KEY="$CERT_DIR/server.key"
BIN="$DEST/ottplay-server"

for tool in rsync node npm cargo; do
    command -v "$tool" >/dev/null || { echo "error: $tool not found" >&2; exit 1; }
done

echo "[1/4] sync $SRC -> $DEST"
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
echo "[3/4] certificate"
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

echo "[4/5] build + install Rust binary"
mkdir -p "$DEST"
(cd "$RUST_SRC" && cargo build --release 1>&2)
cp "$RUST_SRC/target/release/ottplay-server" "$BIN"
chmod +x "$BIN"

echo "[5/5] launchd service (http :$PORT, https :$HTTPS_PORTS)"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"

# Stop old services (any variant of the label)
for plist in "$HOME/Library/LaunchAgents/${LABEL_BASE}-"*.plist \
             "$HOME/Library/LaunchAgents/${LABEL_BASE}.plist"; do
    [ -f "$plist" ] || continue
    launch_name="$(/usr/libexec/PlistBuddy -c "Print :Label" "$plist" 2>/dev/null || true)"
    [ -n "$launch_name" ] && launchctl unload "$plist" 2>/dev/null || true
done

LABEL="${LABEL_BASE}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>
    <key>ProgramArguments</key>
    <array>
        <string>$BIN</string>
        <string>--port</string>
        <string>$PORT</string>
        <string>--host</string>
        <string>127.0.0.1</string>
EOF
# Append all HTTPS ports as repeated --https-port flags
for HTTPS_PORT in $HTTPS_PORTS; do
    cat >> "$PLIST" <<EOF
        <string>--https-port</string>
        <string>$HTTPS_PORT</string>
EOF
done
cat >> "$PLIST" <<EOF
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
    <string>$HOME/Library/Logs/${LABEL}.log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/Library/Logs/${LABEL}.log</string>
</dict>
</plist>
EOF
launchctl load "$PLIST"
echo "  loaded $LABEL (https :$HTTPS_PORTS)"

echo "[6/6] verify"
ok=""
for _ in $(seq 1 60); do
    all_up=1
    for HTTPS_PORT in $HTTPS_PORTS; do
        code="$(curl -m 3 -s --cacert "$CRT" -o /dev/null -w '%{http_code}' "https://localhost:$HTTPS_PORT/")" || all_up=0
        [ "$code" = "200" ] || all_up=0
    done
    [ "$all_up" = "1" ] && { ok=1; break; }
    sleep 3
done
if [ -z "$ok" ]; then
    echo "warning: not all services responding — check ~/Library/Logs/${LABEL}.log" >&2
    exit 1
fi
HTTPS_URLS=""
for p in $HTTPS_PORTS; do
    [ -n "$HTTPS_URLS" ] && HTTPS_URLS="$HTTPS_URLS, "
    HTTPS_URLS="${HTTPS_URLS}https://localhost:$p"
done
if [ "$PORT" != "0" ]; then
    code_http="$(curl -s -o /dev/null -w '%{http_code}' -m 3 "http://127.0.0.1:$PORT/")"
    echo "installed: http://127.0.0.1:$PORT/ (HTTP $code_http) + $HTTPS_URLS"
else
    echo "installed: $HTTPS_URLS"
fi
echo "log: ~/Library/Logs/${LABEL}.log"
