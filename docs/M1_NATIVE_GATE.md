# M1 Native Operational Acceptance Gate — STATUS: OPEN

Milestone 1 is **not** complete. Backend pytest, shared contracts (node tests), the real-endpoint resign/verification and the
**Android native gate (AC-01)** pass here. The iOS gate (Xcode), the Android development APK on a device, and the physical
block / recovery / revoke proofs have **not** been executed. The earlier static review is kept below for the record.

## 1. Native build + parity gate — Android ✅ PASSED (executed 2026-06) · iOS ⏳ OPEN
Android gate executed for real in this environment after installing JDK 17 (arm64), Android SDK (platform 36, build-tools 35),
Gradle 8.13 (wrapper), and running the x86_64 `aapt2` through `qemu-user-static` (`~/.gradle/gradle.properties: android.aapt2FromMavenOverride`).
Evidence: `docs/evidence/android-native-gate.txt`, `docs/evidence/android-{core,vpn}-test-results/*.xml`, `docs/evidence/{core,vpn}-deps.txt`.

Result: dependencies resolved · core→vpn graph clean · `:guarddog-core` + `:guarddog-vpn` `assembleRelease` compiled · **29 native unit tests, 0 failed**
(HostCanonicalizerParity 2, UrlSanitizerParity 2, BundleVersionStore 1, RuleBundleVerifier 7 incl. JCS byte-identity + strict schema + rollback +
key rollover, BlockedFlowDeduper 2, Ipv4PacketParser 4, SelectiveRouteInstaller 4, TunPacketReader 2, TunSessionRecovery 3, VpnLifecycleState 2) ·
`expo prebuild --platform android --clean` succeeded with the Guard Dog config plugin · `:guarddog-expo-module:assembleDebug` compiled inside the prebuilt app (AAR).

Findings fixed by the real build (the static review could not see these):
1. Wrong Maven coordinate for the RFC 8785 library: `org.erdtman:…` → `io.github.erdtman:java-json-canonicalization:1.1` (the Kotlin import `org.erdtman.jcs` was already correct).
2. `ProtectionEnforcementReporter` is used with SAM syntax in tests → declared as `fun interface` (production implementation `GuardDogSDKEngine` unchanged).
3. **Parity defect**: kotlinx.serialization decodes the quoted number `"3"` as a Long, so `bundleVersion: "3"` reached signature verification and was rejected
   as `SIGNATURE_INVALID` instead of `SCHEMA_INVALID`. `RuleBundleVerifier.typeProblem` now checks raw JSON types (strings, integer literal, payload/rule
   shape) before decoding — behaviour now matches Python/TS (`strictSchema` passes).
4. Inside the prebuilt app the `org.jetbrains.kotlin.plugin.serialization` plugin had no version → config plugin adds
   `classpath('org.jetbrains.kotlin:kotlin-serialization:<RN kotlin version>')` to the app's root `build.gradle` (read from `react-native/gradle/libs.versions.toml`).
5. Gate hardening: step 1 now fails on unresolved dependencies; step 4 uses `--rerun-tasks` and prints a per-suite summary that fails on any failure.

Follow-up requested by the reviewer (done, gate re-run 2026-06 — PASSED again, 29/29, from a fresh `expo prebuild --clean`):
- **Finding**: the generated Expo app was on **minSdk 24** (Expo default), compileSdk 36, targetSdk 36 — not the frozen configuration.
  Fixed via `expo-build-properties` in `app.json` (`minSdkVersion 26, compileSdkVersion 36, targetSdkVersion 36`); the gate now has
  step 6 which reads the effective levels from the Gradle configuration output and fails unless it sees `minSdk: 26 · compileSdk: 36 · targetSdk: 36`.
- Standalone SDK toolchain aligned with the app: AGP 8.5.2 → **8.12.0**, Kotlin 2.0.21 → **2.1.20**, compileSdk 35 → **36**, Gradle wrapper 8.9 → **8.13**.
  The earlier "AGP tested up to compileSdk 34" warning is gone. Only remaining warning: `android.aapt2FromMavenOverride` is experimental (arm64 host workaround).
- The config-plugin fixes are reproducible: `expo prebuild --platform android --clean` regenerates `settings.gradle` (both SDK modules) and the
  root `build.gradle` (`kotlin-serialization:2.1.20` classpath) every time; nothing depends on a previously generated file.
- `scripts/ci/setup-android-toolchain-linux.sh` provisions the whole Linux toolchain idempotently (this container's system packages are not
  persistent, so the gate can be re-run from scratch with `bash scripts/ci/setup-android-toolchain-linux.sh && source /opt/guarddog-android-env.sh && bash scripts/ci/android-native-gate.sh`).

