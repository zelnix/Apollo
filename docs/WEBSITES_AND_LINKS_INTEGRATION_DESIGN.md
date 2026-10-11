# Websites & Links — Progressive Investigation Integration Design

## 1. How Site Gate and Link Gate Operate as One Progressive Investigation Workflow

### Current separation

**Site Gate** operates at the DNS layer. It observes hostname resolution requests and acts on them automatically via the native enforcement engine (Android VPN, iOS Safari Content Blocker). It sees hostnames only — never full URLs, paths, or page content.

**Link Gate** operates at the application layer. It analyses full URLs, follows redirects, examines domain reputation, and performs AI-powered investigation of page content. It is triggered by user action (Check this link) or by background content handlers (Text Guard, Email Guard) that extract URLs from messages.

### Unified workflow

The two gates remain separate native engines internally but share intelligence and present one progressive investigation to the user. The workflow is:

```
DNS hostname observed ──► Stage 1: Domain Investigation (Site Gate engine)
                                   │
                          ┌────────┴────────┐
                          │ Known threat     │ Unknown / clean
                          │ (rule match)     │
                          ▼                  ▼
                     Immediate          Live reputation
                     sinkhole           check (bounded)
                          │                  │
                          │         ┌────────┴────────┐
                          │         │ Malicious       │ Clean / unknown
                          │         ▼                 ▼
                          │    Hot rule refresh   Forward DNS
                          │    + sinkhole            │
                          │         │                 │
                          ▼         ▼                 │
                     "growling" event             Normal browsing
                     (detection, not block)           │
                                                      ▼
Full URL available ──────────────────────────► Stage 2: URL Investigation (Link Gate engine)
(from Share Sheet,                                     │
 manual Check,                               ┌────────┴────────┐
 message handler,                            │ Risk signals    │ Clean
 browser extension)                          ▼                 ▼
                                        Stage 3: Redirect    Resolved
                                        investigation         (no threat)
                                             │
                                        Stage 4: Page content
                                        investigation
                                             │
                                        Stage 5: Downloads &
                                        dangerous actions
                                             │
                                        Stage 6: Continued
                                        investigation
```

**Key principle**: Stages are additive. Stage 1 (domain) runs automatically for every DNS query. Stages 2-6 run only when additional information is available. A stage never blocks a previous stage's protection — an already-authorised sinkhole is never delayed for deeper investigation.

### Intelligence flow between gates

When Link Gate confirms a domain as malicious (via full URL investigation), it:
1. Posts the threat to `/api/intel/check` which creates a threat indicator.
2. Calls `securityAdapter.triggerUrgentRuleRefresh()` so Site Gate picks up the new indicator.
3. Site Gate's next DNS query for that domain is blocked by the static rule.

When Site Gate's live reputation check discovers a new malicious domain, it:
1. Backend creates a threat indicator via `_create_threat_indicator()`.
2. Native hot-refreshes the rule bundle (via `hotRefreshRules()`).
3. The domain is now in the static rule bundle for both Site Gate AND Link Gate to reference.

This is the existing intelligence sharing mechanism. The integration design preserves it.

---

## 2. Existing Functions Reused vs Consolidated

### Reused as-is (no changes)

| Function | Location | Used in stage |
|---|---|---|
| `DnsGatewayPacketHandler` | guarddog-vpn | Stage 1 |
| `SinkholeBindingStore.arm()` | guarddog-vpn | Stage 1 |
| `LiveReputationChecker` | guarddog-vpn | Stage 1 |
| `hotRefreshRules()` | ApolloGuardDogProductionRuntime | Stage 1 |
| `analyseUrlLocally()` | risk.ts | Stage 2 |
| `detectAnchorMismatch()` | linkGuard.ts | Stage 2 |
| `/api/intel/check` | intel.py | Stage 2 |
| `/api/link/investigate` | analysis.py | Stages 2–3 |
| `/api/page/extract` | analysis.py | Stage 4 |
| `/api/page/crawl` | analysis.py | Stage 4 |
| `pageAnalysis()` | pageAnalysis.ts | Stage 4 |
| `SiteGuardTruth.rules()` | SiteGuardTruth.swift | Stage 1 (iOS) |
| `Ed25519BundleVerifier` | guarddog-core | Stage 1 (trust) |
| `RuleBundleValidator` | guarddog-core | Stage 1 (trust) |

