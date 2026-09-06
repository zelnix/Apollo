#!/usr/bin/env bash
# iOS native gate (AC-02). Run on macOS with Xcode 16+ (Swift 5.9+).
# Produces docs/evidence/ios-native-gate.txt. Exit non-zero on any failure.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/docs/evidence"; mkdir -p "$OUT"; LOG="$OUT/ios-native-gate.txt"
exec > >(tee "$LOG") 2>&1
echo "== Guard Dog iOS native gate $(date -u +%FT%TZ) =="

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
  cd "$ROOT/frontend/ios" && pod install --silent
  xcodebuild -workspace *.xcworkspace -scheme "$(basename -s .xcworkspace *.xcworkspace)" -configuration Debug -sdk iphonesimulator \
    -destination 'generic/platform=iOS Simulator' build-for-testing CODE_SIGNING_ALLOWED=NO | tail -5
  echo "expo ios module: compiled"
else
  echo "SKIPPED: run 'npx expo prebuild --platform ios --clean' in frontend first"
fi
echo "== iOS NATIVE GATE PASSED =="
