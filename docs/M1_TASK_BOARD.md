# Guard Dog — M1 Execution Board (Part 4.1 + Part 5)

Status legend: ✅ done (executed here) · 📝 code-review ready / not runtime-verified (Swift; no Xcode in this environment — Kotlin items marked 📝 were compiled + unit-tested by AC-01 on 2026-06) · ⏳ blocked on physical device / native machine.

Every ticket lists dependencies and pass/fail criteria. IDs are stable; reference them in commits.

## A. Preflight (Phase 0)

| ID | Ticket | Depends on | Pass / Fail | Status |
|---|---|---|---|---|
| PF-01 | Remove core → VPN dependency: `ProtectionRuntimeStateProvider`, `ProtectionEnforcementReporter` in core; VPN implements them | — | `grep -r "com.guarddog.vpn" guarddog-core/` is empty; `settings.gradle.kts` has one-way `:guarddog-vpn -> :guarddog-core` | 📝 |
| PF-02 | Delete all simulated blocking (`simulateControlledBlockProof` & equivalents) | — | No code path builds `THREAT_BLOCKED` without `BlockedThreatEvidence`; only `GuardDogSDKEngine.reportBlockedPacket` emits it | ✅ (never introduced) |
| PF-03 | Selective route only: `/32`, DNS/IP binding re-check before install, `ParcelFileDescriptor` retained/closed | PF-01 | `SelectiveRouteInstallerTest` proves single `/32`, no `0.0.0.0/0`; mismatch → `Failed` state | 📝 |
| PF-04 | Authoritative lifecycle: `VpnStateRepository` written only by service/consent; no duplicate booleans | PF-01 | `VpnLifecycleStateTest`; revocation clears consent; destroy → `Stopped` | 📝 |
| PF-05 | Real foreground service: channel, `startForeground` in lifecycle window, `systemExempted` type, stop/cleanup | PF-04 | Manifest declares FGS type + permissions; notification factory has no TODO | 📝 |
| PF-06 | Preserve public SDK boundary (`requestPermission("vpn")`, `startProtection()`), no Android-only APIs | — | `GuardDogSecuritySDK.ts` exposes no `startVpnProtection/bindVpnService/startForegroundVpn` | ✅ |
| PF-07 | Concrete `com.guarddog.expo.GuardDogExpoModule` class (no typealias) + `expo-module.config.json` | PF-01 | Class file exists in module tree; autolinking config lists it | 📝 |
| PF-08 | Valid Kotlin serialization symbols (`SecurityEvent.serializer()`, `SignedRuleBundle.serializer()`) | — | `serializerSymbolIsReal` test compiles | 📝 |
| PF-09 | Host normalization parity incl. real IPv6 validation | — | `host_vectors.json` passes in Python ✅, TS ✅, Kotlin 📝, Swift 📝 | ✅/📝 |
| PF-10 | URL sanitization: original analyzable, `sanitizedUrl` = scheme+host+path | PF-09 | `url_vectors.json` passes on all four; `.../login?token=SECRET` → `.../login` | ✅/📝 |
| PF-11 | iOS: `GuardDogCore` ↔ `GuardDogNetworkFeasibility` cycle removed via `CapabilityProvider` | — | `GuardDogCore/Package.swift` has no dependencies; feasibility depends on core | 📝 |
| PF-12 | Explicit bridge DTO adapters (Android Records, iOS Records); no implicit domain objects over the bridge | PF-07 | `GuardDogExpoAdapters` / `ExpoBridgeAdapters` are the only conversion points; iOS adapter refuses `THREAT_BLOCKED` | 📝 |

## B. Cryptographic foundation (Phase 1)

| ID | Ticket | Depends on | Pass / Fail | Status |
|---|---|---|---|---|
| CR-01 | Envelope schema (strict) in Python/TS/Kotlin/Swift | — | Extra key, `"3"`, `3.0` all → `SCHEMA_INVALID` on every platform | ✅/📝 |
| CR-02 | RFC 8785 canonicalization: Python `rfc8785`, Kotlin erdtman, Swift/TS constrained-domain; byte identity | CR-01 | `jcs/canonical_bytes.hex` reproduced by all four | ✅ (py, ts) / 📝 |
| CR-03 | Ed25519 M1 test keypair `gd-m1-test-ed25519-001`; private key env-only; public key pinned | — | `backend/.env` gitignored, `.env.example` has no secrets; pinned key == env public key (test) | ✅ |
| CR-04 | Verification order: schema → hash → key → signature → time → rollback | CR-01..03 | Manifest test passes on Python; same expectations in Kotlin/Swift tests | ✅/📝 |
| CR-05 | Key rollover: introduce key 002, retire 001 without API/bridge change | CR-03 | `test_keys_metadata.py`, `keyRolloverWithoutBridgeChanges`, `testKeyRollover` | ✅/📝 |
| CR-06 | Rollback store (in-memory core; SharedPreferences / UserDefaults in bridge) with frozen clock tests | CR-04 | Older or equal version → `ROLLBACK` | ✅/📝 |
| CR-07 | Generate committed fixtures deterministically | CR-03 | `test_bundle_fixture_generation.py` byte-identical regeneration | ✅ |

