# Apple Live Caller ID Entitlement Application Guide

**Date:** 2026-10-04
**Bundle ID:** `app.apollo.hwg`
**Extension Target:** `ApolloLiveCallerID`
**Extension Bundle ID:** `app.apollo.hwg.ApolloLiveCallerID`

---

## Overview

Apple's Live Caller ID Lookup (iOS 18+) lets apps provide real-time caller identification
using Private Information Retrieval (PIR). This ensures neither Apple nor the network learns
which specific phone number is being looked up — only the PIR server sees the query, and
even then, PIR cryptography means the server doesn't learn the specific row being requested.

Apollo uses this to display scam/fraud labels on incoming call screens for numbers in its
reputation database.

## Prerequisites

Before applying:

1. **Active Apple Developer Program membership** ($99/year)
2. **A running PIR server** (see `docs/PIR_SERVER_DEPLOYMENT.md`)
3. **Published privacy policy** covering caller ID data processing
4. **App published on App Store** (or in TestFlight review)

## Application Process

### Step 1: Request the Entitlement

1. Go to: **https://developer.apple.com/contact/request/live-caller-id-lookup**
2. Sign in with your Apple Developer account
3. Fill in the application form:

| Field | Value |
|-------|-------|
| **App Name** | Apollo |
| **Bundle ID** | `app.apollo.hwg` |
| **Team ID** | *(your Apple Developer Team ID)* |
| **App Description** | Apollo is a privacy-focused security app that helps users identify potential scam and fraud calls. It uses Apple's PIR protocol to provide real-time caller identification without compromising user privacy. The PIR server is self-hosted and all queries are relayed through Apple's OHTTP proxy. |
| **PIR Server URL** | `https://pir.your-domain.com` *(your deployed PIR server)* |
| **Privacy Policy URL** | `https://your-domain.com/privacy` |
| **How caller data is collected** | Phone number reputation data is collected from automated risk assessments (IPQualityScore) when users check phone numbers through Apollo's Call Guard feature. Only numbers identified as high-risk (spam, fraud, telemarketing) are stored. Users can remove any number from the database. No personal call history is collected or stored. |
| **Data retention policy** | Reputation entries are updated when new risk assessments are performed. Entries older than 12 months without updates are eligible for removal. The PIR server re-indexes daily from the authoritative database. |
| **PIR implementation details** | Using Apple's reference PIR server implementation (live-caller-id-lookup-example). Data is exported daily from Apollo's backend via authenticated API endpoint, transformed to PIR format, and pushed to the PIR server for re-indexing. |

### Step 2: Wait for Review

- Apple typically reviews entitlement applications within **1–2 weeks**
- They may request additional information about:
  - Data sources and accuracy
  - Privacy protections
  - PIR server architecture
  - User opt-in/opt-out mechanisms

### Step 3: After Approval

Once Apple grants the entitlement:

1. **The entitlement is already configured** in the Expo config plugin (`plugins/withLiveCallerID.js`)
   — it adds `com.apple.developer.live-caller-id-lookup` to both the main app and extension entitlements

2. **Set your PIR server URL** in `frontend/app.json`:
   ```json
   "extra": {
     "pirServer": {
       "url": "https://pir.your-domain.com"
     }
   }
   ```

3. **Build and submit**:
   ```bash
   # Build via Emergent publish button (top right)
   # Or via EAS CLI:
   eas build --platform ios --profile production
   eas submit --platform ios
   ```

4. **Enable on device**: Settings → Phone → Live Caller ID → Enable Apollo

## Architecture Summary

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Build Time                                   │
│                                                                     │
│  app.json extra.pirServer.url  ──→  withLiveCallerID.js plugin      │
│                                      │                              │
│                                      ├─→ Main app entitlements      │
│                                      ├─→ Extension Info.plist       │
│                                      │   (ApolloLiveCallerIDServerURL) │
│                                      └─→ Extension entitlements     │
│                                          (live-caller-id-lookup)    │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                        Runtime                                      │
│                                                                     │
│  Main App startup                                                   │
│  ├─→ Reads pirServer.url from Constants.expoConfig.extra            │
│  └─→ Writes to shared UserDefaults (apollo.pir.server_url)          │
│       │                                                             │
│  Extension (LiveCallerIDLookupHandler.swift)                        │
│  ├─→ Reads UserDefaults (priority 1)                                │
│  ├─→ Falls back to Info.plist (priority 2)                          │
│  └─→ Returns LiveCallerIDLookupExtensionConfiguration(serverURL:)   │
│       │                                                             │
│  iOS Call Flow                                                      │
│  ├─→ Incoming call from unknown number                              │
│  ├─→ iOS queries Apple PIR relay                                    │
│  ├─→ Apple PIR relay forwards to Apollo PIR server (encrypted)      │
│  ├─→ PIR server returns encrypted label                             │
│  └─→ iOS displays label on incoming call screen                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                     Data Pipeline                                   │
│                                                                     │
│  Call Guard risk checks                                             │
│  └─→ Auto-ingest flagged numbers to caller_id_numbers (MongoDB)     │
│       │                                                             │
│  pir_sync.py (cron, daily)                                          │
│  ├─→ GET /api/call/caller-id-db/export                              │
│  ├─→ Transform to PIR format                                        │
│  └─→ POST to PIR server /admin/reindex                              │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Flow Privacy Guarantees

| Stage | What is visible | What is NOT visible |
|-------|----------------|---------------------|
| Apollo Backend | Full reputation database | Which numbers are queried by iOS |
| PIR Server | Encrypted PIR queries (cannot determine specific number) | Individual query targets |
| Apple PIR Relay | Encrypted traffic (cannot read content) | Query content or results |
| iOS Device | Label for the specific queried number | The full reputation database |
| Network (ISP) | Encrypted OHTTP traffic | Any call-related metadata |

## Testing Without the Entitlement

While waiting for Apple's approval:
- The extension **compiles and builds** without the entitlement
- iOS will not activate Live Caller ID without the entitlement
- The CXCallDirectory extension (existing Call Guard) continues to work independently
- Test the data pipeline (export endpoint + pir_sync.py) independently

## Files Reference

| File | Purpose |
|------|---------|
| `frontend/plugins/withLiveCallerID.js` | Expo config plugin: adds extension target + entitlements |
| `frontend/plugins/ios/ApolloLiveCallerID/LiveCallerIDLookupHandler.swift` | Extension handler: reads PIR URL, configures PIR queries |
| `frontend/app.json` → `extra.pirServer.url` | PIR server URL (build-time default) |
| `frontend/src/store/ApolloContext.tsx` | Startup: writes PIR URL to shared UserDefaults |
| `frontend/modules/apollo-security/ios/ApolloSecurityModule.swift` | `configurePirServerUrl()` native bridge |
| `backend/services/caller_id_db.py` | Reputation database CRUD |
| `backend/routers/call.py` | Export API endpoint |
| `backend/scripts/pir_sync.py` | Cron sync script |
| `docs/PIR_SERVER_DEPLOYMENT.md` | PIR server infrastructure guide |
