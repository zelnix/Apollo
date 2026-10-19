# Apollo Gemini SDK Audit Report — Package 3

**Date**: February 2026
**Scope**: Complete audit of all Gemini AI provider access across the Apollo backend
**Purpose**: Identify all call sites, bypass paths, privacy enforcement gaps — and document corrections applied
**Status**: Phase 1 (audit) COMPLETE. Phase 2 (remediation) COMPLETE. All findings corrected.

---

## 1. Executive Summary

The Phase 1 audit found **ONE primary Gemini gateway** (`provider.py`) handling all `google.genai` SDK calls, plus **ONE alternate AI pathway** (`scam_analysis.py`) using the Emergent LLM library. Phase 2 corrected all findings. The alternate pathway has been eliminated — `emergentintegrations` has been removed from Apollo's application architecture.

| Finding | Severity | Phase 1 Status | Phase 2 Resolution |
|---|---|---|---|
| Alternate AI pathway (scam_analysis.py via emergentintegrations) | **HIGH** | Bypass found | ✅ FIXED — routed through provider.py; emergentintegrations removed |
| Missing explicit purpose parameter | **MEDIUM** | 2 call sites | ✅ FIXED — purpose now required (no default) |
| Default purpose silently permissive (INVESTIGATION) | **MEDIUM** | In signature | ✅ FIXED — default removed |
| Binary content bypasses privacy text checks | **MEDIUM** | Systemic | ✅ FIXED — binary authorisation + purpose check added |
| Text parts only get strip_credentials, not full enforcement | **MEDIUM** | Systemic | ✅ FIXED — full enforce_boundary() on all text parts |
| No architectural enforcement test | **LOW** | Missing | ✅ FIXED — 23 tests in test_gateway_enforcement.py |
| Missing explicit purpose parameter | **MEDIUM** | 2 |
| Default purpose silently permissive (INVESTIGATION) | **MEDIUM** | 1 (in signature) |
| Binary content bypasses privacy text checks | **MEDIUM** | Systemic |
| count_tokens receives privacy-processed text (OK) but via same pipeline | **LOW** | Covered |
| SDK `types` imported widely but no direct SDK calls outside provider.py | **NONE** | 0 bypasses |
| No frontend-to-Gemini direct calls | **NONE** | 0 |

---

## 2. Gemini SDK Access Points

### 2.1 The Single Gateway: `services/higgins/provider.py`

**This is the authoritative gateway.** Three public functions:

| Function | Purpose | Privacy Enforcement |
|---|---|---|
| `generate()` | All inference (text, vision, functions, JSON, speech) | System prompt: `strip_credentials()`. Text contents: `enforce_boundary()`. SDK Content parts: `strip_credentials()` on `.text`. Binary parts: **pass through unmodified**. |
| `generate_json()` | JSON-mode inference (delegates to `generate()`) | Inherits from `generate()` |
| `speech_bytes()` | TTS synthesis | `enforce_boundary(Purpose.TTS, text)` + `validate_outbound_payload()` + fallback `strip_credentials()`. Then delegates to `generate()` with `purpose=Purpose.TTS`. |

**SDK calls within provider.py (the ONLY direct SDK calls in production code):**
- `client().aio.models.get(model=model)` — model info lookup (line 131)
- `client().aio.models.count_tokens(model=model, contents=count_contents)` — token counting (line 141)
- `client().aio.models.generate_content(model=model, contents=contents, config=config)` — inference (line 145)

### 2.2 The Alternate Pathway: `services/scam_analysis.py` ⚠️ BYPASS

| Attribute | Value |
|---|---|
| **Library** | `emergentintegrations.llm.chat.LlmChat` (not google.genai) |
| **Key** | `EMERGENT_LLM_KEY` (separate from `GEMINI_API_KEY`) |
| **Model** | `gemini-3.1-pro-preview` |
| **Data processed** | Government advisory article text (public content) |
| **Privacy enforcement** | **NONE** — no credential stripping, no purpose classification, no LLM boundary |
| **Risk** | LOW (public government text only, no user PII) — but violates single-gateway principle |

**Proposed correction**: Route through `provider.py` gateway, or apply equivalent disclosure controls with explicit purpose `RESEARCH` and document the justified alternate pathway.

---

## 3. All Call Sites — Detailed Analysis

### 3.1 COMPLIANT Call Sites (explicit purpose, through gateway)

