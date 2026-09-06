#!/usr/bin/env bash
# Android DEVELOPMENT build for the M1 proof (AC-04). Not a Play Store release. Not Expo Go.
# Requires: JDK 17, Android SDK 35, a connected device (adb), Node + yarn. Run from repo root.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="$ROOT/frontend"
OUT="$ROOT/docs/evidence"; mkdir -p "$OUT"
exec > >(tee "$OUT/android-dev-build.txt") 2>&1
echo "== Guard Dog Android dev build $(date -u +%FT%TZ) =="
cd "$APP"

echo "-- 1. dependency/version checks"
yarn install --frozen-lockfile
npx expo-doctor || true
npx expo install --check

echo "-- 2. sync shared contracts + verify controlled endpoint binding"
(cd "$ROOT/packages/guarddog-contracts" && node scripts/sync-to-app.mjs)
(cd "$ROOT/backend" && python scripts/verify_controlled_endpoint.py)

echo "-- 3. expo prebuild (clean) with the Guard Dog config plugin"
npx expo prebuild --platform android --clean --no-install

echo "-- 4. manifest check (VPN service + foreground-service type)"
MANIFEST="android/app/src/main/AndroidManifest.xml"
grep -q 'android.permission.FOREGROUND_SERVICE' "$MANIFEST" && echo "app manifest: FOREGROUND_SERVICE ok"
cd android && ./gradlew --quiet :app:processDebugMainManifest
MERGED="app/build/intermediates/merged_manifests/debug/processDebugMainManifest/AndroidManifest.xml"
[ -f "$MERGED" ] || MERGED="$(find app/build/intermediates/merged_manifests/debug -name AndroidManifest.xml | head -1)"
grep -q 'com.guarddog.vpn.GuardDogVpnService' "$MERGED" && echo "merged manifest: GuardDogVpnService present"
grep -q 'android.permission.BIND_VPN_SERVICE' "$MERGED" && echo "merged manifest: BIND_VPN_SERVICE permission present"
grep -q 'foregroundServiceType="systemExempted"' "$MERGED" && echo "merged manifest: foregroundServiceType=systemExempted"
grep -q 'FOREGROUND_SERVICE_SYSTEM_EXEMPTED' "$MERGED" && echo "merged manifest: FOREGROUND_SERVICE_SYSTEM_EXEMPTED permission"
cp "$MERGED" "$OUT/merged-AndroidManifest.xml"

echo "-- 5. native unit tests + debug build"
./gradlew --quiet :guarddog-core:testDebugUnitTest :guarddog-vpn:testDebugUnitTest -Dguarddog.vectors="$ROOT/security/test-vectors"
./gradlew --quiet :app:assembleDebug
cp app/build/outputs/apk/debug/app-debug.apk "$OUT/guarddog-m1-dev.apk"

echo "-- 6. install on device + instrumentation proof (needs real endpoint + granted VPN consent)"
adb install -r "$OUT/guarddog-m1-dev.apk"
BUNDLE_JSON="$(curl -fsS "${EXPO_PUBLIC_BACKEND_URL}/api/rules/gd-m1-controlled-block/latest")"
CONFIG_JSON="$(curl -fsS "${EXPO_PUBLIC_BACKEND_URL}/api/config")"
HOST=$(echo "$CONFIG_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin)["controlledEndpoint"]["host"])')
IP=$(echo "$CONFIG_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin)["controlledEndpoint"]["ipv4"])')
URL=$(echo "$CONFIG_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin)["controlledEndpoint"]["url"])')
./gradlew :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.guarddog.expo.AndroidBlockingProofE2ETest \
  -Pandroid.testInstrumentationRunnerArguments.controlledHost="$HOST" \
  -Pandroid.testInstrumentationRunnerArguments.controlledIpv4="$IP" \
  -Pandroid.testInstrumentationRunnerArguments.controlledUrl="$URL" \
  -Pandroid.testInstrumentationRunnerArguments.bundleJson="$BUNDLE_JSON" || echo "instrumentation proof FAILED or SKIPPED (see report)"
echo "== dev build complete; now run the RN harness on the device and export the proof report =="
