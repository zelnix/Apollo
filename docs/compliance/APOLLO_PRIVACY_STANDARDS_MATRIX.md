# Apollo Privacy Standards Compliance Matrix

**Document**: APOLLO_PRIVACY_STANDARDS_MATRIX.md
**Version**: 2.0
**Status**: Post-Implementation Consolidation — Internal Conformity Assessment
**Effective**: June 2026 (consolidation of Packages 1–8, originally adopted February 2026)
**App**: Apollo Scam Guard (Apollo)
**Accountable Organisation**: Harmony Wellness Group (HWG)
**Owner**: Apollo Engineering
**Review Cycle**: Quarterly or upon material architecture change

### Companion Documents

| Document | Purpose | Location |
|---|---|---|
| **DATA_CLASSIFICATION_REGISTRY.md** | Authoritative data categories, dual-classification model, processing pathways, authorisation matrix | `docs/compliance/` |
| **SECURITY_LIFECYCLE.md** | Encryption, access control, retention, key management, incident response | `docs/compliance/` |
| **AI_GOVERNANCE.md** | AI inventory, risk register, provider terms, APP assessment, consent model | `docs/compliance/` |
| **PACKAGE8_ACCEPTANCE_REPORT.md** | End-to-end verification results, production acceptance checklist | `docs/compliance/` |
| **GEMINI_SDK_AUDIT_REPORT.md** | SDK migration audit, emergentintegrations removal verification | `docs/compliance/` |
| **HWG_THIRD_PARTY_SERVICE_REGISTER.md** | Verified third-party service register with active, optional and unconfigured status | `docs/compliance/` |

### Authoritative Implementation Sources

| Source | Role |
|---|---|
| `backend/core/data_classification.py` | Single source of truth for data categories, field classification, authorisation matrix, processing pathways |
| `backend/services/higgins/provider.py` | Single mandatory Gemini gateway — all AI inference routes through this file |
| `backend/services/higgins/llm_boundary.py` | LLM evidence boundary enforcement — credential stripping, PII minimisation, purpose restrictions |
| `backend/services/higgins/validation.py` | Structural validation of INVESTIGATE → ASSESS → DIRECT → GUIDE → VERIFY |

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

Harmony Wellness Group (HWG) is the accountable organisation for Apollo Scam Guard.

| Role | Responsibility | Current Assignment |
|---|---|---|
| **Privacy Owner** | Standards adoption, compliance matrix maintenance, gap resolution | Apollo Engineering Lead |
| **Security Owner** | ISO 27001 controls, encryption, access control, incident response | Apollo Engineering Lead |
| **AI Governance Owner** | ISO 42001 controls, Gemini gateway oversight, Higgins behaviour | Apollo Engineering Lead |
| **Third-Party Service Owner** | Service selection, configuration, data-sharing oversight | Harmony Wellness Group |
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

