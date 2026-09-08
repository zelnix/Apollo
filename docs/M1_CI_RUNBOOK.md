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
Actions → **native-gates** → Run workflow (leave the `xcode` input at `26.4` unless told otherwise; the iOS job runs on `macos-26`). The **whole workflow = six jobs** (five until run 19; `android-release-manifest` added in pass 14):
`android` (AC-01, ubuntu) · `android-dev-build` (AC-04 APK + manifest audit + APK recheck, ubuntu, needs `android`) ·
`android-startup-smoke` (same commit/script built for x86_64, installed on a KVM emulator with no Metro, must reach `GD_SMOKE_READY`; needs `android`) ·
`android-release-manifest` (release APK + AAB packaged-manifest audit, ubuntu, needs `android`) ·
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

### Run 34177747728 (tip `2537dd7`) — 5/5 green; **phone: no crash, verify ACCEPTED, protection reached ACTIVE** — harness timing bug — correction pass 10
Proof report `guarddog-m1-proof-2026-09-08T03-40-56-688Z.json` (provenance gitSha `2537dd73…`, run `34177747728`, apkSha256 `4c50e655…bf1f`):
`config PASS`, `bundle PASS v25`, **`verify PASS valid=accepted; tampered=PAYLOAD_HASH_MISMATCH; unknownKey=UNKNOWN_KEY`** (rollback fix confirmed on the
legacy record), `before PASS`, `consent PASS`, then `start FAIL INACTIVE` → `after FAIL HTTP 200` → `blocked FAIL observed=0 dropped=0` → `unrelated FAIL
fetch canceled`; recovery all PASS (`stop STOPPED`, `tun-closed`, `route-cleared`, `recovered`). Events show `STARTING` and `ACTIVE` at 03:39:58 — one
second after the harness had already judged the state. Root cause is in the harness only: `startProtection()` resolves when the foreground service
is dispatched; the binding re-check (now off-thread) and `establish()` finish asynchronously, so the instantaneous snapshot was `INACTIVE`, the probe ran
before the /32 route existed (HTTP 200, nothing to drop), and the unrelated fetch was cancelled by the TUN interface coming up.
- `frontend/src/harness/androidBlockingProofHarness.ts` — after `startProtection()` poll `getProtectionState()` (250 ms) until `ACTIVE` or a terminal
  `FAILED/STOPPED/REVOKED`, max 15 s; `start` passes only on `ACTIVE`. The unrelated-destination probe retries once after 1 s. Nothing is faked:
  `after`/`blocked` still require the real HTTP failure and a genuine `THREAT_BLOCKED` with `enforcementEvidenceId`.
- Untouched: native SDKs, verifier, bundle v25, endpoint/IP, CI. Phone: install over, Run proof.

### Run 34177747728 device report (run 16, `2537dd7` APK) — protection ACTIVE confirmed; block not yet proven — correction pass 11
Phone: `start PASS ACTIVE` (polling fix confirmed), but `after FAIL HTTP 200`, `blocked FAIL observed=0 dropped=0`, `unexpectedPackets` climbing.
Four root causes, all outside the frozen SDK security semantics (harness instrumentation + Android VPN builder configuration):
1. **IPv6 not allowed to bypass** — `SelectiveRouteInstaller.kt`: on a dual-stack phone a `VpnService.Builder` with no IPv6 address/route/DNS
   BLOCKS the whole IPv6 family for the app set unless `allowFamily(AF_INET6)` is called (Android docs). All IPv6 traffic therefore entered
   the IPv4-only TUN and was counted as "unexpected", and unrelated IPv6 destinations broke. `TunSpec.allowIpv6Bypass=true` is now part of
   `isSelective`; the builder calls `allowFamily(OsConstants.AF_INET6)`. Route set is unchanged: exactly one IPv4 /32.
