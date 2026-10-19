# Apollo Scam Guard — Detection Rules Audit, Scoring Assessment and Escalation Review

**Date**: June 2026  
**Scope**: All implemented detection engines across frontend domain logic and backend intelligence services.  
**Method**: Source-code inspection of every detection rule. No documentation was assumed correct — every claim in this report traces to a code path.

---

## A. Current Detection Rules Register

### A.1 Website & URL Detection (risk.ts, decision.ts, brand.ts)

| Rule ID | Code | Location | Detection Condition | Evidence Type | Weight | Status Triggered | Auto/Manual | Platform | FP/FN Risk | Recommendation |
|---------|------|----------|---------------------|---------------|--------|------------------|-------------|----------|------------|----------------|
| R01 | `known_test_threat` | risk.ts:57 | Host is in KNOWN_TEST_HOSTS set | Directly observed | 75 | malicious | Auto | All | None (test hosts) | KEEP — correctly identifies test infrastructure |
| R02 | `ip_host` | risk.ts:58 | Hostname is a bare IPv4 or IPv6 address | Directly observed | 35 | suspicious | Auto | All | FP: Some internal/IoT addresses; CDN edge IPs. FN: None significant. | IMPROVE — 35 is heavy for a standalone signal. IP addresses are unusual but not inherently malicious. Many IoT, printer, and router UIs are bare IPs. Recommend: reduce to 20, and only escalate above 35 when combined with credential words or brand mentions. |
| R03 | `credentials_in_url` | risk.ts:59 | URL contains username before @ sign | Directly observed | 45 | suspicious→malicious | Auto | All | FP: Rare legitimate FTP/auth URLs. FN: None. | KEEP — classic phishing disguise technique. Weight is appropriate. |
| R04 | `punycode` | risk.ts:60 | Hostname contains `xn--` (IDN) | Directly observed | 30 | suspicious | Auto | All | FP: Legitimate international domains (e.g. Chinese, Arabic, German sites with umlauts). FN: None. | IMPROVE — 30 is high for a standalone signal. Many legitimate international websites use punycode. Recommend: reduce to 15 standalone, escalate to 30 only when combined with brand mentions. The current weight means a punycode domain + risky TLD (15) = 45 → suspicious, even for a legitimate Chinese website. |
| R05 | `insecure_scheme` | risk.ts:61 | Protocol is http (not https) | Directly observed | 12 | uncertain | Auto | All | FP: Some legitimate legacy sites. FN: None. | KEEP — appropriate low weight as a contributing signal. |
| R06 | `unusual_port` | risk.ts:62 | Non-standard port (not 80/443) | Directly observed | 15 | uncertain | Auto | All | FP: Development servers, some legitimate services on custom ports. FN: None. | KEEP |
| R07 | `risky_tld` | risk.ts:63 | TLD is in SUSPICIOUS_TLDS set (.zip, .top, .xyz, etc.) | Directly observed | 15 | uncertain | Auto | All | FP: Some legitimate .xyz and .top domains exist. FN: Other abused TLDs not in the set. | IMPROVE — .zip and .mov are also used by Google services. Consider splitting: high-abuse (.tk, .ml, .cf, .gq) at 15; medium (.xyz, .top, .icu) at 10; file-type TLDs (.zip, .mov) at 8 with escalation when combined with brand/credential signals. |
| R08 | `shortener` | risk.ts:64 | Registrable domain is a known URL shortener | Directly observed | 20 | uncertain | Auto | All | FP: Legitimate shortened links (marketing, social). FN: New/unknown shorteners. | KEEP — appropriate weight. The hidden-destination concern is real. |
| R09 | `deep_subdomains` | risk.ts:65 | Hostname has 5+ labels (parts) | Directly observed | 15 | uncertain | Auto | All | FP: Some CDN and cloud patterns (e.g. AWS, Azure hostnames). FN: None. | KEEP |
| R10 | `long_host` | risk.ts:66 | Hostname > 45 characters | Directly observed | 10 | uncertain | Auto | All | FP: Some legitimate CDN hostnames. FN: None. | KEEP |
| R11 | `many_hyphens` | risk.ts:67 | Hostname contains 3+ hyphens | Directly observed | 12 | uncertain | Auto | All | FP: Some legitimate German compound-word domains. FN: None. | KEEP |
| R12 | `encoded_chars` | risk.ts:68 | Excessive percent-encoding in hostname or path | Directly observed | 10 | uncertain | Auto | All | FP: Rare. FN: None. | KEEP |
| R13 | `long_url` | risk.ts:69 | Full URL > 200 characters | Directly observed | 8 | uncertain | Auto | All | FP: Legitimate URLs with long query strings (search results, analytics). FN: None. | KEEP |
| R14 | `brand_lookalike` | risk.ts:79 | Brand token found in host but not in the registrable domain's first label | Directly observed + local inference | 40 | suspicious | Auto | All | FP: Legitimate brand-related subdomains (e.g. paypal-community.example.com). FN: Brands not in BRANDS list. | IMPROVE — the detection logic at line 77 has a subtle issue: `brandDomain` is true when the compact first label includes the brand AND has no hyphens AND is not a suspicious TLD, which means some legitimate brand partnerships on normal TLDs may still trigger. Weight of 40 is appropriate for confirmed lookalikes but the condition allows some false positives. See detailed analysis in Section C. |
| R15 | `brand_in_path` | risk.ts:83 | Brand name in URL path when host is IP, suspicious TLD, or shortener | Directly observed + local inference | 25 | suspicious | Auto | All | FP: Low — only fires when combined with suspicious host characteristics. FN: Brand names in paths on normal-looking domains. | KEEP |
| R16 | `credential_lure` | risk.ts:85 | Credential word (login, verify, etc.) combined with lookalike/brand-in-path/suspicious TLD/deep subdomains/IP | Directly observed + local inference | 20 | suspicious | Auto | All | FP: Low — requires signal combination. FN: Credential words on seemingly normal domains. | KEEP |
| R17 | `credential_word` | risk.ts:86 | Credential word present but no other concerning signals | Directly observed | 6 | clean (minor) | Auto | All | FP: None — correctly identified as "on its own this is normal". FN: None. | KEEP |

### A.2 Website Decision Logic (decision.ts)

| Rule ID | Location | Detection Condition | Evidence Type | Status Triggered | Trust Override? | Recommendation |
|---------|----------|---------------------|---------------|------------------|-----------------|----------------|
| D-INTEL-MAL | decision.ts:34 | intel.verdict === "malicious" | Externally verified (Google Safe Browsing) | barking | NO (trust_allowed: false) | KEEP — correctly non-overridable |
| D-LOCAL-MAL | decision.ts:51 | local.level === "malicious" (score ≥ 70) | On-device inference | barking | NO (trust_allowed: false) | IMPROVE — see Section C scoring analysis. When intel says "clean" but local says malicious, confidence is set to "medium" (line 63). This is good. However, the core problem is whether a score of 70 from ONLY local signals justifies barking. See Section C. |
| D-BRAND-MIS | decision.ts:67 | brand.mismatch && !trusted | On-device inference | barking or growling | Partial — trust can override non-strong mismatches | IMPROVE — the "strong" condition at line 68 includes `homograph OR local.level !== "clean" OR login/signin/verify/etc. in URL`. This means a brand mismatch with *any* credential word in the URL path (even `/account/verify-email` on a legitimate partner domain) jumps straight to barking. Recommend: require at least TWO of these conditions for barking, not just one. |
| D-TRUSTED | decision.ts:84 | trusted === true, nothing confirmed malicious | User-supplied trust | resting | Trust applies ONLY to exact link, never overrides confirmed malicious | KEEP |
| D-UNCERTAIN | decision.ts:100 | local.level === "uncertain" (score 15-39) | On-device inference | ears_up | Yes (trust_allowed: true) | KEEP |
| D-SUSPICIOUS | decision.ts:114 | local.level === "suspicious" (score 40-69) | On-device inference | growling | Yes (trust_allowed: true) | KEEP |
| D-CLEAN | decision.ts:131 | local.level === "clean" (score < 15) | On-device + external | resting | N/A | KEEP |

### A.3 Brand & Impersonation (brand.ts)

| Rule ID | Location | Detection Condition | Evidence Type | FP/FN Risk | Recommendation |
|---------|----------|---------------------|---------------|------------|----------------|
| B-DIRECT | brand.ts:61 | Brand token found via direct substring match in hostname parts | Directly observed | FP: Short tokens like "anz" (3 chars) can match legitimate words. FN: Brand misspellings not caught by direct match. | IMPROVE — "anz" at 3 chars uses `host.split(/[.-]/).includes(t)` (exact label match), which is correct. But `compact.includes(t)` for tokens ≥ 5 chars could match "commbank" inside "recommbank-analysis.com". The `registrableDomain` function correctly handles AU second-level suffixes. |
| B-FUZZY | brand.ts:61 | Brand token found only after deobfuscation (0→o, 1→l, rn→m, vv→w) | On-device inference | FP: Rare — deobfuscation only fires when direct match fails. FN: More complex homographs not covered by the substitution table. | KEEP — good homograph detection. Consider adding: ii→u, |→l. |
| B-OFFICIAL | brand.ts:65 | registrable domain matches an entry in the brand's official list | Directly observed | FP: None. FN: Subdomains of official domains operated by third parties (e.g., if a bank's marketing agency hosts on a subdomain of the bank). | KEEP |