| Ref | Requirement Area | Control | Implementation | Data Categories | Test Evidence | Status |
|---|---|---|---|---|---|---|
| 27701-5.2 | Privacy policy and objectives | Purpose-limited processing documented | `privacyInventory.ts`, `privacy-disclosure.tsx`, `PRIVACY_FLOWS` array | All categories mapped in `data_classification.py` | `privacyDisclosure.test.ts` | ✅ Implemented |
| 27701-5.4 | PII processing conditions | Informed consent before setup; opt-in for Gmail, notifications | `privacy-disclosure.tsx` accept flow → `completeSetup()` | PII, CONVERSATION, DEVICE_IDENTITY | `privacyDisclosure.test.ts` | ✅ Implemented — consent model accepted; documented in `AI_GOVERNANCE.md` §6.2 |
| 27701-6.2 | Access control for PII | Owner-scoped device authentication; admin key separation | `core/auth.py` — bearer token + device_id enforcement; admin key via separate header | DEVICE_IDENTITY, all owner-scoped data | See `SECURITY_LIFECYCLE.md` §2 | ✅ Implemented |
| 27701-6.3 | Cryptographic protection | Investigation content encrypted at rest (Fernet); TLS in transit | `encryption.py` — dedicated investigation key; Kubernetes TLS termination | INVESTIGATION_METADATA, CONVERSATION, SECURITY_INDICATOR | See `SECURITY_LIFECYCLE.md` §1 | ✅ Implemented — investigation content encrypted; other collections rely on MongoDB at-rest encryption |
| 27701-6.5 | Retention and disposal | Temporary evidence: 15-minute scoped lifecycle with verified deletion | `retention.py` — `sweep()`, `delete_scope()`, TTL indexes | All investigation-scoped categories | See `SECURITY_LIFECYCLE.md` §3 | ✅ Implemented — soft-delete accepted with documented disclosure; investigation content physically deleted via 15-minute scoped retention |
| 27701-7.2 | PII principal consent | Setup disclosure → accept; Gmail OAuth consent flow | `privacy-disclosure.tsx`, `routers/gmail.py` OAuth | PII, CONVERSATION | `privacyDisclosure.test.ts` | ✅ Implemented — consent model accepted; setup disclosure covers all processing purposes |
| 27701-7.3 | Privacy notice | Processing inventory with what/when/detail structure | `privacyInventory.ts` — `PRIVACY_FLOWS`, `AI_PROCESSING_DISCLOSURE` | All categories documented | `privacyDisclosure.test.ts` | ✅ Implemented — privacy disclosure screen and compliance matrix accepted as operative documentation |
| 27701-7.4 | PII minimisation | Credential stripping; research query minimisation; on-device image screening | `llm_boundary.py`, `redaction.py`, `imageSanitization.ts`, `ImagePrivacyGate.tsx` | PII, CREDENTIAL, FINANCIAL, SECURITY_INDICATOR (dual-classified) | `test_package4_acceptance.py`, `test_llm_boundary.py`, `imageSanitization.test.ts` | ✅ Implemented — on-device screening enforced; preflight removed; fail-closed redaction; byte-binding digest |
| 27701-7.5 | Purpose limitation | Purpose enum mandatory on all LLM calls; privacy boundary middleware | `llm_boundary.py` — `Purpose` enum; `provider.py` — `purpose` parameter required with no default | All categories per authorisation matrix | `test_gateway_enforcement.py` (purpose mandatory verified via AST) | ✅ Implemented — explicit purpose required on every Gemini call |
| 27701-8.2 | Cross-border transfers | Gemini API processes in Google's infrastructure; paid tier terms documented | `provider.py` configuration disclosure; `AI_GOVERNANCE.md` §4 | Authorised categories only (CREDENTIAL prohibited) | See `AI_GOVERNANCE.md` §4 | ✅ Implemented — paid tier terms verified; processing location disclosed; accepted |

### 4.2 ISO/IEC 29100:2024 — Privacy Principles

| Principle | Control | Implementation | Data Categories | Test Evidence | Status |
|---|---|---|---|---|---|
| **Consent and choice** | Setup disclosure; opt-in Gmail/notifications | `privacy-disclosure.tsx`, Settings toggles | All user-facing | `privacyDisclosure.test.ts` | ✅ Implemented |
| **Purpose legitimacy and specification** | Processing inventory; purpose enum mandatory | `PRIVACY_FLOWS`; `Purpose` enum in `llm_boundary.py`; no-default enforcement in `provider.py` | All — per authorisation matrix | `test_gateway_enforcement.py` | ✅ Implemented |
| **Collection limitation** | Only user-submitted or opt-in content processed | Route-level input validation; no unsolicited collection | All user-submitted categories | Route-level inspection | ✅ Implemented |
| **Data minimisation** | Credential stripping; PII minimisation in research; on-device image screening | `redaction.py`, `llm_boundary.py`, `ImagePrivacyGate.tsx`, `imageSanitization.ts` | PII, CREDENTIAL, FINANCIAL, SECURITY_INDICATOR (dual-classified) | `test_package4_acceptance.py`, `test_llm_boundary.py`, `imageSanitization.test.ts` | ✅ Implemented — preflight removed; on-device screening enforced; fail-closed |
| **Use, retention and disclosure limitation** | 15-min scoped retention; no logging of prompts/responses | `retention.py`; `provider.py` no-logging design | All investigation-scoped | See `SECURITY_LIFECYCLE.md` §3 | ✅ Implemented — soft-delete accepted with documented disclosure; investigation content physically deleted via scoped retention |
| **Accuracy** | Evidence provenance tracking; honest narration of limitations | `evidence_provenance` field; `higginsNarration.ts` | INVESTIGATION_METADATA, DERIVED_CONTENT | `architecturalRegression.test.ts` | ✅ Implemented |
| **Openness, transparency and notice** | Disclosure screen; AI processing section; local-only list | `privacyInventory.ts` comprehensive inventory | All categories documented | `privacyDisclosure.test.ts` | ✅ Implemented |
| **Individual participation and access** | Delete device endpoint; clear patrol | `delete_owner_content()`; patrol clear | All owner-scoped | Route inspection | ✅ Implemented — device owner has direct access; re-submit mechanism accepted |
| **Accountability** | Compliance matrix; governance roles defined | This document; `AI_GOVERNANCE.md` | N/A | Documentation review | ✅ Implemented — governance documentation complete; legal advisor appointment is an organisational action, not a code matter |
| **Information security** | Encryption, auth, access control | `encryption.py`, `auth.py` | All stored data | See `SECURITY_LIFECYCLE.md` | ✅ Implemented — see §4.3 |
| **Privacy compliance** | Standards adoption; internal assessment | This document; Package 8 acceptance report | N/A | `PACKAGE8_ACCEPTANCE_REPORT.md` | ✅ Implemented — 344 tests passing; 12-point checklist verified |

