#!/usr/bin/env bash
set -euo pipefail
TARGET="${TAURI_TARGET:-}"
mkdir -p tauri-artifacts
shopt -s nullglob
if [ -n "$TARGET" ]; then
  BASE="src-tauri/target/$TARGET/release/bundle"
else
  BASE="src-tauri/target/release/bundle"
fi
for f in \
  "$BASE"/dmg/*.dmg \
  "$BASE"/deb/*.deb \
  "$BASE"/rpm/*.rpm \
  "$BASE"/appimage/*.AppImage \
  "$BASE"/msi/*.msi \
  "$BASE"/nsis/*setup*.exe
do
  name="$(basename "$f")"
  ext="${name##*.}"
  base="${name%.*}"
  dest="tauri-artifacts/${base}${TARGET:+_${TARGET}}.${ext}"
  cp -v "$f" "$dest"
done
if [[ "${RUNNER_OS}" == "macOS" ]]; then
  for app in "$BASE"/macos/*.app; do
    app_base="$(basename "$app" .app)"
    dest="tauri-artifacts/${app_base}${TARGET:+_${TARGET}}.app.zip"
    ditto -c -k --sequesterRsrc --keepParent "$app" "$dest"
  done
fi
echo Collected:
ls -la tauri-artifacts/
test "$(ls -A tauri-artifacts)" || { echo No bundles found; exit 1; }
