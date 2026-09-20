# Stage 1D — implementation / acceptance plan review

**Review date:** 2026-09-20. **Application source baseline inspected:**
`0154e186fb4601495c3f4468f9a89ae0d18ce1f1`.

**Stage 1C.1 launch: PASS (user-confirmed fresh APK on Pixel 10).**
**Stage 1D implementation: NOT STARTED. This document is not implementation approval.**

## 1. Review result and source limitations

The repository contains architectural direction in `APOLLO_PROTECTION_STAGE0.md` §§2–6,
`android-consolidation-plan.md` §§4–6, and a type-only
`frontend/src/security/future/GuardDogSecurityAdapter.ts`. It does **not** contain a previously
agreed, file-by-file Stage 1D implementation plan. The exact original P0 review report / IDs
were not present in the supplied conversation, repository review documents, report metadata,
or attachment inventory. Absence of that report does **not** mean zero P0 findings.

The implementation scope below is therefore a **proposed developer response**, grounded in
the present source, not a claim that an external developer already agreed or implemented it.
It is **not yet approval-ready**: the compatibility decisions in §3 and P0 source intake in
`STAGE1D_P0_REMEDIATION_BACKLOG.md` remain unresolved. No runtime code changes were made.

| User requirement | Review disposition |
|---|---|
| Preserve frozen GuardDog | Satisfied for this review: all 91 hashes match; mandatory future before/after gate |
| Preserve adapter contract | Required, but live status / method mapping gaps must be resolved before implementation |
| Source SHA + APK build identifier per device run | Mandatory in new record template; historical launch PASS is retained, not retroactively given invented provenance |
| Separate launch, start/stop and real packet blocking | Separate gates defined below; only historical launch is passed |
| Biting only after observed intentional packet drop | Mandatory native-to-product chain; DNS/rule/configuration events alone expressly excluded |
| Keep each P0 open until verified | Closure policy defined; individual entries cannot be enumerated until original review is supplied |

## 2. Proposed Stage 1D scope — exact candidate changes

**Goal:** an Android-only, opt-in GuardDog-backed implementation behind the unchanged Apollo
contract. Leave the existing legacy Android adapter available and default-selected during
acceptance. No broad consumer cutover, new UI or Higgins behavior. Product code still imports
only `securityAdapter`; no screen, store or backend calls GuardDog directly.

Proposed ownership path (requires explicit confirmation under D1):

```text
unchanged SecurityPlatformAdapter
  -> Apollo-owned GuardDogSecurityAdapter
  -> private facade inside frontend/modules/apollo-security/guarddog/
  -> existing GuardDogSecurity Expo module / its existing engine owner
  -> frozen GuardDogVpnService
```

The facade would consume public bridge functions, not instantiate a second engine, replace
`GuardDogVpnRuntime.reporter`, copy native packet code, or edit the frozen bridge. It is a
translation boundary inside Apollo's own module, not a new consumer-facing SDK contract.

### Candidate implementation allow-list — NO files below changed in this review

| File | Proposed change |
|---|---|
| `frontend/modules/apollo-security/guarddog/GuardDogBridge.ts` (new) | Single private binding to `GuardDogSecurity`; typed public calls, listener ownership/cleanup, deterministic unavailable/error handling. No engine reconstruction. |
| `frontend/modules/apollo-security/guarddog/GuardDogEventBuffer.ts` (new) | Bounded, deduplicated receipt of actual native events for the existing polling contract. Preserve native IDs/times; explicitly report loss/unavailability rather than inventing replay after process death. Retention semantics require D4 approval. |
| `frontend/src/security/future/GuardDogSecurityAdapter.ts` | Replace the type-only placeholder with the opt-in adapter implementing exactly the existing interface; preserve non-enforcement OS/device functionality through the existing Apollo module. Do not copy legacy DNS counters/status into GuardDog status. |
| `frontend/src/security/guarddog/translateGuardDogState.ts` (new) | Pure permission/lifecycle/status/capability translation; distinguish intent, command acknowledgement and observed live enforcement. D2 must resolve the mechanism representation first. |
| `frontend/src/security/guarddog/translateGuardDogEvidence.ts` (new) | Accept only well-formed genuine native block events; retain provenance and stable evidence ID. Unknown/absent packet fields stay unknown/null; missing indispensable provenance is rejected. D4 must settle exact field mapping. |
| `frontend/src/security/securityAdapter.ts` | Android-native-only selection; legacy remains default; selected GuardDog missing/unavailable must not silently fall back to legacy or simulated protection. iOS and explicit mock selection unchanged. |
| `frontend/src/security/securityConfig.ts` | Validate a proposed private build-time selector `EXPO_PUBLIC_ANDROID_ENFORCEMENT_ENGINE=legacy\|guarddog`; retain all current production/security requirements. New selector is proposed, not present today. |
| `frontend/src/config/appEnvironment.ts` | Resolve that selector through the app's configuration boundary, defaulting to legacy; no secrets or signer private keys. |
| `frontend/scripts/security-preflight.mjs` | Validate the same selector/configuration rules; preserve the installed-native-duplication guard and existing EAS lifecycle handling. |
| `frontend/tests/guardDogStateMapping.test.ts` (new) | Exhaustive state/permission/coverage translation tests, including stale/failed/inactive observations. |
| `frontend/tests/guardDogEvidenceMapping.test.ts` (new) | Positive native-event translation plus every negative evidence case and repeat-ID behavior. Fixtures are tests, never live evidence. |
| `frontend/tests/guardDogAdapter.test.ts` (new) | Contract behavior, no automatic start at import, ordered start/stop, unavailable/malformed bridge, listener cleanup and non-enforcement delegation. |
| `frontend/tests/guardDogEngineSelection.test.ts` (new) | Legacy default, explicit GuardDog opt-in, iOS/mock unchanged, malformed selection fails, no silent fallback. |