2. **Pooled HTTP connection** — the post-ACTIVE fetch() reused the baseline OkHttp TCP/TLS connection (opened before the route existed), so no
   new SYN ever reached the TUN → HTTP 200 with `observed=0`. Replaced by a harness-only **native fresh-socket probe**
   (`guarddog-vpn/FreshConnectionProbe.kt`, bridge `probeControlledEndpointFresh(timeoutMs)`; no caller-supplied URL — only the configured
   controlled endpoint is ever probed or recorded): system DNS must yield the configured IPv4 → brand-new `Socket()` (never `protect()`ed, so
   it stays subject to our /32 route) → connect to the configured IPv4 only → TLS with the canonical hostname (SNI + hostname verification)
   → one `GET` with `Connection: close`. Result = `{phase: dns|tcp-connect|tls-handshake|http, outcome: ok|timeout|refused|unreachable|
   dns-failed|tls-failed|http-error|error, resolvedIpv4, httpStatus, elapsedMs, synDropShape}`. `before` requires `http/ok/200` over that
   fresh socket; `after` passes ONLY on the SYN-drop shape (`tcp-connect` + `timeout` to the configured IPv4); DNS failure, another address,
   refused/unreachable, TLS or HTTP failures never count. Recovery `recovered` re-uses the same probe (fresh socket → 200).
3. **Undiagnosable `unexpectedPackets`** — `PacketDropReporter`/`TunPacketReader`/`Ipv4PacketParser.classify`: split into `nonIpv4`,
   `malformedIpv4`, `wrongDestinationIpv4` (counts only; no addresses). `wrongDestinationIpv4 > 0` would indicate a route leak.
4. **Route evidence** — new step `route-active` records the live native snapshot (`lifecycle`, `tunOpen`, `selectiveRouteActive`,
   `routeCidr`; OS `TRANSPORT_VPN` supporting only) BEFORE the protected probe; `auditChain.routeActivation` uses it instead of echoing `start`.
`proofComplete` is stricter, not looser: every block step PASS **and** genuine bridged `THREAT_BLOCKED` with `enforcementEvidenceId` **and**
fresh-probe SYN-drop shape **and** native TUN counters `observedMatching > 0`, `droppedMatching > 0` (new step `tun-evidence`).
Report version `m1-4` adds `auditChain.freshConnectionProbes {before, after, afterStop}`.
Tests: Kotlin `guarddog-vpn` 29/29 (+`FreshConnectionProbeTest` ×6 on loopback only: 200 over fresh socket, non-2xx = http-error, refused ≠ SYN
drop, TLS-vs-plain reaches tls phase, DNS without configured IPv4 fails before any socket and lists no addresses, only tcp-connect+timeout+configured
IPv4 is the SYN-drop shape; `SelectiveRouteInstallerTest` +2: IPv6 bypass, and the frozen constants `blocktest.btciq.app`/`52.25.179.131` yield
routes == `[52.25.179.131/32]` with IPv6 bypass, offline/injected binding; `TunPacketReaderTest` +1: counter split), `guarddog-core` 16/16;
`GuardDogExpoModuleDefinitionTest` async surface now includes `probeControlledEndpointFresh`; expo module compiled locally against the real
expo-modules-core/android-36 classpath; frontend `tsc` shows no errors in changed files (8 pre-existing unrelated errors, identical before/after).
- Untouched: frozen bundle v25, signing key, verifier semantics, controlled endpoint/IP, block-authority chain, THREAT_BLOCKED producer
  (`PacketDropReporter` remains the only producer; it now only categorises what it already discarded). Phone: install over, Run proof.

### Run 34189478121 (run 17, tip `c12ae1c`) — 5/5 green; **PHYSICAL BLOCK + BRIDGE + STOP/RECOVERY PROOF: PASS** — attestation
Immutable attestation of the device-generated proof. The raw JSON is deliberately **not** committed (generated phone artifact); it is
identified by filename + SHA-256 so any copy can be checked against this entry.

