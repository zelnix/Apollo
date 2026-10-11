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

### A.3 Scheduled Revalidation

A new backend periodic task (using the existing `maintenance_worker` pattern):

```
threat_revalidation_loop:
  - Runs every 2 hours
  - Selects indicators where verification_deadline < now AND status == "active"
  - For each: re-queries the original source
  - If still listed: updates last_verified_at and extends verification_deadline
  - If no longer listed: sets status to "expired", records withdrawal_reason = "source_delisted"
  - Logs every decision with timestamp and source response
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

**Solution: Hash-prefix matching (modelled on Safe Browsing v4 Update API)**

1. Device computes `SHA-256(canonical_hostname)` and sends the first **4 bytes** (32-bit prefix) to the backend
2. Backend returns all known-threat indicators whose hostname hash shares that prefix (typically 0-3 results for a 4-byte prefix)
3. Device compares full hashes locally to determine if there's an actual match
4. The backend never learns which specific hostname the user visited — it only sees a prefix shared by ~65,000 possible hostnames (for a 200K-hostname threat database)

**Caching:** Negative results (prefix has no matches) are cached on-device for 30 minutes. Positive prefix matches are cached for 5 minutes.

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

| Local Rule | Live Check | Action | Evidence |
|-----------|-----------|--------|----------|
| BLOCK match | (skipped) | Sinkhole immediately | dns_observation (growling) → packet drop (biting) |
| ALLOW match | (skipped) | Forward immediately | None |
| No match | Cached "malicious" | Sinkhole | dns_observation (growling) → packet drop (biting) |
| No match | Cached "clean" | Forward | None |
| No match | Timeout/offline | **Forward** (fail open) | None — never block without evidence |
| No match | Live "malicious" | **Warning only** (first observation) | dns_observation (growling) — NOT biting until confirmed by rule bundle |

**Critical constraint:** A live reputation check returning "malicious" for a hostname NOT in the rule bundle produces a **warning** (growling), not an enforcement block (biting). The warning is surfaced to the user and the hostname is submitted for expedited review and potential inclusion in the next rule bundle. Only rule-bundle matches produce enforcement evidence.

### B.5 What This Design Does NOT Do

- Does **not** place Gemini or any LLM in the DNS decision path
- Does **not** send complete URLs or browsing history to the backend
- Does **not** block hostnames that are only flagged at the URL-path level
- Does **not** enforce blocks based solely on live check results (warnings only)
- Does **not** require Private DNS to be disabled

---

## C. Rule Publication and Revocation

### C.1 Dynamic Rule Bundle Generation

Replace the static Python dict with a database-driven bundle generator:

```python
@router.get("/guarddog/rules")
async def get_rules():
    """Serve the current production rule bundle.
    
    Generated from active, verified ThreatIndicators — not a static dict.
    Authentication: HTTPS-only (TLS + baked-in URL in signed APK).
    """
    indicators = await db.threat_indicators.find({
        "status": "active",
        "verification_deadline": {"$gt": now_utc()},
        "published_in_bundle_version": {"$ne": None},
    }).to_list(10000)
    
    bundle = build_rule_bundle(indicators, current_version)
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

1. Admin calls `DELETE /api/admin/threat-indicators/{indicator_id}` or `POST /api/admin/threat-indicators/{indicator_id}/withdraw`
2. Indicator status → `"withdrawn"`, withdrawal recorded
3. New bundle version published **immediately** (within 30 seconds)
4. All devices with `triggerUrgentRuleRefresh()` capability receive the corrected bundle on next check
5. Reputation cache entries for the affected hostname are invalidated
6. Urgent refresh **reports back** whether a new bundle version was actually installed (not just requested)

### C.4 What Cannot Authorise a Block

| Source | Can It Create a Native BLOCK Rule? | Why |
|--------|-----------------------------------|-----|
| Single Safe Browsing URL-path match | **No** | URL-path evidence, not hostname-wide |
| Single blocklist entry without verification | **No** | Requires at least one external source confirmation |
| AI/Gemini assessment only | **No** | LLM assessments are advisory, never authoritative |
| Client-side submission without backend validation | **No** | Untrusted client data |
| User feedback ("missed_threat") | **No** | Queued for human review, never auto-blocks |
| Multiple independent sources confirming hostname | **Yes**, after backend validation | Sufficient evidence for hostname-wide block |
| Admin manual addition with recorded reason | **Yes** | Human-reviewed, auditable |

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