iOS gate (`scripts/ci/ios-native-gate.sh`) requires macOS + Xcode — now wired as the `ios` job on a GitHub-hosted `macos-15` runner
(`.github/workflows/native-gates.yml`: Xcode select → `expo prebuild --platform ios --clean` → the same gate script → `docs/evidence/ios-native-gate.txt`
uploaded as artifact, `if: always()`). Trigger via push or `workflow_dispatch`. The gate proves: SwiftPM resolves; `GuardDogCore` compiles; Swift parity tests pass;
`show-dependencies` proves no `GuardDogCore → GuardDogNetworkFeasibility` edge; Expo iOS module compiles in the prebuilt app.

| Evidence item | Android | iOS |
|---|---|---|
| package/gradle resolution | ✅ | ☐ |
| core compiles | ✅ | ☐ |
| vpn / feasibility compiles | ✅ | ☐ |
| Expo module compiles in prebuilt app | ✅ | ☐ |
| normalization parity tests | ✅ | ☐ |
| URL sanitization parity tests | ✅ | ☐ |
| signing/JCS fixture tests | ✅ | ☐ |
| dependency cycle check | ✅ | ☐ |

## 2. Signing hardening — DONE (executable, tested)
`POST /api/rules/sign` requires: admin token → `GD_SIGNING_ENABLED=true` → `confirm: true` → rulesetId on
`GD_SIGNING_ALLOWED_RULESETS` → for the M1 ruleset exactly one `block` rule for the configured controlled host and no `allow`.
Private seeds: env-only, `repr=False`, `SecretRedactionFilter` on all loggers, never in any response (`test_signing_guard.py`).
The public app only uses distribution (`GET /api/rules/{id}/latest`, `GET /api/keys`).

## 3. Real controlled endpoint — DONE (resigned 2026-06, verified)
Approved endpoint (backend/.env): `blocktest.btciq.app` → `52.25.179.131` (confirmed Elastic IP), `https://blocktest.btciq.app/`,
ruleset `gd-m1-controlled-block`. Executed here:
- `python scripts/verify_controlled_endpoint.py` → resolved `['52.25.179.131']` (single A record), HTTPS 200, TLS ok, exit 0.
- `python scripts/resign_controlled_bundle.py --confirm` → v18, keyId `gd-m1-test-ed25519-001`,
  payloadHash `2581666cc768e1e4e76962db0cc70e497e17e9b9cf4a5a997c8cfb091e6b90c9`. Note: the legacy live pytest suite (written for the
  placeholder state) was run once afterwards and signed v19–v24 (2-rule test bundles) against the controlled ruleset; the guarded resign was
  re-run → **final bundle v25**, identical payloadHash, single rule. Those live tests are now read-only (mutating one gated by `GD_ALLOW_LIVE_RESIGN=1`).
- `python scripts/verify_resigned_bundle.py` → 10/10 PASS (`docs/evidence/resigned-bundle-verification.json`): version > 17, ruleset,
  keyId 001, exactly one block rule for `blocktest.btciq.app`, placeholder host absent, signature verifies against the pinned public key,
  issuedAt/expiresAt valid, `/api/config isPlaceholder=false`, `/latest` serves v25.
Android re-resolves the host immediately before route install (`ControlledEndpointResolver`); mismatch → `Failed`, no route, no event.

**FROZEN at v25** (user decision, 2026-06): `GD_M1_FROZEN_BUNDLE_VERSION=25` makes `POST /api/rules/sign` refuse the controlled ruleset
(409 `BUNDLE_FROZEN`, checked before rule content), `resign_controlled_bundle.py` refuses without `--unfreeze`, and
`verify_resigned_bundle.py` asserts the served version equals 25. `/api/config.signing.frozenBundleVersion` exposes the freeze.
A genuine correction: raise/unset the env value, resign (version increments normally), set the new frozen version, document it here.
v25 is the minimum accepted version for this ruleset going forward (rollback store).

## 4. Android development build — merged-manifest audit ✅ PASSED · APK ⏳ (needs a persistent native host)
`scripts/ci/android-dev-build.sh` executed here 2026-06 through step 4: `yarn install` → contracts sync → controlled-endpoint binding check
(52.25.179.131, HTTPS 200) → `expo prebuild --clean` with the Guard Dog config plugin → `processDebugMainManifest` → **merged-manifest audit PASS**
(`docs/evidence/merged-manifest-audit.txt`, `docs/evidence/merged-AndroidManifest.xml`):
- `com.guarddog.vpn.GuardDogVpnService` present · `android:permission="android.permission.BIND_VPN_SERVICE"` on the service · `android:exported="false"`
  (intentional: only the app starts it; the system binds through BIND_VPN_SERVICE — matches the Android VpnService reference declaration) ·
  `foregroundServiceType="systemExempted"` · `<action android:name="android.net.VpnService"/>` intent filter
