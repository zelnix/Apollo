#!/usr/bin/env bash
# APK artifact recheck (run BEFORE the APK touches a phone). Usage: bash scripts/ci/apk-recheck.sh <path/to/guarddog-m1-dev.apk>
# Proves: intended dev build (package, debuggable), frozen SDK levels, arm64-v8a-only native code, VpnService manifest facts,
# and that NO signing/private-key material or backend .env content is packaged. Evidence: docs/evidence/apk-recheck.txt
set -euo pipefail
APK="${1:?apk path}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/docs/evidence"; mkdir -p "$OUT"
REPORT="$OUT/apk-recheck.txt"
EXPECTED_ABIS="${GD_DEV_ABIS:-arm64-v8a}"
PKG="$(python3 -c "import json;print(json.load(open('$ROOT/frontend/app.json'))['expo']['android']['package'])")"

AAPT2="$(ls -d "${ANDROID_HOME:-$ANDROID_SDK_ROOT}"/build-tools/*/aapt2 2>/dev/null | sort -V | tail -1)"
[ -x "$AAPT2" ] || { echo "aapt2 not found under ANDROID_HOME build-tools"; exit 2; }

{
echo "== Guard Dog APK recheck $(date -u +%FT%TZ) =="
APK_SHA="$(sha256sum "$APK" | cut -d' ' -f1)"
GIT_SHA="${GITHUB_SHA:-$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)}"
RUN_ID="${GITHUB_RUN_ID:-local}"
echo "apk: $APK ($(stat -c %s "$APK") bytes)"
echo "PROVENANCE apkSha256=$APK_SHA commit=$GIT_SHA workflowRunId=$RUN_ID repo=${GITHUB_REPOSITORY:-local} runAttempt=${GITHUB_RUN_ATTEMPT:-1}"
printf '{"apkSha256":"%s","commit":"%s","workflowRunId":"%s","repository":"%s","runAttempt":"%s","generatedAt":"%s"}\n' \
  "$APK_SHA" "$GIT_SHA" "$RUN_ID" "${GITHUB_REPOSITORY:-local}" "${GITHUB_RUN_ATTEMPT:-1}" "$(date -u +%FT%TZ)" > "$OUT/apk-provenance.json"
echo "device proof must report the same apkSha256 (harness report → provenance.apkSha256)"
BADGING="$("$AAPT2" dump badging "$APK")"
echo "$BADGING" | grep -E "^package:|^sdkVersion|^targetSdkVersion|^native-code|^application-debuggable|^uses-permission" | sed 's/^/  /'
"$AAPT2" dump xmltree --file AndroidManifest.xml "$APK" > "$OUT/apk-AndroidManifest.txt"

# Checks read the BINARY manifest tree (authoritative) for SDK levels and the foreground-service flag; `aapt2 dump badging`
# omits `sdkVersion:` on some build-tools releases and renders flags with varying hex width (0x400 vs 0x00000400).
set +e
python3 - "$BADGING" "$OUT/apk-AndroidManifest.txt" "$PKG" "$EXPECTED_ABIS" <<'PY'
import re, sys
badging, tree, pkg, abis = sys.argv[1], open(sys.argv[2]).read(), sys.argv[3], set(sys.argv[4].split(","))
perms = set(re.findall(r"uses-permission: name='([^']+)'", badging))
native = set(re.findall(r"native-code: (.*)", badging)[0].replace("'", "").split()) if "native-code:" in badging else set()
svc = "com.guarddog.vpn.GuardDogVpnService" in tree

def attr_int(name):
    """Numeric value of an android:<name> attribute from `aapt2 dump xmltree` (accepts `=26`, `=0x400`, `=(type 0x11)0x00000400`)."""
    m = re.search(rf"android:{name}(?:\(0x[0-9a-fA-F]+\))?=(?:\(type 0x[0-9a-fA-F]+\))?\s*(0x[0-9a-fA-F]+|\d+)", tree)
    return int(m.group(1), 0) if m else None

def badging_int(key):
    m = re.search(rf"^{key}:'(\d+)'", badging, re.M)
    return int(m.group(1)) if m else None

min_sdk = attr_int("minSdkVersion") if attr_int("minSdkVersion") is not None else badging_int("sdkVersion")
target_sdk = attr_int("targetSdkVersion") if attr_int("targetSdkVersion") is not None else badging_int("targetSdkVersion")
fgs_type = attr_int("foregroundServiceType") or 0
print(f"manifest: minSdkVersion={min_sdk} targetSdkVersion={target_sdk} foregroundServiceType={hex(fgs_type)}")
checks = {
  f"package is {pkg}": f"package: name='{pkg}'" in badging,
  "development build (application-debuggable)": "application-debuggable" in badging,
  "minSdkVersion 26": min_sdk == 26,
  "targetSdkVersion 36": target_sdk == 36,
  f"native-code exactly {sorted(abis)}": native == abis,
  "GuardDogVpnService in APK manifest": svc,
  "BIND_VPN_SERVICE on service": svc and "android.permission.BIND_VPN_SERVICE" in tree,
  "systemExempted foreground type": svc and bool(fgs_type & 0x400),  # FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED = 1024
  "android.net.VpnService intent action": "android.net.VpnService" in tree,
  "uses-permission INTERNET/ACCESS_NETWORK_STATE/FOREGROUND_SERVICE/FGS_SYSTEM_EXEMPTED": {"android.permission.INTERNET", "android.permission.ACCESS_NETWORK_STATE", "android.permission.FOREGROUND_SERVICE", "android.permission.FOREGROUND_SERVICE_SYSTEM_EXEMPTED"} <= perms,
}
for hr in ["QUERY_ALL_PACKAGES", "PACKAGE_USAGE_STATS", "READ_SMS", "READ_CALL_LOG", "READ_CONTACTS", "MANAGE_EXTERNAL_STORAGE", "BIND_ACCESSIBILITY_SERVICE",
           "READ_EXTERNAL_STORAGE", "WRITE_EXTERNAL_STORAGE", "RECORD_AUDIO", "CAMERA", "ACCESS_FINE_LOCATION", "READ_PHONE_STATE"]:
    checks[f"absent: {hr}"] = f"android.permission.{hr}" not in perms
for k, v in checks.items(): print(f"{'PASS' if v else 'FAIL'}  {k}")
print("all permissions: " + ", ".join(sorted(p.split(".")[-1] for p in perms)))
sys.exit(0 if all(checks.values()) else 1)
PY
MANIFEST_STATUS=$?
set -e

# The leakage scan ALWAYS runs (even after a manifest-check failure) so the evidence file carries both verdicts.
echo "-- secret / config leakage scan (APK contents)"
TMP="$(mktemp -d)"; unzip -q -o "$APK" -d "$TMP"
set +e
python3 - "$TMP" "$ROOT" <<'PY'
import base64, os, re, sys
apk_dir, root = sys.argv[1], sys.argv[2]
# Values that must never ship: private seeds / admin token from the developer's backend .env (read locally, never printed).
forbidden = {}
env = os.path.join(root, "backend", ".env")
if os.path.exists(env):
    for line in open(env):
        m = re.match(r'^(GD_M1_SIGNING_PRIVATE_KEY_B64|GD_M1_SECONDARY_PRIVATE_KEY_B64|GD_ADMIN_TOKEN|MONGO_URL|WEBRISK_API_KEY)=\"?([^\"\n]+)\"?', line)
        if m and m.group(2) and m.group(2) not in ("mongodb://localhost:27017",):
            forbidden[m.group(1)] = m.group(2).encode()
markers = [b"GD_M1_SIGNING_PRIVATE_KEY_B64", b"GD_M1_SECONDARY_PRIVATE_KEY_B64", b"GD_ADMIN_TOKEN", b"X-GuardDog-Admin-Token", b"MONGO_URL=", b"BEGIN PRIVATE KEY", b"BEGIN OPENSSH PRIVATE KEY"]
hits = []
for dp, _, fs in os.walk(apk_dir):
    for f in fs:
        p = os.path.join(dp, f); rel = os.path.relpath(p, apk_dir)
        if f in (".env", ".env.example") or rel.startswith("backend/"): hits.append(f"packaged file {rel}")
        data = open(p, "rb").read()
        for name, val in forbidden.items():
            if val in data: hits.append(f"{name} value found in {rel}")
        for m in markers:
            if m in data: hits.append(f"marker {m.decode()} in {rel}")
# public material is expected: pinned public key in the SDK
pub_ok = any(b"ccf41NL6VHYQsH171Lw98hKiIoQFvAY0t171X4PL/ac=" in open(os.path.join(dp, f), "rb").read() for dp, _, fs in os.walk(apk_dir) for f in fs if f.endswith((".dex",)))
print(f"{'PASS' if pub_ok else 'INFO'}  pinned PUBLIC key present in dex (expected)")
if hits:
    print("FAIL  secret/config leakage:"); [print("      " + h) for h in hits]; sys.exit(1)
print("PASS  no private key material, admin token, DB URL or backend .env content packaged")
PY
LEAK_STATUS=$?
set -e
rm -rf "$TMP"
if [ "$MANIFEST_STATUS" -ne 0 ] || [ "$LEAK_STATUS" -ne 0 ]; then
  echo "== APK RECHECK FAILED (manifest checks exit=$MANIFEST_STATUS, leakage scan exit=$LEAK_STATUS) =="
  exit 1
fi
echo "== APK RECHECK PASSED =="
} | tee "$REPORT"
exit "${PIPESTATUS[0]}"
