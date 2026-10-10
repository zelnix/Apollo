# Apollo Privacy Standards Compliance Matrix

**Document**: APOLLO_PRIVACY_STANDARDS_MATRIX.md
**Version**: 1.0
**Status**: Initial Adoption — Internal Conformity Assessment
**Effective**: February 2026
**Owner**: Apollo Engineering
**Review Cycle**: Quarterly or upon material architecture change

---

## 1. Standards Adoption Register

Apollo formally adopts the following recognised standards as the basis for its privacy, security and AI governance controls. Adoption means Apollo uses these standards to define, scope and assess its controls. It does not claim independent certification unless explicitly stated.

| Standard | Edition | Role | Adoption Status |
|---|---|---|---|
| **ISO/IEC 27701:2025** | 2025 | Primary Privacy Information Management System (PIMS) | **Adopted** — Internal conformity assessment |
| **ISO/IEC 29100:2024** | 2024 | Privacy terminology, definitions and principles | **Adopted** — Reference framework |
| **ISO/IEC 27001:2022** | 2022 | Information security management and controls | **Adopted** — Internal conformity assessment |
| **ISO/IEC 42001:2023** | 2023 | AI governance and accountability | **Adopted** — Internal conformity assessment |
| **Australian Privacy Act 1988** | Current + APPs | Applicable Australian legal requirements | **Adopted** — Legal compliance obligation |
| **ISO/IEC 27559:2022** | 2022 | De-identification framework | **Adopted** — Supporting reference |
| **ISO 31700-1:2023** | 2023 | Privacy-by-design requirements | **Adopted** — Supporting reference |

### Distinction of Status Levels

| Level | Meaning |
|---|---|
| **Adopted** | Apollo recognises the standard and maps its applicable requirements to controls |
| **Internal Conformity Assessment** | Apollo assesses its own implementation against the standard's requirements |
| **Legal Compliance** | Apollo is legally obligated to comply; internal assessment plus legal review required |
| **Independent Certification** | An accredited body has audited and certified conformity — **not currently claimed** |

---

## 2. Scope & Applicability

### 2.1 System Boundary

Apollo is a mobile-first cybersecurity application comprising:

| Component | Description | Privacy Relevance |
|---|---|---|
| **Expo Mobile App** (frontend) | React Native client on iOS/Android | Device-local processing, user consent, evidence collection, image privacy gate |
| **FastAPI Backend** (backend) | RESTful API server | Evidence storage, investigation coordination, Gemini gateway, retention management |
| **MongoDB** (database) | Document store | Investigation cases, device records, evidence, conversation history |
| **Google Gemini API** (external) | AI inference provider | Receives privacy-processed evidence for security analysis |
| **Third-Party Services** | Intel, reputation, breach, web crawl | Receive minimal public identifiers only |

### 2.2 Data Subjects

| Subject Category | Applicability |
|---|---|
| Apollo device owners | Primary — all controls apply |
| Family members (paired guardians) | Applicable — family sharing controls, minimal alert data |
| Third parties mentioned in evidence | Applicable — evidence may contain personal data of message senders, email correspondents |
| Persons whose data appears in screenshots | Applicable — image privacy gate, sanitisation controls |

### 2.3 Processing Activities in Scope

- Security assessment of user-submitted messages, emails, screenshots, links, accounts, calls, apps, files and devices
- AI-assisted investigation through Google Gemini (single gateway)
- On-device image screening and sanitisation
- Public research using minimal identifiers
- Device observation and enforcement evidence
- Family alert sharing and weekly reports
- Push notification delivery
- Text-to-speech generation
- Gmail OAuth integration (opt-in)
- Conversation history and temporary retention

### 2.4 Jurisdictions

| Jurisdiction | Basis |
|---|---|
| **Australia** | Primary — Australian Privacy Act 1988, APPs 1–13 |
| **Other** | Where users are located; assessed case-by-case |

---

## 3. Governance & Responsibilities

