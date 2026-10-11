# Apollo Site Gate — Physical Device Verification Plan

**Device:** Samsung Galaxy Tab Ultra (Apollo Threat Lab)
**Build required:** Native Android APK with the changes from this implementation
**Status:** PENDING — requires native build before execution. All tests are unexecuted.

---

## Pre-Test Checklist

Before running any test, confirm:

- [ ] APK is built from the latest source including all current changes
- [ ] Apollo is installed and the VPN is connected (foreground notification visible)
- [ ] Website Gate is active (`websiteGateActive: true` in protection status)
- [ ] Record Android Private DNS status (Settings → Network & internet → Private DNS)
- [ ] Record Chrome Secure DNS setting (Chrome → Settings → Privacy → Use secure DNS)
- [ ] Patrol tab is visible and empty or contains only prior events
- [ ] Record the active rule bundle version from protection status

## Test 1: Legitimate Website — No Unnecessary Block

**Status:** PENDING
**Target:** `https://www.example.com/`
**Purpose:** Confirm Apollo does not block legitimate websites.

**Steps:**
1. Open Chrome → navigate to `https://www.example.com/`
2. Wait 5 seconds for page to fully load

**Expected:**
- [ ] Website loads normally without any interference
- [ ] No Patrol event appears
- [ ] No toast notification from Apollo
- [ ] No "Biting" or "Growling" state change

**Actual:** _Record observed behaviour_
**Evidence:** Screenshot of loaded page + Patrol tab showing no new events

---

## Test 2: Active BLOCK Rule — DNS Threat Observation

**Status:** PENDING
**Target:** A domain confirmed present in the active rule bundle with `action: "block"`.
**Purpose:** Confirm the new DNS threat observation pipeline works.

**Setup:**
1. Export the active rule bundle: Settings → Developer → Export rules (or via adb logcat)
2. Identify a domain with `action: "block"` in the bundle
3. If no domain is identifiable, use the backend to add a test domain and trigger a refresh

**Steps:**
1. Open Chrome → navigate to the identified blocked domain
2. Wait 5 seconds

**Expected:**
- [ ] Website does NOT load (connection fails / error page)
- [ ] A **DNS threat observation** event appears (new `dns-obs-*` event ID)
- [ ] The observation is reported as `"growling"` (NOT "biting" yet)
- [ ] The observation `evidence_provenance` is `"dns_observation"`
- [ ] Toast: "Apollo detected a known threat: [domain]"
- [ ] The observation appears in Patrol with a "DNS threat detected" title

**Actual:** _Record observed behaviour_
**Evidence:** Patrol event detail showing DNS observation fields

---

## Test 3: DNS Observation + Packet Drop — Verified Enforcement

**Status:** PENDING
**Target:** Same blocked domain as Test 2.
**Purpose:** Confirm the full pipeline: DNS observation → sinkhole → packet drop → verified block.

**Steps:**
1. Open Chrome → navigate to the blocked domain (same as Test 2)
2. Wait for Chrome to attempt the TCP connection to the sinkhole IP
3. Wait 10 seconds for the enforcement evidence to be processed

**Expected:**
- [ ] DNS threat observation fires first (state: "growling")
- [ ] Packet drop occurs (connection to sinkhole IP is dropped)
- [ ] **Verified enforcement evidence** is generated (`result: "verified"`)
- [ ] State escalates from "growling" to "biting"
- [ ] Toast: "Apollo blocked [domain]."
- [ ] Patrol shows a "biting" event with `verified_block: true`

**Actual:** _Record observed behaviour_
**Evidence:** Patrol event with enforcement_evidence showing `result: "verified"` + `evidenceType: "packet_drop"`

---

## Test 4: DNS Observation Without Packet Drop — No Biting

**Status:** PENDING
**Target:** Same blocked domain, but with Chrome's connection cancelled before the packet is sent.
**Purpose:** Confirm that a DNS observation alone never produces Biting.

**Steps:**
1. Open Chrome → navigate to the blocked domain
2. **Immediately** press Back/Cancel before Chrome completes the TCP connection
3. Wait 10 seconds

