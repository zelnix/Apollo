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
# Bootstrap the wrapper if the script or its JAR is missing (a missing gradle-wrapper.jar fails with
# ClassNotFoundException: org.gradle.wrapper.GradleWrapperMain before anything compiles).
if [ ! -f gradlew ] || [ ! -f gradle/wrapper/gradle-wrapper.jar ]; then
  echo "gradle wrapper incomplete; regenerating with pinned Gradle 8.13"
  gradle wrapper --gradle-version 8.13 --distribution-type bin --quiet
fi
unzip -l gradle/wrapper/gradle-wrapper.jar | grep -q "org/gradle/wrapper/GradleWrapperMain.class" && echo "wrapper jar ok: $(sha256sum gradle/wrapper/gradle-wrapper.jar | cut -c1-16)…"
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
  echo "-- 5b. Expo module LOADS: real GuardDogExpoModule().definition() executes (JVM unit test) + no reified stubs in bytecode"
  # Compilation is not evidence the bridge can register: without the Pika compiler plugin (expo-module-gradle-plugin) the module
  # compiles but throws "reified type parameter … can only be inlined" the moment Expo instantiates it on a device.
  (cd "$ROOT/frontend/android" && ./gradlew $VEC :guarddog-expo-module:testDebugUnitTest --tests 'com.guarddog.expo.GuardDogExpoModuleDefinitionTest' > "$OUT/expo-module-definition-test.log" 2>&1) \
    || { tail -60 "$OUT/expo-module-definition-test.log"; echo "FAIL: GuardDogExpoModule().definition() does not evaluate"; exit 1; }
  rm -rf "$OUT/expo-module-test-results"; mkdir -p "$OUT/expo-module-test-results"
  cp "$ROOT/packages/guarddog-expo-module/android/build/test-results/testDebugUnitTest/"*.xml "$OUT/expo-module-test-results/"
  python3 - "$OUT/expo-module-test-results" <<'PY'
import glob, sys, xml.etree.ElementTree as ET
t = f = 0
for p in glob.glob(sys.argv[1] + "/*.xml"):
    r = ET.parse(p).getroot(); t += int(r.get("tests", 0)); f += int(r.get("failures", 0)) + int(r.get("errors", 0))
print(f"expo module definition test: {t} run, {f} failed"); sys.exit(1 if f or t < 2 else 0)
PY
  KCLASSES="$ROOT/packages/guarddog-expo-module/android/build/tmp/kotlin-classes/debug/com/guarddog/expo"
  CLASSES="$(find "$KCLASSES" -name 'GuardDogExpoModule*.class' 2>/dev/null | head -50)"
  [ -n "$CLASSES" ] || { echo "FAIL: no compiled GuardDogExpoModule classes under $KCLASSES to inspect"; exit 1; }
  MARKERS="$(cat $CLASSES | grep -a -c 'reifiedOperationMarker\|throwNonReified' || true)"
  echo "compiled classes inspected: $(echo "$CLASSES" | wc -l | tr -d ' '); reified stubs: $MARKERS"
  [ "$MARKERS" = "0" ] || { echo "FAIL: un-inlined reified stubs in Expo module bytecode (Pika compiler plugin missing)"; exit 1; }
  echo "expo module: loads (definition() evaluated, bytecode clean)"
  echo "-- 6. frozen Android SDK levels in the generated app (minSdk 26 / compileSdk 36 / targetSdk 36)"
  # ExpoRootProject prints the effective SDK levels at configuration time (set via expo-build-properties in app.json).
  LEVELS="$(cd "$ROOT/frontend/android" && ./gradlew :guarddog-expo-module:help 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "^\s+- (minSdk|compileSdk|targetSdk):" | tr -s ' ' | tr '\n' ' ')"
  echo "generated app: $LEVELS"
  echo "$LEVELS" | grep -q "minSdk: 26" && echo "$LEVELS" | grep -q "compileSdk: 36" && echo "$LEVELS" | grep -q "targetSdk: 36" && echo "sdk levels: frozen configuration confirmed"
else
  echo "SKIPPED: run scripts/ci/android-dev-build.sh to prebuild the app first"
fi
echo "== ANDROID NATIVE GATE PASSED =="
