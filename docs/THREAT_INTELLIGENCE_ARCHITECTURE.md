# Apollo — Live Threat Intelligence and Rule Freshness Architecture

**Status:** DESIGN PROPOSAL — Awaiting approval before any implementation  
**Date:** October 2026  
**Scope:** Threat intelligence lifecycle, hybrid protection model, rule publication, security authority, privacy, acceptance criteria  
**Classification:** Internal architecture document

---

## 0. Current State Audit

Before proposing changes, here is an honest accounting of what actually exists today.

### 0.1 What the Code Shows

| Component | Actual Implementation | Gap |
|-----------|----------------------|-----|
| **`/api/guarddog/rules`** | Returns a static Python dict containing **1 rule** (`apolloverify.harmonywellnessgroup.com.au`). Hardcoded `issuedAt`, `expiresAt`, `bundleVersion`. No database query, no threat-intelligence feed. | No automated connection to managed threat intelligence. Rules are updated by editing source code and redeploying. |
| **Blocklist (`db.blocklist`)** | MongoDB collection with `host`, `threat_type`, `reason`, `added_at`, `deleted_at`. Queried by Link Gate's `/api/intel/check`. | No per-indicator provenance, verification timestamp, freshness deadline, scope (hostname vs URL), review status, or withdrawal tracking. No scheduled revalidation. |
| **Reputation cache** | HMAC-digested cache with short TTLs (5 min known, 1 min unknown). Flushed entirely when any blocklist entry is added or removed. | Cache invalidation is all-or-nothing. No targeted invalidation for individual indicators. |
| **`combine()` verdict logic** | A **single** source returning `status: "match"` produces a `"malicious"` verdict. Sources: Apollo blocklist (hostname match) + Google Safe Browsing (full-URL match). | A single Safe Browsing match on a specific URL path can produce a "malicious" verdict that may be misinterpreted as hostname-wide. A single unchecked blocklist entry has the same effect. |
| **Native rule validation** | `RuleBundleValidator.kt`: strict JSON parsing, schema validation, temporal validity, rollback protection, SHA-256 content-hash conflict detection. | **No cryptographic signature verification.** Authentication is HTTPS-only (TLS + baked-in URL in the signed APK). The `RuleBundle.kt` data class has no signature field. |
| **Rule refresh** | `ApolloGuardDogRefreshWorker` runs every **2 hours** via WorkManager. `triggerUrgentRuleRefresh()` triggers an immediate fetch. | Both fetch the same static endpoint. Urgent refresh has no way to obtain genuinely updated rules unless the backend has published a new bundle. No reporting of whether a new version was actually installed. |
| **Blocklist → rule bundle connection** | **None.** The blocklist (used by Link Gate) and the rule bundle (used by Site Gate) are completely separate data paths. | A domain confirmed malicious by Link Gate does not reach Site Gate until someone manually edits the static rule bundle in source code. |
| **Blocklist revalidation** | **None.** Entries persist in MongoDB indefinitely once added. No scheduled job re-checks sources. | An entry added based on a transient Safe Browsing listing that was later withdrawn remains on Apollo's blocklist permanently. |
| **Blocklist removal → native rules** | Admin `DELETE /api/admin/blocklist/{host}` soft-deletes the entry and flushes the reputation cache. | Does **not** trigger a native rule bundle update. If the host was in the static rule bundle, the device continues blocking it until the next code deployment. |

### 0.2 What the Bridge Design Doc Claims vs Reality

| Claim in Bridge Design Doc | Actual Status |
|---------------------------|---------------|
| "Signed Emergency Bundle" | **Does not exist.** No signing key, no signature field in `RuleBundle.kt`, no verification in `RuleBundleValidator.kt`. |
| "Backend validates before adding to bundle; device validates signed bundle" | Backend validation endpoint does not exist. Device validates schema and version, not signatures. |
| "Same signing key; same bundle format; same installation path" | No signing key exists in the codebase. |
| "POST /api/threat-indicators/submit" endpoint | Does not exist. |
| "Emergency delta queue" published "every 30 seconds" | Does not exist. |
| "Alexa/Tranco top-10K popularity list" safety check | Does not exist. |

---

## A. Threat Intelligence Lifecycle

### A.1 Extended Threat Indicator Schema

Extend the existing `BlocklistEntry` model to record the metadata needed for auditable, revalidatable threat intelligence.