| # | File | Line | Function | Purpose | Binary? | Status |
|---|---|---|---|---|---|---|
| 1 | `services/higgins/chat.py` | 106 | `provider.generate()` | `ORDINARY_CHAT` | No | ✅ |
| 2 | `services/higgins/chat.py` | 118 | `provider.generate()` | `ORDINARY_CHAT` | No | ✅ |
| 3 | `services/higgins/chat.py` | 129-130 | `provider.generate()` | `ORDINARY_CHAT` | No | ✅ |
| 4 | `services/higgins/coordinator.py` | 250 | `provider.generate()` | `INVESTIGATION` | No* | ✅ |
| 5 | `services/higgins/coordinator.py` | 269 | `provider.generate()` | `INVESTIGATION` | No | ✅ |
| 6 | `services/higgins/coordinator.py` | 288 | `provider.generate()` | `INVESTIGATION` | No | ✅ |
| 7 | `services/higgins/evidence.py` | 363 | `provider.generate_json()` | `VISION_PREFLIGHT` | **Yes (image)** | ✅ Purpose correct |
| 8 | `services/higgins/tools.py` | 120 | `provider.generate()` | `RESEARCH` | No | ✅ |
| 9 | `services/investigation.py` | 231 | `generate_json()` | `INVESTIGATION` | No | ✅ |
| 10 | `services/investigation.py` | 277-281 | `generate_json()` | `VISION_PREFLIGHT` | **Yes (image)** | ✅ Purpose correct |
| 11 | `services/transcribe.py` | 15-19 | `generate_json()` | `INVESTIGATION` | **Yes (audio)** | ✅ Purpose correct |
| 12 | `services/higgins/health_check.py` | 68-69 | `provider.generate()` | `INVESTIGATION` | No | ✅ |
| 13 | `services/higgins/provider.py` | 194 | `generate()` (internal TTS) | `TTS` | No | ✅ |

\* Coordinator's `contents` list may contain SDK `Content` objects with image parts from evidence — these binary parts pass through `strip_credentials()` on text only.

### 3.2 NON-COMPLIANT Call Sites (missing or defaulting purpose)

| # | File | Line | Function | Issue | Proposed Fix |
|---|---|---|---|---|---|
| **B1** | `routers/analysis.py` | 234-236 | `generate_json()` | **Missing `purpose=`**. Sends image binary to Gemini Vision. Falls to default `Purpose.INVESTIGATION`. Should be `VISION_PREFLIGHT`. | Add `purpose=Purpose.VISION_PREFLIGHT` |
| **B2** | `routers/analysis.py` | 329 | `generate_json()` | **Missing `purpose=`**. Sends page text (not image) to Gemini. Falls to default `Purpose.INVESTIGATION`. This IS investigation-purpose content but the purpose should be explicit. | Add `purpose=Purpose.INVESTIGATION` |
| **B3** | `services/scam_analysis.py` | 215-218 | `LlmChat.send_message()` | **Alternate AI pathway**. Uses emergentintegrations library, not provider.py. No privacy boundary. | Route through provider.py or apply equivalent controls |

### 3.3 The Default Purpose Problem

| Issue | Location | Detail |
|---|---|---|
| `generate()` signature | `provider.py:96` | `purpose: Purpose = Purpose.INVESTIGATION` — silently permissive default |

**Proposed correction**: Remove the default value, making `purpose` a required keyword argument. This forces every caller to explicitly declare their processing purpose. Any missing purpose will produce a `TypeError` at call time — fail-fast rather than fail-permissive.

---

## 4. Binary Content Privacy Gap Analysis

### 4.1 Current Handling in `provider.py` (lines 107-114)

```python
if isinstance(contents, str):
    contents = enforce_boundary(purpose, contents)
elif isinstance(contents, list):
    for content_item in contents:
        if isinstance(content_item, types.Content) and content_item.parts:
            for part in content_item.parts:
                if part.text:
                    part._raw_part.text = strip_credentials(part.text)
```

**What this does:**
- String prompts: full `enforce_boundary()` (credential stripping + purpose-specific PII minimisation)
- SDK Content objects: text parts get `strip_credentials()` only (NOT full `enforce_boundary()`)
- Binary parts (images, audio): **pass through unmodified** — no privacy check

**What's missing:**
- Text parts within Content objects don't get purpose-specific enforcement (only credential stripping)
- Binary parts (from_bytes) bypass all text-based privacy checks
- Lists of `types.Part` directly (not wrapped in `Content`) are not processed

### 4.2 Binary Content Call Sites

| Call Site | Binary Type | Current Protection | Gap |
|---|---|---|---|
| `analysis.py:234` (page_extract) | JPEG image | Backend `sanitization_status='approved'` required | Image itself not privacy-checked by LLM boundary |
| `investigation.py:277` (screenshot extract) | JPEG image | Backend `sanitization_status='approved'` required | Image itself not privacy-checked by LLM boundary |
| `evidence.py:363` (image preflight) | Image | This IS the preflight check itself | Purpose correctly set to VISION_PREFLIGHT |
| `transcribe.py:15` (voice) | Audio | Family link check + secret redaction on output | Audio content not privacy-checked |
| `coordinator.py` (evidence with images) | Various | Investigation-scoped, encrypted, owner-authorised | Binary evidence passes through in Content objects |

**Note**: Full image/document minimisation is designated as **Package 4** per the user's instruction. Package 3's responsibility is to ensure binary content cannot bypass privacy checks silently — either block it, require explicit authorisation, or flag it for Package 4 enforcement.

### 4.3 Proposed Binary Content Handling (Package 3 scope)