- `uses-permission`: INTERNET, ACCESS_NETWORK_STATE, FOREGROUND_SERVICE, FOREGROUND_SERVICE_SYSTEM_EXEMPTED, POST_NOTIFICATIONS
- `minSdkVersion=26`, `targetSdkVersion=36`, Gradle effective `compileSdk: 36`
- **Absent (asserted)**: QUERY_ALL_PACKAGES, PACKAGE_USAGE_STATS, READ_SMS, READ_CALL_LOG, READ_CONTACTS, MANAGE_EXTERNAL_STORAGE,
  BIND_ACCESSIBILITY_SERVICE (and RECORD_AUDIO, CAMERA, fine/background location, READ_PHONE_STATE); no accessibility service declared.
- Trimmed: Expo's default READ/WRITE_EXTERNAL_STORAGE removed via `android.blockedPermissions` (evidence files live in the app's own document dir).
- Remaining framework permissions, with provenance: VIBRATE (expo-haptics), USE_BIOMETRIC/USE_FINGERPRINT (expo-secure-store),
  DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION (androidx), SYSTEM_ALERT_WINDOW (react-native **debug** manifest only — dev overlay; not in release).

APK assembly (step 5) did not complete here: the third-party C++ modules (react-native-screens/worklets) need the x86_64-only NDK/CMake, which on this
arm64 host run only under qemu emulation, and this container's system layer (JDK/SDK/qemu) is periodically reset, killing long builds. Two ways forward:
- GitHub Actions job `android-dev-build` (`.github/workflows/native-gates.yml`, native x86_64 runner) runs the same script and uploads
  `guarddog-m1-dev.apk` + manifest evidence as artifacts. **Trust boundary (reviewer decision)**: it requires only the repository variable
  `GD_BACKEND_URL`; it consumes public distribution data (`/api/config`, `/api/rules/…/latest`, `/api/keys`) and asserts the served bundle is the
  frozen version and signed by the key pinned in the SDK (`TrustedKeyRegistry.kt`). No backend is started and the Ed25519 signing seed is never
  provided to the mobile pipeline. (`verify_controlled_endpoint.py --api <url>` mode.)
- Backend distribution-only mode: with `GD_SIGNING_ENABLED=false` the backend starts without `GD_M1_SIGNING_PRIVATE_KEY_B64`, serves existing signed
  bundles + public keys, skips seed-signing, and `POST /api/rules/sign` is disabled (`tests/test_distribution_only_mode.py`).
- **APK artifact recheck** (`scripts/ci/apk-recheck.sh <apk>`, wired after the build in the `android-dev-build` job → `docs/evidence/apk-recheck.txt`):
  package id, `application-debuggable` (dev build), `sdkVersion 26` / `targetSdkVersion 36`, `native-code` exactly `arm64-v8a`, VpnService facts from the
  APK's binary manifest (BIND_VPN_SERVICE, `foregroundServiceType=0x400` systemExempted, `android.net.VpnService`), high-risk permissions absent, and a
  content scan proving **no private-key material, admin token, DB URL or backend `.env` content** is packaged (pinned PUBLIC key expected in dex).
- CI key hygiene: the `executable-suites` pytest job now generates **ephemeral** Ed25519 seeds per run (`GD_CI_EPHEMERAL_KEY=1`); the workflow contains
  no `secrets.*` at all. The real `gd-m1-test-ed25519-001` seed stays in the controlled signing environment. The frozen v25 bundle is committed at
  `security/frozen/controlled-bundle-v25.json` and verified read-only with the pinned public key (`tests/test_frozen_bundle_public_verification.py`).
- Release builds: the merged **release** manifest must be audited too — `SYSTEM_ALERT_WINDOW` (RN debug manifest) must be absent there.
- Any persistent Linux/macOS host: `bash scripts/ci/setup-android-toolchain-linux.sh && source /opt/guarddog-android-env.sh && bash scripts/ci/android-dev-build.sh`
  (with a phone attached the script continues into install + `AndroidBlockingProofE2ETest`).

