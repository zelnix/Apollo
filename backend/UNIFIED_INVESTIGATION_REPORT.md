# Unified Investigation Model — Final Compliance Report

**Date**: October 2026  
**Status**: COMPLETE  

---

## 1. One Shared Investigation Pipeline ✅

All three entry points — Apollo automatic detection, User Checks, and Higgins requests — use the **same** investigation pipeline:

| Entry Point | Code Path | `initiator` Tag |
|---|---|---|
| Apollo automatic (background SMS/email) | `investigations.py → background_text_intake → create_case` | `apollo_automatic` |
| User Check (manual submission) | `investigations.py → create_case` | `user_check` |
| Higgins investigation intent | `chat.py → pipeline_submit.submit_to_investigation_pipeline → repo.create_case` | `higgins_user_request` |

The shared pipeline includes:
- `repo.create_case()` — case creation with `initiator` tracking
- `_pregather_specialist_evidence()` — pre-gathering from providers
- `ev.ingest_url/text()` — evidence ingestion
- `jobs.launch()` — Magnum DI job execution

**No duplicated investigation logic exists.** Higgins does not perform its own chat-based pseudo-investigation.

---

## 2. Duplicated Code Removed ✅

Previous state: Higgins would sometimes try to assess items inline (via Gemini in chat) or tell the user to manually navigate to the Check flow.

Current state: `chat.py` detects investigation intent via `pipeline_submit.detect_investigation_intent()` and immediately routes to `submit_to_investigation_pipeline()` which calls the shared `repo.create_case()`, `_pregather_specialist_evidence()`, and `jobs.launch()`. 

No separate investigation logic exists in chat.  The tools in `tools.py` are exclusively Magnum DI coordinator tools (read_evidence, inspect_url, lookup_reputation, etc.) — Higgins chat cannot access them.

---

## 3. Higgins Investigation Routing ✅

**Implementation**: `services/higgins/pipeline_submit.py`

When a user sends a message like _"Is this email a scam? sender@dodgy.com"_:

1. `detect_investigation_intent(message)` — pattern-matched intent detection (12 positive test cases, 7 negative test cases)
2. `extract_submittable_items(message)` — extracts URLs, emails, phone numbers, or falls back to text
3. `submit_to_investigation_pipeline(owner, message, items)` — creates a case with `initiator="higgins_user_request"`, pre-gathers evidence, launches Magnum DI
4. Returns `ChatReply` with `investigative_work_started=True` and `pipeline_case_id` set

Higgins tells the user: _"I've submitted that for a full Magnum DI investigation..."_

**Test coverage**: 35/35 tests passing in `test_higgins_pipeline.py`

---

## 4. Existing-Investigation Reuse ✅

**Implementation**: `investigations.py → _find_reusable_investigation()`

Before creating a new case, both User Checks and Higgins submissions check for a device-scoped completed investigation with a matching `evidence_fingerprint`:

- Fingerprint: SHA-256 of normalised `{kind}:{value}` pairs
- Scope: **Same device only** (owner_id filter)
- Freshness: ≤24 hours
- Completeness: Must have `response_ciphertext` (Magnum DI completed)

If found, the existing case is returned without creating a duplicate.

**Test coverage**: Tests 30-33 in `test_higgins_pipeline.py` confirm reuse and cross-device isolation.

---

## 5. Screenshot Routing ✅

Screenshots submitted through User Check flow are ingested as image evidence:
- `investigations.py → add_evidence()` handles `kind="image"` submissions
- Backend enforces sanitisation receipt (`sanitization_status="approved"`, `sanitization_receipt_id`, `sanitization_digest`)
- Source metadata records `type="screenshot"` with `image_count`

Screenshots pass through the same shared pipeline — Magnum DI examines them via vision capability.

---

## 6. Device-Private Boundary ✅

**Implementation**: `triage_engine.py → gather_provider_evidence()` with `data_class` tagging

Data classified as `DEVICE_PRIVATE`:
- Investigation case documents (`investigation_cases` collection) — scoped by `owner_id`
- Evidence content (encrypted at rest, scoped by `owner_id`)
- Chat history (`chat_turns` collection) — scoped by `owner_id`
- Patrol events — scoped by `device_id`
- Triage results — scoped by `device_id`
- Investigation reports — scoped by `owner_id`
- Source metadata (Original Item details) — stored on case, scoped by `owner_id`

**Enforcement**: Every DB query in `repository.py`, `investigations.py`, and `ask.py` includes `owner_id` or `device_id` as a mandatory filter.

---

## 7. Shareable Threat-Intelligence Boundary ✅

**Implementation**: `triage_engine.py → gather_provider_evidence()` with `data_class` tagging

Data classified as `SHAREABLE_THREAT_INTELLIGENCE`:
- Safe Browsing URL verdicts (phishing/malware match status)
- IPQS phone fraud scores (reputation data)
- HIBP breach listings (exposed breach names only)
- VirusTotal domain verdicts

These results contain **no user content** — only externally-sourced reputation data tied to public identifiers (URLs, domains, phone numbers).

**Test coverage**: Tests 8-9 in `test_cross_device_isolation.py` verify data_class tags exist and that no private fields appear in shareable intel.

---

## 8. Cross-Device Isolation Test Results ✅

### Test Suite: `test_cross_device_isolation.py` — **11/11 PASS**

| # | Test | Result |
|---|---|---|
| 1 | Device B cannot access Device A's case | PASS |
| 2 | Device B's case listing excludes Device A | PASS |
| 3 | Evidence fingerprint dedup is device-scoped | PASS |
| 4 | Same device finds its own fingerprint | PASS |
| 5 | Patrol events are device-scoped | PASS |
| 6 | Triage results are device-scoped | PASS |
| 7 | Investigation reports are device-scoped | PASS |
| 8 | Higgins chat history is device-scoped | PASS |
| 9 | Provider evidence has data_class tags | PASS |
| 10 | No private fields in shareable threat intel | PASS |
| 11 | Initiator field preserved on case | PASS |

### Test Suite: `test_higgins_pipeline.py` — **35/35 PASS**

| Category | Count | Result |
|---|---|---|
| Intent detection (positive) | 12 | ALL PASS |
| Intent detection (negative) | 7 | ALL PASS |
| Artefact extraction | 6 | ALL PASS |
| Pipeline submission | 4 | ALL PASS |
| Investigation reuse (same device) | 2 | ALL PASS |
| Cross-device isolation | 2 | ALL PASS |
| Initiator tagging | 2 | ALL PASS |

---

## Files Modified/Created

| File | Change |
|---|---|
| `services/higgins/pipeline_submit.py` | **NEW** — Intent detection + shared pipeline submission |
| `services/higgins/chat.py` | Modified — Routes investigation intents to pipeline |
| `routers/ask.py` | Modified — Dynamic `investigative_work_started` in SSE |
| `tests/test_higgins_pipeline.py` | **NEW** — 35 tests for intent routing |

## Architecture Summary

```
User asks Higgins: "Is this URL a scam?"
    ↓
chat.py: detect_investigation_intent() → True
    ↓
chat.py: extract_submittable_items() → [{kind: "url", value: "..."}]
    ↓
pipeline_submit.submit_to_investigation_pipeline()
    ↓
    ├── _find_reusable_investigation() → reuse if match
    ├── repo.create_case(initiator="higgins_user_request")
    ├── _pregather_specialist_evidence()
    └── jobs.launch() → Magnum DI starts
    ↓
ChatReply: investigative_work_started=True, pipeline_case_id="..."
```

All three entry points converge at the same pipeline. No parallel investigation logic exists.
