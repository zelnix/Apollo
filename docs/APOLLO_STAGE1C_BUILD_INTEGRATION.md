# Stage 1C — Production Build Integration (Report)

**Status: GuardDog engine wired into Apollo's native Android build config; deterministically
reproducible via `expo prebuild`. Real Gradle/Kotlin compilation could NOT be executed in this
sandbox (no JDK/Android SDK/Gradle installed here) — see §4. Nothing beyond native build wiring
was touched: consumer UI, Higgins, `SecurityPlatformAdapter.ts`, Patrol, and threat-event
semantics are all unchanged.**

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
  change.
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

## 10. Flagged, not executed — needs your decision before Stage 1D

**`guarddog-core`/`guarddog-vpn` declare `minSdk = 26`. This app's current effective `minSdk` is
24** (React Native's own default, via its version catalog; this app has no
`expo-build-properties` override today). This is a real, well-documented AGP manifest-merge
constraint (a library's `minSdk` cannot exceed the consuming app's without the app raising its
own floor) — I could not verify the exact failure mode with an actual Gradle run (§4), but I'm
confident enough in this being a real requirement that I stopped rather than guess a fix:
- **File/change required:** raise this app's `minSdk` to 26 via the `expo-build-properties`
  config plugin (`android.minSdkVersion: 26` in `app.json`) — a change to Apollo's own build
  config, not to certified GuardDog source.
- **Effect on certified behavior:** none — GuardDog's own requirement doesn't change either way.
- **Product-level effect:** this would drop support for Android 7.x/7.1 (API 24–25) devices
  app-wide, not just for GuardDog. That's a product-scope decision, not a pure build-wiring
  detail, so it's reported here rather than applied. **Not changed. Awaiting your call.**

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

**Ready for Stage 1D planning, with one open item (§10) needing your decision first**, and with
the explicit caveat that an actual Gradle/Kotlin compile has never been executed against this
wiring (only structurally/statically verified) — that must happen on a real native build before
Stage 1D (production adapter/native-runtime wiring) goes further. Stopping here per instruction —
not proceeding to adapter wiring, live VPN activation, Higgins integration, UI changes, or
physical-device proof.
