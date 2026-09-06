# Guard Dog — PRD / Memory

## Original problem statement (summary)
Frozen M1 execution spec (Part 4.1 Android real blocking proof + Part 5 FastAPI signed rules / threat intelligence). Preserve public SDK boundary (`requestPermission("vpn")`, `startProtection()`), truthfulness rule (THREAT_BLOCKED only from observed + dropped packet), privacy-first local-first boundary, canonical repository file plan, no parallel trees.

## User choices (2026-06)
- Scaffold canonical monorepo in /app from scratch; task board at docs/M1_TASK_BOARD.md; implement directly.
- Controlled endpoint placeholders via env: m1-block-test.guarddog.example / 203.0.113.10 (not acceptance targets).
- Google Web Risk: provider abstraction + env key wiring + mocked tests; no live key.
- Fresh M1 test-only Ed25519 keypair `gd-m1-test-ed25519-001` (+ rollover key 002); private keys in gitignored backend/.env; .env.example without secrets.
- Kotlin/Swift: complete source + tests, labelled code-review ready / not runtime-verified.

## Architecture
- backend/app (FastAPI, motor): routes health/config/rules/keys/intelligence; services jcs (rfc8785), rule_signer, key_registry, rule_bundle, provider_cache, intelligence; providers base + google_webrisk; repositories for the 5 allowed Mongo collections. server.py re-exports app.main:app.
- packages/guarddog-contracts: TS contracts; synced to frontend/src/contracts/shared by script.
- Android: guarddog-core (platform-agnostic; verifier, canonicalizer, engine, abstractions) ← guarddog-vpn (service, /32 route, TUN reader, drop reporter, deduper) ← expo module (records, adapters, module class).
- iOS: GuardDogCore (verifier, JCS, canonicalizer, CapabilityProvider) ← GuardDogNetworkFeasibility; Expo iOS module + DTO adapters (analysis-only, never THREAT_BLOCKED).
- apps/guarddog-mobile == frontend (symlink): SDK, contracts, harness, index.tsx harness screen.

## Implemented (2026-06)
- All spec files created (see docs/M1_TASK_BOARD.md). Backend 93 pytest passing; contracts 14 node tests passing; fixtures generated; web harness verified via screenshot (BLOCKED/SKIPPED honest states).
- Native gate round: signing guard (admin token + GD_SIGNING_ENABLED + confirm + ruleset allow-list + controlled-config check; secret redaction), endpoint verify/resign scripts, Gradle root + CI gate scripts (android/ios), Expo config plugin linking the Android SDK modules, android-dev-build script with merged-manifest checks, TunSession recovery + tests, proof report export (JSON + PDF via expo-print), docs/M1_NATIVE_GATE.md (status OPEN).

- 2026-06 (Elastic IP confirmed by user): real bundle RESIGNED → final v25 (v18 first; v19–24 were legacy live-test bundles, guarded resign re-run), keyId gd-m1-test-ed25519-001, payloadHash 2581666c…; `scripts/verify_resigned_bundle.py` 10/10 PASS (docs/evidence/resigned-bundle-verification.json). Recovery checklist (approved, AC-06) implemented: native `RecoveryInspector`/`getRecoveryStatus` (TUN closed, lifecycle, OS VPN transport), harness steps stop/tun-closed/route-cleared/recovered (real HTTPS 200 required), E2E test step 6, `TunSessionRecoveryTest` case, docs/M1_RECOVERY_CHECKLIST.md. Proof report m1-2: recovery chain + local JSON file (expo-file-system) + PDF + share sheet (expo-sharing). Static native-gate review recorded in docs/M1_NATIVE_GATE.md (gates remain OPEN).

- User review (2026-06): APPROVED, M1 OPEN pending native execution. Three checks applied: (1) `getRecoveryStatus` removed from public `GuardDogSecuritySDK`; harness-only adapter `src/harness/recoveryDiagnostics.ts`; (2) TRANSPORT_VPN is supporting evidence only (Kotlin `RecoveryStatus.recovered` excludes it; harness `route-cleared` = !selectiveRouteActive && !tunOpen; E2E logs it, does not assert); (3) bundle FROZEN at v25: `GD_M1_FROZEN_BUNDLE_VERSION=25` → API 409 BUNDLE_FROZEN, resign script needs `--unfreeze`, verify script asserts ==25, conftest blanks the freeze for isolated in-process tests. Revoke-path proof approved (device). User wants the Android native gate output first, before device time.

