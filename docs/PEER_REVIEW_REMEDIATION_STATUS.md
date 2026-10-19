# Peer Review Remediation Status

**Date:** 2026-10-04
**Scope:** All 12 findings from the peer review validated in PEER_REVIEW_VALIDATION.md

---

## Summary

| # | Finding | Severity | Status | File(s) Modified |
|---|---------|----------|--------|------------------|
| 1 | URL reputation strips path | HIGH | FIXED | `backend/services/intel.py`, `frontend/src/domain/privacy.ts` |
| 2 | Identical bundle clears authorization | HIGH | FIXED | `guarddog-core/.../GuardDogSDKEngine.kt` |
| 3 | WFP filter teardown every 5s | HIGH | FIXED | `desktop/native/windows-wfp/ApolloWfpService.cpp` |
| 4 | Shared-address collateral blocking | HIGH | FIXED | `desktop/native/windows-wfp/ApolloWfpService.cpp` |
| 5 | Sinkhole address reuse | HIGH | FIXED | `guarddog-vpn/.../SinkholeBindingStore.kt` |
| 6 | DNS forwarder unchecked response | MEDIUM | FIXED | `guarddog-vpn/.../ProtectedUdpDnsForwarder.kt` |
| 7 | Slow DNS stalls packet loop | MEDIUM | FIXED | `guarddog-vpn/.../TunPacketReader.kt` |
| 8 | End-of-stream silent failure | MEDIUM | FIXED | `guarddog-vpn/.../TunPacketReader.kt` |
| 9 | Gate status from permission/config | MEDIUM | FIXED | `frontend/src/domain/gates.ts` |
| 10 | iOS rule preparation ignored | MEDIUM | FIXED | `frontend/src/store/ApolloContext.tsx` |
| 11 | 5,000 entry blocklist cap | MEDIUM | FIXED | `backend/services/intel.py` |
| 12 | Temporary email failure permanent | MEDIUM | FIXED | `backend/services/mailbox_monitor.py` |

---

## Fix Details

### Fix 1: URL reputation path preservation
- **Backend** (`intel.py`): `sanitize_url()` now preserves the URL path, only stripping credentials, fragments, and secret-looking query parameters. Safe Browsing and the blocklist get page-specific URLs.
- **Frontend** (`privacy.ts`): `minimalIndicator()` preserves the pathname and only strips secret query params. The previous origin-only stripping (`pathname = '/'`) is removed.

### Fix 2: Idempotent bundle acceptance
- **GuardDogSDKEngine.kt**: Both `acceptRuleBundle()` and `acceptWebsiteGateRuleBundle()` now check if the incoming bundle has the same `rulesetId` and `bundleVersion` as the currently accepted one. If identical, they return early without clearing `authorization` or `websiteGateBindings`.

### Fix 3: Transactional WFP filter updates
- **ApolloWfpService.cpp**: New `updateRulesTransactionally()` function compares current rules against active filters. It uses `FwpmTransactionBegin0/Commit0` to atomically remove stale filters and add new ones. The WFP session, engine handle, and event subscription remain open across refreshes — no more 5-second teardown/rebuild cycle.

### Fix 4: Honest IP-level attribution scope
- **ApolloWfpService.cpp**: Evidence records now include `"confidence":"ip_address_level"`, `"attributionScope":"ip_resolved_from_domain"`, and a metadata note explaining that the block is by resolved IP address and other domains sharing the address are also affected.

### Fix 5: Sinkhole pool exhaustion fails open
- **SinkholeBindingStore.kt**: `nextAvailableIp()` now returns `String?`. When the entire pool is occupied by live bindings for OTHER hosts, it returns null instead of overwriting a live binding. `arm()` propagates this as a null return (fail open — forward upstream), preventing mis-attributed blocks.

### Fix 6: Connected socket + transaction ID validation
- **ProtectedUdpDnsForwarder.kt**: The `DatagramSocket` is now connected to the resolver endpoint via `socket.connect()`. The DNS transaction ID (first 2 bytes) is extracted from the query and validated against the response. Mismatched or forged responses are rejected.

### Fix 7: Asynchronous DNS forwarding
- **TunPacketReader.kt**: DNS gateway queries are now dispatched to a dedicated single-thread `ExecutorService` (`dnsExecutor`). The TUN reader thread no longer blocks on upstream DNS queries. Packet data is copied for the executor since the read buffer is reused. Output writes are synchronized.

### Fix 8: End-of-stream triggers onError
- **TunPacketReader.kt**: A negative read (`n < 0`) now invokes `onError(IOException("TUN input stream reached end-of-stream unexpectedly"))` before breaking, so the protection lifecycle observer can detect and respond to unexpected TUN closure.

### Fix 9: Event-driven gate honesty
- **gates.ts**: Link and Account gates now include a `limitation` field explaining they respond when triggered rather than continuously monitoring. Help text for the link gate is also updated to say "checks when triggered" instead of "is checking."

### Fix 10: iOS rule preparation consumed
- **ApolloContext.tsx**: The `blockEvent` handler now examines `rulesState`, `reloadState`, and `activeState` from the iOS native result. When rules are prepared, reloaded, and the Safari extension is enabled (`enabled_match_unobservable`), the block is treated as successful — not a failure. When rules are prepared but the extension is not enabled, a specific actionable message guides the user to Safari settings.

### Fix 11: Targeted blocklist query
- **intel.py**: `blocklist_check()` now builds a list of the exact host plus all parent domains and queries MongoDB with `{"host": {"$in": candidates}}`. This replaces the previous `find().to_list(5000)` linear scan, removing the silent 5,000-entry truncation.

### Fix 12: Retryable temporary failures
- **mailbox_monitor.py**: `_submit_shared_case()` now distinguishes terminal failures (`cancelled`, `expired`) from retryable ones (`temporary_case_unavailable`). Retryable failures reset to `"claimed"` state for re-processing. `_finalise_receipt()` adds a `retry_after` timestamp to temporary failures.

---

## Verification Requirements

- **Backend** (Fixes 1, 11, 12): Testable now via the running FastAPI server.
- **Frontend TypeScript** (Fixes 9, 10): Verified via `tsc --noEmit` (compiles clean).
- **Android Kotlin** (Fixes 2, 5, 6, 7, 8): Requires dev build or CI native-gates job to run unit tests.
- **Desktop C++** (Fixes 3, 4): Requires Windows build environment to compile and test.