### Consolidated (shared intelligence, deduplicated lookups)

| Currently duplicated | Consolidation |
|---|---|
| Site Gate queries `/api/guarddog/dns-check` for hostname reputation; Link Gate queries `/api/intel/check` for the same hostname when checking a URL | **Shared indicator cache**: Both endpoints already query `db.threat_indicators`. No change needed — they share the same data store. The deduplication is already in the database layer. |
| Site Gate creates a PatrolEvent with `category: "website"`; Link Gate creates a separate event with `category: "link"` or `"known_threat"` for the same hostname | **Incident linking**: When Link Gate investigates a URL whose hostname already has a Site Gate observation, the Link Gate event should reference the existing observation via `indicator_host` match. ApolloContext should merge them into one consolidated finding (see Section 6). |
| Site Gate shows a "detected" toast; Link Gate would show a "Check Result" screen for the same domain | **Single notification**: If Site Gate already detected and showed a "growling" event for a domain, Link Gate's deeper investigation UPDATES the existing event rather than creating a new one (see Section 6). |

### Not consolidated (intentionally separate)

| Function | Why separate |
|---|---|
| Site Gate DNS interception vs Link Gate URL analysis | Different inputs (hostname vs full URL), different evidence, different platforms |
| Android VPN enforcement vs iOS Content Blocker | Different native APIs, different enforcement mechanisms |
| Live reputation check (Stage 1) vs full link investigation (Stage 2) | Stage 1 is DNS-latency-bound (~3s); Stage 2 has no latency constraint |
| `pageAnalysis()` vs `analyseUrlLocally()` | Different inputs (page content vs URL structure), complementary signals |

---

## 3. Trigger, Evidence Requirements, and Possible Outcomes of Each Stage

### Stage 1 — Domain Investigation

**Trigger**: Every DNS query intercepted by the native VPN (Android) or content blocker rule evaluation (iOS).

**Evidence sources**:
- Local rule bundle: exact-match hostname rules (threat indicators, controlled verification)
- Live reputation: `/api/guarddog/dns-check` with hostname → Safe Browsing, local indicators
- Rule bundle freshness: `expiresAt`, `bundleVersion`, Ed25519 signature validity

**Possible outcomes**:

| Outcome | Evidence | Action | Apollo state |
|---|---|---|---|
| Known threat (rule match) | Signed rule bundle, exact host match | Sinkhole DNS response via `arm()` | "growling" (detection, not verified block) |
| Live malicious (new discovery) | External intelligence (Safe Browsing), threat indicator created, hot-refreshed rule | Sinkhole DNS response via `arm()` after hot refresh | "growling" |
| Clean / unknown | No rule match, live check returned clean/unknown | Forward DNS normally | No event |
| Live check timeout | Backend unreachable within 2.5s | Forward DNS (fail-open) | No event |
| Live check unavailable | No backend URL configured, no auth token | Forward DNS | No event |

**What this stage does NOT do**:
- Does not inspect full URLs, paths, or query strings (DNS is hostname-only)
- Does not verify that a TCP/TLS connection was actually dropped (sinkhole ≠ block)
- Does not claim "biting" — only "growling" (detection + DNS prevention)

### Stage 2 — Full-URL Investigation

**Trigger**: 
- User taps "Check this link" (manual)
- Share Sheet receives a URL (Android share target, iOS share extension)
- Text Guard / Email Guard extracts a URL from a message (background)
- Browser extension supplies the current URL (where available)

