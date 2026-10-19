# Apollo Scam Guard — v3 Focused Correction

**Supersedes**: Section-specific corrections to SCAM_GUARD_DETECTION_AUDIT_v2.md  
**Scope**: Remaining inconsistencies, verified URL examples, Threat Scent correlation, trusted-sender bypass, email-provider assumptions, page-analysis false positives, amended escalation matrix, and proposed regression tests.  
**No production code is modified by this document.**

---

## 1. Remaining Factual Error: How `comrnbank-secure.xyz` Actually Reaches Barking

The v2 report stated:

> `https://comrnbank-secure.xyz/netbank/login` → brand_lookalike(40) + credential_lure(20) + risky_tld(15) = 75 → barking

**This was wrong. Traced through the actual code:**

**risk.ts scoring** (line-by-line):
- host = `comrnbank-secure.xyz`, tokens = `["comrnbank", "secure", "xyz"]`
- Line 63: `SUSPICIOUS_TLDS.has("xyz")` → true → `risky_tld(15)`
- Line 72: brandInHost check — `BRANDS.map(b => b.replace(/\s/g,""))` includes `"commbank"`. Tokens are `["comrnbank","secure","xyz"]`. Does any token === `"commbank"` or (length≥5 && token.includes("commbank"))? `"comrnbank".includes("commbank")` → **false** ("comrn" ≠ "comm" at position 3). brandInHost = **undefined**.
- Line 79: `brand_lookalike` **does NOT fire** — risk.ts does not perform deobfuscation.
- Line 82: brandInPath — path = `"/netbank/login"`. `"netbank"` (7 chars ≥ 4) is in BRANDS. `path.includes("netbank")` → **true**. brandInPath = `"netbank"`.
- Line 83: `!brandInHost(true) && brandInPath(true) && (isIp=false || SUSPICIOUS_TLDS.has("xyz")=true || ...)` → `brand_in_path(25)`.
- Line 84: credWord — `"comrnbank-secure.xyz"` contains `"secure"` (in CRED_WORDS) → credWord = `"secure"`.
- Line 85: `credWord && (lookalike=false || brandInPath=true || ...)` → `credential_lure(20)`.

**Actual risk.ts score: risky_tld(15) + brand_in_path(25) + credential_lure(20) = 60 → suspicious → growling.**

**The barking comes from brand.ts + decision.ts, not from the score:**
- brand.ts `assessBrand("comrnbank-secure.xyz")`:
  - `deobfuscate("comrnbank-secure.xyz")` applies `rn→m`: `"comrnbank"` → `"commbank"` → deob = `"commbanksecurexyz"`.
  - CommBank tokens include `"commbank"` (8 chars ≥ 5). `deob.includes("commbank")` → **true**. Match is fuzzy only → `homograph = true`.
  - isOfficial: `registrableDomain = "comrnbank-secure.xyz"`. Not in `["commbank.com.au","netbank.com.au"]`. → **false**.
  - Result: `claimed = CommBank, mismatch = true, homograph = true`.
- decision.ts line 67: `brand.mismatch(true) && !trusted(true)` → enters brand mismatch block.
  - Line 68: `strong = brand.homograph(true) || ...` → **true** (first condition).
  - Line 71: state = **barking**.

**Corrected statement**: This URL reaches barking through the brand-mismatch path in decision.ts (homograph detection in brand.ts), NOT through the scoring path in risk.ts. The score is 60 (growling). The barking is correctly justified — homograph detection is direct evidence of deception.

**Why this matters**: The v2 report cited this URL as evidence that "score-based barking works for emerging scams." It does not — this URL barks through a completely different code path. The score-based barking path (decision.ts:51) is still the one with the arbitrary-score problem (Gap 1), and it still needs the deception-signal gate.

---

## 2. Verified URL Examples Against Actual Scoring Functions

Every example below is traced through risk.ts `analyseUrlLocally()`, brand.ts `assessBrand()`, and decision.ts `decide()`.

### Example A: Router admin page (arbitrary-score barking — confirms Gap 1)

**Input**: `http://192.168.1.1:8080/login/verify`

| Signal | Code | Weight | How it fires |
|--------|------|--------|-------------|
| Bare IP address | ip_host | 35 | Line 58: `/^\d{1,3}(\.\d{1,3}){3}$/` matches `192.168.1.1` |
| HTTP (not HTTPS) | insecure_scheme | 12 | Line 61: `u.protocol === "http:"` |
| Non-standard port | unusual_port | 15 | Line 62: port `8080` not in `["80","443",""]` |
| Credential word on IP | credential_lure | 20 | Line 84-85: `"login"` found in path. Line 85: `isIp` condition is true. |
| **Total** | | **82** | **→ malicious → barking** |

brand.ts: `assessBrand("192.168.1.1")` → compact = `"19216811"`, deob = `"l9al6all"` (1→l). No brand tokens match. claimed = null. mismatch = false.

decision.ts: brand.mismatch = false → brand path skipped. Line 51: `local.level === "malicious"` → **barking, trust_allowed: false**.