## 5–6. Physical-device proof + recovery — OPEN
Run the RN harness ("Run proof") on the device: it executes the block proof and then the recovery checklist
(`docs/M1_RECOVERY_CHECKLIST.md`): `stopProtection()` → TUN closed → `INACTIVE/STOPPED` → no selective route / OS VPN transport →
real HTTPS **200** from `https://blocktest.btciq.app/` again. `AndroidBlockingProofE2ETest` step 6 asserts the same chain natively
(`RecoveryInspector`, `GuardDogVpnRuntime.activeSession`). Unit-tested: `TunSessionRecoveryTest` (descriptor closed exactly once,
reader stopped, STOPPED/REVOKED states, consent cleared on revoke, recovery snapshot clean only after close + state change).

## 7. Proof report — READY (local export only; uploading/archiving reports is outside the frozen M1 scope)
Harness → "Build JSON evidence" (writes `guarddog-m1-proof-<ts>.json` to the app document directory, `expo-file-system`) → "Export PDF"
(`expo-print`, moved next to the JSON) → optional OS share sheet (`expo-sharing`). Contains only the audit chain
(bundle/version/keyId/payloadHash → host → IPv4 → route → packet stats → drop → enforcementEvidenceId → event id → bridge receipt → timestamps)
plus the recovery chain. No backend upload.

## Static review of the native gates (prepares AC-01/AC-02; does NOT close them)
Performed in this environment by reading sources against the gate scripts. No compiler was available, so every item below stays ☐ until
`scripts/ci/android-native-gate.sh` / `scripts/ci/ios-native-gate.sh` produce `docs/evidence/*-native-gate.txt` on the native machine.

Checked statically (no findings requiring code changes):
- Dependency direction: `guarddog-core/src/main` has no `com.guarddog.vpn` import; `:guarddog-vpn` → `api(project(":guarddog-core"))` only; root
  `build.gradle.kts` fails the build if core ever depends on vpn. iOS: `GuardDogCore/Package.swift` has no dependencies; feasibility depends on core.
- Kotlin API usage on minSdk 26 / compileSdk 35: `startForegroundService`, `startForeground(id, notification, FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED)`
  gated on API 34, `stopForeground(STOP_FOREGROUND_REMOVE)`, `Notification.Builder(context, channelId)`, `VpnService.Builder` used from inside the service.
- New recovery surface: `RecoveryInspector` (vpn module, needs `ACCESS_NETWORK_STATE`, now declared in the vpn manifest and the config plugin),
  `GuardDogVpnRuntime.activeSession` cleared on every cleanup path (stop / revoke / destroy / fail / reader close), bridge `getRecoveryStatus` (Android + iOS).
- Tests selected by the gate exist: `HostCanonicalizerParityTest`, `UrlSanitizerParityTest`, `RuleBundleVerifierTest`, `BundleVersionStoreTest`, `com.guarddog.vpn.*`
  (incl. `TunSessionRecoveryTest` with the new recovery-snapshot case). Vectors path passed via `-Dguarddog.vectors`.
- Expo module: concrete `com.guarddog.expo.GuardDogExpoModule` listed in `expo-module.config.json`; Records are explicit DTOs; `THREAT_BLOCKED` refused by the adapter without evidence.

Residual risks only a real build can settle (watch these lines in the gate output):
1. `expo-modules-core` API drift (`OnActivityResult` payload shape, `appContext.reactContext` availability inside `OnCreate`).
2. `org.erdtman:java-json-canonicalization:1.1` + BouncyCastle resolution on the build machine (offline caches).
3. `cm.allNetworks` is deprecated (API 31) — compiles with the suppression; behaviour verified only on device.
4. Swift: `swift test --filter` regexes match the three parity suites; CryptoKit Ed25519 availability (iOS 13+).

Commands for the native machine (in order):
```
bash scripts/ci/android-native-gate.sh        # AC-01 → docs/evidence/android-native-gate.txt
bash scripts/ci/ios-native-gate.sh            # AC-02 → docs/evidence/ios-native-gate.txt (macOS + Xcode)
EXPO_PUBLIC_BACKEND_URL=<backend url> bash scripts/ci/android-dev-build.sh   # AC-04 + instrumentation proof incl. recovery (AC-05/06)
# then on the device: RN harness "Run proof" → "Build JSON evidence" → "Export PDF" → share both files (AC-07)
```

## Truthfulness invariants (unchanged)
`THREAT_BLOCKED` originates only from `GuardDogSDKEngine.reportBlockedPacket(BlockedThreatEvidence)`, gated on ACTIVE state and the
rule-authorized IPv4; refused again by the bridge adapter and by `validateSecurityEvent` in the app. Rule match, hostname match,
URL analysis, VPN start, HTTP failure, harness or test helpers cannot produce it.
