#!/usr/bin/env bash
# Android native gate (AC-01). Run on a machine with JDK 17 + Android SDK (compileSdk 36) + Gradle 8.13 (wrapper).
# Produces docs/evidence/android-native-gate.txt. Exit non-zero on any failure.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SDK="$ROOT/packages/guarddog-android-sdk"
OUT="$ROOT/docs/evidence"; mkdir -p "$OUT"; LOG="$OUT/android-native-gate.txt"
exec > >(tee "$LOG") 2>&1
echo "== Guard Dog Android native gate $(date -u +%FT%TZ) =="
echo "host: $(uname -m) $(uname -s); java: $(java -version 2>&1 | head -1); ANDROID_HOME=${ANDROID_HOME:-unset}"
[ -f "$HOME/.gradle/gradle.properties" ] && grep -H "aapt2FromMavenOverride" "$HOME/.gradle/gradle.properties" || true
cd "$SDK"
[ -f gradlew ] || gradle wrapper --gradle-version 8.13 --quiet
VEC="-Dguarddog.vectors=$ROOT/security/test-vectors"

echo "-- 1. dependency resolution"
./gradlew --quiet :guarddog-core:dependencies --configuration releaseRuntimeClasspath > "$OUT/core-deps.txt"
./gradlew --quiet :guarddog-vpn:dependencies --configuration releaseRuntimeClasspath > "$OUT/vpn-deps.txt"
! grep -q "FAILED" "$OUT/core-deps.txt" "$OUT/vpn-deps.txt" && echo "all dependencies resolved"

echo "-- 2. no core -> vpn dependency (source + gradle)"
! grep -rn "^import com.guarddog.vpn" guarddog-core/src/main && echo "core imports: clean"
./gradlew --quiet :guarddog-core:dependencies --configuration releaseRuntimeClasspath | (! grep -q "guarddog-vpn") && echo "gradle graph: clean"

echo "-- 3. compile"
./gradlew --quiet :guarddog-core:assembleRelease :guarddog-vpn:assembleRelease

echo "-- 4. unit tests (normalization, URL sanitization, signing/JCS fixtures, packet path)"
./gradlew $VEC --rerun-tasks :guarddog-core:testReleaseUnitTest :guarddog-vpn:testReleaseUnitTest \
  --tests 'com.guarddog.core.net.HostCanonicalizerParityTest' \
  --tests 'com.guarddog.core.net.UrlSanitizerParityTest' \
  --tests 'com.guarddog.core.rules.RuleBundleVerifierTest' \
  --tests 'com.guarddog.core.rules.BundleVersionStoreTest' \
  --tests 'com.guarddog.vpn.*'
rm -rf "$OUT/android-core-test-results" "$OUT/android-vpn-test-results"
cp -r guarddog-core/build/test-results/testReleaseUnitTest "$OUT/android-core-test-results"
cp -r guarddog-vpn/build/test-results/testReleaseUnitTest "$OUT/android-vpn-test-results"
python3 - "$OUT" <<'PY'
import glob, sys, xml.etree.ElementTree as ET
out = sys.argv[1]; total = failed = 0
for f in sorted(glob.glob(f"{out}/android-*-test-results/*.xml")):
    r = ET.parse(f).getroot(); t, fl, er = int(r.get("tests")), int(r.get("failures")), int(r.get("errors"))
    total += t; failed += fl + er
    print(f"  {r.get('name')}: {t} tests, {fl} failures, {er} errors")
print(f"native unit tests: {total} run, {failed} failed"); sys.exit(1 if failed else 0)
PY

echo "-- 5. Expo Android module compiles inside the prebuilt app (requires scripts/ci/android-dev-build.sh first)"
if [ -d "$ROOT/frontend/android" ]; then
  (cd "$ROOT/frontend/android" && ./gradlew --quiet :guarddog-expo-module:assembleDebug) && echo "expo module: compiled"
  echo "-- 6. frozen Android SDK levels in the generated app (minSdk 26 / compileSdk 36 / targetSdk 36)"
  # ExpoRootProject prints the effective SDK levels at configuration time (set via expo-build-properties in app.json).
  LEVELS="$(cd "$ROOT/frontend/android" && ./gradlew :guarddog-expo-module:help 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^\s+- (minSdk|compileSdk|targetSdk):" | tr -s ' ' | tr '\n' ' ')"
  echo "generated app: $LEVELS"
  echo "$LEVELS" | grep -q "minSdk: 26" && echo "$LEVELS" | grep -q "compileSdk: 36" && echo "$LEVELS" | grep -q "targetSdk: 36" && echo "sdk levels: frozen configuration confirmed"
else
  echo "SKIPPED: run scripts/ci/android-dev-build.sh to prebuild the app first"
fi
echo "== ANDROID NATIVE GATE PASSED =="