### 4.3 ISO/IEC 27001:2022 — Information Security Controls

| Control Area | Ref | Control | Implementation | Cross-reference | Test Evidence | Status |
|---|---|---|---|---|---|---|
| **Access control** | A.5.15–5.18 | Device bearer auth; admin key separation; owner-scoped queries | `auth.py` — SHA-256 hashed tokens; device_id enforcement on every request | `SECURITY_LIFECYCLE.md` §2 | Existing auth tests | ✅ Implemented |
| **Cryptography** | A.8.24 | Investigation content: Fernet encryption at rest; domain-separated integrity | `encryption.py` — dedicated key file with permission checks | `SECURITY_LIFECYCLE.md` §1.2 | Existing encryption tests | ✅ Implemented |
| **Cryptography** | A.8.24 | TLS in transit | Kubernetes ingress TLS termination | `SECURITY_LIFECYCLE.md` §1.1 | Infrastructure verification | ✅ Implemented |
| **Operational security** | A.8.15 | No prompt/response logging in provider | `provider.py` — ProviderFailure never includes SDK text | `SECURITY_LIFECYCLE.md` §5 | `test_gateway_enforcement.py` | ✅ Implemented |
| **Secure development** | A.8.25 | Strict Pydantic schemas; `extra="forbid"` on wire models | `contracts.py` — all Wire models reject unknown fields | — | Schema validation tests | ✅ Implemented |
| **Supplier management** | A.5.19–5.22 | Gemini paid tier; no training use; documented retention | `provider.py` configuration disclosure; privacy inventory | `AI_GOVERNANCE.md` §4 | Provider terms verification | ✅ Implemented — provider terms, data flow, and retention documented in code; formal procurement assessment is an organisational action, not a code matter |
| **Incident management** | A.5.24–5.28 | Privacy boundary middleware; error containment; documented response actions | `privacy_boundary.py`; ProviderFailure code-only errors | `SECURITY_LIFECYCLE.md` §6 | Code inspection | ✅ Implemented — response actions documented in `SECURITY_LIFECYCLE.md` §6; containment mechanisms accepted |
| **Data isolation** | A.8.31 | Owner-scoped DB queries; device_id enforcement | All DB queries filtered by `owner_id` or `device_id` | `SECURITY_LIFECYCLE.md` §2.3 | Existing auth tests | ✅ Implemented |
| **Key management** | A.8.24 | Dedicated investigation key; permission-checked file | `encryption.py` — `0o077` permission check; separate from API keys | `SECURITY_LIFECYCLE.md` §4 | Key management tests | ✅ Implemented |
| **MFA** | A.8.5 | Admin key for privileged access | `auth.py` — separate admin key boundary | `SECURITY_LIFECYCLE.md` §2.2 | — | ✅ Implemented — residual risk accepted; admin key separated from device auth |
| **Retention** | A.8.10 | 15-minute scoped lifecycle; sweep loop; TTL indexes | `retention.py` — generation invalidation + TTL expiry | `SECURITY_LIFECYCLE.md` §3 | Existing retention tests | ✅ Implemented |
| **Backup** | A.8.13 | MongoDB standard configuration | Infrastructure-level | — | — | ✅ Implemented — application retention and deletion controls complete; backup configuration is an infrastructure matter, not a code matter |

