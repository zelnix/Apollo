# Apollo Site Gate — Physical Device Verification Plan

**Device:** Samsung Galaxy Tab Ultra (Apollo Threat Lab)
**Build required:** Native Android APK with the changes from this implementation
**Status:** PENDING — requires native build before execution

---

## Pre-Test Checklist

Before running any test, confirm:

- [ ] APK is built from the latest source including all Phase 1-4 changes
- [ ] Apollo is installed and the VPN is connected (foreground notification visible)
- [ ] Website Gate is active (`websiteGateActive: true` in protection status)
- [ ] Record Android Private DNS status (Settings → Network & internet → Private DNS)
- [ ] Chrome Secure DNS is set to default (not overridden)
- [ ] Patrol tab is visible and empty or contains only prior events
- [ ] Record the active rule bundle version from protection status

## Test 1: Legitimate Website — No Unnecessary Block

**Target:** `https://www.example.com/`
**Purpose:** Confirm Apollo does not block legitimate websites.

**Steps:**
1. Open Chrome → navigate to `https://www.example.com/`
2. Wait 5 seconds for page to fully load

**Expected:**
- [x] Website loads normally without any interference
- [x] No Patrol event appears
- [x] No toast notification from Apollo
- [x] No "Biting" or "Growling" state change

**Evidence:** Screenshot of loaded page + Patrol tab showing no new events

---

## Test 2: Active BLOCK Rule — DNS Threat Observation

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
- [x] Website does NOT load (connection fails / error page)
- [x] A **DNS threat observation** event appears (new `dns-obs-*` event ID)
- [x] The observation is reported as `"growling"` (NOT "biting" yet)
- [x] The observation `evidence_provenance` is `"dns_observation"`
- [x] Toast: "Apollo detected a known threat: [domain]"
- [x] The observation appears in Patrol with a "DNS threat detected" title

**Evidence:** Patrol event detail showing DNS observation fields

---

## Test 3: DNS Observation + Packet Drop — Verified Enforcement

**Target:** Same blocked domain as Test 2.
**Purpose:** Confirm the full pipeline: DNS observation → sinkhole → packet drop → verified block.

**Steps:**
1. Open Chrome → navigate to the blocked domain (same as Test 2)
2. Wait for Chrome to attempt the TCP connection to the sinkhole IP
3. Wait 10 seconds for the enforcement evidence to be processed

**Expected:**
- [x] DNS threat observation fires first (state: "growling")
- [x] Packet drop occurs (connection to sinkhole IP is dropped)
- [x] **Verified enforcement evidence** is generated (`result: "verified"`)
- [x] State escalates from "growling" to "biting"
- [x] Toast: "Apollo blocked [domain]."
- [x] Patrol shows a "biting" event with `verified_block: true`

**Evidence:** Patrol event with enforcement_evidence showing `result: "verified"` + `evidenceType: "packet_drop"`

---

## Test 4: DNS Observation Without Packet Drop — No Biting

**Target:** Same blocked domain, but with Chrome's connection cancelled before the packet is sent.
**Purpose:** Confirm that a DNS observation alone never produces Biting.

**Steps:**
1. Open Chrome → navigate to the blocked domain
2. **Immediately** press Back/Cancel before Chrome completes the TCP connection
3. Wait 10 seconds

**Expected:**
- [x] DNS threat observation fires (state: "growling")
- [x] No packet drop evidence is generated
- [x] State does NOT escalate to "biting"
- [x] Patrol shows only a "growling" event (dns_observation)
- [x] No verified_block: true on the event

**Evidence:** Patrol event showing "growling" without enforcement_evidence

**Note:** This test may be difficult to reproduce reliably because the TCP connection may complete before the user can cancel. If Chrome always completes the connection, document that behaviour and note that the deduplication correctly prevents duplicate observations.

---

## Test 5: Private DNS — Limitation Reported Without User Action Required

**Target:** Turn on Private DNS and check Apollo's response.
**Purpose:** Confirm Private DNS detection works and Apollo explains the limitation without asking the user to disable it.

**Steps:**
1. Go to Android Settings → Network & internet → Private DNS → Automatic
2. Return to Apollo → wait for next health check (or pull-to-refresh on Home)
3. Check Protection Details
4. Review Higgins messaging and Site Gate limitation text

**Expected:**
- [x] Protection status reports `privateDnsActive: true`
- [x] Site Gate shows limitation explaining encrypted DNS reduces automatic checks, without suggesting the user change settings
- [x] Protection Details shows a "Reduced DNS coverage" finding
- [x] The finding says "No action needed" — does NOT ask the user to turn off Private DNS
- [x] Higgins explains the reduced protection in plain English
- [x] masterCopy shows: "Protection active" with explanation that some checks are limited
- [x] All messaging emphasises what IS still working (link checking, threat rules, other protections)

**Then test with Private DNS OFF:**
1. Go to Android Settings → Network & internet → Private DNS → Off
2. Return to Apollo → wait for next health check
3. Confirm the limitation finding disappears and full DNS coverage is reported

**Evidence:** Screenshots of Protection Details + Higgins message + Site Gate limitation text (both Private DNS ON and OFF)

---

## Test 6: Events in Patrol, Protection Details, Higgins

**Target:** Use the DNS observation from Test 2 and the verified block from Test 3.
**Purpose:** Confirm the full event rendering pipeline.

**Steps:**
1. Navigate to the Patrol tab
2. Verify the DNS observation event and the verified block event are both visible
3. Navigate to Protection Details
4. Verify the DNS observation appears in the timeline
5. Navigate to Home and check Higgins's explanation

**Expected:**
- [x] Patrol: DNS observation shows "DNS threat detected" title with growling state
- [x] Patrol: Verified block shows "Blocked" title with biting state
- [x] Protection Details: Timeline includes DNS observation with correct timestamp
- [x] Higgins: If the driving event is a DNS observation, Higgins says "Apollo detected a known threat — a DNS query for [domain] was intercepted..."

**Evidence:** Screenshots of all three screens

---

## General Rules

1. **Threat Lab independence:** Do not inject results or modify the rule bundle specifically to force tests to pass. Use existing rules or add test rules through the standard backend workflow.
2. **Evidence standards:** A Chrome Safe Browsing warning is NOT evidence of Apollo enforcement. Only Patrol events with appropriate `evidence_provenance` and `verified_block` fields constitute evidence.
3. **No URL interception claims:** Do not verify or claim that Apollo intercepts the complete URL before browser navigation. Apollo observes DNS hostnames only.
4. **Record everything:** For each test, record the exact timestamp, protection status before and after, and any unexpected behaviour.

---

## Post-Test Report Template

For each test, fill in:

```
Test #: [number]
Timestamp: [ISO-8601]
Target: [URL]
Protection status before: [running/checking/etc.]
Private DNS: [on/off]
Website Gate active: [true/false]
Expected behaviour: [brief]
Actual behaviour: [brief]
Patrol events generated: [list IDs]
Evidence type: [dns_observation / enforcement / none]
State achieved: [growling / biting / resting / etc.]
PASS / FAIL: [result]
Notes: [any unexpected behaviour]
```

---

*This testing plan must be executed on the physical Samsung Galaxy Tab Ultra after a native APK build. It cannot be verified via Expo Go, web preview, or emulator.*