### A.4 SMS/Text Message Detection (messageAnalysis.ts)

| Rule ID | Scenario | Location | Detection Condition | Evidence Type | Status Triggered | Auto/Manual | FP/FN Risk | Recommendation |
|---------|----------|----------|---------------------|---------------|------------------|-------------|------------|----------------|
| M16 | Callback trap | :136 | callbackRequest && allegedCharge | User-supplied text + regex | barking | Manual | FP: Legitimate fraud alerts from banks that include callback numbers and mention charges. FN: Callback traps without "charge" language. | IMPROVE — this is Apollo's most aggressive message rule. A real bank fraud alert often mentions an "unauthorised charge" and a number to call. The rule should check whether the callback number matches a known official number for the claimed brand, or at minimum, whether the number is a 1800/1300 (legitimate support) vs mobile/international. Currently, ANY number + ANY charge claim = barking. |
| M06 | Code request | :143 | codeRequest signal active | User-supplied text + regex | barking | Manual | FP: Very low — code requests are almost never legitimate in unsolicited messages. FN: Code requests using unusual wording. | KEEP |
| M10 | Gift cards | :147 | giftCards signal active | User-supplied text + regex | barking | Manual | FP: Very low. FN: None significant. | KEEP |
| M13 | Remote access | :149 | remoteAccess signal active | User-supplied text + regex | barking | Manual | FP: Very low. FN: Novel remote-access tool names. | KEEP |
| M12 | Fake payment | :152 | advanceFee OR (fakePayment && paymentRequest && !brandKind) | User-supplied text + regex | barking | Manual | FP: Low. FN: Sophisticated advance-fee wording. | KEEP |
| M02 | Bank fraud | :155 | brandKind === "bank" && (loginRequest OR identityRequest OR urls.length) | User-supplied text + regex | barking | Manual | FP: Legitimate bank communications that contain links (e.g., monthly statements with "view online" links). FN: Bank impersonation without login/identity/URL signals. | IMPROVE — the condition `urls.length` alone (without loginRequest or identityRequest) with a bank brand match fires barking. A legitimate bank email saying "Your statement is ready - view it at commbank.com.au" would trigger M02 barking because it has a brand (CommBank) + URL. Recommend: when `urls.length` is the only trigger (no loginRequest/identityRequest/threat/urgency), downgrade to growling and check the URL against official domains. |
| M14 | Extortion | :158 | extortion signal active | User-supplied text + regex | barking (with crypto/payment) or growling | Manual | FP: None significant. FN: None significant. | KEEP |
| M05 | Hi Mum/Dad | :161 | familyClaim && (newNumber OR moneyRequest) | User-supplied text + regex | ears_up | Manual | FP: Actual family members on new numbers. FN: None. | KEEP — correctly conservative (ears_up, not barking) |
| M15 | Courier official | :164 | courierLinksOfficial && no payment/login/identity/threat | User-supplied text + regex + domain check | ears_up | Manual | FP: Low. FN: None. | KEEP |
| M01 | Parcel delivery | :167 | brandKind === "courier" | User-supplied text + regex | growling (with payment/URLs) or ears_up | Manual | FP: Real courier notifications. FN: None. | KEEP |
| M03 | Toll scam | :170 | brandKind === "toll" | User-supplied text + regex | growling | Manual | FP: Real toll notifications. FN: None. | KEEP |
| M04 | Government | :173 | brandKind === "government" | User-supplied text + regex | barking (with identity/payment) or growling | Manual | FP: Real government communications. FN: None. | KEEP |
| M08 | Investment | :176 | guaranteedReturns OR (crypto && moneyRequest/paymentRequest) | User-supplied text + regex | growling | Manual | FP: Low. FN: Subtle investment scams. | KEEP |
| M09 | Romance | :179 | romanceEscalation (affection + money/crypto/gifts) | User-supplied text + regex | growling | Manual | FP: Extremely low. FN: Subtle patterns. | KEEP |
| M07 | Fake job | :182 | jobOffer && (platformSwitch OR guaranteedReturns OR $amounts) | User-supplied text + regex | ears_up/growling | Manual | FP: Real job offers that mention platforms. FN: None. | KEEP |
| M11 | Marketplace | :185 | brandKind === "marketplace" OR (fakePayment && urls) | User-supplied text + regex | growling | Manual | FP: Real marketplace notifications. FN: None. | KEEP |
| M04b | Link + pressure | :188 | urls.length && (urgency OR threat OR loginRequest OR paymentRequest) | User-supplied text + regex | growling | Manual | FP: Legitimate urgent notifications with links. FN: None. | KEEP |
| M15b | No concern | :191 | No signals triggered | N/A | resting | Manual | FP: None. FN: Novel scam patterns not covered by existing regex. | KEEP |

### A.5 Email Detection (emailAnalysis.ts)

| Rule ID | Scenario | Location | Detection Condition | Evidence Type | Status Triggered | FP/FN Risk | Recommendation |
|---------|----------|----------|---------------------|---------------|------------------|------------|----------------|
| E01 | Brand impersonation | :87 | Official brand claimed + sender domain mismatch + (account alert OR off-domain links OR pressure OR payment) | User-supplied text + domain check | barking | FP: Third-party mailers sending on behalf of brands (e.g., Salesforce sending CommBank marketing). FN: None. | IMPROVE — third-party email service providers (SendGrid, Mailchimp) legitimately send on behalf of brands. A sender domain of "sendgrid.net" with CommBank branding would fire E01 barking. Recommend: maintain a small whitelist of known ESP domains that reduce this to growling, OR note in the why-text that some organisations use third-party mailers. |
| E02 | Account alert + suspicious link | :89 | accountAlert && (off-domain links OR unknown brand with links) | User-supplied text + domain check | barking/growling | FP: Legitimate password-reset emails with off-domain auth URLs (e.g., Microsoft using microsoftonline.com subdomains). FN: None. | KEEP — the OFFICIAL domain list includes microsoftonline.com. |
| E03 | Risky attachment | :91 | Attachment matches RISKY_ATTACH regex (.exe, .scr, .js, etc.) | User-supplied text + filename check | barking/growling | FP: Legitimate .html attachments (e.g., exported reports). FN: Novel file extensions. | IMPROVE — .html is in RISKY_ATTACH but is commonly used for legitimate email reports and receipts. Recommend: reduce .html to growling unless combined with other signals (unknown sender + pressure). |
| E04 | Changed bank details | :93 | Invoice text + "new/updated/changed bank/account/payment details" pattern | User-supplied text + regex | barking | FP: Very low — legitimate bank-detail changes are rare and deserve verification. FN: None. | KEEP |
| E05 | BEC | :94 | CEO/director/manager keyword + (gift cards OR money request OR urgent transfer) + (freemail OR reply mismatch) | User-supplied text + regex | barking | FP: Very low. FN: BEC without executive keywords. | KEEP |
| E06 | Code/identity request | :96 | codeRequest OR identityRequest | User-supplied text + regex | barking | FP: Very low. FN: None. | KEEP |
| E07 | Brand mismatch, no clear ask | :98 | Official brand + sender mismatch, but no login/payment/link triggers | User-supplied text + domain check | growling | FP: Third-party mailers (same concern as E01). FN: None. | KEEP |
| E08 | Reply-to hijack | :100 | Reply-To domain differs from sender + invoice/payment/money | User-supplied text + header check | growling | FP: Legitimate reply-to addresses (e.g., support@domain differs from noreply@domain). FN: None. | IMPROVE — legitimate "noreply" sender + "support" reply-to within the same organisation should not trigger. Recommend: only fire when the *registrable domain* of Reply-To differs from the sender's registrable domain. |
| E09 | Urgent + links | :102 | URLs present + pressure (urgency or threat) | User-supplied text + regex | growling | FP: Sale notifications with "limited time" + links. FN: None. | KEEP |
| E10 | Invoice + links | :104 | Invoice keywords + links | User-supplied text + regex | ears_up | FP: Low. FN: None. | KEEP |
| E14 | Security alert | :105 | Security alert keywords, sender may match official domain | User-supplied text + domain check | ears_up | FP: None. FN: None. | KEEP — correctly does NOT claim safety even when sender matches |
| E11 | Official sender | :107 | Official brand + sender IS on official domain | User-supplied text + domain check | ears_up/resting | FP: None. FN: Compromised official accounts sending phishing. | KEEP — correctly notes "Apollo can't verify the mail server signatures from pasted text" |
| E12 | Links, no pressure | :109 | Links present, no other signals | User-supplied text | ears_up | FP: None. FN: None. | KEEP |
| E13 | Ordinary | :111 | No signals triggered | N/A | resting | FP: None. FN: Novel patterns. | KEEP |

### A.6 Call Detection (callAnalysis.ts)

