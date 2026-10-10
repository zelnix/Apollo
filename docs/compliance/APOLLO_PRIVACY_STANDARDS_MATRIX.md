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

## 3. Governance and Accountability

**Accountable Organisation**: Harmony Wellness Group (HWG)

Harmony Wellness Group is responsible for Apollo's overall privacy, cybersecurity, information security, AI governance, regulatory obligations and third-party service arrangements.

Apollo Scam Guard is responsible for implementing and enforcing the applicable technical controls within the application and its supporting services.

Application compliance is assessed against functionality, security controls, privacy protections and verifiable implementation evidence.

Organisational, legal, contractual and governance responsibilities remain under Harmony Wellness Group's accountability and are not presented as application feature requirements unless they require technical implementation.

### 3.1 Compliance Assessment Framework

Apollo maintains two distinct compliance records:

- **Apollo Application Technical Compliance** — controls the software implements, with evidence and a pass/fail or N/A assessment.
- **Apollo Operational & Legal Compliance** — contracts, privacy-law applicability, supplier assurance, policies, appointments and external infrastructure responsibilities.

These are cross-referenced but neither prevents the other from being completed.

> **Assessment Rule**: If a requirement can be implemented, enforced and verified through Apollo's software, it belongs to the application's technical compliance assessment. If a requirement involves contracts, legal determinations, organisational appointments, independent assessments or external infrastructure, it belongs to the operational compliance assessment.

Each requirement is assessed independently on three dimensions:

| Assessment | Available Statuses |
|---|---|
| **Applicability to Apollo** | Applicable / Not applicable |
| **Application implementation** | ✅ Implemented / ⚠️ Partially implemented / ❌ Not implemented / — N/A |
| **Operational or legal assurance** | ✅ Completed / ⚠️ Outstanding / — N/A |

Passing code tests establishes application technical compliance. It does not automatically establish full ISO management-system conformity or compliance with every Australian Privacy Principle. ISO/IEC 27701 and ISO/IEC 42001 are management-system standards addressing organisational governance as well as technical controls.

### 3.2 Governance Roles

| Role | Responsibility | Current Assignment |
|---|---|---|
| **Privacy Owner** | Standards adoption, compliance matrix maintenance | Apollo Engineering Lead |
| **Security Owner** | ISO 27001 controls, encryption, access control, incident response | Apollo Engineering Lead |
| **AI Governance Owner** | ISO 42001 controls, Gemini gateway oversight, Higgins behaviour | Apollo Engineering Lead |
| **Third-Party Service Owner** | Service selection, configuration, data-sharing oversight | Harmony Wellness Group |
| **Legal Advisor** | Privacy Act compliance, APP assessment, cross-border obligations | To be appointed / external review required |
| **Data Protection Contact** | User enquiries, access requests, complaint handling | To be defined |

### 3.3 Governance Approvals Required

| Decision | Approver | Status |
|---|---|---|
| Standards adoption scope | Privacy Owner | Approved (this document) |
| New external data processing pathway | Privacy Owner + Security Owner | Required per Package 3 |
| Gemini model or provider change | AI Governance Owner | Required per Package 7 |
| Cross-border data transfer assessment | Legal Advisor | Outstanding — requires appointment |
| Independent certification decision | All owners | Not yet scheduled |

---

## 4. Compliance Matrix — Requirements to Controls

Each requirement is assessed on three independent dimensions as defined in §3.1.

### 4.1 ISO/IEC 27701:2025 — Privacy Information Management (PIMS)

| Ref | Requirement | Applicability | App Control | Operational Assurance |
|---|---|---|---|---|
| 27701-5.2 | Privacy policy and objectives | Applicable | ✅ Implemented — purpose-limited processing documented in `privacyInventory.ts` and `privacy-disclosure.tsx` | — N/A |
| 27701-5.4 | PII processing conditions | Applicable | ✅ Implemented — informed consent before setup; opt-in for Gmail, notifications | ⚠️ Outstanding — consent format standardisation is a legal/product decision |
| 27701-6.2 | Access control for PII | Applicable | ✅ Implemented — owner-scoped device auth; admin key separation | — N/A |
| 27701-6.3 | Cryptographic protection | Applicable | ✅ Implemented — Fernet encryption at rest; TLS in transit | — N/A |
| 27701-6.5 | Retention and disposal | Applicable | ✅ Implemented — 15-minute scoped lifecycle; sweep and TTL deletion | — N/A |
| 27701-7.2 | PII principal consent | Applicable | ✅ Implemented — setup disclosure; Gmail OAuth consent | ⚠️ Outstanding — granular per-purpose consent is a product/legal decision |
| 27701-7.3 | Privacy notice | Applicable | ✅ Implemented — processing inventory with what/when/detail structure | ⚠️ Outstanding — legal adequacy review of notice wording |
| 27701-7.4 | PII minimisation | Applicable | ✅ Implemented — credential stripping; research minimisation; on-device image screening; fail-closed redaction | — N/A |
| 27701-7.5 | Purpose limitation | Applicable | ✅ Implemented — purpose enum mandatory on every Gemini call; no default | — N/A |
| 27701-8.2 | Cross-border transfers | Applicable | ✅ Implemented — minimisation applied; credential prohibition enforced; paid tier terms documented | ⚠️ Outstanding — formal cross-border transfer assessment requires legal advisor |

