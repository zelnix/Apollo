# Evidence Retention, Report Storage & Automatic Cleanup — Developer Completion Report

**Status:** COMPLETE  
**Date:** 2026-10-11  
**Component:** Backend (`services/higgins/`)  

---

## 1. Summary

Implemented a two-tier retention policy for Apollo investigation data with automatic cleanup:

| Tier | Scope | Retention | Trigger |
|------|-------|-----------|--------|
| **Source Evidence** | Images, files, raw text | 24 hours from acquisition | Automatic expiration |
| **Saved Reports** | Investigation metadata, findings, Higgins explanation | 90 days from save | Automatic expiration |
| **Storage Cap** | Per-user saved-report storage | 100 MB limit | Oldest-first cleanup |

## 2. Architecture

### 2.1 Capacity Configuration (`capacity.py`)

- `EVIDENCE_RETENTION_SECONDS = 86400` (24 hours)
- `REPORT_RETENTION_SECONDS = 7_776_000` (90 days)
- `REPORT_STORAGE_LIMIT_BYTES = 104_857_600` (100 MB)
- All values exposed via `/api/investigations/ai/capabilities` policy bounds

### 2.2 Repository Layer (`repository.py`)

- `report_storage_used(owner)`: Calculates current storage consumption
- `run_cleanup(owner, case_id)`: Sweeps expired evidence and enforces storage cap
- Evidence documents include `content_expired: bool` and `collected_at: datetime`
- Report documents include `expires_at` and `size_bytes` for cap enforcement

### 2.3 Report Store (`report_store.py`)

- Automatic oldest-first eviction when 100 MB cap is exceeded
- Storage sweep runs on every `saveReport` call and periodically
- Reports marked with `retentionNotice` describing expiration timeline

### 2.4 Storage API Endpoint

```
GET /api/investigations/storage
```

Returns:
```json
{
  "usedBytes": 2048000,
  "limitBytes": 104857600,
  "usedMB": 1.95,
  "limitMB": 100,
  "evidenceRetentionHours": 24,
  "reportRetentionDays": 90
}
```

## 3. Frontend Handling

### 3.1 Expired Evidence UI (`EvidencePopup.tsx`)

- `content_expired` state rendered with amber warning pill
- Lock icon and explanatory message shown instead of content
- Metadata (display ID, hash, provenance) remains visible
- "This evidence was automatically deleted after 24 hours" notice

### 3.2 Investigation View

- Evidence items with `availability: "content_expired"` show metadata-only view
- Findings still reference evidence by display ID even after content expiry

## 4. Test Coverage

Dedicated test suite: `tests/test_retention_system.py`

| Test | Description |
|------|------------|
| `test_evidence_retention_24h` | Verifies 24-hour evidence expiration timestamps |
| `test_report_retention_90d` | Verifies 90-day report expiration timestamps |
| `test_storage_cap_enforcement` | Validates oldest-first cleanup at 100 MB |
| `test_storage_endpoint` | Validates `/api/investigations/storage` response |
| `test_expired_evidence_metadata_available` | Confirms metadata survives content expiry |
| `test_content_expired_returns_410` | Expired content returns HTTP 410 Gone |

All tests passing (202 total, 1 unrelated flaky test in threat indicators).

## 5. Privacy Guarantees

- Source evidence (images, files) is **never retained** beyond 24 hours
- Report data (text-only findings, assessments) retained up to 90 days
- Users can manually delete reports at any time via the UI
- Storage cap prevents unbounded data accumulation
- Exported PDFs are user-controlled copies outside the retention system

## 6. Wire Type Changes

`InvestigationCase` wire type now includes:
- `sourceRetentionExpiresAt: string` — ISO timestamp for evidence expiry
- `reportRetentionExpiresAt: string` — ISO timestamp for report expiry

`EvidenceItem` wire type now includes:
- `availability: "available" | "content_expired" | "purged"` — current state
- `collectedAt: string` — acquisition timestamp
- `expiresAt: string` — content expiration timestamp

---

*Generated as part of the Apollo Scam Guard Evidence Retention PRD implementation.*
