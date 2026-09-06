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
Actions → **native-gates** → Run workflow (leave the `xcode` input at `26.4` unless told otherwise; the iOS job runs on `macos-26`). The **whole workflow = four jobs**:
`android` (AC-01, ubuntu) · `android-dev-build` (AC-04 APK + manifest audit + APK recheck, ubuntu, needs `android`) · `ios` (AC-02, macos-26, Xcode 26.4) ·
`executable-suites` (pytest/node with ephemeral keys, after dependency install).
Let the run finish completely — do **not** re-run individual failed jobs mid-stream; the audit needs one coherent run ID.

### Run 34032597988 (tip `8869ce7`) — audited, APK NOT cleared; correction pass applied
Provenance PASS, `android` PASS (29/29, GitHub-reproduced AC-01), `merged-manifest-audit` PASS, dev APK built (v25 / `gd-m1-test-ed25519-001`, arm64-v8a, 26/36).
Three CI defects, none in Guard Dog enforcement or the APK itself — fixed in the next commit (reviewer-requested; these paths are **expected** in the next diff):
- `scripts/ci/apk-recheck.sh` — `minSdkVersion 26` / `systemExempted foreground type` were parser false negatives (badging omitted `sdkVersion:`; flag rendered `0x00000400`).
  Now reads both from the binary manifest tree and parses the flag numerically; the leakage scan always runs and the verdict line reports both statuses.
- `.gitignore` + `backend/.env.example` — the template was swallowed by `.env.*`, so `executable-suites` died at `cp backend/.env.example backend/.env`
  before pytest/node ran. Negation rule added; the committed file has empty key/token/DB fields only.
- `.github/workflows/native-gates.yml` — `ios` moves to `macos-26` / Xcode `26.4` (Swift 6.3). Run 34032597988 on Xcode 26.1 failed in
  `[CP-User] Build ExpoModulesJSI xcframework` (`'weak' must be a mutable variable`, RuntimeScheduler `SWIFT_RETURNS_*`) inside
  `expo-modules-jsi 57.0.8`; GuardDogCore itself was 10/10. No Expo or Guard Dog Swift source is patched.
- `docs/M1_CI_RUNBOOK.md` (this note).

## 4. Download artifacts and attach here
| Artifact | Files to attach |
|---|---|
| `android-native-gate` | `android-native-gate.txt` (+ `android-*-test-results/*.xml` if regenerated) |
| `android-dev-build` | `apk-recheck.txt`, `apk-provenance.json`, `merged-manifest-audit.txt`, `android-dev-build.txt` (keep `guarddog-m1-dev.apk` locally; **do not install it, even if green**) |
| `ios-native-gate` | `ios-native-gate.txt`, `ios-expo-package-audit.txt`, and `ios-xcodebuild-full.log` if iOS failed |
| `executable-suites` | job log showing dependency install succeeded and pytest/node suites actually ran |
| any failed job | the failed step's raw log |

Provenance rule (reviewer-approved): the **actual branch tip** used by the run is the authoritative build commit.
- Build provenance: `apk-provenance.json.commit` == the run's `GITHUB_SHA`; `workflowRunId` == that run; `apkSha256` == SHA-256 of the produced APK.
- Code provenance: `dbd58e5` must be an ancestor of the build commit, and `git diff --name-only dbd58e5 <build-sha>` must list only paths under
  `docs/` or `memory/` (use `--name-only`, not `--stat`). Any path under `.github/`, `apps/`, `packages/`, `backend/`, `security/`, `scripts/`,
  `frontend/` (sources, `app.json`, `package.json`, `yarn.lock`) or other build configuration is inspected, never auto-accepted as "docs-only".

Audit focus for the next run: `executable-suites` reaches and passes pytest + node; AC-02 compiles under Xcode 26.4 on `macos-26`; `apk-recheck.txt`
prints `manifest: minSdkVersion=26 targetSdkVersion=36 foregroundServiceType=0x400`, every PASS line, the leakage PASS, and `== APK RECHECK PASSED ==`;
v25 remains the served/frozen bundle; `apk-provenance.json.commit` = the new tip and `workflowRunId` = that run.

## 5. Audit criteria (what will be checked before the APK is cleared)
- all jobs actually executed (no skipped gate steps); AC-02 shows SwiftPM build + parity tests + Expo iOS module compiled via CocoaPods/xcodebuild
- `android-dev-build.txt`: `distribution: bundle v25 keyId=gd-m1-test-ed25519-001 … frozen=25` and `app consumes: signed frozen bundle + pinned PUBLIC key only`
- `merged-manifest-audit.txt`: `MERGED MANIFEST AUDIT: PASS`
- `apk-recheck.txt`: `== APK RECHECK PASSED ==`, `native-code exactly ['arm64-v8a']`, `application-debuggable`, sdk 26/36, no leakage
- `apk-provenance.json`: `apkSha256` is a 64-hex digest; `commit` = pushed commit; `workflowRunId` = the run you triggered
- After clearance: sideload **that** APK; the device proof report must show `provenance.apkSha256` identical to `apk-provenance.json`.
