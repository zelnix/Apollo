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
npx expo install --check || true

echo "-- 2. sync shared contracts + verify controlled endpoint binding"
(cd "$ROOT/packages/guarddog-contracts" && node scripts/sync-to-app.mjs)
(cd "$ROOT/backend" && python scripts/verify_controlled_endpoint.py)

echo "-- 3. expo prebuild (clean) with the Guard Dog config plugin"
npx expo prebuild --platform android --clean --no-install

echo "-- 4. merged-manifest audit (AC-04): required VPN/FGS configuration present, high-risk permissions absent"
cd android && ./gradlew --quiet :app:processDebugMainManifest
MERGED="$(find app/build/intermediates -path "*merged_manifest*/debug/*" -name AndroidManifest.xml | head -1)"
cp "$MERGED" "$OUT/merged-AndroidManifest.xml"
python3 - "$MERGED" "$OUT/merged-manifest-audit.txt" <<'PY'
import re, sys, xml.etree.ElementTree as ET
A = "{http://schemas.android.com/apk/res/android}"
root = ET.parse(sys.argv[1]).getroot()
perms = {p.get(A + "name") for p in root.findall("uses-permission")}
sdk = root.find("uses-sdk")
if sdk is None: sdk = ET.Element("uses-sdk")
svc = next((s for s in root.iter("service") if s.get(A + "name") == "com.guarddog.vpn.GuardDogVpnService"), None)
def has_intent(s, action): return s is not None and any(a.get(A + "name") == action for a in s.iter("action"))
checks = {
  "GuardDogVpnService present": svc is not None,
  "service permission BIND_VPN_SERVICE": svc is not None and svc.get(A + "permission") == "android.permission.BIND_VPN_SERVICE",
  "service exported=false (intentional: launched only by the app; system binds via BIND_VPN_SERVICE)": svc is not None and svc.get(A + "exported") == "false",
  'foregroundServiceType="systemExempted"': svc is not None and svc.get(A + "foregroundServiceType") == "systemExempted",
  "VpnService intent filter (android.net.VpnService)": has_intent(svc, "android.net.VpnService"),
  "uses-permission FOREGROUND_SERVICE": "android.permission.FOREGROUND_SERVICE" in perms,
  "uses-permission FOREGROUND_SERVICE_SYSTEM_EXEMPTED": "android.permission.FOREGROUND_SERVICE_SYSTEM_EXEMPTED" in perms,
  "uses-permission ACCESS_NETWORK_STATE": "android.permission.ACCESS_NETWORK_STATE" in perms,
  "uses-permission INTERNET": "android.permission.INTERNET" in perms,
  "minSdkVersion=26": sdk.get(A + "minSdkVersion") == "26",
  "targetSdkVersion=36": sdk.get(A + "targetSdkVersion") == "36",
}
high_risk = ["android.permission.QUERY_ALL_PACKAGES", "android.permission.PACKAGE_USAGE_STATS", "android.permission.READ_SMS",
             "android.permission.READ_CALL_LOG", "android.permission.READ_CONTACTS", "android.permission.MANAGE_EXTERNAL_STORAGE",
             "android.permission.BIND_ACCESSIBILITY_SERVICE", "android.permission.RECORD_AUDIO", "android.permission.CAMERA",
             "android.permission.ACCESS_FINE_LOCATION", "android.permission.ACCESS_BACKGROUND_LOCATION", "android.permission.READ_PHONE_STATE"]
for hr in high_risk: checks[f"absent: {hr}"] = hr not in perms
acc = [s for s in root.iter("service") if s.get(A + "permission") == "android.permission.BIND_ACCESSIBILITY_SERVICE"]
checks["no accessibility service declared"] = not acc
checks["absent: READ_EXTERNAL_STORAGE / WRITE_EXTERNAL_STORAGE (blocked in app.json)"] = not ({"android.permission.READ_EXTERNAL_STORAGE", "android.permission.WRITE_EXTERNAL_STORAGE"} & perms)
lines = [f"{'PASS' if v else 'FAIL'}  {k}" for k, v in checks.items()]
# Remaining framework permissions, with provenance (informational):
origin = {"POST_NOTIFICATIONS": "foreground-service notification (declared)", "VIBRATE": "expo-haptics", "USE_BIOMETRIC": "expo-secure-store", "USE_FINGERPRINT": "expo-secure-store",
          "SYSTEM_ALERT_WINDOW": "react-native DEBUG manifest only (dev overlay); absent in release builds", "DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION": "androidx runtime receiver hardening"}
core = {"INTERNET", "ACCESS_NETWORK_STATE", "FOREGROUND_SERVICE", "FOREGROUND_SERVICE_SYSTEM_EXEMPTED"}
for p in sorted(perms):
    short = p.split(".")[-1]
    if short not in core: lines.append(f"INFO  other permission {short}: {origin.get(short, 'UNEXPLAINED - review')}")
lines.append("all uses-permission entries: " + ", ".join(sorted(p.split('.')[-1] for p in perms)))
ok = all(checks.values()); lines.append("MERGED MANIFEST AUDIT: " + ("PASS" if ok else "FAIL"))
open(sys.argv[2], "w").write("\n".join(lines) + "\n"); print("\n".join(lines)); sys.exit(0 if ok else 1)
PY
LEVELS="$(./gradlew :app:help 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^\s+- (minSdk|compileSdk|targetSdk):" | tr -s ' ' | tr '\n' ' ')"
echo "gradle effective levels: $LEVELS"
echo "$LEVELS" | grep -q "compileSdk: 36" && echo "compileSdk=36 confirmed"

echo "-- 5. native unit tests + debug build"
./gradlew --quiet :guarddog-core:testDebugUnitTest :guarddog-vpn:testDebugUnitTest -Dguarddog.vectors="$ROOT/security/test-vectors"
# Dev APK for the physical proof device (arm64-v8a); set GD_DEV_ABIS="armeabi-v7a,arm64-v8a,x86_64" for more ABIs.
./gradlew --quiet :app:assembleDebug -PreactNativeArchitectures="${GD_DEV_ABIS:-arm64-v8a}"
cp app/build/outputs/apk/debug/app-debug.apk "$OUT/guarddog-m1-dev.apk"

echo "-- 6. install on device + instrumentation proof (needs real endpoint + granted VPN consent)"
if ! adb devices 2>/dev/null | grep -qE "^\S+\s+device$"; then
  echo "NO DEVICE: development APK built at $OUT/guarddog-m1-dev.apk; connect a physical Android device (adb) and re-run for the instrumentation proof"
  echo "== dev build complete (device steps pending) =="
  exit 0
fi
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