## C. FastAPI / signing / intelligence (Phase 4)

| ID | Ticket | Depends on | Pass / Fail | Status |
|---|---|---|---|---|
| BE-01 | `backend/app` layout, settings from env, redaction logging | — | `/api/health` 200; raw URLs never in logs (`test_log_filter_redacts_urls`) | ✅ |
| BE-02 | Rule conflict validation (dup IDs, case/dot/Unicode/punycode equivalence, allow/block contradiction) | CR-01 | `test_rule_conflicts.py` | ✅ |
| BE-03 | Signing workflow + versioning + Mongo (`rule_bundles`, `rule_versions`) | BE-02, CR-04 | `POST /api/rules/sign` (admin) increments version; `GET /api/rules/{id}/latest` verifies | ✅ |
| BE-04 | Key metadata (`key_metadata`) + `GET /api/keys`, retire endpoint | CR-05 | No private material in responses | ✅ |
| BE-05 | Provider abstraction + Google Web Risk adapter (env key, mocked tests) | — | 400/403/429/5xx/timeout → `ProviderUnavailable`; only sanitized URI sent | ✅ |
| BE-06 | Provider cache (`provider_cache`, TTL, hashed key) | BE-05 | second lookup served from cache; non-answers never cached | ✅ |
| BE-07 | Intelligence order: local rules → cache → sanitized cloud; fail-open `unknown/unavailable` + `degraded` | BE-03, BE-06 | `test_url_sanitization_privacy.py` | ✅ |
| BE-08 | `/api/config` with honest capability statement + controlled endpoint injection | — | Harness reads config; no production infra hardcoded | ✅ |
| BE-09 | Seed controlled block bundle through the normal rule-authority chain (not a hardcoded target) | BE-03 | Startup signs `m1-controlled-block-001` only if ruleset empty | ✅ |

## D. Android core / VPN / bridge (Phases 2–3)

| ID | Ticket | Depends on | Pass / Fail | Status |
|---|---|---|---|---|
| AN-01 | `RuleBundleVerifier`, `TrustedKeyRegistry`, `BundleVersionStore` (core) | CR-* | `RuleBundleVerifierTest` on shared vectors | 📝 |
| AN-02 | `HostCanonicalizer`, `UrlSanitizer` (core) | PF-09/10 | parity tests | 📝 |
| AN-03 | `GuardDogSDKEngine`: accept bundle, `authorizeControlledTarget`, `reportBlockedPacket` gated on ACTIVE + authorized IP | AN-01, PF-01 | Only path to `THREAT_BLOCKED`; evidence for other IPs discarded | 📝 |
| AN-04 | `VpnConfig` injection, `ControlledEndpointResolver` (single A record must equal dedicated IPv4) | PF-03 | mismatch / multi-record / no-record → abort | 📝 |
| AN-05 | `Ipv4PacketParser` | — | `Ipv4PacketParserTest` (TCP/UDP/ICMP/options/IPv6 reject) | 📝 |
| AN-06 | `TunPacketReader` + `PacketDropReporter` (observe → drop → evidence), never forwards | AN-05 | `TunPacketReaderTest`: 4 packets → 3 observed/dropped, 2 reported, 1 deduped, 1 unexpected | 📝 |
| AN-07 | `BlockedFlowDeduper` short-lived window | — | one connection attempt → one block within window | 📝 |
| AN-08 | `GuardDogVpnService` lifecycle, foreground, revoke/destroy, `ParcelFileDescriptor` close | PF-04/05, AN-04..07 | Service is sole writer of lifecycle; `Failed` on binding mismatch | 📝 |
| AN-09 | Expo module: consent intent → `recordConsent`, `startProtection` = consent + bundle + binding + authority → service | AN-03, AN-08 | `ERR_CONSENT / ERR_NO_BUNDLE / ERR_DNS_BINDING / ERR_RULE_AUTHORITY` never start the service | 📝 |
| AN-10 | `AndroidBlockingProofE2ETest` instrumentation (real endpoint args) | AN-09 | reachable → blocked → single `THREAT_BLOCKED` with evidence → unrelated OK | ⏳ |

## E. iOS corrections

