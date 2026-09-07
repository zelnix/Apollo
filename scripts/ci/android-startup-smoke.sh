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

# Concrete process-exit evidence (never inferred): ActivityManager exit records for the package (API 30+), the am_* events buffer and the
# last logcat lines of the last known PID. Printed on every failure path.
LAST_PID=""
exit_evidence() {
  echo "-- process-exit evidence (last known pid: ${LAST_PID:-none}; pidof now: $(adb shell pidof "$PKG" 2>/dev/null | tr -d '\r'))"
  adb shell "dumpsys activity exit-info $PKG" 2>/dev/null | tr -d '\r' | grep -E -A12 "ApplicationExitInfo|reason=|timestamp=" | head -40 || true
  adb logcat -b events -d 2>/dev/null | grep -a -E "am_proc_died|am_kill|am_anr|am_crash|am_low_memory" | grep -a -E "$PKG|$LAST_PID" | tail -20 || true
  adb logcat -d -v time 2>/dev/null | grep -a -E "ActivityManager.*($PKG|$LAST_PID)|lowmemorykiller|Kill.*$PKG|DEBUG.*pid: $LAST_PID" | tail -20 || true
}
fail() { echo "FAIL  $*"; exit_evidence; exit 1; }

{
echo "== Guard Dog Android start-up smoke $(date -u +%FT%TZ) =="
echo "apk: $APK ($(stat -c %s "$APK") bytes) sha256=$(sha256sum "$APK" | cut -d' ' -f1)"
echo "package: $PKG activity: $ACTIVITY expected gitSha: ${EXPECT_SHA:-<unset>}"

adb wait-for-device
for _ in $(seq 1 60); do [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break; sleep 3; done
[ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1" ] || fail "device did not finish booting"
echo "device: $(adb shell getprop ro.product.model | tr -d '\r') android $(adb shell getprop ro.build.version.release | tr -d '\r') api $(adb shell getprop ro.build.version.sdk | tr -d '\r') abi $(adb shell getprop ro.product.cpu.abi | tr -d '\r')"

# No Metro path exists: nothing listening on the packager port, no adb reverse, and the app has no dev-server host configured.
adb reverse --remove-all >/dev/null 2>&1 || true
# Run 34117910707: a "Pixel Launcher isn't responding" ANR dialog (a system window above every app) covered Apollo through five refocus
# attempts although Apollo stayed alive. Hide OTHER processes' ANR/crash dialogs — Apollo's own fatals are still detected from logcat
# (FATAL EXCEPTION / JavascriptException are logged regardless of the dialog) — and let the freshly booted system settle first.
adb shell settings put global hide_error_dialogs 1 >/dev/null 2>&1 || true
adb shell settings put global window_animation_scale 0 >/dev/null 2>&1 || true
adb shell settings put global transition_animation_scale 0 >/dev/null 2>&1 || true
adb shell settings put global animator_duration_scale 0 >/dev/null 2>&1 || true
echo "settled: waiting ${GD_SMOKE_SETTLE:-20}s after boot for the launcher/system to go idle"; sleep "${GD_SMOKE_SETTLE:-20}"
adb shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
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
    grep -a -E -m 12 -A 6 "$FATAL_RE" "$LOGCAT" | head -60; fail "fatal exception during start-up (see lines above)"
  fi
  if grep -a -q "GD_SMOKE_READY" "$LOGCAT"; then READY="$(grep -a -m1 'GD_SMOKE_READY' "$LOGCAT")"; break; fi
  if [ $(( $(date +%s) - START )) -ge "$READY_TIMEOUT" ]; then
    echo "FAIL  no GD_SMOKE_READY marker within ${READY_TIMEOUT}s (React Native did not bootstrap or the harness screen never mounted)"
    echo "-- last ReactNative/RN-JS log lines:"; grep -a -E "ReactNativeJS|ReactNative|Expo|$PKG" "$LOGCAT" | tail -40; fail "harness marker missing"
  fi
  sleep 3
done
echo "PASS  harness mounted after $(( $(date +%s) - START ))s: ${READY#*GD_SMOKE_READY }"
PAYLOAD="${READY#*GD_SMOKE_READY }"
if [ -n "$EXPECT_SHA" ]; then
  if grep -q "\"gitSha\":\"$EXPECT_SHA\"" <<<"$PAYLOAD"; then echo "PASS  marker gitSha == expected build commit"; else fail "marker gitSha != $EXPECT_SHA"; fi
fi
grep -q '"native":true' <<<"$PAYLOAD" && echo "PASS  GuardDogSecurity native module reachable from JS" || fail "GuardDogSecurity native module not available to JS"

echo "-- stability window ${STABLE_WINDOW}s"; sleep "$STABLE_WINDOW"
adb logcat -d -v time > "$LOGCAT" 2>/dev/null || true
if grep -a -E -q "$FATAL_RE" "$LOGCAT"; then grep -a -E -m 6 -A 6 "$FATAL_RE" "$LOGCAT" | head -40; fail "fatal exception after mount (see lines above)"; fi
LAST_PID="$(adb shell pidof "$PKG" | tr -d '\r')"; [ -n "$LAST_PID" ] && echo "PASS  process alive (pid $LAST_PID)" || fail "process not running after the stability window"
adb shell dumpsys activity activities | tr -d '\r' | grep -E "mResumedActivity|topResumedActivity" | grep -q "$PKG" && echo "PASS  MainActivity is the resumed activity" || fail "MainActivity not resumed"

# On-screen proof: UI hierarchy contains the harness header, plus a screenshot for the evidence folder.
# Emulator system dialogs ("Pixel Launcher isn't responding" — seen in run 34106689038) can sit over the app and make uiautomator dump
# the system UI instead. Detect such an unrelated overlay, record it, dismiss it / refocus the app and retry; still a hard failure if the
# harness is absent after clean focus, the process dies, or a fatal exception appears.
UIXML="$OUT/android-startup-smoke-ui.xml"
dump_ui() { rm -f "$UIXML"; adb shell uiautomator dump /sdcard/gd-smoke-ui.xml >/dev/null 2>&1 && adb pull /sdcard/gd-smoke-ui.xml "$UIXML" >/dev/null 2>&1 || true; [ -f "$UIXML" ]; }
overlay_info() { # prints "<overlay text>|<x>,<y> of a dismiss button or empty>" when the dump is not the app's own hierarchy
  python3 - "$UIXML" "$PKG" <<'PY'
import re, sys, xml.etree.ElementTree as ET
xml, pkg = open(sys.argv[1], encoding="utf-8", errors="replace").read(), sys.argv[2]
nodes = list(ET.fromstring(xml).iter("node"))
pkgs = {n.get("package") for n in nodes}
texts = [n.get("text") or "" for n in nodes]
sysdlg = [t for t in texts if re.search(r"isn't responding|not responding|Close app|has stopped|keeps stopping|System UI", t)]
if pkg in pkgs and not sysdlg:
    sys.exit(0)  # app owns the visible hierarchy
label = sysdlg[0] if sysdlg else "foreground hierarchy owned by " + ",".join(sorted(p for p in pkgs if p)) if pkgs else "empty hierarchy"
tap = ""
for want in ("Wait", "OK", "Close"):
    for n in nodes:
        if (n.get("text") or "").strip() == want and n.get("clickable") == "true":
            x1, y1, x2, y2 = map(int, re.findall(r"\d+", n.get("bounds") or "[0,0][0,0]"))
            tap = f"{(x1+x2)//2},{(y1+y2)//2}"; break
    if tap: break
print(f"{label}|{tap}")
PY
}
HEADER_OK=""
for attempt in 1 2 3 4 5; do
  dump_ui || { echo "INFO  uiautomator dump unavailable (attempt $attempt)"; sleep 3; continue; }
  if grep -q "M1 PROOF HARNESS" "$UIXML"; then HEADER_OK=1; break; fi
  INFO="$(overlay_info || true)"
  if [ -n "$INFO" ]; then
    echo "INFO  unrelated system overlay detected (${INFO%%|*}); refocusing Apollo (attempt $attempt)"
    TAP="${INFO#*|}"; [ -n "$TAP" ] && adb shell input tap "${TAP%,*}" "${TAP#*,}" >/dev/null 2>&1 || true
    adb shell "am start -n $ACTIVITY" >/dev/null 2>&1 || true
  else
    echo "INFO  app hierarchy visible but harness header not rendered yet (attempt $attempt)"
  fi
  sleep 4
  # the mandatory gates must still hold while we retry
  adb logcat -d -v time > "$LOGCAT" 2>/dev/null || true
  if grep -a -E -q "$FATAL_RE" "$LOGCAT"; then grep -a -E -m 6 -A 6 "$FATAL_RE" "$LOGCAT" | head -40; fail "fatal exception while refocusing"; fi
  NOW_PID="$(adb shell pidof "$PKG" | tr -d '\r')"; [ -n "$NOW_PID" ] || fail "process died while refocusing"; [ "$NOW_PID" = "$LAST_PID" ] || fail "process restarted while refocusing (pid $LAST_PID -> $NOW_PID)"
done
if [ -n "$HEADER_OK" ]; then echo "PASS  harness header visible in UI hierarchy (attempt $attempt)"; else fail "harness header not found in UI hierarchy after $attempt attempts (top window: ${INFO%%|*})"; fi
adb shell dumpsys activity activities | tr -d '\r' | grep -E "mResumedActivity|topResumedActivity" | grep -q "$PKG" || fail "MainActivity lost focus"
adb exec-out screencap -p > "$OUT/android-startup-smoke.png" 2>/dev/null && echo "screenshot: docs/evidence/android-startup-smoke.png ($(stat -c %s "$OUT/android-startup-smoke.png") bytes)"
echo "== ANDROID START-UP SMOKE PASSED =="
} | tee "$REPORT"
exit "${PIPESTATUS[0]}"
