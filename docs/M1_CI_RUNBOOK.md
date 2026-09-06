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

### Run 34035232915 (tip `05161e2`) → run 4 (tip `6d19825`): CI green, but the APK crashed on the proof phone — correction pass 2
Device exception at first launch, before the harness: `UnsupportedOperationException: This function has a reified type parameter and thus can
only be inlined at compilation time, not called directly` → `Intrinsics.reifiedOperationMarker` → `GuardDogExpoModule.definition (GuardDogExpoModule.kt:346)`.
Root cause (bytecode-proven with `javap -c -p` on the compiled module): 12 surviving `reifiedOperationMarker` + `io.github.lukmccall.pika.throwNonReified*Error`
stubs inlined into `definition()` by the `Function`/`AsyncFunction` registrations with typed arguments (`configure`, `acceptRuleBundle`, `analyzeUrl`,
`requestPermission`, `startProtection`, `stopProtection`). Expo SDK 57 resolves those argument types with the **Pika Kotlin compiler plugin**, which is applied
only by `expo-module-gradle-plugin`; `packages/guarddog-expo-module/android/build.gradle` still used the legacy `ExpoModulesCorePlugin.gradle` path, so the
module compiled (AC-01 step 5 passed) but could never register. Fix + guards (reviewer-requested; **expected** in the next diff):
- `packages/guarddog-expo-module/android/build.gradle` — `plugins { id 'com.android.library'; id 'expo-module-gradle-plugin' }`, `expoModule { canBePublished false }`,
  JVM unit-test deps, `unitTests.returnDefaultValues = true`. No Kotlin/Swift source, bundle, verifier or VPN change.
- `packages/guarddog-expo-module/android/src/test/.../GuardDogExpoModuleDefinitionTest.kt` — executes the REAL `GuardDogExpoModule().definition()` (as Expo's
  ModuleHolder does) and scans the compiled class for `reifiedOperationMarker`/`throwNonReified`. Pre-fix: 2/2 FAIL with the exact device exception
  (`…definition(GuardDogExpoModule.kt:346)`); post-fix: 2/2 PASS, `reifiedOperationMarker=0`, 14 compile-time `PTypeDescriptor` constructions.
- `scripts/ci/android-native-gate.sh` step 5b — runs that test in the prebuilt app, copies `expo-module-test-results/*.xml`, and fails if any
  `GuardDogExpoModule*.class` under `build/tmp/kotlin-classes/debug` contains a reified stub. "assembleDebug succeeded" alone no longer qualifies an APK.
- `docs/M1_CI_RUNBOOK.md` (this note).
Run-4 APK `ea719d72…`/its successor are void; the next run yields a new provenance-bound APK.

### Run 34044357809 (tip `5c544d0`) — 4/4 green, module registers on the phone; next layer: "Unable to load script" — correction pass 3
Device: `Unable to load script. Make sure you're running Metro or that your bundle 'index.android.bundle' is packaged correctly` →
`ReactInstance.loadJSBundleFromAssets`. The registration crash is gone (run-5 fix confirmed on hardware); the debug APK simply contains no JS.
Root cause: `:app:assembleDebug` with React Native's default `debuggableVariants = ["debug"]` skips `createBundleDebugJsAndAssets`, so the "dev" APK
expects Metro — but the M1 proof APK must be self-contained (and `EXPO_PUBLIC_GIT_SHA`/`CI_RUN_ID` were never actually baked in). Fix + guard:
- `packages/guarddog-expo-module/app.plugin.js` — `withAppBuildGradle` inserts `debuggableVariants = []` after `bundleCommand = "export:embed"` in the
  prebuilt `app/build.gradle`, so the debug variant embeds `assets/index.android.bundle` (Hermes, `--dev false`) with the provenance env inlined. Metro
  still wins when reachable. Verified locally via `expo prebuild` (line present); no Kotlin/Swift/bundle/verifier/VPN change.
- `scripts/ci/apk-recheck.sh` — `PASS embedded JS bundle assets/index.android.bundle (N bytes)` (fails if missing/<100 KB) and
  `PASS build commit <sha>… inlined in the JS bundle` (the run's `GITHUB_SHA` must appear in the bundle bytes). Mock-tested: missing bundle → FAIL,
  wrong SHA → FAIL, correct → PASS.
- `docs/M1_CI_RUNBOOK.md` (this note). Run-5 APK is void; run 6 yields the sideload candidate.

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
- `android-native-gate.txt`: `expo module definition test: 2 run, 0 failed`, `reified stubs: 0`, `expo module: loads (definition() evaluated, bytecode clean)`
- `android-dev-build.txt`: `distribution: bundle v25 keyId=gd-m1-test-ed25519-001 … frozen=25` and `app consumes: signed frozen bundle + pinned PUBLIC key only`
- `merged-manifest-audit.txt`: `MERGED MANIFEST AUDIT: PASS`
- `apk-recheck.txt`: `== APK RECHECK PASSED ==`, `native-code exactly ['arm64-v8a']`, `application-debuggable`, sdk 26/36, no leakage,
  `PASS embedded JS bundle assets/index.android.bundle`, `PASS build commit <run sha>… inlined in the JS bundle`
- `apk-provenance.json`: `apkSha256` is a 64-hex digest; `commit` = pushed commit; `workflowRunId` = the run you triggered
- After clearance: sideload **that** APK; the device proof report must show `provenance.apkSha256` identical to `apk-provenance.json`.
