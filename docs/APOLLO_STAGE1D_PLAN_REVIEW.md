# Stage 1D — implementation / acceptance plan review

## Acceptance-candidate implementation addendum — iteration 66

The user authorized independent Stage 1D **test-candidate** implementation while keeping production
certification separate. This addendum supersedes historical “NOT STARTED” wording for candidate work
only; it does not approve production cutover.

- **D1 candidate implemented:** `ApolloGuardDogCandidateRuntime` is the single candidate owner over
  frozen core/VPN. `guarddog-expo-module` is excluded from autolinking. Production remains legacy.
- **D2 candidate implemented:** additive `packet_filter` method and `guarddog_acceptance` selector;
  security policy rejects the candidate in production or without native mode.
- **D3 acceptance provisioning implemented, fixture unavailable:** pinned frozen test public key is
  retained. No reachable git object contains the referenced signed bundle or matching private test
  signer. The isolated provisioner checks key match, real clock, ownership, exact dedicated DNS/IP
  and HTTPS baseline without writing private material. T1–T5 production certification stays OPEN.
- **D4 candidate implemented:** Apollo wraps the existing reporter, captures original packet fields,
  invokes the engine, and only correlates a genuine engine event with matching evidence ID and IP.
  No port/time/protocol defaults are inferred. Native inbox → local Patrol → durable delivery → native
  acknowledgement ordering is implemented.
- **D5/D6 candidate implemented:** no manual unsigned block controls; lifecycle derives from frozen
  `VpnStateRepository`/service state. One consolidated native acceptance function records APK
  provenance, baseline, ACTIVE, fresh SYN-drop, evidence, stop/recovery and after-stop success.
- **Packaging:** Expo Android prebuild passes; generated project includes `guarddog-core` and
  `guarddog-vpn`, with no frozen Expo bridge. TypeScript/static/P0 suites pass and frozen SHA is 91/91.
  Managed Android build is not executable inside this workspace (`eas` policy block; no local
  Java/Android toolchain), so no APK/build ID or physical Pixel run is claimed.

Detailed implementation/provisioning evidence: `STAGE1D_ACCEPTANCE_CANDIDATE.md` and
`test_reports/iteration_66.json`.

**Review date:** 2026-09-20. **Application source baseline inspected:**
`0154e186fb4601495c3f4468f9a89ae0d18ce1f1`.

**Stage 1C.1 launch: PASS (user-confirmed fresh APK on Pixel 10).**
**Historical review state:** implementation was NOT STARTED when this plan was written. The test-only
candidate described above is now implemented; production certification/cutover remains unapproved.

**Revision 2:** incorporates the user's six named P0 findings, six recommended design
resolutions, and the original `reviews/Apollo_Review_2026-09-20.md` (reviewed commit
`da60c0372650dead26caeb25c458f8ca7cebd6a2`). Intake is resolved and the separate P0 remediation
has since reached **six VERIFIED CLOSED findings** (`test_reports/iteration_64.json`). Stage 1D,
native runtime acceptance and production-default cutover remain unapproved and NOT STARTED.

**Focused D1/D3 follow-up:** `STAGE1D_D1_D3_OWNERSHIP_TRUST_DESIGN.md` now provides the
concrete feasibility verdict and native alternative. The original JS-facade/frozen-bridge
route cannot inject production trust. The proposed alternative excludes that bridge from
Android registration and uses a single Apollo native owner of the public frozen core/VPN SDK.
This is a scope/topology change requiring approval, **not proof that both modules coexist
safely**. Its exact conditional files replace the earlier JS-facade ownership scope only if
approved. The follow-up's APK-only bundle-key rotation proposal was inconsistent with Stage 0
and is **withdrawn**: `STAGE1D_D3_SIGNED_MANIFEST_RECONCILIATION.md` restores primary/recovery
roots, runtime signed manifests and the agreed offline behavior. D1/D3 remain OPEN for
approval/certified capability evidence; D2/D4–D6 are unchanged.

## 1. Review result and source limitations

