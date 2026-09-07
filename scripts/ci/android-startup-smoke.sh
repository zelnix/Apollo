#!/usr/bin/env bash
# Standalone Android app START-UP smoke test (CI gate). Proves what compile/package/static checks cannot: the generated APK, installed on
# an emulator/device with NO Metro server, launches its main activity, executes the embedded JS bundle and mounts the Guard Dog harness
# screen without a fatal native/React exception. Closes the gap exposed by runs 4–7 (module registration crash, missing bundle,
# Appearance start-up crash) that all passed every earlier gate.
#
# Usage: bash scripts/ci/android-startup-smoke.sh <apk> [expected-git-sha]
# Requires: adb with exactly one booted emulator/device attached. Writes docs/evidence/android-startup-smoke.txt (+ logcat, screenshot, UI dump).
set -euo pipefail
APK="${1:?apk path}"; EXPECT_SHA="${2:-${GITHUB_SHA:-}}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/docs/evidence"; mkdir -p "$OUT"
REPORT="$OUT/android-startup-smoke.txt"; LOGCAT="$OUT/android-startup-smoke-logcat.txt"
PKG="$(python3 -c "import json;print(json.load(open('$ROOT/frontend/app.json'))['expo']['android']['package'])")"
ACTIVITY="$PKG/.MainActivity"
READY_TIMEOUT="${GD_SMOKE_READY_TIMEOUT:-180}"   # seconds to wait for the harness marker (cold emulator + Hermes bytecode load)
STABLE_WINDOW="${GD_SMOKE_STABLE_WINDOW:-15}"     # seconds the app must stay alive after the marker
# Fatal patterns: uncaught JS errors surface as JavascriptException inside FATAL EXCEPTION in non-dev bundles; the other lines are the
# exact failures observed on the proof phone in runs 4–7.
FATAL_RE='FATAL EXCEPTION|E AndroidRuntime|JavascriptException|Unable to load script|Parameter specified as non-null is null|reified type parameter|Force finishing activity '"$PKG"'|Process '"$PKG"' .*has died'

{
echo "== Guard Dog Android start-up smoke $(date -u +%FT%TZ) =="
echo "apk: $APK ($(stat -c %s "$APK") bytes) sha256=$(sha256sum "$APK" | cut -d' ' -f1)"
echo "package: $PKG activity: $ACTIVITY expected gitSha: ${EXPECT_SHA:-<unset>}"

adb wait-for-device
for _ in $(seq 1 60); do [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break; sleep 3; done
[ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1" ] || { echo "FAIL  device did not finish booting"; exit 1; }
echo "device: $(adb shell getprop ro.product.model | tr -d '\r') android $(adb shell getprop ro.build.version.release | tr -d '\r') api $(adb shell getprop ro.build.version.sdk | tr -d '\r') abi $(adb shell getprop ro.product.cpu.abi | tr -d '\r')"

# No Metro path exists: nothing listening on the packager port, no adb reverse, and the app has no dev-server host configured.
adb reverse --remove-all >/dev/null 2>&1 || true
adb shell "am force-stop $PKG" >/dev/null 2>&1 || true
adb uninstall "$PKG" >/dev/null 2>&1 || true
adb install -r -g "$APK" | tr -d '\r' | tail -1
adb logcat -c || true
echo "-- launch (no Metro, no adb reverse)"
adb shell "am start -W -n $ACTIVITY" | tr -d '\r' | grep -E "Status|LaunchState|TotalTime|Error" || true

READY=""; START=$(date +%s)
while :; do
  adb logcat -d -v time > "$LOGCAT" 2>/dev/null || true
  if grep -a -E -q "$FATAL_RE" "$LOGCAT"; then
    echo "FAIL  fatal exception during start-up:"; grep -a -E -m 12 -A 6 "$FATAL_RE" "$LOGCAT" | head -60; exit 1
  fi
  if grep -a -q "GD_SMOKE_READY" "$LOGCAT"; then READY="$(grep -a -m1 'GD_SMOKE_READY' "$LOGCAT")"; break; fi
  if [ $(( $(date +%s) - START )) -ge "$READY_TIMEOUT" ]; then
    echo "FAIL  no GD_SMOKE_READY marker within ${READY_TIMEOUT}s (React Native did not bootstrap or the harness screen never mounted)"
    echo "-- last ReactNative/RN-JS log lines:"; grep -a -E "ReactNativeJS|ReactNative|Expo|$PKG" "$LOGCAT" | tail -40; exit 1
  fi
  sleep 3
done
echo "PASS  harness mounted after $(( $(date +%s) - START ))s: ${READY#*GD_SMOKE_READY }"
PAYLOAD="${READY#*GD_SMOKE_READY }"
if [ -n "$EXPECT_SHA" ]; then
  if grep -q "\"gitSha\":\"$EXPECT_SHA\"" <<<"$PAYLOAD"; then echo "PASS  marker gitSha == expected build commit"; else echo "FAIL  marker gitSha != $EXPECT_SHA"; exit 1; fi
fi
grep -q '"native":true' <<<"$PAYLOAD" && echo "PASS  GuardDogSecurity native module reachable from JS" || { echo "FAIL  GuardDogSecurity native module not available to JS"; exit 1; }

echo "-- stability window ${STABLE_WINDOW}s"; sleep "$STABLE_WINDOW"
adb logcat -d -v time > "$LOGCAT" 2>/dev/null || true
if grep -a -E -q "$FATAL_RE" "$LOGCAT"; then echo "FAIL  fatal exception after mount:"; grep -a -E -m 6 -A 6 "$FATAL_RE" "$LOGCAT" | head -40; exit 1; fi
PID="$(adb shell pidof "$PKG" | tr -d '\r')"; [ -n "$PID" ] && echo "PASS  process alive (pid $PID)" || { echo "FAIL  process not running"; exit 1; }
adb shell dumpsys activity activities | tr -d '\r' | grep -E "mResumedActivity|topResumedActivity" | grep -q "$PKG" && echo "PASS  MainActivity is the resumed activity" || { echo "FAIL  MainActivity not resumed"; exit 1; }

# On-screen proof: UI hierarchy contains the harness header, plus a screenshot for the evidence folder.
adb shell uiautomator dump /sdcard/gd-smoke-ui.xml >/dev/null 2>&1 && adb pull /sdcard/gd-smoke-ui.xml "$OUT/android-startup-smoke-ui.xml" >/dev/null 2>&1 || true
if [ -f "$OUT/android-startup-smoke-ui.xml" ] && grep -q "M1 PROOF HARNESS" "$OUT/android-startup-smoke-ui.xml"; then echo "PASS  harness header visible in UI hierarchy"; else echo "FAIL  harness header not found in UI hierarchy"; exit 1; fi
adb exec-out screencap -p > "$OUT/android-startup-smoke.png" 2>/dev/null && echo "screenshot: docs/evidence/android-startup-smoke.png ($(stat -c %s "$OUT/android-startup-smoke.png") bytes)"
echo "== ANDROID START-UP SMOKE PASSED =="
} | tee "$REPORT"
exit "${PIPESTATUS[0]}"