| Rule ID | Scenario | Location | Detection Condition | Evidence Type | Status Triggered | FP/FN Risk | Recommendation |
|---------|----------|----------|---------------------|---------------|------------------|------------|----------------|
| C03 | Code request | :62 | asks.has("code") | User-supplied context | barking | FP: None. FN: None. | KEEP |
| C04 | Password request | :63 | asks.has("password") | User-supplied context | barking | FP: None. FN: None. | KEEP |
| C02 | Safe account transfer | :64 | transfer + (bank claim OR "safe/secure/protected account" in transcript) | User-supplied context + regex | barking | FP: None — "safe account" transfer is definitively a scam pattern. FN: None. | KEEP |
| C05/C15 | Remote/screen access | :65 | asks.has("remote") OR asks.has("screen") | User-supplied context | barking | FP: None. FN: None. | KEEP |
| C08 | Gift cards | :66 | asks.has("giftcards") | User-supplied context | barking | FP: None. FN: None. | KEEP |
| C14 | Don't hang up | :67 | asks.has("dont_hangup") | User-supplied context | barking | FP: Very low — legitimate callers don't usually insist you stay. FN: Subtle isolation tactics. | KEEP |
| C05b | Install app | :68 | asks.has("install") | User-supplied context | barking | FP: Very low. FN: None. | KEEP |
| C07 | Government impersonation | :69 | claim === "government" + (transfer OR crypto OR bankdetails OR threat) | User-supplied context | barking | FP: None. FN: None. | KEEP |
| C09 | Crypto payment | :70 | asks.has("crypto") | User-supplied context | barking/growling | FP: Low. FN: None. | KEEP |
| C01/C16 | Bank details/fake refund | :71 | asks.has("bankdetails") | User-supplied context | growling | FP: Low — it's growling, not barking. FN: None. | KEEP |
| C02b | Transfer (non-bank) | :72 | asks.has("transfer") | User-supplied context | barking/ears_up | FP: Family emergency transfers are real (correctly ears_up). FN: None. | KEEP |
| C16b | Unexpected refund | :73 | asks.has("refund") | User-supplied context | growling | FP: Real refunds. FN: None. | KEEP |
| C17 | Subscription scare | :74 | asks.has("subscription") | User-supplied context | growling | FP: Real renewal notices. FN: None. | KEEP |
| C18 | Callback | :75 | asks.has("callback") | User-supplied context | ears_up | FP: None. FN: None. | KEEP |
| C12 | Investment cold call | :76 | claim === "investment" | User-supplied context | growling | FP: Legitimate investment advisers. FN: None. | KEEP |
| C06 | Tech support | :77 | claim === "techsupport" | User-supplied context | growling | FP: Real IT support. FN: None. | KEEP |
| C11/C13 | Family/relationship | :78 | claim === "family"/"relationship" | User-supplied context | ears_up | FP: None. FN: None. | KEEP |
| C20/C01b | Bank/gov/telco | :79 | claim matches, nothing dangerous asked | User-supplied context | ears_up | FP: None. FN: None. | KEEP |
| C19 | Ordinary | :80 | No concerning signals | N/A | resting | FP: None. FN: None. | KEEP |

### A.7 App Detection (appAnalysis.ts)

| Rule ID | Scenario | Location | Detection Condition | Evidence Type | Status Triggered | FP/FN Risk | Recommendation |
|---------|----------|----------|---------------------|---------------|------------------|------------|----------------|
| A01 | Remote access + call | :136 | remoteCapable && (promptedByCaller OR scentCall) | User-supplied + Threat Scent | barking | FP: None — remote access during a suspicious call is definitively dangerous. FN: None. | KEEP |
| A16 | App after suspicious link | :142 | sideload && (promptedByMessageOrSite OR scentWebOrFile) | User-supplied + Threat Scent | barking | FP: Very low. FN: None. | KEEP |
| A03 | Fake update | :148 | looksUpdate && offStore | User-supplied | barking | FP: Legitimate beta/sideloaded updates (rare in consumer context). FN: None. | KEEP |
| A03b | Brand impersonation | :150 | brand && offStore | User-supplied | barking | FP: Open-source builds of branded apps. FN: None. | KEEP |
| A14 | Dangerous connection | :152 | net.blockedMalicious > 0 | SDK-observed (network) | barking/growling | FP: Low — requires actual blocked connections. FN: None (depends on SDK visibility). | KEEP |
| A20 | Intentional remote | :154 | remoteCapable && intentional | User-supplied | ears_up | FP: None. FN: None. | KEEP |
| A01b | Remote, no context | :156 | remoteCapable && !intentional | User-supplied | barking (sideload) / growling | FP: Legitimate remote tools from Play Store. FN: None. | KEEP |
| A05 | Accessibility abuse | :158 | has("accessibility") unexpected | User-supplied | barking (sideload+combo) / growling | FP: Legitimate accessibility apps. FN: None. | KEEP |
| A17 | Device admin | :163 | has("device_admin") unexpected | User-supplied | barking (sideload) / growling | FP: Legitimate security apps. FN: None. | KEEP |
| A10 | Unexpected VPN | :166 | has("vpn") unexpected | User-supplied | growling | FP: Low. FN: None. | KEEP |
| A02 | Sideload + permissions | :168 | sideload && unexpected.length | User-supplied | barking/growling | FP: Legitimate sideloaded apps. FN: None. | KEEP |
| A04/A08/A19 | Excessive permissions | :171 | unexpected ≥ 3 OR unexpectedWeight ≥ 35 | User-supplied | barking/growling | FP: Feature-rich legitimate apps. FN: None. | KEEP |
| A06-A09 | Single sensitive permission | :173 | 1-2 unexpected permissions | User-supplied | ears_up/growling | FP: Low. FN: None. | KEEP |
| A15 | Many unknown hosts | :180 | net.unknownHosts ≥ 5, none confirmed | SDK-observed | ears_up | FP: Ad-heavy free apps. FN: None. | KEEP |
| A13/A18 | Store app | :184 | official store, permissions fit | User-supplied | ears_up | FP: None — correctly does not claim safety. FN: Malicious apps that passed store review. | KEEP |

### A.8 File Detection (fileAnalysis.ts)

| Rule ID | Scenario | Location | Detection Condition | Evidence Type | Status Triggered | FP/FN Risk | Recommendation |
|---------|----------|----------|---------------------|---------------|------------------|------------|----------------|
| F01 | Disguised executable | :76 | Real type is exe/script but name claims document/image | Directly observed (magic bytes) | barking | FP: None — this is definitively malicious intent. FN: None. | KEEP |
| F13 | Executable/script | :77 | Real type is exe/script (not disguised) | Directly observed | barking (unexpected) / growling | FP: Legitimate tools. FN: None. | KEEP |
| F02 | APK | :78 | Real type is apk | Directly observed | barking/growling | FP: Legitimate sideloaded APKs. FN: None. | KEEP |
| F11/F12 | Profile/certificate | :79 | Real type is profile or certificate | Directly observed | barking/growling | FP: Work profiles. FN: None. | KEEP |
| F04/F03 | Archive | :80 | Real type is zip/rar/7z | Directly observed | ears_up/growling | FP: None. FN: None. | KEEP |
| F08 | Macro-enabled doc | :84 | Real type is office_macro | Directly observed | growling/ears_up | FP: Legitimate macro documents. FN: None. | KEEP |
| F05/F06 | Document with links | :85 | URLs found in text sample | Directly observed | ears_up | FP: None. FN: Links outside inspected sample. | KEEP |
| F16 | Not inspected / unknown | :86-88 | Head bytes unavailable or inconclusive | N/A | ears_up | FP: None. FN: All uninspected files. | KEEP |
| F10 | Limited inspection | :87 | Signature matches but full parse not done | Partially observed | ears_up | FP: None. FN: Hidden content beyond sample. | KEEP |

### A.9 Network Detection (networkAnalysis.ts)

| Rule ID | Scenario | Location | Detection Condition | Evidence Type | Status Triggered | FP/FN Risk | Recommendation |
|---------|----------|----------|---------------------|---------------|------------------|------------|----------------|
| N05 | Captive portal | :60-61 | Platform reports captive portal | Platform-observed | growling | FP: Legitimate hotel/airport portals. FN: None. | KEEP — correctly asks user to verify, not claiming malicious |
| N11 | Apollo VPN | :63 | VPN active && apolloVpn === true | Platform-observed | resting | FP: None. FN: None. | KEEP |
| N10 | User VPN | :64 | VPN active && vpnTrusted === true | User-supplied | resting | FP: None. FN: None. | KEEP |
| N09 | VPN after app/device change | :65 | VPN on && Threat Scent has app/device | Platform-observed + Threat Scent | growling | FP: Coincidental timing. FN: None. | KEEP |
| N09b | Unknown VPN | :66 | VPN on && not trusted | Platform-observed | ears_up | FP: None. FN: None. | KEEP |
| N03 | Lookalike SSID | :68-69 | SSID edit distance ≤ 3 from expected | Platform-observed + user-supplied | ears_up | FP: Similar but legitimate network names (e.g., "Hotel WiFi" vs "Hotel Wi-Fi"). FN: Edit distance > 3. | KEEP |
| N04 | Open/WEP WiFi | :71 | wifiSecurity === "open" or "wep" | Platform-observed | ears_up | FP: None. FN: None. | KEEP |
| N02 | Public WiFi | :73 | context === "public" && !trusted | User-supplied | ears_up | FP: None — correctly explains risks without claiming attack. FN: None. | KEEP |
| N01 | Trusted/home/work | :75 | trusted OR context === "home"/"work" | User-supplied | resting | FP: None. FN: Compromised home routers. | KEEP |

### A.10 Device Detection (deviceAnalysis.ts)

