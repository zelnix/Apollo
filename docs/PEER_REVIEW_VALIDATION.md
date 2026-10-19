# Peer Review Validation & Remediation Plan

**Review of:** Peer review against commit `e82ceed4`
**Validated by:** Source code inspection of all cited locations
**Date:** 2026-10-04

---

## Finding-by-Finding Validation

### HIGH SEVERITY

#### 1. URL reputation checks assess root instead of submitted page
**VALID ✅**

Confirmed in:
- `backend/services/intel.py:24-39` — `sanitize_url()` strips path, returns `https://{host}/`
- `backend/services/intel.py:147-160` — `run_intel_check()` feeds the stripped URL
- `frontend/src/domain/privacy.ts:202-210` — `minimalIndicator()` extracts origin only
- `backend/routers/analysis.py:220` — message URLs stripped before assessment

The trust digest is host-based. Users are told they trusted an "exact link" but actually trusted the entire origin. Page-specific threats (e.g., phishing landing pages vs. clean homepage) share the same reputation.

**Fixable in backend + frontend: YES**

---

#### 2. Refreshing unchanged production rules clears live authorisation
**VALID ✅**

Confirmed in:
- `ApolloGuardDogProductionRuntime.kt:126-157` — When `changed` is false at line 142, lines 143-145 correctly skip stop/start. But lines 146-148 unconditionally call `acceptRuleBundle(raw)` and `acceptWebsiteGateRuleBundle(raw)`.
- `GuardDogSDKEngine.kt:91` — `authorization = null` runs unconditionally in `acceptRuleBundle()`
- `GuardDogSDKEngine.kt:137` — `websiteGateBindings.clear()` runs unconditionally in `acceptWebsiteGateRuleBundle()`

The runtime correctly guards the VPN stop/start cycle but the SDK engine methods unconditionally clear authorization and bindings on every accept call, even for identical bundles.

**Fixable in native Kotlin (packages/): YES** — Add early return when bundle content is identical.

---

#### 3. Windows removes protection during every routine refresh
**VALID ✅**

Confirmed in `ApolloWfpService.cpp:225-232`:
```cpp
FwpmEngineClose0(engine); engine = nullptr;
filterIds.clear(); filterDomains.clear();
code = FwpmEngineOpen0(...);
installRules(engine);
```

Every 5 seconds, the entire WFP session is torn down and rebuilt. Filter gap is real.

**Fixable in desktop C++: YES** — Keep session open, update filters transactionally.

---

#### 4. Windows domain blocking blocks unrelated websites sharing an address
**VALID ✅**

Confirmed in `ApolloWfpService.cpp:142-193`:
- `addRemoteAddressFilter()` blocks by resolved IP address
- `onNetEvent()` attributes drops using the filter's domain label
- Shared hosting/CDN addresses would cause collateral blocking

**Fixable in desktop C++: YES** — Report actual scope; avoid broad address blocking for shared destinations.

---

#### 5. Sinkhole address reuse can attribute connection to wrong threat
**VALID ✅ (but documented/acknowledged)**

The code comments in `SinkholeBindingStore.kt:23-26` explicitly state:
> "two DIFFERENT hosts blocked at the same moment can momentarily contend for the same slot; the short TTL bounds the window, and worst case is a mis-attributed (not a missed or over-claimed) block"

The binding is consumed after one drop (`GuardDogSDKEngine.kt:227`), but DNS cache (30s TTL) means a later packet from the same cached answer can hit a reused address. Sticky assignment mitigates but doesn't eliminate.

**Fixable in native Kotlin: YES** — Reserve address for hostname through answer lifetime; refuse ambiguous attribution on pool exhaustion.

---

### MEDIUM SEVERITY

#### 6. DNS forwarder accepts unchecked response
**VALID ✅**

`ProtectedUdpDnsForwarder.kt:28-37` — Unconnected `DatagramSocket` receives from any sender without validating transaction ID, sender address, or response flags. A forged datagram reaching the socket would be accepted as the DNS answer.

**Fixable in native Kotlin: YES** — Connect socket to resolver endpoint; validate transaction ID.

---

#### 7. Slow DNS query stalls the entire packet-processing loop
**VALID ✅**

`TunPacketReader.kt:39-48` — DNS forwarding runs synchronously on the tunnel reader thread with a 3-second timeout. All tunnel traffic (including other DNS and blocked-connection drops) is blocked during the wait.

