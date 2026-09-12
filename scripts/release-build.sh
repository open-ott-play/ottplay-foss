#!/usr/bin/env bash
# Build local artifacts without publishing or deploying. Dependencies must be installed.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="${1:?Usage: release-build.sh X.Y.Z [nightly|beta|rc]}"
CHANNEL="${2:-rc}"
python3 scripts/check-release-version.py "$VERSION" "$CHANNEL"
mkdir -p release-output
npm run build
npm run check:bundle
npm run check:es5
tar -czf release-output/ottplay-foss-dist.tar.gz index.html favicon.ico dist fonts js stb stbPlayer prov
npm run package:modea
cp dist/ottplay-foss-modea.tar.gz dist/ottplay-foss-modea.sha256 release-output/
