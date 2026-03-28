# Android Build Instructions

## Prerequisites
- Node.js and npm installed
- Android SDK installed (at /opt/android-sdk or ~/Android/Sdk)
- Java 17+ installed

## Build Steps

### 1. Make script executable
```bash
chmod +x build-android.sh
```

### 2. Run the build script
```bash
./build-android.sh
```

### 3. Find your AAB
```bash
ls *.aab
```

---

## How to Bump Version

### Edit android/app/build.gradle
Find and update these lines:

```
versionCode 4        # Increment by 1 (must be higher than previous upload)
versionName "1.1"    # Update version string (can be anything)
```

Example - bump from 1.1 to 1.2:
```
versionCode 5
versionName "1.2"
```

### Important
- `versionCode` MUST increase each upload (Google Play requirement)
- `versionName` is just for display, can be anything
- After editing, run `./build-android.sh` again

---

## Manual Build (without script)

```bash
# Build web app
npm run build

# Sync to Android
npx cap sync android

# Build release bundle
cd android
./gradlew bundleRelease

# AAB location:
# android/app/build/outputs/bundle/release/app-release.aab
```

---

## Troubleshooting

**Build fails with "keystore password incorrect"**
- Check passwords in android/app/build.gradle match your keystore
- Default for this project: storePassword='changeit', keyPassword='changeit'

**Can't find AAB after build**
- Check: android/app/build/outputs/bundle/release/app-release.aab
- Or look for: android/app/build/outputs/apk/release/app-release.apk

**Version already uploaded error**
- Increment versionCode in android/app/build.gradle
- Re-build and re-upload