The repository contains architectural direction in `APOLLO_PROTECTION_STAGE0.md` §§2–6,
`android-consolidation-plan.md` §§4–6, and a type-only
`frontend/src/security/future/GuardDogSecurityAdapter.ts`. It does **not** contain a previously
agreed, file-by-file Stage 1D implementation plan before this proposal. The original P0 report
has now been supplied and archived unchanged in `reviews/Apollo_Review_2026-09-20.md`.
Its findings 1–6 are tracked as the user's P0-01–P0-06. Earlier “unidentified” statements are
superseded: identification is complete, remediation is not. Original tests/CI statements are
attributed to that review, not represented as newly executed tests in this revision.

The implementation scope below is therefore a **proposed developer response**, grounded in
the present source, not a claim that an external developer already agreed or implemented it.
It is **not yet approval-ready**: the user's recommended directions are recorded in §3, but
the six detailed design decisions and required acceptance dependencies are still open.
`STAGE1D_P0_REMEDIATION_BACKLOG.md` now lists each actual finding separately. No runtime code changes were made.

| User requirement | Review disposition |
|---|---|
| Preserve frozen GuardDog | Satisfied for this review: all 91 hashes match; mandatory future before/after gate |
| Preserve truthful adapter contract | Current contract unchanged; a minimal separately reviewed `packet_filter` extension is proposed in CE-01. If not approved, defer incompatible integration—never mislabel selective filtering |
| Source SHA + APK build identifier per device run | Mandatory in new record template; historical launch PASS is retained, not retroactively given invented provenance |
| Separate launch, start/stop and real packet blocking | Separate gates defined below; only historical launch is passed |
| Biting only after observed intentional packet drop | Mandatory native-to-product chain; DNS/rule/configuration events alone expressly excluded |
| Keep each P0 open until verified | Satisfied: six individually verified closed entries; software closure does not substitute for native blocking or notification-delivery proof |

## 2. Proposed Stage 1D scope — exact candidate changes

**Goal:** an Android-only, opt-in GuardDog-backed implementation behind an explicitly approved,
truthful Apollo contract. The current enum cannot represent selective packet filtering;
`STAGE1D_CONTRACT_EXTENSION_PROPOSAL.md` must be separately reviewed or the incompatible
integration deferred. Leave the existing legacy Android adapter available and default-selected during
acceptance. No broad consumer cutover, new UI or Higgins behavior. Product code still imports
only `securityAdapter`; no screen, store or backend calls GuardDog directly.

Proposed ownership path (requires explicit confirmation under D1):

