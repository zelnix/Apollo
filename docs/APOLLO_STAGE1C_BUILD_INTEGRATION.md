# Stage 1C — Production Build Integration (Report)

**Current status (recorded 2026-09-20): Stage 1C structural integration is COMPLETE.
Emergent Support reports successful deploys/Android builds and an emulator launch to Home
after fixing duplicate SVG view registration. The exact crash, dependency chain and fix commit
are recorded in §13. Stage 1C.1 physical-device launch acceptance is still PENDING on the
user's Pixel 10 with a newly built APK; Stage 1D remains NOT STARTED.**

Sections 1–11c retain historical build-stage observations and tooling limitations. Their
earlier blocked statuses are not the current status. In particular, the duplicate SVG warning
previously treated as non-blocking was later established as the launch-crash cause (§13).

## 1. Config plugin(s) added/changed

- **Added:** `frontend/plugins/withGuardDogEngine.js` (new file).
- **Changed:** `frontend/app.json` — registered `"./plugins/withGuardDogEngine"` in the
  `plugins` array, next to `withApolloSiteGuard`/`withApolloCallGuard`.
- **Changed:** `frontend/package.json` — added
  `"expo": { "autolinking": { "searchPaths": ["../packages"] } }`. This is the documented,
  verified-working way to make `expo-modules-autolinking` discover `guarddog-expo-module`
  (which lives outside `frontend/`, unlike `apollo-security` which lives inside
  `frontend/modules/` and is auto-discovered by default). Confirmed empirically before writing
  any plugin code: `npx expo-modules-autolinking resolve --platform android` found
  `guarddog-expo-module` exactly once after this change, with zero effect on `apollo-security`'s
  own discovery (still resolves, also exactly once).

**Not extended:** `withApolloSiteGuard`'s own pattern doesn't transfer directly — that plugin's
whole point is "Android needs nothing here" (because `apollo-security` is auto-merged via its
own manifest). GuardDog needed real wiring (raw Gradle library modules, not an Expo module) so it
got its own plugin, kept separately understandable/auditable per instruction, rather than being
folded into an existing plugin whose comments would then be misleading.

## 2. Exact generated Gradle/settings/manifest changes

Verified via two independent clean `expo prebuild --platform android` runs (outputs identical
between runs — see §6 for reproducibility) — full diff of the affected files:

**`android/settings.gradle`** — appended (nothing else in the file touched):
```gradle
include(':guarddog-core')
project(':guarddog-core').projectDir = new File(rootDir, '../../packages/guarddog-android-sdk/guarddog-core')
include(':guarddog-vpn')
project(':guarddog-vpn').projectDir = new File(rootDir, '../../packages/guarddog-android-sdk/guarddog-vpn')
```
Confirmed each `include(...)` appears **exactly once** (`grep -c` = 1 for both).

**`android/build.gradle`** (root) — two additions inside the existing `buildscript` block:
```gradle
buildscript {
  repositories {
    gradlePluginPortal()   // ADDED — needed to resolve the marker artifact below
    google()
    mavenCentral()
  }
  dependencies {
    classpath 'com.google.gms:google-services:4.4.4'
    classpath 'org.jetbrains.kotlin.plugin.serialization:org.jetbrains.kotlin.plugin.serialization.gradle.plugin:2.1.20'  // ADDED
    ...
  }
}
```
This is the **only** plugin registration needed. `com.android.library` and
`org.jetbrains.kotlin.android` need no addition — React Native 0.86.3's own version catalog
(`node_modules/react-native/gradle/libs.versions.toml`) already pins `agp = 8.12.0` and
`kotlin = 2.1.20`, an **exact match** to what `guarddog-core`/`guarddog-vpn` require — confirmed
by reading that file directly, not assumed.

**`android/app/src/main/AndroidManifest.xml`** — **no manual edit made or needed.**
`guarddog-vpn`'s own `AndroidManifest.xml` (part of the certified, untouched source) already
declares its `VpnService` and required permissions (`INTERNET`, `ACCESS_NETWORK_STATE`,
`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SYSTEM_EXEMPTED`, `POST_NOTIFICATIONS`). Android's own
Gradle manifest merger picks these up automatically once `:guarddog-vpn` is a real dependency —
this is standard AGP behavior, not something a config plugin needs to hand-write. **Caveat:**
the actual manifest *merge* only happens during a real Gradle build (`processDebugManifest`
task) — it could not be observed running in this sandbox (no Gradle). What was verified is that
the source manifest declaring these entries exists, is part of the byte-verified certified
import, and will be picked up by the dependency graph once `:guarddog-vpn` is included (which it
now is).