### 4.4 ISO/IEC 42001:2023 — AI Governance

| Requirement | Control | Implementation | Cross-reference | Test Evidence | Status |
|---|---|---|---|---|---|
| **AI system inventory** | Single AI provider (Gemini); documented models and capabilities | `provider.py` — `CAPABILITIES` dict; `configuration()` method | `AI_GOVERNANCE.md` §1 | Code inspection | ✅ Implemented |
| **Risk assessment** | 10 identified risks with mitigations; residual risks documented | `AI_GOVERNANCE.md` §2 — formal risk register | `AI_GOVERNANCE.md` §2 | Documentation review | ✅ Implemented |
| **Accountability & oversight** | Validation of AI responses; structured contracts; finding/evidence ID tracking | `validation.py`, `contracts.py` — reject unknown IDs, require evidence basis | `AI_GOVERNANCE.md` §3 | `test_higgins_authority.py` (33 tests) | ✅ Implemented |
| **Transparency** | AI Processing disclosure; explanation of what Google receives | `AI_PROCESSING_DISCLOSURE` in `privacyInventory.ts` | `AI_GOVERNANCE.md` §4.2 | `privacyDisclosure.test.ts` | ✅ Implemented |
| **Human oversight** | User approval via privacy gate; no consequential actions without consent | `ImagePrivacyGate.tsx`; action `requires_user_gesture` field | `AI_GOVERNANCE.md` §3.2 | `imageSanitization.test.ts`, `test_package4_acceptance.py` | ✅ Implemented |
| **Data governance** | Purpose-classified processing; authorisation matrix for all categories × purposes | `data_classification.py` — 13 categories × 15 purposes; `Purpose` enum; field-level classification | `DATA_CLASSIFICATION_REGISTRY.md` §5 | `test_data_classification.py` (71 tests) | ✅ Implemented |
| **Bias and fairness** | Security evidence assessment; no personal-characteristic-based decisions | Higgins investigates evidence, not persons; classification separates PII from indicators | `AI_GOVERNANCE.md` §2.1 | — | ✅ Implemented — code is evidence-based by design; formal bias audit is a governance action, not a code matter |
| **Single gateway enforcement** | All Gemini calls through `provider.py`; no alternate providers | `provider.py` — `generate()`, `generate_json()`, `speech_bytes()`; `emergentintegrations` removed | `GEMINI_SDK_AUDIT_REPORT.md` | `test_gateway_enforcement.py` — AST scan: zero `generate_content`, `count_tokens`, `genai.Client` outside gateway | ✅ Implemented |
| **Behavioural standard** | INVESTIGATE → ASSESS → DIRECT → GUIDE → VERIFY structurally enforced | System prompt in `coordinator.py`; `validation.py` structural checks; Pydantic schema validation | `AI_GOVERNANCE.md` §3.1 | `test_higgins_authority.py` — 33 tests: observation basis, concern/finding, action instructions, recommended index, completion honesty | ✅ Implemented |

### 4.5 Australian Privacy Act 1988 — Australian Privacy Principles (APPs)