Only after the decisions below are resolved can this candidate allow-list become a final
implementation plan. If native Kotlin changes, a custom runtime owner, additional app-config
wiring, a new rule-delivery service, or extra files become necessary, return a revised exact
allow-list for approval **before** editing them. Do not claim those designs are already solved.

### Explicit exclusions

- No changes under `frontend/packages/guarddog-*`; no re-certification or imported harnesses.
- No changes to `SecurityPlatformAdapter.ts`, `PlatformCapabilityProfile.ts`, native/TS/Pydantic
  evidence shapes, or public method signatures. No widening an enum quietly to make a mapping fit.
- No edits/removal/expansion of `ApolloDnsVpnService.kt`, `DnsPacket.kt`, the existing iOS adapter,
  device/call/message services, `NativeSecurityAdapters.ts` or the existing public native bridge.
- No Home/Guard/Patrol/Higgins redesign; no `ApolloContext.tsx`, state machine, evidence sync or
  backend Biting-gate changes bundled into this stage. Necessary remediation gets its own scope.
- No new signing backend, new embedded private/test signing keys, certification fixture injection,
  production trust redesign, general M2 Website Gate cutover, iOS/desktop engine integration,
  dependency version changes or removal of the SVG 15.15.4 pin.
- No automatic VPN activation, two simultaneously active VPN engines, production default flip,
  or claim of full-device/DoH/DoT/QUIC/app-attribution coverage.

## 3. Unresolved integration decisions — NOT substitutes for the missing P0 findings

| ID | Source-backed gap | Required developer decision / pass condition | Status |
|---|---|---|---|
| D1 — runtime ownership | Stage 0 requires an Apollo-owned boundary; frozen `GuardDogExpoModule.kt:73–101` constructs the engine and assigns shared runtime owners. A second native engine would conflict with that ownership. | Confirm the private Apollo facade above and one engine/listener owner. If a native facade instead is required, name its files/APIs and lifecycle without modifying certified source. | OPEN |
| D2 — status mechanism / coverage | `SecurityPlatformAdapter.ts:22–49` limits `ProtectionStatus.enforcementMethod` to `dns_filter/content_blocker/none/simulated`. GuardDog supports selective VPN packet drops; `EnforcementEvidence.mechanism` separately allows `vpn_service/packet_filter`. `GuardDogExpoAdapters.kt:53–56` does not claim general DNS/DoH/DoT coverage. | Provide a truthful, contract-preserving field-by-field mapping. Never label a selective packet filter as the legacy DNS filter or set `none` while claiming operational enforcement merely to satisfy types. If no truthful mapping exists, stop and request a separately approved contract decision; the current requirement forbids changing it. | OPEN — blocks claiming contract-complete integration |
| D3 — configuration / trust / signed rules | Frozen `GuardDogExpoModule.kt:170–186` requires configuration, live consent, an accepted signed bundle, verified controlled host/IP binding and rule authority before starting. `BridgeProtectionConfigRecord` labels the controlled inputs test-environment setup. `TrustedKeyRegistry.kt:28–32` exposes a pinned **test-only** default key, which the bridge constructs at line 74. | Identify an approved controlled endpoint and legitimate signed bundles/trust inputs, owners and delivery/reload behavior. A public test key is not production trust. Do not disable signature/authority checks, fabricate a bundle, silently ship certification configuration, or patch frozen source. If public APIs cannot support approved production trust, escalate to engine owner / a separate approved stage. | OPEN — start cannot be honestly promised without inputs |
| D4 — packet evidence translation | Native `BlockedThreatEvidence` contains raw observation time/protocol/ports/layer. `BridgeSecurityEventRecord.kt` does not export those fields, including `enforcementMechanism`; `GuardDogExpoAdapters.toRecord` exports a reduced event. Core emits a native event time, not the original raw packet timestamp. Public module surface streams events but has no polling evidence API. | Specify mapping/known limitations: stable `enforcementEvidenceId`, event/source, ruleset/version/rule, destination and times; distinguish native event time from raw observation time. Do not invent exact protocol/port/attribution or infer a mechanism solely from destination. Approve bounded buffering/replay behavior; if indispensable provenance is unavailable through the frozen surface, verified output stays blocked pending a compatible design. | OPEN |
| D5 — manual block/unblock semantics | Existing Apollo exposes `blockDestination/unblockDestination`. Frozen bridge exposes accepted signed rule bundles and **ALLOW-only** Website Gate overrides, not a general arbitrary-host block setter; `analyzeUrl` reads the M1 rule slot, not the separate Website Gate slot. | Map every method, including unsupported cases, without signing rules on-device or treating rule acceptance/removing an allow as a packet drop. Explicitly approve any opt-in-stage limitations; no silent regression for legacy/default users. | OPEN |
| D6 — lifecycle / fallback boundary | `startProtection/stopProtection` return snapshots immediately after dispatching service commands. A returned Promise, permission grant or visible notification is not OS proof of a live/closed TUN. Existing selector has only mock/native, not a GuardDog/legacy switch. | Define time-bounded observation of ACTIVE + actual TUN/route ownership and stopped/recovered state; handle deny/revoke/conflicting VPN/errors. Implement and test explicit build-time rollback selection, not silent automatic fallback. | OPEN |

