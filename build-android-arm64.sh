#!/bin/bash
# Build script for Android APK on ARM64 hosts using QEMU for x86_64 aapt2
set -e

# Setup QEMU x86_64 environment for aapt2
X86_64_ROOTFS="/opt/android-sdk/x86_64-rootfs"
AGP_AAPT2="/root/.gradle/caches/8.14.3/transforms/514c296624e193fba87763b67440dda2/transformed/aapt2-8.13.0-13719691-linux"

# Create wrapper for AGP aapt2 if not exists
if [ ! -f "${AGP_AAPT2}/aapt2.wrapper" ]; then
    if [ -f "${AGP_AAPT2}/aapt2.original" ]; then
        cat > "${AGP_AAPT2}/aapt2" << 'WRAPPER'
#!/bin/bash
X86_64_ROOTFS="/opt/android-sdk/x86_64-rootfs"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec qemu-x86_64 -L "${X86_64_ROOTFS}/usr" "${SCRIPT_DIR}/aapt2.original" "$@"
WRAPPER
        chmod +x "${AGP_AAPT2}/aapt2"
    fi
fi

# Override aapt2 in gradle.properties
if ! grep -q "android.aapt2FromMavenOverride" android/gradle.properties 2>/dev/null; then
    echo "" >> android/gradle.properties
    echo "# Force use of bundled aapt2 (needed on ARM64)" >> android/gradle.properties
    echo "android.aapt2FromMavenOverride=/opt/android-sdk/build-tools/34.0.0/aapt2" >> android/gradle.properties
fi

# Build
cd /root/tmp/solid-2-playground
pnpm run build
npx cap sync android
cd android
export ANDROID_HOME="/opt/android-sdk"
export ANDROID_SDK_ROOT="/opt/android-sdk"
./gradlew assembleDebug --no-daemon

# Copy APK
cp app/build/outputs/apk/debug/app-debug.apk ../Solid2Playground-debug.apk
echo "APK built: ../Solid2Playground-debug.apk"
