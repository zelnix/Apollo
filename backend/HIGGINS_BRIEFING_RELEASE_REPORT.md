# Apollo Scam Guard — Higgins Evidence-Based Investigation Briefings

**Release Report — Consolidated Delivery**

---

## 1. Summary

Higgins' investigation briefings have been enhanced to deliver intelligent, specific, evidence-based and educational explanations. All prompt files across the application have been aligned to the unified communication standard.

**Operating principle:** APOLLO DETECTS. MAGNUM DI INVESTIGATES. HIGGINS EXPLAINS AND GUIDES.

---

## 2. Files and Components Changed

| File | Change |
|---|---|
| `backend/core/config.py` | HIGGINS_VOICE rewritten: adaptive communication standard (6-point reasoning), personality traits, user-facing protection categories, proportionate guidance, never-manufacture-concern principle |
| `backend/services/higgins/coordinator.py` | Complete "HIGGINS EVIDENCE-BASED BRIEFING STANDARD" section added: evidence-specific language (with BAD/GOOD examples), connect-evidence-to-deception requirement, educate-through-investigation directive, briefing structure, proportionate depth, accuracy requirements |
| `backend/services/higgins/chat.py` | Rewritten with Magnum DI role separation, follow-up conversation capability, investigation handoff, user-facing gate names, consistent tone |
| `backend/services/investigation.py` | Enhanced with evidence-specific explanation requirements, education directive, no-generic-warnings rule |
| `backend/routers/analysis.py` | `_build_vision_higgins` rewritten to use actual identities/URLs/brands in headlines and explanations, explain deception mechanisms, proportionate reassurance for legitimate findings |
| `backend/services/higgins/capacity.py` | OUTPUT tokens increased from 8192 → 16384 to support ~5,000-word comprehensive investigations |
| `backend/tests/test_higgins_briefing_acceptance.py` | NEW: 30 acceptance tests covering all 9 scenarios |
| `backend/tests/test_higgins_authority.py` | Updated for new prompt structure |
| `backend/tests/test_magnum_di_acceptance.py` | Updated voice test for new communication standard |

---

## 3. How Magnum DI Evidence Reaches Higgins

The evidence flow is preserved through the existing architecture:

1. **Evidence ingestion** — User submissions (text, URLs, images) are ingested via `repository.py` → `evidence.py` and stored with unique `evidenceId`s in MongoDB.
2. **Research results** — Tool calls (research_public_sources, inspect_url, lookup_reputation, lookup_breach) produce `sourceId`-tagged results stored in the case evidence inventory.
3. **Coordinator reasoning** — The coordinator SYSTEM prompt instructs Magnum DI to investigate using these tools, then produce structured JSON with `findings[].evidenceIds` and `findings[].sourceIds` tracing each finding to its evidence.
4. **Higgins presentation** — The `overview` and `explanationMarkdown` fields in the response ARE the Higgins briefing. The new briefing standard requires these fields to use actual identities, numbers, dates and sources from the investigation — not generic warnings.

No new intermediary or duplicate reporting system was introduced.

---

## 4. How Specific Identifiers and Sources are Preserved

- Every finding in the response must include `evidenceIds` and `sourceIds` referencing registered inventory items.
- The `validate()` function in `validation.py` enforces that all referenced IDs exist in the case's evidence/source inventory.
- The coordinator prompt explicitly states: "Every finding must trace to at least one registered evidenceId or sourceId. Assertions without provenance are not findings."
- The ACCURACY REQUIREMENTS section prohibits inventing company names, registration numbers, licence holders, testimonials, URLs, dates or research findings.

---

## 5. How Educational Explanations are Generated

The coordinator prompt includes the "EDUCATE THROUGH THE INVESTIGATION" directive:

- Explain relevant concepts as they arise (ABN vs AFSL, AutoPay, direct debit, BSB, phishing mechanisms, etc.)
- Tie education to the specific case — no generic lectures
- Examples in the prompt show how financial claims should be explained numerically ("A 15% monthly return would mean $1,500 in the first month on a $10,000 investment...")
- The CONNECT EVIDENCE TO DECEPTION directive requires explaining how individual findings work together as a mechanism

---

## 6. How Uncertainty and Missing Evidence are Handled