```python
class ThreatIndicator(BaseDocument):
    """A single threat indicator with full lifecycle metadata."""
    
    # Identity
    indicator_id: str                    # Unique, immutable
    hostname: str                        # The blocked hostname (never a full URL path)
    scope: Literal["hostname"]           # Always hostname for native rules. URL-path-specific
                                         # intelligence stays in reputation_cache, never becomes
                                         # a hostname-wide block.
    
    # Source provenance
    source: str                          # e.g. "google_safe_browsing", "apollo_manual", "phishtank"
    source_reference: str | None         # External ID or URL from the source
    original_evidence: str               # What the source actually reported (URL, hostname, threat type)
    original_scope: Literal["url", "hostname"]  # What the source matched — if "url", the indicator
                                                 # was NOT automatically promoted to hostname scope
    
    # Verification
    first_seen_at: datetime              # When Apollo first observed this indicator
    last_verified_at: datetime           # When the indicator was last confirmed by the source
    verification_deadline: datetime      # After this, the indicator must be re-verified or withdrawn
    verification_count: int              # How many times it has been successfully re-verified
    
    # Status
    status: Literal["active", "pending_review", "withdrawn", "expired"]
    review_status: Literal["auto_verified", "manually_reviewed", "pending_human_review"]
    
    # Publication
    published_in_bundle_version: int | None    # Which rule bundle version includes this indicator
    withdrawn_from_bundle_version: int | None  # Which version removed it (if withdrawn)
    
    # Lifecycle
    added_at: datetime
    updated_at: datetime
    withdrawn_at: datetime | None
    withdrawal_reason: str | None        # "source_delisted", "false_positive_report", "expired", "manual"
```

### A.2 Freshness Rules

| Indicator Source | Verification Interval | Max Age Before Expiry | Re-verification Method |
|-----------------|----------------------|----------------------|----------------------|
| Google Safe Browsing | 4 hours | 24 hours | Re-query Safe Browsing API for the original URL |
| Apollo manual (admin-added) | 7 days | 30 days | Human review prompt |
| Future: PhishTank / URLhaus | 6 hours | 48 hours | Re-query source API |

**Enforcement:** An indicator whose `verification_deadline` has passed and whose re-verification has failed is moved to `status: "expired"`. Expired indicators are **excluded** from the next published rule bundle. They are never silently relabelled as current.

### A.3 Scheduled Revalidation (Corrected Dual-Timestamp Design)

**Implementation: See `/app/backend/services/threat_revalidation.py` (Stage 1 — now implemented).**

Two distinct temporal boundaries:
- `next_scheduled_check` — **soft** boundary: when to re-query the source. Missing it flags the indicator as `check_overdue` but does NOT expire it.
- `evidence_expiry_deadline` — **hard** boundary: if exceeded without successful re-verification, the indicator is force-expired and excluded from active use.

A provider timeout is NOT evidence of delisting. On timeout or error:
- `consecutive_check_failures` increments
- `next_scheduled_check` resets to a backoff retry time
- `evidence_expiry_deadline` is NOT extended (the countdown continues)
- Status becomes `check_overdue` (NOT `expired`)
- Only an explicit "not found" / "clear" response from the source constitutes delisting evidence

```
threat_revalidation_loop:
  - Runs every maintenance cycle (currently ~2 hours)
  - Selects indicators where next_scheduled_check <= now AND status in [active, check_overdue]
  - For each: re-queries the original source
  - If confirmed: refreshes both timestamps, resets failure count, status → active
  - If source_delisted: status → expired, withdrawal_reason → source_delisted
  - If timeout/error: increments failures, schedules retry with backoff, does NOT expire
  - After individual checks: enforces hard evidence_expiry_deadline on all indicators
  - Logs every decision with timestamp and source response in immutable audit log
```

### A.4 No Hostname-Wide Blocking from Path-Only Evidence

When a reputation source (e.g., Safe Browsing) flags a specific URL path (e.g., `https://example.com/phishing/page.html`), this finding:

1. **Is recorded** in the reputation cache with the full URL digest
2. **Is NOT automatically promoted** to a hostname-wide `ThreatIndicator` block
3. **Requires** either: (a) the source explicitly listing the hostname/domain itself, OR (b) multiple distinct URL paths on the same host being independently flagged, OR (c) manual review confirming the entire host is malicious

This prevents a single compromised page on an otherwise-legitimate shared hosting platform from blocking the entire domain.

---

## B. Hybrid Automatic Protection

### B.1 Architecture Overview