| ID | Ticket | Depends on | Pass / Fail | Status |
|---|---|---|---|---|
| IO-01 | `CapabilityProvider` injection; honest `iosM1` capabilities | PF-11 | No enforcement claim; `analysisAndWarningOnly = true` | 📝 |
| IO-02 | Swift `RuleBundleVerifier` (CryptoKit) + JCS + registry + rollback | CR-* | `RuleBundleVerifierParityTests` | 📝 |
| IO-03 | Swift host/URL parity | PF-09/10 | parity tests | 📝 |
| IO-04 | Expo iOS module + DTO adapters; adapter refuses `THREAT_BLOCKED` | IO-01/02 | `BridgeDTOAdapterTests` | 📝 |

## F. Shared contracts / RN harness

| ID | Ticket | Depends on | Pass / Fail | Status |
|---|---|---|---|---|
| RN-01 | `packages/guarddog-contracts` (securityEvent, capabilities, ruleBundle, normalization) + node tests | — | `node --test` 14/14 | ✅ |
| RN-02 | `GuardDogSecuritySDK.ts` unchanged surface; validates every bridge event; drops fake blocks | RN-01 | `validateSecurityEvent` rejects `THREAT_BLOCKED` without evidence/source/IP/rule | ✅ |
| RN-03 | Harness (`androidBlockingProofHarness.ts`) reports PASS/FAIL/BLOCKED/SKIPPED, never fabricates | RN-02, BE-08 | On web/Expo Go: verify/before/consent BLOCKED, start SKIPPED | ✅ |
| RN-04 | Fixtures (`ruleBundleFixtures.ts`): live bundle + tampered/unknown-key negatives | BE-03 | Negatives rejected natively when module present | ✅ |

## G. Final acceptance (Phase 5) — ⏳ blocked on native environment (tracking: `docs/M1_NATIVE_GATE.md`)

| ID | Ticket | Depends on | Pass / Fail | Status |
|---|---|---|---|---|
| SG-01 | Signing guard: admin token + `GD_SIGNING_ENABLED` + `confirm` + ruleset allow-list + controlled-config check; secrets never logged | BE-03 | `test_signing_guard.py` | ✅ |
| SG-02 | Endpoint tooling: `verify_controlled_endpoint.py`, `resign_controlled_bundle.py --confirm`, `verify_resigned_bundle.py` | SG-01 | refuse placeholder; resolution must equal dedicated IPv4; 10-point post-resign check | ✅ |
| AC-01 | `scripts/ci/android-native-gate.sh` (resolve, compile, tests, cycle check, Expo module in prebuilt app, frozen SDK levels 26/36/36) | AN-*, PF-* | evidence in `docs/evidence/` | ✅ APPROVED by reviewer; re-run PASSED after SDK-level fix (minSdk 24→26 via expo-build-properties; toolchain AGP 8.12 / Kotlin 2.1.20 / compileSdk 36 / Gradle 8.13) |
| AC-02 | `scripts/ci/ios-native-gate.sh` (resolve, compile, tests, cycle check, Expo iOS module via CocoaPods) | IO-* | evidence in `docs/evidence/` | 📝 scripted + GitHub Actions `macos-15` job wired, ⏳ run |
| AC-03 | Inject real controlled host + dedicated static IPv4 + TLS; resign bundle | — | `/api/config → isPlaceholder=false`, verify script exit 0 | ✅ v25 signed (`blocktest.btciq.app` / 52.25.179.131) and **FROZEN** (`GD_M1_FROZEN_BUNDLE_VERSION=25`, API 409 `BUNDLE_FROZEN`), `docs/evidence/resigned-bundle-verification.json` |
| AC-04 | Android development build (`scripts/ci/android-dev-build.sh`, config plugin, merged-manifest audit) | AC-01, AC-03 | manifest shows service + `systemExempted`; no high-risk permissions; 26/36/36; APK installed | ✅ manifest audit PASSED (evidence committed) · ⏳ APK via GitHub Actions `android-dev-build` or persistent host |
| AC-05 | Physical-device proof (`AndroidBlockingProofE2ETest` + RN harness) | AC-04 | all steps PASS; exactly one `THREAT_BLOCKED` with evidence per attempt | ⏳ |
| AC-06 | Recovery checklist (`docs/M1_RECOVERY_CHECKLIST.md`): stop → TUN closed → INACTIVE/STOPPED → no selective route / VPN transport → real HTTPS **200** again; revoke → REVOKED, consent cleared | AC-05 | harness steps `stop`/`tun-closed`/`route-cleared`/`recovered` all PASS; E2E step 6; `TunSessionRecoveryTest` 📝 | 📝 tooling, ⏳ device run |
| AC-07 | Proof report export (local JSON file + PDF, share sheet; no upload) from device run | AC-05, AC-06 | report `proofComplete=true` and `recoveryComplete=true` with audit + recovery chain | ✅ tooling, ⏳ run |
