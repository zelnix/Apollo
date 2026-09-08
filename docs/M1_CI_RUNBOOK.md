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
Actions → **native-gates** → Run workflow (leave the `xcode` input at `26.4` unless told otherwise; the iOS job runs on `macos-26`). The **whole workflow = five jobs**:
`android` (AC-01, ubuntu) · `android-dev-build` (AC-04 APK + manifest audit + APK recheck, ubuntu, needs `android`) ·
`android-startup-smoke` (same commit/script built for x86_64, installed on a KVM emulator with no Metro, must reach `GD_SMOKE_READY`; needs `android`) ·
`ios` (AC-02, macos-26, Xcode 26.4) · `executable-suites` (pytest/node with ephemeral keys, after dependency install).
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
  `PASS build commit <sha>… inlined in the JS bundle` and `PASS CI run id <id> inlined in the JS bundle` (the run's `GITHUB_SHA` and `GITHUB_RUN_ID`
  must both appear in the bundle bytes as plain substrings). Mock-tested: missing bundle → FAIL, wrong SHA → FAIL,
  run id missing → FAIL, correct → PASS (see apk-recheck-selftest.sh).
- `docs/M1_CI_RUNBOOK.md` (this note). Run-5 APK is void; run 6 yields the sideload candidate.

### Run 34072034928 (tip `e5a171c`) — packaging fix confirmed; one verifier false negative — correction pass 4
`android`/`ios`/`executable-suites` PASS; `android-dev-build` built and embedded `assets/index.android.bundle` with the commit inlined, but the new
run-id check rejected the real bundle: the digit-boundary regex assumed the literal is isolated, whereas Hermes packs it next to other digit bytes.
- `scripts/ci/apk-recheck.sh` — run-id check is a plain substring test (`run_id.encode() in blob`); the 11-digit id plus the 40-hex commit are the binding.
- `scripts/ci/apk-recheck-selftest.sh` — new mock-aapt2 self-test (no SDK needed): correct sha + run id beside packed digits → PASS; wrong run id,
  wrong commit, missing bundle, leaked marker → FAIL; binary-manifest parsing line asserted. Run locally with `bash scripts/ci/apk-recheck-selftest.sh`.
- `docs/M1_CI_RUNBOOK.md` (this note). Run-6 APK is void; run 7 yields the sideload candidate.

### Run 34078207844 (tip `9d53df9`) — 4/4 green, APK recheck PASS end-to-end; phone reaches JS and hits a start-up RN Appearance crash — correction pass 5
Verified from the API + artifacts: provenance diff exact; `apk-provenance.json` = `apkSha256 0225fa78…563f9a`, commit `9d53df9…`, run `34078207844`;
`apk-recheck.txt` all PASS incl. `embedded JS bundle (2357980 bytes)`, commit + run id inlined, leakage clean; `distribution: bundle v25 … frozen=25`.
Artifact hygiene finding: the `android-dev-build` artifact uploads the whole `docs/evidence/`, which still contains the **git-tracked, stale**
`android-native-gate.txt` from a local run (2026-09-06T11:19, aarch64). The authoritative AC-01 log is only in the `android-native-gate` artifact.
Always read gate logs from their own job's artifact; treat any `docs/evidence/*.txt` whose header host/date does not match the run as stale.
Closed in run 8: every job's `upload-artifact` now lists only the files that job generates (`android`: gate log + test XML; `android-dev-build`: APK,
build log, manifests, recheck, provenance; `ios`: gate log + Xcode/pod logs; `android-startup-smoke`: smoke report/logcat/UI/screenshot), so a
downloaded artifact can no longer contain a git-tracked local evidence file.
Device: `Parameter specified as non-null is null: AppearanceModule.setColorScheme, parameter style` (`AppearanceModule.kt`) at JS start-up — the
bundle loaded (packaging fix confirmed); `frontend/src/theme.ts` called `Appearance.setColorScheme(null)` at import to "follow the device", which
React Native 0.86 Android rejects (`ColorSchemeName = 'light' | 'dark' | 'unspecified'`).
- `frontend/src/theme.ts` — `setColorScheme(scheme ?? "unspecified")`. UI theme plumbing only; no Guard Dog / bundle / verifier / VPN change.
  Caller identified from source, not inferred: `theme.ts` line `setColorScheme?.(themes.dark ? null : defaultScheme)` runs at module import;
  RN's `Appearance.setColorScheme` forwards the value unchanged to `NativeAppearance.setColorScheme` (`Appearance.js:100`), so `null` crossed the
  bridge into the non-null Kotlin parameter. `userInterfaceStyle: "automatic"` is consumed natively by Expo and is not involved.
