# Apollo Data Classification Registry

**Document**: DATA_CLASSIFICATION_REGISTRY.md
**Version**: 1.0
**Status**: Package 2 Delivery
**Effective**: February 2026
**Authoritative Source**: `backend/core/data_classification.py`
**Owner**: Apollo Engineering

---

## 1. Purpose

This registry defines precisely what Apollo protects, what security evidence must remain available, and where information may be processed. It is the reference document for Package 2 — Personal Data Classification & Evidence Mapping.

The authoritative implementation is `backend/core/data_classification.py`. This document is its human-readable counterpart.

---

## 2. Data Categories

Every piece of information Apollo processes belongs to at least one category.

### 2.1 Protected Personal Information

| Category | Code | Description | Examples | Protection Level |
|---|---|---|---|---|
| **Personally Identifiable Information** | `PII` | Information capable of identifying a living person | Names, email addresses, contact details, government identifiers | RESTRICTED |
| **Medical & Health** | `MEDICAL` | Medical records, diagnoses, treatments | Prescriptions, genetic data, biometric identifiers | RESTRICTED |
| **Financial** | `FINANCIAL` | Banking, payment, financial records | Card numbers, BSB, transaction histories, account balances | RESTRICTED |
| **Location** | `LOCATION` | Precise or identifiable location data | GPS coordinates, home locations, movement histories | RESTRICTED |
| **Sensitive Personal** | `SENSITIVE_PERSONAL` | Other legally protected sensitive information | Personal beliefs, characteristics, relationships | RESTRICTED |
| **Authentication Secrets** | `CREDENTIAL` | Passwords, tokens, keys, codes | Passwords, PINs, OTPs, API keys, recovery phrases, session tokens | **PROHIBITED** |

### 2.2 Security Evidence

| Category | Code | Description | Examples | Protection Level |
|---|---|---|---|---|
| **Security Indicators** | `SECURITY_INDICATOR` | Observable security evidence | Domains, URLs, IPs, redirect chains, message wording, sender identities, certificates, file signatures | CONTROLLED |
| **Device Observations** | `DEVICE_OBSERVATION` | Device-originated enforcement evidence | Block records, packet evidence, connection observations, Apollo state | CONTROLLED |
| **Investigation Metadata** | `INVESTIGATION_METADATA` | Case management data | Case IDs, evidence IDs, timestamps, coverage, assessment outcomes, confidence | CONTROLLED |

### 2.3 Operational

| Category | Code | Description | Examples | Protection Level |
|---|---|---|---|---|
| **Device Identity** | `DEVICE_IDENTITY` | Device registration data (no PII by design) | Server-issued device_id, platform, app version, UTC offset | CONTROLLED |
| **Conversation** | `CONVERSATION` | User questions and Higgins responses | Chat history (may contain embedded PII from user input) | RESTRICTED |
| **Derived Content** | `DERIVED_CONTENT` | AI-generated assessments and explanations | Higgins assessments, research results, narrations, speech | CONTROLLED |

### 2.4 Default

| Category | Code | Description | Protection Level |
|---|---|---|---|
| **Unknown** | `UNKNOWN` | Unclassified data — **NEVER treated as unrestricted** | **RESTRICTED** |

### Critical Rule: Unknown Data Handling

> **Unknown data defaults to RESTRICTED.** It must be classified before external transmission. The previous implementation defaulted unknown fields to `SECURITY_EVIDENCE` (unrestricted) — this has been corrected in Package 2.

---

## 3. Dual-Classified Fields

Some fields serve as both security evidence and personal data. These require special handling: the security indicator value must be preserved for investigative effectiveness, but the personal data aspect requires purpose-appropriate controls.

| Field | Security Role | Personal Data Role | Handling |
|---|---|---|---|
| `sender` | Authentication analysis (is the sender who they claim?) | Identifies a person | Preserved for investigation; minimised for research |
| `sender_email` | Email header analysis, spoofing detection | Email address of a person | Preserved for investigation; minimised for research |
| `sender_phone` | Caller identity verification | Phone number of a person | Preserved for investigation; minimised for research |
| `caller_number` | Phone scam investigation | Phone number of a person | Preserved for investigation; minimised for research |
| `from_address` | Email origin analysis | Email address of a person | Preserved for investigation; minimised for research |
| `reply_to` | Email spoofing detection | Email address of a person | Preserved for investigation; minimised for research |

---

## 4. Processing Pathway Map

