# Link Gate → Site Gate Intelligence Bridge — Revised Design Proposal

**Status:** DESIGN ONLY — Awaiting approval before implementation  
**Date:** October 2026 (Revised)  
**Revision note:** Corrected to accurately describe the HTTPS-only rule authentication model. Removed all claims of cryptographic signing that do not match the actual implementation.

---

## 1. Problem Statement

Site Gate and Link Gate share a rule bundle but have no real-time intelligence bridge. When Link Gate confirms a domain as malicious (via backend intelligence + multi-source verification), that finding does not reach Site Gate's native DNS protection until the periodic rule bundle refresh occurs (currently every 2 hours).

The rule bundle is currently a **static Python dict** with a single controlled-verification rule. It has no automated connection to the managed blocklist or external threat intelligence.

## 2. Design Constraints

### 2.1 ALLOW-Only Override Store

The existing `WebsiteGateOverrideStore` is ALLOW-only by design. It permits users to trust domains that were incorrectly flagged. **This design does NOT propose extending it to support BLOCK operations.** Arbitrary BLOCK capabilities in the override store would bypass the rule validation, authorization, and rollback protections that the rule bundle mechanism provides.

### 2.2 HTTPS-Only Authentication (Current Reality)

The current rule bundle is authenticated via **HTTPS only** (TLS + baked-in URL in the signed APK). There are:
- No Ed25519 or RSA signing keys
- No signature field in the `RuleBundle.kt` data class
- No signature verification in `RuleBundleValidator.kt`

Authentication depends on: TLS transport security + APK origin binding + schema validation + version rollback protection.

**Cryptographic signing is a future improvement** (see `THREAT_INTELLIGENCE_ARCHITECTURE.md` §D.4), not a current capability.

## 3. Proposed Approach: Backend-Verified Threat Publication

### Architecture

```
Link Gate (JS) → Backend API → Threat Indicator Validation → Dynamic Bundle Generation → Device Pull
       │                                                                                    │
       └──── triggerUrgentRuleRefresh() ────────────────────────────────────────────────────┘
```

### Flow

1. **Link Gate confirms a malicious hostname** — backend `/api/intel/check` returns `verdict: "malicious"` with confirmation from **multiple independent sources** (not a single source, not AI-only).

2. **JS layer submits a "verified threat indicator"** to the backend:
   ```
   POST /api/threat-indicators/submit
   {
     "hostname": "evil-phishing.example.com",
     "verdict": "malicious",
     "confidence": "high",
     "sources": ["google_safe_browsing", "apollo_blocklist"],
     "intel_digest": "sha256:...",
     "device_id": "...",
     "submitted_at": "2026-10-10T12:00:00Z"
   }
   ```

3. **Backend validates the submission independently:**
   - Confirms the hostname (not URL path) was flagged `malicious` by the intelligence service
   - Verifies **multiple independent sources** confirmed the finding (single-source → queued for review, not auto-published)
   - Checks the hostname is not in an exemption list (major banks, CDNs, government sites, cloud providers)
   - Confirms the original evidence scope: URL-path-only findings are **not promoted** to hostname-wide blocks
   - Rate limiting: max 10 submissions per device per hour
   - If validated: creates a `ThreatIndicator` with full provenance and verification metadata

4. **Backend publishes an updated rule bundle:**
   - Generated dynamically from active, verified `ThreatIndicator` records
   - Includes the new hostname as a BLOCK rule
   - `bundleVersion` incremented, `issuedAt` and `expiresAt` updated deterministically
   - Delivered via the existing `/api/guarddog/rules` endpoint over HTTPS

5. **Device pulls the updated bundle:**
   - `triggerUrgentRuleRefresh()` triggers an immediate `WorkManager` fetch
   - The existing `ApolloGuardDogRefreshWorker` fetches the latest bundle
   - `RuleBundleValidator` validates schema, version, temporal bounds, and rollback protection
   - **Urgent refresh reports back**: whether a new version was installed, what version, or "no update available"

### What This Design Preserves

| Requirement | How It's Met |
|-------------|-------------|
| Rule validation | Backend validates provenance and multi-source confirmation before publishing; device validates schema, version, temporal bounds |
| Authentication | HTTPS-only (TLS + baked-in URL in signed APK). NOT cryptographically signed. |
| Rollback protection | Device-side `bundleVersion` comparison + SHA-256 content hash conflict detection |
| No AI-only blocking | Submission requires multi-source `verdict: "malicious"`, never Higgins/Gemini assessment alone |
| No single-source blocking | Backend requires ≥2 independent source confirmations for automatic publication |
| No path-to-hostname promotion | URL-path-specific findings stay in reputation cache, never become hostname blocks |
| Evidence independence | Enforcement evidence still requires real packet-drop proof (DNS observation → sinkhole → packet drop) |
| No false claims | Urgent refresh reports whether rules were actually updated, not just requested |

### What This Design Does NOT Do

- Does **not** claim cryptographic signature verification exists (it does not)
- Does **not** extend the override store to support BLOCK operations
- Does **not** allow arbitrary domains to be blocked without backend validation
- Does **not** turn Higgins/Gemini AI assessments into blocking rules
- Does **not** allow a single unchecked report or client assertion to authorise blocking
- Does **not** modify the VPN or DNS pipeline — it uses the existing rule-matching mechanism
- Does **not** require users to disable Private DNS

## 4. Backend Implementation Required

### New Endpoint: `POST /api/threat-indicators/submit`

**Input validation:**
- `hostname` must be a valid domain (not IP, not URL path)
- `verdict` must be `"malicious"` (other verdicts rejected)
- `confidence` must be `"high"` (medium/low logged, not acted upon)
- `intel_digest` must match a recent intelligence check result on file
- `sources` must contain ≥2 independent source confirmations

**Safety checks:**
- Hostname must NOT be in the exemption list (banks, CDNs, cloud providers, government)
- Original evidence scope must be hostname-level (not URL-path-only promotion)
- Rate limiting: max 10 submissions per device per hour

**Output:** `{ "accepted": true, "indicator_id": "...", "bundle_eta_seconds": 120 }` or `{ "accepted": false, "reason": "..." }`

### Dynamic Bundle Generation

Replace the static `PRODUCTION_RULES` dict with a query against the `threat_indicators` collection:
- Select indicators where `status == "active"` AND `verification_deadline > now`
- Generate a `RuleBundle` with incremented version
- Deterministic `issuedAt`/`expiresAt` (not wall-clock) per the existing code comment

### Urgent Refresh Reporting

When `triggerUrgentRuleRefresh()` is called:
- Native layer fetches the bundle
- Reports back to JS: `{ "previousVersion": 2, "newVersion": 3, "installed": true }` or `{ "previousVersion": 2, "newVersion": 2, "installed": false, "reason": "no_new_version" }`
- JS layer can then honestly report whether the refresh was effective

## 5. Approval Required For

1. The backend endpoint design and multi-source validation criteria
2. The dynamic bundle generation workflow
3. The submission confidence threshold (proposed: only `"high"` + `"malicious"` + ≥2 sources)
4. The rate limiting parameters
5. The exemption list scope and maintenance

**No native rule authorization changes are proposed.** The existing HTTPS-authenticated bundle mechanism is reused as-is.

**Cryptographic signing** is proposed separately in `THREAT_INTELLIGENCE_ARCHITECTURE.md` §D.4 and requires its own approval.

---

*This document is a revised design proposal. No implementation has been started for the backend components. The JS-side urgent refresh trigger is already implemented and operational.*