| Rule ID | Finding | Location | Detection Condition | Evidence Type | Status Triggered | FP/FN Risk | Recommendation |
|---------|---------|----------|---------------------|---------------|------------------|------------|----------------|
| D01 | Remote access granted | :138 | self.gaveRemoteAccess | User-supplied | recovery (barking) | FP: None — user explicitly reports. FN: None. | KEEP |
| D01b | Banking during remote | :140 | self.usedBankingDuringAccess | User-supplied | recovery (barking) | FP: None. FN: None. | KEEP |
| D02 | Management profile | :147 | managed && !managementExpected | SDK-observed + user-supplied | action (barking) | FP: Work profiles user forgot to mark. FN: None. | KEEP |
| D02b | Device admin (normal) | :149 | managementProfile === "device_admin" | SDK-observed | info | FP: None. FN: None. | KEEP — correctly distinguishes device-admin (normal) from MDM (notable) |
| D03 | Extra certificate | :150 | userTrustedCertificates > 0 OR self.newCertificate | SDK-observed / user-supplied | high | FP: Work certificates. FN: None. | KEEP |
| D04 | Unexpected VPN | :151 | self.unexpectedVpn OR (vpnActive && vpnProviderKnown === false) | SDK-observed / user-supplied | review | FP: Forgotten VPN. FN: None. | KEEP |
| D05 | Accessibility access | :155 | self.grantedAccessibility OR a11y.length | SDK-observed / user-supplied | review | FP: Legitimate accessibility apps. FN: None. | KEEP |
| D06 | Remote-access apps | :157 | remote.length > 0 | SDK-observed | review | FP: Intentionally installed remote tools. FN: Undetected remote tools. | KEEP |
| D07 | Unknown app | :158 | self.newAppUnexpected | User-supplied | review | FP: Forgotten installs. FN: None. | KEEP |
| D08 | Unknown sources | :159 | unknownSourcesEnabled OR self.unknownSourcesOn | SDK-observed / user-supplied | review | FP: Developers. FN: None. | KEEP |
| D12/D13 | Apollo protection off/stopped | :172-173 | Protection health check | SDK-observed | review | FP: None. FN: None. | KEEP |
| D15 | Security change | :181 | Recent permission/service/VPN/profile change | SDK-observed | review/high | FP: User-initiated changes. FN: Silent changes below detection threshold. | KEEP |

### A.11 Account Detection (accountAnalysis.ts)

| Rule ID | Scenario | Location | Detection Condition | Evidence Type | Status Triggered | FP/FN Risk | Recommendation |
|---------|----------|----------|---------------------|---------------|------------------|------------|----------------|
| AC12 | Code entered | :108 | enteredCode === true | User-supplied | barking (very_high risk) | FP: None — user explicitly reports sharing a code. FN: None. | KEEP |
| AC11 | Password entered | :110 | enteredPassword === true | User-supplied | barking (high risk) | FP: None. FN: None. | KEEP |
| AC18 | Locked out | :112 | kind === "locked_out" | User-supplied | barking (high risk) | FP: Forgotten passwords. FN: None. | KEEP |
| AC04/AC15 | Fake alert + off-domain link | :114 | suspiciousUrls.length && (loginRequest OR pressure OR password_reset OR security_alert) | User-supplied text + domain check | barking (high risk) | FP: Legitimate alerts with auth-service URLs not in official list. FN: None. | KEEP |
| AC19b | Unknown link | :120 | suspiciousUrls.length && provider === "other" | User-supplied text | growling (elevated risk) | FP: Low. FN: None. | KEEP |
| AC01/AC02 | MFA prompt | :122 | kind === "mfa_prompt" | User-supplied | barking (repeated/uninitiated) or growling (unsure) | FP: Real MFA prompts the user forgot they triggered. FN: None. | KEEP |
| AC14 | Recovery changed | :132 | kind === "recovery_changed" && !userInitiated | User-supplied | barking (very_high risk) | FP: None. FN: None. | KEEP |
| AC06 | Password changed | :136 | kind === "password_changed" && !userInitiated | User-supplied | barking/growling | FP: None. FN: None. | KEEP |
| AC05 | Requested reset | :142 | kind === "password_reset" && userInitiated | User-supplied | ears_up | FP: None. FN: None. | KEEP |
| AC07/AC08 | Login alert | :146 | kind === "login_alert" | User-supplied | ears_up/growling | FP: User's own login from a VPN. FN: None. | KEEP |
| AC09 | Breach notice | :154 | kind === "breach_notice" | User-supplied | ears_up | FP: None. FN: None. | KEEP — correctly treats as unverified claim |
| AC16 | Security alert | :159 | kind === "security_alert" | User-supplied | ears_up | FP: None. FN: None. | KEEP |
| AC20 | User-initiated matching | :123,132,137,147 | userInitiated === true + timing matches | User-supplied | ears_up | FP: None. FN: None. | KEEP |

### A.12 Page Content Detection (pageAnalysis.ts)

| Rule ID | Scenario | Location | Detection Condition | Evidence Type | Status Triggered | FP/FN Risk | Recommendation |
|---------|----------|----------|---------------------|---------------|------------------|------------|----------------|
| W14 | Remote access prompt | :57 | remote_access_tool OR (install request + virus claim/tech support page) | Gemini-extracted signals | barking | FP: None. FN: Novel tool names. | KEEP |
| W09 | Fake tech support | :61 | tech_support page OR (phone number + virus claim/OS branding/urgency) | Gemini-extracted signals | barking | FP: None. FN: None. | KEEP |
| W08 | Fake virus warning | :66 | virus_or_infection_claim OR (security_warning page + urgency/download/call) | Gemini-extracted signals | barking | FP: None. FN: None. | KEEP |
| W12 | Crypto wallet request | :72 | wallet_connect_request OR wallet page type | Gemini-extracted signals | barking | FP: None. FN: None. | KEEP |
| W18 | Fake CAPTCHA | :76 | captcha_instructions OR (captcha page + download/install/permission) | Gemini-extracted signals | barking/growling | FP: None. FN: None. | KEEP |
| W02/W03 | Fake login | :81 | Login page/credential request + brand mismatch or unofficial host | Gemini-extracted signals + brand check | barking | FP: Legitimate SSO/auth pages not in brand list. FN: None. | KEEP |
| W17 | Credentials, unknown page | :88 | Credential request without matching identity | Gemini-extracted signals | barking/growling | FP: None. FN: None. | KEEP |
| W11 | Payment page | :92 | Payment page type or card/payment asks | Gemini-extracted signals | barking/growling/ears_up | FP: None. FN: None. | KEEP |
| W10 | Fake shop | :99 | Shop page type with warning flags (unrealistic prices, risky payment, no business ID) | Gemini-extracted signals | growling/ears_up/resting | FP: Legitimate small shops. FN: Well-designed fake shops. | KEEP |
| W20 | No concern | :105 | No signals | N/A | resting | FP: None. FN: Sophisticated pages. | KEEP |

### A.13 Google Safe Browsing Integration (intel.py)

| Rule ID | Location | Detection Condition | Evidence Type | Status Triggered | Recommendation |
|---------|----------|---------------------|---------------|------------------|----------------|
| SB-MATCH | intel.py:123 | Safe Browsing returns matches for the URL | Externally verified | barking (via decision.ts) | KEEP |
| SB-CLEAR | intel.py:134 | Safe Browsing returns no matches | Externally verified | No change (clean) | KEEP — correctly does NOT present as "proof of safety" |
| SB-UNAVAIL | intel.py:112-116 | HTTP error, timeout, auth error, malformed response | N/A | Degraded to "unavailable" | KEEP — correctly treats unavailable as unknown, not clean |
| SB-AUTH | intel.py:95-96 | 401/403 from Google | N/A | Short-circuit for 10 minutes | KEEP |

### A.14 DNS Live Reputation (guarddog_live.py)

| Rule ID | Location | Detection Condition | Evidence Type | Status Triggered | Recommendation |
|---------|----------|---------------------|---------------|------------------|----------------|
| DNS-FULL | guarddog_live.py:98 | Full hostname → external intel (Safe Browsing) | Externally verified | Creates threat indicator if malicious | KEEP |
| DNS-HASH | guarddog_live.py:167 | Hash prefix → local threat indicator check | Local match | malicious/unknown | KEEP |
| DNS-INDICATOR | guarddog_live.py:216 | Creates threat indicator for newly discovered malicious hostname | Externally verified → stored | N/A (future rule bundle) | KEEP |

### A.15 Link Guard Helpers (linkGuard.ts)

| Rule ID | Location | Detection Condition | Evidence Type | Status Triggered | Recommendation |
|---------|----------|---------------------|---------------|------------------|----------------|
| LG-ANCHOR | linkGuard.ts:40-44 | Display text claims one domain, href goes to another | Directly observed | barking | KEEP — classic phishing pattern |
| LG-REDIRECT | linkGuard.ts:82-83 | Redirect chain > 2 hops | Directly observed | growling | KEEP |
| LG-NEWDOMAIN | linkGuard.ts:87-89 | Domain registered recently (newly_registered flag from RDAP) | Externally verified (RDAP) | growling | KEEP |
| LG-MAL-URL | linkGuard.ts:75-80 | URL verdict === "malicious" from Safe Browsing | Externally verified | barking | KEEP |

### A.16 Threat Scent Correlation (threatScent.ts)

