# Proposal: Live Caller ID Lookup — PIR Server (iOS 18+)

**Date:** 2026-10-04
**Status:** Proposal for approval

---

## Protection Gap

iOS Call Gate is currently limited to a static `CXCallDirectoryExtension` that can only block numbers
already known at extension-reload time. There is no per-call identification or real-time reputation
lookup. Android has full real-time call screening via `CallScreeningService` + IPQualityScore — iOS
has nothing comparable.

This means: an iOS user receiving a scam call from a number NOT already in the block list gets zero
protection. The number is queued for later background assessment (which requires opening Apollo), but
no warning appears during or immediately after the call.

## Proposed Solution

**Apple's Live Caller ID Lookup** (iOS 18+, `LiveCallerIDLookup` framework) provides real-time
per-call identification using **Private Information Retrieval (PIR)**. When a call arrives, iOS queries
a PIR server to look up the number — the server cannot learn which number was queried.

### Architecture

```
Incoming call (iOS 18+)
  → LiveCallerIDLookupHandler (extension, already scaffolded)
    → Apple PIR protocol query
      → Apollo PIR Server (new)
        → Pre-indexed phone number database
          → Label + category returned to iOS
            → Caller ID label displayed on lock screen
```

### Components Required

1. **PIR Server** (new infrastructure)
   - Implements Apple's Private Information Retrieval protocol
   - Hosts a pre-indexed database of phone number → {label, category, action}
   - Apple's `live-caller-id-lookup-example` reference server is open-source (Swift)
   - Deployment: single container, ~1-2GB RAM for a 10M-entry database

2. **Phone Number Database Population**
   - Source: IPQualityScore bulk export (already the existing provider)
   - Alternative: Twilio Lookup bulk, community spam databases
   - Update frequency: daily bulk refresh
   - Size: ~10M entries for good US/EU coverage

3. **Extension Completion** (`LiveCallerIDLookupHandler.swift`)
   - Scaffold already exists in codebase
   - Needs: PIR server URL configuration, Apple entitlement, Info.plist keys

### Platform Feasibility

| Aspect | Detail |
|--------|--------|
| iOS version | 18.0+ only (released Sept 2024, ~70% adoption by now) |
| Framework | `LiveCallerIDLookup` — first-party Apple framework |
| Privacy | PIR guarantees server cannot see queried numbers |
| Latency | <200ms typical (pre-indexed, no real-time API calls) |
| Entitlement | Requires Apple approval for the LiveCallerID entitlement |
| User action | Must enable extension in Settings → Phone → Live Caller ID |

### Cost Estimate

| Item | Monthly Cost |
|------|-------------|
| PIR Server hosting (1 container) | ~$20-30 |
| IPQualityScore bulk data export | ~$100-200 (depending on tier) |
| Storage (database snapshots) | ~$5 |
| **Total** | **~$125-235/month** |

### Limitations

- iOS 18+ only — older devices get no improvement
- Database is pre-indexed: a brand-new scam number not yet in the database won't be caught
- PIR returns labels only — no detailed fraud score or carrier info (those come from the existing backend risk check)
- Apple entitlement approval process (weeks)
- User must manually enable the extension
- No Android equivalent needed (Android already has real-time screening)

### Data Sharing

- **PIR protocol**: Apple's cryptographic protocol ensures the server sees encrypted queries. It mathematically cannot determine which specific number was looked up.
- **Database source**: Apollo's server holds the database, populated from IPQualityScore. No user data leaves the device.
- **No new permissions**: The extension uses existing phone call infrastructure.

### Recommendation

**Proceed with implementation.** This is the ONLY supported mechanism for real-time per-call
identification on iOS. The scaffold already exists. The PIR protocol is privacy-preserving by design.
The cost is modest ($125-235/month). Implementation timeline: ~1-2 weeks for server + extension
completion + Apple entitlement application.

### Implementation Steps (if approved)

1. Set up Apple's `live-caller-id-lookup-example` reference server
2. Configure IPQualityScore bulk data import pipeline
3. Complete `LiveCallerIDLookupHandler.swift` with PIR server URL
4. Apply for Apple LiveCallerID entitlement
5. Add extension to EAS build configuration
6. Test with TestFlight
