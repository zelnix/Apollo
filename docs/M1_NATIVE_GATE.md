# M1 Native Operational Acceptance Gate — STATUS: OPEN

Milestone 1 is **not** complete. Backend (93 pytest) and shared contracts (14 node tests) pass here;
everything below requires a native build machine and a physical Android device and has **not** been executed
in this environment (no JDK/Android SDK/Xcode available).

## 1. Native build + parity gate — OPEN
Run and attach `docs/evidence/*`:
- `bash scripts/ci/android-native-gate.sh` → Gradle resolves; `guarddog-core` + `guarddog-vpn` compile; Kotlin normalization,
  URL sanitization, signing/JCS fixture tests pass; graph check proves no core → vpn dependency (also enforced in root `build.gradle.kts`).
- `bash scripts/ci/ios-native-gate.sh` → SwiftPM resolves; `GuardDogCore` compiles; Swift parity tests pass; `show-dependencies`
  proves no `GuardDogCore → GuardDogNetworkFeasibility` edge; Expo iOS module compiles in the prebuilt app.
- GitHub Actions: `.github/workflows/native-gates.yml` runs both gates + executable suites.

| Evidence item | Android | iOS |
|---|---|---|
| package/gradle resolution | ☐ | ☐ |
| core compiles | ☐ | ☐ |
| vpn / feasibility compiles | ☐ | ☐ |
| Expo module compiles in prebuilt app | ☐ | ☐ |
| normalization parity tests | ☐ | ☐ |
| URL sanitization parity tests | ☐ | ☐ |
| signing/JCS fixture tests | ☐ | ☐ |
| dependency cycle check | ☐ | ☐ |

## 2. Signing hardening — DONE (executable, tested)
`POST /api/rules/sign` requires: admin token → `GD_SIGNING_ENABLED=true` → `confirm: true` → rulesetId on
`GD_SIGNING_ALLOWED_RULESETS` → for the M1 ruleset exactly one `block` rule for the configured controlled host and no `allow`.
Private seeds: env-only, `repr=False`, `SecretRedactionFilter` on all loggers, never in any response (`test_signing_guard.py`).
The public app only uses distribution (`GET /api/rules/{id}/latest`, `GET /api/keys`).

## 3. Real controlled endpoint — WAITING FOR INPUT
Current config is the documentation placeholder (`/api/config → controlledEndpoint.isPlaceholder: true`).
When the real Guard Dog-controlled host / dedicated static IPv4 / HTTPS URL are available:
1. set `GD_CONTROLLED_HOST`, `GD_CONTROLLED_IPV4`, `GD_CONTROLLED_URL` (and `GD_RULESET_ID` if it changes) in `backend/.env`
2. `python scripts/verify_controlled_endpoint.py` (single A record must equal the IPv4; TLS answers)
3. `python scripts/resign_controlled_bundle.py --confirm` (signs with `gd-m1-test-ed25519-001` via the guarded workflow)
Android re-resolves the host immediately before route install (`ControlledEndpointResolver`); mismatch → `Failed`, no route, no event.

## 4. Android development build — OPEN
`bash scripts/ci/android-dev-build.sh`: version checks → contract sync → endpoint binding check → `expo prebuild --clean`
(with `packages/guarddog-expo-module/app.plugin.js` linking `:guarddog-core`/`:guarddog-vpn`) → merged-manifest check
(`GuardDogVpnService`, `BIND_VPN_SERVICE`, `foregroundServiceType="systemExempted"`) → native unit tests → `assembleDebug`
→ install → `AndroidBlockingProofE2ETest`. Development build only; not Expo Go; not a Play Store release.

## 5–6. Physical-device proof + recovery — OPEN
Run the RN harness ("Run proof") on the device, then "Stop protection" and re-run the reachability probe. Recovery logic is unit-tested
(`TunSessionRecoveryTest`: descriptor closed exactly once, reader stopped, STOPPED/REVOKED states, consent cleared on revoke).

## 7. Proof report — READY
Harness → "Build JSON evidence" → "Export PDF" (`src/harness/proofReport.ts`, `expo-print`). Contains only the audit chain
(bundle/version/keyId/payloadHash → host → IPv4 → route → packet stats → drop → enforcementEvidenceId → event id → bridge receipt → timestamps).

## Truthfulness invariants (unchanged)
`THREAT_BLOCKED` originates only from `GuardDogSDKEngine.reportBlockedPacket(BlockedThreatEvidence)`, gated on ACTIVE state and the
rule-authorized IPv4; refused again by the bridge adapter and by `validateSecurityEvent` in the app. Rule match, hostname match,
URL analysis, VPN start, HTTP failure, harness or test helpers cannot produce it.