### 4.2 ISO/IEC 29100:2024 — Privacy Principles

| Principle | Applicability | App Control | Operational Assurance |
|---|---|---|---|
| **Consent and choice** | Applicable | ✅ Implemented — setup disclosure; opt-in Gmail/notifications | — N/A |
| **Purpose legitimacy and specification** | Applicable | ✅ Implemented — processing inventory; purpose enum mandatory | — N/A |
| **Collection limitation** | Applicable | ✅ Implemented — only user-submitted or opt-in content | — N/A |
| **Data minimisation** | Applicable | ✅ Implemented — credential stripping; PII minimisation; on-device screening; fail-closed | — N/A |
| **Use, retention and disclosure limitation** | Applicable | ✅ Implemented — 15-min scoped retention; no prompt/response logging | — N/A |
| **Accuracy** | Applicable | ✅ Implemented — evidence provenance; honest limitation narration | — N/A |
| **Openness, transparency and notice** | Applicable | ✅ Implemented — disclosure screen; AI processing section; third-party services | — N/A |
| **Individual participation and access** | Applicable | ✅ Implemented — delete endpoint; clear patrol; device owner access | ⚠️ Outstanding — formal SAR procedure is an organisational responsibility |
| **Accountability** | Applicable | ✅ Implemented — compliance matrix; governance documentation; audit evidence | ⚠️ Outstanding — legal advisor appointment is an organisational responsibility |
| **Information security** | Applicable | ✅ Implemented — see §4.3 | — N/A |
| **Privacy compliance** | Applicable | ✅ Implemented — 344 tests passing; 12-point acceptance checklist | — N/A |

### 4.3 ISO/IEC 27001:2022 — Information Security Controls

| Control Area | Ref | Applicability | App Control | Operational Assurance |
|---|---|---|---|---|
| **Access control** | A.5.15–5.18 | Applicable | ✅ Implemented — device bearer auth; admin key separation; owner-scoped queries | — N/A |
| **Cryptography (at rest)** | A.8.24 | Applicable | ✅ Implemented — Fernet encryption; dedicated investigation key; permission checks | — N/A |
| **Cryptography (in transit)** | A.8.24 | Applicable | ✅ Implemented — Kubernetes TLS termination | — N/A |
| **Operational security** | A.8.15 | Applicable | ✅ Implemented — no prompt/response logging in provider | — N/A |
| **Secure development** | A.8.25 | Applicable | ✅ Implemented — strict Pydantic schemas; `extra="forbid"` on wire models | — N/A |
| **Supplier management** | A.5.19–5.22 | Applicable | ✅ Implemented — audited gateway restricts all Gemini access; provider terms documented | ⚠️ Outstanding — formal supplier/procurement assessment is an organisational responsibility |
| **Incident management** | A.5.24–5.28 | Applicable | ✅ Implemented — privacy boundary middleware; error containment; evidence-safe error responses | ⚠️ Outstanding — formal incident procedure, breach notification and responsibility assignment are organisational |
| **Data isolation** | A.8.31 | Applicable | ✅ Implemented — owner-scoped DB queries; device_id enforcement | — N/A |
| **Key management** | A.8.24 | Applicable | ✅ Implemented — dedicated investigation key; permission-checked file; separate from API keys | — N/A |
| **Secure authentication** | A.8.5 | See note below | See note below | See note below |
| **Retention** | A.8.10 | Applicable | ✅ Implemented — 15-minute scoped lifecycle; sweep loop; TTL indexes | — N/A |
| **Backup** | A.8.13 | Applicable | ✅ Implemented — recovery-compatible data structures; deletion controls | ⚠️ Outstanding — infrastructure backup configuration and verification are operational responsibilities |

#### A.8.5 Note — Secure Authentication Assessment

ISO/IEC 27001:2022 A.8.5 concerns secure authentication, not a blanket requirement for end-user MFA. Apollo is assessed on its actual authentication model:

| Authentication Area | Apollo's Position | Applicability | App Control |
|---|---|---|---|
| End-user account login | Apollo does not require user accounts | Not applicable | — N/A |
| Device-to-backend authentication | Device credentials and bearer tokens | Applicable | ✅ Implemented — SHA-256 hashed tokens; device_id enforcement |
| Administrative backend access | Separate administrative API key | Applicable | ✅ Implemented — admin key separated from device auth |

Whether additional authentication is appropriate for privileged administrative access remains a separate security decision. It does not justify introducing user accounts into Apollo.

### 4.4 ISO/IEC 42001:2023 — AI Governance