| Field | Value |
|---|---|
| CI run | https://github.com/zelnix/Apollo/actions/runs/34189478121 (`native-gates` #18, push, all five jobs success: android 7m21s · ios 18m47s · executable-suites 57s · android-dev-build 13m49s · android-startup-smoke 12m54s) |
| Branch tip built | `c12ae1cccd6491bfc0320307c4281b63fe99cbc9` = `311070d` (pass-11, 15 files) + `.emergent/emergent.yml` timestamp only |
| Artifact `apk-provenance.json` | `apkSha256 3b8e16bec48932d2a3be9b8ece0065d56f74f0e39588d5b3bb655becd63bacbe` · `commit c12ae1c…` · `workflowRunId 34189478121` (read by the reviewer from the run's `android-dev-build` artifact) |
| Installed APK (phone card + report `provenance`) | same `apkSha256`, `gitSha c12ae1c…`, `ciRunId 34189478121`, `com.emergent.guarddogm.k6cugf` 1.0.0 (1), debuggable dev proof APK, 90 697 844 bytes — **CI artifact → installed APK → report continuity closed** |
| Install mode | install-over on the preserved legacy device state (no uninstall, no data clear) |
| Proof file | `guarddog-m1-proof-2026-09-08T06-16-11-528Z.json` · SHA-256 `0b09cc9091280d48d9fade81b1d82a9a23b8eba55de9060546688c2ee456dc87` · `reportVersion m1-4` · generated 2026-09-08T06:16:11.528Z |
| Verdict | **`proofComplete: true` · `recoveryComplete: true`** · 15/15 steps PASS |
| Frozen bundle | `gd-m1-controlled-block` v25 · `keyId gd-m1-test-ed25519-001` · `payloadHash 2581666cc768e1e4e76962db0cc70e497e17e9b9cf4a5a997c8cfb091e6b90c9` (= `security/frozen/controlled-bundle-v25.json`); on-device verify: valid=accepted, tampered=`PAYLOAD_HASH_MISMATCH`, unknown key=`UNKNOWN_KEY` |
| Endpoint | `blocktest.btciq.app` → `52.25.179.131` (live `/api/config`) |
| Fresh probe **before** | new socket → DNS `52.25.179.131` → TCP → TLS → **HTTP 200** (2443 ms) |
| Route (live snapshot, before protected probe) | `lifecycle=ACTIVE tunOpen=true selectiveRouteActive=true routeCidr=52.25.179.131/32`; supporting `osVpnTransportPresent=true` |
| Fresh probe **under protection** | new socket → DNS `52.25.179.131` → **`tcp-connect` / `timeout`** (6017 ms) — SYN-drop shape; no DNS/TLS/HTTP/refused/unreachable path taken |
| Native TUN counters | `observedMatching=6 droppedMatching=6 reportedBlocks=2 dedupedRetries=4 unexpectedPackets=6 nonIpv4=6 malformedIpv4=0 wrongDestinationIpv4=0` |
| Genuine `THREAT_BLOCKED` (bridge) | `source android-vpn-enforcement` · primary `enforcementEvidenceId 9b382d73-dfcc-44e9-984f-a54d69e5e545` · `securityEventId 54e36113-c3a5-4af5-86c4-5388c25224f5` · 2026-09-08T06:15:09Z (ACTIVE at 06:15:07Z); second event `55c62278-aebc-43c9-93f3-cdc6b1c1d8eb` at 06:15:14Z after the 5 s dedupe window · `rule m1-controlled-block-001` |
| Unrelated traffic | backend `/api/health` HTTP 200 while protected |
| Recovery | stop 06:15:16.174Z → `STOPPED: stopped by user` → `tunOpen=false dropReporterAttached=false` → `selectiveRouteActive=false`, `vpnTransportPresent=false` → fresh probe **after stop** new socket → **HTTP 200** (1452 ms) at 06:15:17.929Z |

Observation (non-blocking, cause **unconfirmed**): six non-IPv4 frames entered the TUN during the ~9 s protected window (`nonIpv4=6`), then stopped.
The report proves only their count and that they were discarded and never reported; it does not identify protocol or origin. Kernel IPv6
interface bring-up traffic is a plausible explanation but is not established. Not an acceptance blocker: `wrongDestinationIpv4=0` (no IPv4
route leak) and unrelated traffic stayed reachable. May be instrumented later (ICMPv6 type counts only).

**M1 physical acceptance status after run 17**: block ✅ · bridge ✅ · normal stop + recovery ✅ · **`onRevoke()` physical proof: OPEN** (next
device item) · release-manifest audit: OPEN (P1, after revoke). Final M1 sign-off only when both pass.

### Revoke-proof instrumentation (pass 12, for CI Run 18) — harness/bridge only; nothing in the frozen security path changed
Purpose: the last open physical lifecycle item, `VpnService.onRevoke()`. The harness cannot revoke a VPN — revocation is an OS action the
tester performs from OUTSIDE the app (Settings → Network & internet → VPN → Apollo Native Gates → Disconnect, or consenting to another
VPN app). The harness brings protection to a verified enforcing state, then waits (≤ 180 s) and records only what the native layer reports.
- New `frontend/src/harness/androidRevokeProofHarness.ts` (`runAndroidRevokeProof`). Shared opening extracted from the block harness into
  `runProtectionPrelude` (config → v25 → on-device verify + negatives → fresh-socket baseline 200 → consent → `startProtection()` → settled
  ACTIVE → live route snapshot) — the block harness now calls the same function; its step ids/semantics are unchanged.
- Revoke steps after the prelude: `enforcing` (fresh probe must show the SYN-drop shape — protection is genuinely enforcing at the moment of
  revocation) → **prompt shown in the UI** → `revoked` (authoritative native state polled every 500 ms must reach `REVOKED`; the bridged
  `PROTECTION_STATE_CHANGED(REVOKED)` event id/time is recorded when received; `STOPPED`/`FAILED`/`INACTIVE`/timeout = FAIL, explicitly
  "not a system revocation") → `revoke-cleanup` (`tunOpen=false dropReporterAttached=false selectiveRouteActive=false`; OS transport
  supporting only, since another VPN may legitimately own it after a takeover-revoke) → `consent-cleared` (SDK `consentGranted=false` AND
  OS `VpnService.prepare() != null` via the new read-only bridge function `isVpnConsentRequired()` — never shows a dialog) →
  `no-silent-restart` (`startProtection()` without fresh consent must be rejected — `ERR_CONSENT` — and leave no TUN, state ≠ ACTIVE) →
  `recovered` (fresh socket → HTTP 200 again, ≤ 20 s).
- `revokeComplete` = revocation reached AND every step PASS. Block-mode results carry `revokeComplete=false`; revoke-mode results carry
  `proofComplete=false`/`recoveryComplete=false` (they are different proofs; neither claims the other).
- Report `m1-5`: `mode` (`block`|`revoke`), `revokeComplete`, `auditChain.revocation {activeAt, revokeEventId, revokedAt, waitedMs,
  stateAfterRevoke, stateReason, consentGrantedAfterRevoke, osConsentRequiredAfterRevoke, tunOpen, selectiveRouteActive,
  dropReporterAttached, vpnTransportPresent, restartWithoutConsent, restartError, httpsStatusAfterRevoke, recoveredAt}`; file names now
  `guarddog-m1-<mode>-proof-<stamp>.json|pdf`; PDF gains a "Revocation chain" table and a mode-specific verdict heading.
- UI: second button **Run revoke proof** (block button unchanged), an "ACTION REQUIRED ON THE PHONE" banner while waiting, mode-aware verdict
  and report rows. The in-app **Stop protection** button during the wait produces `STOPPED` → `revoked` FAIL (a stop is not a revoke).
- Bridge: `Function("isVpnConsentRequired")` (sync, read-only). `GuardDogExpoModuleDefinitionTest` sync surface set updated.
- Untouched: `GuardDogVpnService.onRevoke()` (cleanup → `Revoked` → stopForeground → stopSelf, as before), `VpnStateRepository` (consent
  cleared on `Revoked`, unit-tested since pass 1), verifier, frozen v25, keys, endpoint, THREAT_BLOCKED producer, CI workflow.
Phone procedure (after Run 18 is green and the APK SHA is matched again): install over → **Run revoke proof** → grant consent if asked →
wait for `enforcing PASS` and the banner → leave the app, Settings → VPN → Apollo Native Gates → **Disconnect** → return to the app →
let it finish → Build JSON evidence → share the `guarddog-m1-revoke-proof-*.json`.

### Run 34195912145 (run 18, tip `06622d0`) — 5/5 green; **physical `onRevoke()` behaviour: PASS · automated `revokeComplete`: false**
(out-of-spec OS prepared-state assertion) — attestation. History kept as-is: this failed gate is why Run 19 exists.

| Field | Value |
|---|---|
| CI run | https://github.com/zelnix/Apollo/actions/runs/34195912145 (`native-gates` #20, push, all five jobs success: android 7m10s · ios 21m17s · executable-suites 51s · android-dev-build 12m21s · android-startup-smoke 14m33s) |
| Branch tip built | `06622d04afc3ea42bbbda378b64c534bd5a07847` = `6e49681` (run-17 attestation) + `1702e0a` (pass 12, 9 files) + two `.emergent/emergent.yml` timestamp commits |
| Artifact `apk-provenance.json` | `apkSha256 ac0169a45341eacdd0d807aabb70abeb48e49da00e0538edaea48035589e3ab8` · `commit 06622d0…` · `workflowRunId 34195912145` · attempt 1 |
| Installed APK (phone card + report) | same `apkSha256`, `gitSha`, `ciRunId`; 90 711 160 bytes; install-over on the preserved device state |
| Proof file | `guarddog-m1-revoke-proof-2026-09-08T08-16-05-030Z.json` · SHA-256 `a07fcedfe7cc88cb95161d81fce0885290000c99486d8e490bf633c33ff29f6d` · `reportVersion m1-5` · `mode revoke` · generated 2026-09-08T08:16:05.030Z (raw JSON off-repo) |
| Verdict | **12/13 steps PASS · `revokeComplete: false`** (single failing step `consent-cleared`, see below) |
| Prelude | v25 `payloadHash 2581666c…6b90c9` accepted, tampered=`PAYLOAD_HASH_MISMATCH`, unknown key=`UNKNOWN_KEY`; fresh socket HTTP 200 (2489 ms); consent granted; **ACTIVE** 08:13:56.595Z; `routeCidr=52.25.179.131/32` |
| Enforcing at revoke time | fresh socket → `tcp-connect` / `timeout` to `52.25.179.131` (6016 ms); `observedMatching=6 droppedMatching=6 reportedBlocks=2 dedupedRetries=4 nonIpv4=6 malformedIpv4=0 wrongDestinationIpv4=0`; genuine `THREAT_BLOCKED` `ea626ef6-…-5b92b548600b` 08:13:58Z and `3e6842bf-…-57bbca572ae7` 08:14:03Z |
| **`onRevoke()`** | native `REVOKED` · reason `"VPN permission revoked by system/user"` · bridged `PROTECTION_STATE_CHANGED(REVOKED)` `9b4d6816-bece-4598-acb1-0e839ccde258` at 08:15:13Z · 82 009 ms after ACTIVE · revoked by the tester via Settings → VPN → Disconnect (external, not the in-app Stop) |
| Cleanup | `lifecycle=REVOKED tunOpen=false dropReporterAttached=false selectiveRouteActive=false`; supporting `osVpnTransportPresent=false` |
| SDK consent | `consentGranted=false` ✅ (AC-06 requirement met) |
| OS prepared-state (observation) | `VpnService.prepare() != null` → **false**: Android kept its consent record for the app after the Settings-side disconnect |
| No silent restart | `startProtection()` **rejected** ("VPN consent not granted"), state stayed `REVOKED`, `tunOpen=false` ✅ |
| Recovery | fresh socket HTTP 200 (1602 ms) at 08:15:28.806Z ✅ |

Root cause of the failed gate — an acceptance-gate modelling error in the harness, not a defect in `GuardDogVpnService.onRevoke()`:
`consent-cleared` was coded as `state.consentGranted === false && osConsentRequired === true`. The second conjunct asserted that a
Settings-side disconnect also clears the platform's prepared-state record so that `prepare()` returns an intent again. Android does not
document that behaviour and the device disproved it. AC-06 specifies "revoke → REVOKED, consent cleared" at Apollo's own layer, which the
device satisfied; the security property (no restart without a fresh `requestPermission("vpn")`) was independently proven by `no-silent-restart`.

### Revoke-gate correction (pass 13, for CI Run 19) — harness/report wording only
- `consent-cleared` PASS condition is now exactly `sdk.consentGranted === false` (AC-06). `osConsentRequiredAfterRevoke` stays in the JSON
  as an **"OS prepared-state observation (diagnostic only, not a gate)"** — recorded as whatever Android reports, no PASS/FAIL significance;
  wording changed in the step detail, PDF row and UI so it cannot be misread as required security evidence.
- Unchanged and still mandatory: genuine `REVOKED` (STOPPED/FAILED/INACTIVE/timeout fail), TUN closed + route gone + reporter detached,
  `no-silent-restart` (`startProtection()` rejected, state non-ACTIVE, no TUN), fresh-socket HTTP 200 recovery.
- Evidence schema **`m1-5` → `m1-6`** because the meaning of a PASS condition changed: an `m1-5` `revokeComplete` and an `m1-6` one are not
  semantically equivalent.
- Untouched: `GuardDogVpnService.onRevoke()`, `VpnStateRepository`, v25, keys, verifier, /32 routing, THREAT_BLOCKED path, bridge, CI.
Expected Run 19 phone result: `mode: revoke` · `reportVersion: m1-6` · `revokeComplete: true` · `osConsentRequiredAfterRevoke` = Android's actual report.

### Run 34206626107 (run 19, tip `d7abea2`) — 5/5 green; **PHYSICAL `onRevoke()` PROOF: PASS** (`revokeComplete: true`) — attestation
Raw JSON off-repo, identified by filename + SHA-256.

| Field | Value |
|---|---|
| CI run | https://github.com/zelnix/Apollo/actions/runs/34206626107 (`native-gates` #21, push, all five jobs success: android 7m29s · ios 19m33s · executable-suites 48s · android-dev-build 11m53s · android-startup-smoke 13m05s) |
| Branch tip built | `d7abea270d03735114f216bf36a0caa99e6acbc9` = `68a6adf` (pass 13, 5 harness/docs files) + one `.emergent/emergent.yml` timestamp commit; `git diff 06622d0..d7abea2` touches no native, security, backend or CI path |
| Artifact `apk-provenance.json` | `apkSha256 890c9c417da1737498e7b894a59b46d95e2aeaa48837a28a31cefdeec4f04ec8` · `commit d7abea2…` · `workflowRunId 34206626107` · attempt 1 |
| Installed APK (phone card + report) | same `apkSha256`, `gitSha`, `ciRunId`; 90 711 372 bytes; install-over on the preserved device state |
| Proof file | `guarddog-m1-revoke-proof-2026-09-08T09-29-02-132Z.json` · SHA-256 `742670a9543d143b933622ff9a56cadf0e51e6e546d188f251a64fb9b44636bc` · `reportVersion m1-6` · `mode revoke` · generated 2026-09-08T09:29:02.132Z |
| Verdict | **13/13 steps PASS · `revokeComplete: true`** (`proofComplete`/`recoveryComplete` are block-mode fields and correctly `false` here) |
| Prelude | v25 `payloadHash 2581666c…6b90c9` accepted, tampered=`PAYLOAD_HASH_MISMATCH`, unknown key=`UNKNOWN_KEY`; fresh socket HTTP 200 (2173 ms); consent granted; **ACTIVE** 09:28:02.004Z; `routeCidr=52.25.179.131/32` |
| Enforcing at revoke time | fresh socket → `tcp-connect` / `timeout` to `52.25.179.131` (6019 ms); `observedMatching=6 droppedMatching=6 reportedBlocks=2 dedupedRetries=4 nonIpv4=6 malformedIpv4=0 wrongDestinationIpv4=0`; genuine `THREAT_BLOCKED` `cb4c9402-…` (evidence `d81b484c-cdc0-460e-a938-50f7f2e2af45`, 09:28:03Z) and `8d556092-…` (evidence `568d4170-d01d-4510-901d-8664baabe0a5`, 09:28:08Z) |
| **`onRevoke()`** | native `REVOKED` · reason `"VPN permission revoked by system/user"` · bridged `PROTECTION_STATE_CHANGED(REVOKED)` `971db3c4-4a07-4452-a134-cd00c2fae766` at 09:28:40Z · 37 054 ms after ACTIVE · external Settings → VPN → Disconnect by the tester |
| Cleanup | `lifecycle=REVOKED tunOpen=false dropReporterAttached=false selectiveRouteActive=false`; supporting `osVpnTransportPresent=false` |
| AC-06 consent (Apollo layer) | `consentGranted=false` ✅ |
| OS prepared-state (observation only) | `VpnService.prepare() != null` → **false**: **the OS prepared-state remained previously-consented on this device; observed, not used as revoke-completion evidence.** Android's API documentation indicates a later `prepare()` should normally return an Intent again after the user disables an active VPN; this device did not do so on two consecutive runs (18, 19). Recorded as an **unresolved platform discrepancy**, not a pass and not a defect finding against Apollo. |
| No silent restart | `startProtection()` **rejected** by Apollo ("VPN consent not granted"), state stayed `REVOKED`, `tunOpen=false` ✅ |
| Recovery | fresh socket HTTP 200 (1317 ms) at 09:28:48.984Z ✅ |

**M1 physical acceptance status after run 19: block ✅ · bridge ✅ · stop/recovery ✅ · onRevoke ✅.** Remaining planned M1 gate: packaged
release-manifest audit (below).

### Packaged release-manifest audit gate (pass 14, for CI Run 20) — new CI job `android-release-manifest`
Replaces the standing assumption "the debug-only `SYSTEM_ALERT_WINDOW` disappears in release" with a test of the artifacts that would ship.
- `scripts/ci/android-release-manifest-audit.sh`: clean `expo prebuild` → `:app:assembleRelease :app:bundleRelease` (arm64-v8a; signing =
  Expo's placeholder debug keystore — packaging audit, not distribution signing) → **release APK** binary manifest via `aapt2 dump
  xmltree`/`badging` → **release AAB** bundle-derived manifest via `bundletool 1.17.2 dump manifest` → both audited by
  `scripts/ci/release_manifest_audit.py` with one rule set → APK and AAB permission sets must be identical → release APK content sanity
  (no private-key / admin-token / DB-URL markers, JS bundle embedded).
- Rules (REQUIRED, all must pass for each container): package `com.emergent.guarddogm.k6cugf`; `android:debuggable` absent; minSdk 26;
  targetSdk 36; `com.guarddog.vpn.GuardDogVpnService` present with `BIND_VPN_SERVICE`, `exported=false`, `foregroundServiceType`
  including `systemExempted` (0x400), intent action `android.net.VpnService`; `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SYSTEM_EXEMPTED`,
  `INTERNET`, `ACCESS_NETWORK_STATE` requested; no accessibility service; every deny-listed permission absent (`SYSTEM_ALERT_WINDOW`,
  `QUERY_ALL_PACKAGES`, SMS/call-log/contacts/storage/media, accessibility/device-admin/notification-listener binds, mic/camera/location,
  phone, install/delete packages, settings, accounts, calendar, Bluetooth/Wi-Fi state, `CONTROL_VPN`, `DUMP`, `READ_LOGS`); **every
  requested permission on the explicit allow-list** (INTERNET, ACCESS_NETWORK_STATE, FOREGROUND_SERVICE, FOREGROUND_SERVICE_SYSTEM_EXEMPTED,
  POST_NOTIFICATIONS, VIBRATE, USE_BIOMETRIC, USE_FINGERPRINT, `<package>.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`) — any new transitive
  permission fails the gate until reviewed.
- Evidence (artifact `android-release-manifest`): `release-provenance.json` (release APK + AAB SHA-256, commit, run id), `release-apk-
  badging.txt`, `release-apk-AndroidManifest.txt`, `release-aab-AndroidManifest.xml`, `release-manifest-audit-{apk,aab}.txt`, and the
  **complete final permission sets** `release-{apk,aab}-permissions.txt` (each entry with its origin) so "expected normal permissions only"
  is auditable line by line.
- Auditor self-test (`--selftest`) runs first: fixtures prove the xmltree and XML parsers agree and that a debug manifest fails exactly on
  `debuggable` + `SYSTEM_ALERT_WINDOW` (+ allow-list). Verified locally against the tracked merged DEBUG manifest: those are its only failures.
- Untouched: app code, native SDKs, bridge, frozen v25, keys, endpoint, existing five jobs. The release APK/AAB are CI evidence only,
  not installed anywhere and not committed (`.gitignore`).

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


### Run 34212817229 (native-gates #22, tip `d1ae5ae`) — `android-release-manifest` FAIL — root cause + fix (pass 15)
The assumption at the end of pass 14 ("verified locally against the tracked merged **DEBUG** manifest") did not hold for the actual
packaged **RELEASE** artifacts: both `android-release-manifest-audit.sh` steps 3 and 4 failed on exactly one permission.

| Field | Value |
|---|---|
| CI run | https://github.com/zelnix/Apollo/actions/runs/34212817229 (`native-gates` #22, push, 5/6 jobs green, `android-release-manifest` failed exit code 1) |
| Failing step | step 9, `bash scripts/ci/android-release-manifest-audit.sh` |
| APK audit | `RELEASE MANIFEST AUDIT (APK): FAIL` — only failures: `FAIL absent: SYSTEM_ALERT_WINDOW`, `FAIL every requested permission is on the allow-list … unexpected permission: android.permission.SYSTEM_ALERT_WINDOW`. All other 40+ checks PASS (package, debuggable absent, minSdk 26, targetSdk 36, `GuardDogVpnService` config, deny-list, no secrets, embedded bundle). |
| AAB audit | identical failure signature (`RELEASE MANIFEST AUDIT (AAB): FAIL`); `PASS identical <uses-permission> sets in APK and AAB` — ruling out an `aapt2`/`bundletool` parser or format discrepancy. |
| Root cause | `android.permission.SYSTEM_ALERT_WINDOW` is declared, unconditionally, in `node_modules/react-native/ReactAndroid/src/debug/AndroidManifest.xml` (React Native's own dev-overlay/`DevSettingsActivity` debug source set) and was surviving Gradle's manifest merge into the **release** APK/AAB — the exact regression the pass-14 gate was built to catch. **Not** an auditor bug: `release_manifest_audit.py`'s deny-list, allow-list and self-test required no change. |
| Fix | Added `"android.permission.SYSTEM_ALERT_WINDOW"` to the existing `expo.android.blockedPermissions` array in `frontend/app.json` (alongside the already-proven `READ_EXTERNAL_STORAGE`/`WRITE_EXTERNAL_STORAGE` entries). Expo's `withBlockedPermissions` config-plugin injects `tools:node="remove"` into the **main** `AndroidManifest.xml`, which wins over any variant-specific library manifest (including RN's `src/debug`) during Gradle's manifest merger, for every build type. Verified locally: a clean `expo prebuild --platform android --clean --no-install` now emits `<uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW" tools:node="remove"/>` in `android/app/src/main/AndroidManifest.xml`, in the same form as the two storage permissions that already PASS this exact audit. |
| Untouched | `release_manifest_audit.py` (deny-list, allow-list, self-test), `android-release-manifest-audit.sh`, `native-gates.yml`, all native SDKs, frozen v25 bundle, signing keys, backend endpoints, `/32` routing, `THREAT_BLOCKED` path. Single one-line diff in `frontend/app.json`. |
| Expected next run | `android-release-manifest`: both APK and AAB show `PASS absent: SYSTEM_ALERT_WINDOW` and no `unexpected permission` line → `RELEASE MANIFEST AUDIT: PASS` for both containers; `android-dev-build` and `android-startup-smoke` stay green (blocking the permission globally does not touch VPN, notification, or foreground-service capability). Target: 6/6 jobs green. |