```
                 ┌──────────────────────────────────────┐
                 │  Device (Native Android VPN)          │
                 │                                       │
    DNS query    │  1. Check local rule bundle (instant)  │
   ──────────►   │     ├─ BLOCK match → sinkhole          │
                 │     ├─ ALLOW match → forward upstream   │
                 │     └─ NO match → step 2               │
                 │                                       │
                 │  2. Check on-device reputation cache    │
                 │     ├─ Cached "malicious" → sinkhole    │
                 │     ├─ Cached "clean" → forward         │
                 │     └─ No cache → step 3               │
                 │                                       │
                 │  3. Forward DNS upstream AND trigger    │
                 │     bounded async reputation check     │
                 │     (result cached for future queries) │
                 └──────────────────────────────────────┘
                            │ async, bounded
                            ▼
                 ┌──────────────────────────────────────┐
                 │  Backend: /api/intel/dns-check         │
                 │  - Receives hash-prefix, not hostname  │
                 │  - Returns threat status for matching  │
                 │    prefixes (k-anonymity)              │
                 │  - Latency budget: 200ms               │
                 │  - Timeout: forward DNS, cache miss    │
                 └──────────────────────────────────────┘
```

### B.2 Privacy-Preserving Lookup Protocol

**Problem:** Sending raw hostnames to the backend exposes the user's complete browsing history.

**Proposed approach: Hash-prefix matching (inspired by Safe Browsing v4 Update API pattern)**

> ⚠️ **Important distinctions:**
> - Apollo would use `SHA-256(canonical_hostname)`, not Google Safe Browsing's URL-hash canonicalisation
> - These are different protocols with different hash inputs, prefix sizes, and database contents
> - The anonymity properties differ: Apollo's hostname-only hashing has a smaller input space than URL hashing, making prefix collisions less diverse. The actual anonymity set depends on the threat database size and hash prefix length, which must be measured empirically rather than assumed
> - Hostname inference may be feasible for popular domains if the threat database is small
> - A 4-byte prefix against a small threat database may not provide meaningful anonymity if only 0-1 indicators share most prefixes
> - Google Safe Browsing's Update API has specific licensing, attribution, caching, and rate-limit requirements that must be verified before use (see §E.2)

1. Device computes `SHA-256(canonical_hostname)` and sends the first **N bytes** (prefix length TBD based on empirical anonymity analysis) to the backend
2. Backend returns all known-threat indicators whose hostname hash shares that prefix
3. Device compares full hashes locally to determine if there's an actual match
4. The backend sees only a hash prefix, not the complete hostname — but the actual anonymity depends on database size and prefix length

**Caching:** Negative results (prefix has no matches) are cached on-device for 30 minutes. Positive prefix matches are cached for 5 minutes.

**Open questions requiring investigation before implementation:**
- What prefix length provides meaningful anonymity given Apollo's expected threat database size?
- Is the hostname-only input space large enough for hash-prefix anonymity to be effective?
- Does Google Safe Browsing's Update API v4 ToS permit this use case, and what are the attribution/caching requirements?
- Should Apollo use the Safe Browsing Update API's local list approach instead of a custom protocol?

### B.3 Latency and Concurrency

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| DNS response deadline | **50ms** for local rule match | Local lookup only — no network |
| Async reputation timeout | **200ms** | User-perceptible delay threshold for DNS |
| Concurrent outstanding checks | **Max 4** | Prevent thundering herd on app launch |
| Rate limit | **60 checks/minute** per device | Prevent abuse; normal browsing is ~10-20/min |
| Offline behaviour | Forward all DNS upstream | No blocking without verified intelligence |
| Backend unavailable | Forward DNS, cache the miss for 60s | Fail open — never block due to backend failure |

### B.4 Decision Matrix

> ⚠️ **Correction: No cached live verdict may independently authorise native sinkholing.**
> The existing native authorisation chain requires a rule-bundle match to arm a sinkhole binding.
> A cached live reputation verdict is advisory — it may produce warnings but never enforcement.

| Local Rule | Live Check | Action | Evidence |
|-----------|-----------|--------|----------|
| BLOCK match | (skipped) | Sinkhole immediately | dns_observation (growling) → packet drop (biting) |
| ALLOW match | (skipped) | Forward immediately | None |
| No match | Cached "malicious" | **Warning only** — forward DNS, display advisory | dns_observation (growling) — NOT biting. No packet drop. |
| No match | Cached "clean" | Forward | None |
| No match | Timeout/offline | **Forward** (fail open) | None — never block without evidence |
| No match | Live "malicious" (new) | **Warning only** — forward DNS, display advisory, submit for expedited review | dns_observation (growling) — NOT biting until confirmed by rule bundle |

