# Apollo Website Protection — Developer Investigation Report

**Date:** October 2026
**Scope:** VPN architecture, Site Gate ↔ Link Gate integration, phishing test failure analysis, detection/reporting pipeline, improvement recommendations
**Classification:** Internal developer document — not for end-user distribution

---

## 1. Current VPN Architecture and Actual Coverage

### 1.1 Architecture Type: Selective-Routing VPN (NOT Full-Tunnel)

Apollo uses an **explicit /32 selective-route VPN**. Only packets destined for a small set of pre-provisioned IPv4 addresses are routed into the TUN file descriptor. All other device traffic bypasses the VPN entirely.

**Code reference:** `SelectiveRouteInstaller.kt` lines 42-84 — every route added via `Builder.addRoute()` is a `/32` (single IP). There are no `/0` (default route) or broad CIDR entries.

**Two co-existing route models (M1 + M2):**

| Model | Purpose | Routes | Evidence Type |
|-------|---------|--------|---------------|
| **M1** (BlockTest) | Single controlled endpoint for packet-drop verification | 1× `/32` to the controlled IPv4 | Real dropped packet → `THREAT_BLOCKED` |
| **M2** (Website Gate) | DNS sinkhole pipeline for exact-host blocking | 1× `/32` DNS gateway + N× `/32` sinkhole pool | DNS observation → sinkhole answer → dropped sinkhole packet → `THREAT_BLOCKED` |

**Code reference:** `GuardDogVpnService.kt` lines 120-201 (`establish()`) and lines 210-278 (`establishWithoutBlockTest()`).

### 1.2 What Traffic Passes Through Apollo