## 3. Certified GuardDog source — byte-identical, confirmed

Re-ran the Stage 1B SHA-256 manifest check (`sha256sum -c docs/APOLLO_STAGE1B_SHA256_MANIFEST.txt`)
against `packages/` after all Stage 1C work: **zero mismatches, all 91 files still byte-identical**
to the pinned commit `e5d11be912c76775c5a8b27b53218211484ca8bd`. Nothing under `packages/` was
opened for editing at any point in Stage 1C — every change in this stage lives in
`frontend/plugins/`, `frontend/app.json`, and `frontend/package.json` only.

## 4. Build/compile results — honest limitation

**This sandbox has no JDK, no Android SDK, and no Gradle installed** (verified: `java`, `javac`,
`gradle` are all absent; no `ANDROID_HOME`/`ANDROID_SDK_ROOT`). This means:

| Step | Result here |
|---|---|
| Expo/config-plugin generation | ✅ Ran successfully — verified |
| Clean `expo prebuild` (Node-only, no JDK needed) | ✅ Ran successfully, twice — verified |
| Generated Android project contains GuardDog modules exactly once | ✅ Verified (§2) |
| Gradle configuration/build validation | ❌ **Cannot be executed in this sandbox** — no Gradle |
| Kotlin compilation (`guarddog-core`, `guarddog-vpn`, GuardDog Expo bridge) | ❌ **Cannot be executed in this sandbox** — no JDK/Kotlin compiler |

Per the standing native-build constraint: **this cannot be validated here — a real
device/production build via the Emergent build pipeline is required** to actually run Gradle and
prove the wiring compiles. Everything reported as "correct" above (module inclusion, version
alignment, plugin registration) is based on **static, structural, and version-string
verification** — reading the actual pinned version catalogs and build files rather than
guessing — not an executed build. **Do not treat this report as proof of a successful compile.**

## 5. Test results (frontend, existing suites — no regressions)