**Critical constraints:**
1. A live reputation check returning "malicious" for a hostname NOT in the rule bundle produces a **warning** (growling), not an enforcement block (biting). The warning is surfaced to the user and the hostname is submitted for expedited review and potential inclusion in the next rule bundle. Only rule-bundle matches produce enforcement evidence.
2. A cached "malicious" verdict from a previous live check also produces **only a warning**. It does not independently authorise sinkholing. The existing native authorisation and packet-drop evidence requirements are preserved exactly as implemented.
3. **First-visit gap (honest limitation):** The asynchronous DNS reputation lookup allows the original DNS request to proceed to the upstream resolver while the live check runs in parallel. This means the very first visit to an unknown phishing site will NOT be blocked — the page may load before the live check completes. This design does NOT prevent the first unknown phishing page from loading. Protection begins on the second and subsequent visits (cached result) or after the hostname is added to the rule bundle.

### B.5 What This Design Does NOT Do

- Does **not** place Gemini or any LLM in the DNS decision path
- Does **not** send complete URLs or browsing history to the backend
- Does **not** block hostnames that are only flagged at the URL-path level
- Does **not** enforce blocks based solely on live check results (warnings only)
- Does **not** require Private DNS to be disabled

---

## C. Rule Publication and Revocation

### C.1 Dynamic Rule Bundle Generation (Stage 1: Static Bundle Unchanged)

> **Stage 1 status:** The production `/api/guarddog/rules` endpoint still serves the static bundle. Dynamic generation from the `ThreatIndicator` collection is proposed for Stage 2 (pending approval).

When approved, dynamic generation must produce:
- **Immutable, complete bundles** — each version is a full snapshot, not a delta. Deterministic content for a given set of active indicators.
- **Monotonically versioned** — `bundleVersion` strictly increases. No gaps, no reuse of version numbers.
- **Temporally bounded** — `issuedAt` and `expiresAt` are deterministic per publish event.
- **Publication ≠ installation** — "published" means the backend has generated and made available a new version. "Installed" means a specific device has fetched, validated, and activated it. These are separate events with separate timestamps.

```python
# PROPOSED (not yet implemented — Stage 2)
@router.get("/guarddog/rules")
async def get_rules():
    """Serve the current production rule bundle.
    Generated from active, verified ThreatIndicators.
    Authentication: HTTPS-only (TLS + baked-in URL in signed APK).
    """
    indicators = await db.threat_indicators.find({
        "status": "active",
        "evidence_expiry_deadline": {"$gt": now_utc()},
    }).to_list(10000)
    
    bundle = build_rule_bundle(indicators, next_version)
    return bundle
```

### C.2 Publication Pipeline

```
ThreatIndicator confirmed active
        │
        ▼
Backend validation:
  - Source provenance verified
  - Hostname scope confirmed (not URL-path promotion)
  - Not in exemption list (major banks, CDNs, cloud providers)
  - Not a single-source, single-check finding for global blocking
        │
        ▼
Added to next bundle version
  - bundleVersion incremented
  - issuedAt = now (deterministic per publish)
  - expiresAt = issuedAt + 48 hours
        │
        ▼
Device pulls on next scheduled refresh (2h)
  or urgent refresh (triggered by JS layer)
        │
        ▼
Device validates: schema, version, temporal, rollback
  (HTTPS authentication, NOT cryptographic signature — see §D)
```

### C.3 Urgent Correction (False Positive Withdrawal)

When a false positive is identified:

1. Admin calls `POST /api/admin/threat-indicators/{indicator_id}/withdraw` (Stage 1 — **implemented**)
2. Indicator status → `"withdrawn"`, withdrawal recorded with reason and timestamp
3. New bundle version published **immediately** (within 30 seconds) — Stage 2
4. All devices with `triggerUrgentRuleRefresh()` capability receive the corrected bundle on next check
5. Reputation cache entries for the affected hostname are invalidated (Stage 1 — **implemented**)
6. Urgent refresh **reports back** whether a new bundle version was actually installed, not just requested