| Role | Responsibility | Current Assignment |
|---|---|---|
| **Privacy Owner** | Standards adoption, compliance matrix maintenance, gap resolution | Apollo Engineering Lead |
| **Security Owner** | ISO 27001 controls, encryption, access control, incident response | Apollo Engineering Lead |
| **AI Governance Owner** | ISO 42001 controls, Gemini gateway oversight, Higgins behaviour | Apollo Engineering Lead |
| **Legal Advisor** | Privacy Act compliance, APP assessment, cross-border obligations | To be appointed / external review required |
| **Data Protection Contact** | User enquiries, access requests, complaint handling | To be defined |

### Governance Approvals Required

| Decision | Approver | Status |
|---|---|---|
| Standards adoption scope | Privacy Owner | Approved (this document) |
| New external data processing pathway | Privacy Owner + Security Owner | Required per Package 3 |
| Gemini model or provider change | AI Governance Owner | Required per Package 7 |
| Cross-border data transfer assessment | Legal Advisor | Pending — requires appointment |
| Independent certification decision | All owners | Not yet scheduled |

---

## 4. Compliance Matrix — Requirements to Controls

### 4.1 ISO/IEC 27701:2025 — Privacy Information Management (PIMS)

| Ref | Requirement Area | Control | Implementation | Owner | Evidence | Gap | Acceptance |
|---|---|---|---|---|---|---|---|
| 27701-5.2 | Privacy policy and objectives | Purpose-limited processing documented | `privacyInventory.ts`, `privacy-disclosure.tsx`, `PRIVACY_FLOWS` array | Privacy | Disclosure screen shown at setup; reachable from Settings | None | ✅ Implemented |
| 27701-5.4 | PII processing conditions | Informed consent before setup; opt-in for Gmail, notifications | `privacy-disclosure.tsx` accept flow → `completeSetup()` | Privacy | Consent recorded at device registration | Consent record format not yet standardised | ⚠️ Partial |
| 27701-6.2 | Access control for PII | Owner-scoped device authentication; admin key separation | `core/auth.py` — bearer token + device_id enforcement; admin key via separate header | Security | Every non-public route requires matching device_id | No person/household identity layer yet | ⚠️ Partial |
| 27701-6.3 | Cryptographic protection | Investigation content encrypted at rest (Fernet); TLS in transit | `encryption.py` — dedicated investigation key; Kubernetes TLS termination | Security | Key file permission checks; domain-separated integrity | Encryption covers investigation content; other collections use MongoDB at-rest encryption config | ⚠️ Partial |
| 27701-6.5 | Retention and disposal | Temporary evidence: 15-minute scoped lifecycle with verified deletion | `retention.py` — `sweep()`, `delete_scope()`, TTL indexes | Privacy | Automated sweep loop; generation-based invalidation | Clear Patrol is soft-delete, not physical erasure (documented in disclosure) | ⚠️ Partial |
| 27701-7.2 | PII principal consent | Setup disclosure → accept; Gmail OAuth consent flow | `privacy-disclosure.tsx`, `routers/gmail.py` OAuth | Privacy | Disclosure version tracked (`DISCLOSURE_VERSION`) | Granular per-purpose consent not yet implemented | ⚠️ Partial |
| 27701-7.3 | Privacy notice | Processing inventory with what/when/detail structure | `privacyInventory.ts` — `PRIVACY_FLOWS`, `AI_PROCESSING_DISCLOSURE` | Privacy | Displayed to user; covers AI processing explicitly | Legal review of notice adequacy pending | ⚠️ Partial |
| 27701-7.4 | PII minimisation | Credential stripping; research query minimisation; image sanitisation | `llm_boundary.py`, `redaction.py`, `imageSanitization.ts` | Privacy | Evidence-based PII extraction; deterministic replacement | Vision preflight sends original to Gemini (Package 4 gap) | 🔴 Gap |
| 27701-7.5 | Purpose limitation | Purpose enum in LLM boundary; privacy boundary middleware | `llm_boundary.py` — `Purpose` enum; `privacy_boundary.py` | Privacy | Each Gemini call requires explicit purpose | Default purpose permissiveness needs review (Package 3) | ⚠️ Partial |
| 27701-8.2 | Cross-border transfers | Gemini API processes in Google's infrastructure | `provider.py` configuration disclosure | Privacy | Paid tier disclosure in privacy inventory | Formal cross-border assessment not completed | 🔴 Gap |

