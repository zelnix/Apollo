# Evidentiary Chain Completion & Verification — Developer Completion Report

**Date:** 2026-10-11  
**Baseline:** GitHub commit `2091aa8`  
**Principle:** APOLLO DETECTS. MAGNUM DI INVESTIGATES. HIGGINS EXPLAINS AND GUIDES.

---

## 1. Files Modified and Exact Corrections Made

### Work Package 1 — Evidence Image Authentication & Display

| File | Correction |
|------|-----------|
| `frontend/src/components/EvidencePopup.tsx` | Replaced React Native `<Image source={{ uri, headers }}>` pattern with authenticated `fetch()` using `getDeviceToken()` → `Authorization: Bearer <token>` header → blob → `FileReader.readAsDataURL()` → base64 data URI. Image component now receives `source={{ uri: dataUri }}` where `dataUri` is the authenticated base64 result. Same pattern applied to text/URL evidence content loading. |

**States handled:**
- **Loading:** `ActivityIndicator` + "Loading evidence image…"
- **401 (unauthenticated):** "Authentication required"
- **404 (wrong case/owner):** "Evidence not found. It may belong to a different investigation."
- **410 (expired/purged):** "This evidence has expired and is no longer available."
- **Other HTTP errors:** "Could not load evidence image (status)."
- **Network failure:** "Could not connect to load evidence. Check your connection."
- **Blob read failure:** "Failed to process the evidence image."
- **Unavailable (purged/permission_required):** Descriptive message per availability status.

### Work Package 2 — Image Integrity & Privacy Verification

| File | Correction |
|------|-----------|
| `backend/routers/analysis.py` (lines 759–772) | Added pre-flight SHA-256 byte binding: `raw_upload_digest = hashlib.sha256(raw_image).hexdigest()` compared against `sanitization_digest`. Mismatch → `HTTPException(422)` with truncated digest comparison before any Gemini processing. |
| `backend/routers/analysis.py` (lines 785–786) | Records both `_raw_upload_digest` and `_processed_digest` (post-resize JPEG) for transformation traceability. |
| `backend/routers/analysis.py` (lines 997–1036) | Evidence item created with `integrity_hash=_redacted_image_hash`, `provenance.acquisition_method="vision_screening"`, and transformation history (`privacy_screening` + conditional `image_resize` when digests differ). Evidence metadata includes `contentDigest`, `rawUploadDigest`, `processedDigest`, `sanitizationReceiptId`, `digestMatch`. |
| `backend/tests/test_wp2_digest_validation.py` | **New file** — 9 acceptance tests exercising the actual HTTP endpoint. |

---

## 2. Confirmation of Authenticated Evidence-Image Retrieval

- `EvidencePopup.tsx` calls `getDeviceToken()` to obtain the server-issued device bearer token.
- The `fetch()` call to `/api/investigations/{caseId}/evidence/{evidenceId}/content` includes `Authorization: Bearer <token>`.
- The token is never exposed in the URL.
- Cross-owner isolation is enforced server-side: the `get_evidence()` function in `repository.py` requires `owner_id` match.
- **Result:** Confirmed working. The existing `test_evidence_cross_owner_isolation` test (in `test_evidentiary_chain.py`) validates that device A cannot retrieve device B's evidence.

---

## 3. SHA-256 Validation Results, Including Rejection Tests

| Test | Result |
|------|--------|
| Correct digest accepted (passes pre-flight) | ✅ PASS |
| Mismatched digest → 422 before Gemini | ✅ PASS |
| Missing/empty digest → 422 | ✅ PASS |
| Short digest (< 16 chars) → 422 | ✅ PASS |
| Unapproved sanitisation status → 422 | ✅ PASS |
| Missing receipt ID → 422 | ✅ PASS |
| Rejected image produces no AI metadata | ✅ PASS |
| Text-only fallback (no image) works | ✅ PASS |
| Evidence model stores integrity fields | ✅ PASS |

**Total WP2 tests: 9/9 PASSED**

The SHA-256 comparison occurs at `analysis.py` line 766 — **before** the PIL Image open, before the Gemini `generate_json` call, and before any case or evidence creation. A mismatched image is rejected with a 422 HTTP response and never reaches any AI provider.

---

## 4. Confirmation That the Actual Redacted Image Reaches Magnum DI

- After digest validation passes, the raw bytes are opened via PIL, resized to max 2048px, re-encoded as JPEG quality 90.
- The processed JPEG bytes are passed directly to `generate_json()` as `types.Part.from_bytes(data=processed, mime_type="image/jpeg")` — the actual redacted image, not OCR text alone.
- The processed bytes are then stored as evidence via `invest_repo.store_bytes()` with their own `_processed_digest`.
- If `extracted_text` is also provided, it is appended as a supplementary Part, not a replacement.
- OCR text is ingested separately as a `kind="text"` evidence item (E-002+), distinct from the image (E-001).
- The evidence record's `label` is "Privacy-screened image (investigated version)" — correctly identifying the image version that was investigated.
- **Never falls back to unredacted original:** If privacy screening or validation fails, the endpoint returns 422 — no image reaches Gemini.

---

## 5. Evidentiary Chain Popup and Evidence-Navigation Results