| Requirement | Applicability | App Control | Operational Assurance |
|---|---|---|---|
| **AI system inventory** | Applicable | ✅ Implemented — single provider documented; capabilities and models listed | — N/A |
| **Risk assessment** | Applicable | ✅ Implemented — 10 identified risks with mitigations documented | — N/A |
| **Accountability & oversight** | Applicable | ✅ Implemented — response validation; structured contracts; evidence ID tracking | — N/A |
| **Transparency** | Applicable | ✅ Implemented — AI processing disclosure; explanation of what Google receives | — N/A |
| **Human oversight** | Applicable | ✅ Implemented — user approval via privacy gate; no consequential actions without consent | — N/A |
| **Data governance** | Applicable | ✅ Implemented — 13 categories × 15 purposes; field-level classification; authorisation matrix | — N/A |
| **Bias and fairness** | Applicable | ✅ Implemented — evidence-based decisions; classification separates PII from indicators | ⚠️ Outstanding — formal bias assessment and periodic outcome review are organisational responsibilities |
| **Single gateway enforcement** | Applicable | ✅ Implemented — AST-verified: zero Gemini calls outside `provider.py`; emergentintegrations removed | — N/A |
| **Behavioural standard** | Applicable | ✅ Implemented — INVESTIGATE → ASSESS → DIRECT → GUIDE → VERIFY structurally enforced; 33 tests | — N/A |

### 4.5 Australian Privacy Act 1988 — Australian Privacy Principles (APPs)

The APPs address responsibilities of covered entities, not just software functionality. Apollo implements the technical controls it can deliver. Organisational obligations under the APPs remain under HWG's accountability.

| APP | Requirement | Applicability | App Control | Operational Assurance |
|---|---|---|---|---|
| **APP 1** | Open and transparent management | Applicable | ✅ Implemented — privacy disclosure screen; compliance matrix; third-party register | ⚠️ Outstanding — formal privacy policy document is a legal responsibility |
| **APP 2** | Anonymity and pseudonymity | Applicable | ✅ Implemented — anonymous device identity; no name/email required | — N/A |
| **APP 3** | Collection of solicited personal information | Applicable | ✅ Implemented — only user-submitted content; opt-in features | — N/A |
| **APP 4** | Dealing with unsolicited personal information | Applicable | ✅ Implemented — see APP 4 Note below | ⚠️ Outstanding — if unsolicited personal information is actually received by Apollo-controlled services, applicable handling obligations depend on legal determination |
| **APP 5** | Notification of collection | Applicable | ✅ Implemented — disclosure at setup; AI processing section; third-party services | — N/A |
| **APP 6** | Use or disclosure | Applicable | ✅ Implemented — purpose-limited; credential prohibition; on-device screening | — N/A |
| **APP 7** | Direct marketing | Not applicable | — N/A | — N/A |
| **APP 8** | Cross-border disclosure | Applicable | ✅ Implemented — minimisation applied; credential prohibition; processing location disclosed | ⚠️ Outstanding — overseas processing assessment and applicable legal obligations require legal advisor |
| **APP 9** | Government-related identifiers | Not applicable | — N/A — Apollo does not collect government identifiers | — N/A |
| **APP 10** | Quality of personal information | Applicable | ✅ Implemented — evidence provenance; honest limitation narration | — N/A |
| **APP 11** | Security of personal information | Applicable | ✅ Implemented — see §4.3 information security controls | — N/A |
| **APP 12** | Access to personal information | Applicable | ✅ Implemented — device owner can view evidence and conversations | ⚠️ Outstanding — formal access request procedure and identity verification are organisational responsibilities |
| **APP 13** | Correction of personal information | Applicable | ✅ Implemented — re-submit mechanism; evidence corrections via new submissions | ⚠️ Outstanding — formal correction procedure and applicable exceptions are organisational responsibilities |

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

### Changes to Third-Party Services and Integrations

Harmony Wellness Group (HWG) reserves the right to add, remove, replace, suspend or modify third-party service providers, cybersecurity intelligence sources, APIs, technology platforms and integrations used by Apollo Scam Guard.

Such changes may be made to improve security protection, investigative accuracy, service reliability, performance, privacy, functionality or cost efficiency, or to respond to changes in provider availability, technology or regulatory requirements.

All new or replacement integrations must remain subject to Apollo's applicable privacy, security, data classification, purpose limitation and information protection requirements.

HWG will maintain an up-to-date Third-Party Service Register identifying the services used, their purposes and the categories of information they may receive.

Where changes materially affect the handling, disclosure or protection of personal information, HWG will update the relevant privacy disclosures, notify users where required and obtain additional consent where legally necessary.

Routine changes that do not materially alter authorised data processing may be implemented without requiring individual user approval.

HWG retains responsibility and accountability for the selection, oversight and management of Apollo's third-party services and integrations.

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
| Jun 2026 | 3.0 | Structural separation of application technical compliance from operational/legal assurance. Three-column assessment model (Applicability, App Control, Operational Assurance) applied to all §4 tables. MFA restructured as three-situation authentication assessment. Changes to Third-Party Services clause added to matrix, register and privacy screen. Governance updated with HWG accountability framework. | Apollo Engineering |