### 4.2 ISO/IEC 29100:2024 — Privacy Principles

| Principle | Control | Implementation | Status |
|---|---|---|---|
| **Consent and choice** | Setup disclosure; opt-in Gmail/notifications | `privacy-disclosure.tsx`, Settings toggles | ✅ Implemented |
| **Purpose legitimacy and specification** | Processing inventory; purpose enum | `PRIVACY_FLOWS`; `Purpose` enum in `llm_boundary.py` | ✅ Implemented |
| **Collection limitation** | Only user-submitted or opt-in content processed | Route-level input validation; no full inventory collection | ✅ Implemented |
| **Data minimisation** | Credential stripping; PII minimisation in research; image gate | `redaction.py`, `llm_boundary.py`, `ImagePrivacyGate.tsx` | ⚠️ Partial — vision preflight gap |
| **Use, retention and disclosure limitation** | 15-min scoped retention; no logging of prompts/responses | `retention.py`; provider.py no-logging design | ⚠️ Partial — soft-delete gap |
| **Accuracy** | Evidence provenance tracking; honest narration of limitations | `evidence_provenance` field; `higginsNarration.ts` | ✅ Implemented |
| **Openness, transparency and notice** | Disclosure screen; AI processing section; local-only list | `privacyInventory.ts` comprehensive inventory | ✅ Implemented |
| **Individual participation and access** | Delete device endpoint; clear patrol | `delete_owner_content()`; patrol clear | ⚠️ Partial — no formal SAR procedure |
| **Accountability** | Compliance matrix; governance roles defined | This document | ⚠️ Partial — legal advisor not appointed |
| **Information security** | Encryption, auth, access control | `encryption.py`, `auth.py` | ⚠️ Partial — see 27001 section |
| **Privacy compliance** | Standards adoption; internal assessment | This document; planned verification | ⚠️ Partial — verification pending |

### 4.3 ISO/IEC 27001:2022 — Information Security Controls

| Control Area | Ref | Control | Implementation | Status |
|---|---|---|---|---|
| **Access control** | A.5.15–5.18 | Device bearer auth; admin key separation; owner-scoped queries | `auth.py` — SHA-256 hashed tokens; device_id enforcement on every request | ✅ Implemented |
| **Cryptography** | A.8.24 | Investigation content: Fernet encryption at rest; domain-separated integrity | `encryption.py` — dedicated key file with permission checks | ✅ Implemented |
| **Cryptography** | A.8.24 | TLS in transit | Kubernetes ingress TLS termination | ✅ Implemented |
| **Operational security** | A.8.15 | No prompt/response logging in provider | `provider.py` — ProviderFailure never includes SDK text | ✅ Implemented |
| **Secure development** | A.8.25 | Strict Pydantic schemas; `extra="forbid"` on wire models | `contracts.py` — all Wire models reject unknown fields | ✅ Implemented |
| **Supplier management** | A.5.19–5.22 | Gemini paid tier; no training use; documented retention | `provider.py` configuration disclosure; privacy inventory | ⚠️ Partial — formal supplier assessment pending |
| **Incident management** | A.5.24–5.28 | Privacy boundary middleware; error containment | `privacy_boundary.py`; ProviderFailure code-only errors | ⚠️ Partial — no formal incident procedure |
| **Data isolation** | A.8.31 | Owner-scoped DB queries; device_id enforcement | All DB queries filtered by `owner_id` or `device_id` | ✅ Implemented |
| **Key management** | A.8.24 | Dedicated investigation key; permission-checked file | `encryption.py` — `0o077` permission check; separate from API keys | ✅ Implemented |
| **MFA** | A.8.5 | Admin key for privileged access | `auth.py` — separate admin key boundary | ⚠️ Partial — single-factor admin key |
| **Retention** | A.8.10 | 15-minute scoped lifecycle; sweep loop; TTL indexes | `retention.py` — generation invalidation + TTL expiry | ✅ Implemented |
| **Backup** | A.8.13 | MongoDB standard configuration | Infrastructure-level | ⚠️ Needs verification |

