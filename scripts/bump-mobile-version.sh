#!/bin/bash
set -e
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
IFS='.' read -r MA MI P <<< "$VERSION"
VC=$((MA * 10000 + MI * 100 + P))

# Android
sed -i.bak "s/versionName \".*\"/versionName \"$VERSION\"/" android/app/build.gradle
sed -i.bak "s/versionCode [0-9]*/versionCode $VC/" android/app/build.gradle
rm -f android/app/build.gradle.bak

# iOS
sed -i.bak "s/MARKETING_VERSION = .*/MARKETING_VERSION = $VERSION;/g" ios/App/App.xcodeproj/project.pbxproj
sed -i.bak "s/CURRENT_PROJECT_VERSION = [0-9]*;/CURRENT_PROJECT_VERSION = $VC;/g" ios/App/App.xcodeproj/project.pbxproj
rm -f ios/App/App.xcodeproj/project.pbxproj.bak

echo "Bumped to $VERSION (versionCode $VC)"
