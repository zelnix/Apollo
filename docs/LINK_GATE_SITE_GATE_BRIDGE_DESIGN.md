# Link Gate → Site Gate Intelligence Bridge — Design Proposal

**Status:** DESIGN ONLY — Awaiting approval before implementation
**Date:** October 2026

---

## 1. Problem Statement

Site Gate and Link Gate share a rule bundle but have no real-time intelligence bridge. When Link Gate confirms a domain as malicious (via backend intelligence + Higgins assessment), that finding does not reach Site Gate's native DNS protection until the periodic rule bundle refresh occurs (now reduced from 6 hours to 2 hours, but still a significant window).

## 2. Design Constraint: ALLOW-Only Override Store

The existing `WebsiteGateOverrideStore` is ALLOW-only by design. It permits users to trust domains that were incorrectly flagged. **This design does NOT propose extending it to support BLOCK operations.** Arbitrary BLOCK capabilities in the override store would bypass the rule validation, authorization, and rollback protections that the rule bundle mechanism provides.

## 3. Proposed Approach: Verified Threat Indicator Submission

### Architecture

```
Link Gate (JS) → Backend API → Rule Bundle Service → Signed Emergency Bundle → Device Pull
       │                                                                        │
       └──── triggerUrgentRuleRefresh() ─────────────────────────────────────────┘
```

### Flow

1. **Link Gate confirms a malicious domain** (backend `/intel/check` returns `verdict: "malicious"` with high confidence, confirmed by multiple intelligence sources — NOT by AI-only assessment).

2. **JS layer submits a "verified threat indicator"** to the backend:
   ```
   POST /api/threat-indicators/submit
   {
     "hostname": "evil-phishing.example.com",
     "verdict": "malicious",
     "confidence": "high",
     "sources": ["intel_check", "investigation"],
     "intel_digest": "sha256:...",
     "device_id": "...",
     "submitted_at": "2026-10-10T12:00:00Z"
   }
   ```

3. **Backend validates the submission:**
   - Confirms the domain was indeed flagged `malicious` by the intelligence service (cross-references the intel digest)
   - Verifies the domain is not in an exemption list (e.g., major banks, CDNs, government sites)
   - Applies false-positive safety checks (domain age, popularity, TLD reputation)
   - If validated: adds the hostname to the next emergency rule bundle

4. **Backend publishes an emergency rule bundle update:**
   - Signed with the same key as regular bundles (preserving existing authorization)
   - Includes only the delta (new rules since last full bundle)
   - Published to the same CDN endpoint with an incremented version number

5. **Device pulls the updated bundle:**
   - The `triggerUrgentRuleRefresh()` call (already implemented) triggers an immediate `WorkManager` job
   - The existing `ApolloGuardDogRefreshWorker` fetches the latest bundle from the CDN
   - The existing `GuardDogSDKEngine.loadRules()` validates and installs the new rules
   - All existing validation, signature verification, and rollback protections apply

### What This Design Preserves

| Requirement | How It's Met |
|-------------|-------------|
| Rule validation | Backend validates before adding to bundle; device validates signed bundle |
| Authorization | Same signing key; same bundle format; same installation path |
| Rollback | Same rollback mechanism — bundle version tracking, previous-version persistence |
| No uncertain/AI-only blocking | Submission requires `verdict: "malicious"` from intelligence sources, NOT just Higgins |
| No false positives | Backend exemption list + popularity check + domain age check |
| Evidence independence | Enforcement evidence still requires real packet-drop proof |
| Timely delivery | `triggerUrgentRuleRefresh()` pulls within seconds of the backend publishing |

### What This Design Does NOT Do

- Does **not** extend the override store to support BLOCK operations
- Does **not** allow arbitrary domains to be blocked without backend validation
- Does **not** turn Higgins's AI-only assessments into blocking rules (only verified intelligence)
- Does **not** bypass the signed-bundle authorization chain
- Does **not** modify the VPN or DNS pipeline — it uses the existing rule-matching mechanism

## 4. Backend Implementation Required

The backend needs a new endpoint and a modified rule bundle publishing workflow:

### New Endpoint: `POST /api/threat-indicators/submit`

**Input validation:**
- `hostname` must be a valid domain (not IP, not URL path)
- `verdict` must be `"malicious"` (other verdicts are rejected)
- `confidence` must be `"high"` (medium/low verdicts are logged but not acted upon)
- `intel_digest` must match a recent intelligence check result on file

**Safety checks:**
- Domain must NOT be in the Alexa/Tranco top-10K popularity list
- Domain must NOT be in the exemption list (banks, CDNs, cloud providers)
- Domain registration age must be checked (very new domains get less scrutiny delay)
- Rate limiting: max 10 submissions per device per hour

**Output:** `{ "accepted": true, "rule_eta_seconds": 30 }` or `{ "accepted": false, "reason": "..." }`

### Modified Bundle Publishing

- When a verified threat indicator is accepted, add it to the "emergency delta" queue
- Every 30 seconds (if the queue is non-empty), publish a new signed bundle version
- The delta bundle includes only new rules; devices merge it with their existing full bundle
- Standard periodic full-bundle refresh continues on the 2-hour cycle

## 5. Estimated Implementation Effort

| Component | Effort | Risk |
|-----------|--------|------|
| Backend endpoint + validation | Medium | Low — uses existing intelligence data |
| Emergency bundle publishing | Medium | Medium — new publishing path needs testing |
| JS-side submission (already mostly wired) | Small | Low — `triggerUrgentRuleRefresh()` exists |
| End-to-end testing | Medium | Medium — requires native build + backend coordination |

## 6. Approval Required For

1. The backend endpoint design and safety check criteria
2. The emergency bundle publishing workflow
3. The submission confidence threshold (currently proposed: only `"high"` + `"malicious"`)
4. The rate limiting parameters
5. The exemption list scope

**No native rule authorization changes are proposed.** The existing signed-bundle mechanism is reused as-is.

---

*This document is a design proposal. No implementation has been started for the backend components. The JS-side urgent refresh trigger is already implemented and operational.*
