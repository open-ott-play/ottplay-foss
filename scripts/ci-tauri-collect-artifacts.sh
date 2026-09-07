#!/usr/bin/env bash
set -euo pipefail
mkdir -p tauri-artifacts
shopt -s nullglob
for f in \
  src-tauri/target/release/bundle/dmg/*.dmg \
  src-tauri/target/release/bundle/deb/*.deb \
  src-tauri/target/release/bundle/rpm/*.rpm \
  src-tauri/target/release/bundle/appimage/*.AppImage \
  src-tauri/target/release/bundle/msi/*.msi \
  src-tauri/target/release/bundle/nsis/*setup*.exe
do
  cp -v "$f" tauri-artifacts/
done
if [[ "${RUNNER_OS}" == "macOS" ]]; then
  for app in src-tauri/target/release/bundle/macos/*.app; do
    base="$(basename "$app" .app)"
    ditto -c -k --sequesterRsrc --keepParent "$app" "tauri-artifacts/${base}.app.zip"
  done
fi
echo Collected:
ls -la tauri-artifacts/
test "$(ls -A tauri-artifacts)" || { echo No bundles found; exit 1; }