**Offline and delayed devices:**
- Devices that are offline, on limited connectivity, or unable to refresh will continue enforcing the false-positive rule until they successfully pull the corrected bundle.
- The bundle's `expiresAt` provides a hard upper bound: once the existing bundle expires, the device must fetch a new one before resuming enforcement. An expired bundle's rules are not enforced.
- There is no mechanism to push a revocation to an individual offline device. Revocation depends on the device's next successful pull.
- This is an accepted limitation. The design does not claim instant revocation for all devices — only that the corrected bundle is available for immediate pull and that bundle expiry provides a time-bounded worst case.

### C.4 What Cannot Authorise a Block

| Source | Can It Create a Native BLOCK Rule? | Why |
|--------|-----------------------------------|-----|
| Single Safe Browsing URL-path match | **No** | URL-path evidence, not hostname-wide. Original scope must be preserved. |
| Single blocklist entry without independent verification | **No** | Requires at least one genuinely independent external source confirmation. Two services querying the same upstream (e.g., both using SB) count as one source. |
| AI/Gemini assessment only | **No** | LLM assessments are advisory, never authoritative for blocking |
| Client-side submission without backend validation | **No** | Untrusted client data — backend must independently verify |
| User feedback ("missed_threat") | **No** | Queued for human review, never auto-blocks |
| Multiple genuinely independent sources confirming hostname | **Yes**, after backend validation | Sufficient evidence for hostname-wide block. Sources must be operationally independent (not derived from the same upstream feed). |
| Admin manual addition with recorded reason | **Yes** | Human-reviewed, auditable, with source provenance recorded |

---

## D. Security Authority — HTTPS vs Cryptographic Signing

### D.1 What Actually Exists (Honest Assessment)

The current production implementation provides:

| Layer | Mechanism | What It Proves |
|-------|-----------|---------------|
| **Transport** | TLS (HTTPS) | The bundle came from the Apollo backend at the expected URL. No tampering in transit. |
| **Origin binding** | Baked-in URL in signed APK | Only the genuine Apollo APK knows the backend URL. |
| **Schema** | `RuleBundleValidator.kt` | The bundle has valid structure, rules, and temporal bounds. |
| **Rollback** | Version comparison + SHA-256 content hash | A previously installed bundle cannot be replayed at a lower version. |

This is an **HTTPS-authenticated, schema-validated** bundle — not a cryptographically signed bundle.

### D.2 What Does NOT Exist

- No Ed25519 or RSA signing key
- No signature field in the `RuleBundle` data class
- No signature verification in `RuleBundleValidator`
- No public-key pinning or key rotation mechanism
- No offline verification (bundle can only be validated when HTTPS context is available)

### D.3 Threat Model Gap

The current HTTPS-only model is vulnerable to:

| Attack | HTTPS Protection | Signing Protection |
|--------|-----------------|-------------------|
| Man-in-the-middle (network) | ✅ TLS prevents | ✅ Signature prevents |
| Compromised CDN/proxy | ❌ CDN serves whatever it has | ✅ Signature proves backend origin |
| Backend database compromise | ❌ Backend serves altered rules | ⚠️ Signing key must be separate |
| Replay of valid but outdated bundle | ✅ Version rollback protection | ✅ Same |

### D.4 Proposed Path to Actual Signing

**This is a staged proposal — not implemented until approved.**

**Stage 1 (current):** HTTPS-only. Document this honestly everywhere. Remove "signed" claims from all design docs. ✅ **Done.**

**Stage 2 (future, if approved):**
1. Generate an Ed25519 signing keypair. Private key stored in a separate secrets manager (not in the application database).
2. Add `signature: string` field to `RuleBundle` data class.
3. Backend signs the canonical JSON of each published bundle.
4. `RuleBundleValidator.kt` verifies the signature against a pinned public key before any schema or version checks.
5. Key rotation: support two public keys simultaneously (current + next) with a transition window, managed through Apollo's existing trusted-key-manifest architecture.

**Prerequisite for automatic BLOCK publication:** Dynamic rule bundle generation (Stage 2 of §G) must NOT automatically publish BLOCK rules to production devices until:
- Ed25519 signing is implemented and verified on both backend and native client
- Key management uses the existing trusted-key-manifest infrastructure
- Device acceptance of signed bundles has been demonstrated end-to-end on physical devices
- OR a separately approved security decision explicitly defines a narrower release scope with documented risk acceptance

This constraint exists because HTTPS-only authentication does not provide the same tamper-evidence guarantees as cryptographic signing. A compromised CDN or backend database could inject false rules. Automatic BLOCK publication amplifies the impact of such a compromise.

