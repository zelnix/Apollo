#!/usr/bin/env bash
# Packaged RELEASE manifest audit (final M1 gate). Builds the release variant from a clean prebuild and audits the manifest of the
# ARTIFACTS THAT WOULD SHIP — the release APK (aapt2, binary manifest) and the release AAB (bundletool, bundle-derived manifest) —
# never a source or merged-intermediate manifest. Signing: Expo's placeholder (debug keystore) — this gate audits packaging, not
# distribution signing. Evidence: docs/evidence/release-*.  Run from repo root; needs JDK 17, Android SDK (build-tools + NDK), Node.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="$ROOT/frontend"
OUT="$ROOT/docs/evidence"; mkdir -p "$OUT"
BUNDLETOOL_VERSION="${BUNDLETOOL_VERSION:-1.17.2}"
exec > >(tee "$OUT/release-manifest-audit.log") 2>&1
echo "== Guard Dog packaged RELEASE manifest audit $(date -u +%FT%TZ) =="
PKG="$(python3 -c "import json;print(json.load(open('$APP/app.json'))['expo']['android']['package'])")"
echo "expected package: $PKG"

echo "-- 0. auditor self-test (parsers + rules on fixtures)"
python3 "$ROOT/scripts/ci/release_manifest_audit.py" --selftest

echo "-- 1. clean prebuild (same config plugin as the proof APK)"
cd "$APP"
yarn install --frozen-lockfile
(cd "$ROOT/packages/guarddog-contracts" && node scripts/sync-to-app.mjs)
export EXPO_PUBLIC_GIT_SHA="${EXPO_PUBLIC_GIT_SHA:-$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)}"
export EXPO_PUBLIC_CI_RUN_ID="${EXPO_PUBLIC_CI_RUN_ID:-local}"
npx expo prebuild --platform android --clean --no-install

echo "-- 2. release variant: APK + AAB"
cd android
grep -n "signingConfig" app/build.gradle | sed 's/^/  build.gradle: /'
./gradlew --quiet :app:assembleRelease :app:bundleRelease -PreactNativeArchitectures="${GD_RELEASE_ABIS:-arm64-v8a}"
APK="$(ls app/build/outputs/apk/release/*.apk | head -1)"
AAB="$(ls app/build/outputs/bundle/release/*.aab | head -1)"
cp "$APK" "$OUT/guarddog-release.apk"; cp "$AAB" "$OUT/guarddog-release.aab"
APK_SHA="$(sha256sum "$OUT/guarddog-release.apk" | cut -d' ' -f1)"; AAB_SHA="$(sha256sum "$OUT/guarddog-release.aab" | cut -d' ' -f1)"
printf '{"releaseApkSha256":"%s","releaseAabSha256":"%s","commit":"%s","workflowRunId":"%s","repository":"%s","runAttempt":"%s","abis":"%s","signing":"expo placeholder debug keystore (packaging audit only)","generatedAt":"%s"}\n' \
  "$APK_SHA" "$AAB_SHA" "${GITHUB_SHA:-$(git -C "$ROOT" rev-parse HEAD)}" "${GITHUB_RUN_ID:-local}" "${GITHUB_REPOSITORY:-local}" "${GITHUB_RUN_ATTEMPT:-1}" "${GD_RELEASE_ABIS:-arm64-v8a}" "$(date -u +%FT%TZ)" > "$OUT/release-provenance.json"
cat "$OUT/release-provenance.json"

