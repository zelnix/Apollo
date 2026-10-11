# Apollo Scam Guard — Corrected Detection Audit

**Date**: June 2026 — Revision 2 (Factual Corrections and Gap Analysis)  
**Supersedes**: SCAM_GUARD_DETECTION_AUDIT.md (Revision 1)  
**Method**: Line-by-line re-verification of every detection engine against the source code, then correction of every factual error and identification of every genuine detection gap found.

---

## 1. Factual Mistakes in the Original Report — Corrected

### Correction 1: "Cap local-only barking at growling when Google says clean" — WRONG

The original report recommended: *"When intel.verdict === 'clean', cap local-only detection at growling, not barking."*

**This recommendation was wrong.** It directly contradicts the requirement that Apollo must not fail to Bark simply because Google has not yet listed a newly emerging scam. Google Safe Browsing has significant lag on new phishing pages — sometimes days. A freshly deployed phishing page mimicking CommBank, with a lookalike domain, credential lure, and a risky TLD, would score 75+ locally. If we cap at growling because Google hasn't caught up, the user is unprotected during the most dangerous window — the hours after a new scam page goes live.

**What the report should have said:** The problem is not that local evidence produces barking. The problem is that the wrong KIND of local evidence can produce barking. See Correction 3 and Gap 1 below.

### Correction 2: "Reduce ip_host from 35 to 20" and "Reduce punycode from 30 to 15" — MISDIAGNOSED

The original report treated these as standalone weight problems. They are not. The weights are reasonable for what they detect — a bare IP address IS unusual for a destination, and punycode IS a homograph risk. The real problem is that these are STRUCTURAL signals that can combine with other structural signals to reach barking (score ≥ 70) without any SEMANTIC evidence of deception (brand impersonation, credential lure, phishing pattern). See Gap 1.

### Correction 3: The "arbitrary score" problem is about signal CLASSIFICATION, not individual weights

The original report proposed fixing individual signal weights. This misses the actual problem.

The real issue: the scoring system in `risk.ts` makes no distinction between signals that indicate **deception** (brand impersonation, credential embedding, homograph attack) and signals that indicate **structural oddity** (unusual port, risky TLD, hostname length, encoding). All signals are additive, so four structural oddities can accumulate to barking even when there is zero evidence of deception.

**Example of arbitrary-score barking (currently possible):**
```
http://192.168.1.1:8080/login/verify
→ ip_host(35) + insecure_scheme(12) + unusual_port(15) + credential_lure(20) = 82 → barking
```
This is a router admin page. No brand impersonation. No deception. Four structural signals + one credential word in the path = barking. The credential_lure signal fires because `isIp` is true (line 85), which makes ANY credential word on any IP address trigger it. This is the "arbitrary score" problem.

**Example of justified barking from local evidence alone (currently possible, must stay):**
```
https://comrnbank-secure.xyz/netbank/login
→ brand_lookalike(40) + credential_lure(20) + risky_tld(15) = 75 → barking
```
This is a phishing page using a homograph ("rn" → "m") on a risky TLD with a credential lure. Three signals that together paint an unambiguous picture of phishing. Google may not have listed it yet. This MUST bark.

### Correction 4: "M16 — reduce to growling for 1800/1300 numbers" — INCOMPLETE ANALYSIS

The original report recommended reducing M16 to growling when the callback number is an 1800/1300 format. This was under-analysed.

Looking at the actual M16 code (messageAnalysis.ts:136-142):
```javascript
if (s.callbackRequest && s.allegedCharge)
```

The `allegedCharge` signal matches: "unauthorised charge", "unrecognised transaction", "suspicious transaction", "Merchant:", "Amount:", "funds are/will be released". The `callbackRequest` requires BOTH a phone number match AND a call-related word ("call", "contact", "phone", "fraud response", "support line", "helpline").

A legitimate bank fraud alert that says "We detected an unauthorised charge. Call our fraud team on 1800 022 966" DOES match both conditions. But so does "An unauthorised charge of $499 was made. Call 0412 345 678 immediately to dispute" — which is a scam.