These are **plan-review observations**, not a new security audit and not invented IDs or
severity assignments for the user's prior P0 review. They must not be marked solved merely
because the native libraries compile or the app launches.

## 4. Acceptance checks — separate evidence gates

Use `STAGE1D_DEVICE_TEST_RECORD_TEMPLATE.md` for **each** device run. Every new run requires
the exact source commit and APK build identifier, plus APK SHA-256, package/versionCode,
device/OS, tester/time, selected engine, frozen-manifest result, configured scope and rule
provenance. Missing mandatory build linkage makes that new run **INCOMPLETE**, not PASS.
Do not pool native positive/negative evidence from different APKs. Mock/Expo Go is an
additional, separately labelled control, never a substitute for a native acceptance row. Keep sensitive content/private
keys out of artifacts; only authorized controlled targets and necessary packet metadata.

| Gate | Expected evidence | Pass / fail criteria |
|---|---|---|
| A0 — immutable/build checks | Frozen hashes, unchanged contract hashes, installed dependency report, focused test output, actual native build log | 91/91 frozen files and both public contract files unchanged; no native duplicates; selected build compiles with no unauthorized changes. Any mismatch/duplicate fails. |
| A1 — launch | Fresh APK identity + physical-device launch observation | Baseline Pixel 10 launch remains PASS by user confirmation. A changed Stage 1D APK must separately launch without a crash, unintended VPN start or false protection claim. |
| A2 — protection start | Request timestamp; live OS consent; actual GuardDog lifecycle/TUN/route snapshot; unrelated connectivity check | ACTIVE only after real enforcement mechanism is observed. Start acknowledgement alone fails to prove operational status. No second/legacy active engine. Denied permission/start failure stays non-operational with a reason. **Zero block claims without traffic.** |
| A3 — protection stop / recovery | Stop request and subsequent actual inactive/TUN-closed/route-removed evidence; fresh connection to controlled destination | No lingering GuardDog route/drop path; live status agrees. Stop acknowledgement alone is insufficient. Revocation/process-loss/start-stop races and foreground-service failure must not leave false operational state. |
| A4 — actual packet block | Authorized rule/bundle + baseline connection; real TUN packet observation and intentional drop; matching native event/evidence ID, destination and times; existing sync/backend result | **Only PASS after a newly observed packet was intentionally blocked by GuardDog**, correlated end-to-end. Browser failure, DNS sinkhole/rule binding, a counter without event linkage or a native capability/state claim is not sufficient. Preserve narrower actual scope. |
| A5 — product truth / negative paths | Same APK, native events plus existing Patrol/UI/backend observations for all negative cases below | No THREAT_BLOCKED / “Apollo is biting” without A4-quality evidence. Repeat receipt of the same native evidence does not create a new incident. Existing client/server gates are not weakened. |
| A6 — explicit rollback | New rollback-build identity + completed A3 + legacy selection / lifecycle evidence | Legacy path works again with no simultaneous engines, no data wipe, no replayed fake block evidence and no claim that rollback itself proves enforcement. |