### 4.4 ISO/IEC 42001:2023 — AI Governance

| Requirement | Control | Implementation | Status |
|---|---|---|---|
| **AI system inventory** | Single AI provider (Gemini); documented models and capabilities | `provider.py` — `CAPABILITIES` dict; `configuration()` method | ✅ Implemented |
| **Risk assessment** | Privacy leakage via LLM boundary; credential stripping; purpose restrictions | `llm_boundary.py` — `strip_credentials()`, `enforce_boundary()`, `validate_outbound_payload()` | ⚠️ Partial — formal risk register needed |
| **Accountability & oversight** | Validation of AI responses; structured contracts; finding/evidence ID tracking | `validation.py`, `contracts.py` — reject unknown IDs, require evidence basis | ✅ Implemented |
| **Transparency** | AI Processing disclosure; explanation of what Google receives | `AI_PROCESSING_DISCLOSURE` in `privacyInventory.ts` | ✅ Implemented |
| **Human oversight** | User approval via privacy gate; no consequential actions without consent | `ImagePrivacyGate.tsx`; action `requires_user_gesture` field | ✅ Implemented |
| **Data governance** | Purpose-classified processing; evidence boundary enforcement | `Purpose` enum; `Classification` enum; field-level classification | ⚠️ Partial — not all pathways formally classified |
| **Bias and fairness** | Security evidence assessment; no personal-characteristic-based decisions | Higgins investigates evidence, not persons | ⚠️ Needs formal assessment |
| **Single gateway enforcement** | All Gemini calls through `provider.py` | `provider.py` — `generate()`, `generate_json()`, `speech_bytes()` | ⚠️ Partial — audit of all call sites pending (Package 3) |
| **Behavioural standard** | INVESTIGATE → ASSESS → DIRECT → GUIDE → VERIFY | System prompt in `coordinator.py`; `validation.py` structural checks | ⚠️ Partial — structural enforcement pending (Package 5) |

### 4.5 Australian Privacy Act 1988 — Australian Privacy Principles (APPs)

| APP | Requirement | Control | Implementation | Status |
|---|---|---|---|---|
| **APP 1** | Open and transparent management | Privacy disclosure; compliance matrix | `privacy-disclosure.tsx`; this document | ⚠️ Partial — formal privacy policy document needed |
| **APP 2** | Anonymity and pseudonymity | Anonymous device identity; no name/email required for core function | `auth.py` — server-issued device_id; no PII collection for registration | ✅ Implemented |
| **APP 3** | Collection of solicited personal information | Only user-submitted content; opt-in for Gmail/notifications | Route-level input; no unsolicited collection | ✅ Implemented |
| **APP 4** | Dealing with unsolicited personal information | Third-party PII in evidence handled via sanitisation | `llm_boundary.py` — PII minimisation in research queries | ⚠️ Partial — no formal destruction procedure for unsolicited PII |
| **APP 5** | Notification of collection | Disclosure at setup; AI processing section | `PRIVACY_FLOWS`; `AI_PROCESSING_DISCLOSURE` | ✅ Implemented |
| **APP 6** | Use or disclosure | Purpose-limited processing; LLM boundary enforcement | `Purpose` enum; credential stripping; image gate | ⚠️ Partial — vision preflight gap; default purpose permissiveness |
| **APP 7** | Direct marketing | Not applicable — Apollo does not perform direct marketing | — | ✅ N/A |
| **APP 8** | Cross-border disclosure | Gemini API processes in Google infrastructure | Paid tier disclosure; no training use documented | 🔴 Gap — formal assessment required |
| **APP 9** | Adoption, use or disclosure of government-related identifiers | Apollo does not collect government identifiers by design | No government ID fields in any schema | ✅ Implemented |
| **APP 10** | Quality of personal information | Evidence provenance tracking; honest limitations | `evidence_provenance` field; incomplete evidence marked | ✅ Implemented |
| **APP 11** | Security of personal information | Encryption, auth, scoped retention, key management | See ISO 27001 controls above | ⚠️ Partial |
| **APP 12** | Access to personal information | Device owner can view their evidence and conversations | Investigation case access; patrol history | ⚠️ Partial — no formal access request procedure |
| **APP 13** | Correction of personal information | Evidence is user-submitted; corrections via new submissions | Re-check / re-submit mechanism | ⚠️ Partial — no formal correction procedure |