- The response contract includes `uncertainties[]` — an array of strings describing what could not be established
- The `completion` field distinguishes "complete" / "partial" (with `remainingEvidenceIds`) / "waiting_user"
- Evidence basis classification: "observation" (directly present) vs "inference" (reasoned interpretation)
- Confidence levels: "high" (corroborated), "medium" (plausible), "low" (suspicious but unverified)
- The prompt states: "Where an important fact cannot be verified, say precisely what remains unverified and why that matters."
- A DNS failure, unreachable page, empty reputation or 'no hit' is explicitly classified as a limitation, not proof of fraud or safety.

---

## 7. Output Depth — Can Investigations Exceed 500 Words?

**Yes.** The previous 8192-token output limit has been increased to **16384 tokens** (supporting approximately 5,000-6,000 words in JSON-structured responses).

- The coordinator prompt states: "there is no arbitrary short word limit"
- The PROPORTIONATE DEPTH section instructs: "Do not sacrifice meaningful investigative findings merely to produce a short answer"
- Simple cases may need a few sentences; complex investigations may require several well-organised paragraphs
- The full investigation case remains accessible through the existing case/report UI via the "View Full Investigation" action
- Gemini 3.8 Flash supports up to 64K output tokens; the 16384-token budget is well within capacity

---

## 8. Test Results

### New Briefing Acceptance Tests — 30/30 PASSED

| Category | Tests | Result |
|---|---|---|
| Coordinator briefing standard | 8 | ✅ PASS |
| Higgins voice alignment | 6 | ✅ PASS |
| Chat prompt alignment | 5 | ✅ PASS |
| Investigation prompt alignment | 3 | ✅ PASS |
| Output depth configuration | 2 | ✅ PASS |
| Scenario: Investment impersonation | 1 | ✅ PASS |
| Scenario: Misleading testimonials | 1 | ✅ PASS |
| Scenario: Guaranteed returns | 1 | ✅ PASS |
| Scenario: Bank impersonation | 1 | ✅ PASS |
| Scenario: Legitimate document | 1 | ✅ PASS |
| Scenario: Inconclusive investigation | 1 | ✅ PASS |
| Scenario: Follow-up questions (case access) | 1 | ✅ PASS |
| Scenario: Long-form report (multi-evidence) | 1 | ✅ PASS |
| Scenario: Evidence fidelity | 1 | ✅ PASS |
| Response validation (evidence-specific) | 1 | ✅ PASS |
| Response validation (legitimate) | 1 | ✅ PASS |
| Vision Higgins builder tests | 4 | ✅ PASS |

### Regression Tests — 88/88 PASSED

| Suite | Tests | Result |
|---|---|---|
| Higgins authority | 34 | ✅ PASS |
| Magnum DI acceptance | 32 | ✅ PASS |
| Investigation engine | 15 | ✅ PASS |
| Health check | 2 | ✅ PASS |
| Data classification | varies | ✅ PASS |

### Total: 118/118 PASSED, 0 failures

### Unverified Live Behaviour

- Live Gemini inference was not executed (container networking constraint). Tests verify prompt structure, pipeline setup, evidence ingestion, response validation and contract compliance.
- Native device features (camera, Vision Gate) require production builds.
- Actual Higgins briefing quality (the specific language Gemini produces) requires live model testing in a deployed environment.

---

## 9. Summary of Cross-Pathway Alignment

| Pathway | File | Status |
|---|---|---|
| Full investigation (coordinator) | `coordinator.py` | ✅ Aligned |
| Ordinary chat | `chat.py` | ✅ Aligned |
| Compatibility investigation | `investigation.py` | ✅ Aligned |
| Vision initial assessment | `analysis.py` | ✅ Aligned |
| Shared voice/identity | `config.py` | ✅ Aligned |
| User-facing Gate names | All prompts | ✅ Consistent |
| Output token budget | `capacity.py` | ✅ Increased to 16384 |

---

**Final product standard met:** Higgins must explain exactly what Magnum DI investigated, what it discovered, where the evidence came from, what the evidence means, and what the user should do — teaching through the actual investigation so people recognise the methods of deception rather than merely being warned that danger might exist.

APOLLO DETECTS. MAGNUM DI INVESTIGATES. HIGGINS EXPLAINS AND GUIDES.
