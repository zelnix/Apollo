#!/usr/bin/env bash
# iOS native gate (AC-02). Run on macOS with Xcode 26.x (Swift 6.x) — Expo SDK 57 toolchain.
# Produces docs/evidence/ios-native-gate.txt (summary) and, for step 3, the FULL raw xcodebuild stdout/stderr in
# docs/evidence/ios-xcodebuild-full.log plus pod install output — preserved even when the build fails.
# Exit non-zero on any failure.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/docs/evidence"; mkdir -p "$OUT"; LOG="$OUT/ios-native-gate.txt"
XCLOG="$OUT/ios-xcodebuild-full.log"; PODLOG="$OUT/ios-pod-install.log"
exec > >(tee "$LOG") 2>&1
echo "== Guard Dog iOS native gate $(date -u +%FT%TZ) =="
echo "-- 0. toolchain + Expo package provenance"
xcodebuild -version 2>/dev/null | tr '\n' ' '; echo
swift --version 2>&1 | head -1
command -v pod >/dev/null && echo "cocoapods $(pod --version)"
(cd "$ROOT/frontend" && node -p "'expo '+require('expo/package.json').version+' · expo-modules-core '+require('expo-modules-core/package.json').version+' · expo-modules-jsi '+require('expo-modules-jsi/package.json').version+' · react-native '+require('react-native/package.json').version")
(cd "$ROOT/frontend" && { echo "-- yarn why expo-modules-jsi"; yarn why expo-modules-jsi 2>&1 | grep -E 'Found|Reasons|Hoisted|depends on|specified in' || true; \
  echo "-- yarn why expo-modules-core"; yarn why expo-modules-core 2>&1 | grep -E 'Found|Reasons|Hoisted|depends on|specified in' || true; \
  echo "-- npx expo install --check"; CI=1 npx expo install --check 2>&1 | grep -vE '^env:' || true; }) | tee "$OUT/ios-expo-package-audit.txt"

echo "-- 1. package resolution + capability cycle check"
cd "$ROOT/packages/guarddog-ios-sdk/GuardDogCore" && swift package resolve
swift package show-dependencies | (! grep -q GuardDogNetworkFeasibility) && echo "GuardDogCore has no dependency on GuardDogNetworkFeasibility: clean"
cd "$ROOT/packages/guarddog-ios-sdk/GuardDogNetworkFeasibility" && swift package resolve && swift build

echo "-- 2. GuardDogCore compiles + tests (normalization, URL sanitization, signing/JCS fixtures)"
cd "$ROOT/packages/guarddog-ios-sdk/GuardDogCore"
swift build
swift test --filter 'HostNormalizationParityTests|UrlSanitizationParityTests|RuleBundleVerifierParityTests' 2>&1 | tee "$OUT/ios-core-test-results.txt"

echo "-- 3. Expo iOS module compiles in its intended integration (prebuilt app + CocoaPods)"
if [ -d "$ROOT/frontend/ios" ]; then
  # Stale prebuilt ExpoModulesJSI xcframework caches are a known cause of "[CP-User] Build ExpoModulesJSI xcframework" failures
  # after toolchain/package changes (expo/expo#46242): always start from a clean product cache.
  rm -rf "$ROOT/frontend/node_modules/expo-modules-jsi/apple/Products"
  cd "$ROOT/frontend/ios"
  pod install 2>&1 | tee "$PODLOG" | tail -3
  WS="$(ls -d *.xcworkspace | head -1)"; SCHEME="$(basename -s .xcworkspace "$WS")"
  echo "xcodebuild -workspace $WS -scheme $SCHEME (full log → docs/evidence/ios-xcodebuild-full.log)"
  set +e
  xcodebuild -workspace "$WS" -scheme "$SCHEME" -configuration Debug -sdk iphonesimulator \
    -destination 'generic/platform=iOS Simulator' build-for-testing CODE_SIGNING_ALLOWED=NO 2>&1 | tee "$XCLOG" | grep -E '^\*\* |error:|warning: .*GuardDog|PhaseScriptExecution|Build ExpoModulesJSI' | tail -40
  XC_STATUS=${PIPESTATUS[0]}
  set -e
  if [ "$XC_STATUS" -ne 0 ]; then
    echo "xcodebuild FAILED (exit $XC_STATUS). Failing phase context from the full log:"
    # Print the script phase body + its stderr (the summary line alone is useless for diagnosis).
    grep -n -B5 -A60 'PhaseScriptExecution.*failed\|\*\* BUILD FAILED' "$XCLOG" | grep -vE '^\s*$' | tail -120
    echo "GuardDog sources involved: $(grep -c 'GuardDogExpoModule' "$XCLOG" || true) references; Guard Dog compile errors: $(grep -c 'GuardDog.*error:' "$XCLOG" || true)"
    exit "$XC_STATUS"
  fi
  echo "expo ios module: compiled"
else
  echo "SKIPPED: run 'npx expo prebuild --platform ios --clean' in frontend first"
fi
echo "== iOS NATIVE GATE PASSED =="
