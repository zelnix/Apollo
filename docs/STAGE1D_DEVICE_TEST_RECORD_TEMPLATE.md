# Stage 1D — device evidence record (blank template)

Copy one record per candidate APK/device run; do not overwrite earlier artifacts.
**This template records no executed tests. Stage 1C.1's existing user-verified launch PASS is unchanged.**

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
| A0 integrity/build | Unchanged frozen source/contracts, zero duplicate native packages, native compile success | NOT RUN | |
| A1 launch | Fresh native launch; no crash/unrequested VPN/false protection claim | NOT RUN | |
| A2 start | Consent + actual GuardDog ACTIVE/TUN/route observation, one active engine; no block claim merely from starting | NOT RUN | |
| A3 stop | Actual inactive state, closed TUN/removed routes and fresh connection recovery | NOT RUN | |
| A4 observed intentional packet block | Rule authority → native packet observation → intentional drop → matching evidence/native event → existing Patrol/backend result | NOT RUN | |
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

## Packet-evidence linkage for A4

- Native enforcement evidence ID / native event ID / source / event type:
- Observed packet destination and available protocol/port/time metadata (unknown stays unknown):
- Intentional-drop mechanism and observed/drop counter deltas correlated to this event:
- Signed rule/ruleset/version and authorization applicable at drop time:
- Distinguish raw observation time, native event occurrence time and app receipt time:
- Translated Apollo evidence / correlation with destination and event:
- Backend request/response and resulting `verified_block` (not the client's requested Boolean):
- Existing UI/Patrol result (if integration stage exercises it; never a UI redesign):
- Negative-control artifacts and explicit verdict:

## Final disposition

- Launch: NOT RUN
- Protection start: NOT RUN
- Protection stop/recovery: NOT RUN
- Actual packet blocking: NOT RUN
- Negative truth-of-state cases: NOT RUN
- Rollback: NOT RUN
- Applicable P0 findings: link each original ID and its **separate** status/evidence; do not close via this template.
- Stage 1D acceptance decision / reviewer / UTC time: NOT SIGNED OFF