The number format alone is not decisive. Scammers can use 1800 numbers (they're cheap to set up). However, the COMBINATION of the specific bank's known official number + the correct brand name IS meaningful. The recommendation should be: when the callback number matches a known official fraud-line number for the claimed brand, reduce to growling. Without that database, the number format alone is insufficient.

**Revised recommendation:** Do not change M16 based on number format alone. Instead, note this as a future improvement requiring a verified database of official bank fraud-line numbers.

### Correction 5: "E08 — only fire when registrable domain differs" — INCORRECT EXAMPLE

The original report said: `noreply@bank.com + support@bank.com should not trigger`. Looking at the code:
```javascript
const replyMismatch = !!(replyToDomain && senderDomain && replyToDomain !== senderDomain);
```

`noreply@bank.com` has senderDomain `bank.com`. `support@bank.com` has replyToDomain `bank.com`. These are THE SAME domain, so replyMismatch is false. The current code already handles this case correctly.

The real FP case is: `noreply@commbank.com.au` with Reply-To `support@cba.com.au`. These are both legitimate CommBank domains but the code sees them as different domains because it compares the full domain string, not the registrable domain. **This is the actual FP case the report should have cited.**

### Correction 6: Undercounting of implemented rules

The original report claimed "80+ implemented rules." The actual count across all engines:
- risk.ts: 17 scoring signals
- decision.ts: 7 decision paths
- brand.ts: 3 assessment types
- messageAnalysis.ts: 16 scenario outcomes
- emailAnalysis.ts: 14 scenario outcomes
- callAnalysis.ts: 20+ scenario outcomes
- appAnalysis.ts: 20+ scenario outcomes
- fileAnalysis.ts: 16 scenario outcomes
- networkAnalysis.ts: 12 scenario outcomes
- deviceAnalysis.ts: 15+ finding types
- accountAnalysis.ts: 20+ scenario outcomes
- pageAnalysis.ts: 11 scenario outcomes
- linkGuard.ts: 4 evaluation rules
- stateMachine.ts: 6 state resolution paths
- threatScent.ts: 3 correlation rules
- guarddog_live.py: 3 endpoint paths
- intel.py: 4 intelligence paths

Total: approximately 190 individual detection conditions, not 80+.

### Correction 7: D-BRAND-MIS "strong" condition analysis was partially wrong

The original report said: *"A credential word in the URL path is too common to independently justify barking."*

Re-reading decision.ts:68:
```javascript
const strong = brand.homograph || local.level !== "clean" || /login|signin|verify|secure|account|auth|update|confirm/i.test(local.normalizedUrl ?? "");
```

The regex tests against `local.normalizedUrl`, which is the FULL URL (scheme + host + path + query). So `https://commbank-secure.example.com/page` would match because "secure" is in the hostname. And `https://example.com/account/update` would match because "account" and "update" are in the path.

However, this rule only fires when `brand?.mismatch` is ALREADY true — meaning the hostname already mentions a known brand on a non-official domain. A brand mismatch + any credential word in the ENTIRE URL produces barking.

For a URL like `https://commbank-login.example.xyz/page`, the brand mismatch is already confirmed (hostname mentions "commbank" on a non-official domain). The credential word "login" in the hostname compounds the evidence. This IS appropriate for barking.

For a URL like `https://commbank-news.example.com/account/settings`, the brand mismatch is confirmed. The word "account" in the path adds the strong condition. This MAY be a legitimate partner page — but the combination of brand impersonation + account-related path is reasonably suspicious enough for barking.

**Revised assessment:** The original recommendation to require 2+ conditions was overly cautious. The brand mismatch already IS strong evidence. Adding a credential word (even in the path) on top of brand impersonation is reasonable for barking. The `local.level !== "clean"` alternative (any suspicious local score) is also reasonable — it means additional structural signals were found. The only condition that might be too sensitive is `brand.homograph` alone without other signals, but homograph attacks are definitively deceptive.

**Revised recommendation:** KEEP the current D-BRAND-MIS logic. The brand mismatch provides the semantic anchor; the credential word provides the intent anchor. Together they justify barking.

---

## 2. Genuine Detection Gaps

### Gap 1 (CRITICAL): No semantic/structural signal separation in URL scoring

**Location**: risk.ts, lines 57-86; decision.ts, line 51

**The problem**: The URL risk score is a flat sum of all detected signals. There is no classification of signals into "evidence of deception" vs "structural oddity." This means four structural oddities (ip_host + unusual_port + deep_subdomains + insecure_scheme = 77) produce barking without any evidence that someone is trying to deceive anyone.

**Why this matters for both requirements**:
- "Must not Bark based on an arbitrary score": Structural accumulation without deception evidence IS arbitrary.
- "Must not fail to Bark on emerging scams": True phishing signals (brand impersonation + credential lure) must still drive barking independently of Google.

**Current deception signals** (semantic — indicate someone is trying to fool the user):
- `brand_lookalike` (40) — domain pretends to be a known organisation
- `brand_in_path` (25) — brand name in path on suspicious host
- `credential_lure` (20) — credential words combined with deceptive context
- `credentials_in_url` (45) — username before @ sign (classic phishing disguise)
- `known_test_threat` (75) — known malicious test infrastructure

**Current structural signals** (may indicate suspicious infrastructure, not deception itself):
- `ip_host` (35) — bare IP address
- `punycode` (30) — IDN encoding
- `insecure_scheme` (12) — HTTP
- `unusual_port` (15) — non-standard port
- `risky_tld` (15) — TLD associated with abuse
- `shortener` (20) — destination hidden
- `deep_subdomains` (15) — complex hostname
- `long_host` (10) — long hostname
- `many_hyphens` (12) — many dashes
- `encoded_chars` (10) — percent encoding
- `long_url` (8) — very long URL
- `credential_word` (6) — credential word alone (no deceptive context)

**The fix**: Before the score is compared against the 70 threshold at decision.ts:51, require that at least one DECEPTION signal is present for the `malicious` level. Pure structural accumulation caps at `suspicious` (growling). This preserves barking for genuine phishing regardless of Google, while preventing barking from arbitrary structural noise.

**Note on `credential_lure`**: This signal bridges both categories. It fires when a credential word appears WITH a deceptive context (lookalike, brand-in-path, suspicious TLD, deep subdomains, or IP host). The `isIp` condition on line 85 means ANY IP address with ANY credential word in the path triggers `credential_lure`. A router at `http://192.168.1.1/login` scores ip_host(35) + insecure_scheme(12) + credential_lure(20) = 67 → growling. But add unusual_port(15) and it's 82 → barking. The `credential_lure` signal should NOT fire on the `isIp` condition alone — it should require IP + at least one other deceptive context (brand mention, suspicious TLD).

### Gap 2 (HIGH): M02 bank fraud rule fires barking on official bank URLs without checking

**Location**: messageAnalysis.ts, line 155

**The code**:
```javascript
if (s.brandKind === "bank" && (s.loginRequest || s.identityRequest || s.urls.length))
```

**The `why` text**: `"The link does not lead to the bank's official website."`

**The problem**: The code fires barking when a bank brand is detected AND ANY URL is present — it does not check whether the URL leads to the bank's official domain. But the `why` text CLAIMS that the link "does not lead to the bank's official website." This is a factual assertion the code never verified.

**Impact**: A legitimate bank SMS like *"CommBank: Your card ending 4567 was used for $89.50 at Woolworths. If this wasn't you, call 13 2221 or visit commbank.com.au/security"* would trigger M02 barking because:
- `brandKind === "bank"` (CommBank matched)
- `s.urls.length > 0` (commbank.com.au/security extracted)

The `why` text would then say *"The link does not lead to the bank's official website"* — which is false. The link IS the bank's official website.

**The fix**: Before firing M02 based on `s.urls.length` alone (without loginRequest or identityRequest), check whether ALL extracted URLs resolve to the claimed brand's official domains using the OFFICIAL list from brand.ts / emailAnalysis.ts. If all URLs are official, reduce to ears_up ("This appears legitimate, but verify by opening the bank's app yourself"). If ANY URL is non-official, fire barking with an accurate `why` text.

### Gap 3 (HIGH): `credential_lure` fires too easily on IP addresses

**Location**: risk.ts, line 85

**The code**:
```javascript
if (credWord && (lookalike || brandInPath || SUSPICIOUS_TLDS.has(tld) || labels.length >= 5 || isIp))
  add("credential_lure", 20, ...);
```

**The problem**: `isIp` is true for ALL bare IP addresses. Combined with `ip_host(35)`, this means any IP address with any credential-related word anywhere in the URL scores at MINIMUM 55 (ip_host + credential_lure) and usually 67+ (add insecure_scheme). With one more structural signal (unusual_port, long_url, deep path), it crosses 70 → barking.

Common legitimate URLs that trigger this:
- `http://192.168.1.1/login` — router admin
- `http://10.0.0.1/account/settings` — local network device
- `http://172.16.0.1:8080/admin/login` — office NAS/printer

**The fix**: `credential_lure` should not fire on the `isIp` condition alone. Require isIp + at least one of (brand mention in host/path, suspicious TLD — which can't co-occur with IP, or deep subdomains — which can't occur with a bare IP). In practice, this means removing `isIp` from the credential_lure trigger conditions entirely, since the other conditions already cover the dangerous IP-based phishing cases (brand_in_path on an IP covers `http://1.2.3.4/paypal-login`).

### Gap 4 (HIGH): No mechanism for URL intelligence to moderate a message verdict

**Location**: messageAnalysis.ts, lines 222-227

**The code**:
```javascript
export function escalateForUrl(state: ApolloState, urlVerdict): ApolloState {
  if (urlVerdict === "malicious") return "barking";
  return state;
}
```

**The problem**: `escalateForUrl` can raise a message verdict to barking (when a URL is confirmed malicious by Google) but can NEVER lower it. If M02 fires barking because a bank message contains URLs, and the URL check then confirms the URLs are the bank's own official domains with a "clean" verdict, the message stays at barking.

This means the only fix for Gap 2 is WITHIN the message analysis itself (checking URLs at analysis time), not in the post-analysis escalation function.

### Gap 5 (MEDIUM): `why` text in multiple rules asserts things the code never verified

This is not limited to M02. Examples across the codebase where `why` text makes factual claims that the code did not check:

| Location | `why` text | What was actually checked |
|----------|-----------|--------------------------|
| messageAnalysis.ts:156 (M02) | "The link does not lead to the bank's official website." | Whether ANY URL exists in the message (not whether it's official) |
| messageAnalysis.ts:168 (M01) | "The link does not belong to the company being claimed." | Whether ANY URL exists (not whether it matches the courier's domain). The M15 scenario DOES check courier official domains, but M01 fires when M15's conditions don't match. |
| messageAnalysis.ts:174 (M04, govt) | "The link is not an official government address." | Whether ANY URL exists (not whether it matches .gov.au) |

**The fix**: Every `why` line that asserts a fact about a URL's destination must either (a) verify that fact before asserting it, or (b) rephrase to state what was actually checked. For example: *"It contains a link. Apollo has not yet checked where it leads."*

### Gap 6 (MEDIUM): E01 email impersonation fires on legitimate third-party email services

**Location**: emailAnalysis.ts, line 87

**The code**:
```javascript
if (official && senderMismatch && (accountAlert || lookalikeUrls.length || pressure || sig.paymentRequest))
```

`senderMismatch` is true whenever the sender domain is NOT in the brand's official domain list. Australian banks routinely use:
- SendGrid (sendgrid.net)
- Mandrill/Mailchimp (mandrillapp.com)
- Amazon SES (amazonses.com, email-amazonses.com)
- Campaign Monitor (cmail19.com, cmail20.com)

An email from `noreply@em1234.commbank.com.au` sent via SendGrid would have the actual sender domain as the SendGrid infrastructure domain, triggering senderMismatch. Depending on how the user pastes the email, the From header may show the ESP domain rather than the brand domain.

**The fix**: This is hard to fix completely because Apollo can't verify SPF/DKIM from pasted text (correctly noted in the technical output). Two partial mitigations:
1. Add major ESPs (sendgrid.net, mandrillapp.com, amazonses.com) to a "known_mailer" list. When senderMismatch is true AND the sender domain is a known ESP, downgrade from barking to growling and adjust the `why` text: *"It was sent through a third-party email service. Some organisations use these legitimately, but so do scammers. Verify independently."*
2. The E07 scenario (brand mismatch without a clear ask) already handles the gentler case at growling. The issue is specifically E01, which fires at barking when there's also an account alert, link, pressure, or payment request.

### Gap 7 (MEDIUM): Double-counting of correlated signals

**Location**: risk.ts, lines 65-66 and 85

Three correlated pairs were correctly identified in the original report:

1. **deep_subdomains(15) + long_host(10)**: A host with 5+ labels is almost always > 45 characters. These are measuring the same underlying property (hostname complexity). Combined: 25 points for one observation.

2. **brand_lookalike(40) + credential_lure(20)**: credential_lure fires BECAUSE of lookalike (among other conditions). When `lookalike` is the trigger, the brand evidence is already counted at 40 points, and the credential word adds 20 more. Total 60 for what is really "brand impersonation with login words." This isn't necessarily wrong (the credential word IS additional evidence), but it means brand_lookalike(40) alone barely reaches suspicious (40), while brand_lookalike + one credential word = 60, still growling. To reach barking from scoring alone requires a THIRD signal. The decision.ts brand-mismatch path handles barking independently.

3. **The original report's claim about risky_tld + credential_lure double-counting was correct**: when `SUSPICIOUS_TLDS.has(tld)` triggers credential_lure, the TLD is counted once at 15 AND contributes to credential_lure's 20. But this is appropriate — the TLD and the credential word are independently observed facts. No change needed.

**Revised recommendation**: Only pair 1 (deep_subdomains + long_host) is genuine double-counting. When both fire, reduce combined weight by 8 (eliminate long_host contribution when deep_subdomains already fired).

### Gap 8 (LOW): Visibility-lost growling conflates infrastructure status with threat detection

**Location**: stateMachine.ts, lines 92-97

When protection verification expires (no fresh observation in 10 minutes) AND no active events exist, the state machine returns growling: *"Protection observation has expired."*

Per the user's status definitions:
- **Growling**: "Credible evidence suggests a potential scam, fraud attempt or security concern."

A stale protection observation is a security INFRASTRUCTURE concern — not evidence of a scam or fraud. Using the same Growling state for both creates ambiguity: the user sees Apollo growling and wonders "what did it find?" when the answer is "nothing — it just can't confirm protection is running."

The code correctly distinguishes this via `visibilityLost: true` in the resolution, and the UI uses this boolean to show different messaging. This is a presentation concern, not a detection accuracy issue. The state machine's choice of growling for visibility loss is defensible (it IS a security concern), but the user-facing explanation must clearly convey that Apollo is growling about its own observation gap, not about detected suspicious activity.

**Status**: Document as known design choice, not a defect. The `reason` text and `visibilityLost` flag correctly distinguish the case.

---

## 3. Amended Escalation Matrix

### 3.1 Core Principles

**Principle 1 — No barking from arbitrary scores**: Barking requires either externally verified threat intelligence OR local evidence that includes at least one SEMANTIC deception indicator (brand impersonation, credential embedding in deceptive context, homograph attack, disguised file type, known test threat).

**Principle 2 — Emerging scam protection**: When local evidence establishes a clear deception pattern (brand impersonation + credential lure, fake login page, disguised executable), Apollo MUST Bark regardless of whether Google Safe Browsing has listed it. An "unknown" or "unavailable" external verdict does not prevent barking when local deception evidence is strong.

**Principle 3 — Evidence classification**: Every detection signal is classified as either:
- **DECEPTION** (indicates intent to deceive): brand_lookalike, brand_in_path, credentials_in_url, credential_lure (but NOT via isIp alone), known_test_threat, homograph detection, anchor mismatch, disguised file extensions
- **STRUCTURAL** (indicates unusual infrastructure): ip_host, punycode, insecure_scheme, unusual_port, risky_tld, shortener, deep_subdomains, long_host, many_hyphens, encoded_chars, long_url, credential_word
- **CONTEXTUAL** (indicates concerning context from user-supplied or Gemini-extracted evidence): all message/email/call/app/file/page analysis signals

### 3.2 Amended Status Definitions (Aligned with Apollo's Five)

| Status | Internal State | When Apollo enters this status |
|--------|---------------|-------------------------------|
| **Patrolling** | `resting` | No active events. Protection verification fresh (≤10 min). Visibility not lost. Post-recovery cooldown passed. No unresolved findings. |
| **Sniffing** | `ears_up` | Preliminary signal(s) observed that warrant investigation but do not indicate confirmed danger. Check is running. Evidence is low-confidence. OR: structural URL oddity observed without deception evidence. |
| **Growling** | `growling` | Credible evidence suggests a potential scam, fraud attempt or security concern. Evidence supports caution but has not established confirmed malicious reputation or definitive deception. OR: verified protection infrastructure gap. |
| **Barking** | `barking` | Significant evidence requires immediate user attention. At least one of: (a) confirmed malicious from external intelligence, (b) directly observed deception pattern (brand impersonation + credential lure, fake login, disguised executable, code/password/remote-access request), (c) user reports credential exposure or account takeover. |
| **Biting** | `biting` | Verified protective block confirmed by packet-level enforcement evidence. Unchanged. |

### 3.3 Amended Escalation Conditions

#### URL/Website Detection (risk.ts → decision.ts)

| Evidence Pattern | Status | Justification |
|-----------------|--------|---------------|
| Google Safe Browsing match | **Barking** | Externally verified malicious. Trust never overrides. |
| Brand mismatch + credential word OR homograph OR non-clean local score | **Barking** | Deception pattern observed: someone is impersonating a known organisation and presenting credential-harvesting content. Does not require Google listing. |
| Brand mismatch, no credential/homograph/non-clean signals | **Growling** | Brand impersonation observed but intent unclear without credential signals. |
| Local score ≥ 70, AT LEAST ONE deception signal present, Google unknown/unavailable | **Barking** | Strong local deception evidence. Emerging scam not yet in Google's database. |
| Local score ≥ 70, NO deception signal present (pure structural accumulation) | **Growling** | High structural oddity but no evidence of deception intent. Example: router admin page on bare IP with non-standard port. |
| Local score ≥ 70, Google says "clean" AND no deception signal present | **Growling** | Structural oddity confirmed not malicious by Google. |
| Local score ≥ 70, Google says "clean" BUT deception signal IS present | **Barking** (confidence: medium) | Deception pattern observed despite Google not listing it. Common for new phishing pages. The "confidence: medium" correctly signals that external intelligence disagrees. |
| Local score 40-69 | **Growling** | Suspicious but not confirmed. |
| Local score 15-39 | **Sniffing** | Unfamiliar but not concerning. |
| Local score < 15 | **Patrolling** | No warning signs. |

#### Message Detection (messageAnalysis.ts)

| Evidence Pattern | Status | Change from current |
|-----------------|--------|---------------------|
| M02 bank fraud: bank brand + URLs all resolve to official domains | **Sniffing** (new) | Currently barking. Fix: check URLs against official domains before asserting they are fraudulent. |
| M02 bank fraud: bank brand + ANY non-official URL | **Barking** (unchanged) | Keep — deception pattern with non-official URL. |
| M02 bank fraud: bank brand + loginRequest or identityRequest (no URL) | **Barking** (unchanged) | Keep — bank impersonation asking for credentials. |
| M16 callback trap | **Barking** (unchanged) | Keep — do not reduce based on number format alone. |
| All other message scenarios | **Unchanged** | No corrections needed. |

#### Email Detection (emailAnalysis.ts)

| Evidence Pattern | Status | Change from current |
|-----------------|--------|---------------------|
| E01: brand impersonation, sender is known ESP domain | **Growling** (new) | Currently barking. Recognise that ESP domains are legitimately used by brands. |
| E01: brand impersonation, sender is NOT known ESP | **Barking** (unchanged) | Keep. |
| E08: Reply-To differs from sender, SAME registrable org | **No trigger** (new) | Currently triggers. Fix: compare registrable domains, not full domains. |
| All other email scenarios | **Unchanged** | No corrections needed. |

#### Call Detection (callAnalysis.ts)

| Evidence Pattern | Status | Change from current |
|-----------------|--------|---------------------|
| All call scenarios | **Unchanged** | No factual errors found. Call analysis is evidence-based (user-reported actions, not arbitrary scoring). |

#### App Detection (appAnalysis.ts)

| Evidence Pattern | Status | Change from current |
|-----------------|--------|---------------------|
| All scenario-based rules (A01-A20) | **Unchanged** | Scenario rules fire before score-based fallbacks. |
| Score-based fallback (`byScore`) | **Apply same deception/structural rule** | When `byScore` produces barking, verify that at least one deception/context signal is present. Pure permission accumulation without context (no call, no message, no brand) should cap at growling. |

#### Page Analysis (pageAnalysis.ts)

| Evidence Pattern | Status | Change from current |
|-----------------|--------|---------------------|
| All page scenarios | **Unchanged** | Page analysis is Gemini-extracted signal based, not score-based. Every barking scenario requires a specific observed deception pattern (remote access prompt, fake login, fake virus warning). |

#### State Machine (stateMachine.ts)

| Evidence Pattern | Status | Change from current |
|-----------------|--------|---------------------|
| Verified protection gap (visibility lost, observation expired) | **Growling** (unchanged) | Keep — this IS a security concern. `visibilityLost` flag correctly differentiates from threat detection in the UI. |
| Stale barking event (>4 hours on home hero) | **Growling** on home hero; **Barking** in Patrol (unchanged) | Keep. |
| Recovery pending | **Growling** (unchanged) | Keep. |

### 3.4 Anti-Patterns — Verified and Amended

| Anti-Pattern | Current Status | Correction Needed? |
|--------------|---------------|-------------------|
| Structural signals alone accumulate to barking | **CURRENTLY POSSIBLE** | **YES — Gap 1**. Add deception-signal gate before score-based barking. |
| Barking suppressed solely because Google says "unknown" | **NOT HAPPENING** | No. decision.ts:51 fires barking from local malicious regardless of intel status. Confirmed correct. |
| Barking suppressed solely because Google says "clean" | **PARTIALLY CORRECT** | decision.ts:62 sets confidence to "medium" but still barks. This is the right behaviour when deception evidence is present. When deception evidence is absent, this should change to growling (Gap 1). |
| Same indicator counted twice | **YES for 1 pair** | deep_subdomains + long_host. Minor. |
| `why` text asserts facts the code never verified | **YES for M02, M01, M04** | **Gap 5**. Fix the text or add the verification. |
| Related event auto-escalates without new evidence | **NOT HAPPENING** | threatScent.ts requires explicit scent_id transfer (line 43). Confirmed correct. |
| Trust suppresses confirmed malicious verdict | **NOT HAPPENING** | decision.ts:34 — trust_allowed: false for intel malicious. decision.ts:51 — trust_allowed: false for local malicious. Confirmed correct. |
| Unavailable capability represented as detected scam | **PARTIALLY** | Visibility-lost growling uses same state as threat growling. Distinguished by `visibilityLost` flag and `reason` text. Acceptable design. |
| `escalateForUrl` can only escalate, never moderate | **YES** | **Gap 4**. No mechanism for clean URL verdict to lower a message verdict that was set before the URL was checked. |

---

## 4. Summary of Required Changes Before Coding

### Must-fix before implementation begins (addresses both requirements):

| # | Gap | What to change | Files affected | Addresses requirement |
|---|-----|---------------|----------------|----------------------|
| 1 | Score-based barking without deception evidence | Add a deception-signal gate: `local.level === "malicious"` should only produce barking in decision.ts when at least one deception signal is present in `local.signals`. Otherwise cap at growling. | risk.ts (classify signals), decision.ts (check classification) | "Must not Bark based on arbitrary score" |
| 2 | credential_lure fires on isIp alone | Remove `isIp` from credential_lure trigger conditions. IP-based phishing is caught by brand_in_path + isIp already. | risk.ts:85 | "Must not Bark based on arbitrary score" |
| 3 | M02 fires barking on official bank URLs | Before firing M02 with `s.urls.length` as the sole trigger (no loginRequest/identityRequest), check URLs against the official domain list. If all URLs are official, reduce to ears_up. | messageAnalysis.ts:155 | Both requirements |
| 4 | M02/M01/M04 `why` text asserts unchecked facts | Either verify the URL destination before asserting it, or rephrase to "Apollo has not yet verified where this link leads." | messageAnalysis.ts:156, 168, 174 | Detection accuracy |

### Should-fix (improves accuracy, not a requirement blocker):

| # | Gap | What to change | Files affected |
|---|-----|---------------|----------------|
| 5 | E01 fires barking on known ESP domains | Add known_mailer list; downgrade E01 to growling when sender domain is a recognised ESP. | emailAnalysis.ts:87 |
| 6 | E08 compares full domain instead of registrable domain | Use registrableDomain() for reply-to vs sender comparison, or compare against the brand's official domain list. | emailAnalysis.ts:67 |
| 7 | deep_subdomains + long_host double-count | When both fire, reduce long_host to 0 (or merge into a single signal). | risk.ts:65-66 |
| 8 | escalateForUrl can only escalate | Add a moderation path: when all URLs are confirmed clean/official and the message verdict was based on URL presence, allow lowering the verdict. | messageAnalysis.ts:222-227 |

### No change needed (confirmed correct):

- D-BRAND-MIS "strong" logic (Correction 7) — the combination of brand mismatch + credential word is justified for barking.
- M16 callback trap — do not reduce based on number format without a verified number database.
- All call analysis scenarios — evidence-based, not score-based.
- All page analysis scenarios — Gemini-signal-based, not score-based.
- Biting requirements — strict packet evidence, correctly implemented.
- Threat Scent correlation — correctly requires explicit scent_id, not brand/host inference.
- Trust override prevention — correctly blocks trust on confirmed malicious.
- Visibility-lost growling — acceptable design, correctly flagged in UI.

---

## 5. Verification: Both Requirements Reflected Consistently

### Requirement 1: "Apollo must not Bark based on an arbitrary score"

**Before fixes**: A URL like `http://192.168.1.1:8080/login` scores 82 → barking. No deception evidence. This is an arbitrary score.

**After must-fix #1 and #2**: The same URL scores 82 but has no deception signal (brand_lookalike, brand_in_path, credentials_in_url, known_test_threat). Without credential_lure firing on isIp alone (fix #2), the score would be ip_host(35) + insecure_scheme(12) + unusual_port(15) + credential_word(6) = 68 → suspicious → growling. With the deception gate (fix #1), even if the score reached 70+, it would cap at growling without a deception signal.

**Engines where arbitrary-score barking is NOT possible (no changes needed)**:
- Message analysis: barking driven by scenario rules, not scores
- Email analysis: barking driven by scenario rules, not scores
- Call analysis: barking driven by user-reported actions, not scores
- Page analysis: barking driven by Gemini-extracted deception patterns, not scores
- App analysis: scenario rules fire before score fallback; score fallback should also get the deception gate

### Requirement 2: "Apollo must not fail to Bark simply because Google has not yet listed a newly emerging scam"

**Before fixes**: Already correct for most cases. decision.ts:51 fires barking from local malicious regardless of intel. But it also fires barking from structural accumulation (the arbitrary-score problem).

**After must-fix #1**: decision.ts would fire barking from local malicious ONLY when deception evidence is present. A phishing page like `https://comrnbank-secure.xyz/netbank/login` would score brand_lookalike(40) + credential_lure(20) + risky_tld(15) = 75 → malicious, WITH deception signals (brand_lookalike, credential_lure) → barking. Google being unknown/clean/unavailable would NOT prevent this.

**Engines where emerging scam detection is NOT dependent on Google**:
- M02 (with fix #3): fires barking on bank brand + non-official URL (checked locally)
- E01: fires barking on sender mismatch (checked locally)
- All call scenarios: user-reported actions, not Google-dependent
- All page scenarios: Gemini-extracted signals, not Google-dependent
- All app scenarios: user-reported context + permissions, not Google-dependent

---

*End of Corrected Detection Audit — Ready for Approval*