```text
approved SecurityPlatformAdapter (current contract unchanged; CE-01 pending)
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
| `frontend/src/security/future/GuardDogSecurityAdapter.ts` | Replace the type-only placeholder only after D1–D6 and the required contract decision are approved; preserve non-enforcement OS/device functionality. No selective-filter mapping to dns_filter/none/simulated and no copied legacy DNS counters/status. |
| `frontend/src/security/guarddog/translateGuardDogState.ts` (new) | Pure permission/lifecycle/status/capability translation; distinguish intent, command acknowledgement and observed live enforcement. D2 must resolve the mechanism representation first. |
| `frontend/src/security/guarddog/translateGuardDogEvidence.ts` (new) | Accept only well-formed genuine native block events; retain provenance and stable evidence ID. Unknown/absent packet fields stay unknown/null; missing indispensable provenance is rejected. D4 must settle exact field mapping. |
| `frontend/src/security/securityAdapter.ts` | Android-native-only selection; legacy remains default; selected GuardDog missing/unavailable must not silently fall back to legacy or simulated protection. iOS and explicit mock selection unchanged. |
| `frontend/src/security/securityConfig.ts` | Validate a proposed private build-time selector `EXPO_PUBLIC_ANDROID_ENFORCEMENT_ENGINE=legacy\|guarddog`; retain all current production/security requirements. New selector is proposed, not present today. |
| `frontend/src/config/appEnvironment.ts` | Resolve that selector through the app's configuration boundary, defaulting to legacy; no secrets or signer private keys. |
| `frontend/scripts/security-preflight.mjs` | Validate the same selector/configuration rules; fail any production GuardDog selection backed only by test trust. Preserve dependency guard and existing EAS lifecycle handling. Exact approved trust/build inputs remain D3 work. |
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
- No public contract changes under this plan-only task. CE-01 proposes one enum extension and
  its necessary exhaustive label/test handling as a **separately reviewed change**, not an
  implied Stage 1D permission. Other evidence shapes/method signatures stay unchanged unless
  independently approved. If no truthful approved contract is available, defer integration.
- No edits/removal/expansion of `ApolloDnsVpnService.kt`, `DnsPacket.kt`, the existing iOS adapter,
  device/call/message services, `NativeSecurityAdapters.ts` or the existing public native bridge.
- No Home/Guard/Patrol/Higgins redesign; no `ApolloContext.tsx`, state machine, evidence sync or
  backend Biting-gate changes bundled into this stage. Necessary remediation gets its own scope.
- No new signing backend, new embedded private/test signing keys, certification fixture injection,
  production trust redesign, general M2 Website Gate cutover, iOS/desktop engine integration,
  dependency version changes or removal of the SVG 15.15.4 pin.
- No automatic VPN activation, two simultaneously active VPN engines, production default flip,
  or claim of full-device/DoH/DoT/QUIC/app-attribution coverage.

## 3. Six design decisions — reviewer recommendations recorded, details still OPEN

| ID | Source-backed gap | Required developer decision / pass condition | Status |
|---|---|---|---|
| D1 — runtime ownership | Frozen bridge privately constructs the engine/writes globals; live readers capture a reporter, so adding another owner is unsafe even with one VPN. | Concrete owner/lifecycle/publishing design is in `STAGE1D_D1_D3_OWNERSHIP_TRUST_DESIGN.md`: proposed `ApolloGuardDogRuntime`, one engine per process, scoped consumer subscriptions, vendor Expo bridge excluded. This changes the both-modules topology; if both must remain, defer the production bridge route. Build/runtime prohibition and owner-count proof are specified, not yet performed. | OPEN — concrete design provided; topology approval/native proof outstanding |
| D2 — status mechanism / coverage | Current `ProtectionStatus.enforcementMethod` cannot represent selective packet filtering; broader evidence mechanisms do not fix this status enum. | Never coerce to dns_filter/none/simulated. CE-01 proposes `packet_filter` with exhaustive consumer handling; separately review/approve that minimal change or defer incompatible integration. Truthful reporting overrides preserving an inaccurate enum. | OPEN — CE-01 not approved/implemented |
| D3 — configuration / trust / signed rules | Registry/bundle-verification primitives exist, but the frozen bridge has test trust and no certified primary/recovery manifest/authority controller is exposed. | `STAGE1D_D3_SIGNED_MANIFEST_RECONCILIATION.md` explicitly withdraws APK-only bundle-key rotation. Pinned roots verify runtime signed manifests; one owner stages/applies key changes and revalidates existing M1/M2 authority. Known expiry, learned revocation and offline-valid-cache operation have separate outcomes. Engine-owner T1–T5 semantics/proofs are requested, not implemented. | OPEN — policy conflict corrected; certified trust/transition interfaces and production approval outstanding |
| D4 — packet evidence translation | Bridge exports reduced native events, omitting original raw packet observation time/protocol/ports/mechanism; no polling evidence API exists. | Buffer genuine native events with original evidence IDs/provenance; distinguish receipt from delivery. Specify replay, dedup, retention and privacy rules below. Missing fields remain unknown; never manufacture packet details. P0-04/05 separately gate privacy-safe durable delivery. | OPEN — field mapping and explicit limits/retention choices pending |
| D5 — manual block/unblock semantics | Signed bundles and ALLOW-only Website Gate overrides are not arbitrary block/unblock setters; URL analysis reads the M1 slot. | Publish the supported-operation matrix below. Unsupported actions return honest unsuccessful results without side effects. **Never silently translate unblock to an allow override** that bypasses approved threat policy. | OPEN — exact adapter/caller failure mapping pending |
| D6 — lifecycle / fallback boundary | Start/stop return command-time snapshots, not completed lifecycle observations. | Await bounded fresh lifecycle/TUN/route observations. Acknowledgement is insufficient; timeout or contradictory observations stay explicitly UNRESOLVED. Verify recovery separately; no silent fallback or fabricated stopped/healthy state. P0-02 independently blocks consumer-health sign-off. | OPEN — observation/deadline/recovery design pending |

Recording recommendations does not resolve D1–D6 or authorize implementation. The six P0
findings are now separately identified; the decision IDs are not their replacements.

### D1/D3: ownership and trust deliverables before approval

- Identify the single owner and exact public API path; attach an initialization/reference /
  subscription lifecycle diagram. A facade must not create a second engine or overwrite the
  bridge's global runtime references. Loading both modules must be tested, not only starting one VPN.
- Define test-only acceptance build identity, controlled targets, signer/public key IDs, bundle
  authority, configuration and explicit approval. None has been authorized by this revision.
- Production follows Stage 0 §§9–10: pinned PRIMARY/RECOVERY roots authenticate runtime
  signed manifests; ordinary bundle keys rotate through those manifests, not mandatory APK
  replacement. A named engine-side trust owner must provide manifest/recovery verification,
  trust/bundle ledgers, current-authority transitions and tested expiry/revocation behavior.
  Private signing keys never belong in the app. Offline revocation delay is acknowledged;
  valid cached known-bad rules continue and unknown traffic fails open.
- The current test registry is not that production construction. If it cannot be replaced
  through approved public interfaces without competing owners, defer production integration
  and return the issue to the engine owner; do not patch the frozen packages or waive checks.

### D4: required event lifecycle and privacy policy

- Native `enforcementEvidenceId` and source provenance are immutable; keep original native
  event ID/time and available ruleset/version/rule/destination metadata. App receipt time is a
  separate fact, never substituted for the unavailable raw packet observation time.
- Deduplication must retain the original identity scoped to the authenticated device and
  native origin; transport retries reuse it. Replayed/previously delivered evidence cannot
  create a new drop or make stale protection fresh. Never regenerate an ID to force delivery.
- Distinguish native receipt, privacy validation, pending delivery, server persistence and
  delivery acknowledgement. Marking “seen locally” is **not** a successful upload.
- Specify finite capacity/size/TTL, restart behavior, replay cursor, acknowledgement retention,
  deletion and overflow semantics before approval. **Exact limits are still OPEN**; no silent
  eviction of pending uploads or invented reconstruction after process loss. Failures/loss
  must be visible; durable outbox/idempotent delivery is P0-05 remediation, not this buffer alone.
- Retain/upload only the approved minimal schema, with nested value checks. Missing packet
  data remains unknown; no payload bodies, credentials, sensitive URL queries or call numbers
  hidden in destination/headline fields. Privacy/deletion choices require P0-04 coordination.

### D5: supported operation matrix (frozen SDK surface, not a new capability promise)

| Operation | Actual surface / limitation | Planned honest behavior |
|---|---|---|
| Initialization/status/capabilities | Existing bridge owns engine and exports snapshots/capabilities | Bind to that approved owner; report actual observed scope, not legacy/full-device capability |
| Start/stop | Commands exist, completion is asynchronous | Observe completion under D6; acknowledgement/timeout is not success |
| Accept rules | Signed rule bundle verification exists; slots/authority differ | Only authorized bundles/configuration; acceptance is not a packet drop |
| Arbitrary blockDestination | No general arbitrary-host block setter equivalent | Unsuccessful/unsupported result, no verified evidence and no pretend rule insertion; qualify any explicitly approved supported subset |
| Arbitrary unblockDestination | No universal removal operation equivalent | Unsuccessful/unsupported if not representable. Do not substitute an ALLOW override or stop all protection silently |
| Website Gate allow override | Separate ALLOW-only API with policy implications | Not a generic unblock implementation. Excluded unless separately approved with threat-policy behavior and truthful caller handling |
| URL analysis | Bridge analysis uses the M1 rule slot | State actual source/limitations; do not claim Website Gate/full threat intelligence or safe opening from an allow/no-match |
| Evidence polling | Bridge streams genuine native events | Approved bounded buffer only, preserving provenance; no synthetic packet outcomes |

Exact unsuccessful return shapes and existing caller behavior must be checked against the
approved contract: an unsupported result must not still cause the UI/store to mark success.
If that requires consumer changes, revise the scoped plan separately instead of hiding them.

### D6: bounded completion and recovery contract

Define start/stop deadlines, observation cadence, fresh-observation thresholds and contradictory
state handling before approval (**numeric thresholds and observer still OPEN**). Record request,
acknowledgement, each observation and completion/deadline independently. Start requires fresh
permission + owner/lifecycle + actual TUN/routes; stop requires actual release and restored
connectivity. On timeout/conflict, keep **UNRESOLVED** with last-known evidence and degradation
reason; do not claim stopped, active, recovered or fresh from a command return or old block.
Recovery has its own observations/test result. Consumer stale-health defects remain P0-02.

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
| A0 — immutable/build checks | Frozen hashes, approved contract revision/hashes, native dependency report, focused tests, actual native build log; D1 dual-module ownership trace | 91/91 frozen files unchanged; current contracts unchanged unless CE-01 separately approved and explicitly rebaselined; no native duplicates/competing owners or unauthorized changes. |
| A1 — launch | Fresh APK identity + physical-device launch observation | Baseline Pixel 10 launch remains PASS by user confirmation. A changed Stage 1D APK must separately launch without a crash, unintended VPN start or false protection claim. |
| A2 — protection start | Request/ack timestamps; bounded fresh consent/lifecycle/TUN/route observations; unrelated connectivity check | ACTIVE only after actual mechanism observed. One explicit owner even when both modules load; no second active VPN. Timeout/conflicting observations are UNRESOLVED, not successful start. **Zero block claims without traffic.** |
| A3 — protection stop / recovery | Stop request/ack plus bounded inactive/TUN-closed/route-removed observations; separately observed connection recovery | Actual release and recovery, not acknowledgement. Timeout/contradiction remains UNRESOLVED. P0-02 software remediation is closed; physical lifecycle evidence is still required here. |
| A4N — native intentional packet block | Authorized rule/bundle + baseline connection; real TUN packet observation and intentional drop; matching native event/evidence ID, destination and available times | **PASS only for an observed intentional native packet drop.** Can pass independently of upload failures. Browser failure, DNS binding/rule match or uncorrelated counter is insufficient. Label test-only scope/trust; no production claim. |
| A4E — end-to-end evidence delivery | A4N evidence → mapper → narrow privacy egress → authenticated API → persisted Patrol → eligible notification; offline/restart retry and replay | P0-04/05 software paths are verified and this row is **UNBLOCKED, NOT PASSED**. A4N PASS, local visibility or mapper-only tests cannot satisfy it; require actual device persistence/acknowledgement and observed eligible notification delivery. |
| A5 — product truth / negative paths | Same APK, native and consumer/backend observations; explicit call-rejection and stale-health cases | P0-02/03/05 software negatives are verified; this native row remains **NOT RUN**. No packet-backed THREAT_BLOCKED/Biting without A4N-quality evidence; call rejection is always non-packet. |
| A6 — explicit rollback | New rollback-build identity + completed A3 + legacy selection / lifecycle evidence | Legacy path works again with no simultaneous engines, no data wipe, no replayed fake block evidence and no claim that rollback itself proves enforcement. |

**Mandatory negative cases for A5:** **call rejection/call-screening evidence (submitted or
completed; never a packet drop)**; manual block tap with no traffic; accepted/matched rule
only; DNS sinkhole binding only (no later packet); permission granted only; start/config/ACTIVE
only; failed resolution/unrelated outage; disallowed/unknown destination; stopped/failed/revoked
runtime; malformed or missing native block provenance; replayed event ID; mismatch of known
device/destination/rule correlation; ignored local-analysis/lifecycle/rule-verifier events;
and mock/Expo Go (never enforcement). Negative checks must remain negative even if a client
boolean says `verified_block=true` without eligible packet evidence. Also exercise old verified
block + lost/revoked protection, expired observation, pre-resolution-only checks and failed
foreground probes: historic enforcement must not hide current loss of protection (P0-02).

Existing frontend `isVerifiedEnforcement` and backend `_derive_verified_block` check evidence
fields; the server is **not** an independent packet observer or cryptographic device attestor.
Leaving them unchanged does not establish packet-only classification or reliable delivery:
the original review traces accepted `call_screening` to biting (P0-03) and privacy rejection
of uploaded evidence (P0-05). Those require separate verified fixes; do not claim an intact
full pipeline merely because no backend code is touched here. These field gates are also not
a new cryptographic attestation guarantee; the six supplied findings are not silently expanded
or replaced by a speculative authentication finding.

### Acceptance dependency map

| Open finding | Acceptance consequence |
|---|---|
| P0-01 | VERIFIED CLOSED — hardened outbound transport; native integration did not infer closure |
| P0-02 | VERIFIED CLOSED — software freshness/recovery; physical lifecycle observation remains separate |
| P0-03 | VERIFIED CLOSED — call screening remains non-packet throughout consumer/backend path |
| P0-04 | VERIFIED CLOSED — local-first and nested evidence privacy boundary enforced |
| P0-05 | VERIFIED CLOSED — durable/idempotent narrow evidence path; A4E device observation remains separate |
| P0-06 | VERIFIED CLOSED — limited/unread files receive no safety authorization |

No overall Stage 1D/end-to-end PASS may silently ignore blocked rows. Native-only results
must be labelled native-only. Test-only acceptance and production approval are separate.

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
   Stop on any mismatch, extra unapproved vendor file or unapproved contract change. CE-01,
   if separately approved later, requires explicit new contract hashes and compatibility tests;
   frozen GuardDog hashes never change under that exception. Do not repair
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

The separate tracker is `STAGE1D_P0_REMEDIATION_BACKLOG.md`: **zero findings open, six verified
closed**. The original remains archived, including its P1/P2 recommendations. Closure comes from
the separate remediation and iterations 62–64, not this plan, SVG fix, dependency guard or launch PASS.

Before any Stage 1D implementation: settle D1–D6 with exact method /
field mappings, inputs and revised files if necessary; confirm acceptance/rollback ownership;
and obtain implementation approval. P0 remediation is separately verified closed. A4E and the
native call/lifecycle rows still require physical-device evidence; software closure does not pass
them automatically. This does not reopen the passed Stage 1C.1 launch gate or approve a
production-default cutover.

## 7. Workspace / GitHub synchronization — distinct evidence

The original review concerns GitHub main at `da60c0372650dead26caeb25c458f8ca7cebd6a2`.
Read-only `git ls-remote https://github.com/zelnix/Apollo.git refs/heads/main` on 2026-09-20
confirmed that remote SHA. The workspace had saved the earlier plan at
`7262e4a1732ebebe69e89ff183b7e18b93cebb21`; local save was not proof of a GitHub push.

**Revision 2 synchronization was subsequently VERIFIED:** GitHub main
`956db060ec6905877371eeaeb703286f0b9c8f81` matched all eight handoff files byte-for-byte,
including the original review hash. That verification supersedes the earlier “sync pending”
wording and is not undone by later design work. No direct push was performed by the agent.

The first focused D1/D3 design was subsequently user-verified on GitHub at `09bb101`.
The later D3 policy reconciliation is new workspace documentation and needs its own save /
remote verification. Do not treat either earlier sync as verification of future revisions.
Stage 1D stays unstarted regardless of synchronization.