Per the credit-efficient testing policy, ran a **regression-level** check (this change touches
shared config files `app.json`/`package.json`, so more than a bare unit test was warranted, but
a full `testing_agent` pass wasn't — no JS runtime behavior changed):

| Check | Result |
|---|---|
| `eslint` on `withGuardDogEngine.js` | ✅ No issues |
| `npx expo-doctor` | 16/20 passed; all 4 failures pre-existing (missing `expo-asset` peer dep, duplicate `react-native-svg`, generated-folder CNG notice from this session's own testing, patch-version drift) — **none caused by this change** |
| `yarn test:adapter-contract` | ✅ 7/7 |
| `yarn test:security` | ✅ 8/8 |
| `yarn test:platform` (truth-of-state invariants) | ✅ 11/11 |
| `yarn test:truth` | ✅ 5/5 |
| `yarn test:evidence-sync` | ✅ 4/4 |
| Expo restarted, web preview boots clean, `[SecureCore] SecureCore initialized {"implementation":"mock"}` logged (item 8 — Expo Go/web still correctly does not pretend native VPN enforcement exists) | ✅ confirmed via logs |
| Backend tests | Not run — this change touches zero backend code/contracts |

## 6. Warnings

- `expo-doctor`'s 4 flagged items (§5) are pre-existing and unrelated; not introduced by this
  change. **Later correction:** pre-existing does not mean harmless. The duplicate
  `react-native-svg` finding caused the post-splash runtime crash; see §13.
- The generated `android/` directory created during testing was deleted afterward (not checked
  in) — it's fully reproducible on demand (see §7), and this app has no precedent of committing
  generated native folders.

## 7. Required native permissions/manifest entries

New permissions that will be merged in (from `guarddog-vpn`'s own manifest, not hand-added):
`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_SYSTEM_EXEMPTED`. `INTERNET`, `ACCESS_NETWORK_STATE`,
`POST_NOTIFICATIONS` were already declared in `app.json`'s own permissions list — no conflict,
just confirmation of overlap.

## 8. Expo SDK 57 compatibility

**Clean.** This app is on Expo SDK `57.0.19`/RN `0.86.3`, which pins `agp = 8.12.0` and
`kotlin = 2.1.20` — an exact match to what `guarddog-core`/`guarddog-vpn` require. No version
downgrade or override was needed anywhere.

## 9. Is production Android native generation now reproducible?

**Yes, for the config-generation step.** Ran `expo prebuild --platform android` twice from a
clean state; both runs produced byte-identical `settings.gradle`/`build.gradle` wiring. The
plugin also fails fast (clear error, not a silent broken build) if the Stage 1B staged source
ever goes missing. What is **not yet proven** reproducible is an actual successful Gradle build —
that requires the real build pipeline (§4).

## 10. Decision: Android minSdk raised to 26 (approved 2026-06)

**Approved and implemented.** Apollo Production's Android `minSdk` is raised from 24 to 26
(Android 8.0), done at the Apollo Production / config-plugin level — **not** by altering the
certified GuardDog source to preserve Android 7.x compatibility, and **not** by hand-editing
generated `android/` files.

- **Mechanism:** added `expo-build-properties` (`npx expo install expo-build-properties`,
  version `57.0.20`, matching Expo SDK 57) as a config plugin in `app.json`:
  ```json
  ["expo-build-properties", { "android": { "minSdkVersion": 26 } }]
  ```
  This is the standard, reproducible Expo mechanism for this exact kind of Gradle property
  override — no manual `android/gradle.properties`/`build.gradle` edit.
- **`targetSdk` is unaffected** — this change only raises the floor, not the target; `targetSdk`
  stays at whatever RN 0.86.3's version catalog already pins (36), unchanged by this decision.
- **Verified via clean `expo prebuild --platform android`:** generated `android/gradle.properties`
  now contains `android.minSdkVersion=26` exactly.
- **Product-support consequence, recorded explicitly:** Apollo's minimum supported Android
  version is now **Android 8.0 / API 26**. Devices on Android 7.x/7.1 (API 24–25) can no longer
  install the app. This trade-off was chosen deliberately over the alternative (patching the
  certified engine to tolerate a lower floor), which was explicitly rejected to keep GuardDog
  byte-identical to its certified source.
- **Re-verified after this change:** `:guarddog-core`/`:guarddog-vpn` still each `include()`d
  exactly once, `guarddog-expo-module` still autolinks exactly once (§2's structural checks all
  re-ran clean), all 5 regression suites still pass (§5), `expo-doctor`/`eslint` unchanged (same
  4 pre-existing, unrelated flags), and the Stage 1B SHA-256 manifest re-check still shows **zero
  mismatches** across all 91 certified files.
- **Future runtime test to add (not part of Stage 1C — recorded for the physical-device stage):**
  on Android 8+, `systemExempted` foreground services are permitted for qualifying VPN apps, but
  the OS can throw `ForegroundServiceTypeNotAllowedException` at runtime if the app doesn't
  satisfy the qualifying conditions. A successful manifest merge does **not** prove this — it
  must be proven on a real device during the later runtime/physical-device validation stage, not
  assumed from build-time success.

## 11. Stage 1C.1 — Real Native Build Gate: BLOCKED, cannot be executed from this sandbox

This is the one part of the requested work that could not be performed, and needs to be said
plainly rather than approximated:

**This sandbox has no JDK, no Android SDK, no Gradle, and no tool available to this agent that
triggers Emergent's actual native Android build pipeline.** Everything that does *not* require
executing Gradle/Kotlin has been done and re-verified (structural module inclusion, autolinking
resolution, generated config content, regression tests, source integrity) — see §§1–10. But the
mandatory gate items that require an actual compile — Gradle configuration succeeding, Kotlin
compilation of `guarddog-core`/`guarddog-vpn`/the Expo bridge, manifest *merge* actually running
(not just the source declarations existing), duplicate class/resource/provider/service detection,
and a real APK build — **cannot be produced by this agent in this environment.**

Per this platform's own build model, an actual native Android compile only happens through the
Emergent **Publish** flow (top-right of the app), which generates a real Android build (APK/AAB)
using Emergent's own build infrastructure — this is a user-triggered action, not something
available to an agent session via any tool here. **Stage 1C.1 cannot be closed without that
step.**

**What I did instead, so this isn't wasted effort:** every check that *can* be done without a
real compiler was done and is clean (§§2,5,9,10) — so if/when a real build is triggered, the
person doing it is not starting from zero; the wiring, module graph, and version alignment have
already been verified as far as static inspection allows.

## 11a. Stage 1C.1 update — Step 7 (`eas-update`) gate root-caused and cleared; GuardDog exonerated

The cloud pipeline's Step 7 failure (`expo config --json exited with non-zero code: 1`) was
**not** caused by GuardDog, this plugin, `packages/`, autolinking search paths, Hermes, or Node.
Root cause: Emergent's step removes `projectId`, `eas project:init` re-links and writes the
plugin-evaluated `extra` back into `app.json` with `deepmerge` (arrays concatenate), doubling
`extra.eas.build.experimental.ios.appExtensions`; expo-share-intent's compatibility checker then
throws on two `ShareExtension` entries. Fixed by `plugins/withEasAppExtensionsDedupe.js`
(first plugin in `app.json`). Full trace, reproduction, and 10-point verification (including a
clean Android prebuild with GuardDog resolving exactly once and the 91-file SHA-256 manifest
re-verified) in `docs/STAGE_1C1_STEP7_CONFIG_DIAGNOSTIC.md`.

## 11b. Stage 1C.1 — first real EAS Android build reached PREBUILD; failed on package location; fixed

EAS build `f2359ee5-b971-473c-9fb8-9b13f0f766c7` (the first run to reach the EAS Android worker) failed
in PREBUILD, before any Gradle/Kotlin step:

```
[withGuardDogEngine] Missing staged GuardDog source at
/home/expo/workingdir/packages/guarddog-android-sdk/guarddog-core
```

Cause: Emergent runs `eas build` from `frontend/` with no VCS; eas-cli (`NoVcsClient`) then archives only
the project root (`frontend/`, honouring `.gitignore` files beneath it), so the sibling repo-root
`packages/` was never uploaded (archive was 4.0 MB). Our fail-fast check fired exactly as designed.

Fix (approved): `git mv packages frontend/packages` (91 renames, zero content changes) and three
Apollo-owned path references updated — `withGuardDogEngine.js` (`REQUIRED_PATHS` → `packages/...`,
`PACKAGES_DIR_FROM_ANDROID` → `../packages`) and `package.json` (`expo.autolinking.searchPaths` →
`["./packages"]`). Generated settings.gradle now reads
`project(':guarddog-core').projectDir = new File(rootDir, '../packages/guarddog-android-sdk/guarddog-core')`
(and likewise for `guarddog-vpn`). §1/§2 snippets above showing `../packages` / `../../packages` are
historical; the current values are as stated here.

Verification: SHA-256 manifest 91/91 OK from the new location · `expo config --json` and
`--type introspect` exit 0 · eas-cli archive simulation (same `ignore` semantics + `.gitignore` under
`frontend/`) ships 320/320 tracked files incl. 91/91 under `packages/` · clean `expo prebuild
--platform android` inside a copy of that archive **with no sibling `packages/`** exits 0 ·
`include(':guarddog-core')` ×1, `include(':guarddog-vpn')` ×1, serialization classpath ×1, both
`projectDir`s resolve · autolinking: `guarddog-expo-module` → 1 project
(`packages/guarddog-expo-module/android`) · `android.minSdkVersion=26` · 35/35 regression tests.

Non-blocking findings from the same worker log (not addressed here, by scope): expo-doctor 17/20 —
missing peer dep `expo-asset` (required by expo-audio; "may crash outside Expo Go"), duplicate
`react-native-svg` (15.15.4 vs 13.14.1 via @nandorojo/heroicons), patch-version drift. Phase result was
"warning", the build continued past it.

**Historical classification corrected by §13:** the SVG duplication was non-blocking for the
build task, but **was a runtime launch blocker**. It must not remain on a harmless-warning backlog.

Status: Stage 1C.1 IN PROGRESS — Gradle/Kotlin compilation not yet reached. Stage 1D not started.

## 11. Confirmations (per Stage 1C scope)

- Consumer UI, Higgins (`backend/routers/ask.py`), `SecurityPlatformAdapter.ts`, Patrol
  (`backend/routers/patrol.py`), and threat-event semantics — **all untouched** (`git diff --stat`
  empty on every one of them).
- `packages/guarddog-contracts`, `packages/guarddog-ios-sdk` — **not referenced anywhere** in
  this stage's plugin/config.
- No certification harnesses, M1/M2 acceptance infrastructure, evidence fixtures, or acceptance
  applications were added — nothing beyond the Stage 1B allow-list was touched.
- Truth-of-state invariant (`THREAT_BLOCKED`/"Apollo is biting" only from real post-block
  enforcement evidence) — untouched code path, and existing invariant tests (§5) still pass
  11/11.

## 12. Ready for the next stage?

**Stage 1C (structural integration) is complete.** Support reports that native builds now
succeed and the fixed app reaches Home on an emulator (§13). **Do not advance to Stage 1D
until the user confirms that a fresh post-fix APK launches and stays open on the Pixel 10.**
Emulator success is not physical-device sign-off, and reaching Home is not proof of native
enforcement. Stage 1D runtime wiring, VPN start/stop proof, real packet-block evidence and
subsequent Higgins/consumer integration remain separate work.

## 11c. Stage 1C.1 — first Gradle run (EAS build `eb022c0b`): PREBUILD ✅, Gradle configuration ❌ on Apollo's own module; fixed

Build `eb022c0b-8b19-43c0-9089-adbd553dd00c` confirmed the `frontend/packages` relocation works in the cloud
(PREBUILD passed, 4.2 MB archive) and reached `RUN_GRADLEW` (Gradle 9.3.1, AGP 8.12.0, Kotlin 2.1.20,
compileSdk 36, minSdk 26). It failed during project configuration — **not on GuardDog**:

```
A problem occurred configuring project ':apollo-security'.
> Android Gradle Plugin: project ':apollo-security' does not specify `compileSdk` in build.gradle
```

Cause: Apollo's pre-existing local module `modules/apollo-security/android/build.gradle` used the legacy
`ExpoModulesCorePlugin.gradle` + `applyKotlinExpoModulesCorePlugin()` path, which under SDK 57 no longer
supplies `compileSdk`. Fix: migrated that Apollo-owned file to `plugins { id 'expo-module-gradle-plugin' }`
+ `expoModule { canBePublished false }` — the exact pattern the certified `guarddog-expo-module` already uses
(whose header documents that the legacy path also causes a runtime "reified type parameter" crash).
No certified file touched (SHA-256 manifest 91/91 re-verified). Prebuild in a simulated EAS archive exits 0;
autolinking: `apollo-security` ×1, `guarddog-expo-module` ×1. Gradle cannot be executed in the sandbox
(no JDK/Android SDK) — next cloud build is the test.

## 13. Support resolution: post-splash crash (2026-09-19)

### Provenance and exact failure

- **Owner:** Emergent Support, ticket **257445** (attribution recorded in the fix commit).
- **Fix commit:** `01a30ae72accc3c366492f0217d7fec3cdce866a`, authored
  **2026-09-19 18:10:55 UTC**; subject:
  `fix(android): pin react-native-svg to a single copy (yarn resolutions) to stop launch crash`.
- **Symptom:** the installed APK exited about one second after launch, following the splash
  screen. The user saw Android's **"Apollo keeps stopping"** dialog, not SafeStart. Apparent
  continued background presence was reported, but was not proof that protection remained active.
- **Exact exception recorded by Support in that commit:**

  ```text
  Invariant Violation: Tried to register two views with the same name RNSVGCircle
  ```

### Root cause and fix

Two copies of `react-native-svg` were bundled and both registered the same native view names:

```text
Apollo frontend                 → react-native-svg 15.15.4
@nandorojo/heroicons 0.3.0       → react-native-svg ^13.1.0 → 13.14.1
```

Support added **`"react-native-svg": "15.15.4"` to `resolutions`** in
`frontend/package.json`. The direct dependency was already `15.15.4`; the fix forces the
icon library's transitive dependency to use that same copy. Support also regenerated
`frontend/yarn.lock`: the separate `13.14.1` entry was removed and both selectors now share
the `15.15.4` entry:

```yaml
react-native-svg@15.15.4, react-native-svg@^13.1.0:
  version "15.15.4"
```

The commit changes **only those two dependency files**. No app source, config plugin, security
policy or certified GuardDog package was changed by this fix. The commit also records a bundle
module-count reduction from **2747 to 2513**; this is supporting history, not an acceptance test.

SafeStart/conditional SecureCore policy changes were earlier, separate work. A security-config
unit-test failure was not evidence of this APK's actual crash cause. SafeStart does not
deduplicate SVG native views. The earlier eager-native-module/timing hypothesis was retracted;
it must not be recorded as this incident's root cause. Healthy backend `/health` logs, an API
root `/` 404, Firebase client configuration and preview tunnelling likewise do not establish
the cause of the recorded `RNSVGCircle` exception.

### Verification and limits

| Evidence | Result / provenance |
|---|---|
| Exact exception and dependency fix | Recorded in Support's commit above; commit body and two-file patch inspected on 2026-09-20 |
| Deploys and Android builds complete | Support's message supplied by the user; not a new cloud run by this documentation session |
| App reaches Home on an emulator | Support-reported test result; raw emulator logs, image/API level and APK hash were not supplied |
| `yarn why react-native-svg` in the current workspace | One resolved `15.15.4`, hoisted for both the app and `@nandorojo/heroicons` |
| Node resolution from app and icon-library locations | Both resolve the same `frontend/node_modules/react-native-svg/package.json`, version `15.15.4` |
| Frozen GuardDog manifest | All 91 files match `APOLLO_STAGE1B_SHA256_MANIFEST.txt`, rechecked on 2026-09-20 |
| New APK on the user's Pixel 10 | **Pending**; no post-fix physical-device success has been reported |
| Native start/stop, packet blocking, push delivery | **Not established by this startup fix** |

Support says the APK already on the phone predates the fix and will not update itself. A fresh
**Publish → Build → install newly generated APK** is required. Record that build's ID, commit,
APK SHA-256, Pixel Android version, and launch/reopen result when available. Do not relabel the
old installed APK's crash as a failure of this new fix without checking build provenance.

### Preventing recurrence

1. Preserve the single-version SVG resolution and regenerated lockfile together. Do not remove
   the resolution merely to silence Yarn's expected warning that `15.15.4` falls outside the
   icon library's declared `^13.1.0` range. Reassess compatibility and icon rendering when upgrading.
2. After dependency/icon-library changes, run `cd frontend && yarn why react-native-svg` and
   confirm one version; check resolution from both consumers, not only the app's direct dependency.
3. Treat duplicate native-view dependencies as possible **runtime blockers**, even when Gradle
   succeeds. A successful build or web preview alone does not prove release APK startup.
4. Smoke-test the rebuilt native app through splash → Home, icon rendering and close/reopen.
   Keep physical-device launch acceptance separate from later native-enforcement proof.
5. If this exact exception recurs, compare the APK's source commit and dependency lockfile with
   the fix above before changing security selectors, backend health routes or GuardDog.

### Related support statements and scope

The user's support message also says deploy/build failures were resolved and that GitHub blocked
the secret-bearing push, so keys were not exposed and rotation was unnecessary. These are
**attributed support statements**, not an independent credential-exposure audit. No secret values
are reproduced here. No additional platform-side fix commit was identified; do not invent a
shared cause for deploy failures and the separately evidenced SVG crash.

This record is documentation-only. Stage 1D remains paused pending the fresh physical-device
launch result; the certified engine remains frozen.

## 14. Post-merge/native-build dependency singleton safeguard (2026-09-20)

Recurrence prevention is now implemented, not just a manual `yarn why` checklist. See
[NATIVE_DEPENDENCY_GUARD.md](NATIVE_DEPENDENCY_GUARD.md) for policy, commands, the complete
installed native inventory, regression evidence and lifecycle limitations.

- `frontend/scripts/native-dependency-guard.cjs` recursively inspects the installed tree and
  fails on multiple physical copies of native packages, including different-version and
  same-version copies. Every version/path is reported; symlinks to one physical copy are allowed.
- Covers the seven requested RN modules, RN/Expo core, and automatically discovered Expo/scoped/
  third-party native packages. No dependencies are modified; SVG remains pinned to **15.15.4**.
- `.github/workflows/native-dependencies.yml` checks post-install PR/push trees; existing
  `yarn security:preflight` invokes the guard. The early EAS pre-install lifecycle explicitly
  defers only the dependency scan; registered Android/iOS prebuild mods enforce it after install.
- One-time audit: **888 installed packages inspected; 50 native package names; zero duplicates**.
- Focused tests: **44/44**, independently verified (`test_reports/iteration_61.json`), with
  zero defects in the scoped checks and GuardDog hashes **91/91 unchanged**. No native runtime wiring, backend, UI/Higgins or frozen
  GuardDog source changed. **Stage 1D stays paused until fresh APK verification on Pixel 10.**