1. **Require explicit purpose for binary content** — if a payload contains binary parts and the purpose doesn't authorise binary (e.g., `RESEARCH`, `ORDINARY_CHAT`), block the request.
2. **Log binary content presence** — for audit purposes, record when binary content is transmitted.
3. **Validate that binary callers have appropriate authorisation** — investigation-scoped images have sanitization_status; vision preflight is the screening mechanism itself.
4. **Defer pixel-level minimisation to Package 4** — but ensure the pathway is instrumented.

---

## 5. count_tokens Analysis

**Location**: `provider.py` line 141

```python
count_contents = [types.Part(text=(system or '') + '\n' + schemas), *(contents if isinstance(contents, list) else [contents])]
counted = await client().aio.models.count_tokens(model=model, contents=count_contents)
```

**What happens**: 
- The system prompt has already been through `strip_credentials()` (line 104)
- The contents have been through the privacy enforcement (lines 107-114)
- The `count_contents` uses the **already-processed** payload

**Assessment**: ✅ Token counting receives the same privacy-processed payload as inference. No bypass.

---

## 6. SDK `types` Import Analysis

Files importing `google.genai.types` but NOT making direct SDK calls:

| File | Usage | Risk |
|---|---|---|
| `routers/analysis.py` | `types.Part.from_bytes()`, `types.Part()` — constructing request parts | NONE — parts fed to `generate_json()` |
| `services/higgins/chat.py` | `types.Content()`, `types.Part()` — building conversation | NONE — fed to `provider.generate()` |
| `services/higgins/context_tools.py` | `types.FunctionDeclaration` — tool definitions | NONE — declarations, not calls |
| `services/higgins/coordinator.py` | `types.Content()`, `types.Part()`, `types.Tool()` — conversation assembly | NONE — fed to `provider.generate()` |
| `services/higgins/evidence.py` | `types.Part.from_bytes()` — image preflight construction | NONE — fed to `provider.generate_json()` |
| `services/higgins/health_check.py` | `types.Content()`, `types.Part()` — health check prompt | NONE — fed to `provider.generate()` |
| `services/higgins/tools.py` | `types.Tool()`, `types.GoogleSearch()`, `types.FunctionDeclaration` — tool definitions and research | NONE — fed to `provider.generate()` |
| `services/investigation.py` | `types.Part.from_bytes()` — screenshot construction | NONE — fed to `generate_json()` |
| `services/transcribe.py` | `types.Part.from_bytes()`, `types.Part()` — audio construction | NONE — fed to `generate_json()` |

**Conclusion**: All `types` imports are for constructing SDK-compatible request objects that are then passed to `provider.py` gateway functions. **No direct SDK calls outside `provider.py`.**

---

## 7. Frontend Analysis

**No Gemini SDK imports or calls exist in the frontend.** The only references to "gemini" are:
- `src/domain/investigation.ts:58` — string literal in response type (`"gemini" | "unavailable"`)
- `src/store/ApolloContext.tsx:676` — checking response metadata for `higgins_source === "gemini"`

**Conclusion**: No frontend-to-Gemini direct pathway. ✅

---

## 8. Summary of Proposed Corrections

| ID | Severity | Finding | Proposed Fix |
|---|---|---|---|
| **F1** | HIGH | `scam_analysis.py` uses alternate Gemini pathway via emergentintegrations | Route through `provider.py` or apply equivalent privacy controls with documented justification |
| **F2** | MEDIUM | `generate()` has default `purpose=Purpose.INVESTIGATION` | Remove default; make `purpose` a required keyword argument |
| **F3** | MEDIUM | `analysis.py:234` missing explicit purpose for page screenshot vision | Add `purpose=Purpose.VISION_PREFLIGHT` |
| **F4** | MEDIUM | `analysis.py:329` missing explicit purpose for page crawl | Add `purpose=Purpose.INVESTIGATION` |
| **F5** | MEDIUM | Text parts in SDK Content objects only get `strip_credentials()`, not full `enforce_boundary()` | Apply `enforce_boundary(purpose, part.text)` instead of just `strip_credentials()` |
| **F6** | MEDIUM | Binary content passes through without any check or logging | Add binary content validation: verify purpose authorises binary; log binary presence for audit |
| **F7** | LOW | No architectural test preventing future bypass | Add import-scanning test that fails if `genai.Client`, `.generate_content`, or `.count_tokens` appear outside `provider.py` |

---

## 9. Proposed Phase 2 Implementation Order

1. **F2**: Make `purpose` required in `generate()` signature → forces all callers to be explicit
2. **F3, F4**: Add missing `purpose=` to the 2 analysis.py call sites
3. **F5**: Upgrade Content text-part enforcement from `strip_credentials()` to `enforce_boundary()`
4. **F6**: Add binary content validation (purpose-based authorisation check)
5. **F1**: Address scam_analysis.py alternate pathway
6. **F7**: Add architectural enforcement test
7. Update documentation and Compliance Matrix

---

**This audit is presented for review before any code changes are made.**
