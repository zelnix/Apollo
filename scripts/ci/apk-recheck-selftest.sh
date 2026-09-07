#!/usr/bin/env bash
# Self-test for scripts/ci/apk-recheck.sh using a mock aapt2 and synthetic APKs (no Android SDK required).
# Proves the verifier's PASS/FAIL behaviour for the checks that previously produced false negatives/positives:
#   1. binary-manifest parsing (minSdk 26, foregroundServiceType 0x00000400)
#   2. embedded JS bundle present and non-trivial
#   3. GITHUB_SHA and GITHUB_RUN_ID inlined in the bundle — run id embedded next to arbitrary packed digit bytes must PASS
#   4. leakage scan still runs and fails the job on a forbidden marker
# Usage: bash scripts/ci/apk-recheck-selftest.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PKG="$(python3 -c "import json;print(json.load(open('$ROOT/frontend/app.json'))['expo']['android']['package'])")"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"; rm -f "$ROOT"/docs/evidence/apk-recheck.txt "$ROOT"/docs/evidence/apk-provenance.json "$ROOT"/docs/evidence/apk-AndroidManifest.txt' EXIT
SDK="$WORK/sdk"; mkdir -p "$SDK/build-tools/36.0.0" "$WORK/apk/assets"

cat > "$SDK/build-tools/36.0.0/aapt2" <<EOF
#!/usr/bin/env bash
if [ "\$2" = "badging" ]; then
printf "package: name='$PKG' versionCode='1'\ntargetSdkVersion:'36'\napplication-debuggable\nuses-permission: name='android.permission.INTERNET'\nuses-permission: name='android.permission.ACCESS_NETWORK_STATE'\nuses-permission: name='android.permission.FOREGROUND_SERVICE'\nuses-permission: name='android.permission.FOREGROUND_SERVICE_SYSTEM_EXEMPTED'\nnative-code: 'arm64-v8a'\n"
else
printf "  A: android:minSdkVersion(0x0101020c)=26\n  A: android:targetSdkVersion(0x01010270)=36\nE: service\n  A: android:name=\"com.guarddog.vpn.GuardDogVpnService\"\n  A: android:permission=\"android.permission.BIND_VPN_SERVICE\"\n  A: android:foregroundServiceType(0x01010599)=0x00000400\n  A: android:name=\"android.net.VpnService\"\n"
fi
EOF
chmod +x "$SDK/build-tools/36.0.0/aapt2"
printf 'ccf41NL6VHYQsH171Lw98hKiIoQFvAY0t171X4PL/ac=' > "$WORK/apk/classes.dex"   # pinned PUBLIC key marker

SHA="abc123def4567890000000000000000000000000"; RUN="34072034928"
# Hermes-like blob: magic + filler + commit + run id sandwiched between packed digit bytes (the shape that broke the boundary regex)
python3 - "$WORK/apk/assets/index.android.bundle" "$SHA" "$RUN" <<'PY'
import sys; p, sha, run = sys.argv[1:]
open(p, "wb").write(b"\xc6\x1f\xbc\x03" + b"x" * 120000 + sha.encode() + b"\x00" + b"9917" + run.encode() + b"55" + b"\x00" + b"y" * 10)
PY
(cd "$WORK/apk" && zip -q "$WORK/good.apk" classes.dex assets/index.android.bundle)
(cd "$WORK/apk" && zip -q "$WORK/nobundle.apk" classes.dex)
printf 'X-GuardDog-Admin-Token' > "$WORK/apk/leak.js"
(cd "$WORK/apk" && zip -q "$WORK/leaky.apk" classes.dex assets/index.android.bundle leak.js)

FAILS=0
expect() { # expect <PASS|FAIL> <label> <GITHUB_SHA> <GITHUB_RUN_ID> <apk> <grep-pattern that must appear>
  local want="$1" label="$2" sha="$3" run="$4" apk="$5" pat="$6" out rc
  set +e; out="$(GITHUB_SHA="$sha" GITHUB_RUN_ID="$run" ANDROID_HOME="$SDK" bash "$ROOT/scripts/ci/apk-recheck.sh" "$apk" 2>&1)"; rc=$?; set -e
  local got="FAIL"; [ $rc -eq 0 ] && got="PASS"
  if [ "$got" = "$want" ] && grep -q -- "$pat" <<<"$out"; then echo "ok    $label -> $got"; else echo "WRONG $label -> $got (wanted $want, pattern '$pat')"; echo "$out" | tail -8; FAILS=$((FAILS+1)); fi
}
expect PASS "good APK, correct sha + run id beside packed digits" "$SHA" "$RUN" "$WORK/good.apk" "PASS  CI run id $RUN inlined"
expect PASS "good APK, manifest parsed from binary tree"           "$SHA" "$RUN" "$WORK/good.apk" "manifest: minSdkVersion=26 targetSdkVersion=36 foregroundServiceType=0x400"
expect FAIL "wrong run id"                                          "$SHA" "11111111111" "$WORK/good.apk" "FAIL  CI run id 11111111111 inlined"
expect FAIL "wrong commit"                                          "ffffffffffffffffffffffffffffffffffffffff" "$RUN" "$WORK/good.apk" "FAIL  build commit ffffffffffff"
expect FAIL "JS bundle missing"                                     "$SHA" "$RUN" "$WORK/nobundle.apk" "FAIL  embedded JS bundle"
expect FAIL "leakage marker packaged (scan runs after manifest checks)" "$SHA" "$RUN" "$WORK/leaky.apk" "leakage scan exit=1"
[ "$FAILS" -eq 0 ] && echo "== APK RECHECK SELFTEST PASSED ==" || { echo "== APK RECHECK SELFTEST FAILED ($FAILS) =="; exit 1; }
