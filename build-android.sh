#!/bin/bash
set -e

echo "=== Building Solid 2.0 Playground Android AAB ==="

# 1. Build web app
echo "Building web app..."
npm run build

# 2. Sync to Android
echo "Syncing to Android..."
npx cap sync android

# 3. Build release bundle
echo "Building release AAB..."
cd android
./gradlew bundleRelease

# 4. Copy to project root
echo "Copying AAB to project root..."
cp app/build/outputs/bundle/release/app-release.aab ../Solid2Playground-v$(date +%Y%m%d).aab

echo "=== Build complete! ==="
echo "AAB location: Solid2Playground-$(date +%Y%m%d).aab"
