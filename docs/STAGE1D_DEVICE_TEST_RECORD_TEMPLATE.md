# Stage 1D — device evidence record (blank template)

Copy one record per candidate APK/device run; do not overwrite earlier artifacts.
**This template records no executed tests. Stage 1C.1's existing user-verified launch PASS is unchanged.**

Revision 2 uses the archived original review and six **OPEN** P0 findings. Intake is resolved,
not remediation. Design decisions D1–D6 and any CE-01 contract extension need separate approval;
no runtime changes, test-only acceptance build or production-default cutover is approved here.

## Mandatory run identity

| Field | Value |
|---|---|
| Run ID / tester / UTC start and end | NOT RECORDED |
| **Exact application source commit SHA** | REQUIRED |
| **APK build identifier** (build service's actual ID) | REQUIRED |
| APK filename / SHA-256 / build type | REQUIRED |
| Package / app version / versionCode / signing identity reference | REQUIRED — expected package `app.apollo.hwg`; never include signing secrets |
| Pixel model / Android version / API level | REQUIRED |
| Selected engine / configuration fingerprint | REQUIRED; do not infer from OS name |
| Explicit owner / both-native-modules initialization trace | REQUIRED; one active VPN alone does not prove one engine/subscription owner |
| Trust mode / test-only build authorization or approved production trust design | REQUIRED; frozen bridge test keys are never production trust |
| Approved contract revision / CE-01 decision | REQUIRED; current contract unchanged unless a separate approval and hash rebaseline are recorded |
| Frozen GuardDog source commit | `e5d11be912c76775c5a8b27b53218211484ca8bd` |
| Frozen 91-file manifest verification output | REQUIRED |
| Adapter/contract integrity and native dependency guard output | REQUIRED |
| Accepted ruleset / rule ID / bundle version / bundle hash / key ID | REQUIRED for start/block proof; public metadata only |
| Controlled target / authorized tester / relevant route scope | REQUIRED; do not substitute random third-party production targets |
| Backend source revision / test environment (when syncing) | REQUIRED for end-to-end evidence claims |
| Artifact locations | Native logs, lifecycle snapshots, evidence JSON, counter deltas, backend response and screenshots as applicable |

A missing source SHA or APK build ID makes **this new run INCOMPLETE**; never copy another
run's identifiers or the frozen certification APK hash as this app's APK hash. Run all required
native positive and negative cases against the same APK; label any mock/Expo Go control
separately rather than treating it as native proof. A scope-limited N/A needs an explicit reason
and does not satisfy a required acceptance row.

## Separate results — not a single “app works” checkbox

| Gate / scenario | Expected evidence / pass criterion | Result | Artifact / actual observation |
|---|---|---|---|
| A0 integrity/build | Frozen hashes unchanged, contract revision explicitly approved, zero native duplicates, native compile success, one owner when BOTH modules load | NOT RUN | |
| A1 launch | Fresh native launch; no crash/unrequested VPN/false protection claim | NOT RUN | |
| A2 start | Bounded fresh consent/ACTIVE/TUN/route observation, explicit single owner; acknowledgement not completion, timeout/contradiction UNRESOLVED | NOT RUN | |
| A3 stop/recovery | Bounded actual inactive/TUN-closed/route-removed observation plus separately verified connection recovery; timeout/contradiction UNRESOLVED | NOT RUN | |
| A4N native observed intentional packet block | Rule authority → real native packet observation → intentional drop → original evidence/native event, without depending on upload success | NOT RUN | |
| A4E end-to-end Patrol/backend delivery | A4N → mapper → narrow validated privacy egress → authenticated API → persisted Patrol → eligible notification; visible failures, offline/restart retry and idempotent replay | BLOCKED — P0-05 OPEN | Native-only PASS or local event visibility cannot pass this row; P0-04 governs the payload and P0-03 packet-only classification |
| A5 call rejection/call-screening | Submitted OR completed rejection must NEVER create packet-backed THREAT_BLOCKED/Biting through consumer/backend pipeline | BLOCKED — P0-03 OPEN | Full upload-path negative also depends on P0-05 remediation |
| A5 stale health/recovery | Old block cannot hide permission/service loss; expired/pre-resolution/failed observations cannot establish fresh recovery | BLOCKED — P0-02 OPEN | Native lifecycle proof alone does not close consumer-health finding |
| A5 manual tap / no traffic | No THREAT_BLOCKED or Biting | NOT RUN | |
| A5 rule accepted/matched only | No THREAT_BLOCKED or Biting | NOT RUN | |
| A5 DNS binding only | No THREAT_BLOCKED or Biting until a separate real packet is dropped | NOT RUN | |
| A5 consent/config/ACTIVE only | No THREAT_BLOCKED or Biting | NOT RUN | |
| A5 outage/resolution failure | No block evidence fabricated from a failed request | NOT RUN | |
| A5 unknown/non-authorized target | No GuardDog block claim for unrelated traffic; no broad coverage claim | NOT RUN | |
| A5 deny/revoke/conflicting VPN | Requested/operational accurately diverge; no false protection or block claim | NOT RUN | |
| A5 stopped/failed/missing provenance | No promotion to verified block | NOT RUN | |
| A5 mismatched destination/rule/device correlation | Rejected/not promoted | NOT RUN | |
| A5 event replay | Stable native evidence ID; no fabricated new block/duplicate incident | NOT RUN | |
| A5 local-analysis/lifecycle/verifier event | Never treated as packet evidence | NOT RUN | |
| A5 mock/Expo Go control (separate labelled control run) | No real block claim; not substituted for native positive-path proof | NOT RUN | |
| A6 explicit legacy rollback | GuardDog stopped/route removed, rebuilt rollback artifact identified, legacy selection confirmed, no dual engine/data wipe | NOT RUN | |
| Additional close/reopen/reboot/background tests | Record each explicitly; launch does not imply these passed | NOT RUN | |
| DoH/DoT/QUIC/IPv6 scope characterization | Record actual bypass/limitations; never assume broad protection | NOT RUN | |

## Native packet-evidence linkage for A4N

- Native enforcement evidence ID / native event ID / source / event type:
- Observed packet destination and available protocol/port/time metadata (unknown stays unknown):
- Intentional-drop mechanism and observed/drop counter deltas correlated to this event:
- Signed rule/ruleset/version and authorization applicable at drop time:
- Distinguish raw observation time, native event occurrence time and app receipt time:
- Unknown packet details explicitly identified (never manufactured by a translator):
- Trust/build scope labelled (approved test-only proof is not production trust acceptance):
- Negative-control artifacts and explicit verdict:

## Separate delivery linkage for A4E — blocked while P0-05 is OPEN

- Original native evidence identity carried unchanged into the approved Apollo mapping:
- Approved minimal nested payload, privacy validation and absence of raw call/personal content:
- Policy/schema failures distinguished visibly from transport failures:
- Pending outbox, restart/offline retry, stable dedup key and server acknowledgement/persistence:
- Backend request/response and resulting `verified_block` (not merely the client's Boolean):
- Eligible notification evidence; ineligible/undelivered cases recorded honestly:
- Full consumer-path call-rejection negative (P0-03), not just a mapper test:
- Separate P0-05 fix SHA, verified test/artifact links and closure decision:

P0-05 does not prevent a real native drop from being proved under A4N. Conversely, A4N does
not prove delivery or close P0-05. Copy this template for the actual candidate run and update
blocked dependencies only after their separate fixes/verification, never merely after launch.

## Final disposition

- Launch: NOT RUN
- Protection start: NOT RUN
- Protection stop/recovery: NOT RUN
- Actual native packet blocking (A4N): NOT RUN
- End-to-end Patrol/backend delivery (A4E): BLOCKED — P0-05 OPEN
- Call-rejection packet-only negative: BLOCKED — P0-03 OPEN
- Consumer health/freshness/recovery: BLOCKED — P0-02 OPEN
- Negative truth-of-state cases: NOT RUN
- Rollback: NOT RUN
- Applicable P0 findings: link each original ID and its **separate** status/evidence; do not close via this template.
- P0 intake: RESOLVED ONLY; P0-01–P0-06 all remain OPEN until separately verified.
- Stage 1D acceptance decision / reviewer / UTC time: NOT SIGNED OFF