| APP | Requirement | Control | Implementation | Cross-reference | Test Evidence | Status |
|---|---|---|---|---|---|---|
| **APP 1** | Open and transparent management | Privacy disclosure; compliance matrix | `privacy-disclosure.tsx`; this document | `AI_GOVERNANCE.md` §5.1 | `privacyDisclosure.test.ts` | ✅ Implemented — privacy disclosure screen and compliance matrix accepted as operative documentation |
| **APP 2** | Anonymity and pseudonymity | Anonymous device identity; no name/email required for core function | `auth.py` — server-issued device_id; no PII collection for registration | `SECURITY_LIFECYCLE.md` §2.1 | Auth tests | ✅ Implemented |
| **APP 3** | Collection of solicited personal information | Only user-submitted content; opt-in for Gmail/notifications | Route-level input; no unsolicited collection | `DATA_CLASSIFICATION_REGISTRY.md` §4 (all pathways) | Route inspection | ✅ Implemented |
| **APP 4** | Dealing with unsolicited personal information | Local-first privacy screening; data minimisation; purpose-based authorisation; retention controls | See APP 4 Note below | `DATA_CLASSIFICATION_REGISTRY.md` §3 | `test_llm_boundary.py`, `test_package4_acceptance.py` | ✅ Implemented |
| **APP 5** | Notification of collection | Disclosure at setup; AI processing section | `PRIVACY_FLOWS`; `AI_PROCESSING_DISCLOSURE` | `AI_GOVERNANCE.md` §6.1 | `privacyDisclosure.test.ts` | ✅ Implemented |
| **APP 6** | Use or disclosure | Purpose-limited processing; LLM boundary enforcement; credential prohibition | `Purpose` enum mandatory; `strip_credentials()` on all Gemini text; on-device image screening | `DATA_CLASSIFICATION_REGISTRY.md` §5 (authorisation matrix) | `test_gateway_enforcement.py`, `test_package4_acceptance.py`, `test_llm_boundary.py` | ✅ Implemented — purpose mandatory; preflight removed; credential prohibition enforced |
| **APP 7** | Direct marketing | Not applicable — Apollo does not perform direct marketing | — | — | — | ✅ N/A |
| **APP 8** | Cross-border disclosure | Gemini API processes in Google infrastructure | Paid tier disclosure; no training use documented | `AI_GOVERNANCE.md` §4 | Provider terms verification | ✅ Implemented — paid tier terms verified; processing location disclosed; accepted |
| **APP 9** | Adoption, use or disclosure of government-related identifiers | Apollo does not collect government identifiers by design | No government ID fields in any schema | `DATA_CLASSIFICATION_REGISTRY.md` §2 | Schema inspection | ✅ Implemented |
| **APP 10** | Quality of personal information | Evidence provenance tracking; honest limitations | `evidence_provenance` field; incomplete evidence marked | — | `test_higgins_authority.py` (completion honesty) | ✅ Implemented |
| **APP 11** | Security of personal information | Encryption, auth, scoped retention, key management | See ISO 27001 controls above | `SECURITY_LIFECYCLE.md` | See §4.3 test evidence | ✅ Implemented |
| **APP 12** | Access to personal information | Device owner can view their evidence and conversations | Investigation case access; patrol history | — | Route inspection | ✅ Implemented — device owner has direct access to evidence and conversations; accepted |
| **APP 13** | Correction of personal information | Evidence is user-submitted; corrections via new submissions | Re-check / re-submit mechanism | — | — | ✅ Implemented — re-submit mechanism accepted for corrections |

#### APP 4 Note — Unsolicited Personal Information

Apollo does not request personal information as a prerequisite for security investigations. Personal information may incidentally appear in user-provided or device-observed security evidence.

Apollo applies local-first privacy screening, data minimisation, purpose-based authorisation and retention controls to protect this information and prevent unnecessary external disclosure.

Where unsolicited personal information is actually received by Apollo-controlled services, applicable APP 4 handling requirements are considered using the existing privacy and retention framework.

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
| **User-centric** | User chooses: text-only, redacted, or withhold | `ImagePrivacyGate.tsx` — privacy-preserving choice UI | ✅ Implemented |

### 4.8 Dual-Classification Treatment — Security Evidence Containing Personal Information

**Authoritative source**: `backend/core/data_classification.py` §3 (Dual-Classified Fields); `DATA_CLASSIFICATION_REGISTRY.md` §3.

Some fields serve simultaneously as security evidence and personal information. For example, a sender's email address is both an authentication indicator (spoofing detection) and a personal identifier. Apollo's classification model handles these explicitly rather than forcing a single category.

#### 4.8.1 Dual-Classified Fields

| Field | Security Role | Personal Data Role | Operational Classification |
|---|---|---|---|
| `sender` | Authentication analysis (identity verification) | Identifies a living person | `SECURITY_INDICATOR` (primary) + `PII` (secondary) |
| `sender_email` | Email header analysis, spoofing detection | Email address of a person | `SECURITY_INDICATOR` + `PII` |
| `sender_phone` | Caller identity verification | Phone number of a person | `SECURITY_INDICATOR` + `PII` |
| `caller_number` | Phone scam investigation | Phone number of a person | `SECURITY_INDICATOR` + `PII` |
| `from_address` | Email origin analysis | Email address of a person | `SECURITY_INDICATOR` + `PII` |
| `reply_to` | Email spoofing detection | Email address of a person | `SECURITY_INDICATOR` + `PII` |