| Rule ID | Location | Detection Condition | Evidence Type | Recommendation |
|---------|----------|---------------------|---------------|----------------|
| TS-WINDOW | threatScent.ts:8 | Events within 30-minute window linked by scent_id | Cross-event correlation | KEEP |
| TS-KEY | threatScent.ts:19-31 | Shared brand or host keys link events | Cross-event correlation | IMPROVE — see Section D. Generic brands are correctly filtered (line 28-30), but brand-based linking alone (without explicit scent_id transfer) is no longer implemented (line 43 requires explicit scent_id). This is CORRECT — it prevents false correlation. Document this as deliberate. |
| TS-STATE | threatScent.ts:58 | Scent inherits highest state from member events | Derived | KEEP — note: checking another Gate never independently increases severity (documented in comment) |

---

## B. Status-by-Status Analysis

### B.1 PATROLLING (resting)

**Current behaviour**: Apollo enters resting when: (a) no active events, (b) verification is fresh (within 10 minutes), (c) visibility is not "none", and (d) no recent unresolved events within cooldown.

**Existing rules that produce Patrolling**:
- Clean local analysis + clean/unavailable intel (decision.ts D-CLEAN)
- Trusted exact link with no confirmed threat (decision.ts D-TRUSTED)
- No concerning message signals (messageAnalysis.ts M15b)
- No concerning call signals (callAnalysis.ts C19)
- Home/work/trusted WiFi (networkAnalysis.ts N01)
- Device protected status (deviceAnalysis.ts)
- Official-sender email, no signals (emailAnalysis.ts E13)
- No page concerns (pageAnalysis.ts W20)

**Assessment**: Patrolling is correctly implemented. It does NOT claim "your device is safe" or "no threats exist." The wording at stateMachine.ts:124-125 says "Protection was freshly observed. Earlier incidents remain in Patrol." This is honest. The `visibilityFrom()` function correctly returns "none" when nothing is actively protecting, preventing false Patrolling.

**Proposed behaviour**: No change needed. Patrolling accurately reflects the available evidence.

### B.2 SNIFFING (ears_up)

**Current behaviour**: Apollo enters Sniffing when preliminary signals have been observed but investigation is not complete or the evidence is low-confidence.

**Existing rules that produce Sniffing**:
- Uncertain local URL analysis (score 15-39) → decision.ts D-UNCERTAIN: "I don't know {host} well yet"
- Family impersonation pattern without money request → messageAnalysis.ts M05
- Courier notification with official links → messageAnalysis.ts M15
- Ordinary call from a claimed identity → callAnalysis.ts C11/C13/C20
- Official store app → appAnalysis.ts A13/A18
- Sideloaded app with no unusual permissions → appAnalysis.ts A02 (plain sideload)
- Public WiFi → networkAnalysis.ts N02
- Open WiFi → networkAnalysis.ts N04
- Lookalike SSID → networkAnalysis.ts N03
- Unknown VPN → networkAnalysis.ts N09b
- Device findings with "info" or "review" severity (no "high") → deviceAnalysis.ts
- Account login alert → accountAnalysis.ts AC07/AC08
- Breach notice → accountAnalysis.ts AC09
- Security alert → accountAnalysis.ts AC16
- Email with links but no pressure → emailAnalysis.ts E12
- Invoice with links → emailAnalysis.ts E10
- Limited file inspection → fileAnalysis.ts F10/F16
- Archive → fileAnalysis.ts F03/F04

**Assessment**: Sniffing is well-calibrated. The rules correctly differentiate between "worth a closer look" and "confirmed danger." The Hi Mum/Dad pattern (M05) at ears_up is correctly conservative — real family members do change numbers.

**Issues found**:
1. **Official store app (A13/A18)**: An app from the Play Store with no unusual permissions produces ears_up with the verdict "The available information did not establish a specific concern." This is technically correct but may be slightly over-cautious for a routine Check My App on a well-known app. The text compensates ("Not proof of safety or developer identity") which is honest.

**Proposed behaviour**: No structural changes. Consider softening A18's wording slightly for well-known apps from official stores.

### B.3 GROWLING

**Current behaviour**: Apollo enters Growling when credible evidence suggests a potential concern, or when visibility/verification conditions are not met.

**Existing rules that produce Growling**:
- Suspicious local URL analysis (score 40-69) → decision.ts D-SUSPICIOUS
- Brand mismatch without "strong" evidence → decision.ts D-BRAND-MIS (non-strong)
- Parcel delivery scam with links/payment → messageAnalysis.ts M01
- Toll scam → messageAnalysis.ts M03
- Government impersonation without payment/identity → messageAnalysis.ts M04
- Investment/crypto scam → messageAnalysis.ts M08
- Romance escalation → messageAnalysis.ts M09
- Marketplace scam → messageAnalysis.ts M11
- Link + pressure → messageAnalysis.ts M04b
- Extortion without payment → messageAnalysis.ts M14
- Email brand mismatch without clear ask → emailAnalysis.ts E07
- Email reply-to hijack → emailAnalysis.ts E08
- Email urgent + links → emailAnalysis.ts E09
- Bank/card detail request on call → callAnalysis.ts C01/C16
- Investment cold call → callAnalysis.ts C12
- Tech support call → callAnalysis.ts C06
- Subscription scare → callAnalysis.ts C17
- App with some concerning permissions → appAnalysis.ts (various)
- Captive portal → networkAnalysis.ts N05
- VPN after suspicious event → networkAnalysis.ts N09
- Device findings with "review" severity → deviceAnalysis.ts
- Account password changed (unsure if initiated) → accountAnalysis.ts AC06
- Account unknown alert with link → accountAnalysis.ts AC19
- Stale barking events (>4 hours) → stateMachine.ts:76-78
- Visibility lost → stateMachine.ts:92-97
- Recovery waiting → stateMachine.ts:104-117
- Verification expired → stateMachine.ts:121

**Assessment**: Growling is generally well-calibrated with one critical concern:

**Issues found**:
1. **Stale barking degradation (stateMachine.ts:23, 66-78)**: After 4 hours (`EVENT_BARKING_FRESHNESS_MS`), an unresolved barking event degrades the HOME HERO display to growling. The event REMAINS barking in Patrol. This is a good UX decision (prevents perpetual alarming home screen), but the 4-hour window may be too short for users who check their phone infrequently. **This is NOT an error — it's a deliberate design choice documented in the code comment: "Prevents the confusing case where Coverage-at-a-glance is all green but Apollo is barking about stale findings."** However, this means a confirmed malicious Safe Browsing match, if unresolved for 4 hours, drops from barking to growling on the home screen.

2. **Visibility-lost growling**: When protection observation expires or visibility is "none," the state machine enters growling with "Protection is unavailable or unverified." This is honest and appropriate — but it could be misread as "Apollo detected something suspicious" rather than "Apollo can't see enough." The current wording is good ("Protection observation has expired" vs "needs a fresh check") but this IS a case where an unavailable capability is represented as an alert state, which Section 6 of the instructions flags as concerning.

**Proposed behaviour**:
- Consider extending EVENT_BARKING_FRESHNESS_MS to 8 or 12 hours for events backed by confirmed external intelligence (Safe Browsing match).
- Add a distinct visibility-degraded wording that more clearly distinguishes "Apollo can't confirm protection" from "Apollo suspects something." The current implementation does distinguish via `visibilityLost: true` and the reason text, but the state itself is "growling" which may confuse users.

### B.4 BARKING

**Current behaviour**: Apollo enters Barking when significant evidence requires immediate attention. Barking represents the highest alert state that detection alone can produce (Biting requires enforcement evidence).

**Existing rules that produce Barking**: (Exhaustive — every code path that sets state to "barking")

**From URL/Web detection**:
- Confirmed malicious by intelligence (decision.ts:34) — externally verified
- Local score ≥ 70 (decision.ts:51) — on-device inference only
- Strong brand mismatch (decision.ts:67-69) — on-device inference

**From Message detection**:
- M16: Callback trap (alleged charge + callback number)
- M06: Verification code request
- M10: Gift card scam
- M13: Remote access scam
- M12: Fake payment / advance fee
- M02: Bank fraud (bank brand + login/identity/links)
- M14: Extortion with crypto/payment demand
- M04: Government impersonation with identity/payment request

**From Email detection**:
- E01: Brand impersonation with action request
- E02: Account alert with off-domain link (when official brand)
- E03: Risky attachment from unknown/mismatched sender with pressure/invoice
- E04: Changed bank details
- E05: BEC
- E06: Code/identity request

**From Call detection**:
- C03: Code request
- C04: Password request
- C02: Safe account transfer
- C05/C15: Remote access / screen sharing
- C08: Gift cards
- C14: Don't hang up
- C05b: Install app
- C07: Government impersonation with payment/threat
- C09: Crypto payment (non-investment)
- C02b: Money transfer (non-family/relationship)

**From App detection**:
- A01: Remote access during suspicious call
- A16: App after suspicious link/download (sideloaded)
- A03/A03b: Fake update or brand impersonation (off-store)
- A14: Dangerous connection (when score ≥ 70)
- A01b: Remote-capable sideloaded app
- A05: Accessibility abuse (sideloaded + combo)
- A17: Device admin (sideloaded)
- A02: Sideloaded with excessive permissions (when score ≥ 70)

**From File detection**:
- F01: Disguised executable
- F13: Executable/script from unexpected source
- F02: APK impersonating known app or from unexpected source