**Only:**
1. **Packets to the controlled M1 endpoint** (a single known-safe IPv4 owned by the backend, used for testing/verification).
2. **DNS queries to the virtual DNS gateway** (a local `/32` address announced as the device's DNS server via `addDnsServer()`) — **only** when Website Gate (M2) is active.
3. **Packets to sinkhole pool addresses** (a small fixed set of local `/32` IPs that blocked domains resolve to, so the connection attempt can be observed and dropped as real evidence).

**Code reference:** `SelectiveRouteInstaller.buildWebsiteGateSpec()` lines 67-83 — assembles exactly these `/32` routes plus `addDnsServer()`.

### 1.3 DNS Inspection

**When Website Gate is active**, Apollo's virtual DNS gateway intercepts **plaintext IPv4 UDP port-53 DNS queries** from ALL applications on the device. The OS sends these queries to the virtual endpoint because `addDnsServer()` tells Android to use it.

**Code reference:** `TunPacketReader.kt` lines 40-71 — the read loop classifies each packet via `DnsPacketClassifier` (checking if destination matches `dnsGatewayIpv4`), and routes DNS queries to `DnsGatewayPacketHandler.handle()`. Non-DNS packets go to `PacketDropReporter.onPacket()`.

**The DNS gateway then:**
1. Parses the DNS query (hostname, record type) — `DnsQueryParser.kt`
2. Canonicalizes the hostname — `HostCanonicalizer.kt`
3. Checks the hostname against the active rule bundle (exact-host match) — `SinkholeBindingStore.arm()` → `GuardDogSDKEngine.authorizeWebsiteGateTarget()`
4. **BLOCK match:** Answers with a sinkhole IP (A record) or NXDOMAIN (AAAA record) — `DnsResponseSynthesizer.kt`
5. **ALLOW / WARN / UNKNOWN / no match:** Forwards the query upstream untouched — `ProtectedUdpDnsForwarder.kt`

### 1.4 What Traffic Bypasses Apollo's Inspection

| Bypass Category | Technical Reason | Can Apollo Observe It? |
|----------------|------------------|----------------------|
| **DNS-over-HTTPS (DoH)** | Encrypted HTTPS connection to a remote resolver (e.g., `dns.google`, `cloudflare-dns.com`). Never enters the VPN as a DNS query — it appears as normal HTTPS traffic to port 443, which is not routed to the TUN. | **No.** The /32 selective routes never capture arbitrary HTTPS connections. |
| **DNS-over-TLS (DoT)** | TLS connection to port 853. Same reason — not routed to TUN. | **No.** |
| **QUIC (HTTP/3)** | UDP to port 443. Not routed to TUN. | **No.** |
| **IPv6 DNS** | Apollo's DNS gateway only handles IPv4 UDP/53. IPv6 DNS traffic is never routed. | **No.** (AAAA *queries* over IPv4 are handled — blocked hosts get NXDOMAIN — but native IPv6 transport is not.) |
| **Android Private DNS** | When "Private DNS" is enabled in Android settings, the OS resolves ALL DNS over TLS (port 853) to the configured provider, bypassing Apollo's virtual DNS server entirely. | **No.** This is the single most significant bypass. |
| **Chrome Secure DNS** | Chrome may use its own built-in DoH resolver (e.g., Google DoH), bypassing the system resolver and therefore Apollo's DNS gateway. | **No.** |
| **Any non-DNS, non-sinkhole, non-controlled-endpoint IP traffic** | HTTPS connections, app data, streaming, etc. — these go direct because there is no `/0` default route. | **No.** |

**Critical finding:** `ApolloGuardDogProductionRuntime.kt` line 221 explicitly declares this:

```
"coverage": "GuardDog production Website Gate: plaintext IPv4 DNS is inspected;
exact-host blocks use short-lived sinkhole /32 routes. Private DNS, DoH, DoT,
QUIC and IPv6 are outside this source claim."
```

### 1.5 Can a Dangerous Website Load Without Apollo Observing Its Destination?

**Yes.** Multiple pathways:

1. **Private DNS enabled** → All DNS bypasses Apollo → website loads unobserved.
2. **Chrome Secure DNS (DoH)** → Chrome resolves the domain itself → website loads unobserved.
3. **Domain not in active rule bundle** → DNS observed but forwarded upstream (no match) → website loads because Apollo has no rule for it.
4. **QUIC-only websites** → If Chrome uses QUIC for the connection, Apollo never sees the traffic.

### 1.6 VPN Persistence When Backgrounded or Closed

**Yes — the VPN persists.** `GuardDogVpnService` extends Android's `VpnService` and runs as a foreground service with a persistent notification (`ProtectionNotificationFactory`). Android's VPN framework maintains the TUN interface independently of the app's UI process.

**Code reference:** `GuardDogVpnService.kt` lines 88-96 — uses `startForegroundCompat()` immediately on service start. The `onRevoke()` callback (line 285) handles the case where the OS revokes the VPN.

**However:** If the process is killed by Android (aggressive OEM battery optimization, force-stop, etc.), the VPN stops. The `onStartCommand` with `null` intent (system re-delivery) deliberately fails closed rather than running without a live runtime:

```kotlin
null -> fail("service restarted by the system without a live runtime (process died during start)")
```

---

## 2. Site Gate and Link Gate Integration

### 2.1 Current Architecture: They Are Largely Separate Systems

**Site Gate** (automatic background protection) and **Link Gate** (on-demand manual check) share a rule bundle but operate on fundamentally different data:

| Aspect | Site Gate | Link Gate |
|--------|-----------|-----------|
| **Trigger** | Automatic: intercepts DNS queries during normal browsing | Manual: user submits a URL via the Check It screen |
| **Input** | Hostname only (extracted from DNS query) | Full URL (scheme, host, path, query string, etc.) |
| **Intelligence** | Local exact-host rule match only | Local risk analysis + backend `/intel/check` + backend `/link/investigate` (Higgins AI) |
| **Blocking** | DNS sinkhole → packet drop (verified enforcement) | Adds hostname to override store → becomes a rule for Site Gate |
| **Evidence** | Packet-drop evidence (OS-level proof) | Risk score, intelligence verdict, Higgins assessment |

### 2.2 Does Site Gate Automatically Consult Link Gate's Threat Intelligence?

**No.** Site Gate operates solely on the pre-distributed rule bundle. It does not query the backend intelligence API, run the local risk scorer, or invoke Higgins for any hostname it observes.

**Code reference:** `SinkholeBindingStore.arm()` → `GuardDogSDKEngine.authorizeWebsiteGateTarget()` → `bundle.exactMatch(canonical)`. This is a deterministic lookup in a static JSON rule set, not an intelligence query.

### 2.3 Can Site Gate Recognise a Dangerous Domain Before Content Loads?

**Only if the domain is in the active rule bundle.** The rule bundle contains a finite list of exact hostnames with `action: "block"`. If a domain is present and matched, Site Gate answers with a sinkhole IP before the browser ever receives the real address — effectively pre-loading prevention.

**If the domain is NOT in the rule bundle**, Site Gate forwards the DNS query upstream untouched. The browser receives the real IP address, connects, and the page loads without Apollo's intervention.

### 2.4 What Happens for Suspicious but Unlisted Domains?

Nothing automatic. The DNS query is forwarded upstream, the real IP is returned, and the page loads. The user must manually check the URL using Link Gate (Check It) for Apollo to assess it.

### 2.5 Can Apollo Perform Deeper Link Analysis Without Interrupting Browsing?

**Not currently.** The VPN only sees DNS queries (hostnames). It never sees the full URL, HTTP headers, page content, or response bodies. Deeper analysis requires the full URL, which is only available when:
- The user manually submits it to Check It (Link Gate)
- Another protection (e.g., Message screening) extracts it from a message
- The user shares it via "Open with Apollo"

### 2.6 Are Link Gate Findings Incorporated Into Native Protection Rules?

**Yes, but only via manual user action.** When a user taps "Block" on a Link Gate check result, `blockEvent()` in `ApolloContext.tsx` calls `securityAdapter.blockDestination(host)`, which adds the hostname to `MutableWebsiteGateOverrideStore`. This override store is consulted by `SinkholeBindingStore.arm()` on the next DNS query for that host.

**Code reference:** `SinkholeBindingStore.kt` line 44: `if (overrideStore.overrideFor(host) == WebsiteGateOverrideDecision.ALLOW) return null` — but overrides are only ALLOW (user trust), not BLOCK. Wait — let me check the actual override mechanism:

**Correction:** The override store is for ALLOW overrides (trusting a false positive). The "Block" action from Link Gate works differently:

From `ApolloGuardDogProductionRuntime.kt`, the `blockDestination()` method in the Expo bridge calls into the production runtime which adds the host to the website gate override store as a block. However, examining `WebsiteGateOverrideStore` more carefully:

```kotlin
@Volatile var websiteGateOverrideStore: WebsiteGateOverrideStore = NoWebsiteGateOverrides
```

The override store check in `SinkholeBindingStore.arm()` only checks for `ALLOW`. A block override for a domain **not in the rule bundle** would need to be added to the rule bundle itself, which is server-managed and refreshed periodically — meaning there is a **delay** before Link Gate findings reach Site Gate for domains not already in the bundle.

### 2.7 The Missing Integration

**The fundamental gap:** Site Gate and Link Gate share a rule bundle but have no real-time intelligence bridge:

1. **No automatic enrichment:** When Site Gate observes a DNS query for a domain NOT in the rule bundle, it cannot ask Link Gate's backend intelligence whether the domain is suspicious. It must fail open.
2. **No path-level inspection:** Site Gate only ever sees hostnames. A phishing page at `legitimate-host.com/evil-path` is invisible to hostname-based filtering.
3. **No dynamic rule updates from Link Gate findings:** When Link Gate identifies a new threat (via backend intelligence or Higgins), that finding does not automatically become a Site Gate blocking rule until the rule bundle is refreshed from the server (6-hour periodic refresh via `ApolloGuardDogRefreshWorker`).

### 2.8 Pre-Browser Link Inspection on Android

**A VPN cannot read arbitrary encrypted HTTPS URLs.** The full URL (scheme + host + path + query) is encrypted within the TLS connection. The VPN only sees the destination IP address (after DNS resolution).

**Alternative Android mechanisms for pre-browser URL interception:**

| Mechanism | How It Works | Limitations |
|-----------|-------------|-------------|
| **Android App Links / Verified Links** | App declares `intent-filter` for specific domains; Android opens the app instead of the browser. | Requires domain ownership verification (`.well-known/assetlinks.json`). Only works for domains Apollo controls. Not usable for arbitrary phishing domains. |
| **Accessibility Service** | Can read URL bar content from Chrome and other browsers. | Invasive permission. Google Play restricts apps from using Accessibility for non-accessibility purposes. May be blocked by browser. Reactive (URL already navigated), not preventive. |
| **WebView interception** | `shouldInterceptRequest()` in a custom WebView. | Only works within Apollo's own WebView, not system browsers. Not applicable to Chrome. |
| **VPN + SNI inspection** | Read the TLS Client Hello's SNI (Server Name Indication) field, which contains the hostname in plaintext. | Provides hostname only (same as DNS). Does not reveal the full URL path. Chrome may use ECH (Encrypted Client Hello) which encrypts SNI. |

**Conclusion:** Automatic pre-browser interception of complete URLs for arbitrary websites is **not technically achievable** on Android within standard platform APIs. The closest practical approach is DNS-level hostname inspection (which Apollo already does) combined with SNI inspection for TLS connections (which would require a full-tunnel VPN).

---

## 3. Failed Phishing Test Analysis

### 3.1 Test Conditions
- **Device:** Samsung Galaxy Tab Ultra
- **APK:** Native Android build with VPN connected
- **URL:** `https://testsafebrowsing.appspot.com/s/phishing.html`
- **Observed:** Chrome displayed a dangerous-site warning. Apollo did not register a security incident.

### 3.2 Trace: What Actually Happened

**Step 1: DNS Resolution**

The user navigated to `testsafebrowsing.appspot.com`. A DNS query for this hostname entered Apollo's virtual DNS gateway (assuming Private DNS was off and Website Gate was active).

**Step 2: Hostname Rule Check**

`DnsGatewayPacketHandler.handle()` called `SinkholeBindingStore.arm("testsafebrowsing.appspot.com")`, which called `GuardDogSDKEngine.authorizeWebsiteGateTarget()`, which performed:

```kotlin
val rule = bundle.exactMatch(canonical)
```

**This is the critical point.** The rule bundle uses **exact hostname matching**. The domain `testsafebrowsing.appspot.com` is a Google-owned test domain on the `appspot.com` shared hosting platform. It is **extremely unlikely** that this specific subdomain is in Apollo's threat rule bundle, because:

1. `appspot.com` is a legitimate Google App Engine domain hosting millions of applications.
2. Blocking `appspot.com` would break legitimate services.
3. Blocking `testsafebrowsing.appspot.com` specifically would require this exact test subdomain to be in the rule set.

**Result: No exact-host match → ALLOW → DNS query forwarded upstream → browser received the real IP address.**

**Step 3: HTTPS Connection**

Chrome connected to the resolved IP address over HTTPS (port 443). This connection was **not routed through Apollo's TUN** because there is no `/32` route for this IP — only the controlled endpoint, DNS gateway, and sinkhole pool IPs are routed.

**Step 4: Chrome's Own Safe Browsing**

Chrome performed its own Google Safe Browsing check (separate from Apollo, built into the browser). Chrome's database identified the page as a phishing test page and displayed its native "Dangerous site" interstitial.

**Step 5: Apollo's Perspective**

From Apollo's perspective:
- A DNS query for `testsafebrowsing.appspot.com` was observed and forwarded (no rule match).
- No sinkhole binding was created (no block action).
- No packet was routed to the TUN for this destination (no `/32` route for the real IP).
- No enforcement evidence was generated.
- No event reached Patrol, Home, or Higgins.

### 3.3 Root Cause

**The domain `testsafebrowsing.appspot.com` is not present in Apollo's active rule bundle.** Apollo's current architecture can only block domains it already knows about from its pre-distributed rules. This test URL is specifically designed to trigger browser-level Safe Browsing warnings, not third-party network filters operating at the DNS level.

**Secondary factor:** Even if the hostname were in the rule bundle, Apollo would only have blocked the hostname. It has no way to distinguish between `testsafebrowsing.appspot.com/s/phishing.html` (a dangerous path) and `testsafebrowsing.appspot.com/` (which may be benign). Path-level inspection is architecturally impossible at the DNS layer.

### 3.4 Did Chrome Pre-empt Apollo?

**No — Apollo was never in a position to act.** Chrome's Safe Browsing warning is displayed after the TLS connection is established and the URL is checked against Google's threat database. But Apollo had already forwarded the DNS query upstream (no rule match), so there was no race condition. Chrome and Apollo were operating independently on different data at different layers.

### 3.5 Additional Evidence Needed

To fully confirm this analysis, the following physical-device evidence would be useful:

1. **Rule bundle contents:** Export the active rule bundle (`persistedBundle()` from `SharedPreferences`) and confirm `testsafebrowsing.appspot.com` is absent.
2. **DNS gateway logs:** Check whether `DnsGatewayPacketHandler` logged `"DNS gateway pass-through"` for this hostname (confirming it was forwarded, not blocked).
3. **Website Gate status:** Confirm `GuardDogVpnRuntime.websiteGateActive == true` at the time of the test (confirming the DNS pipeline was operational).
4. **Private DNS status:** Confirm Android's Private DNS was off (Settings → Network → Private DNS → Off). If Private DNS was on, Apollo's DNS gateway was entirely bypassed.

---

## 4. Detection and Reporting Pipeline

### 4.1 Complete Evidence Pipeline

```
Native DNS Observation
    ↓ (hostname extracted from DNS query)
Rule Assessment (exactMatch against rule bundle)
    ↓
    ├── NO MATCH → Forward upstream (fail open, NO event generated)
    │
    └── MATCH (action: "block") →
            ↓
        Sinkhole Binding Armed (authorization, NOT evidence)
            ↓
        DNS Response Synthesized (sinkhole IP for A, NXDOMAIN for AAAA)
            ↓
        Browser Attempts Connection to Sinkhole IP
            ↓
        Packet Arrives at TUN (destination matches sinkhole /32 route)
            ↓
        PacketDropReporter.onPacket() — Packet Intentionally Dropped
            ↓
        BlockedThreatEvidence Generated (real OS-level proof)
            ↓
        ProtectionEnforcementReporter → ApolloGuardDogProductionRuntime
            ↓
        GuardDogSDKEngine.reportBlockedPacket() — THREAT_BLOCKED emitted
            ↓
        ApolloGuardDogEvidenceCorrelator.correlate() — Evidence Record Created
            ↓
        BoundedEvidenceInbox.append() — Persisted to SharedPreferences
            ↓
        JS Bridge polls evidence → syncEnforcementEvidence()
            ↓
        isVerifiedEnforcement() check — Only "verified" evidence proceeds
            ↓
        PatrolEvent created (state: "biting", verified_block: true)
            ↓
        persistEvents() → Stored locally
            ↓
        syncEventRef.current() → Uploaded to backend
            ↓
        showToast() → User notified: "Apollo blocked [domain]."
            ↓
        Patrol tab → Home tab → Higgins interprets
```

### 4.2 Gap: DNS-Level Detection Without Enforcement

**Currently, Apollo does NOT record DNS-level threat detections that do not result in a packet drop.**

The `GuardDogSDKEngine.authorizeWebsiteGateTarget()` function explicitly states (line 168):

> "DNS is authorization input, never enforcement evidence. [...] Creates a short-lived binding and emits nothing -- no THREAT_BLOCKED, no THREAT_DETECTED."

This means:
- If a blocked hostname is resolved via DNS (Site Gate observes it and arms a sinkhole binding)...
- ...but the browser **never attempts a connection** to the sinkhole IP (e.g., Chrome blocks it first, the tab is closed, or the connection uses QUIC/IPv6)...
- ...then Apollo has **no record** that the threat was ever observed.

**The `analyzeUrl()` method** DOES emit `THREAT_DETECTED` — but it is only called from the JS bridge for manual URL checks (Link Gate), never from the automatic DNS pipeline.

### 4.3 Silent Suppression of Evidence

**Evidence retrieval failures ARE reported**, not silently suppressed:

```kotlin
inbox.reportFailure("Production rule bundle expired; evidence was withheld")
inbox.reportFailure("Production engine event reporting failed")
inbox.reportFailure("Production evidence correlation failed")
inbox.reportFailure("Production evidence contract failed")
```

These failure messages are stored in the `BoundedEvidenceInbox` and surfaced in the `status()` output as `evidencePersistenceError`.

**However**, the JS bridge only polls for **verified enforcement evidence** (`evidence()` method returns records that pass `contractValid()`). Failed or incomplete evidence chains are reported in status but never create Patrol events.

### 4.4 State Integrity

Apollo's state model is correctly maintained:

| State | Requirement | Implementation |
|-------|------------|----------------|
| **Sniffing** | Initial check in progress | Set during `runProtectionHealthCheck()` |
| **Patrolling** | No threats, protection confirmed active | Set when all checks pass |
| **Growling** | Uncertain/suspicious finding | Set by Link Gate risk assessment or intelligence |
| **Barking** | Confirmed threat, not yet blocked | Set by Link Gate or account alert assessment |
| **Biting** | Verified block with OS-level proof | ONLY set by `syncEnforcementEvidence()` with `isVerifiedEnforcement()` check |

The critical `canTransition()` guard (referenced in `syncEnforcementEvidence`) ensures Biting is never set without verified evidence, and the `isVerifiedEnforcement()` function requires `result === "verified"`.

---

## 5. Detection and Reporting Gaps

### Gap 1: No DNS-Observation Events (HIGH)

When Site Gate observes a DNS query for a known-blocked hostname and arms a sinkhole binding, this observation is not recorded anywhere if the subsequent packet drop never occurs. This means:
- Chrome may display its own warning and prevent navigation, but Apollo has no record of the threat encounter.
- The user's Patrol timeline shows nothing, even though Apollo actively protected them (the DNS answer pointed to a sinkhole).
- Higgins cannot explain what happened because there is no event to interpret.

**Recommendation:** Emit a `THREAT_DETECTED` event (distinct from `THREAT_BLOCKED`) when a sinkhole binding is armed. This event should be clearly labelled as a DNS-level detection, not a verified block. If the subsequent packet drop occurs, upgrade the event to `THREAT_BLOCKED`. If not, the detection event stands alone — truthfully representing what Apollo observed.

### Gap 2: No Automatic Intelligence Queries (HIGH)

Site Gate has no mechanism to query the backend intelligence API for domains not in the rule bundle. This means newly discovered phishing domains, zero-day threats, and domains identified by Link Gate's deeper analysis are invisible to automatic protection until the rule bundle is refreshed (up to 6 hours).

**Recommendation:** Evaluate whether a lightweight, privacy-preserving real-time intelligence lookup (e.g., hashed hostname prefix, similar to Google Safe Browsing API v4) could be integrated into the DNS pipeline. This must be carefully balanced against privacy (no full hostname transmission), latency (DNS resolution must remain fast), and battery impact.

### Gap 3: Limited Rule Bundle Scope (MEDIUM)

The rule bundle is a finite list of exact hostnames. It cannot match:
- Wildcard patterns (e.g., `*.evil.example.com`)
- Path-level patterns (e.g., `example.com/phishing/*`)
- Newly registered domains not yet in the list
- IP-address-only destinations

**Recommendation:** Evaluate wildcard/suffix matching support in the rule engine. Path-level matching is architecturally impossible at the DNS layer and should not be attempted here.

### Gap 4: Private DNS / DoH Bypass (HIGH)

When Android's Private DNS is enabled, or Chrome uses Secure DNS (DoH), ALL DNS queries bypass Apollo's virtual DNS gateway. Apollo has no visibility into what domains the device is resolving, and Site Gate is completely ineffective.

**Recommendation:** See Section 6.

### Gap 5: Rule Bundle Freshness (MEDIUM)

The periodic refresh worker runs every 6 hours (`ApolloGuardDogRefreshWorker`). A domain identified as dangerous at hour 0 may not reach the device rule bundle until hour 6.

**Recommendation:** Consider event-driven push updates for critical rule additions, or reduce the refresh interval for high-risk periods.

---

## 6. Protection Improvement Recommendations

Ranked by importance and feasibility:

### Rank 1: DNS-Observation Event Pipeline (MINIMUM CHANGE — HIGH IMPACT)

**What:** When `SinkholeBindingStore.arm()` successfully arms a binding (meaning a known-blocked hostname was observed in a DNS query), emit a new `DNS_THREAT_OBSERVED` event type through the existing evidence pipeline.

**Why:** This closes Gap 1 with minimal architectural change. The event carries different semantics from `THREAT_BLOCKED` — it says "Apollo observed and redirected a DNS query for a known threat" rather than "Apollo blocked a real connection." This is truthful, valuable, and visible in Patrol/Home/Higgins.

**Impact:** Low code change (add event emission in `SinkholeBindingStore` or `DnsGatewayPacketHandler`). No VPN architecture change. No new permissions. No battery impact.

**Evidence standard:** This event must be clearly distinguished from a verified block. It should map to **Growling** (suspicious, observed, not confirmed enforcement), never Biting.

### Rank 2: Private DNS / DoH Detection and Warning (MINIMUM CHANGE — HIGH IMPACT)

**What:** Detect when Android's Private DNS is enabled or when the device is using DoH/DoT, and surface a clear warning to the user explaining that Apollo's website protection is bypassed.

**Why:** This is the single largest coverage gap. A user who enables Private DNS (increasingly common) completely disables Site Gate without any warning from Apollo.

**Implementation:** The `ApolloGuardDogNetworkObserver` already monitors network DNS changes. Extend it to detect Private DNS configuration (Android API: `ConnectivityManager.getLinkProperties()` → check for `isPrivateDnsActive()`). Surface the finding as a protection degradation event.

**Impact:** Small code change. No VPN architecture change. No new permissions beyond `ACCESS_NETWORK_STATE` (already required). Informs the user truthfully.

### Rank 3: Better Site Gate ↔ Link Gate Integration (MEDIUM CHANGE — HIGH IMPACT)

**What:** When Link Gate identifies a new malicious domain (via backend intelligence or Higgins), immediately add it to the local website gate override store so Site Gate blocks it on the next DNS query, without waiting for the 6-hour rule bundle refresh.

**Why:** Currently, a user might check a link via Link Gate, see "Barking — confirmed threat," tap "Block," but the block only takes effect if Site Gate has a rule for that exact hostname. If the hostname is new (not in the rule bundle), the block depends on the override store mechanism working correctly for BLOCK (not just ALLOW) overrides.

**Implementation:** Ensure `blockDestination()` in the production runtime adds the hostname to the override store as a BLOCK override, and that `SinkholeBindingStore.arm()` checks for BLOCK overrides (currently it only checks for ALLOW). Also: when the backend intelligence API flags a domain as `malicious`, the JS layer should proactively add it to the native override store.

**Impact:** Medium code change. Strengthens the connection between the two systems. No new permissions.

### Rank 4: Lightweight Real-Time Intelligence at DNS Layer (LARGER CHANGE — HIGH IMPACT)

**What:** For DNS queries where the hostname is NOT in the rule bundle, perform a fast, privacy-preserving lookup against a backend intelligence service before forwarding upstream.

**Why:** This would give Site Gate the ability to protect against threats beyond its static rule set. However, it introduces latency (every DNS query waits for a network round-trip) and privacy concerns (the backend learns which domains the device is resolving).

**Privacy mitigation:** Use a hash-prefix scheme (similar to Google Safe Browsing API v4) where only the first N bits of the hostname hash are sent. The backend returns all matching rules, and the client checks locally. This prevents the backend from knowing the exact hostname.

**Impact:** Significant architecture change. Requires backend API, client-side caching, latency management, offline fallback. Should be evaluated separately.

### Rank 5: SNI Inspection for TLS Connections (REQUIRES FULL-TUNNEL VPN — EVALUATE CAREFULLY)

**What:** Upgrade from selective-route to a broader VPN that can read TLS Client Hello SNI fields for hostname-level visibility on encrypted connections.

**Why:** This would allow Apollo to see the destination hostname of HTTPS connections, even when DNS was resolved via DoH/DoT. It would partially close the Private DNS bypass gap.

**Why NOT (yet):**
- **Battery:** A full-tunnel VPN processes EVERY packet on the device, dramatically increasing battery consumption.
- **Performance:** Every packet traverses user-space read/write loops. Latency increases for all network operations.
- **Reliability:** A full-tunnel VPN failure drops ALL connectivity. The current selective-route failure only affects the controlled endpoints.
- **Privacy:** Processing all packets gives Apollo visibility into all network traffic patterns, which conflicts with Apollo's privacy-first positioning.
- **ECH (Encrypted Client Hello):** Chrome is adopting ECH, which encrypts the SNI field. Once deployed, SNI inspection becomes ineffective for the primary browser.
- **Complexity:** Full-tunnel VPN requires TCP session tracking, UDP flow management, and careful handling of connection timeouts — significantly more code and more failure modes.

**Recommendation:** Do NOT upgrade to full-tunnel solely for SNI inspection. The battery/performance/privacy costs outweigh the benefits, especially given the ECH trajectory. Instead, prioritize Ranks 1-4 which provide meaningful improvements within the current architecture.

### Rank 6: Broader DNS Monitoring (MEDIUM CHANGE — MEDIUM IMPACT)

**What:** Monitor DNS query patterns (frequency, volume, timing) even for allowed domains to detect anomalous behavior (e.g., DGA domains, tunneling, exfiltration).

**Why:** Even without blocking, observing DNS patterns can identify compromised devices or malicious apps generating unusual DNS traffic.

**Impact:** Medium code change. Privacy considerations (storing DNS query logs). Battery impact from additional processing.

### Not Recommended: Full-Tunnel VPN

A full-tunnel VPN is NOT recommended at this time because:
1. The selective-route architecture is fundamentally sound for its stated coverage.
2. The major gaps (Private DNS bypass, missing DNS-observation events, limited intelligence integration) can be addressed within the current architecture.
3. The costs (battery, performance, reliability, privacy, maintenance) are disproportionate to the incremental coverage gain.
4. ECH adoption will erode the primary benefit (SNI inspection) over the next 12-18 months.

---

## 7. Physical-Device Testing Plan

### Test 1: Legitimate Website (Baseline)

**Target:** `https://www.example.com/`
**Expected Apollo behavior:** DNS query observed, forwarded upstream (no rule match), website loads normally.
**What Apollo CAN observe:** The DNS query for `www.example.com`.
**Evidence of block:** None expected.
**Verification:** Website loads. No Patrol event. No toast.

### Test 2: Controlled Domain in Active Rules

**Target:** A domain confirmed present in the active rule bundle with `action: "block"`.
**Setup:** Export the rule bundle and identify a blocked domain. If none are identifiable, use the backend to add a test domain and refresh rules.
**Expected Apollo behavior:** DNS query intercepted → sinkhole answer → browser attempts connection to sinkhole IP → packet dropped → `THREAT_BLOCKED` event → Patrol event (Biting) → toast "Apollo blocked [domain]."
**What Apollo CAN observe:** DNS query, sinkhole binding, packet drop.
**Evidence of a block:** `EnforcementEvidence` with `result: "verified"`, correlated event in Patrol.
**Verification:** Website does NOT load. Patrol shows Biting event. Toast displayed.

### Test 3: Suspicious Domain NOT in Rules

**Target:** `https://testsafebrowsing.appspot.com/s/phishing.html`
**Expected Apollo behavior:** DNS query observed, forwarded upstream, website loads. Chrome may show its own warning.
**What Apollo CAN observe:** The DNS query for `testsafebrowsing.appspot.com` (if Private DNS is off).
**Expected warning from Apollo:** None (current behavior). After implementing Gap 1 fix: a DNS observation event if the domain were added to the rule bundle.
**Evidence of a block:** None — Apollo has no rule for this domain.
**Verification:** Confirms the gap identified in Section 3. Chrome's warning is Chrome's Safe Browsing, not Apollo.

### Test 4: Phishing URL with Specific Path

**Target:** A URL where the hostname is legitimate but the path is malicious (e.g., a compromised site with a phishing page at `/login/secure-verify.html`).
**Expected Apollo behavior:** DNS query observed, forwarded (no rule match on the legitimate hostname), website loads.
**What Apollo CAN observe:** The hostname in the DNS query. NOT the path.
**Expected warning from Apollo:** None. Path-level inspection is architecturally impossible at the DNS layer.
**Verification:** Confirms that hostname-only filtering cannot protect against path-based phishing on legitimate domains. This is an inherent limitation of DNS-level protection, not a bug.

### Test 5: Normal Chrome DNS (Private DNS OFF)

**Setup:** Android Settings → Network → Private DNS → Off.
**Target:** Same as Test 2 (a domain in the rule bundle).
**Expected behavior:** Apollo's DNS gateway intercepts the query → block/sinkhole → verified enforcement.
**Verification:** Patrol event appears. This confirms the happy path.

### Test 6: Chrome Secure DNS (Private DNS ON)

**Setup:** Android Settings → Network → Private DNS → Automatic (or a specific provider like `dns.google`).
**Target:** Same as Test 2 (a domain in the rule bundle).
**Expected behavior:** Apollo's DNS gateway is **bypassed entirely**. The domain resolves via encrypted DNS to its real IP. Apollo never sees the query. The website loads.
**Verification:** NO Patrol event. This confirms Gap 4 — Private DNS completely disables Site Gate.

### Test 7: IPv4 vs IPv6

**IPv4 target:** A blocked domain resolving to an A record.
**Expected:** Sinkhole answer (IPv4) → packet drop → verified block.

**IPv6 target:** The same blocked domain, but queried for AAAA.
**Expected:** NXDOMAIN answer for AAAA (preventing IPv6 resolution of a blocked host). Browser falls back to IPv4 → sinkhole → block. If the device is IPv6-only (rare), the connection may fail entirely (NXDOMAIN) — this is correct behavior (blocking, not passing).

**Pure IPv6 transport:** If the device sends DNS queries over native IPv6 transport (not IPv4 UDP/53), Apollo does not see them. This is a known limitation.

### Proof Requirements

For each test, record:
1. The exact Apollo protection status before the test (`status()` output from the native bridge).
2. Whether Private DNS is on or off.
3. Whether Website Gate is active (`websiteGateActive`).
4. The DNS gateway log output (any `"DNS gateway pass-through"` messages).
5. Whether a Patrol event appeared (and its state: Sniffing/Patrolling/Growling/Barking/Biting).
6. Whether a toast was displayed.
7. Whether Chrome displayed its own warning (this is Chrome's Safe Browsing, not Apollo's).

**A Chrome Safe Browsing warning is NOT evidence of Apollo enforcement.** A Patrol event with `verified_block: true` and `enforcement_evidence` is.

---

## 8. Summary of Findings

### 8.1 Current Coverage

Apollo's website protection provides **exact-hostname DNS-level blocking** for domains present in a pre-distributed rule bundle, using a selective-route VPN that inspects **plaintext IPv4 UDP/53 DNS queries only**. This is a sound, privacy-preserving, evidence-based architecture with clear, honestly stated limitations.

### 8.2 What Works

1. ✅ VPN persists when backgrounded (foreground service).
2. ✅ DNS sinkhole pipeline correctly intercepts and blocks known-rule domains.
3. ✅ Packet-drop evidence chain is rigorous (OS-level proof required for Biting).
4. ✅ Evidence failures are reported, not silently suppressed.
5. ✅ State model (Sniffing → Patrolling → Growling → Barking → Biting) is correctly maintained.
6. ✅ AAAA queries for blocked hosts return NXDOMAIN (preventing IPv6 leakage).
7. ✅ Website Gate-only mode provides protection even when BlockTest is unavailable.
8. ✅ Coverage limitations are honestly declared in the native status output.

### 8.3 What Does Not Meet the Stated Requirement

The stated requirement: *"Apollo should provide meaningful automatic protection during ordinary device use, within clearly stated platform capabilities."*

| Gap | Impact | Fix Complexity |
|-----|--------|---------------|
| DNS-observation events not recorded | Users don't see Apollo protecting them | LOW — add event emission |
| Private DNS / DoH bypass undetected | Protection silently disabled, no warning | LOW — detect and warn |
| Link Gate findings don't reach Site Gate in real-time | Manual checks don't strengthen automatic protection | MEDIUM — bridge override stores |
| Rule bundle scope limited to exact hostnames | New threats unprotected for up to 6 hours | MEDIUM — improve refresh + consider hash-prefix lookup |
| No intelligence at DNS layer | Site Gate cannot evaluate unknown domains | HIGH — requires new API + caching + privacy design |

### 8.4 Minimum Changes Within Existing Architecture

1. **DNS-observation events** (Rank 1): Emit `THREAT_DETECTED` when a sinkhole binding is armed.
2. **Private DNS detection** (Rank 2): Warn user when Apollo's DNS gateway is bypassed.
3. **Site Gate ↔ Link Gate bridge** (Rank 3): Make Link Gate block findings immediately available to Site Gate.

These three changes require no VPN architecture modification, no new permissions, and no full-tunnel upgrade.

### 8.5 Changes Requiring Separate Architectural Approval

1. **Real-time intelligence at DNS layer** (Rank 4): New backend API, privacy model, caching strategy.
2. **Full-tunnel VPN** (Rank 5): Fundamentally different architecture. NOT recommended.
3. **DNS pattern analysis** (Rank 6): Privacy-sensitive logging. Requires policy decision.

---

## Appendix A: Key Code References

| File | Location | Purpose |
|------|----------|---------|
| `GuardDogVpnService.kt` | `packages/guarddog-android-sdk/guarddog-vpn/` | VPN service, TUN establishment, read loop orchestration |
| `SelectiveRouteInstaller.kt` | Same package | /32 route construction |
| `TunPacketReader.kt` | Same package | Packet read loop, DNS vs. non-DNS classification |
| `DnsGatewayPacketHandler.kt` | Same package | DNS query → rule check → sinkhole or forward |
| `SinkholeBindingStore.kt` | Same package | Sinkhole IP assignment, binding lifecycle |
| `DnsResponseSynthesizer.kt` | Same package | Raw DNS response packet construction |
| `PacketDropReporter.kt` | Same package | Dropped-packet evidence generation |
| `WebsiteGatePacketAuthorizer.kt` | Same package | Classifies packet destination (controlled / sinkhole / unrecognized) |
| `GuardDogSDKEngine.kt` | `packages/guarddog-android-sdk/guarddog-core/` | Rule matching, URL analysis, THREAT_BLOCKED emission |
| `RuleBundle.kt` | Same package | Rule bundle model, exact-host matching |
| `ApolloGuardDogProductionRuntime.kt` | `modules/apollo-security/android/` | Apollo's production authority over GuardDog |
| `ApolloGuardDogEvidenceCorrelator.kt` | Same module | Evidence correlation (SecurityEvent + BlockedThreatEvidence → inbox record) |
| `ApolloContext.tsx` | `src/store/` | JS-side enforcement evidence sync, Link Gate check flow |
| `risk.ts` | `src/domain/` | Local URL risk analysis (Link Gate) |

## Appendix B: Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        ANDROID DEVICE                          │
│                                                                 │
│  ┌──────────┐    DNS (UDP/53)     ┌──────────────────────┐     │
│  │  Chrome   │──────────────────→│  Apollo VPN TUN      │     │
│  │  or App   │                    │  (selective /32)      │     │
│  └──────────┘                    └──────────┬───────────┘     │
│       │                                      │                  │
│       │ HTTPS (443)                    ┌─────┴──────┐          │
│       │ (NOT routed                    │ DNS Query? │          │
│       │  through TUN)                  └─────┬──────┘          │
│       │                              Yes ↙        ↘ No        │
│       ▼                     ┌───────────┐  ┌──────────────┐   │
│  ┌──────────┐              │ DNS       │  │ PacketDrop   │   │
│  │ Internet │              │ Gateway   │  │ Reporter     │   │
│  │ (direct) │              │ Handler   │  │ (M1/M2)     │   │
│  └──────────┘              └─────┬─────┘  └──────────────┘   │
│                           Rule Match?                          │
│                          ↙          ↘                          │
│                    Yes (BLOCK)   No (ALLOW/UNKNOWN)            │
│                    ┌──────────┐  ┌──────────────┐             │
│                    │ Sinkhole │  │ Forward to   │             │
│                    │ Answer   │  │ Upstream DNS │             │
│                    └────┬─────┘  └──────────────┘             │
│                         │                                      │
│                  Browser connects                              │
│                  to sinkhole IP                                │
│                         │                                      │
│                  ┌──────┴───────┐                              │
│                  │ Packet Drop  │                              │
│                  │ = VERIFIED   │                              │
│                  │   EVIDENCE   │                              │
│                  └──────┬───────┘                              │
│                         ▼                                      │
│                  ┌──────────────┐                              │
│                  │ THREAT_      │                              │
│                  │ BLOCKED      │                              │
│                  │ (Biting)     │                              │
│                  └──────────────┘                              │
│                                                                 │
│  ⚠️ NOT OBSERVED BY APOLLO:                                    │
│  • Private DNS (DoT port 853)                                  │
│  • Chrome Secure DNS (DoH)                                     │
│  • QUIC (UDP 443)                                              │
│  • IPv6 transport                                              │
│  • HTTPS traffic (not routed)                                  │
│  • URL paths (encrypted in TLS)                                │
└─────────────────────────────────────────────────────────────────┘
```

---

*End of investigation report. No code changes were made during this investigation.*
