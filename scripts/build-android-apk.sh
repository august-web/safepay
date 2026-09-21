#!/usr/bin/env bash
# Builds the release APK using the project-local Android toolchain (no global
# installs) and installs it on the connected phone over wireless ADB.
#
# Usage: npm run apk

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export JAVA_HOME="$ROOT/.tools/jdk-17.0.20.1+1/Contents/Home"
export ANDROID_HOME="$ROOT/.tools/android-sdk"
ADB="$ROOT/.tools/platform-tools/adb"

# The TECNO-class demo phones are 32/64-bit ARM; skipping x86 keeps the build
# and the ~39MB install as fast as possible.
export ORG_GRADLE_PROJECT_reactNativeArchitectures="armeabi-v7a,arm64-v8a"

if [ ! -x "$JAVA_HOME/bin/java" ]; then
  echo "Missing local JDK at $JAVA_HOME" >&2
  echo "Download Temurin 17 into .tools/ — see README (Android build setup)." >&2
  exit 1
fi

echo "▸ Building release APK…"
cd "$ROOT/android"
./gradlew assembleRelease --console=plain

APK="$ROOT/android/app/build/outputs/apk/release/app-release.apk"

# Wireless debugging drops when the phone sleeps and the connect port rotates,
# so re-discover the device over mDNS before installing.
if ! "$ADB" devices | awk '$2 == "device" { found = 1 } END { exit !found }'; then
  echo "▸ Device not connected — trying wireless ADB discovery…"
  while read -r name _ addr; do
    case "$name" in
      adb-*) "$ADB" connect "$addr" >/dev/null 2>&1 || true ;;
    esac
  done < <("$ADB" mdns services 2>&1 | grep _adb-tls-connect || true)
fi

SERIAL="$("$ADB" devices | awk '$2 == "device" { print $1; exit }')"
if [ -z "$SERIAL" ]; then
  echo "No device reachable. Open Settings → Developer options → Wireless" >&2
  echo "debugging on the phone (keep the screen on) and re-run npm run apk." >&2
  exit 1
fi

echo "▸ Installing on $SERIAL…"
"$ADB" -s "$SERIAL" install -r "$APK"
"$ADB" -s "$SERIAL" shell monkey -p gh.safepay.app -c android.intent.category.LAUNCHER 1 >/dev/null
echo "✓ Installed and launched on $SERIAL"