**Stage 2 is not claimed as existing. It is a future improvement with prerequisites.**

### D.5 Corrections to Existing Documentation

The bridge design doc (`LINK_GATE_SITE_GATE_BRIDGE_DESIGN.md`) must be updated to:
- Remove all references to "signed" bundles
- Replace with "HTTPS-authenticated" bundles
- State that cryptographic signing is a future improvement, not current
- Remove the "Same signing key" row from the preservation table

---

## E. User Privacy and Experience

### E.1 Privacy-Preserving Intelligence

| Approach | What Leaves the Device | Privacy Level | Latency | Coverage |
|----------|----------------------|--------------|---------|----------|
| **Hash-prefix (proposed)** | 4-byte SHA-256 prefix | High (k-anonymity ~65K) | 100-200ms | Backend threat DB |
| Full hostname query | Complete hostname | **Low** — full browsing history | 50-100ms | Full |
| On-device full list | Nothing | **Maximum** | <1ms | Limited to list size |
| Current (local rules only) | Nothing | **Maximum** | <1ms | Very limited (1 rule) |

**Recommendation:** Hash-prefix for live checks. On-device rule bundle for known threats. No complete URLs sent to backend.

### E.2 Provider Compliance (Unverified — Requires Investigation Before Implementation)

> ⚠️ **The following requirements have NOT been verified against current Google Safe Browsing API terms.** Before selecting any live reputation protocol, the following must be independently confirmed:

If using Google Safe Browsing Update API (v4) for on-device hash lists:
- Must display Safe Browsing attribution per Terms of Service — verify current attribution requirements
- Must respect cache durations returned by the API — verify minimum cache durations
- Must not use the API for purposes other than user protection — verify this use case qualifies
- Rate limits: verify current limits for the Update API (previously 25,000 requests/key/day)
- Canonicalisation: Safe Browsing uses a specific URL canonicalisation algorithm. Apollo's hostname-only hashing is NOT the same protocol and may not be compatible with SB's hash databases
- Verify whether Apollo's proposed hostname-hash-prefix protocol can legally/technically use SB data, or whether a different approach (e.g., SB's native Update API with local list synchronisation) is required

### E.3 Private DNS Compatibility (Unresolved Engineering Requirement)

> ⚠️ **Encrypted-DNS compatibility remains an unresolved engineering requirement.**

This design does **not** require users to disable Private DNS. However, when Private DNS is active, Apollo's VPN DNS gateway is bypassed entirely. The current coverage reality:

| Configuration | Local Rules | Live Reputation | DNS Observation | Enforcement |
|--------------|------------|----------------|----------------|-------------|
| Private DNS OFF | ✅ Full | ✅ Full (proposed) | ✅ Full | ✅ Full |
| Private DNS Automatic | ⚠️ Depends on carrier | ⚠️ Depends | ⚠️ Depends | ⚠️ Depends |
| Private DNS ON (provider) | ❌ DNS bypassed | ❌ DNS bypassed | ❌ DNS bypassed | ❌ DNS bypassed |
| Chrome Secure DNS | ❌ Chrome DNS bypassed | ❌ Chrome bypassed | ❌ Chrome bypassed | ❌ Chrome bypassed |

When DNS inspection is unavailable, Apollo honestly reports the limitation (per the Private DNS corrections already applied). Link checking, manual investigation, and non-DNS protections continue operating where supported.

**This is an accepted limitation, not a solved problem.** Possible future approaches include:
- Android Accessibility Service integration (high-permission, significant privacy implications)
- Local HTTP proxy for browser traffic (complex, may not work with HTTPS)
- Integration with browser extensions where available
- VPN-layer TLS SNI inspection (limited to SNI-exposing connections)

None of these have been evaluated or proposed for implementation. The honest answer is: when Private DNS is enabled, Apollo cannot automatically check websites through DNS inspection, and no currently designed solution changes this.

### E.4 Higgins User Experience

Higgins messages related to threat intelligence remain calm, simple, and evidence-based:

- **Block event:** "Apollo blocked a connection to a known dangerous website. The threat is contained."
- **Live warning (new):** "Apollo noticed this website has been reported as unsafe. This hasn't been confirmed yet — I'll keep checking."
- **Private DNS limitation:** "Some automatic website checks are limited on this device. You don't need to change any settings."
- **Rule update:** (silent — no user notification for routine bundle updates)
- **False positive withdrawal:** (silent — blocking stops, no alarm)