### 4.6 ISO/IEC 27559:2022 — De-identification

| Requirement | Control | Implementation | Status |
|---|---|---|---|
| **De-identification techniques** | Pattern-based replacement with category labels | `_minimise_personal_identifiers()` — email, phone, financial patterns | ✅ Implemented |
| **Evidence-inventory-aware replacement** | Deterministic exact-match replacement of known PII | `extract_evidence_pii()` + evidence_pii parameter | ✅ Implemented |
| **Re-identification risk** | Category labels prevent re-identification of minimised values | `[email]`, `[phone number]`, `[financial identifier]` replacements | ✅ Implemented |
| **Scope limitation** | De-identification applied only to outbound research; investigation retains originals | `Purpose.RESEARCH` triggers minimisation; `Purpose.INVESTIGATION` permits originals | ✅ Implemented |

### 4.7 ISO 31700-1:2023 — Privacy by Design

| Requirement | Control | Implementation | Status |
|---|---|---|---|
| **Default privacy** | Image gate defaults to showing all sensitive regions; credential flag recommends text-only | `ImagePrivacyGate.tsx` default recommendation | ✅ Implemented |
| **Proactive not reactive** | On-device screening before transmission; pipeline enforcement | `requireImageSanitization()` — blocks upload without receipt | ✅ Implemented |
| **Privacy embedded in design** | LLM boundary as mandatory code path; not optional middleware | `enforce_boundary()` called in `provider.py` generate function | ✅ Implemented |
| **Full lifecycle protection** | Scoped retention with automatic deletion | `retention.py` — 15-minute lifecycle + sweep loop | ✅ Implemented |
| **End-to-end security** | Encryption at rest and in transit | `encryption.py`; TLS | ✅ Implemented |
| **Visibility and transparency** | Privacy disclosure; AI processing explanation | `privacyInventory.ts` | ✅ Implemented |
| **User-centric** | User chooses: text-only, redacted, crop, withhold | `ImagePrivacyGate.tsx` — four-choice UI | ✅ Implemented |

---

## 5. Evidence-Preservation & Investigative-Effectiveness Impacts

Privacy controls must not compromise Apollo's security evidence or Higgins' investigative effectiveness without explanation. This section documents known impacts.

| Control | Privacy Benefit | Evidence/Investigation Impact | Mitigation |
|---|---|---|---|
| **Credential stripping** (`strip_credentials`) | Prevents password/token disclosure to Gemini | None — credentials have no investigative value for Gemini | No mitigation needed |
| **Research PII minimisation** (`_minimise_personal_identifiers`) | Prevents personal identifiers in research queries | Minimal — domain names and scam indicators preserved; only emails/phones/financials replaced | Evidence-inventory-aware replacement prevents over-redaction |
| **Image sanitisation** (`ImagePrivacyGate`) | User controls what visual content leaves device | User may choose text-only, losing visual context for investigation | User informed of trade-off; can approve image if needed |
| **Purpose restrictions** (`Purpose` enum) | Limits data disclosure per processing purpose | Ordinary chat receives structured facts only, not raw evidence | By design — chat doesn't need raw evidence |
| **Vision preflight gap** (current) | **GAP** — original image sent to Gemini for admission check | Image disclosure occurs before user consent for privacy screening | **Package 4 must fix** — local inspection before any external transmission |
| **Soft-delete Patrol** (current) | **GAP** — clear Patrol hides but doesn't physically erase | Evidence technically persists | Disclosed to user; physical erasure mechanism needed |
| **Default purpose permissiveness** (current) | **GAP** — `Purpose.INVESTIGATION` as default in some paths | May process data with broader permissions than necessary | **Package 3 must fix** — require explicit purpose |