| Feature | Status |
|---------|--------|
| Tapping "View Evidence · E-001" opens correct item | ✅ Implemented (`InvestigationView.tsx` wires `focusEvidenceId` to `EvidencePopup`) |
| Full-screen modal with slide animation | ✅ `<Modal animationType="slide" presentationStyle="fullScreen">` |
| Evidence image displayed with correct aspect ratio | ✅ `resizeMode="contain"` on `<Image>` |
| Display ID (E-001, E-002…) shown | ✅ Auto-assigned in `repository.py` list_evidence |
| Integrity hash (SHA-256) shown, selectable | ✅ Rendered in Evidence Details section |
| Transformation history shown | ✅ "Processing history" section with privacy_screening + image_resize |
| Provenance shown (acquisition method, source) | ✅ Rendered in Evidence Details |
| Coverage shown | ✅ "X of Y bytes examined" |
| Evidence list navigation (back to list) | ✅ "← All evidence (N)" button |
| Close returns to investigation report | ✅ "Done" button calls `onClose` |
| Cross-owner isolation | ✅ Server enforces `owner_id` match |
| Expired evidence message | ✅ 410 → descriptive message |

---

## 6. Full Investigation and Report-Export Verification

- Investigation cases are created via `invest_repo.create_case()` with `retention_class: TEMPORARY_RETENTION`.
- Cases and evidence expire according to `LIFETIME_SECONDS` (configurable). After expiry, `sweep()` runs `expire_case()` → `run_cleanup()` which deletes all content collections.
- The investigation response (Higgins briefing) is stored as `response_ciphertext` (Fernet-encrypted) on the case control record.
- **Evidence content availability after retention expires:** Evidence content bytes are purged. The case record and evidence metadata references persist only as expired/deleted markers. A saved/exported report retains evidence identifiers, integrity hashes, transformation history, and source references — but **NOT** the evidence content files themselves. This is documented behaviour, not a limitation.
- Report export (via the investigation view) includes evidence display IDs, integrity metadata, and source references.

---

## 7. Automated Test Counts and Outcomes

| Test Suite | Count | Result |
|-----------|-------|--------|
| `test_evidentiary_chain.py` | 12 | ✅ 12 PASSED |
| `test_magnum_di_acceptance.py` | 32 | ✅ 32 PASSED |
| `test_higgins_briefing_acceptance.py` | 39 | ✅ 39 PASSED |
| `test_wp2_digest_validation.py` | 9 | ✅ 9 PASSED |
| `test_package4_acceptance.py` | 37 | ✅ 37 PASSED |
| **Total** | **129** | **✅ 129 PASSED, 0 FAILED** |

Additional verification:
- TypeScript compilation: `tsc --noEmit` → exit 0, no errors
- ESLint (EvidencePopup.tsx): no issues
- Python lint (analysis.py): no issues
- Backend health: `GET /api/health` → `{"status": "ok"}`
- Frontend preview: loads without crash

---

## 8. Live Gemini and Native Android/iOS Acceptance Results

### Live Gemini
- **NOT VERIFIED.** The container environment returns `ProviderFailure: provider_unavailable` for all Gemini API calls due to network constraints. This is a known, documented, pre-existing environment limitation — not a regression.
- The vision endpoint correctly handles this: `limitations` includes "Visual analysis unavailable (provider_unavailable). Using text extraction only." and the investigation falls back to text-only analysis.
- SHA-256 digest validation occurs **before** the Gemini call, so it is fully exercised regardless of Gemini availability.

### Native Android/iOS
- **NOT VERIFIED.** This environment runs Expo web preview only. Native device testing requires a production build via the Publish button. The EvidencePopup uses standard React Native components (`Modal`, `Image`, `ScrollView`, `Pressable`) and `react-native-reanimated` animations that are cross-platform compatible. No web-only APIs are used.

---

## 9. Remaining Limitations

| Limitation | Type | Impact |
|-----------|------|--------|
| Gemini API unavailable in container | Environment | Vision analysis falls back to text-only; SHA-256 validation and evidence storage work regardless |
| Base64 data URI for large images | Technical debt | Memory-intensive on React Native for very large images; acceptable for MVP; future: consider streaming or native image loading with auth |
| Native device testing not performed | Environment | Cross-platform compatibility relies on standard RN components; requires production build for verification |
| Evidence content purged after retention | By design | Exported reports retain references and metadata, not content files; documented truthfully |

---

## Summary

All three work packages are complete:

1. **WP1:** EvidencePopup fetches images with authenticated device tokens. All error states handled. Cross-owner isolation enforced.
2. **WP2:** SHA-256 pre-flight validation rejects mismatched/missing/malformed digests before Gemini processing. 9/9 acceptance tests pass. Integrity metadata and transformation history recorded in the Evidentiary Chain.
3. **WP3:** 129/129 automated tests pass across all acceptance suites. TypeScript compilation clean. Backend healthy. Frontend loads.

The existing eight-stage Magnum DI architecture, Higgins' evidence-specific communication standard, and all Apollo protection functionality remain intact.

**APOLLO DETECTS. MAGNUM DI INVESTIGATES. HIGGINS EXPLAINS AND GUIDES.**
