# M1 CI runbook — Save to GitHub → run `native-gates` → attach evidence

Nothing here needs code changes. Bundle v25 stays frozen. Do **not** sideload any APK before the artifact audit.

## 1. Push the workspace
Emergent top bar → **Save to GitHub** → choose/create the repository and branch → confirm. (The Emergent build session has no GitHub
access of its own; this is the only handoff path.) The push includes `.github/workflows/native-gates.yml`.

## 2. Repository configuration (GitHub → Settings → Secrets and variables → Actions)
- **Variables** tab → `GD_BACKEND_URL` = public backend base URL that serves `GET /api/config`, `/api/rules/gd-m1-controlled-block/latest`, `/api/keys`
  (no trailing slash). This is the only configuration the workflow needs.
- **Secrets**: none. The workflow contains no `secrets.*` references by design (ephemeral CI signing keys; mobile jobs consume public material only).
- Actions → General → Workflow permissions may stay "Read repository contents" (the workflow declares `permissions: contents: read`).

## 3. Run
Actions → **native-gates** → Run workflow (also runs on push). Four jobs:
`android` (AC-01, ubuntu) · `android-dev-build` (AC-04 APK + manifest audit + APK recheck, ubuntu, needs `android`) · `ios` (AC-02, macos-15) · `executable-suites` (pytest/node, ephemeral keys).

## 4. Download artifacts and attach here
| Artifact | Files to attach |
|---|---|
| `android-native-gate` | `android-native-gate.txt` (+ `android-*-test-results/*.xml` if regenerated) |
| `android-dev-build` | `apk-recheck.txt`, `apk-provenance.json`, `merged-manifest-audit.txt`, `android-dev-build.txt` (keep `guarddog-m1-dev.apk` locally; do not install yet) |
| `ios-native-gate` | `ios-native-gate.txt` |
| any failed job | the failed step's raw log |

## 5. Audit criteria (what will be checked before the APK is cleared)
- all jobs actually executed (no skipped gate steps); AC-02 shows SwiftPM build + parity tests + Expo iOS module compiled via CocoaPods/xcodebuild
- `android-dev-build.txt`: `distribution: bundle v25 keyId=gd-m1-test-ed25519-001 … frozen=25` and `app consumes: signed frozen bundle + pinned PUBLIC key only`
- `merged-manifest-audit.txt`: `MERGED MANIFEST AUDIT: PASS`
- `apk-recheck.txt`: `== APK RECHECK PASSED ==`, `native-code exactly ['arm64-v8a']`, `application-debuggable`, sdk 26/36, no leakage
- `apk-provenance.json`: `apkSha256` is a 64-hex digest; `commit` = pushed commit; `workflowRunId` = the run you triggered
- After clearance: sideload **that** APK; the device proof report must show `provenance.apkSha256` identical to `apk-provenance.json`.