---

## 6. Gap Summary & Remediation Plan

| Gap ID | Standard | Description | Severity | Remediation Package | Target |
|---|---|---|---|---|---|
| **G-01** | 27701-7.4, APP 6 | Vision preflight sent original image to Gemini before user consent | High | Package 4 | ✅ **CLOSED** — Preflight removed; on-device screening required |
| **G-02** | 27701-7.5 | Default purpose permissiveness — some pathways don't require explicit processing purpose | Medium | Package 3 | Phase 3 |
| **G-03** | 42001 | Single gateway not fully audited — possible alternate Gemini call sites | High | Package 3 | Phase 3 |
| **G-04** | 27701-8.2, APP 8 | No formal cross-border data transfer assessment for Gemini | Medium | Package 7 | Phase 4 |
| **G-05** | APP 1 | No formal published privacy policy document (disclosure screen exists but no standalone policy) | Medium | Package 7 | Phase 4 |
| **G-06** | 27701-6.5 | Clear Patrol is soft-delete; no physical erasure mechanism | Medium | Package 6 | Phase 4 |
| **G-07** | APP 12, APP 13 | No formal subject access request or correction procedure | Low | Package 7 | Phase 4 |
| **G-08** | 27001-A.5.24 | No formal privacy incident/breach response procedure | Medium | Package 6 | Phase 4 |
| **G-09** | 27001-A.8.5 | Admin access uses single-factor API key (not MFA) | Low | Package 6 | Phase 4 |
| **G-10** | 27701-5.4 | Consent record format not standardised; no granular per-purpose consent | Low | Package 7 | Phase 4 |
| **G-11** | 42001 | Formal AI risk register created with 10 identified risks and mitigations | Medium | Package 7 | ✅ **CLOSED** — AI_GOVERNANCE.md §2 |
| **G-12** | 42001 | Higgins INVESTIGATE → ASSESS → DIRECT → GUIDE → VERIFY structurally enforced | Medium | Package 5 | ✅ **CLOSED** — Structural validation in validate(); system prompts enforced; 33 tests |

---

## 7. Verification Requirements

Each control must be verified through applicable methods. This table defines the verification approach.

| Verification Method | Description | Applicable Controls |
|---|---|---|
| **Code inspection** | Static analysis of implementation files | All code-level controls |
| **Automated test** | Unit/integration tests proving enforcement | Credential stripping, PII minimisation, image sanitisation, retention lifecycle |
| **Architecture audit** | Import/call-site analysis proving no bypass | Single Gemini gateway (Package 3) |
| **Integration test** | Real Gemini calls with synthetic evidence | Higgins behavioural standard (Package 5) |
| **Manual review** | Human inspection of documentation, procedures | Governance, legal assessments, supplier terms |
| **Native device test** | On-device verification of native capabilities | Image manipulation, OCR, VPN enforcement |
| **Penetration test** | Attempted bypass of privacy controls | Image upload without receipt; direct Gemini call; cross-device access |

### Test Evidence Register