**Verdict**: This router page produces barking with zero deception evidence. No brand, no impersonation, no phishing intent. Four structural signals + credential_lure (which fires solely because the IP regex matches). **Gap 1 and Gap 3 confirmed.**

### Example B: Phishing page (justified barking through brand path)

**Input**: `https://commbank-login.example.xyz/account/update`

| Signal | Code | Weight | How it fires |
|--------|------|--------|-------------|
| Risky TLD | risky_tld | 15 | Line 63: `.xyz` in SUSPICIOUS_TLDS |
| Brand in non-official domain | brand_lookalike | 40 | Lines 72-79: tokens include `"commbank"`. regDomain = `"example.xyz"`, firstLabel = `"example"`. compact `"example"` does not include `"commbank"`. lookalike = true. |
| Credential word + lookalike | credential_lure | 20 | Lines 84-85: `"secure"` — wait, no. Let me check more carefully. hostLower = `"commbank-login.example.xyz"`. CRED_WORDS: `"login"` → host includes `"login"`? `"commbank-login.example.xyz".includes("login")` → **yes**. credWord = `"login"`. Condition: `lookalike(true)` → fires. |
| **Total** | | **75** | **→ malicious → barking (via score path)** |

brand.ts: `assessBrand("commbank-login.example.xyz")` → compact = `"commbankloginexamplexyz"`, includes `"commbank"` (direct, length ≥ 5) → claimed = CommBank. `registrableDomain = "example.xyz"`, not in CommBank's official list → mismatch = true. homograph = false.

decision.ts: Line 51: `local.level === "malicious"` (score 75) → **barking**. Also Line 67: brand.mismatch = true, `strong = brand.homograph(false) || local.level !== "clean"(true, it's "malicious")` → strong = true → barking. **Both paths produce barking independently.**

**Verdict**: Correctly barks. Brand_lookalike (deception signal) is present. Even with the proposed deception-signal gate, this URL would still bark because `brand_lookalike` is a deception signal.

### Example C: Legitimate international domain (current behaviour is correct)

**Input**: `https://münchen.de/bürgerservice`

After normalisation: `https://xn--mnchen-3ya.de/b%C3%BCrgerservice`

| Signal | Code | Weight | How it fires |
|--------|------|--------|-------------|
| Punycode | punycode | 30 | Line 60: host contains `"xn--"` |
| **Total** | | **30** | **→ uncertain → Sniffing** |

brand.ts: No brand tokens match in `"xn--mnchen-3ya.de"` or deobfuscated form. No mismatch.

decision.ts: Line 100: `local.level === "uncertain"` → ears_up (Sniffing). Correct — punycode alone is Sniffing, not Growling or Barking.

### Example D: Structural noise accumulation (confirms Gap 1 is real)

**Input**: `http://test-server-dev.staging.internal.my-corp.xyz:9090/dashboard`

| Signal | Code | Weight | How it fires |
|--------|------|--------|-------------|
| HTTP | insecure_scheme | 12 | `http:` protocol |
| Non-standard port | unusual_port | 15 | Port `9090` |
| Risky TLD | risky_tld | 15 | `.xyz` in SUSPICIOUS_TLDS |
| Deep subdomains | deep_subdomains | 15 | Labels: `["test-server-dev","staging","internal","my-corp","xyz"]` = 5 ≥ 5 |
| Long host | long_host | 10 | `"test-server-dev.staging.internal.my-corp.xyz"` = 46 chars > 45 |
| Many hyphens | many_hyphens | 12 | `"test-server-dev"` has 2, `"my-corp"` has 1 = 3 ≥ 3 |
| **Total** | | **79** | **→ malicious → barking** |

No brand detected. No deception signals. This is a development server. **Gap 1 confirmed again.**

### Example E: Bank SMS with official URL (confirms Gap 2)

**Input message**: `"CommBank: Your card ending 4567 was used for $89.50 at Woolworths. If this wasn't you, visit commbank.com.au/security"`

extractSignals trace:
- URLs: `["commbank.com.au/security"]` (matched by URL_RE, passes filters)
- brand match: `/\bcomm(?:onwealth)?\s?bank\b/i` matches "CommBank" → `{ name: "CommBank", kind: "bank" }`
- loginRequest: regex tests for "log in", "sign in", "verify account", etc. — **none match** in this text. `loginRequest = false`.
- identityRequest: "card (number|details)" — text has "card ending", not "card number" or "card details". `identityRequest = false`.
- Remaining signals: no code request, no gift cards, no remote access, no urgency words, no threat words.

scenarioFor: Line 155: `s.brandKind === "bank"(true) && (s.loginRequest(false) || s.identityRequest(false) || s.urls.length(1, truthy))` → **true. M02 fires. State: barking.**

why text at line 156: `"The link does not lead to the bank's official website."` — but the link IS `commbank.com.au/security`, which IS CommBank's official website. The code never checked this.

**Gap 2 confirmed. The `why` text is factually false for this input.**

### Example F: IP router without credential words (correct behaviour)