---

## F. Acceptance Criteria and Test Strategy

Each capability must be proven independently before deployment.

### F.1 Threat Data Freshness and Automatic Revalidation

| Test | Method | Pass Criteria |
|------|--------|---------------|
| Indicator expires when source delists | Add indicator from SB, wait for SB listing to expire, run revalidation | Indicator status → "expired", excluded from next bundle |
| Indicator refreshes when source confirms | Add indicator, run revalidation while SB still lists it | `last_verified_at` updated, `verification_deadline` extended |
| Expired indicator never silently relabelled | Check bundle generation with expired indicators | Expired indicators absent from generated bundle |

### F.2 New Threat Publication Latency

| Test | Method | Pass Criteria |
|------|--------|---------------|
| Time from SB match to rule bundle | Add host to blocklist via admin, trigger bundle generation, measure time | < 30 minutes from confirmation to device availability |
| Urgent refresh delivers new rules | Trigger urgent refresh after backend publishes new version | Device reports new `bundleVersion` installed |
| Urgent refresh reports honestly | Trigger urgent refresh when no new version exists | Device reports "no new version available", not "updated successfully" |

### F.3 False-Positive Withdrawal Latency

| Test | Method | Pass Criteria |
|------|--------|---------------|
| Time from withdrawal to bundle correction | Withdraw indicator, publish new bundle, trigger refresh | < 5 minutes from withdrawal to device receiving corrected bundle |
| Withdrawn host no longer blocked | After correction, attempt to visit withdrawn host | DNS forwarded normally, no sinkhole |
| Reputation cache invalidated | After withdrawal, check `/api/intel/check` for the host | Returns "clean" or "unknown", not cached "malicious" |

### F.4 No Hostname-Wide Blocking from Path-Only Evidence

| Test | Method | Pass Criteria |
|------|--------|---------------|
| SB URL-path match does not create hostname block | Flag `example.com/phishing` via SB, check rule bundle | `example.com` is NOT in the bundle |
| Multiple URL paths trigger review, not auto-block | Flag 3 distinct paths on same host | Indicator created with `review_status: "pending_human_review"`, NOT `"active"` |

### F.5 No Unauthorised Rule Updates

| Test | Method | Pass Criteria |
|------|--------|---------------|
| Client submission without backend validation rejected | Submit fake threat indicator directly | 403 or validation failure |
| AI-only assessment cannot create BLOCK rule | Trigger Higgins assessment that says "malicious" | No new ThreatIndicator created |
| Rollback protection | Serve bundle with lower version | Device rejects with `ROLLBACK` |

### F.6 No Fabricated Biting Evidence

| Test | Method | Pass Criteria |
|------|--------|---------------|
| DNS observation alone never produces biting | Observe DNS match, cancel before packet drop | Event state remains "growling", `verified_block: false` |
| Live warning alone never produces biting | Live check returns "malicious" for unknown host | Event state is "growling" (warning), not "biting" |
| Only real packet drop produces biting | Observe DNS match + complete TCP to sinkhole + packet dropped | `verified_block: true`, `enforcement_evidence.result: "verified"` |

### F.7 Latency and Reliability Under Normal Browsing

| Test | Method | Pass Criteria |
|------|--------|---------------|
| DNS resolution latency (local rule) | Measure DNS response time for rule-matched host | < 5ms |
| DNS resolution latency (no match, no live check) | Measure DNS response time for popular host | < 50ms overhead |
| DNS resolution latency (live check, cache miss) | Measure DNS response time with async check | DNS forwarded in < 50ms; async check completes in < 200ms |
| Backend failure does not block DNS | Kill backend, attempt DNS resolution | DNS forwarded normally |

### F.8 Privacy and Provider Compliance

| Test | Method | Pass Criteria |
|------|--------|---------------|
| No full hostnames in backend logs | Grep backend logs during browsing session | Only hash prefixes logged, never complete hostnames |
| No full URLs sent to backend | Network capture during browsing | Backend receives hash prefixes only |
| Safe Browsing attribution displayed | Check app UI | Attribution present per TOS |

### F.9 Actual Coverage with Private DNS and Chrome Secure DNS

