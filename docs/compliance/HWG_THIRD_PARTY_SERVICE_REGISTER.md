# HWG Third-Party Service Register

**Document**: HWG_THIRD_PARTY_SERVICE_REGISTER.md
**Version**: 1.0
**Status**: Active
**Effective**: June 2026
**Accountable Organisation**: Harmony Wellness Group (HWG)
**App**: Apollo Scam Guard (Apollo)
**Review Cycle**: Quarterly or upon service change

---

## 1. Purpose

Harmony Wellness Group is accountable for Apollo's use of third-party services, including their selection, configuration, data-sharing arrangements and oversight.

This register documents every external service that Apollo integrates with, the information potentially shared with each, the privacy controls applied, and the current operational status verified against the deployed configuration.

Apollo uses external services only where needed to provide security investigations, reputation checks, communications, storage or supporting functionality.

---

## 2. Service Status Definitions

| Status | Meaning |
|---|---|
| **Active** | Service is configured with valid credentials and operational |
| **Optional** | Service code exists; operates only when the user enables the relevant feature or the service requires no credentials |
| **Unconfigured** | Service integration exists in code but is not configured in the current deployment |

---

## 3. Third-Party Service Register

### 3.1 Active Services

| Service | Purpose | Information Potentially Shared | Privacy Controls Applied | Configuration Evidence |
|---|---|---|---|---|
| **Google Gemini** | Higgins AI investigations, explanations and research | Privacy-processed investigation evidence, approved content, security indicators and minimised research queries | Single gateway (`provider.py`); credential stripping; PII minimisation for research; purpose-based authorisation; binary content authorisation; no prompt/response logging | `GEMINI_API_KEY` configured; paid API tier; `google-genai` SDK |
| **Google Safe Browsing** | Detect known unsafe websites | Sanitised website addresses and domains | URL sanitisation removes credentials, fragments and secret query parameters before lookup | `SAFE_BROWSING_API_KEY` configured |
| **IPQualityScore** | Phone-number fraud and reputation checking | Phone number being checked | Only the phone number submitted for the specific check is transmitted | `IPQS_API_KEY` configured |
| **Expo Push Notifications, Google FCM and Apple APNs** | Deliver security and family alerts, where enabled | Push delivery tokens and notification content | Minimal notification content; delivery tokens managed by Expo relay | `EXPO_PUSH_ACCESS_TOKEN` configured; `EXPO_PUSH_ENABLED=true` |
| **Emergent-managed email delivery** | Send optional family invitations, guardian security alerts and related service emails | Recipient email address, subject and email content | Triggered by user-initiated actions (family invitations) and authorised automatic security alerts to confirmed family guardians | `EMERGENT_EMAIL_KEY` configured |
| **VirusTotal** | Email attachment malware scanning (hash-only mode) | SHA-256 file hashes only; file content is never sent to VirusTotal | Hash-only lookup; free tier rate-limited (4/minute); active when Gmail monitoring is connected | `VIRUSTOTAL_API_KEY` configured |
| **MongoDB (configured hosting provider)** | Store authorised application and investigation records | Records permitted by Apollo's storage and retention controls | Owner-scoped access control; Fernet encryption for investigation content; 15-minute scoped retention with automatic deletion; TTL indexes | `MONGO_URL` configured |

### 3.2 Optional Services

These services operate only when the user enables the relevant feature or when no credentials are required.

| Service | Purpose | Information Potentially Shared | Privacy Controls Applied | Activation Condition |
|---|---|---|---|---|
| **Google Gmail** | Optional read-only email checking | Google OAuth authorisation and access to email information within the approved read-only scope | Read-only OAuth scope; user must explicitly connect; disconnect removes stored OAuth connection; Apollo never asks for or stores mailbox credentials | User connects Gmail via OAuth in Settings |
| **XposedOrNot** | Check whether an email address appears in known data breaches | Email address submitted for the breach check | Only the email address submitted for the specific check; rate-limited; source attributed in UI | Free API; no credentials required; default breach provider when HIBP is unconfigured |
| **IANA / RDAP registry services** | Domain registration research | Domain lookup requests | Only the domain name being investigated | Public registries; no credentials required |
| **Public websites** | Investigation of submitted websites via web crawl | Requested website access | Only websites explicitly submitted by the user for investigation; URL sanitisation applied | Triggered by user-submitted URL investigation |

### 3.3 Unconfigured Services

These integrations exist in code but are not active in the current deployment. They will become operational when the relevant credentials are provided.

| Service | Purpose | Information Potentially Shared | Activation Requirement |
|---|---|---|---|
| **Have I Been Pwned (HIBP)** | Check whether an email address appears in known data breaches (replaces XposedOrNot when configured) | Email address submitted for the breach check | `HIBP_API_KEY` must be configured |
| **S3-compatible storage provider** | Store optional family shared content | Files and associated storage metadata | `FAMILY_STORAGE_BUCKET`, `FAMILY_STORAGE_ACCESS_KEY_ID` and `FAMILY_STORAGE_SECRET_ACCESS_KEY` must be configured |

---

## 4. Privacy and Security Requirements

All third-party services are subject to the following requirements:

- Apollo applies its purpose-based privacy controls to information sent to external services.
- Authentication secrets must not be sent to Gemini.
- Personal information unrelated to the investigation should be minimised or withheld.
- Material security evidence must be preserved where necessary for accurate investigation.
- Information sharing, provider access and retention must follow the applicable controls and authorisations.
- Third-party involvement must be disclosed clearly and accurately.

These requirements are enforced through the controls documented in the Apollo Privacy Standards Compliance Matrix and the referenced implementation files.

---

## 5. Accountability

Harmony Wellness Group remains accountable for Apollo's third-party service arrangements.

The exact infrastructure providers, active integrations and applicable privacy documentation must be maintained in this register.

### Changes to Third-Party Services and Integrations

Harmony Wellness Group (HWG) reserves the right to add, remove, replace, suspend or modify third-party service providers, cybersecurity intelligence sources, APIs, technology platforms and integrations used by Apollo Scam Guard.

Such changes may be made to improve security protection, investigative accuracy, service reliability, performance, privacy, functionality or cost efficiency, or to respond to changes in provider availability, technology or regulatory requirements.

All new or replacement integrations must remain subject to Apollo's applicable privacy, security, data classification, purpose limitation and information protection requirements.

HWG will maintain an up-to-date Third-Party Service Register identifying the services used, their purposes and the categories of information they may receive.

Where changes materially affect the handling, disclosure or protection of personal information, HWG will update the relevant privacy disclosures, notify users where required and obtain additional consent where legally necessary.

Routine changes that do not materially alter authorised data processing may be implemented without requiring individual user approval.

HWG retains responsibility and accountability for the selection, oversight and management of Apollo's third-party services and integrations.

### Review Triggers

This register must be reviewed and updated when:

- A new third-party service is integrated
- An existing service is activated, deactivated or replaced
- Service terms, data-sharing arrangements or privacy controls change materially
- The quarterly review cycle occurs

---

## 6. Verification

| Verification | Method | Last Verified |
|---|---|---|
| Active service credentials configured | Environment variable inspection | June 2026 |
| Unconfigured services confirmed inactive | Environment variable inspection | June 2026 |
| Privacy controls applied to each service | Code inspection and automated tests | June 2026 (344 tests passing) |
| Service register matches deployed configuration | Cross-reference `.env` against register | June 2026 |

---

## 7. Change Log

| Date | Version | Change | Author |
|---|---|---|---|
| Jun 2026 | 1.0 | Initial register created from verified deployment configuration | Apollo Engineering |
