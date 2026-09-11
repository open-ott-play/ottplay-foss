#!/usr/bin/env bash
# Build OttPlay FOSS Capacitor Android APK/AAB locally.
# Pattern mirrors inverter-desktop/build-android-local.sh (Cap instead of Tauri Android).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

OUTPUT_DIR="dist/android"
APP_ID="play.ott.foss"

ANDROID_KEYSTORE_PATH="${ANDROID_KEYSTORE_PATH:-}"
ANDROID_KEYSTORE_PASSWORD="${ANDROID_KEYSTORE_PASSWORD:-}"
ANDROID_KEY_ALIAS="${ANDROID_KEY_ALIAS:-}"
ANDROID_KEY_PASSWORD="${ANDROID_KEY_PASSWORD:-}"
SIGN_APK="${SIGN_APK:-false}"

VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "0.0.0")

usage() {
  echo "Usage: $0 [--clean] [--dev] [--sign] [--update-deps]"
  echo "  --clean         Remove node_modules / android build outputs before starting"
  echo "  --dev           Build debug APK instead of release"
  echo "  --sign          Sign release APK (requires keystore env vars)"
  echo "  --update-deps   npm update before building"
  echo ""
  echo "Env for signing:"
  echo "  ANDROID_KEYSTORE_PATH ANDROID_KEYSTORE_PASSWORD ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD"
  exit 1
}

CLEAN=false
RELEASE=true
UPDATE_DEPS=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --clean) CLEAN=true; shift ;;
    --dev) RELEASE=false; shift ;;
    --sign) SIGN_APK=true; shift ;;
    --update-deps) UPDATE_DEPS=true; shift ;;
    --help|-h) usage ;;
    *) usage ;;
  esac
done

echo "╔══════════════════════════════════════════════════════╗"
echo "║  OttPlay FOSS — Android (Capacitor) local build      ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║  1. Prerequisites (Java, Android SDK)                ║"
echo "║  2. npm install                                      ║"
echo "║  3. npm run build:mobile (vite + cap sync)           ║"
echo "║  4. gradlew assembleRelease / assembleDebug          ║"
echo "╚══════════════════════════════════════════════════════╝"
echo "  version=$VERSION appId=$APP_ID"
echo ""

if [[ -f .env.local ]]; then
  echo "===> Loading .env.local..."
  set -o allexport
  # shellcheck disable=SC1091
  source .env.local
  set +o allexport
fi

if [[ "$CLEAN" == true ]]; then
  echo "===> Cleaning..."
  rm -rf node_modules dist android/app/build android/.gradle
  echo "  ✓ Cleaned"
fi

command -v npm >/dev/null 2>&1 || { echo "  ✗ npm not found"; exit 1; }

if ! command -v java >/dev/null 2>&1; then
  echo "  → Installing Java 21 (temurin@21)..."
  brew install --cask temurin@21
fi
if [[ -z "${JAVA_HOME:-}" ]]; then
  JAVA_HOME=$(/usr/libexec/java_home -v 21 2>/dev/null || /usr/libexec/java_home 2>/dev/null || true)
  [[ -n "${JAVA_HOME:-}" ]] && export JAVA_HOME
fi
echo "  ✓ Java: $(java -version 2>&1 | head -1)"

if [[ -z "${ANDROID_HOME:-}" ]]; then
  for dir in "$HOME/Library/Android/sdk" "/opt/homebrew/share/android-commandlinetools"; do
    if [[ -d "$dir" ]]; then ANDROID_HOME="$dir"; break; fi
  done
fi
if [[ -z "${ANDROID_HOME:-}" || ! -d "$ANDROID_HOME" ]]; then
  echo "  ✗ ANDROID_HOME not set / SDK missing. Install Android Studio or cmdline-tools." >&2
  exit 1
fi
export ANDROID_HOME ANDROID_SDK_ROOT="$ANDROID_HOME"
echo "  ✓ ANDROID_HOME=$ANDROID_HOME"

echo ""
if [[ "$UPDATE_DEPS" == true ]]; then
  echo "===> Updating dependencies..."
  npm update && npm install
else
  echo "===> Installing dependencies (npm ci)..."
  npm ci
fi

echo ""
echo "===> Building web + Capacitor sync..."
npm run build:mobile

echo ""
if [[ "$RELEASE" == true ]]; then
  echo "===> assembleRelease (+ optional bundleRelease)..."
  (cd android && ./gradlew assembleRelease)
  (cd android && ./gradlew bundleRelease) || echo "  (bundleRelease skipped)"
else
  echo "===> assembleDebug..."
  (cd android && ./gradlew assembleDebug)
fi

mkdir -p "$OUTPUT_DIR"
if [[ "$RELEASE" == true ]]; then
  APK=$(find android/app/build/outputs/apk -name '*release*.apk' | head -1 || true)
  AAB=$(find android/app/build/outputs/bundle -name '*release*.aab' 2>/dev/null | head -1 || true)
else
  APK=$(find android/app/build/outputs/apk -name '*debug*.apk' | head -1 || true)
  AAB=""
fi

if [[ -z "${APK:-}" ]]; then
  echo "  ✗ No APK found under android/app/build/outputs" >&2
  find android/app/build/outputs -type f \( -name '*.apk' -o -name '*.aab' \) 2>/dev/null || true
  exit 1
fi

OUT_APK="$OUTPUT_DIR/ottplay-foss-${VERSION}-$([ "$RELEASE" = true ] && echo release || echo debug).apk"
cp "$APK" "$OUT_APK"
echo "  ✓ APK → $OUT_APK"
if [[ -n "${AAB:-}" ]]; then
  OUT_AAB="$OUTPUT_DIR/ottplay-foss-${VERSION}-release.aab"
  cp "$AAB" "$OUT_AAB"
  echo "  ✓ AAB → $OUT_AAB"
fi

if [[ "$RELEASE" == true && "$SIGN_APK" == true ]]; then
  echo ""
  echo "===> Signing..."
  if [[ -z "$ANDROID_KEYSTORE_PATH" || -z "$ANDROID_KEYSTORE_PASSWORD" || -z "$ANDROID_KEY_ALIAS" ]]; then
    echo "  ✗ Missing keystore env vars" >&2
    exit 1
  fi
  ALIGNED="$OUTPUT_DIR/ottplay-foss-${VERSION}-release-aligned.apk"
  zipalign -f 4 "$OUT_APK" "$ALIGNED"
  apksigner sign --ks "$ANDROID_KEYSTORE_PATH" \
    --ks-pass "pass:$ANDROID_KEYSTORE_PASSWORD" \
    --ks-key-alias "$ANDROID_KEY_ALIAS" \
    --key-pass "pass:${ANDROID_KEY_PASSWORD:-$ANDROID_KEYSTORE_PASSWORD}" \
    "$ALIGNED"
  echo "  ✓ Signed $ALIGNED"
fi

echo ""
echo "========================================"
echo "  Android build complete!"
echo "  Artifacts: $OUTPUT_DIR/"
ls -1 "$OUTPUT_DIR" || true
echo "========================================"
date