### 4.1 Overview Diagram

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Device     │────▶│   Backend    │────▶│   Gemini API     │     │ Third-Party     │
│  (Frontend)  │     │  (FastAPI)   │────▶│ (Single Gateway) │     │ Services        │
│              │     │              │     └──────────────────┘     │                 │
│ • Privacy    │     │ • Auth       │                              │ • Safe Browsing │
│   Gate       │     │ • Encryption │     ┌──────────────────┐     │ • IPQS          │
│ • Sanitize   │     │ • LLM Bound  │────▶│   MongoDB        │     │ • HIBP          │
│ • Receipt    │     │ • Retention  │     │  (Encrypted)     │     │ • Web Crawl     │
└─────────────┘     └──────────────┘     └──────────────────┘     │ • Gmail API     │
                                                                   │ • Push Relay    │
                                                                   └─────────────────┘
```

### 4.2 Detailed Processing Pathways

Each pathway documents: data categories present, transformations applied, prohibited disclosures, evidence preserved, and authorisation required.

---

#### PW-01: Message Analysis
| Attribute | Value |
|---|---|
| **Source** | Device (user taps "Check message") |
| **Destination** | Backend → Intel services → Optional Gemini |
| **Purpose** | INVESTIGATION |
| **Data Categories** | SECURITY_INDICATOR, PII, DERIVED_CONTENT, INVESTIGATION_METADATA |
| **Transformations** | URL secret redaction; password removal from text; credential stripping before Gemini |
| **Prohibited** | Passwords, PINs, OTPs in message text; URL auth tokens |
| **Evidence Preserved** | Domain names, URLs (sanitised), redirect chains, message wording, sender identity |
| **Authorisation** | User taps "Check message" (explicit submission) |
| **Implementation** | `routers/analysis.py`, `services/investigation.py`, `services/intel.py` |

---

#### PW-02: Screenshot Analysis (Message)
| Attribute | Value |
|---|---|
| **Source** | Device (privacy gate required) |
| **Destination** | Backend → Gemini Vision |
| **Purpose** | VISION_PREFLIGHT |
| **Data Categories** | SECURITY_INDICATOR, PII, CREDENTIAL, DERIVED_CONTENT |
| **Transformations** | On-device privacy gate screening; sanitisation receipt validation; image resize; credential stripping |
| **Prohibited** | Images without privacy gate approval; unredacted credentials |
| **Evidence Preserved** | Extracted text with security indicators; visual layout context |
| **Authorisation** | ImagePrivacyGate approval + sanitization_status='approved' |
| **Implementation** | `routers/analysis.py`, `ImagePrivacyGate.tsx`, `imageSanitization.ts` |

---

#### PW-03: Page Screenshot Analysis
| Attribute | Value |
|---|---|
| **Source** | Device (privacy gate required) |
| **Destination** | Backend → Gemini Vision |
| **Purpose** | VISION_PREFLIGHT |
| **Data Categories** | SECURITY_INDICATOR, PII, FINANCIAL, DERIVED_CONTENT |
| **Transformations** | Privacy gate screening; receipt validation; image resize; URL hint sanitisation |
| **Prohibited** | Images without privacy gate approval; visible credentials |
| **Evidence Preserved** | Page type, claimed brand, security signals, URL, form field types |
| **Authorisation** | ImagePrivacyGate approval + sanitization_status='approved' |
| **Implementation** | `routers/analysis.py` |

---

#### PW-04: Page Crawl Analysis
| Attribute | Value |
|---|---|
| **Source** | Device (user action) |
| **Destination** | Backend → Target URL → Gemini |
| **Purpose** | INVESTIGATION |
| **Data Categories** | SECURITY_INDICATOR, DERIVED_CONTENT |
| **Transformations** | URL sanitisation; SSRF protection; HTML extraction (text, forms — no field values); credential stripping |
| **Prohibited** | Internal/private network addresses; form field values |
| **Evidence Preserved** | Page title, visible text, form field types, button labels, link hostnames, final URL |
| **Authorisation** | User taps "Let Apollo read the page" |
| **Implementation** | `routers/analysis.py`, `services/webcrawl.py` |

---

#### PW-05: Link Investigation
| Attribute | Value |
|---|---|
| **Source** | Device (user submits link) |
| **Destination** | Backend → Intel services → Optional Gemini |
| **Purpose** | INVESTIGATION |
| **Data Categories** | SECURITY_INDICATOR, DERIVED_CONTENT |
| **Transformations** | URL secret redaction; credential stripping |
| **Prohibited** | URL authentication tokens; fragment identifiers |
| **Evidence Preserved** | Domain, host, verdict, threat types, redirect chain, final URL, domain info |
| **Authorisation** | User submits link for checking |
| **Implementation** | `routers/analysis.py`, `services/intel.py` |

---

#### PW-06: Investigation Case (Coordinator)
| Attribute | Value |
|---|---|
| **Source** | Device (user action via Gate) |
| **Destination** | Backend → Encrypted storage → Gemini (single gateway) |
| **Purpose** | INVESTIGATION |
| **Data Categories** | SECURITY_INDICATOR, PII, DEVICE_OBSERVATION, INVESTIGATION_METADATA, CONVERSATION, DERIVED_CONTENT |
| **Transformations** | Evidence encryption at rest (Fernet); credential stripping on system prompt and text; SDK Content text parts cleaned; research PII minimisation; response validation |
| **Prohibited** | Authentication secrets in Gemini payloads; unscoped evidence from other owners |
| **Evidence Preserved** | Full evidence with IDs, timestamps, provenance, coverage; source references; assessment outcomes; enforcement evidence with packet proof |
| **Authorisation** | Device authentication + owner-scoped case creation |
| **Implementation** | `routers/investigations.py`, `services/higgins/coordinator.py`, `provider.py`, `llm_boundary.py`, `tools.py`, `validation.py`, `encryption.py`, `retention.py` |

---

#### PW-07: Public Research
| Attribute | Value |
|---|---|
| **Source** | Investigation coordinator (tool call) |
| **Destination** | Backend → Gemini (with Google Search grounding) |
| **Purpose** | RESEARCH |
| **Data Categories** | SECURITY_INDICATOR, PII, DERIVED_CONTENT |
| **Transformations** | Evidence-inventory PII extraction and minimisation; personal identifiers → category labels; credential stripping |
| **Prohibited** | Personal emails, phones, account numbers; medical/financial/location; device identity |
| **Evidence Preserved** | Domain names, URLs, scam identifiers (essential for research effectiveness) |
| **Authorisation** | Investigation case authorisation (tool call within coordinator) |
| **Implementation** | `services/higgins/tools.py`, `llm_boundary.py`, `provider.py` |

---

#### PW-08: Text-to-Speech
| Attribute | Value |
|---|---|
| **Source** | Displayed Higgins response |
| **Destination** | Backend → Gemini TTS |
| **Purpose** | TTS |
| **Data Categories** | DERIVED_CONTENT, SECURITY_INDICATOR |
| **Transformations** | Credential stripping (enforce_boundary + validate_outbound_payload) |
| **Prohibited** | Credential material in spoken text |
| **Evidence Preserved** | Domain names and threat descriptions in speech |
| **Authorisation** | User taps read-aloud or enables automatic read-aloud |
| **Implementation** | `provider.py`, `routers/voice.py`, `llm_boundary.py` |

---

#### PW-09: Reputation Lookup
| Attribute | Value |
|---|---|
| **Source** | Analysis/investigation pipeline |
| **Destination** | Backend → Safe Browsing / IPQS / Blocklist |
| **Purpose** | REPUTATION_LOOKUP |
| **Data Categories** | SECURITY_INDICATOR |
| **Transformations** | URL sanitisation; cached reputation uses digest |
| **Prohibited** | Personal data beyond lookup target |
| **Evidence Preserved** | Verdict, threat types, coverage, source label |
| **Authorisation** | Part of user-initiated check |
| **Implementation** | `services/intel.py`, `services/phonerisk.py` |

---

#### PW-10: Breach Check
| Attribute | Value |
|---|---|
| **Source** | Device (user-submitted email) |
| **Destination** | Backend → HIBP / XposedOrNot |
| **Purpose** | BREACH_CHECK |
| **Data Categories** | PII, SECURITY_INDICATOR |
| **Transformations** | Email lowercased and trimmed; forwarded once, never stored |
| **Prohibited** | Any data beyond the email address; device identity |
| **Evidence Preserved** | Breach names, dates, data classes, password exposure |
| **Authorisation** | User explicitly submits email for breach check |
| **Implementation** | `routers/analysis.py`, `services/breach_check.py` |

---

#### PW-11: Family Alert Sharing
| Attribute | Value |
|---|---|
| **Source** | Patrol events (automatic for paired devices) |
| **Destination** | Backend → Paired guardian devices |
| **Purpose** | FAMILY_SHARING |
| **Data Categories** | SECURITY_INDICATOR, DEVICE_OBSERVATION, DEVICE_IDENTITY, PII |
| **Transformations** | Minimal alert: category, state, domain only; no raw text/numbers/evidence |
| **Prohibited** | Raw message text; caller numbers; full evidence or investigation details |
| **Evidence Preserved** | Event category, state, indicator domain, timestamps |
| **Authorisation** | User pairs with guardian (explicit opt-in) |
| **Implementation** | `routers/family.py`, `routers/push.py` |

---

#### PW-12: Voice Transcription
| Attribute | Value |
|---|---|
| **Source** | Family voice note (user-recorded) |
| **Destination** | Backend → S3 storage → Gemini transcription |
| **Purpose** | TRANSCRIPTION |
| **Data Categories** | CONVERSATION, PII |
| **Transformations** | Secret redaction on transcribed text; link generation check |
| **Prohibited** | Passwords or codes spoken in recording |
| **Evidence Preserved** | Transcript text (redacted), language |
| **Authorisation** | User explicitly records and sends voice note |
| **Implementation** | `services/transcribe.py`, `routers/family.py` |

---

#### PW-13: Gmail Investigation
| Attribute | Value |
|---|---|
| **Source** | User OAuth consent |
| **Destination** | Backend → Gmail API (read-only) → Investigation pipeline |
| **Purpose** | INVESTIGATION |
| **Data Categories** | PII, SECURITY_INDICATOR, CONVERSATION |
| **Transformations** | OAuth-scoped read-only; raw content not copied to Patrol; credential stripping |
| **Prohibited** | Gmail username/password (OAuth only); raw email content beyond scope |
| **Evidence Preserved** | Email headers, sender, subject; links and attachments via investigation pipeline |
| **Authorisation** | User connects Gmail with Google OAuth (explicit opt-in) |
| **Implementation** | `routers/gmail.py`, `services/gmail.py`, `services/mailbox_monitor.py` |

---

#### PW-14: Device Registration & Heartbeat
| Attribute | Value |
|---|---|
| **Source** | Device (automatic) |
| **Destination** | Backend → MongoDB |
| **Purpose** | DEVICE_REGISTRATION |
| **Data Categories** | DEVICE_IDENTITY |
| **Transformations** | Server-issued random device_id; bearer token SHA-256 hash only |
| **Prohibited** | Raw bearer tokens; personal information (not collected) |
| **Evidence Preserved** | Platform, app version, UTC offset, registration timestamp |
| **Authorisation** | App installation (implicit) |
| **Implementation** | `routers/devices.py`, `core/auth.py` |

---

#### PW-15: Patrol Event Recording
| Attribute | Value |
|---|---|
| **Source** | Device (automatic after checks) |
| **Destination** | Backend → MongoDB |
| **Purpose** | INVESTIGATION |
| **Data Categories** | SECURITY_INDICATOR, DEVICE_OBSERVATION, INVESTIGATION_METADATA |
| **Transformations** | No caller numbers, app attribution, or raw narratives; enforcement evidence fingerprinting |
| **Prohibited** | Caller phone numbers; raw message content; app/process attribution |
| **Evidence Preserved** | Category, state, timestamps, event IDs, indicator host, enforcement evidence |
| **Authorisation** | Device authentication (bearer token) |
| **Implementation** | `routers/patrol.py`, `services/patrol_records.py` |

---

## 5. Authorisation Matrix Summary

For each processing purpose, this table shows whether each data category is Permitted (P), Controlled (C), Restricted (R), or Prohibited (X).

| Category | Investigation | Chat | Research | TTS | Vision | Reputation | Breach | Family |
|---|---|---|---|---|---|---|---|---|
| **PII** | C | R | C | C | R | C | C | C |
| **Medical** | R | X | X | R | R | X | X | X |
| **Financial** | C | X | C | R | R | X | X | X |
| **Location** | R | X | X | R | R | X | X | X |
| **Sensitive** | R | X | X | R | R | X | X | X |
| **Credential** | **X** | **X** | **X** | **X** | **X** | **X** | **X** | **X** |
| **Security Ind.** | P | C | P | P | P | P | C | C |
| **Device Obs.** | P | C | R | C | C | X | X | C |
| **Inv. Metadata** | P | R | R | R | R | X | X | R |
| **Device ID** | C | C | X | X | X | X | X | C |
| **Conversation** | C | C | X | C | R | X | X | C |
| **Derived** | P | P | C | P | C | X | X | C |
| **Unknown** | R | R | R | R | R | X | X | X |

**Key**: P=Permitted, C=Controlled, R=Restricted (requires authorisation), X=Prohibited

---

## 6. Evidence-Preservation Requirements

### 6.1 Security Evidence That MUST Be Preserved

| Evidence Type | Why | Where Preserved |
|---|---|---|
| Domain names, URLs, IP addresses | Essential for threat identification | Investigation cases, patrol events, research results |
| Redirect chains | Reveals obfuscation and phishing infrastructure | Investigation sources, link assessments |
| TLS certificates | Identifies impersonation and MITM | Investigation evidence |
| Message wording relevant to threat | Distinguishes phishing from legitimate communication | Investigation evidence (encrypted) |
| Sender identities | Authentication analysis, spoofing detection | Investigation evidence (dual-classified) |
| App identities and permissions | Malicious app detection | Investigation evidence |
| File signatures and hashes | Malware detection | Investigation evidence |
| Device enforcement actions | Proof of protection (Biting state) | Patrol events, enforcement evidence |
| Packet evidence | Verifiable network-level observation | Patrol events |
| Timestamps and provenance | Evidence chain integrity | All evidence items |
| Assessment outcomes and confidence | Honest uncertainty disclosure | Investigation responses |

### 6.2 Evidence Integrity Rules

1. **Never fabricate evidence.** Higgins cannot invent device observations, completed actions, or confirmed enforcement.
2. **Never substitute generic summaries.** Original evidence with IDs, timestamps, and provenance must be retained.
3. **Never infer completeness from populated text.** Coverage tracking must reflect actual examination.
4. **Preserve original evidence on the originating device** where possible.
5. **Privacy processing must not suppress security indicators** unless they are also credential material.
6. **Material limitations must be disclosed.** If evidence is unavailable or restricted, say so.

---

## 7. Integration with LLM Boundary

The `data_classification.py` module is the single authoritative source. The existing `llm_boundary.py` has been updated to:

1. **Import and use** `data_classification.FIELD_CATEGORIES` for field classification
2. **Derive** `SECURITY_FIELDS` and `PERSONAL_DATA_FIELDS` from the authoritative registry
3. **Default unknown fields to RESTRICTED** (previously defaulted to SECURITY_EVIDENCE)
4. **Map** the fine-grained `DataCategory` enum to the backward-compatible `Classification` enum

This ensures a single point of truth: any change to `data_classification.py` automatically propagates to the LLM boundary enforcement.

---

## 8. Compliance Matrix Updates

| Gap ID | Standard | Resolution | Status |
|---|---|---|---|
| (new) | ISO 27701-7.4 | Unknown data now defaults to RESTRICTED, not unrestricted | ✅ Fixed |
| (new) | ISO 29100 Data Minimisation | Complete authorisation matrix for all purposes × categories | ✅ Implemented |
| (new) | ISO 27559 De-identification | Classification-aware PII detection and minimisation | ✅ Implemented |
| (new) | APP 6 Use or Disclosure | Every pathway has defined data categories and prohibited disclosures | ✅ Implemented |

---

## 9. Test Evidence

| Test File | Tests | Status |
|---|---|---|
| `backend/tests/test_data_classification.py` | 71 tests covering categories, fields, dual classification, credential prohibition, authorisation matrix, pathways, value patterns, LLM boundary integration | ✅ All passing |
| `backend/tests/test_llm_boundary.py` | 38 tests (existing) — no regressions | ✅ All passing |
| `backend/tests/test_image_sanitization.py` | 12 tests (existing) — no regressions | ✅ All passing |

---

## Package Delivery Record

| Item | Value |
|---|---|
| **Implemented** | `backend/core/data_classification.py` (authoritative registry), `llm_boundary.py` (updated integration), `DATA_CLASSIFICATION_REGISTRY.md` (documentation), Compliance Matrix updated |
| **Verification performed** | 71 new tests + 50 existing tests = 121 tests passing |
| **Tests passed/failed** | 121/0 |
| **Remaining limitations** | Vision preflight gap (Package 4); single gateway audit pending (Package 3); formal cross-border assessment pending (Package 7) |
| **Compliance Matrix changes** | Updated Package 2 status; 4 gaps resolved |
| **Acceptance requested** | Yes |