- 2026-06 Android native gate EXECUTED here (installed JDK17 arm64 + Android SDK + Gradle 8.9 + qemu x86_64 aapt2 via ~/.gradle/gradle.properties override): PASSED, 29 native tests 0 failed, expo prebuild + :guarddog-expo-module:assembleDebug compiled. Fixed by real build: erdtman coordinate io.github.erdtman; `fun interface ProtectionEnforcementReporter`; RuleBundleVerifier raw-JSON type check ("3"/3.0 → SCHEMA_INVALID parity); config plugin adds kotlin-serialization classpath to app root build.gradle; gate script hardened. Evidence docs/evidence/android-native-gate.txt (+ test XMLs). frontend/android generated dir gitignored. User audits this before iOS gate / device work.

- 2026-06 reviewer: AC-01 APPROVED; asked to verify generated app SDK levels. Found minSdk 24 → fixed with expo-build-properties (26/36/36), gate step 6 asserts it; standalone SDK aligned to AGP 8.12.0 / Kotlin 2.1.20 / compileSdk 36 / Gradle 8.13; gate re-run PASSED (29/29) from clean prebuild. Added scripts/ci/setup-android-toolchain-linux.sh (system packages in this container are NOT persistent — /opt and apt installs vanished once; re-run setup before gate). iOS gate (AC-02) needs macOS/Xcode — cannot run here (GuardDogCore imports CryptoKit; no Swift toolchain).

- 2026-06 AC-04 track: android-dev-build.sh ran here through merged-manifest audit → PASS (all reviewer checklist items; high-risk perms absent; READ/WRITE_EXTERNAL_STORAGE blocked via app.json blockedPermissions; android.permissions now INTERNET/ACCESS_NETWORK_STATE/FGS/FGS_SYSTEM_EXEMPTED/POST_NOTIFICATIONS). APK assembly NOT completed here: NDK/CMake x86_64-only → qemu wrappers (-0 argv0) worked but the container system layer resets periodically (JDK/SDK/qemu/tmp wiped twice) — not viable for long builds. Added GitHub Actions jobs: android-dev-build (ubuntu, uploads APK + manifest evidence), ios (macos-15, Xcode select, prebuild ios, same gate script, evidence artifact). setup-android-toolchain-linux.sh: pinned versions + SHA-256 verification + NDK/CMake qemu wrapping on arm64. Script fixes: merged_manifest path (AGP 8.12), no-device graceful exit, GD_DEV_ABIS default arm64-v8a.

- 2026-06 reviewer stop: android-dev-build workflow must NOT receive the signing private key → fixed: job needs only var GD_BACKEND_URL; dev-build script verifies endpoint via public /api/config (`verify_controlled_endpoint.py --api`) and asserts served bundle == frozen version + signed by SDK-pinned public key; no backend started in that job. Backend distribution-only mode added (GD_SIGNING_ENABLED=false → private key optional, no seed signing, can_sign=False). The separate `backend` pytest job still uses the key secret for in-process signing tests (backend side, not mobile) — candidate to switch to an ephemeral CI seed later. Release manifest must prove SYSTEM_ALERT_WINDOW absent (debug-only).

## Backlog / remaining
- Live signing tests gated by GD_RUN_LIVE_TESTS=1. Order agreed with user: Android native gate → iOS native gate → Android dev build → physical-device proof → recovery proof → export JSON/PDF → final M1 acceptance. Do not mark native gates or M1 complete without native execution evidence.
- Out of scope for M1 (user decision): backend evidence upload/archiving of proof reports. Local JSON + PDF export only.
- P0 (native machine + physical device): run scripts/ci/android-native-gate.sh, ios-native-gate.sh, android-dev-build.sh; physical-device proof; recovery run; export report. M1 stays OPEN until then.
- P1: SharedPreferences store hardening (EncryptedSharedPreferences), backend admin auth beyond static token, provider retry/backoff.
- P2: iOS enforcement feasibility beyond M1 (out of scope), Threat Scent UX.
