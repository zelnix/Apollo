# Live Caller ID — PIR Server Deployment Guide

**Date:** 2026-10-04

---

## Architecture

```
Apollo FastAPI Backend                    PIR Server (Swift)                     iOS Device
──────────────────                    ──────────────────                     ──────────
/api/call/risk-check                  Indexes phone DB                      LiveCallerIDLookupHandler
  → auto-ingests to caller_id_db      Serves PIR queries                     → Queries PIR server via Apple relay
/api/call/caller-id-db/export         Apple's PIR protocol                   → Receives label
  → feeds PIR server daily                                                   → Displays on incoming call
```

## Step 1: Clone Apple's Reference Server

```bash
git clone https://github.com/nicktmro/live-caller-id-lookup-example.git
cd live-caller-id-lookup-example
```

Apple's reference implementation is a Swift package that:
- Accepts a JSON dataset of phone numbers → labels
- Creates an encrypted PIR index
- Serves PIR queries via OHTTP (Oblivious HTTP)

## Step 2: Data Pipeline

Create a cron job that fetches from Apollo's export endpoint and feeds the PIR server:

```bash
#!/bin/bash
# daily-pir-sync.sh — runs via cron at 2:00 AM

APOLLO_API="https://your-apollo-backend.com/api"
DEVICE_TOKEN="your-device-token"
PIR_DATA_DIR="/opt/pir-server/data"

# Export from Apollo
curl -s -H "Authorization: Bearer $DEVICE_TOKEN" \
  "$APOLLO_API/call/caller-id-db/export?limit=500000" \
  -o "$PIR_DATA_DIR/numbers.json"

# Transform to PIR server format
python3 -c "
import json, sys
with open('$PIR_DATA_DIR/numbers.json') as f:
    data = json.load(f)
entries = data.get('entries', [])
# Apple's PIR format: array of {phoneNumber: int64, label: string}
with open('$PIR_DATA_DIR/pir_input.json', 'w') as f:
    json.dump(entries, f)
print(f'Exported {len(entries)} entries for PIR indexing')
"

# Trigger PIR server re-indexing
curl -s -X POST http://localhost:8082/admin/reindex \
  -H "Content-Type: application/json" \
  -d @"$PIR_DATA_DIR/pir_input.json"
```

## Step 3: PIR Server Deployment

### Docker Compose

```yaml
version: '3.8'
services:
  pir-server:
    build:
      context: ./live-caller-id-lookup-example
      dockerfile: Dockerfile
    ports:
      - "8082:8082"
    volumes:
      - pir-data:/data
    environment:
      - PIR_PORT=8082
      - PIR_DATA_DIR=/data
    restart: unless-stopped

volumes:
  pir-data:
```

### Resource Requirements
- CPU: 1 vCPU (2 recommended for indexing)
- RAM: 1-2 GB (depends on database size)
- Disk: 500MB for 1M entries, 5GB for 10M entries
- Network: HTTPS required (Apple's relay verifies TLS)

## Step 4: iOS Extension Configuration

The `LiveCallerIDLookupHandler.swift` reads the PIR server URL from the app group's shared UserDefaults:

```swift
// Set in the main app (e.g., during settings configuration):
let defaults = UserDefaults(suiteName: "group.com.hucentai.apollo")
defaults?.set("https://pir.your-domain.com", forKey: "apollo.pir.server_url")
```

The extension automatically uses this URL for PIR queries.

## Step 5: Apple Entitlement Application

### Requirements
1. Active Apple Developer Program membership
2. The `com.apple.developer.live-caller-id-lookup` entitlement

### Application Process
1. Go to https://developer.apple.com/contact/request/live-caller-id-lookup
2. Submit:
   - App name: Apollo
   - Bundle ID: com.hucentai.apollo
   - Description: "Apollo provides privacy-focused caller identification using PIR to help users identify potential scam calls. The PIR server is self-hosted and queries are relayed through Apple's OHTTP proxy."
   - PIR server URL: https://pir.your-domain.com
   - Privacy policy URL: (your privacy policy)
3. Apple reviews the application (typically 1-2 weeks)
4. Once approved, add the entitlement to the Xcode project

### Expo Config Plugin

The entitlement is already configured via the Expo config plugin at `frontend/plugins/withLiveCallerID.js`.
It is registered in `app.json` plugins and also adds the EAS extension entry.

To set the PIR server URL, update `app.json`:
```json
{
  "expo": {
    "extra": {
      "pirServer": {
        "url": "https://pir.your-domain.com"
      }
    }
  }
}
```

The main app writes this URL to shared UserDefaults at startup via `configurePirServerUrl()`,
and the extension reads it with UserDefaults as priority and Info.plist as fallback.

## Step 6: Testing

1. Build with EAS: `eas build --platform ios --profile development`
2. Install on a physical iOS 18+ device
3. Go to Settings → Phone → Live Caller ID → Enable Apollo
4. Have a test number in the PIR database
5. Call from that number → Apollo's label should appear

## Cost Summary

| Item | Monthly | Notes |
|------|---------|-------|
| PIR Server (1 container) | $20-30 | DigitalOcean/Hetzner |
| Domain + TLS cert | $5 | Required for Apple relay |
| Data sync (cron) | $0 | Runs on same server |
| **Total** | **$25-35** | Without bulk data import |

## Current State

- ✅ Backend data service: `backend/services/caller_id_db.py`
- ✅ Export endpoint: `GET /api/call/caller-id-db/export`
- ✅ Auto-ingestion from risk checks: numbers flagged by IPQualityScore are automatically added
- ✅ iOS extension: `LiveCallerIDLookupHandler.swift` — reads PIR server URL from shared UserDefaults (priority) or Info.plist (fallback)
- ✅ Expo config plugin: `plugins/withLiveCallerID.js` — adds extension target, entitlements, and embeds PIR URL from app.json
- ✅ Native bridge: `configurePirServerUrl()` in ApolloSecurityModule — writes URL to shared UserDefaults at app startup
- ✅ Startup injection: `ApolloContext.tsx` reads from `Constants.expoConfig.extra.pirServer.url` and writes to iOS UserDefaults
- ✅ Data sync script: `backend/scripts/pir_sync.py` — exports, transforms, and pushes to PIR server
- ✅ EAS build configuration: `ApolloLiveCallerID` registered in `app.json` appExtensions
- ✅ Apple entitlement documentation: `docs/APPLE_LIVE_CALLER_ID_ENTITLEMENT.md`
- ⏳ PIR server deployment: requires separate Swift server infrastructure
- ⏳ Apple entitlement: requires application through developer.apple.com