- **New CI gate `android-startup-smoke`** (`.github/workflows/native-gates.yml`, `scripts/ci/android-startup-smoke.sh`, marker in `frontend/app/index.tsx`):
  builds the same commit with `android-dev-build.sh` for `x86_64` (GitHub's KVM emulator cannot execute arm64 natively; bootstrap failures are
  ABI-independent — the arm64-v8a acceptance APK still comes from `android-dev-build`), boots an API 34 emulator, installs with no Metro /
  `adb reverse`, launches `MainActivity` and requires: no `FATAL EXCEPTION` / `JavascriptException` / `Unable to load script` / non-null crash,
  the harness `GD_SMOKE_READY {gitSha, ciRunId, apkSha256, native}` logcat marker with `gitSha == github.sha` and `native:true`, a 15 s stable
  window, live process, `MainActivity` resumed, and `M1 PROOF HARNESS` present in the `uiautomator` hierarchy. Evidence: `android-startup-smoke.txt`,
  `-logcat.txt`, `-ui.xml`, `.png` (uploaded from that job only, so no stale files ride along). Would have failed runs 4, 5, 6 and 7.
- `docs/M1_CI_RUNBOOK.md` (this note). Run-7 APK is void; run 8 yields the sideload candidate.

### Run 34096450762 (tip `c481f1f`) — 5/5 green incl. the new start-up smoke; branding change requested before run 9
User request: display name **Apollo Native Gates** + supplied artwork as the icon. Changed `frontend/app.json` `name` (was the template default
`frontend`), `icon`/`adaptive-icon` (foreground scaled to the safe zone on `#0a101c`), splash image and favicon; harness eyebrow reads
`APOLLO NATIVE GATES · M1 PROOF HARNESS` (the smoke gate's `M1 PROOF HARNESS` token is preserved). **Unchanged:** `slug`, Android package
`com.emergent.guarddogm.k6cugf`, iOS bundle id, permissions, native code, bundle v25. Effect on the APK: `android:label` string + launcher
drawables only — a new provenance SHA as with any commit.
Reviewer correction (same push): the harness had no on-screen provenance before the enforcement proof — `readBuildProvenance()` was only used for the
CI marker and inside "Build JSON evidence". Added a read-only **Build provenance (this installed APK)** card between *Protection state* and *Backend*:
full APK SHA-256 and Git SHA (selectable mono text, no truncation), CI run ID, native module available yes/no, package/version/debuggable line.
Harness-only (`frontend/app/index.tsx`); the frozen public SDK, bundle v25, verifier, VPN and THREAT_BLOCKED path are untouched. Phone procedure:
open the app → compare the card with the run's `apk-provenance.json` (`apkSha256`, `commit`, `workflowRunId`) **before** pressing *Run proof*.

### Run 34106689038 (tip `47b878c`) — 4/5 green; `android-startup-smoke` false negative from an emulator system dialog — correction pass 6
The smoke job proved the app bootstrapped (`harness mounted after 4s`, marker gitSha == run SHA, `native=true`, process alive, `MainActivity`
resumed) and failed only at `harness header not found in UI hierarchy`: the uploaded `-ui.xml` was rooted in Android system UI showing
"Pixel Launcher isn't responding" (App info / Close app / Wait). No app fatal in logcat.
- `scripts/ci/android-startup-smoke.sh` — before the hierarchy assertion, the dump is classified: if the app does not own the visible hierarchy or a
  system dialog text is present, it logs `INFO unrelated system overlay detected (<text>); refocusing Apollo (attempt N)`, taps the dialog's
  Wait/OK/Close button when one exists, re-issues `am start` for `MainActivity`, waits and re-dumps (≤5 attempts). While retrying, the mandatory
  gates stay hard: any fatal-pattern log line or process death fails immediately. The header check is **not** skipped — it must pass once the app
  has clean focus, and `MainActivity` must still be the resumed activity afterwards. Classifier unit-checked against synthetic dumps
  (system dialog → dismiss coords; app hierarchy → no overlay; launcher in front → refocus only).
- `docs/M1_CI_RUNBOOK.md` (this note). Run-34106689038 APK (`10214cdf…`) is not the device candidate; the next fully green run is.

### Run 34117910707 (tip `f1fd234`) — 4/5 green; **phone provenance PASSED**; smoke false negative root-caused from evidence — correction pass 7
Phone (Build provenance card) = CI `apk-provenance.json`: `apkSha256 ed746066…38c5`, `commit f1fd234b…4536`, `workflowRunId 34117910707`; native yes;
v25 loaded; INACTIVE / consent not granted; 0 genuine blocks. **That installation stays on the phone untouched.**
Smoke root cause (from `android-startup-smoke-logcat.txt`, `-ui.xml`, `.txt` of the run — not inferred): Apollo pid 3676 started 12:02:41.996, emitted
`GD_SMOKE_READY` 12:02:53.679, and is still logging at 12:03:48.9 (last logcat line 12:03:49.7); **no** `am_proc_died`/`am_kill`/`has died`/ANR/FATAL
for the package; each refocus `am start` returned `result code=3` (intent delivered to top — already foreground). The script's process-death
branch never fired; the failure line was the header check. The `-ui.xml` contains 12 nodes, all `package="android"`: "Pixel Launcher isn't
responding" / Close app / Wait — `uiautomator dump` only sees the topmost window, and that system ANR dialog (caused by the `google_apis` image's
boot storm: wellbeing, messaging, quicksearchbox FGS starts; `am start -W` even timed out) sat above the alive, resumed app through all 5 attempts.
Verdict: test-environment defect; **no Apollo process death, no recovery relaunch needed or added.**
- `scripts/ci/android-startup-smoke.sh` — `settings put global hide_error_dialogs 1` (+ animation scales 0) before launch, so other processes' ANR/crash
  dialogs cannot occlude the app (Apollo's own fatals are still detected from logcat, which the dialog setting does not affect); 20 s post-boot settle;
  every failure path now prints **process-exit evidence** (`dumpsys activity exit-info <pkg>`, `am_proc_died/am_kill/am_anr/am_crash` events buffer,
  ActivityManager/lowmemorykiller lines for the last known PID); PID is tracked and a PID change during retries fails as "process restarted".
- `.github/workflows/native-gates.yml` — emulator image `target: default` (AOSP, no Pixel Launcher/GMS) instead of `google_apis`.
- `docs/M1_CI_RUNBOOK.md` (this note). Next fully green run → the phone may proceed (its APK will differ only by this CI change; re-verify the card).

### Run 34131512062 (tip `c844390`) — **5/5 green** (smoke: AOSP image, header on attempt 1, pid stable). Phone proof reached the verifier → same-version rollback bug — correction pass 8
Phone (`f1fd234` APK, VPN consent granted): `valid=ROLLBACK`, `tampered=PAYLOAD_HASH_MISMATCH`, `unknownKey=UNKNOWN_KEY`; `startProtection()` correctly
SKIPPED, no block claimed (fail-safe held). Root cause: `RuleBundleVerifier` rejected `bundleVersion <= highestAccepted`, and the SharedPreferences store
had already recorded 25 from the first successful verification, so the identical authentic v25 could never be re-verified after restart/update/re-fetch.
Secure fix (Kotlin + Swift + Python in parity; TS contracts updated):
- Store now persists the **signed-envelope identity** with the version (`AcceptedBundle(bundleVersion, envelopeHash)`, `envelopeHash` =
  SHA-256 of the JCS canonical unsigned envelope = everything the Ed25519 signature covers, computed only after the signature verified).
- Semantics: `version < highest` → `ROLLBACK`; `version > highest` → accept, record replaces; `version == highest` and same identity → **accept
  idempotently**; `version == highest` and different authenticated identity → new reason **`VERSION_CONFLICT`** (never silently replaced, never
  mislabelled as rollback). Rejected bundles never touch the store. Legacy version-only records (the proof phone's state: key `<rulesetId>` = 25,
  no identity) accept the same version once and pin its identity in place — so the corrected APK is installed **over** the existing install,
  without clearing data, and the regression is exercised by the phone itself.
- Tests: Kotlin `RuleBundleVerifierTest` (+4: idempotent across "restart", conflict, legacy pin, rejected-never-advances) and
  `BundleVersionStoreTest` (+1: monotonic merge); Swift `RuleBundleVerifierParityTests` (+4 mirrors); Python `test_rollback_protection.py` (+3) and
  `test_frozen_bundle_public_verification.py` (v25 re-accepted with highest=25; conflict with foreign identity; 26 → ROLLBACK). Local: pytest 89 passed,
  node 14/14; Kotlin/Swift compile + tests run in CI (`android`, `ios` jobs).
- Untouched: frozen bundle v25, signing keys, controlled endpoint/IP, VPN /32 enforcement, THREAT_BLOCKED semantics, verification order.

### Run 34172332521 (tip `1349a91`) — 5/5 green; phone provenance PASS (`4b85776a…5c2d` = apk-provenance.json); **Run proof → app stopped** — correction pass 9
Evidence: after the crash the app came back showing `FAILED — VPN runtime not configured (config/reporter missing)`. That text is produced only by
`GuardDogVpnService.startProtection()` in a **fresh process** (in-memory `GuardDogVpnRuntime` empty): Android re-delivers a foreground-service start
when the process dies inside `onStartCommand`, so the service restarted with a `null` intent and failed closed. The crash therefore happened in the
service start path, whose only main-thread network call is `ControlledEndpointResolver.verifyBinding()` → `InetAddress.getAllByName` →
`NetworkOnMainThreadException`. It never surfaced before: earlier installs SKIPPED at verification (rollback bug), unit tests inject fake resolvers,
and the emulator smoke never starts protection. This means the verifier fix worked on the phone (the flow got past verification to the service).
- `guarddog-vpn/OffThreadBindingCheck.kt` (new) — runs the DNS/IP binding re-check on a dedicated thread, converts resolver exceptions into
  `ResolutionFailed` (fail closed), and asserts it is not on the caller thread. `GuardDogVpnService` uses it and applies the outcome back on the main
  thread via `Handler(Looper.getMainLooper())`, aborting if the lifecycle left `Starting` meanwhile. `null`-intent restarts now fail closed explicitly.
- `OffThreadBindingCheckTest` (+3): resolver runs off the caller thread and delivers `Match`; mismatch + throwing resolver → `Mismatch`/`ResolutionFailed`
  (no crash); same-thread executor (the defect shape) is refused.
- Untouched: route spec, TUN reader, drop/THREAT_BLOCKED path, verifier, bundle v25, endpoint/IP. Phone: install over, do not clear data, Run proof.

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
- `android-startup-smoke.txt`: `PASS harness mounted after Ns`, `PASS marker gitSha == expected build commit`, `PASS GuardDogSecurity native module reachable from JS`,
  `PASS process alive`, `PASS MainActivity is the resumed activity`, `PASS harness header visible in UI hierarchy`, `== ANDROID START-UP SMOKE PASSED ==`
- `android-dev-build.txt`: `distribution: bundle v25 keyId=gd-m1-test-ed25519-001 … frozen=25` and `app consumes: signed frozen bundle + pinned PUBLIC key only`
- `merged-manifest-audit.txt`: `MERGED MANIFEST AUDIT: PASS`
- `apk-recheck.txt`: `== APK RECHECK PASSED ==`, `native-code exactly ['arm64-v8a']`, `application-debuggable`, sdk 26/36, no leakage,
  `PASS embedded JS bundle assets/index.android.bundle`, `PASS build commit <run sha>… inlined in the JS bundle`, `PASS CI run id <run id> inlined in the JS bundle`
- `apk-provenance.json`: `apkSha256` is a 64-hex digest; `commit` = pushed commit; `workflowRunId` = the run you triggered
- After clearance: sideload **that** APK; the device proof report must show `provenance.apkSha256` identical to `apk-provenance.json`.