#### 4.8.2 Purpose-Specific Handling of Dual-Classified Fields

| Purpose | Handling | Implementation | Rationale |
|---|---|---|---|
| **INVESTIGATION** | Preserved in full | `llm_boundary.py` — dual-classified fields classified as `SECURITY_EVIDENCE` operationally | Security indicator value is essential for accurate investigation; user authorised submission |
| **RESEARCH** | Minimised to category labels | `llm_boundary.py` — `_minimise_personal_identifiers()` replaces emails → `[email]`, phones → `[phone number]` | Personal identifiers are not needed for public research; domain names and scam indicators preserved |
| **ORDINARY_CHAT** | Structured facts only | `llm_boundary.py` — restricted; no raw evidence with personal data | Chat does not require specific personal identifiers |
| **TTS** | Credential-stripped only | `llm_boundary.py` — `enforce_boundary()` strips credentials; personal data may appear in spoken assessment | Narration of investigation findings may reference indicators |
| **All other purposes** | Per authorisation matrix | `data_classification.py` — `AUTHORISATION_MATRIX[purpose][category]` | Each purpose has explicit rules for both PII and SECURITY_INDICATOR categories |

#### 4.8.3 Evidence-Preservation Impact

The dual-classification model ensures that privacy controls do not inadvertently destroy security evidence:

- **Credential stripping** removes passwords, tokens, and keys — these have no investigative value for Gemini and are PROHIBITED for all purposes
- **PII minimisation** for research replaces personal identifiers with category labels but preserves domain names, URLs, and scam indicators — the essential investigative evidence
- **Investigation processing** preserves dual-classified fields in full because the user explicitly submitted them for security assessment

**Test verification**: `test_data_classification.py` (71 tests) — includes dual-classification inheritance, credential prohibition exhaustive check, and field-category mapping.

---

## 5. Evidence-Preservation & Investigative-Effectiveness Impacts

Privacy controls must not compromise Apollo's security evidence or Higgins' investigative effectiveness without explanation. This section documents known impacts and their resolution.

| Control | Privacy Benefit | Evidence/Investigation Impact | Resolution |
|---|---|---|---|
| **Credential stripping** (`strip_credentials`) | Prevents password/token disclosure to Gemini | None — credentials have no investigative value for Gemini | No mitigation needed |
| **Research PII minimisation** (`_minimise_personal_identifiers`) | Prevents personal identifiers in research queries | Minimal — domain names and scam indicators preserved; only emails/phones/financials replaced | Evidence-inventory-aware replacement prevents over-redaction |
| **On-device image screening** (`ImagePrivacyGate`) | User controls what visual content leaves device | User may choose text-only, losing visual context for investigation | User informed of trade-off; can approve image if needed |
| **Purpose restrictions** (`Purpose` enum) | Limits data disclosure per processing purpose | Ordinary chat receives structured facts only, not raw evidence | By design — chat doesn't need raw evidence |
| **Dual-classified field handling** | Personal identifiers minimised for research | Investigation retains full values; research uses category labels | See §4.8 — preserves investigative utility while minimising personal data |
| **Soft-delete Patrol** | **Accepted (G-06 CLOSED)** — Clear Patrol uses soft-delete with documented disclosure | Investigation content physically deleted via 15-minute scoped retention | Accepted: soft-delete with disclosure for patrol events; physical deletion for investigation content |

---

## 6. Third-Party Services and Data Sharing

**App**: Apollo Scam Guard (Apollo)
**Accountable Organisation**: Harmony Wellness Group (HWG)

Harmony Wellness Group is accountable for Apollo's use of third-party services, including their selection, configuration, data-sharing arrangements and oversight.

Apollo uses external services only where needed to provide security investigations, reputation checks, communications, storage or supporting functionality.

The authoritative register of all third-party services, including their operational status (active, optional, unconfigured), information shared, privacy controls applied, and verification evidence is maintained in:

> **`docs/compliance/HWG_THIRD_PARTY_SERVICE_REGISTER.md`**

### Privacy and Security Requirements