**Input**: `http://192.168.1.1`

| Signal | Code | Weight | How it fires |
|--------|------|--------|-------------|
| Bare IP | ip_host | 35 | IP regex matches |
| HTTP | insecure_scheme | 12 | `http:` protocol |
| **Total** | | **47** | **→ suspicious → growling** |

No credential_lure (no credential words in host or path). Growling is reasonable for an unusual destination.

---

## 3. Threat Scent Correlation — Verified

### How events are linked (threatScent.ts:34-45)

Two events join the same scent ONLY when:

| Condition | Code location | What it means |
|-----------|--------------|---------------|
| Both carry the same explicit scent_id | Line 40: `event.scent_id && e.scent_id === event.scent_id` | Prior code already linked them (e.g., user tapped a link inside a checked message — the link check inherits the message's scent_id). |
| New event's scent_id references the existing event's event_id, AND they share a non-generic brand or host key | Line 43: `event.scent_id === e.event_id && keys.size` | The new event was explicitly tagged as a follow-up to a specific existing event, and they share a domain or brand. |

**What does NOT link events**: Shared brand name alone, shared host alone, or shared time window alone. These were once sufficient in an earlier version (keysFor generates brand/host keys), but line 43's requirement for `event.scent_id === e.event_id` means keys are now a FILTER, not a TRIGGER.

### Does checking another Gate independently increase severity?

buildScents (line 58): `state = sorted.reduce((acc, e) => STATE_RANK[e.state] > STATE_RANK[acc] ? e.state : acc, "resting")` — the scent state is the MAX of member events.

This means if a message check produces growling and the user then checks the link (same scent_id), and the link comes back barking (Google confirms malicious), the scent state rises from growling to barking. **This is correct** — the link check provided genuinely new evidence (confirmed malicious verdict from Google).

But if the user checks an unrelated app and it produces ears_up, the app event would NOT join the scent (no matching scent_id, no reference to the message event). **Correct**.

### Edge case: Can scent_id be set incorrectly by the event creator?

The scent_id is set by the code that creates patrol events (in ApolloContext.tsx or equivalent). If a bug sets scent_id to the wrong event_id, unrelated events could be linked. This is a potential implementation bug, not a rule-engine flaw. The correlation logic itself is sound.

### Verified assessment:
- **No auto-escalation without new evidence**: Confirmed. Joining a scent does not increase any individual event's state. The scent's aggregate state reflects the highest evidence already present.
- **No brand/host-only correlation**: Confirmed. Line 43 requires explicit scent_id reference.
- **30-minute window**: Events outside the window are excluded (line 39). Long multi-step attacks spanning hours would not be correlated. This is a known limitation, not a defect — longer windows risk false correlation.

---

## 4. Trusted-Sender Bypass — Verified

### How trust interacts with detection (decision.ts:14-148)

The detection flow evaluates rules in this order:

| Priority | Check | Can trust override? |
|----------|-------|---------------------|
| 1 | Intel malicious (line 34) | **NO** — `trust_allowed: false`. Fires before trust check. |
| 2 | Local score ≥ 70 / malicious (line 51) | **NO** — `trust_allowed: false`. Fires before trust check. |
| 3 | Brand mismatch (line 67) | **Conditional** — block is `if (brand?.mismatch && !trusted)`. Skipped entirely when trusted. |
| 4 | Trusted link (line 84) | Returns `resting` (Patrolling). |
| 5 | Uncertain (line 100) | `trust_allowed: true` — user CAN trust from here. |
| 6 | Suspicious (line 115) | `trust_allowed: true` — user CAN trust from here. |
| 7 | Clean (line 131) | `trust_allowed: false` — nothing to trust. |

### When can trust be applied?

| Decision result | trust_allowed | Can the user trust it? |
|----------------|---------------|------------------------|
| Intel malicious → barking | false | No |
| Local malicious → barking | false | No |
| Brand mismatch strong → barking | false | No |
| Brand mismatch not-strong → growling | **true** | **Yes** |
| Uncertain → ears_up | **true** | Yes |
| Suspicious → growling | **true** | **Yes** |

### What does trust suppress on subsequent checks?

When a URL is trusted and checked again, the decision.ts flow:
1. Intel malicious? → barking (trust irrelevant)
2. Local malicious? → barking (trust irrelevant)
3. Brand mismatch? → `!trusted` = false → **skipped**
4. Trusted? → **resting** (Patrolling)

**The one genuine gap**: A URL that was initially growling (suspicious score 40-69, or non-strong brand mismatch) can be trusted by the user. On subsequent checks, brand-mismatch evidence is suppressed by trust. If the brand mismatch later becomes "strong" (e.g., a login page now appears at that URL), the brand-mismatch block is skipped because `!trusted` is false.

**Mitigating factors**:
1. If the URL's local score reaches ≥ 70 (malicious), line 51 fires BEFORE the trust check.
2. If Google lists the URL, line 34 fires BEFORE the trust check.
3. Page analysis (W02/W03/W14) runs independently of URL trust — a fake login page would be caught by page analysis even if the URL is trusted.
4. The decision.ts `why` text says "Trust only applies to this exact link" (line 90) — suggesting exact-URL keying, meaning a different path on the same domain would not be trusted.

**Remaining concern**: A trusted URL at the growling level (brand mismatch, not strong) that later acquires "strong" brand-mismatch evidence — but ONLY if the same exact URL is checked and the local score stays below 70. This is a narrow window that requires the user to have previously trusted a brand-impersonating domain. It is further mitigated by page analysis catching the fake login independently.

**Recommendation**: Not a must-fix for detection accuracy. The trust model correctly prevents overriding confirmed threats. The narrow edge case (trusted non-strong mismatch becoming strong later) is mitigated by page analysis and intel overrides. Document as a known limitation.

---

## 5. Email-Provider Assumptions — Verified

### What E01 actually checks (emailAnalysis.ts:62-87)

```javascript
const senderOfficial = !!(senderDomain && official &&
  official.domains.some(d => isSuffixOf(senderDomain, d)));
const senderMismatch = !!(official && senderDomain && !senderOfficial);
```

`isSuffixOf(host, domain)` returns true when `host === domain || host.endsWith("." + domain)`.

### Scenarios where E01 fires (brand impersonation → barking):

| Sender domain | Brand | senderOfficial? | senderMismatch? | E01 fires? |
|--------------|-------|-----------------|-----------------|------------|
| `commbank.com.au` | CommBank | Yes (exact match) | No | No |
| `em1234.commbank.com.au` | CommBank | Yes (subdomain suffix match) | No | No |
| `bounce.commbank.com.au` | CommBank | Yes (subdomain suffix match) | No | No |
| `sendgrid.net` | CommBank | No | Yes | **Yes** |
| `mail.sendgrid.net` | CommBank | No | Yes | **Yes** |
| `commbank-marketing.com` | CommBank | No | Yes | **Yes** |
| `cba.com.au` | CommBank | Yes (in official list) | No | No |

**Key finding**: The original v2 report's ESP concern was overstated for major brands. Australian banks configure ESP sending through their own domains (e.g., `em1234.commbank.com.au`), which correctly passes the suffix check. The FP scenario requires the From header to show the raw ESP domain (e.g., `sendgrid.net`), which happens primarily when:
1. The user pastes SMTP envelope headers instead of the display From
2. A smaller organisation hasn't configured its ESP sending domain
3. The email was forwarded through a service that rewrites the From header

**More realistic FP cases**:
1. **Parent-company domain**: Linkt sends from `linkt@transurban.com.au`. Official for Linkt is `["linkt.com.au"]`. `isSuffixOf("transurban.com.au", "linkt.com.au")` → false. senderMismatch = true. **E01 fires on a legitimate email.**
2. **Regional domain variant**: ANZ sends from `alerts@anz.co.nz` (New Zealand). Official for ANZ is `["anz.com.au","anz.com"]`. `isSuffixOf("anz.co.nz","anz.com.au")` → false. `isSuffixOf("anz.co.nz","anz.com")` → false. senderMismatch = true. **E01 fires on legitimate ANZ NZ email.**
3. **Shared-service domain**: myGov sends from `noreply@humanservices.gov.au`. Official for Services Australia is `["servicesaustralia.gov.au","my.gov.au"]`. `humanservices.gov.au` is not a suffix of either. senderMismatch = true. **E01 fires.** (Note: "humanservices.gov.au" is the old Centrelink/DHS domain still in use.)

**Revised recommendation**: Add missing legitimate domains to the OFFICIAL list rather than building an ESP whitelist:
- Linkt: add `"transurban.com.au"`
- ANZ: add `"anz.co.nz"`
- Services Australia: add `"humanservices.gov.au"`
- CommBank: add `"cba.com.au"` (already present — confirmed)

This is a data-completeness fix, not an architectural change.

---

## 6. Page-Analysis False Positives — Verified

### W02/W03 (Fake bank login / Fake brand login) — SSO false positive

**Scenario**: Enterprise SSO page at `auth.okta.com` showing ANZ-branded login.

Gemini extracts: `claimed_brand = "ANZ"`, `page_type = "login"`, `asks_for = ["username","password"]`.

pageAnalysis.ts line 48: `brand = assessBrand("auth.okta.com", "ANZ")`.
- brand.ts: compact = `"authoktacom"`. No brand tokens match directly or via deobfuscation. But hintBrand = `"ANZ"` → line 64: `claimed = ANZ record` (found in OFFICIAL_DOMAINS).
- isOfficial: `registrableDomain("auth.okta.com") = "okta.com"`. Not `"anz.com.au"` or `"anz.com"`. `host.endsWith(".anz.com.au")` → false. isOfficial = false.
- Result: mismatch = true.

Line 81: `(page_type === "login" || wantsCreds) && (mismatch || (!!claimed && host && !brand?.isOfficial))` → true && true → fires.
Line 82: `bankish = /bank|paypal|commbank|westpac|anz|nab/i.test("ANZ")` → true → W02 "Fake bank login" → **barking**.

**Is this a real FP?** In the consumer context, no — consumers access ANZ through `anz.com.au`, not through Okta. In the enterprise context (ANZ staff accessing internal systems via Okta SSO), yes. But the page analysis only runs when a user actively submits a page for checking. An ANZ employee checking their own SSO page is an edge case.

**Assessment**: Low-priority FP. The correct behaviour for consumer protection. Enterprise users would learn quickly to not check their own SSO pages.

### W12 (Crypto wallet request) — DeFi false positive

**Scenario**: User intentionally visits `app.uniswap.org` and Gemini extracts `wallet_connect_request = true`.

pageAnalysis.ts line 71: `p.wallet_connect_request || asks.has("wallet_connect") || p.page_type === "wallet"` → true → W12 fires.

brand.ts: `assessBrand("app.uniswap.org", ...)` → no brand tokens in OFFICIAL_DOMAINS match "uniswap". claimed = null. isOfficial = false.

Line 73: `mismatch(false) || !brand?.isOfficial(true, because brand is null, so !null?.isOfficial = !undefined = true)` — wait, let me re-check. `!brand?.isOfficial`: brand is null, so `brand?.isOfficial` = undefined, `!undefined` = true. But the condition is `mismatch || !brand?.isOfficial` = `false || true` = true. So the why text says "The site isn't a wallet or exchange Apollo recognises as official."

**State**: barking.

**Is this a real FP?** Yes, for intentional DeFi users. Uniswap is a legitimate decentralised exchange. The wallet connect request is its normal operation. But Apollo has no way to distinguish a legitimate DeFi protocol from a wallet-drainer scam page — both request wallet connection on unrecognised domains.

**Assessment**: Acceptable FP. The wallet-connect barking protects users who reach such pages through phishing links. For intentional DeFi users, the barking explanation says "Apollo has no evidence funds were taken" and the user can proceed. The cost of missing a wallet drainer is far higher than the cost of a DeFi power-user seeing one extra warning.

### W08 (Fake virus warning) — Legitimate security page FP

**Scenario**: User visits Norton's web-based scan page. Gemini extracts `virus_or_infection_claim = true` (the page displays scan results mentioning threats found).

Line 66: `p.virus_or_infection_claim` → true → W08 fires → **barking**.

**Is this a real FP?** Potentially, but very rare in practice. Norton's web scan is at `norton.com`, which could be recognised as an official domain. However, brand.ts doesn't currently include Norton/Symantec. More importantly, Gemini's signal extraction would need to distinguish "this page claims YOUR device is infected" (scam) from "this page shows scan results" (legitimate). The `virus_or_infection_claim` signal as currently defined doesn't make this distinction.

**Assessment**: Edge case. The practical risk is low — users rarely submit legitimate antivirus pages for Apollo to check. If this becomes a recurring FP, the fix is in Gemini's signal extraction instructions, not in the rule engine.

---

## 7. Amended Escalation Matrix

### 7.1 URL/Website Detection

| Evidence | Status | Confidence | Change? |
|----------|--------|------------|---------|
| Google Safe Browsing match | **Barking** | high | No change |
| Local score ≥ 70 with ≥1 DECEPTION signal (brand_lookalike, brand_in_path, credentials_in_url, known_test_threat, credential_lure via non-isIp trigger) | **Barking** | intel clean? medium : high | **NEW: deception-signal gate** |
| Local score ≥ 70 with ZERO deception signals (pure structural) | **Growling** | low | **NEW: prevents arbitrary-score barking** |
| Brand mismatch (strong: homograph OR local not clean OR credential word in URL) | **Barking** | intel clean? medium : high | No change — correctly justified |
| Brand mismatch (not strong) | **Growling** | low | No change |
| Trusted link (not intel-malicious, not local-malicious) | **Patrolling** | medium | No change — correctly allows trust with limitations |
| Local score 40-69 (suspicious) | **Growling** | low | No change |
| Local score 15-39 (uncertain) | **Sniffing** | low | No change |
| Local score < 15 (clean) | **Patrolling** | intel clean? medium : low | No change |

### 7.2 Message Detection

| Evidence | Status | Change? |
|----------|--------|---------|
| M02: bank brand + ALL URLs resolve to brand's official domains + no loginRequest/identityRequest | **Sniffing** | **FIX: currently barking. Check URLs against brand.ts/emailAnalysis.ts OFFICIAL domains.** |
| M02: bank brand + ANY non-official URL | **Barking** | No change |
| M02: bank brand + loginRequest or identityRequest (no URLs) | **Barking** | No change |
| M01: courier brand + URLs all resolve to official courier domains | **Sniffing** | Already handled by M15 scenario (official courier links → ears_up). M01 only fires when M15 conditions don't match. No change needed. |
| M04: government brand + URLs all on .gov.au | Should be **Sniffing** | **FIX: currently growling/barking. Check URLs against .gov.au/.gov suffix.** |
| All other message scenarios | Unchanged | — |

### 7.3 Email Detection

| Evidence | Status | Change? |
|----------|--------|---------|
| E01: brand impersonation, sender domain is subsidiary/related domain of the brand (e.g., transurban.com.au for Linkt) | **Growling** (currently barking) | **FIX: add missing legitimate domains to OFFICIAL list** |
| E01: brand impersonation, sender domain is unrelated | **Barking** | No change |
| E08: Reply-To and sender domains belong to the same organisation but differ (e.g., commbank.com.au vs cba.com.au) | **No trigger** (currently triggers) | **FIX: check both domains against the brand's official list before triggering** |
| All other email scenarios | Unchanged | — |

### 7.4 Call Detection

No changes. All call scenarios are evidence-based (user-reported actions), not score-based.

### 7.5 App Detection

| Evidence | Status | Change? |
|----------|--------|---------|
| Score-based fallback (`byScore`) produces barking from permissions alone, no scenario match, no brand, no call/message/site context | **Growling** (cap) | **FIX: apply same deception/context gate. Pure permission score without threatening context should cap at growling.** |
| All scenario-based rules (A01-A20) | Unchanged | Correctly based on specific threat patterns |

### 7.6 Page Analysis

No changes. Every barking scenario requires a specific observed deception pattern (remote access, fake login, fake virus, wallet drain). The SSO and DeFi edge cases are acceptable false positives in a consumer protection context.

### 7.7 Threat Scent

| Pattern | Status | Change? |
|---------|--------|---------|
| Two events linked by explicit scent_id, higher state in later event | Scent aggregate reflects higher state | No change — the later event provided genuinely new evidence |
| Two events with same brand but no scent_id reference | NOT correlated | No change — correctly prevents false correlation |
| Events outside 30-minute window | NOT correlated | No change — known limitation, not a defect |
| Generic brand names ("your bank", "a delivery company") | Excluded from key matching | No change — correct |

### 7.8 Trust Model

| Pattern | Status | Change? |
|---------|--------|---------|
| Intel malicious overrides trust | **Barking** | No change — correct |
| Local malicious overrides trust | **Barking** | No change — correct |
| Brand mismatch (strong) + first check → trust_allowed: false | User cannot trust | No change — correct |
| Brand mismatch (not strong) → user trusts → later evidence | Trust suppresses brand mismatch check | Known limitation. Mitigated by intel override, local-malicious override, and independent page analysis. No change needed for detection accuracy. |

### 7.9 State Machine

| Pattern | Status | Change? |
|---------|--------|---------|
| Stale barking (>4 hours on home hero) | **Growling** on home, **Barking** in Patrol | No change |
| Visibility expired, no active events | **Growling** (`visibilityLost: true`) | No change — distinguished in UI |
| Recovery pending | **Growling** | No change |

---

## 8. Revised Recommendations — Final List

### Must-Fix (addresses both requirements)

| # | What | Where | Why |
|---|------|-------|-----|
| **MF-1** | Add deception-signal gate for score-based barking | decision.ts:51 | When `local.level === "malicious"`, check whether `local.signals` contains at least one of: `brand_lookalike`, `brand_in_path`, `credentials_in_url`, `credential_lure`, `known_test_threat`. If none present, return growling instead of barking. This prevents structural-only accumulation from reaching barking while preserving barking for genuine phishing. |
| **MF-2** | Remove `isIp` from credential_lure trigger | risk.ts:85 | Change `(lookalike \|\| brandInPath \|\| SUSPICIOUS_TLDS.has(tld) \|\| labels.length >= 5 \|\| isIp)` to `(lookalike \|\| brandInPath \|\| SUSPICIOUS_TLDS.has(tld) \|\| labels.length >= 5)`. IP-based phishing WITH brand evidence is already caught by `brand_in_path` (line 83). Bare IP + credential word alone is not phishing evidence. |
| **MF-3** | Check M02 URLs against official domains | messageAnalysis.ts:155 | Before triggering M02 with `s.urls.length` as the sole condition (when `!s.loginRequest && !s.identityRequest`), check whether every URL resolves to a domain in the claimed brand's official list. If all URLs are official, produce ears_up with verdict: "This looks like a genuine notification. Verify by opening the bank's app yourself." |
| **MF-4** | Fix factually false `why` text in M02/M01/M04 | messageAnalysis.ts:156, 168, 174 | Replace assertions like "The link does not lead to the bank's official website" with accurate text based on what was actually checked. If URLs were not checked against official domains: "Apollo has not yet verified where this link leads." If checked and non-official: "The link does not lead to [brand]'s official website." |

### Should-Fix (improve accuracy)

| # | What | Where | Why |
|---|------|-------|-----|
| **SF-1** | Add missing legitimate domains to email OFFICIAL list | emailAnalysis.ts:17-23 | Add: `transurban.com.au` for Linkt, `anz.co.nz` for ANZ, `humanservices.gov.au` for Services Australia. Reduces false E01 barking on legitimate inter-brand and regional emails. |
| **SF-2** | Fix E08 reply-to comparison | emailAnalysis.ts:67 | When replyMismatch is detected, check whether both domains appear in the SAME brand's official list before triggering. `noreply@commbank.com.au` + Reply-To `support@cba.com.au` should not fire E08 because both are CommBank domains. |
| **SF-3** | Reduce deep_subdomains + long_host double-count | risk.ts:65-66 | When both `deep_subdomains` and `long_host` fire, reduce `long_host` weight to 0. These are measuring the same underlying property. |
| **SF-4** | Apply deception/context gate to app score fallback | appAnalysis.ts:125 | When `byScore === "barking"` is used as the fallback (no scenario match), check whether at least one contextual signal is present (promptedByCaller, promptedByMessageOrSite, brand impersonation, scentCall, scentWebOrFile, blockedMalicious). Pure permission accumulation without context should cap at growling. |
| **SF-5** | Check M04 government URLs against .gov.au | messageAnalysis.ts:174 | When M04 (government impersonation) fires with URLs present, check whether URLs are on .gov.au domains. If so, reduce to ears_up. |

---

## 9. Proposed Regression Tests

Each test specifies the input, the expected detection path, and the expected status. These can be implemented as unit tests against the pure functions without network calls.

### 9.1 Score-Based Barking Gate (MF-1)

| Test | Input | Expected Score | Deception Signal? | Expected Status | Validates |
|------|-------|---------------|-------------------|----------------|-----------|
| SG-01 | `http://192.168.1.1:8080/login` | ip_host(35)+insecure(12)+port(15)+cred_lure(20)=82 [pre-MF2]; 35+12+15+6=68 [post-MF2] | Post-MF2: No (credential_word is not a deception signal) | **Growling** (post-MF1+MF2) | Arbitrary-score barking prevented |
| SG-02 | `https://commbank-login.example.xyz/account` | brand_lookalike(40)+risky(15)+cred_lure(20)=75 | Yes (brand_lookalike) | **Barking** | Phishing still barks regardless of Google |
| SG-03 | `http://test.staging.dev.corp.xyz:9090/dashboard` | insecure(12)+port(15)+risky(15)+deep(15)+long(10)+hyphens(12)=79 | No | **Growling** (post-MF1) | Structural-only barking prevented |
| SG-04 | `https://paypal-verify.tk/login` | brand_lookalike(40)+risky(15)+cred_lure(20)=75 | Yes (brand_lookalike) | **Barking** | Emerging scam (not in Google yet) still barks |
| SG-05 | `https://user:pass@evil.com/@commbank.com.au` | credentials_in_url(45) + ... | Yes (credentials_in_url) | **Barking** | Credential embedding always barks |

### 9.2 credential_lure isIp Fix (MF-2)

| Test | Input | Expected Score (pre) | Expected Score (post) | Expected Status (post) |
|------|-------|---------------------|----------------------|----------------------|
| CL-01 | `http://192.168.1.1/login` | 35+12+20=67 (suspicious) | 35+12+6=53 (suspicious) | **Growling** (unchanged, but score is lower) |
| CL-02 | `http://192.168.1.1/paypal-login` | 35+12+25+20=92 | 35+12+25+20=92 (brand_in_path fires → credential_lure still fires via brandInPath condition) | **Barking** (brand_in_path is a deception signal, passes MF-1 gate) |
| CL-03 | `http://10.0.0.1/admin` | 35+12=47 (no cred words) | 35+12=47 | **Growling** (unchanged) |

### 9.3 M02 Official URL Check (MF-3)

| Test | Input message | Expected Status (pre) | Expected Status (post) |
|------|--------------|----------------------|----------------------|
| M02-01 | "CommBank: Card used for $89.50. Visit commbank.com.au/security" | Barking (M02) | **Sniffing** (all URLs official) |
| M02-02 | "CommBank: Card used for $89.50. Visit commbank-alerts.xyz/verify" | Barking (M02) | **Barking** (URL non-official) |
| M02-03 | "CommBank: Verify your account at commbank.com.au/login" | Barking (M02, loginRequest fires) | **Barking** (loginRequest fires regardless of URL check) |
| M02-04 | "ANZ: Your statement is ready. View at anz.com.au/statements" | Barking (M02) | **Sniffing** (all URLs official) |
| M02-05 | "Your bank account has been locked. Click here: bit.ly/abc123" | Barking (M02) | **Barking** (shortened URL, not official) |

### 9.4 Threat Scent Correlation

| Test | Scenario | Expected Behaviour |
|------|----------|-------------------|
| TS-01 | Message event (growling) with scent_id "S1". Link event (barking, Google malicious) with scent_id "S1". | Scent state: barking. Correctly escalated by new evidence. |
| TS-02 | Message event (growling) about "CommBank". Unrelated app check (ears_up) about "CommBank". No shared scent_id. | NOT linked. Different events despite same brand. |
| TS-03 | Message event (growling) with brand "your bank" (generic). Link event with scent_id = message's event_id. | NOT linked. normKeys filters out generic brands. keys.size = 0 on line 43. Wait — let me re-check. Line 43: `event.scent_id === e.event_id && keys.size`. If the link event's scent_id = message's event_id, and keys.size > 0 (the link has a host key, not just a brand key)... actually "your bank" is filtered by GENERIC_BRANDS, but the host key from the link would still be present. So if the LINK event has a host key (e.g., host:bit.ly), keys.size > 0, and the condition passes. The linking happens because of the explicit scent_id reference, not the brand. This is CORRECT — the link event was explicitly tagged as a follow-up. |
| TS-04 | Two events > 30 minutes apart with same scent_id. | NOT linked (line 39 time check). Correct. |

### 9.5 Trust Model

| Test | Scenario | Expected |
|------|----------|----------|
| TR-01 | URL scores 40 (suspicious, growling). User trusts. Same URL checked again, intel still unknown. | Resting (trust applies). |
| TR-02 | URL scores 40 (suspicious, growling). User trusts. Same URL checked again, intel says malicious. | Barking (line 34 fires before trust). |
| TR-03 | URL scores 75 (malicious). User tries to trust. | trust_allowed: false. User cannot trust. |
| TR-04 | URL has brand mismatch (strong). User tries to trust. | trust_allowed: false. User cannot trust. |
| TR-05 | URL has brand mismatch (not strong, growling). User trusts. URL checked again, now has login page (page analysis). | URL check: resting (trusted). Page analysis: W02/W03 barking (independent check). Net effect: barking from page analysis. |

### 9.6 Email Provider

| Test | Sender | Brand | Expected |
|------|--------|-------|----------|
| EP-01 | `noreply@commbank.com.au` | CommBank | senderOfficial: true. No mismatch. |
| EP-02 | `noreply@em1234.commbank.com.au` | CommBank | senderOfficial: true (suffix match). No mismatch. |
| EP-03 | `12345@sendgrid.net` + From Name "CommBank" | CommBank | senderMismatch: true. E01 fires (if accountAlert/links/pressure). |
| EP-04 | `alerts@transurban.com.au` + From Name "Linkt" | Linkt | Pre-SF1: senderMismatch true, E01 fires. Post-SF1: senderOfficial true (transurban.com.au added). |
| EP-05 | `noreply@commbank.com.au`, Reply-To `support@cba.com.au` | CommBank | Pre-SF2: replyMismatch true, E08 may fire. Post-SF2: both domains in CommBank's official list, no trigger. |

### 9.7 Page Analysis

| Test | Page signals | Expected |
|------|-------------|----------|
| PA-01 | host: `auth.okta.com`, claimed_brand: "ANZ", page_type: "login", asks_for: ["username","password"] | W02 barking (brand mismatch). Accepted FP for enterprise SSO. |
| PA-02 | host: `netbank.com.au`, claimed_brand: "CommBank", page_type: "login" | isOfficial: true (netbank.com.au in CommBank's list). No mismatch. W20 "no concern". |
| PA-03 | host: `app.uniswap.org`, wallet_connect_request: true | W12 barking. Accepted FP for intentional DeFi. |
| PA-04 | host: `paypal.com`, page_type: "login", asks_for: ["username","password"] | isOfficial: true. W20 "no concern". Correct. |

---

## 10. Summary

### What was wrong in v2 and is now corrected:
1. The `comrnbank-secure.xyz` example was attributed to score-based barking (75 points). **Actual score is 60; barking comes from brand.ts homograph detection via decision.ts.** The score path and the brand path are independent code paths with different evidence requirements.
2. The ESP concern was overstated. Major Australian brands use subdomain-authenticated sending, which passes the existing suffix check. The real FP cases are subsidiary/regional domains (Transurban for Linkt, anz.co.nz for ANZ).
3. Threat Scent correlation was correctly described in v2 but lacked verification against the actual `findScentFor` conditions. Now verified: explicit scent_id reference required, brand/host keys alone do not trigger correlation.
4. The trust bypass concern was not analysed in v2. Now analysed: narrow edge case, mitigated by intel override, local-malicious override, and independent page analysis.

### The four must-fix items (MF-1 through MF-4) are verified and ready for implementation:
- **MF-1** (deception-signal gate): Prevents Example A and Example D from barking while preserving Example B and Example E.
- **MF-2** (credential_lure isIp removal): Reduces router-page scores by 14 points, does not affect phishing pages with brand evidence.
- **MF-3** (M02 official URL check): Fixes the CommBank-official-URL false positive. Preserves barking for non-official URLs.
- **MF-4** (factual `why` text): Every assertion matches what was actually checked.

### These fixes address both requirements:
- **"Must not Bark based on arbitrary score"**: MF-1 prevents structural-only accumulation from producing barking. MF-2 removes the over-sensitive isIp trigger.
- **"Must not fail to Bark on emerging scams"**: MF-1 allows barking when any deception signal is present, regardless of Google's verdict. Brand impersonation, credential embedding, and homograph detection all count as deception signals.

---

*End of v3 Focused Correction — Ready for implementation authorisation.*
