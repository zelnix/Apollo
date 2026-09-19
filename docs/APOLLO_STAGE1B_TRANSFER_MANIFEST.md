# Stage 1B — Production Engine Source Transfer (Manifest & Report)


> **Location update (Stage 1C.1, 2026-06):** the staged directory was moved — via `git mv`, zero content
> changes — from repo-root `packages/` to **`frontend/packages/`**. Reason: Emergent's Android pipeline runs
> `eas build` from `frontend/` with no VCS, and eas-cli then archives only that project root, so a sibling
> `packages/` never reached the EAS worker (prebuild failed on `withGuardDogEngine`'s source check). All 91 files
> re-verified against `APOLLO_STAGE1B_SHA256_MANIFEST.txt` (relative paths, run from `frontend/packages/`):
> 91/91 OK. Every `packages/...` path below now means `frontend/packages/...`.

**Status: source staged, unwired.** Files have been copied byte-for-byte from the frozen,
pinned commit into this repo under a new top-level `packages/` directory. **Nothing has been
wired up** — `frontend/package.json`, any Expo config plugin, `SecurityPlatformAdapter.ts`,
`frontend/modules/apollo-security` (`com.hucentai.apollosecurity`), consumer UI, and Higgins are
all untouched. This is intentionally the stop point requested for Stage 1B.

## 1. Source commit verification

| Check | Result |
|---|---|
| Expected commit | `e5d11be912c76775c5a8b27b53218211484ca8bd` |
| Actual (`git rev-parse HEAD` after checkout, scratch clone) | `e5d11be912c76775c5a8b27b53218211484ca8bd` |
| Result | **MATCH** |
| Method | `git clone --single-branch --branch m2-native-acceptance https://github.com/zelnix/Apollo.git` (read-only, scratch `/tmp`, deleted after use), then `git checkout` the exact SHA. Live pinned-SHA GitHub fetch (Method A from `docs/APOLLO_STAGE1A_TRANSFER_PLAN.md`) — no token needed, repo is public. |
| APK SHA-256 `905d66a9ab5d9f70c22c4a2fce897cdf668d975908546e583b404db01f774335` | Recorded as the certification pointer for this commit only — **not** used as a rebuild/equality gate, per instruction. |

## 2. Dependency closure — verified from build configuration, not assumed

| Package | Declares a real build/runtime dependency on... | Evidence |
|---|---|---|
| `guarddog-android-sdk` (`guarddog-core`, `guarddog-vpn`) | External libs only (`kotlinx-serialization-json`, `java-json-canonicalization`, `bouncycastle`) + internal `guarddog-vpn → guarddog-core` (one-way, Gradle-enforced via a `projectsEvaluated` check that fails the build if `core` ever depends on `vpn`). **No dependency on `guarddog-contracts`.** | `packages/guarddog-android-sdk/{build.gradle.kts,guarddog-core/build.gradle.kts,guarddog-vpn/build.gradle.kts}` |
| `guarddog-expo-module` | `implementation project(':guarddog-core')`, `implementation project(':guarddog-vpn')` (real Gradle project dependencies — both already included). **No dependency on `guarddog-contracts`.** | `packages/guarddog-expo-module/android/build.gradle` |
| `guarddog-contracts` references found | Only two **documentation comment** lines ("Mirrors packages/guarddog-contracts/src/...") in `guarddog-core/.../events/SecurityEvent.kt` and `guarddog-expo-module/.../BridgeCapabilityRecord.kt` / `BridgeCapabilityDTO.swift` — human-maintained-parity notes, not an import/dependency declaration. Its own `scripts/sync-to-app.mjs` copies files into **the other project's own** `frontend/src/contracts/shared` — a different app entirely, not `guarddog-android-sdk` or `guarddog-expo-module`. | repo-wide `git grep`, `guarddog-contracts/package.json`, `guarddog-contracts/scripts/sync-to-app.mjs` |

**Conclusion: `guarddog-contracts` is NOT a real build/runtime dependency of either approved
package at the pinned commit.** Per the scope rule, it is excluded from this transfer (see §3).

## 3. Final allow-list / deny-list (as executed)

| Source path | Apollo destination | Action | Reason |
|---|---|---|---|
| `packages/guarddog-android-sdk/**` (72 files: `guarddog-core` + `guarddog-vpn`, build files, Gradle wrapper, own unit tests) | `packages/guarddog-android-sdk/**` | **COPY** (staged, unwired) | Approved production Android engine. All-internal deps only (§2); own unit tests travel with the module (standard practice, not acceptance harnesses). |
| `packages/guarddog-expo-module/**` except one file below (19 files: android+ios bridge code, `src/index.ts`, `package.json`, `app.plugin.js`, podspec, own unit tests) | `packages/guarddog-expo-module/**` | **COPY** (staged, unwired) | Approved production Expo bridge — depends only on the two included SDK modules (§2). Includes its own iOS bridge glue (`ios/GuardDogExpoModule/...`) as part of *this* package — distinct from the separate, deferred `guarddog-ios-sdk` package (§3 below). |
| `packages/guarddog-expo-module/android/src/androidTest/java/com/guarddog/expo/AndroidBlockingProofE2ETest.kt` | — | **EXCLUDE** | Self-documented "Physical-device acceptance (Phase 5)" — requires special instrumentation args (`controlledHost`, `controlledIpv4`, `controlledUrl`, `bundleJson`) tied to the m2 acceptance process. Certification-only harness, not a unit test of module correctness, even though nested inside an otherwise-approved package. |
| `packages/guarddog-contracts/**` | — | **EXCLUDE** | Verified (§2): not a real build/runtime dependency of either approved package. Fails the user's own conditional inclusion rule. |
| `packages/guarddog-ios-sdk/**` | — | **DEFERRED** (not excluded-forever, not imported now) | Explicitly held back per instruction. Legitimate future production scope — to be integrated in a dedicated, deliberate iOS integration stage, not pulled in incidentally with the Android transfer. |
| `docs/M1_*.md`, `docs/M2_PHASE6_ACCEPTANCE_TEMPLATE.md`, `docs/M2_WEBSITE_GATE_DESIGN.md`, `docs/dns-capability-characterization.md`, `docs/evidence/**` | — | **EXCLUDE** | Certification-only acceptance documents/templates/evidence artifacts. |
| `apps/guarddog-mobile/**` | — | **EXCLUDE** | Standalone certification test application, not part of the approved production scope. |
| `scripts/ci/**`, `.github/workflows/**` | — | **EXCLUDE** | CI/proof infrastructure. |
| `security/frozen/**`, `security/test-vectors/**` | — | **EXCLUDE** | m2's own certification-side key/test-vector material (out of the approved production scope; production key/trust material for Apollo main is a separate decision per `docs/APOLLO_PROTECTION_STAGE0.md` §9, not this file transfer). |
| Everything else in the m2 repo (its own `frontend/`, `README.md`, unrelated top-level files) | — | **EXCLUDE** | Out of approved scope entirely — that repo's own consumer app is a separate, unrelated artifact. |

**Total files staged: 91** (72 from `guarddog-android-sdk` + 19 from `guarddog-expo-module`,
after excluding the one acceptance-harness file). Verified byte-for-byte identical to the pinned
commit — see §4.

## 4. Integrity verification of the staged copy

Every one of the 91 staged files was hashed and compared against `git show
e5d11be912c76775c5a8b27b53218211484ca8bd:<path> | sha256sum` from the verified clone. **Zero
mismatches.** The full manifest is stored at `docs/APOLLO_STAGE1B_SHA256_MANIFEST.txt` (durable
audit record, independent of git, for detecting any future drift of this vendored copy).

## 5. Existing-tree comparison (conflicts)

`packages/` did not exist in this repo before this transfer — **zero path/name conflicts**.
`git status` after staging shows only the new `packages/` tree added; no existing file was
modified, moved, or overwritten.

## 6. Adaptations made to the transferred source itself

**None.** All 91 files are byte-identical copies (§4) — no manual edits, no recreation from
memory/description, no renaming.

## 7. Build-system/dependency changes that WILL be required later (not done now — informational)

These are Stage 2+ concerns, flagged for planning only; none were executed in Stage 1B:

1. This is an Expo **managed** workflow app — no `frontend/android` native project is checked
   into this repo (confirmed: no such directory exists). `guarddog-android-sdk`'s Gradle modules
   (`:guarddog-core`, `:guarddog-vpn`) will need to be registered into the app's *generated*
   `settings.gradle` at prebuild time — most likely via a new Expo config plugin (matching the
   existing pattern already used here: `./plugins/withApolloSiteGuard`,
   `./plugins/withApolloCallGuard` in `frontend/app.json`), not a static file edit.
2. `guarddog-expo-module`'s own `android/build.gradle` references `implementation
   project(':guarddog-core')` / `project(':guarddog-vpn')` — Gradle project-path references that
   only resolve once the app's `settings.gradle` includes those modules pointing at
   `packages/guarddog-android-sdk/guarddog-core` and `.../guarddog-vpn`. This is a structural
   coupling the Stage 2 wiring plan needs to account for explicitly.
3. `guarddog-expo-module` requires the `expo-module-gradle-plugin` (its own comment: the legacy
   `ExpoModulesCorePlugin.gradle` path causes a runtime crash on real devices) — needs to be
   confirmed available/added to the app's build once wired.
4. `frontend/package.json` will need a workspace or local `file:` dependency entry so Expo's
   autolinking and Metro can discover `guarddog-expo-module` — not added yet, deliberately (this
   is "changing existing Apollo Production implementation," out of scope for Stage 1B).
5. **Positive compatibility signal, no action needed:** this app is already on Expo SDK
   `57.0.19` — an exact match to what `guarddog-expo-module` was built against
   ("Expo SDK 57 module build"). Reduces integration risk for Stage 2.

## 8. Confirmations

- `packages/guarddog-ios-sdk` — **untouched.** Not cloned into this repo, not referenced,
  recorded as deferred production scope (§3).
- `SecurityPlatformAdapter.ts`, consumer UI, Higgins (`backend/routers/ask.py`), and
  `frontend/modules/apollo-security` (`com.hucentai.apollosecurity`) — **untouched.**
- `ApolloDnsVpnService.kt` / `DnsPacket.kt` — **untouched.**
- No behavioral adaptation, UI wiring, or enforcement redesign was performed.
- The tree is **not yet** ready for the production integration stage — it is staged and
  provenance-verified only. Stage 2 (wiring: Gradle registration, adapter implementation behind
  `SecurityPlatformAdapter`, config-plugin work per §7) is a distinct, later, explicitly-approved
  step.