| Test | Method | Pass Criteria |
|------|--------|---------------|
| Private DNS OFF: full coverage | Block a test domain, visit it in Chrome | DNS intercepted, sinkholed, packet dropped |
| Private DNS Automatic: measure | Set to Automatic, visit blocked domain | Record whether DNS reached Apollo's gateway |
| Private DNS ON (provider): no false claims | Set to dns.google, visit blocked domain | Apollo reports "limited" honestly, does not claim a block |
| Chrome Secure DNS: measure | Enable Chrome DoH, visit blocked domain | Record whether Apollo sees the DNS query |

---

## G. Staged Implementation Plan

### Stage 1: Threat Intelligence Lifecycle (Backend Only) — ✅ IMPLEMENTED

**Scope:** `ThreatIndicator` model with full provenance, dual-timestamp verification, revalidation scheduling, hard expiry, withdrawal, admin CRUD with audit trail.

**What was built:**
- `ThreatIndicator` model in `core/models.py` with corrected dual-timestamp design
- `ThreatRevalidationLog` immutable audit model
- `services/threat_revalidation.py` — revalidation engine, hard expiry enforcement, migration
- Admin endpoints in `routers/admin.py`: list, get, add, withdraw, stats
- Wired into maintenance loop in `services/maintenance.py`
- Index creation and migration in `server.py` lifespan
- 14 passing tests in `tests/test_threat_indicators.py`

**What was NOT changed:**
- `/api/guarddog/rules` still serves the static production bundle — unchanged
- No new blocking mechanisms
- No native client changes

### Stage 2: Link Gate → Site Gate Bridge + Dynamic Bundle Generation (PENDING APPROVAL)

**Scope:** When Link Gate confirms a hostname as malicious (multi-source, genuinely independent), submit it as a ThreatIndicator for backend validation. Generate immutable, monotonically versioned bundles from active indicators.

**Prerequisites:**
- Stage 1 complete ✅
- Approval of the revised bridge design (`LINK_GATE_SITE_GATE_BRIDGE_DESIGN.md`)
- Decision on whether automatic BLOCK publication requires cryptographic signing first (see §D.4)

**Risk:** Medium — new publication path, requires physical device testing.

### Stage 3: Live Reputation Checks (PENDING APPROVAL + INVESTIGATION)

**Scope:** Privacy-preserving live checks for unknown DNS hostnames.

**Prerequisites:**
- Stage 2 complete
- Safe Browsing API eligibility and ToS verification (§E.2)
- Hash-prefix anonymity analysis with measured (not assumed) properties
- Decision on protocol: custom hostname-hash vs SB Update API local lists

**Open corrections applied:**
- Cached live verdict cannot independently authorise sinkholing (Correction 1)
- Hash-prefix anonymity claims removed pending empirical analysis (Correction 2)
- First-visit limitation honestly documented (Correction 7)

**Risk:** High — native DNS pipeline modification, latency-sensitive, privacy-critical.

### Stage 4: Cryptographic Signing (PENDING APPROVAL)

**Scope:** Ed25519 signing and verification using existing trusted-key-manifest architecture.

**Prerequisites:**
- Stages 2-3 complete
- Key management architecture approved
- Physical device end-to-end verification

**Note:** Automatic production BLOCK publication is blocked until this stage is complete (or a separately approved security decision defines a narrower release).

**Risk:** Medium — cryptographic implementation must be correct.

---

## H. Documentation Corrections Applied

1. **`LINK_GATE_SITE_GATE_BRIDGE_DESIGN.md`** — ✅ All "signed bundle" claims removed. Replaced with "HTTPS-authenticated bundle". Cryptographic signing noted as future improvement.

2. **`SITE_GATE_INVESTIGATION_REPORT.md`** — Existing document; notes the static 1-rule bundle. No further changes needed.

3. **All Kotlin code comments** referencing "signed rules" — ✅ Corrected to "validated rules" / "HTTPS-authenticated rules" in `WebsiteGateOverrideStore.kt`, `GuardDogSDKEngine.kt`, `BlockedThreatEvidence.kt`, `ApolloSecurityModule.kt`.

4. **Private DNS user-facing messaging** — ✅ All "Turn off Private DNS" / "fully active" claims removed. Honest limitation reporting in place.

5. **DEVICE_VERIFICATION_PLAN.md** — ✅ All tests marked PENDING. Expanded to cover Private DNS Off/Automatic/Provider/Chrome Secure DNS configurations.

---

*This document was initially created as a design proposal. Stage 1 has been implemented and tested (14/14 tests passing). Stages 2-4 remain proposals awaiting approval. All corrections from the architecture review have been applied to this document.*

