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
npm run package:modea
cp build/packages/ottplay-foss-modea.tar.gz build/packages/ottplay-foss-modea.sha256 release-output/
# The legacy filename contains exactly the same audited server web root.
cp release-output/ottplay-foss-modea.tar.gz release-output/ottplay-foss-dist.tar.gz
sed 's/  ottplay-foss-modea\.tar\.gz$/  ottplay-foss-dist.tar.gz/' \
  release-output/ottplay-foss-modea.sha256 > release-output/checksums.txt

# A local base build does not allocate a release identity or publish a feed.
# Keep development packages apart from any previously retained release assets.
WEBOS_RELEASE_PLAN="${RELEASE_VERSION_PLAN:-.release-plan.json}"
if [ -f "$WEBOS_RELEASE_PLAN" ]; then
  npm run package:webos -- --plan "$WEBOS_RELEASE_PLAN"
  npm run verify:webos -- --plan "$WEBOS_RELEASE_PLAN"
  npm run package:webos-homebrew -- --plan "$WEBOS_RELEASE_PLAN"
  cp build/packages/ottplay-foss-webos.ipk \
    build/packages/ottplay-foss-webos.sha256 \
    build/packages/ottplay-foss-webos.json \
    build/packages/ottplay-foss-webos-manifest.json \
    build/packages/ottplay-foss-webos-repository.json \
    build/packages/ottplay-foss-webos-icon.png \
    build/packages/ottplay-foss-webos-description.html release-output/
else
  npm run package:webos -- --local
  npm run verify:webos -- --local
  mkdir -p release-output/webos-development
  cp build/packages/ottplay-foss-webos.ipk \
    build/packages/ottplay-foss-webos.sha256 \
    build/packages/ottplay-foss-webos.json release-output/webos-development/
  echo "Development webOS package: release-output/webos-development (no release feed)"
fi