**Fixable in native Kotlin: YES** — Move DNS resolution off the reader thread.

---

#### 8. Clean end-of-stream can leave protection reported as active
**VALID ✅**

`TunPacketReader.kt:41-54` — A negative read breaks the loop silently. Only `IOException` invokes `onError()`. End-of-stream doesn't trigger the failure callback, leaving state observations stale.

**Fixable in native Kotlin: YES** — Treat unexpected end-of-stream as terminal failure.

---

#### 9. Gate status derives from permission/config, not observed health
**VALID ✅**

Confirmed in `frontend/src/domain/gates.ts:72-100`:
- Text: `running` from notification-access permission alone
- Link: defaults to `running` unless explicitly offline
- Account: defaults to `running` unless breach config is false
- iOS Message Filter: 30-day stale observation treated as current
- Android network: uses legacy preference, not production engine state

**Fixable in frontend TypeScript: YES**

---

#### 10. iOS rule preparation presented as blocking failure
**VALID ✅**

Confirmed:
- `ApolloSecurityModule.swift:132-143` — returns `verified: false` but ALSO returns `rulesPrepared`, `rulesReloaded`, `contentFilterEnabled`
- `ApolloContext.tsx:845-853` — only checks `verified_block`, ignores the rule preparation fields, takes failure branch

A successfully prepared and reloaded Safari rule produces "Block could not be verified."

**Fixable in frontend TypeScript: YES**

---

#### 11. Backend threat-list checking silently stops at 5,000 entries
**VALID ✅**

`intel.py:47` — `db.blocklist.find({"deleted_at": None}).to_list(5000)` loads up to 5,000 entries, linearly scans for a match, returns clear if not found. No indication of truncation.

**Fixable in backend: YES** — Use a targeted MongoDB query instead of loading the entire list.

---

#### 12. Temporary Email Gate failures permanently suppress reassessment
**VALID ✅**

`mailbox_monitor.py:56` — Receipts in `"failed"` state are skipped.
`mailbox_monitor.py:95` — `temporary_case_unavailable` sets state to `"failed"`.
A temporary backend outage permanently marks the message as failed, and it's never reconsidered.

**Fixable in backend: YES**

---

## Remediation Plan

### Phase 1: Backend + Frontend TypeScript (testable now)

| # | Finding | Fix | Effort |
|---|---|---|---|
| 1 | URL reputation strips path | Preserve URL path for reputation lookup; separate host-trust from URL-trust; report scope honestly | Medium |
| 9 | Gate status from permission/config | Separate readiness from observed processing health; preserve unknown states | Medium |
| 10 | iOS rule preparation ignored | Consume `rulesPrepared`, `rulesReloaded`, `contentFilterEnabled` fields; report success when rules accepted | Small |
| 11 | 5,000 entry blocklist cap | Replace linear scan with targeted MongoDB query for exact host and parent domains | Small |
| 12 | Temporary email failure permanent | Distinguish temporary vs. terminal failure states; make temporary failures retryable | Small |

### Phase 2: Native Kotlin — Android (requires dev build to verify)

| # | Finding | Fix | Effort |
|---|---|---|---|
| 2 | Identical bundle clears authorization | Early-return in SDK engine when bundle content is identical | Small |
| 5 | Sinkhole address reuse | Reserve address for hostname through DNS answer lifetime | Medium |
| 6 | DNS forwarder unchecked response | Connect socket to resolver; validate transaction ID | Small |
| 7 | Synchronous DNS stalls reader | Move resolver wait off tunnel reader thread | Medium |
| 8 | End-of-stream silent failure | Treat negative read as terminal failure | Small |

### Phase 3: Desktop C++ — Windows (separate build environment)

| # | Finding | Fix | Effort |
|---|---|---|---|
| 3 | WFP filter teardown every 5s | Keep session open; update filters transactionally | Medium |
| 4 | Shared-address collateral blocking | Report IP-level scope; avoid hostname claims from address filters | Medium |

---

## Summary

| Severity | Total | Valid | Invalid |
|---|---|---|---|
| High | 5 | 5 | 0 |
| Medium | 7 | 7 | 0 |
| **Total** | **12** | **12** | **0** |

All 12 findings are valid and confirmed against source code. No finding was fabricated or misrepresented.
The reviewer correctly identified the cited code locations, the defect mechanisms, and the impact scope.