**Expected:**
- [ ] DNS threat observation fires (state: "growling")
- [ ] No packet drop evidence is generated
- [ ] State does NOT escalate to "biting"
- [ ] Patrol shows only a "growling" event (dns_observation)
- [ ] No verified_block: true on the event

**Actual:** _Record observed behaviour_
**Evidence:** Patrol event showing "growling" without enforcement_evidence

**Note:** This test may be difficult to reproduce reliably because the TCP connection may complete before the user can cancel. If Chrome always completes the connection, document that behaviour honestly.

---

## Test 5: Private DNS — All Configurations

**Status:** PENDING
**Purpose:** Confirm Apollo correctly detects and honestly reports each Private DNS configuration without asking the user to change settings. Test each configuration independently.

### Test 5a: Private DNS OFF

**Steps:**
1. Go to Android Settings → Network & internet → Private DNS → Off
2. Return to Apollo → wait for next health check (or pull-to-refresh on Home)
3. Check Site Gate status, Protection Details, and Home/Higgins messaging

**Expected:**
- [ ] `privateDnsStatus.bypassLevel` reports `"none"`
- [ ] Site Gate does NOT show a DNS limitation
- [ ] Protection Details does NOT show a "Reduced DNS coverage" finding
- [ ] Home/Higgins messaging reflects full DNS inspection capability

**Actual:** _Record observed behaviour_
**Evidence:** Screenshots of Site Gate + Protection Details + Home card

### Test 5b: Private DNS Automatic

**Steps:**
1. Go to Android Settings → Network & internet → Private DNS → Automatic
2. Return to Apollo → wait for next health check
3. Check Site Gate status, Protection Details, and Home/Higgins messaging

**Expected:**
- [ ] `privateDnsStatus.bypassLevel` reports either `"confirmed"` or `"none"` depending on whether the carrier/network supports DoT
- [ ] If `"confirmed"`: Site Gate shows limitation explaining DNS checks are limited, no settings-change recommendation
- [ ] If `"confirmed"`: Protection Details shows "Reduced DNS coverage" finding with "No action is needed"
- [ ] If `"none"`: no limitation shown (behaves like Test 5a)
- [ ] Messaging never asks the user to change settings
- [ ] Messaging never claims protections are "fully active" when DNS is bypassed

**Actual:** _Record observed behaviour, note whether "Automatic" resolved to DoT or not_
**Evidence:** Screenshots + actual `bypassLevel` value observed

### Test 5c: Private DNS — Configured Provider (e.g. dns.google)

**Steps:**
1. Go to Android Settings → Network & internet → Private DNS → Private DNS provider hostname → enter `dns.google`
2. Return to Apollo → wait for next health check
3. Check Site Gate status, Protection Details, and Home/Higgins messaging

**Expected:**
- [ ] `privateDnsStatus.bypassLevel` reports `"confirmed"`
- [ ] `privateDnsStatus.privateDnsServer` reports `"dns.google"`
- [ ] Site Gate shows limitation: "This device uses encrypted DNS, so Apollo cannot check websites automatically through DNS inspection."
- [ ] Protection Details shows "Reduced DNS coverage" finding naming the provider
- [ ] Finding says "No action is needed" — does NOT suggest disabling Private DNS
- [ ] No "Open device settings" action button on the finding
- [ ] Home/Higgins explains the limitation in plain English without technical terms

**Actual:** _Record observed behaviour_
**Evidence:** Screenshots of all surfaces + raw `privateDnsStatus` object

### Test 5d: Chrome Secure DNS

