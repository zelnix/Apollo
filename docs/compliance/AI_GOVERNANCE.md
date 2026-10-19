# Apollo AI Governance, Legal & Provider Assurance

**Document**: AI_GOVERNANCE.md
**Version**: 1.0
**Status**: Package 7 Delivery
**Effective**: February 2026
**Standards**: ISO/IEC 42001:2023, Australian Privacy Act 1988 (APPs)
**Owner**: Apollo Engineering

---

## 1. AI System Inventory

### 1.1 AI Provider

| Attribute | Value |
|---|---|
| **Provider** | Google (Gemini API) |
| **Access** | Owner-managed `GEMINI_API_KEY` via paid API tier |
| **Gateway** | Single mandatory pathway: `services/higgins/provider.py` |
| **Models** | See §1.2 |
| **Library** | `google-genai` (official Google SDK) |
| **Alternate providers** | None. `emergentintegrations` removed (Package 3) |

### 1.2 Registered Models

| Model | Capabilities | Purpose |
|---|---|---|
| `gemini-3-flash-preview` | text, vision, audio, functions, search, json | Primary text/investigation model |
| `gemini-2.5-flash` | text, vision, audio, functions, search, json | Fallback text model |
| `gemini-2.5-pro` | text, vision, audio, functions, search, json | Alternate text model |
| `gemini-3.1-pro-preview` | text, vision, audio, functions, search, json | Advisory analysis model |
| `gemini-3.1-flash-tts-preview` | speech | Primary TTS |
| `gemini-2.5-flash-preview-tts` | speech | Fallback TTS |
| `gemini-2.5-pro-preview-tts` | speech | Alternate TTS |

### 1.3 AI Functions

| Function | AI Involvement | Privacy Controls |
|---|---|---|
| Investigation (Higgins coordinator) | Gemini generates structured investigation responses | Full LLM boundary; credential stripping; purpose=INVESTIGATION |
| Ordinary chat | Gemini generates conversational security guidance | Reduced scope; purpose=ORDINARY_CHAT; read-only tools |
| Research | Gemini with Google Search grounding | PII minimisation; purpose=RESEARCH |
| Text-to-speech | Gemini TTS synthesises Higgins voice | Credential stripping; purpose=TTS |
| Vision/screenshot analysis | Gemini vision extracts security signals | Privacy gate required; purpose=PAGE_SIGNAL_EXTRACTION or VISION_PREFLIGHT |
| Audio transcription | Gemini transcribes voice notes | Secret redaction on output; purpose=TRANSCRIPTION |
| Advisory classification | Gemini classifies government scam advisories | PII minimisation; purpose=PUBLIC_ADVISORY_ANALYSIS |
| Page crawl analysis | Gemini analyses fetched page content | SSRF protection; purpose=INVESTIGATION |

---

## 2. AI Risk Assessment

### 2.1 Identified Risks

| Risk | Likelihood | Impact | Mitigation | Status |
|---|---|---|---|---|
| **Privacy leakage via LLM** | Medium | High | LLM boundary enforcement; credential stripping; purpose-based controls; Package 2 classification | ✅ Mitigated |
| **Prompt injection** | Medium | Medium | Structured output schemas; response validation; evidence reference checking | ✅ Mitigated |
| **Misleading security conclusions** | Medium | High | INVESTIGATE→ASSESS→DIRECT→GUIDE→VERIFY validation; evidence-based findings required | ✅ Mitigated (Package 5) |
| **Evidence fabrication** | Low | High | Observation basis requires evidence IDs; unknown IDs rejected; coverage tracking | ✅ Mitigated (Package 5) |
| **Unsupported Biting claims** | Low | High | System prompt prohibition; completion validator; enforcement evidence required | ✅ Mitigated |
| **Credential disclosure** | Low | Critical | `strip_credentials()` on all text; CREDENTIAL category PROHIBITED for all purposes | ✅ Mitigated (Packages 2-4) |
| **Inappropriate tool actions** | Low | Medium | `requires_user_gesture` flag; capability ID validation; action kind restrictions | ✅ Mitigated |
| **Image privacy breach** | Medium | High | On-device screening; sanitization receipts; byte-binding digest; fail-closed | ✅ Mitigated (Package 4) |
| **Visual-only credential disclosure** | Low | Medium | Text-layer check for documents; honest limitation documented | ⚠️ Partially mitigated |
| **Model hallucination** | Medium | Medium | Structured schemas; reference validation; uncertainty tracking | ✅ Mitigated |

### 2.2 Residual Risks

| Risk | Residual Level | Justification |
|---|---|---|
| Visual-only credentials in images | Low | On-device screening handles this; server-side limitation documented |
| Client-assertion trust boundary | Low | Honest limitation; backend validates what it can |
| Gemini processing location | Medium | Google infrastructure; paid tier; no training use; see §4 |

---

## 3. Higgins Oversight

### 3.1 INVESTIGATE → ASSESS → DIRECT → GUIDE → VERIFY

| Stage | Structural Enforcement | System Prompt | Validation |
|---|---|---|---|
| **INVESTIGATE** | Findings require registered evidence/source IDs | "Examine relevant original evidence" | Unknown IDs rejected; observation basis requires evidence |
| **ASSESS** | `concern_found` requires ≥1 finding | "Make an evidence-supported security judgement" | No-concern + action-needed contradiction rejected |
| **DIRECT** | `action_needed`/`urgent` requires actions with non-empty instructions | "Give ONE clear primary instruction" | Empty instructions/labels rejected |
| **GUIDE** | `recommendedActionIndex` required when actions present | "Provide one immediate step" | Out-of-range index rejected |
| **VERIFY** | `complete` blocked when material evidence unexamined | "Verify completed actions using genuine evidence" | Material gaps block completion (both listed and unlisted) |