**From Account detection**:
- AC12: Verification code shared
- AC11: Password entered on suspicious page
- AC18: Locked out
- AC04/AC15: Fake alert with off-domain link
- AC01/AC02: MFA prompt (uninitiated or repeated)
- AC14: Recovery changed (not by user)
- AC06: Password changed (not by user)

**From Page analysis**:
- W14: Remote access prompt
- W09: Fake tech support
- W08: Fake virus warning
- W12: Crypto wallet request
- W18: Fake CAPTCHA with install/paste instructions
- W02/W03: Fake login (brand mismatch)
- W17: Credential request with verification code or bank login

**From Link Guard**:
- Anchor mismatch (display domain ≠ href domain)
- Confirmed malicious URL from Safe Browsing

**From State Machine**:
- Recent barking events (< 4 hours old)

**Assessment — CRITICAL FINDINGS**:

1. **LOCAL-ONLY BARKING WITHOUT EXTERNAL VERIFICATION (D-LOCAL-MAL)**: When the local score reaches 70+ but intelligence is unavailable or returns "clean," the decision engine still produces barking. This is the most concerning false-positive risk in the entire system. A URL like `http://192.168.1.1:8080/paypal-login/verify?account=update` would score: ip_host(35) + insecure_scheme(12) + unusual_port(15) + brand_lookalike(40 — "paypal" in host but not registrable domain) + credential_lure(20) = 122 → capped at 100 → barking. But this could be a legitimate internal PayPal integration or a coincidentally named router page. The code correctly sets confidence to "medium" when intel contradicts (line 63), but still BARKS. **Recommendation**: When the ONLY evidence is local heuristics AND external intelligence says "clean," cap the maximum state at growling, not barking. A clean intelligence verdict should prevent local-only barking.

2. **BRAND MISMATCH ESCALATION (D-BRAND-MIS)**: At decision.ts:68, a brand mismatch combined with ANY credential word in the URL path jumps to barking. The regex `/login|signin|verify|secure|account|auth|update|confirm/i` matches extremely common URL path segments. A URL like `commbank-partners.example.com/account/update` would trigger barking even if intelligence says it's clean. **Recommendation**: Require the credential word to be in the HOSTNAME (not the path) for standalone escalation, OR require at least two escalation conditions (homograph + credential word, or credential word + suspicious TLD).

3. **M02 BANK FRAUD — URL-ONLY TRIGGER**: A message mentioning a bank brand that contains any URL, even an official bank URL, triggers M02 barking. "Your CommBank statement is ready: commbank.com.au/view" would fire barking. **Recommendation**: Before triggering M02, check whether ALL URLs in the message resolve to the claimed brand's official domains. If they do, downgrade to ears_up.

4. **M16 CALLBACK TRAP**: Legitimate bank fraud-alert texts that mention "unauthorised charge" and include the bank's real phone number would trigger M16 barking. **Recommendation**: If the callback number is a 1800/1300 number (legitimate Australian support lines), reduce to growling and note that the number format is consistent with legitimate support.

**Well-justified barking** (no changes needed):
- All externally-verified malicious verdicts (SB-MATCH, DNS-FULL)
- All code/password/gift-card/remote-access requests (C03, C04, C05, C08, M06, M10, M13)
- All disguised executables (F01)
- All recovery-required account scenarios (AC12, AC11, AC14)

### B.5 BITING

**Current behaviour**: Biting is reserved exclusively for verified protective blocks backed by packet-level evidence. It requires:
1. `verified_block === true` (stateMachine.ts:59)
2. `eventHasPacketProof(e)` — strict packet evidence validation (packetEvidence.ts:30-33)
3. Packet evidence must be: DNS filter on Android, DNS protocol, outbound, port 53, with matching event/device IDs and timestamps

**Assessment**: Biting is correctly implemented with strict evidence requirements. The `normalizeHistoricalEvent` function (packetEvidence.ts:36-44) correctly downgrades historical biting claims that lack verified packet proof to barking. The `canTransition` function (stateMachine.ts:137-141) requires explicit `verifiedBlock: true` to enter biting — it can never be inferred.

**Proposed behaviour**: No changes. Biting evidence requirements are correctly strict and enforcement-only.

---

## C. Scoring Assessment

### C.1 Current Formula (risk.ts)

The URL risk score is a **simple additive model**: each detected signal contributes its weight, and the sum is capped at 100.

```
score = min(100, sum(signal.weight for signal in detected_signals))
level = "malicious" if score >= 70 else "suspicious" if score >= 40 else "uncertain" if score >= 15 else "clean"
```

### C.2 Unsupported Assumptions

1. **Additive independence**: The formula assumes each signal contributes independently to risk. In reality, some signals are correlated (see double-counting analysis below).

2. **Threshold calibration**: The thresholds 15/40/70 are not stated as industry-validated, nor should they be. They are engineering judgments. However, their impact on user experience is significant:
   - 15 (uncertain) is a low bar — a single `unusual_port(15)` or `risky_tld(15)` triggers Sniffing.
   - 40 (suspicious) triggers Growling — requires 2-3 medium signals or one heavy signal.
   - 70 (malicious) triggers Barking — this is the critical threshold that needs the most scrutiny.

3. **Equal weighting within thresholds**: A score of 70 from `ip_host(35) + credentials_in_url(45)` = 80 is treated the same as `ip_host(35) + shortener(20) + risky_tld(15)` = 70, but these represent very different risk profiles. The first is a classic phishing pattern; the second might be a legitimate short link to a .xyz domain.

### C.3 Double-Counting Risk

**Identified correlated indicator pairs that may currently be counted twice**:

1. **`deep_subdomains(15)` + `long_host(10)`**: A host with 5+ labels is almost always > 45 characters. These signals co-occur frequently. Combined: 25 points for what is essentially one observation (the hostname is unusually complex).
   - **Recommendation**: Keep both but reduce `long_host` to 5 when `deep_subdomains` also fires, OR merge into a single "complex hostname" signal with weight 18.

2. **`brand_lookalike(40)` + `credential_lure(20)`**: The `credential_lure` rule REQUIRES either `lookalike` or `brandInPath` to fire (risk.ts:85). This means a brand lookalike domain with a login page scores at MINIMUM 40 + 20 = 60, nearly reaching barking. The credential_lure signal is contingent on brand_lookalike — it's not independent evidence.
   - **Recommendation**: Reduce `credential_lure` to 12 when it's triggered by the `lookalike` condition (since the brand evidence is already counted in `brand_lookalike`).

3. **`risky_tld(15)` + `credential_lure(20)`**: The credential_lure condition also fires when `SUSPICIOUS_TLDS.has(tld)` is true. So a URL like `verify-account.xyz` scores risky_tld(15) + credential_lure(20) = 35 for what is essentially "credential word on a risky TLD."
   - **Recommendation**: This is actually appropriate — the TLD and the credential word are independently observed. No change.

4. **`punycode(30)` + `brand_lookalike(40)`**: A punycode domain that resembles a brand scores 30 + 40 = 70 → barking. This may be justified (homograph attack + brand impersonation is definitively dangerous), but the punycode signal alone already implies possible impersonation.
   - **Recommendation**: This combination IS appropriate for barking. Keep as-is.

### C.4 Weak-Indicator Accumulation Risk

**Scenario**: Can weak indicators accumulate into unjustified Barking?

The weakest individual signals are: `credential_word(6)`, `long_url(8)`, `encoded_chars(10)`, `long_host(10)`, `insecure_scheme(12)`, `many_hyphens(12)`.

To reach 70 from ONLY weak signals: 6 + 8 + 10 + 10 + 12 + 12 + 15 + 15 = 88. This requires 8 signals to fire simultaneously, which would only happen for a genuinely unusual URL. However, reaching 40 (growling) is easier: 15 + 15 + 12 = 42 from just `risky_tld + unusual_port + insecure_scheme`. A URL like `http://example.xyz:9090/page` would score 42 and trigger growling, which seems over-aggressive for what could be a legitimate development server.

**Recommendation**: Consider a "base complexity discount" — if no brand, credential, or known-malicious signals are present, reduce the effective score by 10-15 points for the threshold comparison. This would prevent purely structural signals from reaching growling without any semantic threat indicators.

### C.5 Strong-Evidence Insufficiency Risk

**Scenario**: Can combinations of strong evidence receive insufficient severity?

- `credentials_in_url(45)` alone = 45 → suspicious → growling. This is UNDER-SCORED for what is almost always a phishing URL. A URL with `user:password@real-site.com` is using a deception technique that should independently warrant barking.
   - **Recommendation**: Increase `credentials_in_url` to 55, or add a special case: when credentials_in_url fires AND the host after @ differs from the apparent display host, escalate to 70.

- `brand_lookalike(40)` alone = 40 → suspicious → growling. A lookalike domain without any other signals is correctly growling (the user might know the domain).

### C.6 App Scoring Assessment (appAnalysis.ts)

The app risk score uses a different additive model:

```
score = source_weight + unexpectedWeight + context_bonuses - intentional_discount
```

Source weights: app_store(0), play_store(0), other_store(15), not_sure(15), browser(30), message(40)