echo "-- 3. APK: binary manifest of the packaged release APK (aapt2)"
AAPT2="$(ls -d "${ANDROID_HOME:-$ANDROID_SDK_ROOT}"/build-tools/*/aapt2 2>/dev/null | sort -V | tail -1)"
[ -x "$AAPT2" ] || { echo "aapt2 not found"; exit 2; }
"$AAPT2" dump badging "$OUT/guarddog-release.apk" > "$OUT/release-apk-badging.txt"
"$AAPT2" dump xmltree --file AndroidManifest.xml "$OUT/guarddog-release.apk" > "$OUT/release-apk-AndroidManifest.txt"
grep -E "^package:|^sdkVersion|^targetSdkVersion|^native-code|^application-debuggable" "$OUT/release-apk-badging.txt" | sed 's/^/  /' || true
set +e
python3 "$ROOT/scripts/ci/release_manifest_audit.py" apk "$OUT/release-apk-AndroidManifest.txt" "$OUT/release-apk-badging.txt" \
  "$OUT/release-manifest-audit-apk.txt" "$OUT/release-apk-permissions.txt" "$PKG"
APK_STATUS=$?
set -e

echo "-- 4. AAB: bundle-derived manifest of the packaged release AAB (bundletool $BUNDLETOOL_VERSION)"
BT="$ROOT/.tools/bundletool-all-$BUNDLETOOL_VERSION.jar"; mkdir -p "$ROOT/.tools"
[ -f "$BT" ] || curl -fsSL -o "$BT" "https://github.com/google/bundletool/releases/download/$BUNDLETOOL_VERSION/bundletool-all-$BUNDLETOOL_VERSION.jar"
java -jar "$BT" dump manifest --bundle "$OUT/guarddog-release.aab" > "$OUT/release-aab-AndroidManifest.xml"
set +e
python3 "$ROOT/scripts/ci/release_manifest_audit.py" aab "$OUT/release-aab-AndroidManifest.xml" \
  "$OUT/release-manifest-audit-aab.txt" "$OUT/release-aab-permissions.txt" "$PKG"
AAB_STATUS=$?
set -e

echo "-- 5. APK vs AAB permission sets must be identical"
if diff <(sed 1d "$OUT/release-apk-permissions.txt") <(sed 1d "$OUT/release-aab-permissions.txt") > "$OUT/release-apk-vs-aab-permissions.diff"; then
  echo "PASS  identical <uses-permission> sets in APK and AAB"; SAME=0
else
  echo "FAIL  APK and AAB permission sets differ (see release-apk-vs-aab-permissions.diff)"; cat "$OUT/release-apk-vs-aab-permissions.diff"; SAME=1
fi

echo "-- 6. release APK content sanity (no backend .env / private material; JS bundle embedded)"
TMP="$(mktemp -d)"; unzip -q -o "$OUT/guarddog-release.apk" -d "$TMP"
LEAK=0
for m in "GD_M1_SIGNING_PRIVATE_KEY_B64" "GD_ADMIN_TOKEN" "BEGIN PRIVATE KEY" "MONGO_URL="; do
  if grep -rqa --exclude-dir=lib -- "$m" "$TMP"; then echo "FAIL  marker '$m' found in release APK"; LEAK=1; fi
done
[ -s "$TMP/assets/index.android.bundle" ] && echo "PASS  embedded JS bundle ($(stat -c %s "$TMP/assets/index.android.bundle") bytes)" || { echo "FAIL  no embedded JS bundle"; LEAK=1; }
rm -rf "$TMP"
[ "$LEAK" -eq 0 ] && echo "PASS  no private key / admin token / DB URL markers in release APK"

echo "-- 7. shipped PROOF-HARNESS strings (release keeps the M1 harness; informational)"
if unzip -p "$OUT/guarddog-release.apk" assets/index.android.bundle | grep -aq "m1-6"; then echo "INFO  evidence schema m1-6 present in release bundle"; fi

if [ "$APK_STATUS" -ne 0 ] || [ "$AAB_STATUS" -ne 0 ] || [ "$SAME" -ne 0 ] || [ "$LEAK" -ne 0 ]; then
  echo "== RELEASE MANIFEST AUDIT FAILED (apk=$APK_STATUS aab=$AAB_STATUS same-permissions=$SAME leak=$LEAK) =="; exit 1
fi
echo "== RELEASE MANIFEST AUDIT PASSED (apk + aab) =="
