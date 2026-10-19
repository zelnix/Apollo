# Duplication Cleanup — Consolidation Report

**Date**: October 2026  
**Status**: COMPLETE  

---

## Phase 1: Privacy Policy Consolidation ✅

**Created**: `src/domain/privacyPolicy.ts`

ONE canonical source for classification rules. All pattern definitions moved here:
- `CREDENTIAL_PATTERNS` — mandatory redaction (passwords, PINs, OTPs, tokens, keys, seeds)
- `FINANCIAL_MEDICAL_PATTERNS` — strongly protected
- `PHONE_PATTERN`, `EMAIL_PATTERN` — context-dependent
- `SENDER_CONTEXT_PATTERNS` — investigation-subject detection
- `SANITISATION_EGRESS_FIELDS` — approved egress metadata fields
- `ScreeningContext` type — shared context contract

**Updated**: `imagePrivacyCore.ts` now imports all patterns from `privacyPolicy.ts`. No separate regex sets maintained.

---

## Phase 2: Protection State Resolver ✅

**Created**: `src/domain/gateRegistry.ts`

ONE canonical registry for gate metadata:
- Gate ID, user-facing name, purpose, category, checkResultGate, defaultCheckType
- `gateName()` and `gatePurpose()` lookup functions
- `ALL_GATE_IDS` ordered list

**Updated**:
- `gates.ts` — removed `TITLE` and `PURPOSE` maps → imports from `gateRegistry`
- `homeStatusResolver.ts` — removed `GATE_LABEL` map → imports `gateName()` from `gateRegistry`

**Bug Fixed**: Manual-only capability no longer becomes `active_verified`/Watching. A manual-only capability whose internal state says "running" is now correctly mapped to `setup_available`. One shared rule decides this.

---

## Phase 3: Shared Check Result Framework ✅

**Created**: `src/domain/checkResultFramework.ts`

ONE implementation of:
- `toneForState(state)` — maps ApolloState to tone (removed from 8 adapters)
- `buildEvidenceRows(pairs)` — from label/value pairs
- `buildEvidenceRowsFromTechnical(strings)` — from "Label: value" strings
- `appendEventContext(evidence, opts)` — scenario/event ID
- `buildCheckResult(input)` — shared result construction with CheckResultInput contract

**Updated adapters** (all import from `checkResultFramework`):
- `linkCheckResultAdapter.ts` — removed local `toneForState`
- `callCheckResultAdapter.ts` — removed local `toneForState`
- `emailCheckResultAdapter.ts` — removed local `toneForState`
- `messageCheckResultAdapter.ts` — removed local `toneForState`
- `appCheckResultAdapter.ts` — removed local `toneForState`
- `fileCheckResultAdapter.ts` — removed local `toneForState`
- `networkCheckResultAdapter.ts` — removed local `toneForState`
- `accountCheckResultAdapter.ts` — removed local `toneForState`

---

## Phase 4: Evidence Row Formatting ✅

**Created**: `buildEvidenceRows()` and `buildEvidenceRowsFromTechnical()` in `checkResultFramework.ts`

ONE utility for converting label/value pairs and technical strings into evidence rows. `appendEventContext()` handles scenario/event ID appending.

---

## Phase 5: Call Result Framework ✅

**Updated**:
- `callCheckResultAdapter.ts` — uses shared `toneForState`, `ACTION_LINKS`, `GATE_REGISTRY`
- `callRiskCheckResultAdapter.ts` — uses `GATE_REGISTRY.call.checkResultGate`

Both retain their specialised evidence sources and decision logic, but share the mechanical plumbing.

---

## Phase 6: Action/Reporting Registry ✅

**Created**: `src/domain/actionRegistry.ts`

ONE registry for all external action URLs:
- `ftc_report_fraud`, `fcc_complaint`, `ftc_wifi_safety`, `ic3_report`, `ftc_identity_theft`
- `accc_scamwatch`, `acsc_report`
- `apple_report_phishing`, `google_report_phishing`, `google_play_report`, `apple_app_store_report`
- Helper functions: `fraudActionLinks()`, `scamActionLinks()`, `callScamActionLinks()`, etc.

**Updated**: `linkCheckResultAdapter`, `callCheckResultAdapter` — replaced hardcoded URLs with `ACTION_LINKS.*`

---

## Phase 7: Gate Metadata Registry ✅

See Phase 2 above. `GATE_REGISTRY` in `gateRegistry.ts` is the single source.

**Eliminated**:
- `TITLE` in `gates.ts`
- `PURPOSE` in `gates.ts`  
- `GATE_LABEL` in `homeStatusResolver.ts`

---