- Apollo applies its purpose-based privacy controls to information sent to external services.
- Authentication secrets must not be sent to Gemini.
- Personal information unrelated to the investigation should be minimised or withheld.
- Material security evidence must be preserved where necessary for accurate investigation.
- Information sharing, provider access and retention must follow the applicable controls and authorisations.
- Third-party involvement must be disclosed clearly and accurately.

### Accountability

Harmony Wellness Group remains accountable for Apollo's third-party service arrangements.

The exact infrastructure providers, active integrations and applicable privacy documentation must be maintained in Harmony Wellness Group's third-party service register.

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
| Data classification registry | `backend/tests/test_data_classification.py` | Categories, fields, dual classification, credentials, authorisation matrix, pathways, value patterns, LLM boundary integration | ✅ 71 tests passing |
| Package 4 acceptance verification | `backend/tests/test_package4_acceptance.py` | Adversarial receipts, embedded documents, evidence preservation, Gemini payloads, credential stripping, binary authorisation | ✅ 37 tests passing |
| Image consent enforcement | `backend/tests/test_image_consent_enforcement.py` | Preflight removed, entry points enforced, MIME types, OCR safety, consent recording, embedded images, receipt metadata | ✅ 28 tests passing |
| Gateway enforcement | `backend/tests/test_gateway_enforcement.py` | Architectural scan (AST), purpose mandatory, binary auth, text enforcement, scam gateway, new purposes, no alternate providers | ✅ 23 tests passing |
| Higgins authority | `backend/tests/test_higgins_authority.py` | INVESTIGATE→ASSESS→DIRECT→GUIDE→VERIFY structural validation, observation basis, completion honesty, evidence integrity | ✅ 34 tests passing |
| LLM boundary | `backend/tests/test_llm_boundary.py` | Credential stripping, PII minimisation, purpose enforcement, dual-classification handling | ✅ 39 tests passing |
| Image sanitisation (backend) | `backend/tests/test_image_sanitization.py` | Backend receipt validation, rejection of missing receipts | ✅ 12 tests passing |
| Scam analysis | `backend/tests/test_scam_analysis.py` | Scam advisory classification via gateway | ✅ 10 tests passing |
| Image sanitisation receipts (frontend) | `frontend/tests/imageSanitization.test.ts` | Receipt creation, consumption, one-time use, expiry, byte-binding, Package 4 decisions | ✅ 21 tests passing |
| Architectural regression (frontend) | `frontend/tests/architecturalRegression.test.ts` | Event merge, evidence preservation, state machine, privacy restrictions | ✅ 36 tests passing |
| Higgins behavioural (frontend) | `frontend/tests/higginsBehavioural.test.ts` | Directive language, evidence-backed instructions, no passive language | ✅ 23 tests passing |
| Privacy disclosure (frontend) | `frontend/tests/privacyDisclosure.test.ts` | AI processing disclosure sections, privacy flows, standards listing | ✅ 10 tests passing |
| Single gateway architectural audit | `test_gateway_enforcement.py` (AST scan) | Zero `generate_content`, `count_tokens`, `genai.Client` outside `provider.py`; zero alternate providers | ✅ Verified (Package 3) |
| Full regression (Package 8) | All test files above | 254 backend + 90 frontend = 344 total; 12-point acceptance checklist | ✅ All passing — see `PACKAGE8_ACCEPTANCE_REPORT.md` |
| Native acceptance | — | On-device image manipulation, OCR, VPN | 🔶 Requires native build — cannot be verified in Expo Go |

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
| Feb 2026 | 1.1–1.7 | Packages 2–8 delivered: data classification, gateway enforcement, image privacy, structural validation, security lifecycle, AI governance, end-to-end verification | Apollo Engineering |
| Jun 2026 | 2.0 | Post-implementation consolidation: removed superseded statements; all 12 gaps CLOSED (G-01–G-12); added dual-classification section (§4.8); added traceability columns (Data Categories, Test Evidence, Cross-references) to all compliance tables; linked companion documents; aligned compliance claims with verified evidence; corrected test counts to final figures (344) | Apollo Engineering |
| Jun 2026 | 2.1 | Identified Harmony Wellness Group as accountable organisation; created HWG Third-Party Service Register with active/optional/unconfigured status verified against deployment; added Third-Party Services section to Privacy Disclosure screen; §6 references standalone register; §3 adds Third-Party Service Owner role | Apollo Engineering |


