#!/usr/bin/env bash
set -euo pipefail
TARGET="${TAURI_TARGET:-}"
mkdir -p tauri-artifacts
shopt -s nullglob
if [ -n "$TARGET" ]; then
  BASE="target/$TARGET/release/bundle"
else
  BASE="target/release/bundle"
fi

copy_one() {
  local f="$1"
  local name ext base dest
  name="$(basename "$f")"
  # Preserve multi-dot names like .app.tar.gz / .AppImage.sig
  if [[ "$name" == *.app.tar.gz.sig ]]; then
    dest="tauri-artifacts/${name%.app.tar.gz.sig}${TARGET:+_${TARGET}}.app.tar.gz.sig"
  elif [[ "$name" == *.app.tar.gz ]]; then
    dest="tauri-artifacts/${name%.app.tar.gz}${TARGET:+_${TARGET}}.app.tar.gz"
  elif [[ "$name" == *.sig ]]; then
    # e.g. foo.AppImage.sig / foo.msi.sig / foo-setup.exe.sig
    stem="${name%.sig}"
    ext_stem="${stem##*.}"
    base_stem="${stem%.*}"
    dest="tauri-artifacts/${base_stem}${TARGET:+_${TARGET}}.${ext_stem}.sig"
  else
    ext="${name##*.}"
    base="${name%.*}"
    dest="tauri-artifacts/${base}${TARGET:+_${TARGET}}.${ext}"
  fi
  cp -v "$f" "$dest"
}

for f in \
  "$BASE"/dmg/*.dmg \
  "$BASE"/deb/*.deb \
  "$BASE"/rpm/*.rpm \
  "$BASE"/appimage/*.AppImage \
  "$BASE"/appimage/*.AppImage.sig \
  "$BASE"/msi/*.msi \
  "$BASE"/msi/*.msi.sig \
  "$BASE"/nsis/*.exe \
  "$BASE"/nsis/*.exe.sig \
  "$BASE"/macos/*.app.tar.gz \
  "$BASE"/macos/*.app.tar.gz.sig
do
  copy_one "$f"
done

if [[ "${RUNNER_OS:-}" == "macOS" ]]; then
  for app in "$BASE"/macos/*.app; do
    app_base="$(basename "$app" .app)"
    dest="tauri-artifacts/${app_base}${TARGET:+_${TARGET}}.app.zip"
    ditto -c -k --sequesterRsrc --keepParent "$app" "$dest"
  done
fi
echo Collected:
ls -la tauri-artifacts/
if [ ! -e "tauri-artifacts" ] || [ -z "$(ls -A tauri-artifacts 2>/dev/null)" ]; then
  echo "No desktop bundles produced for this matrix entry"
  exit 0
fi