**Steps:**
1. Set Android Private DNS to Off (isolate Chrome's behaviour)
2. Open Chrome → Settings → Privacy and security → Use secure DNS → enabled (with a provider like Google or Cloudflare)
3. Return to Apollo → check `privateDnsStatus.chromeDoH`

**Expected:**
- [ ] `chromeDoH` reports `"unobservable"` (no Android API exposes Chrome's internal DNS config)
- [ ] Apollo does NOT falsely claim Chrome DNS is observable
- [ ] If Chrome Secure DNS is active, Apollo's DNS interception may still work for non-Chrome apps (record actual behaviour)

**Actual:** _Record observed behaviour — does Apollo's DNS gateway still receive queries from Chrome when Chrome Secure DNS is enabled?_
**Evidence:** Note whether Chrome queries bypass Apollo's gateway

### Test 5e: Wording Consistency Check

**Purpose:** Verify the same honest messaging pattern appears across all surfaces.

**Steps:**
1. With Private DNS set to a configured provider (dns.google):
2. Check and record the exact wording on each surface:
   - Home card (Higgins paragraph)
   - Site Gate `currentHelp` text
   - Site Gate `limitation` text
   - Protection Details finding (`whatFound`, `whatItMeans`, `whatToDo`)
   - Protection tab masterCopy title and line

**Expected:**
- [ ] No surface says "fully active" or "all protections remain active"
- [ ] No surface recommends the user change settings
- [ ] Every surface that mentions the limitation also says "You don't need to change any settings" or equivalent
- [ ] Language is consistent: all surfaces use "some automatic website checks are limited" or similar
- [ ] No surface implies installed rules protect connections Apollo cannot observe

**Actual:** _Record exact wording from each surface_
**Evidence:** Screenshots of every surface showing Private DNS messaging

---

## Test 6: Events in Patrol, Protection Details, Higgins

**Status:** PENDING
**Target:** Use the DNS observation from Test 2 and the verified block from Test 3.
**Purpose:** Confirm the full event rendering pipeline.

**Steps:**
1. Navigate to the Patrol tab
2. Verify the DNS observation event and the verified block event are both visible
3. Navigate to Protection Details
4. Verify the DNS observation appears in the timeline
5. Navigate to Home and check Higgins's explanation

**Expected:**
- [ ] Patrol: DNS observation shows "DNS threat detected" title with growling state
- [ ] Patrol: Verified block shows "Blocked" title with biting state
- [ ] Protection Details: Timeline includes DNS observation with correct timestamp
- [ ] Higgins: If the driving event is a DNS observation, Higgins says "Apollo detected a known threat — a DNS query for [domain] was intercepted..."

**Actual:** _Record observed behaviour_
**Evidence:** Screenshots of all three screens

---

## General Rules

1. **Threat Lab independence:** Do not inject results or modify the rule bundle specifically to force tests to pass. Use existing rules or add test rules through the standard backend workflow.
2. **Evidence standards:** A Chrome Safe Browsing warning is NOT evidence of Apollo enforcement. Only Patrol events with appropriate `evidence_provenance` and `verified_block` fields constitute evidence.
3. **No URL interception claims:** Do not verify or claim that Apollo intercepts the complete URL before browser navigation. Apollo observes DNS hostnames only.
4. **Record everything:** For each test, record the exact timestamp, protection status before and after, and any unexpected behaviour.
5. **Honest reporting:** Mark untested or unobservable scenarios as such. Do not pre-fill expected results as passed. Do not assume outcomes.

---

## Post-Test Report Template

For each test, fill in:

```
Test #: [number]
Timestamp: [ISO-8601]
Target: [URL or configuration]
Protection status before: [running/checking/etc.]
Private DNS setting: [Off / Automatic / Provider: name]
Chrome Secure DNS: [default / enabled with provider / disabled]
bypassLevel observed: [confirmed / none / unobservable]
Website Gate active: [true/false]
Expected behaviour: [brief]
Actual behaviour: [brief]
Patrol events generated: [list IDs or "none"]
Evidence type: [dns_observation / enforcement / none]
State achieved: [growling / biting / resting / etc.]
PASS / FAIL / UNTESTED: [result]
Notes: [any unexpected behaviour or unobservable scenarios]
```

---

*This testing plan must be executed on the physical Samsung Galaxy Tab Ultra after a native APK build. It cannot be verified via Expo Go, web preview, or emulator. All tests are PENDING until executed and recorded.*
