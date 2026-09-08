#!/bin/bash
set -e
cd "$(dirname "$0")/.."
SRC="src-tauri/icons"
# iOS 1024 marketing icon
cp "$SRC/ios/AppIcon-512@2x.png" ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
# Android mipmaps from 512 source
for size in mdpi hdpi xhdpi xxhdpi xxxhdpi; do
    case "$size" in
        mdpi) dim=48 ;;
        hdpi) dim=72 ;;
        xhdpi) dim=96 ;;
        xxhdpi) dim=144 ;;
        xxxhdpi) dim=192 ;;
    esac
    sips -z "$dim" "$dim" "$SRC/icon.png" --out "android/app/src/main/res/mipmap-${size}/ic_launcher.png" >/dev/null
    sips -z "$dim" "$dim" "$SRC/icon.png" --out "android/app/src/main/res/mipmap-${size}/ic_launcher_round.png" >/dev/null
done
echo "Icons regenerated from $SRC"