| Test | File | Covers | Status |
|---|---|---|---|
| Data classification registry | `backend/tests/test_data_classification.py` | Categories, fields, dual classification, credentials, authorisation matrix, pathways, value patterns, LLM boundary integration | ✅ Passing (71 tests) |
| Package 4 acceptance verification | `backend/tests/test_package4_acceptance.py` | Adversarial receipts (forged/missing/reused/expired/mismatched), embedded documents (consent/classification/limitations), evidence preservation (domains/URLs/IPs/threats survive enforcement), Gemini payloads (credentials stripped all purposes, binary blocked, no preflight), native build checklist | ✅ Passing (43 tests) |
| Image consent enforcement | `backend/tests/test_image_consent_enforcement.py` | Preflight removed, entry points enforced, MIME types, OCR safety, consent recording, embedded images, receipt metadata | ✅ Passing (28 tests) |
| Gateway enforcement | `backend/tests/test_gateway_enforcement.py` | Architectural scan, purpose mandatory, binary auth, text enforcement, scam gateway, new purposes | ✅ Passing (23 tests) |
| Image sanitisation receipts | `frontend/tests/imageSanitization.test.ts` | Receipt creation, consumption, one-time use, expiry, byte-binding, Package 4 decisions | ✅ Passing (21 tests) |
| Privacy disclosure content | `frontend/tests/privacyDisclosure.test.ts` | AI processing disclosure sections, privacy flows | ✅ Passing |
| Architectural regression | `frontend/tests/architecturalRegression.test.ts` | Event merge, evidence preservation, state machine, privacy restrictions | ✅ Passing |
| Higgins behavioural | `frontend/tests/higginsBehavioural.test.ts` | Directive language, evidence-backed instructions, no passive language | ✅ Passing |
| Backend image sanitisation | `backend/tests/test_image_sanitization.py` | Backend receipt validation, rejection of missing receipts | ✅ Passing |
| Backend LLM boundary | `backend/tests/test_llm_boundary.py` | Credential stripping, PII minimisation, purpose enforcement | ✅ Passing |
| Single gateway audit | — | All Gemini SDK import/call sites verified | 🔴 Not yet performed (Package 3) |
| Higgins integration test | — | Real Gemini investigation with synthetic evidence | 🔴 Not yet performed (Package 8) |
| Native acceptance | — | On-device image manipulation, OCR, VPN | 🔴 Not yet performed (Package 8) |

---

## 8. Implementation File Registry

This section maps each privacy/security control to its authoritative implementation file.

### Frontend Controls

| File | Control | Purpose |
|---|---|---|
| `src/components/ImagePrivacyGate.tsx` | Image privacy gate UI | On-device image screening, redaction, user consent |
| `src/domain/imageSanitization.ts` | Sanitisation receipts | Cryptographic proof of privacy gate passage |
| `src/domain/imagePrivacy.ts` | Image screening logic | Sensitive region detection, classification |
| `src/domain/imagePrivacyCore.ts` | OCR/text extraction | On-device text recognition for privacy classification |
| `src/domain/privacyInventory.ts` | Processing inventory | What data goes where, when, and why |
| `src/investigation/client.ts` | Upload pipeline enforcement | Requires sanitisation receipt before image upload |
| `src/investigation/transferManager.ts` | Transfer pipeline enforcement | Requires sanitisation status metadata |
| `app/privacy-disclosure.tsx` | Privacy disclosure screen | User-facing consent and transparency |
| `src/domain/higginsHomeVoice.ts` | Higgins home narration | Directive voice, no passive language |
| `src/domain/higginsNarration.ts` | Event narration | Evidence-honest narration, provenance-controlled |
| `src/domain/protectionDetails.ts` | Protection findings | Threat-first evidence presentation |
| `src/domain/stateMachine.ts` | State resolution | Apollo state hierarchy, enforcement truth |
| `src/domain/eventMerge.ts` | Event synchronisation | Local/remote merge preserving evidence integrity |
| `src/domain/messageVoice.ts` | Projected voice | Privacy-safe text generation for server-projected events |

### Backend Controls