**Issues**:
1. **Context bonuses stack aggressively**: `promptedByCaller(40) + promptedByMessageOrSite(30) + brand(35) + looksUpdate(35)` = 140 + source + permissions. A sideloaded app during a call that uses a brand name easily exceeds 100. The cap prevents runaway scores, but the scenario-based rules (A01, A16, A03) fire before the score-based rules, so the score primarily affects the "byScore" fallback. This is correct.

2. **Intentional discount (-20)**: The discount for self-reported intentional installation is appropriate but could be circumvented by a caller coaching a victim to report the install as intentional.

**Recommendation**: No structural changes needed. The scenario-based rules correctly override the score for known attack patterns.

---

## D. Recommended Changes

### Priority 1 (High — Detection Accuracy)

| # | Rule | Change | Justification | Current → Proposed |
|---|------|--------|---------------|-------------------|
| 1 | D-LOCAL-MAL | When intel.verdict === "clean", cap local-only detection at growling, not barking | A clean external intelligence verdict should prevent local-only heuristics from producing the highest alert. Local signals alone cannot independently verify maliciousness. | barking → growling (when intel clean) |
| 2 | D-BRAND-MIS | Require ≥2 escalation conditions for strong mismatch (currently any one of: homograph, non-clean local, credential word in URL) | A credential word in the URL path is too common to independently justify barking. `/account/update` appears on millions of legitimate pages. | barking (1 condition) → barking (2+ conditions) |
| 3 | M02 | Check URLs against claimed brand's official domains before barking | A bank message containing only the bank's own official URLs should not trigger barking. | barking (any URL) → ears_up (official URLs only) → barking (non-official URLs) |
| 4 | M16 | Reduce to growling when callback number is 1800/1300 format | Australian support lines use these prefixes. Legitimate bank fraud alerts use callback numbers in these ranges. | barking (always) → growling (1800/1300) → barking (mobile/international) |
| 5 | R02 ip_host | Reduce standalone weight from 35 to 20 | Bare IP addresses are common for routers, printers, and local services. 35 points alone nearly reaches suspicious. | weight 35 → 20 |
| 6 | R04 punycode | Reduce standalone weight from 30 to 15 | Legitimate international domains use punycode. Combined with brand match, escalation occurs naturally through brand_lookalike. | weight 30 → 15 |

### Priority 2 (Medium — Reducing False Positives)

| # | Rule | Change | Justification |
|---|------|--------|---------------|
| 7 | credentials_in_url (R03) | Consider escalating to score 70 when the host-after-@ differs from display | This is almost always a phishing deception technique |
| 8 | E01 | Note in why-text that "some organisations use third-party email services" when sender domain is a known ESP | Reduces confusion for legitimate brand emails via SendGrid/Mailchimp |
| 9 | E08 | Only fire when Reply-To registrable domain differs from sender registrable domain | noreply@bank.com + support@bank.com should not trigger |
| 10 | E03 | Reduce .html from barking to growling unless combined with unknown sender + pressure | HTML attachments are common for receipts and reports |
| 11 | deep_subdomains + long_host | Reduce combined weight by 5 | Correlated indicators — same underlying observation |
| 12 | brand_lookalike + credential_lure | Reduce credential_lure to 12 when triggered by lookalike condition | Already counted in brand_lookalike weight |

### Priority 3 (Low — Refinement)

| # | Rule | Change | Justification |
|---|------|--------|---------------|
| 13 | R07 risky_tld | Split into 3 tiers: high-abuse (15), medium (10), file-type TLDs (8) | .zip is used by Google, .xyz has some legitimate use |
| 14 | EVENT_BARKING_FRESHNESS_MS | Consider 8-12 hours for externally-verified events | 4 hours may be too short for infrequent phone checkers |
| 15 | Visibility-lost growling | Add a distinct `visibilityLost` reason category in the UI | Separates "can't see enough" from "sees something suspicious" |
| 16 | B-FUZZY | Add ii→u and |→l to deobfuscation table | Expand homograph detection |
| 17 | A18 store app | Soften wording for well-known apps from official stores | "Not proof of safety" is accurate but may alarm users for benign checks |

---

## E. Proposed Escalation Matrix

### E.1 Evidence Conditions for Each Status

| Status | Evidence Required | What New Evidence Justifies Entry |
|--------|-------------------|-----------------------------------|
| **PATROLLING** | No active events, fresh verification (≤10 min), visibility not lost, post-recovery cooldown passed | Resolution of all active events + fresh verification |
| **SNIFFING** | Preliminary signals observed OR investigation in progress | Initial detection of low-confidence pattern; unfamiliar but not yet concerning |
| **GROWLING** | Credible evidence of possible concern OR visibility/verification gap | New suspicious signal(s); brand mismatch without strong escalation conditions; visibility expired; recovery pending |
| **BARKING** | Significant confirmed evidence requiring action | Confirmed malicious intelligence match; strong local evidence with corroboration; verified phishing/impersonation; user-reported credential exposure |
| **BITING** | Verified protective block with packet evidence | New enforcement evidence with different evidence_id, observed AFTER any prior resolution |

### E.2 Escalation Rules

| From → To | Required Evidence | Example |
|-----------|-------------------|---------|
| Any → BARKING | Confirmed malicious from external intelligence | Safe Browsing match |
| Any → BARKING | Two or more strong independent indicators | Brand mismatch + homograph + credential request |
| Any → BARKING | User reports credential/code exposure | AC11, AC12 |
| PATROLLING → SNIFFING | Any single uncertain signal | Unfamiliar TLD, shortened link, unknown sender |
| SNIFFING → GROWLING | New supporting evidence (second signal or verified brand mismatch) | Brand mismatch confirmed; suspicious URL pattern; message contains payment request |
| GROWLING → BARKING | External confirmation OR multiple strong independent signals | Intel match; user reports code entered; verified fake login page |
| BARKING → PATROLLING | User resolution + fresh verification + cooldown | User dismisses/trusts after review + 2-min cooldown + 10-min fresh verification |
| BARKING → GROWLING (stale) | Unresolved for > 4 hours (home hero only, event stays barking) | User hasn't addressed the finding |
| Any → BITING | Packet-verified block evidence | Native VPN DNS sinkhole with evidence_id, timestamps, domain, port |

### E.3 Anti-Patterns (Must Not Occur)

