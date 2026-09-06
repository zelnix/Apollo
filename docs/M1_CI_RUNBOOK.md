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
Before clicking **Run workflow**, confirm the selected branch contains commit **`dbd58e5`** (`git log --oneline -1` after Save to GitHub).
Actions → **native-gates** → Run workflow (leave the `xcode` input at `26.1` unless told otherwise). The **whole workflow = four jobs**:
`android` (AC-01, ubuntu) · `android-dev-build` (AC-04 APK + manifest audit + APK recheck, ubuntu, needs `android`) · `ios` (AC-02, macos-15, Xcode 26.1) ·
`executable-suites` (pytest/node with ephemeral keys, after dependency install).
Let the run finish completely — do **not** re-run individual failed jobs mid-stream; the audit needs one coherent run ID.

## 4. Download artifacts and attach here
| Artifact | Files to attach |
|---|---|
| `android-native-gate` | `android-native-gate.txt` (+ `android-*-test-results/*.xml` if regenerated) |
| `android-dev-build` | `apk-recheck.txt`, `apk-provenance.json`, `merged-manifest-audit.txt`, `android-dev-build.txt` (keep `guarddog-m1-dev.apk` locally; **do not install it, even if green**) |
| `ios-native-gate` | `ios-native-gate.txt`, `ios-expo-package-audit.txt`, and `ios-xcodebuild-full.log` if iOS failed |
| `executable-suites` | job log showing dependency install succeeded and pytest/node suites actually ran |
| any failed job | the failed step's raw log |

Audit focus for this run: GitHub reproduces AC-01; executable suites run after a clean dependency install; AC-02 compiles under the pinned Xcode 26.1
path; the dev APK is generated; v25 remains the served/frozen bundle; `apk-provenance.json` ties `commit` = `dbd58e5…` and `workflowRunId` = this run.

## 5. Audit criteria (what will be checked before the APK is cleared)
- all jobs actually executed (no skipped gate steps); AC-02 shows SwiftPM build + parity tests + Expo iOS module compiled via CocoaPods/xcodebuild
- `android-dev-build.txt`: `distribution: bundle v25 keyId=gd-m1-test-ed25519-001 … frozen=25` and `app consumes: signed frozen bundle + pinned PUBLIC key only`
- `merged-manifest-audit.txt`: `MERGED MANIFEST AUDIT: PASS`
- `apk-recheck.txt`: `== APK RECHECK PASSED ==`, `native-code exactly ['arm64-v8a']`, `application-debuggable`, sdk 26/36, no leakage
- `apk-provenance.json`: `apkSha256` is a 64-hex digest; `commit` = pushed commit; `workflowRunId` = the run you triggered
- After clearance: sideload **that** APK; the device proof report must show `provenance.apkSha256` identical to `apk-provenance.json`.