## Phase 8: Sanitisation Upload Contract ✅

**Created**: `src/domain/approvedImageUpload.ts`

ONE contract for sanitisation metadata:
- `ApprovedImageUploadFields` type
- `buildApprovedUploadFields(decision, receipt)` — canonical field builder
- `buildTextOnlyUploadFields()` — text-only submission

**Updated**:
- `message.tsx` — uses `buildApprovedUploadFields()` instead of manual construction
- `vision.tsx` — uses `buildApprovedUploadFields()` and `buildTextOnlyUploadFields()`

No screen manually constructs `sanitization_receipt_id` / `sanitization_digest` fields.

---

## Phase 9: Anti-Drift Tests ✅

**Created**: `tests/test_anti_drift.mjs` — **111/111 PASS**

| Category | Tests | Status |
|---|---|---|
| Gate registry completeness (10 gates × 6 checks) | 60 | PASS |
| gateName() matches registry | 10 | PASS |
| Tone mapping consistency (8 states) | 8 | PASS |
| Privacy policy as single source | 7 | PASS |
| Action registry (URLs, labels, HTTPS) | 22 | PASS |
| Sanitisation upload contract | 7 | PASS |
| Manual-only protection state fix | 2 | PASS |

---

## Architecture Rule Verified

> A fact can appear in many places, but Apollo should decide that fact in only one place.

| Fact | Decided In | Consumed By |
|---|---|---|
| Gate name | `gateRegistry.ts` | gates.ts, homeStatusResolver.ts, all adapters |
| Apollo tone | `checkResultFramework.ts` | All 8 adapters |
| Credential pattern | `privacyPolicy.ts` | imagePrivacyCore.ts |
| Action URL | `actionRegistry.ts` | link, call, message, email adapters |
| Upload fields | `approvedImageUpload.ts` | message.tsx, vision.tsx |
| Manual-only rule | `homeStatusResolver.ts` line 181 | Home, Protection (one resolution) |

---

## New Files Created

| File | Purpose |
|---|---|
| `src/domain/privacyPolicy.ts` | Canonical privacy classification patterns |
| `src/domain/gateRegistry.ts` | Canonical gate metadata registry |
| `src/domain/actionRegistry.ts` | Canonical action/reporting link registry |
| `src/domain/checkResultFramework.ts` | Shared check result plumbing |
| `src/domain/approvedImageUpload.ts` | Canonical sanitisation upload contract |
| `tests/test_anti_drift.mjs` | Anti-drift regression tests (111 tests) |

## Files Modified

| File | Change |
|---|---|
| `imagePrivacyCore.ts` | Imports patterns from `privacyPolicy.ts` |
| `imagePrivacy.ts` | Fixed re-export structure |
| `gates.ts` | Imports from `gateRegistry`, removed TITLE/PURPOSE |
| `homeStatusResolver.ts` | Imports `gateName()`, removed GATE_LABEL, fixed manual-only bug |
| `linkCheckResultAdapter.ts` | Uses shared framework, registry, action links |
| `callCheckResultAdapter.ts` | Uses shared framework, registry, action links |
| `callRiskCheckResultAdapter.ts` | Uses gate registry |
| `emailCheckResultAdapter.ts` | Uses shared framework, registry |
| `messageCheckResultAdapter.ts` | Uses shared framework, registry |
| `appCheckResultAdapter.ts` | Uses shared framework, registry |
| `fileCheckResultAdapter.ts` | Uses shared framework, registry |
| `networkCheckResultAdapter.ts` | Uses shared framework, registry |
| `accountCheckResultAdapter.ts` | Uses shared framework, registry |
| `deviceCheckResultAdapter.ts` | Uses gate registry |
| `message.tsx` | Uses `buildApprovedUploadFields()` |
| `vision.tsx` | Uses `buildApprovedUploadFields()`, `buildTextOnlyUploadFields()` |

## Test Results

| Suite | Result |
|---|---|
| Anti-drift tests | **134/134 PASS** |
| Screenshot privacy regression | **34/34 PASS** |
| Higgins pipeline routing | **35/35 PASS** |
| Cross-device isolation | **11/11 PASS** |

## Final Verification (Post-Cleanup Fix)

- Metro Bundler: **Compiles successfully** (2293 modules, 0 Babel errors)
- Backend health: **200 OK**
- App renders: **Verified via screenshot**
- Fixes applied: Removed duplicate `GATE_REGISTRY` import in `gates.ts`, added missing `ScreeningContext` import in `imagePrivacyCore.ts`, added missing `ACTION_LINKS` import in `callRiskCheckResultAdapter.ts`, fixed extensionless import in `privacy.ts`.