| Anti-Pattern | Where Currently Prevented | Verification |
|--------------|--------------------------|--------------|
| Related event auto-escalates without new evidence | threatScent.ts:58 — scent inherits max state, does NOT independently increase. findScentFor requires explicit scent_id transfer (line 43). | VERIFIED — correct. Brand/host keys alone no longer auto-correlate. |
| Same indicator counted multiple times | See Section C.3 — some double-counting exists in risk.ts | NEEDS IMPROVEMENT — see recommendations |
| Earlier finding gains severity without new evidence | eventMerge.ts:74 — preserveResolution checks for genuinely new evidence_id or detection_updated_at | VERIFIED — correct |
| Resolving an event prevents later detection | eventMerge.ts:73 — hasNewEvidence bypasses preservation | VERIFIED — correct |
| Unresolved barking reduced to growling by time alone | stateMachine.ts:67-78 — HOME HERO only, event stays barking in Patrol | VERIFIED — correct design, but see recommendation #14 |
| Unavailable capability shown as detected scam | protectionTruth.ts, gates.ts — unavailable protection states are clearly labeled, never shown as threat detection | VERIFIED — correct. However, stateMachine.ts visibility-lost growling blurs the line (see recommendation #15) |
| Trust decision suppresses later meaningful evidence | decision.ts:34 — trust_allowed: false for confirmed malicious. eventMerge.ts reopening rules. | VERIFIED — correct. Intel malicious overrides trust. |

---

## F. Validation and Coverage Plan

### F.1 Proposed Test Cases

#### F.1.1 URL/Website Detection

| Test ID | Input | Expected Status | Purpose |
|---------|-------|-----------------|---------|
| URL-01 | `https://www.commbank.com.au/netbank` | resting | Legitimate bank URL — no false positive |
| URL-02 | `http://commbank-login.verify-now.xyz/secure` | barking | Brand lookalike + credential + risky TLD |
| URL-03 | `https://paypa1.com/signin` | barking | Homograph (1→l) + credential |
| URL-04 | `https://bit.ly/3xAbCdE` | ears_up (uncertain) | Shortened link — destination hidden |
| URL-05 | `http://192.168.1.1` (with SB clean) | ears_up (proposed, currently growling) | Local router — ip_host should not alone cause growling |
| URL-06 | `https://testsafebrowsing.appspot.com/s/phishing.html` | barking | Known test threat |
| URL-07 | `https://my-new-startup.xyz` (with SB clean) | ears_up (uncertain) | Risky TLD alone — not suspicious |
| URL-08 | `https://example.com` (SB unavailable) | resting (with gap note) | Clean local + unavailable intel — not elevated |
| URL-09 | `https://commbank.com.au.evil.com/login` | barking | Brand in subdomain of different registrable domain |
| URL-10 | `https://user:pass@evil.com/@commbank.com.au` | barking | Credentials in URL + brand disguise |

#### F.1.2 Safe Browsing

| Test ID | Input | Expected Status | Purpose |
|---------|-------|-----------------|---------|
| SB-01 | URL confirmed malicious by SB | barking, trust_allowed: false | External verification → highest alert |
| SB-02 | URL returns SB "no match" | As per local analysis | No match ≠ safe |
| SB-03 | SB returns HTTP 500 | "unavailable" source status | Provider failure ≠ clean |
| SB-04 | SB returns 401/403 | Short-circuit for 10 min, "unavailable" | Auth error handling |
| SB-05 | SB returns malformed JSON | "unavailable" source status | Robustness |
| SB-06 | SB says phishing for a specific URL path | barking for that URL | Path-specific match preserved |
| SB-07 | SB says phishing for `/page.html`; user checks `example.com` (root) | As per local analysis for root | URL-specific finding not extended to whole domain |

#### F.1.3 Messages

| Test ID | Input | Expected Status | Purpose |
|---------|-------|-----------------|---------|
| MSG-01 | "Your CommBank account is locked. Call 1800 022 966 immediately about the $499 charge." | barking (currently), propose growling for 1800 number | Legitimate bank fraud alert format |
| MSG-02 | "Hi Mum, I got a new number. Can you send $200 for my phone bill?" | ears_up | Hi Mum scam — correctly conservative |
| MSG-03 | "Your parcel is delayed. Track: auspost.com.au/track/ABC123" | ears_up | Official courier link |
| MSG-04 | "Your Netflix subscription: netflix.com/account" (no pressure) | resting | Legitimate notification |
| MSG-05 | "Verify your account: bit.ly/abc123" (unknown sender) | growling | Shortened link + login request |
| MSG-06 | "Share the 6-digit code we just sent" | barking | Code request |
| MSG-07 | "Buy 3 iTunes gift cards" | barking | Gift card scam |
| MSG-08 | "Your payment of $2.50 is due: linkt-pay.xyz" | growling | Toll scam (risky TLD link) |

#### F.1.4 Emails

| Test ID | Input | Expected Status | Purpose |
|---------|-------|-----------------|---------|
| EMAIL-01 | From: noreply@commbank.com.au, Subject: "Monthly statement ready", Link: commbank.com.au | resting/ears_up | Legitimate bank email |
| EMAIL-02 | From: commbank@sendgrid.net, Subject: "Verify your account" | barking (E01) — propose noting ESP in why-text | Third-party mailer — could be legitimate |
| EMAIL-03 | From: no-reply@paypal.com, Reply-To: support@paypal.com | resting (same registrable domain) — currently growling (E08) | Same-org reply-to |
| EMAIL-04 | Attachment: invoice.pdf.exe | barking | Disguised executable |
| EMAIL-05 | From: boss@gmail.com "Buy gift cards urgently, don't tell anyone" | barking (E05) | BEC pattern |

#### F.1.5 Calls

| Test ID | Input | Expected Status | Purpose |
|---------|-------|-----------------|---------|
| CALL-01 | Claim: bank, Ask: nothing unusual | ears_up | Possible genuine bank call |
| CALL-02 | Claim: bank, Ask: "transfer to safe account" | barking | Classic bank impersonation |
| CALL-03 | Claim: tech support, Ask: install app | barking | Tech support scam |
| CALL-04 | Claim: family, Ask: transfer money | ears_up | Could be real emergency |
| CALL-05 | Claim: unknown, Ask: verification code | barking | Code theft attempt |

#### F.1.6 Apps

| Test ID | Input | Expected Status | Purpose |
|---------|-------|-----------------|---------|
| APP-01 | AnyDesk from Play Store, intentional | ears_up (A20) | Legitimate remote support |
| APP-02 | AnyDesk from message, caller told to install | barking (A01) | Remote access scam |
| APP-03 | "CommBank" from browser download | barking (A03b) | Brand impersonation |
| APP-04 | "Calculator" from Play Store, no permissions | ears_up (A18) | Normal app |
| APP-05 | Unknown app from browser, accessibility + overlay + SMS | barking (A05) | Banking malware pattern |

#### F.1.7 Files

| Test ID | Input | Expected Status | Purpose |
|---------|-------|-----------------|---------|
| FILE-01 | invoice.pdf (real PDF, from email) | ears_up (F10) | Normal document |
| FILE-02 | document.pdf.exe (magic bytes: MZ) | barking (F01) | Disguised executable |
| FILE-03 | photo.jpg (real JPEG) | ears_up (F10) | Normal image |
| FILE-04 | update.apk from message | barking (F02) | Sideloaded APK from message |
| FILE-05 | report.zip (password in message) | ears_up (F04) | Password-protected archive |

#### F.1.8 Escalation and Resolution

| Test ID | Scenario | Expected Behaviour |
|---------|----------|-------------------|
| ESC-01 | Suspicious message (growling) → URL check confirms malicious | Escalate to barking |
| ESC-02 | Barking event resolved → fresh verification within 10 min | Return to patrolling |
| ESC-03 | Barking event unresolved for 5 hours | Home hero: growling. Patrol: still barking. |
| ESC-04 | Trusted link later confirmed malicious by SB | Trust overridden, barking |
| ESC-05 | Resolved event, then new enforcement evidence arrives | Reopened with new evidence |
| ESC-06 | Protection observation expires (>90 seconds old) | Visibility: limited/none. State machine: growling if no fresh verification. |

#### F.1.9 Cross-Gate Threat Scent

| Test ID | Scenario | Expected Behaviour |
|---------|----------|-------------------|
| SCENT-01 | SMS scam (growling) → user taps link → SB malicious (barking) | Events linked by explicit scent_id. Scent state: barking. |
| SCENT-02 | Suspicious call → app install from message → app has accessibility | Events linked by scent_id transfer. Combined context influences app analysis (scentCall). |
| SCENT-03 | Two unrelated events, same brand name, >30 min apart | NOT correlated (outside window) |
| SCENT-04 | Two events sharing generic brand name ("your bank") | NOT correlated (GENERIC_BRANDS filter) |

### F.2 Accuracy Measurement Recommendations

To measure false-positive rate, false-negative rate, precision and recall, Apollo would need:

1. **Labelled test dataset**: A curated set of URLs, messages, emails, and call scenarios with ground-truth labels (malicious/legitimate). Sources: PhishTank (confirmed phishing), OpenPhish, APWG, plus a set of 500+ known-legitimate URLs including Australian banks, government, and common services.

2. **Metrics per detection engine**:
   - **Precision** = TP / (TP + FP) — "When Apollo barks, how often is it right?"
   - **Recall** = TP / (TP + FN) — "Of all actual threats, how many does Apollo catch?"
   - **False Positive Rate** = FP / (FP + TN)
   - **Per-status accuracy**: Measure separately for barking, growling, and ears_up.

3. **Measurement method**: Run the labelled dataset through each detection engine in isolation, then through the combined decision pipeline. Compare outputs against ground truth.

4. **Baseline targets** (recommended, not validated):
   - Barking precision: > 90% (when Apollo barks, it should be right 9/10 times)
   - Overall recall: > 80% (catch at least 4/5 actual threats at some alert level)
   - Barking false-positive rate on legitimate URLs: < 2%

**No accuracy claims are made in this report because testing has not been performed.**

### F.3 Platform-Specific Limitations

| Platform | What Works | What Doesn't | Why |
|----------|------------|--------------|-----|
| **Android** | All 10 Gates + native VPN DNS filtering + permission detection + app network correlation | Background SMS filtering requires notification access permission | Android architectural constraint |
| **iOS** | All manual checks + Safari content blocker | No VPN DNS filtering, no permission enumeration, no app-to-network correlation | iOS does not permit VPN-based DNS filtering or cross-app observation |
| **Windows** | Desktop-adapted manual checks + firewall/AV/update status | No native DNS filtering | Desktop native module not yet implemented |
| **macOS** | Desktop-adapted manual checks | No native DNS filtering | Desktop native module not yet implemented |
| **Web preview** | All manual checks | No native capabilities, no VPN, simulated enforcement | Expo Go/web limitation |

---

## Summary of Findings

### What Apollo Does Well
1. **Evidence-based explanations**: Every detection rule produces plain-language "why" text that traces to observed evidence.
2. **Honest limitations**: Unavailable intelligence is correctly reported as unknown, never as clean.
3. **Trust handling**: Trust never overrides confirmed malicious verdicts.
4. **Packet-evidence rigor**: Biting requires strict, validated packet proof — never inferred.
5. **Threat Scent discipline**: After the refinement to require explicit scent_id transfer, false correlation between unrelated events is prevented.
6. **Higgins separation**: Detection (what Apollo found) is correctly separated from explanation (what Higgins says about it).
7. **Recovery model**: The state machine's cooldown + fresh-verification requirement prevents premature return to Patrolling.

### What Needs Improvement
1. **Local-only barking**: The most critical detection accuracy issue. Local heuristics alone should not produce barking when external intelligence says "clean."
2. **Brand mismatch escalation**: Too sensitive to common URL path words.
3. **M02 bank fraud URL trigger**: Official bank URLs should not trigger barking in bank-branded messages.
4. **M16 callback trap**: 1800/1300 numbers deserve different treatment from mobile/international numbers.
5. **Score double-counting**: Some correlated signals inflate scores beyond what the evidence supports.
6. **Visibility-lost representation**: The growling state for protection gaps could be confused with threat detection.

### What Must Not Change
1. The five user-facing statuses (Patrolling, Sniffing, Growling, Barking, Biting).
2. Google Safe Browsing as the primary external intelligence source.
3. The Higgins detection/explanation separation.
4. The packet-evidence requirements for Biting.
5. The trust-override prevention for confirmed threats.

---

*End of Detection Audit Report*