**Evidence sources**:
- `analyseUrlLocally()`: URL structure, suspicious TLDs, brand lookalikes, shorteners, credential words
- `detectAnchorMismatch()`: display text vs actual href
- `/api/intel/check`: Safe Browsing reputation, redirect chain, final URL, domain age
- `/api/link/investigate`: Higgins AI investigation with full URL context

**Possible outcomes**:

| Outcome | Evidence | Action | Apollo state |
|---|---|---|---|
| Malicious | Safe Browsing match + AI assessment confirms | Create threat indicator, urgent rule refresh, "barking" event | "barking" |
| Suspicious | Risk signals (brand lookalike, credential lure, etc.) | "growling" event with advisory | "growling" |
| Clean | No signals, Safe Browsing clean, AI assessment clean | "resting" event (traceable but no alert) | "resting" |
| Unknown | Intelligence unavailable or partial | Record limitation, no claim of safety | "ears_up" or "resting" with limitation noted |

**What this stage does NOT do**:
- Does not delay Stage 1 blocking (already-authorised sinkholes are immediate)
- Does not inspect page content (that's Stage 4)
- Does not claim verified connection blocking

### Stage 3 — Redirect and Destination Investigation

**Trigger**: Automatically during Stage 2 when `/api/intel/check` returns redirect chain data.

**Evidence sources**:
- `intel.redirect_chain`: sequence of HTTP redirects observed by the backend
- `intel.final_url`: the terminal destination after redirects
- Each intermediate hostname checked against threat indicators

**Possible outcomes**:

| Outcome | Evidence | Action |
|---|---|---|
| Redirect to known malicious domain | Intermediate or final hostname in threat indicators | Escalate to "barking", create indicator for redirect source |
| Suspicious redirect pattern | Shortened URL → multiple redirects → suspicious TLD | Add "redirect_chain" signal to investigation findings |
| Clean redirect | All destinations clean, redirect pattern normal | No additional action |
| Redirect data unavailable | HTTPS redirects not visible to VPN | Record limitation: "redirect chain not observable" |

**Deduplication**: The redirect chain is checked once during the `/api/intel/check` call. Each unique hostname in the chain is checked against threat indicators. Results are cached. No repeated lookups for the same hostname within the same investigation.

### Stage 4 — Website Content Investigation

**Trigger**: 
- User taps "Investigate page" on a Check Result screen
- Automatic when the browser extension or content handler provides page content/screenshot
- `/api/page/extract` (screenshot vision analysis) or `/api/page/crawl` (text extraction)

**Evidence sources**:
- `pageAnalysis()`: on-device rule engine checking for phishing indicators, impersonation, fake warnings
- Gemini vision: security signal extraction from page screenshot
- Higgins AI: assessment of page content against known fraud patterns

**Possible outcomes**:

| Outcome | Evidence | Action |
|---|---|---|
| Phishing / credential harvesting | Page contains login form + brand impersonation signals | "barking" event, threat indicator created |
| Fake security warning / tech support scam | Vision detects fake error/warning UI | "barking" event with specific explanation |
| Fraudulent payment request | Payment form + suspicious domain | "barking" event |
| Clean page | No fraud indicators detected | Investigation complete, no escalation |

**Privacy**: Page content analysis requires explicit user action OR existing privacy-screening controls (sanitisation receipt for screenshots). The backend never stores page content. Vision extraction is request-scoped.

### Stage 5 — Downloads and Dangerous Actions

**Trigger**: Coordinates with File Gate when a download is detected from a URL under investigation.

**Evidence sources**:
- Download source hostname (checked via Stage 1 intelligence)
- File type and size signals (from File Gate)
- Known malicious download sources in threat indicators

**Possible outcomes**: Delegated to File Gate. Websites & Links provides the source reputation; File Gate provides the file-level assessment. Results are linked via `indicator_host`.

### Stage 6 — Continued Investigation

**Trigger**: New intelligence arrives for a hostname or URL already under investigation.

**Evidence sources**:
- Periodic rule bundle refresh (new threat indicators)
- Threat revalidation service (`threat_revalidation.py`)
- Updated Safe Browsing data

**Possible outcomes**:

| Outcome | Evidence | Action |
|---|---|---|
| Previously clean domain now malicious | New threat indicator from external intelligence | Update existing event, escalate state, create rule |
| Previously malicious domain now clean | Threat indicator expired or removed | De-escalate existing event, note resolution |
| No change | Intelligence unchanged | No action |

**Deduplication**: Each investigation is linked to one incident via `event_id`. Updates modify the existing event rather than creating new events. The `seenDnsObsRef` set prevents duplicate DNS observation events. The `handoffDedupe.ts` module prevents duplicate background check submissions.

---

## 4. How Each Platform Supports the Six Stages

### Android

| Stage | Support | Mechanism | Automatic |
|---|---|---|---|
| 1. Domain | Full | VPN DNS interception → `DnsGatewayPacketHandler` → sinkhole | Yes |
| 2. Full URL | Partial | Share Sheet intake, Text Guard URL extraction, manual Check | Manual or message-triggered |
| 3. Redirects | Full | Backend `/api/intel/check` returns redirect chain | Automatic during Stage 2 |
| 4. Page content | Partial | Manual screenshot + vision analysis, page crawl | User-initiated |
| 5. Downloads | Partial | Source reputation via Stage 1; File Gate coordination | Automatic for source, manual for file |
| 6. Continued | Full | Periodic rule refresh, threat revalidation | Automatic |

**Enforcement evidence**: DNS sinkhole response (detection, not verified block). Verified TCP/TLS packet drops would require `EnforcementEvidence` from the VPN's packet processing — currently not implemented for live reputation checks.

**Limitations**: Encrypted DNS (DoH/DoT) bypasses the VPN. Full URLs are not visible at the DNS layer. Page content requires user action.

### iOS / iPadOS

| Stage | Support | Mechanism | Automatic |
|---|---|---|---|
| 1. Domain | Partial | Safari Content Blocker extension (`SiteGuardTruth.rules()`) | Automatic in Safari only |
| 2. Full URL | Partial | Share Extension, iOS Message Filter, manual Check | Manual or message-triggered |
| 3. Redirects | Full | Backend redirect chain analysis | Automatic during Stage 2 |
| 4. Page content | Partial | Manual screenshot + vision analysis | User-initiated |
| 5. Downloads | Limited | Source reputation via Stage 2 | Manual |
| 6. Continued | Full | Periodic rule refresh updates Content Blocker rules | Automatic |

**Enforcement evidence**: Safari Content Blocker rules prevent page load for matched domains. iOS does not provide packet-level enforcement evidence to the app.

**Limitations**: Content Blocker only works in Safari (not Chrome, Firefox, in-app browsers). No VPN DNS interception. iOS Message Filter has restricted access to message content. Full-URL visibility requires Share Extension or Message Filter.

### Windows

| Stage | Support | Mechanism | Automatic |
|---|---|---|---|
| 1. Domain | None | No VPN or DNS interception capability | N/A |
| 2. Full URL | Partial | Manual Check, browser extension (if available) | Manual |
| 3. Redirects | Full | Backend redirect chain analysis | Automatic during Stage 2 |
| 4. Page content | Partial | Page crawl via backend | Manual |
| 5. Downloads | None | No native file interception | N/A |
| 6. Continued | Full | Periodic intelligence refresh | Automatic |

**Enforcement evidence**: None — advisory only. No native blocking capability.

**Limitations**: No automatic DNS or browser interception. All protection is user-initiated or advisory.

### macOS

| Stage | Support | Mechanism | Automatic |
|---|---|---|---|
| 1. Domain | None | No VPN or DNS interception (could add Safari extension) | N/A |
| 2. Full URL | Partial | Manual Check, Safari extension (if available) | Manual |
| 3. Redirects | Full | Backend redirect chain analysis | Automatic during Stage 2 |
| 4. Page content | Partial | Page crawl via backend | Manual |
| 5. Downloads | None | No native file interception | N/A |
| 6. Continued | Full | Periodic intelligence refresh | Automatic |

**Enforcement evidence**: None — advisory only.

**Limitations**: Same as Windows. Safari extension could provide Content Blocker rules (same mechanism as iOS) but is not currently implemented.

---

## 5. How Investigation Results Feed Authorised Protection

### Protection authorisation chain

```
External intelligence (Safe Browsing)
            │
            ▼
   Threat indicator created
   (db.threat_indicators)
            │
            ▼
   Rule bundle generated
   (/api/guarddog/rules)
            │
            ▼
   Ed25519 signed by pinned key
   (PINNED_SIGNING_PUBLIC_KEY)
            │
            ▼
   Native validator accepts bundle
   (RuleBundleValidator → schema + version + signature)
            │
            ▼
   Engine stores accepted rules
   (GuardDogSDKEngine.acceptWebsiteGateRuleBundle)
            │
            ▼
   SinkholeBindingStore.arm() succeeds
   (authorizeWebsiteGateTarget → exact match → Approved)
            │
            ▼
   DNS sinkhole response issued
```

**No shortcut**: Every blocking action goes through the full chain. There is no path from "intelligence says malicious" to "DNS blocked" that bypasses the signed rule bundle, the native validator, or the engine's authorization check.

**Live reputation hot-refresh**: When a live check discovers a new threat, the hot-refresh fetches the updated bundle (which now includes the new indicator as a rule), validates it through the same chain, and applies it to the running engine. The subsequent `arm()` call succeeds through the normal authorization path.

**Link Gate → Site Gate**: When `checkLink()` confirms a malicious domain, it calls `triggerUrgentRuleRefresh()`. This fetches the latest bundle (which includes any new indicators created by the link investigation's `/api/intel/check` call). Site Gate's rules are updated through the same authorized chain.

**False-positive overrides**: User ALLOW overrides in `WebsiteGateOverrideStore` are checked in `arm()` BEFORE rule authorization. A user can override a false positive without modifying the signed rule bundle.

---

## 6. How Apollo and Higgins Present One Coherent Result

### Unified event model

All Websites & Links findings use the same `PatrolEvent` structure with these categories:
- `"website"` — Site Gate DNS observations (automatic, background)
- `"link"` — Link Gate URL investigations (user-initiated or message-triggered)
- `"known_threat"` — either gate confirmed a known malicious indicator

### Event merging rules

When Link Gate investigates a URL whose hostname already has a Site Gate observation:

1. **Match condition**: `indicator_host` of the new Link Gate event matches `indicator_host` of an existing Site Gate event.

2. **Merge behaviour**: The Link Gate event UPDATES the existing event rather than creating a new one:
   - `headline` → upgraded to Higgins investigation headline
   - `what_happened` → expanded with full URL findings
   - `why` → enriched with investigation findings
   - `state` → escalated if justified (growling → barking) but never downgraded
   - `category` → preserved as the more specific category
   - `evidence_provenance` → recorded as `"progressive_investigation"`

3. **Deduplication**: The `seenDnsObsRef` set prevents duplicate DNS observation events. The `handoffDedupe.ts` module prevents duplicate background checks. The `indicator_host` match prevents duplicate findings for the same domain.

### Higgins as primary explanatory voice

For all Websites & Links findings, Higgins provides:
- **Headline**: One sentence describing what was found
- **What was found**: Evidence-backed findings from the deepest completed stage
- **Next action**: One clear instruction for the user

Higgins MUST distinguish:
- "Apollo detected a known threat" (Stage 1 detection)
- "Apollo redirected the DNS response" (Stage 1 DNS prevention — not "blocked")
- "This link appears dangerous" (Stage 2 URL investigation)
- "This page contains phishing indicators" (Stage 4 content analysis)
- "Apollo confirmed this connection was blocked" (ONLY with verified enforcement evidence)

### User-facing presentation

**Automatic (background)**: One toast notification for the first detection. No repeated alerts for the same hostname. The event appears in Patrol with full investigation details.

**Manual Check**: Full-screen Check Result showing the progressive investigation:
1. Local URL analysis results (immediate)
2. Intelligence check results (within 1-2 seconds)
3. Higgins investigation (within 3-5 seconds)
4. Page analysis (if requested by user)

**Home screen**: The attention card shows the most significant active finding. `protectionExplainer.ts` explains what protection is active and its coverage.

---

## 7. Threat Lab Verification Scenarios

### Scenario 1: Known blocked destination (Stage 1 static rule)

**Setup**: Apollo has a signed rule bundle containing `apolloverify.harmonywellnessgroup.com.au` with `action: block`.

**Threat Lab action**: Open a browser and navigate to `https://apolloverify.harmonywellnessgroup.com.au`.

**Expected observations**:
1. DNS query intercepted by VPN
2. `DnsGatewayPacketHandler.handle()` → `bindingStore.arm()` → authorized by exact-match rule → sinkhole response
3. Browser shows "can't reach this site" or similar
4. `DnsThreatObservation` created with `evidenceType: "dns_observation"`
5. PatrolEvent: `state: "growling"`, `category: "website"`, `verified_block: false`
6. Toast: "Apollo detected a known threat"
7. NO claim of "blocked" or "biting" — this is a DNS-level detection

**Verification data**: Rule bundle version, `ruleId` of matching rule, sinkhole IPv4 allocated, observation timestamp.

### Scenario 2: Unknown destination requiring live intelligence (Stages 1-2)

**Setup**: Apollo has no existing indicator for `suspicious-test-domain.example.com`. Safe Browsing has no data on it (clean).

**Threat Lab action**: Open a browser and navigate to `https://suspicious-test-domain.example.com`.

**Expected observations**:
1. DNS query intercepted → no rule match → triggers live reputation check
2. `LiveReputationChecker.checkBounded()` → `/api/guarddog/dns-check` with hostname
3. Backend calls Safe Browsing → returns clean → forwards DNS
4. Browser loads the page normally
5. No PatrolEvent created (clean verdict)
6. No notification, no "growling"

**Verification data**: Live check request/response logged, Safe Browsing response, no sinkhole binding created.

### Scenario 3: Unknown malicious destination (Stages 1 with live discovery)

**Setup**: A hostname with a known-malicious Safe Browsing verdict that is NOT in Apollo's rule bundle.

**Threat Lab action**: Navigate to the malicious hostname.

**Expected observations**:
1. DNS query intercepted → no rule match → live reputation check
2. Backend calls Safe Browsing → returns malicious → creates threat indicator
3. Backend returns `verdict: "malicious"` to native
4. `DnsGatewayPacketHandler`: `arm()` fails (not in bundle yet) → triggers `hotRefreshRules()` on background thread → waits up to 2.5s → `arm()` succeeds → sinkhole response
5. Browser shows "can't reach this site"
6. PatrolEvent: `state: "growling"`, `verified_block: false`
7. Rule bundle version bumped (new indicator included)

**Verification data**: Live check response, threat indicator in database, rule bundle version before and after, hot-refresh timing, sinkhole binding.

### Scenario 4: Manual link check with progressive investigation (Stages 2-4)

**Threat Lab action**: Open Apollo → Check this link → paste a suspicious URL (e.g., a brand-lookalike domain with credential lure).

**Expected observations**:
1. `analyseUrlLocally()` → signals: `brand_lookalike`, `credential_lure` → score ≥ 40 → "suspicious"
2. `/api/intel/check` → Safe Browsing + redirect chain
3. `/api/link/investigate` → Higgins AI investigation → findings
4. Check Result screen shows progressive investigation findings
5. PatrolEvent created with full investigation evidence
6. If user taps "Investigate page" → `/api/page/extract` → Stage 4 findings appended

**Verification data**: Local analysis score and signals, intel check response, investigation findings, Higgins headline and next action.

### Scenario 5: Site Gate + Link Gate coordination (intelligence sharing)

**Threat Lab action**: 
1. Manually check a suspicious link in Apollo (Link Gate confirms malicious)
2. Then navigate to the same domain in a browser

**Expected observations**:
1. Link Gate creates threat indicator + calls `triggerUrgentRuleRefresh()`
2. Rule bundle updated with new indicator
3. Browser DNS query → Site Gate → rule match → sinkhole
4. ONE consolidated event in Patrol (not two separate events)

**Verification data**: Threat indicator creation timestamp, rule bundle version bump, Link Gate event ID, Site Gate observation referencing same `indicator_host`.

### Scenario 6: VPN stability through rule refresh

**Threat Lab action**: Trigger multiple live reputation checks in rapid succession (navigate to several unknown domains quickly).

**Expected observations**:
1. Each live check runs independently
2. Hot-refresh threads are bounded (daemon threads with 2.5s join timeout)
3. VPN service remains stable — no stop/restart, no deadlock
4. DNS processing continues for other queries during the refresh
5. Protection status remains "operational" throughout

**Verification data**: VPN service uptime, DNS processing latency for concurrent queries, no `stopped` → `started` in service logs.

### Scenario 7: False positive handling

**Threat Lab action**: Apollo flags a legitimate domain as suspicious. User taps "Trust this site".

**Expected observations**:
1. Trust override stored via `trustEvent()`
2. `WebsiteGateOverrideStore` updated with ALLOW override
3. Subsequent DNS queries for the domain → `arm()` checks override first → returns null → DNS forwarded
4. Link Gate's `decide()` checks trust list → "resting" instead of "growling"
5. No notification for the trusted domain

**Verification data**: Trust override in store, `arm()` returning null due to override, no sinkhole binding.

---

## Implementation Priority

1. **Stage 1 (Domain)**: Already implemented. Corrections completed (P0-A, P0-B, signed-rule trust, refresh behaviour, detection messages). Ready for device acceptance.

2. **Event merging** (Section 6): New logic needed in ApolloContext.tsx to deduplicate Site Gate + Link Gate events for the same hostname. This is the primary integration work.

3. **Stages 2-3**: Already implemented via `checkLink()`, `/api/intel/check`, `/api/link/investigate`. No new code needed — these already produce progressive investigation results.

4. **Stage 4**: Already implemented via `/api/page/extract` and `/api/page/crawl`. Triggered by user action.

5. **Stages 5-6**: Coordination with File Gate (existing) and threat revalidation (existing). No new code needed.

6. **Cross-platform documentation**: Explicitly document what each platform can and cannot do (this document serves as that documentation).

---

## Remaining Known Limitations

| Limitation | Platforms affected | Mitigation |
|---|---|---|
| Encrypted DNS (DoH/DoT) bypasses VPN | Android | Document; no VPN redesign |
| DNS interception is hostname-only | Android | Stages 2-6 add URL/content analysis when available |
| Safari Content Blocker only works in Safari | iOS | Document; no new browser interception |
| No automatic DNS interception | iOS, Windows, macOS | Share extension, manual Check, message handlers |
| No verified connection-block evidence | All platforms (current) | "growling" only; "biting" reserved for future EnforcementEvidence |
| Page content analysis requires user action | All platforms | Explicit design: no covert inspection of encrypted browsing |
| Ed25519 unavailable on Android 8-12 | Android API 26-32 | Graceful degradation: HTTPS-only authentication |