### 3.2 Directive Authority & User Control

Higgins determines and communicates the appropriate protective action. The user retains control:
- `requires_user_gesture` flag on capability actions
- User must authorise consequential operations
- User can stop investigation at any time
- Investigation scope bounded by submitted evidence

---

## 4. Gemini Provider Terms Verification

### 4.1 Verified Terms (Paid API Tier)

| Term | Status | Evidence |
|---|---|---|
| **No training use** | ✅ Verified | Google Gemini API paid tier terms: prompts and responses not used for model training |
| **Data retention** | ✅ Documented | Paid API: no prompt/response retention for training; operational logging per Google's data processing terms |
| **Processing location** | ⚠️ Google infrastructure | Google's standard infrastructure; specific regions determined by Google |
| **Subprocessors** | ⚠️ Google standard | Google's subprocessor list applies |

### 4.2 What Apollo Discloses to Users

From `privacyInventory.ts` — `AI_PROCESSING_DISCLOSURE`:
- Apollo uses Google's paid Gemini API for security analysis
- Paid tier: prompts and responses are not used for model training
- Content is processed in Google's infrastructure
- Temporary processing only; no permanent storage by Google for training
- Apollo's 15-minute retention applies to investigation content

### 4.3 Training-Use vs Zero-Retention Distinction

| Claim | Verified |
|---|---|
| "Not used for model training" | ✅ Correct for paid API tier |
| "Zero retention" | ❌ Not claimed — Google may retain for operational/abuse purposes per their terms |
| "No logging" | ❌ Not claimed — Google's operational logging applies |

---

## 5. Australian Privacy Act & APPs Assessment

### 5.1 APP Compliance Summary

| APP | Requirement | Apollo Compliance | Status |
|---|---|---|---|
| **APP 1** | Open/transparent management | Privacy disclosure screen; compliance matrix; this documentation | ⚠️ Formal privacy policy document needed |
| **APP 2** | Anonymity/pseudonymity | Server-issued device ID; no PII required for registration | ✅ |
| **APP 3** | Collection limitation | Only user-submitted content processed | ✅ |
| **APP 5** | Notification of collection | Disclosure at setup; AI processing section | ✅ |
| **APP 6** | Use or disclosure | Purpose-limited; LLM boundary; credential prohibition | ✅ |
| **APP 8** | Cross-border disclosure | Gemini processes in Google infrastructure | ⚠️ Formal assessment needed |
| **APP 11** | Security | Encryption, auth, scoped retention, key management | ✅ |
| **APP 12** | Access | Device owner views their evidence/conversations | ⚠️ No formal SAR procedure |
| **APP 13** | Correction | Re-submit mechanism available | ⚠️ No formal correction procedure |

### 5.2 Required Actions

| Action | Priority | Status |
|---|---|---|
| Publish formal privacy policy | Medium | Not yet done |
| Cross-border transfer assessment for Gemini | Medium | Documented, not formally assessed |
| Subject access request procedure | Low | Not formalised |
| Correction procedure | Low | Not formalised |
| Legal review of obligations | Medium | Requires legal advisor appointment |

---

## 6. Privacy Notices & Consent

### 6.1 Current Disclosures

| Disclosure | Location | Content |
|---|---|---|
| Setup privacy disclosure | `privacy-disclosure.tsx` | Processing inventory; AI disclosure; user consent |
| AI processing section | `privacyInventory.ts:AI_PROCESSING_DISCLOSURE` | What Google receives; paid tier terms; retention |
| Local-only processing list | `privacyInventory.ts:PRIVACY_FLOWS` | What stays on device vs what is transmitted |

### 6.2 Consent Model

| Consent Point | Type | Revocable |
|---|---|---|
| App setup | Explicit accept of privacy disclosure | Yes (delete device) |
| Gmail connection | OAuth consent flow | Yes (disconnect in Settings) |
| Push notifications | Device permission prompt | Yes (device Settings) |
| Investigation submission | Per-submission (user taps check) | N/A (per-action) |
| Image transmission | Per-image (privacy gate) | Yes (withhold option always available) |

---

## 7. Change Management

### 7.1 AI Change Governance

| Change Type | Approval Required | Process |
|---|---|---|
| New Gemini model | AI Governance Owner | Register in `CAPABILITIES`; verify capabilities; test |
| New processing purpose | Privacy + AI Governance Owner | Add to Purpose enum; add authorisation matrix entry; test |
| New external data pathway | Privacy + Security Owner | Document in processing pathways; add controls |
| Gemini provider change | All Owners | Full assessment; compliance matrix review |

---

## 8. Compliance Matrix Updates

| Gap ID | Resolution | Status |
|---|---|---|
| G-04 | Cross-border assessment documented; formal assessment pending | ⚠️ Remains open |
| G-05 | Privacy policy content exists in disclosure screen; formal document needed | ⚠️ Remains open |
| G-07 | SAR/correction procedures documented as needed; not formalised | ⚠️ Remains open |
| G-10 | Consent model documented; granular per-purpose consent noted as improvement | ⚠️ Remains open |
| G-11 | AI risk register created (§2 above) | ✅ Closed |

---

## Package Delivery Record

| Item | Value |
|---|---|
| **Implemented** | AI_GOVERNANCE.md documentation; risk register; provider terms verification; APP assessment; consent model; change governance |
| **Verification performed** | Provider.py configuration inspection; privacyInventory.ts content verification; disclosure screen verification |
| **Remaining limitations** | G-04, G-05, G-07, G-10 require legal/formal action beyond engineering |
| **Acceptance requested** | Yes |
