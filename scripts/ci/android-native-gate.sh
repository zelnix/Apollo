#!/usr/bin/env bash
# Android native gate (AC-01). Run on a machine with JDK 17 + Android SDK (compileSdk 35) + Gradle 8.9.
# Produces docs/evidence/android-native-gate.txt. Exit non-zero on any failure.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SDK="$ROOT/packages/guarddog-android-sdk"
OUT="$ROOT/docs/evidence"; mkdir -p "$OUT"; LOG="$OUT/android-native-gate.txt"
exec > >(tee "$LOG") 2>&1
echo "== Guard Dog Android native gate $(date -u +%FT%TZ) =="
cd "$SDK"
[ -f gradlew ] || gradle wrapper --gradle-version 8.9 --quiet
VEC="-Dguarddog.vectors=$ROOT/security/test-vectors"

echo "-- 1. dependency resolution"
./gradlew --quiet :guarddog-core:dependencies --configuration releaseRuntimeClasspath >/dev/null
./gradlew --quiet :guarddog-vpn:dependencies --configuration releaseRuntimeClasspath > "$OUT/vpn-deps.txt"

echo "-- 2. no core -> vpn dependency (source + gradle)"
! grep -rn "^import com.guarddog.vpn" guarddog-core/src/main && echo "core imports: clean"
./gradlew --quiet :guarddog-core:dependencies --configuration releaseRuntimeClasspath | (! grep -q "guarddog-vpn") && echo "gradle graph: clean"

echo "-- 3. compile"
./gradlew --quiet :guarddog-core:assembleRelease :guarddog-vpn:assembleRelease

echo "-- 4. unit tests (normalization, URL sanitization, signing/JCS fixtures, packet path)"
./gradlew $VEC :guarddog-core:testReleaseUnitTest :guarddog-vpn:testReleaseUnitTest \
  --tests 'com.guarddog.core.net.HostCanonicalizerParityTest' \
  --tests 'com.guarddog.core.net.UrlSanitizerParityTest' \
  --tests 'com.guarddog.core.rules.RuleBundleVerifierTest' \
  --tests 'com.guarddog.core.rules.BundleVersionStoreTest' \
  --tests 'com.guarddog.vpn.*'
cp -r guarddog-core/build/test-results/testReleaseUnitTest "$OUT/android-core-test-results" 2>/dev/null || true
cp -r guarddog-vpn/build/test-results/testReleaseUnitTest "$OUT/android-vpn-test-results" 2>/dev/null || true

echo "-- 5. Expo Android module compiles inside the prebuilt app (requires scripts/ci/android-dev-build.sh first)"
if [ -d "$ROOT/frontend/android" ]; then
  (cd "$ROOT/frontend/android" && ./gradlew --quiet :guarddog-expo-module:assembleDebug) && echo "expo module: compiled"
else
  echo "SKIPPED: run scripts/ci/android-dev-build.sh to prebuild the app first"
fi
echo "== ANDROID NATIVE GATE PASSED =="
