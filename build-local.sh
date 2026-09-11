#!/usr/bin/env bash
# Build OttPlay FOSS Tauri desktop, install to /Applications, and launch.
# Pattern mirrors inverter-desktop/build-local.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

APP_NAME="OttPlay FOSS"
BUNDLE_ID="com.ottplay.foss"
BUNDLE_DIR="src-tauri/target/release/bundle"

UPDATE_DEPS=false
CLEAN=false
NO_OPEN=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --update-deps) UPDATE_DEPS=true; shift ;;
    --clean) CLEAN=true; shift ;;
    --no-open) NO_OPEN=true; shift ;;
    -h|--help)
      echo "Usage: $0 [--clean] [--update-deps] [--no-open]"
      exit 0
      ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ "$CLEAN" == true ]]; then
  echo "===> Cleaning project..."
  rm -rf node_modules dist src-tauri/target
  echo "  ✓ Cleaned"
fi

echo ""
if [[ "$UPDATE_DEPS" == true ]]; then
  echo "===> Updating dependencies..."
  npm update
  echo ""
  echo "===> Regenerating lockfile..."
  npm install
  echo ""
  echo "  ⚠  Commit package-lock.json before building:"
  echo "      git add package-lock.json && git commit -m 'chore: update deps'"
else
  echo "===> Installing dependencies (ci / frozen lockfile)..."
  npm ci
fi

echo ""
echo "===> Building Tauri application..."
# Prefer npm script if present; fall back to npx
if npm run | grep -qE '^  tauri'; then
  npm run tauri -- build
else
  npx tauri build
fi

echo "===> Killing running instances of '${APP_NAME}'..."
pkill -f "${APP_NAME}" 2>/dev/null && echo "  ✓ Killed" || echo "  (not running)"
# Also match common binary names
pkill -f 'ottplay-foss|OttPlay.FOSS' 2>/dev/null || true

echo ""
echo "===> Clearing WKWebView NetworkCache..."
rm -rf "$HOME/Library/Caches/${BUNDLE_ID}/WebKit/NetworkCache" 2>/dev/null || true
echo "  ✓ $HOME/Library/Caches/${BUNDLE_ID}/WebKit/NetworkCache"

echo ""
echo "===> Installing ${APP_NAME} to /Applications..."
APP_BUNDLE="${BUNDLE_DIR}/macos/${APP_NAME}.app"
# Spaces may be dots in some collect paths
if [[ ! -d "$APP_BUNDLE" ]]; then
  ALT=$(find "$BUNDLE_DIR/macos" -maxdepth 1 -type d -name '*.app' 2>/dev/null | head -1 || true)
  if [[ -n "${ALT:-}" ]]; then
    APP_BUNDLE="$ALT"
  fi
fi
if [[ -d "$APP_BUNDLE" ]]; then
  DEST="/Applications/${APP_NAME}.app"
  rm -rf "$DEST"
  cp -R "$APP_BUNDLE" "$DEST"
  echo "  ✓ Installed to $DEST"
else
  echo "  ✗ Bundle not found under ${BUNDLE_DIR}/macos/" >&2
  ls -la "${BUNDLE_DIR}/macos/" 2>/dev/null || true
  echo "    DMG (if any): ${BUNDLE_DIR}/dmg/" >&2
  exit 1
fi

echo ""
echo "========================================"
echo "  Build complete!"
echo "  App:  /Applications/${APP_NAME}.app"
echo "  DMG:  ${BUNDLE_DIR}/dmg/"
echo "========================================"

if [[ "$NO_OPEN" != true ]]; then
  open -a "${APP_NAME}"
fi
date