| File | Control | Purpose |
|---|---|---|
| `services/higgins/provider.py` | Single Gemini gateway | All AI inference through one authoritative pathway |
| `services/higgins/llm_boundary.py` | LLM evidence boundary | Credential stripping, PII minimisation, purpose enforcement |
| `core/data_classification.py` | Authoritative data classification | Single source of truth for data categories, field classification, authorisation matrix, processing pathways |
| `services/higgins/coordinator.py` | Investigation coordinator | Higgins INVESTIGATE → ASSESS → DIRECT → GUIDE → VERIFY |
| `services/higgins/contracts.py` | Wire contracts | Strict Pydantic schemas for all investigation data |
| `services/higgins/validation.py` | Response validation | Structural validation of Gemini responses |
| `services/higgins/tools.py` | Research tools | Public research with minimised queries |
| `services/higgins/encryption.py` | Investigation encryption | Fernet encryption at rest with dedicated key |
| `services/higgins/retention.py` | Retention lifecycle | 15-minute scoped retention with automatic deletion |
| `services/higgins/evidence.py` | Evidence management | Evidence ingestion, coverage tracking, provenance |
| `core/auth.py` | Device authentication | Bearer token auth, owner-scoped access, admin separation |
| `core/redaction.py` | Request-boundary redaction | Credential removal at request entry point |
| `core/privacy_boundary.py` | Route-level boundary | Middleware blocking unsupported processing paths |
| `routers/analysis.py` | Analysis endpoints | Requires sanitisation status on image uploads |
| `routers/investigations.py` | Investigation endpoints | Requires sanitisation status on evidence uploads |

---

## 9. Change Log

| Date | Version | Change | Author |
|---|---|---|---|
| Feb 2026 | 1.0 | Initial compliance matrix — Package 1 delivery | Apollo Engineering |

---

## 10. Package Delivery Record

| Package | Status | Verification | Tests | Limitations | Compliance Matrix Changes | Acceptance |
|---|---|---|---|---|---|---|
| **Package 1** | Implemented | Code inspection, documentation review | N/A (documentation) | Legal advisor not yet appointed; cross-border assessment pending | Initial matrix created | ✅ Accepted |
| **Package 2** | Implemented | Code inspection, automated tests, documentation review | 71 new + 50 existing = 121 tests passing | Vision preflight gap (P4); gateway audit (P3); cross-border (P7) | Unknown default fixed; authorisation matrix added; 4 gaps resolved | ✅ Accepted |
| **Package 3** | Implemented | Architectural scan, SDK-boundary tests, regression tests | 23 new gateway tests + 154 total passing | Full multimodal minimisation (P4) | Single gateway enforced; emergentintegrations removed; purpose mandatory; binary auth added | ✅ Accepted |
| **Package 4** | Implemented | Image pathway tests, consent tests, MIME enforcement, adversarial receipts, production path validation, regression | 49 acceptance + 28 consent = 77 new tests; 321 total passing | On-device screening is client-asserted; native build verification pending | G-01 closed; preflight removed; fail-closed redaction; strict byte digest; consent recorded; embedded images safeguarded; credential prohibition enforced via gateway | Requested |
| **Package 5** | Implemented | Structural validation tests, system prompt verification, evidence integrity | 33 new authority tests; 253 privacy/authority tests passing | Real Gemini integration tests deferred to Package 8 | Validation extended for ASSESS/DIRECT/GUIDE; fabricated observations rejected; empty instructions rejected; recommended action required; G-12 CLOSED | Requested |
| **Package 6** | Implemented | Code inspection, documentation | N/A (documentation + existing controls verified) | G-06 soft-delete, G-08 incident formalisation, G-09 admin MFA remain open | Encryption, access control, retention, key management, audit, incident response documented | Requested |
| **Package 7** | Implemented | Provider inspection, disclosure verification, documentation | N/A (governance + legal documentation) | G-04, G-05, G-07, G-10 require legal/formal action | AI inventory, risk register, provider terms, APP assessment, consent model, change governance; G-11 CLOSED | Requested |
| **Package 8** | Implemented | Full regression (344 tests), code inspection, functional verification | 253 backend + 90 frontend = 344 all passing | Client-assertion trust; visual-only credentials; native build needed | Production acceptance report; 12-point checklist all passing; no confirmed defects | Requested |
| Package 6 | Not started | — | — | — | — | — |
| Package 7 | Not started | — | — | — | — | — |
| Package 8 | Not started | — | — | — | — | — |