**Mandatory negative cases for A5:** manual block tap with no traffic; accepted/matched rule
only; DNS sinkhole binding only (no later packet); permission granted only; start/config/ACTIVE
only; failed resolution/unrelated outage; disallowed/unknown destination; stopped/failed/revoked
runtime; malformed or missing native block provenance; replayed event ID; mismatch of known
device/destination/rule correlation; ignored local-analysis/lifecycle/rule-verifier events;
and mock/Expo Go (never enforcement). Negative checks must remain negative even if a client
boolean says `verified_block=true` without eligible evidence.

Existing frontend `isVerifiedEnforcement` and backend `_derive_verified_block` check evidence
fields; the server is **not** an independent packet observer or cryptographic device attestor.
Leaving those functions unchanged does not establish tamper/replay/source-authentication
remediation. Any such original review findings remain in the separate P0 backlog until their
specific fixes and negative tests are verified. Do not conflate source-event translation with
a new end-to-end attestation guarantee.

Focused regression commands (future implementation verification, not executed as native proof here):

```sh
cd frontend
node scripts/native-dependency-guard.cjs
yarn security:preflight
node --test tests/adapterContract.test.ts tests/platformCapability.test.ts tests/protectionTruth.test.ts tests/enforcementEvidenceSync.test.ts tests/securityConfig.test.ts tests/securityBoot.test.ts
# Add the four proposed GuardDog test files after implementation.
# Separately: backend/tests/test_enforcement_evidence_gate.py, unchanged-gate regression only.
```

The legacy `android-physical-device-acceptance.md` remains historical evidence guidance, not
a filled GuardDog result. Its DNS/NXDOMAIN positive path cannot be reused as proof of a later
GuardDog packet drop. All required new rows must be exercised, not inferred; NOT RUN / missing
evidence is not PASS. Scope characterization (e.g. DoH/DoT bypass) must report observed limits.

## 5. Safeguards and planned operational rollback

1. Before/after each implementation change and candidate build, verify the 91-file frozen
   manifest from `frontend/packages` with `sha256sum --check ../../docs/APOLLO_STAGE1B_SHA256_MANIFEST.txt`.
   Stop on any mismatch, extra unapproved vendor file or altered public contract. Do not repair
   the frozen engine in this workspace; return issues to its owner.
2. Preserve the existing adapter and both legacy source files. Native dependency guard remains
   mandatory; preserve SVG 15.15.4. No automatic startup/cutover or automatic fallback.
3. Before the first opt-in run, record a known-good **APK artifact**, signing identity and
   configuration. The prior launch PASS lacks an exact APK/build identifier; obtain that
   linkage for rollback rather than assigning it the current Git HEAD by assumption.
4. To roll back after a failed opt-in test: stop GuardDog explicitly and prove A3 (TUN/routes
   removed). If stop cannot be verified, mark recovery failed, report degraded state and do not
   auto-start the other engine. Record the failure before restoring operation.
5. Select `legacy` in the approved build configuration, rebuild with compatible app signing /
   versioning, install the rollback APK without silently deleting app data, and record its
   new source/build/hash. A config edit does not alter an APK already installed on the phone.
6. Re-run launch and legacy lifecycle/connectivity checks. Never run both VPN services at once;
   preserve bundle anti-rollback state and evidence provenance. No engine deletion, schema
   migration, Git history reset or credentials change is needed for this planned rollback.

Public contract SHA-256 baselines captured for this review:

```text
0979d82835d44a9453cedbf51c9067bc559c809f1fda1678fd79ae1a1ccca872  frontend/src/security/SecurityPlatformAdapter.ts
a51bbfa95b6c88984bd1cf2f45da3db449f568732eae16c17824f6af956a3426  frontend/src/security/PlatformCapabilityProfile.ts
```

## 6. P0 tracking and exit from this review

The separate tracker is `STAGE1D_P0_REMEDIATION_BACKLOG.md`. No prior P0 is closed by this plan,
the SVG fix, the duplicate guard or the launch PASS. We cannot truthfully list each prior
finding until the original finding list/report is supplied; this is explicitly **UNRESOLVED**.

Before any Stage 1D implementation: obtain the original P0 list; settle D1–D6 with exact method /
field mappings, inputs and revised files if necessary; confirm acceptance/rollback ownership;
and obtain implementation approval. P0 fixes remain separate tracked work and may not be
silently bundled or declared resolved. This does not reopen the passed Stage 1C.1 launch gate.