**Stage 1 (current):** HTTPS-only. Document this honestly everywhere. Remove "signed" claims from all design docs.

**Stage 2 (future, if approved):**
1. Generate an Ed25519 signing keypair. Private key stored in a separate secrets manager (not in the application database).
2. Add `signature: string` field to `RuleBundle` data class.
3. Backend signs the canonical JSON of each published bundle.
4. `RuleBundleValidator.kt` verifies the signature against a pinned public key before any schema or version checks.
5. Key rotation: support two public keys simultaneously (current + next) with a transition window.

**Stage 2 is not claimed as existing. It is a future improvement.**

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

### E.2 Provider Compliance

If using Google Safe Browsing Update API (v4) for on-device hash lists:
- Must display Safe Browsing attribution per Terms of Service
- Must respect cache durations returned by the API
- Must not use the API for purposes other than user protection
- Rate limits: 25,000 requests per API key per day (Update API)

### E.3 Private DNS Compatibility

This design does **not** require users to disable Private DNS. The coverage matrix:

| Configuration | Local Rules | Live Reputation | DNS Observation | Enforcement |
|--------------|------------|----------------|----------------|-------------|
| Private DNS OFF | ✅ Full | ✅ Full | ✅ Full | ✅ Full |
| Private DNS Automatic | ⚠️ Depends | ⚠️ Depends | ⚠️ Depends | ⚠️ Depends |
| Private DNS ON (provider) | ❌ DNS bypassed | ❌ DNS bypassed | ❌ DNS bypassed | ❌ DNS bypassed |
| Chrome Secure DNS | ❌ Chrome DNS bypassed | ❌ Chrome bypassed | ❌ Chrome bypassed | ❌ Chrome bypassed |

When DNS inspection is unavailable, Apollo honestly reports the limitation (per the Private DNS corrections already applied). Link checking, manual investigation, and all non-DNS protections continue operating where supported.

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

### Stage 1: Threat Intelligence Lifecycle (Backend Only)

**Scope:** Extend `BlocklistEntry` to `ThreatIndicator`, implement revalidation loop, implement dynamic bundle generation.

**Changes:**
- New `ThreatIndicator` model in `core/models.py`
- Migration script to convert existing blocklist entries
- `threat_revalidation_loop` in maintenance worker
- Dynamic `/api/guarddog/rules` endpoint (replaces static dict)
- Admin endpoints for indicator management

**Risk:** Low — backend-only, no native changes required.

### Stage 2: Link Gate → Site Gate Bridge (Backend + JS)

**Scope:** When Link Gate confirms a hostname as malicious (multi-source), submit it as a ThreatIndicator for backend validation and expedited publication.

**Changes:**
- `POST /api/threat-indicators/submit` endpoint with full validation
- JS-layer submission logic in `GuardDogProductionSecurityAdapter.ts`
- Urgent refresh reporting (was new version installed? what version?)

**Risk:** Medium — new publication path, requires testing.

### Stage 3: Hash-Prefix Live Reputation (Backend + Native)

**Scope:** Privacy-preserving live checks for unknown DNS hostnames.

**Changes:**
- `POST /api/intel/dns-check` hash-prefix endpoint
- Native `DnsGatewayPacketHandler` modification to trigger async checks
- On-device hash-prefix cache
- Warning-only enforcement for live findings

**Risk:** High — native DNS pipeline modification, latency-sensitive.

### Stage 4: Cryptographic Signing (Future, If Approved)

**Scope:** Ed25519 signing and verification.

**Changes:**
- Key generation and secrets management
- Backend signing at bundle publication
- `RuleBundleValidator.kt` signature verification
- Key rotation mechanism

**Risk:** Medium — cryptographic implementation must be correct.

---

## H. Documentation Corrections Required

Before implementation, these existing documents must be corrected:

1. **`LINK_GATE_SITE_GATE_BRIDGE_DESIGN.md`** — Remove all "signed bundle" claims. Replace with "HTTPS-authenticated bundle". Note cryptographic signing as a future improvement.

2. **`SITE_GATE_INVESTIGATION_REPORT.md`** — Add a section noting that the rule bundle is currently static with 1 rule and no automated threat-intelligence connection.

3. **All code comments** referencing "signed rules" — Update to "HTTPS-authenticated rules".

---

*This document is a design proposal. No implementation has been started. All stages require explicit approval before proceeding. The acceptance criteria in §F must each be independently demonstrated.*
