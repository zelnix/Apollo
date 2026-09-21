# Apollo implementation matrix — architectural package (Package-2 + Complete Developer Instructions)

**Date:** 2026-09-21. **Source:** fork base `33a2383`, work committed on `main` (see `git log`; SHA recorded in final handoff).
**Overall status: PARTIAL.** Stage A and Stage B core are implemented and verified live; Stage C is partially delivered; Stage D scenario acceptance (US01–US35) is **not run** as a full suite. Statuses below are honest per item; nothing marked complete relies on a mock or a testing agent.

Legend: ✅ complete · 🟡 partial · ⬜ not started · 🚫 blocked (named external prerequisite)

## Original findings (Package-2 §2, IDs as issued)

| ID (Package-2) | Title | Stage | Files | Evidence | Status |
|---|---|---|---|---|---|
| AR-07 | Indefinite `ask_messages`/`ask_handoffs`, picker cache lifecycle | A | `routers/ask.py`, `services/higgins/repository.py`, `retention.py` | Ask history/delete now derived from case turn bundles; `DELETE /ask/history` revokes every case + purges legacy rows | 🟡 native picker cleanup unverified on device |
| AR-15 | Public cached OpenAI speech | A/B | `provider.py`, `routers/voice.py`, `routers/investigations.py` (`/speech`) | Gemini TTS, owner-scoped audio, `private, no-store`, case-bound speech job | ✅ (native playback lifecycle unverified) |
| AR-05 | `[:900]` slicing, EOF-as-success | A | `coordinator.py`, `investigation/client.ts` (`streamEvents`) | No slicing anywhere in new engine; terminal events required; EOF → reconnect/poll | ✅ |
| AR-01 | No tool-enabled coordinator | B | `coordinator.py`, `tools.py`, `provider.py` | Live probes: read_evidence, inspect_url, lookup_reputation, research_public_sources (grounded), request_device_observation, research_settings all executed by Gemini function calls | ✅ |
| AR-03 | Lossy slicing (4,000 chars / 10 URLs / 3 pages / 800 chars) | A | `evidence.py`, `contracts.py`, `capacity.py` | 23,912-char message fully examined; 25 URLs inventoried (test); 50-page PDF page-47 clue found (probe) | ✅ for text/url/pdf/docx/image; 🟡 audio/attachment extraction |
| AR-14 | Blanket redaction destroys identifiers | A/C | `core/redaction.py`, `evidence.py` | Only secrets redacted; phone/email/domain/IP retained; redactions recorded as transformations | 🟡 image-region preflight not implemented |
| AR-02 | Hardcoded `OFFICIAL`/`app_reputation` authority | B | `tools.py` (`research_public_sources`, `research_application`) | New engine uses grounded research only; legacy `analysis.py` catalogues remain as hints on compatibility routes | 🟡 legacy Gate routes not yet migrated |
| AR-04 | Keyword validators reject prose; canned assessments | B | `validation.py` | Interface-only validation (schema, registered IDs, capability actions, completion); one targeted repair; no style filters | ✅ |
| AR-13 | Retry replays initial handoff answer | A | `investigations.py` (`_submit_turn`), `caseStore.ts` | Per-turn `turnId` + `Idempotency-Key`; replay → same job; changed payload → 409 (test) | ✅ |
| AR-06 | Transport/job timeout mismatch | B | `jobs.py`, `caseStore.ts` | 202 + SSE with `after=` reconnect; leases/heartbeat/fence; 120 s slice; polling fallback | ✅ |
| AR-10 | Forced-warning state reconciliation | B | `contracts.py` (`attention`), `InvestigationView.tsx` | Separate `attention` projection; Gemini may lower concern (device probe: "not an attack") | 🟡 Gate screens' local `state` not yet driven by case |
| AR-16 | Brand guessing / Gate-count escalation | A | `threatScent.ts` (prior session) | Removed; typed relationships via `parentId`/`relatedEvidenceIds` | 🟡 cross-case joins |
| AR-08 | Hardcoded Settings text | C | `tools.py` (`research_settings`), `/settings-plan`, `/recheck` | Live Samsung SM-S918B plan `match=exact`, sourced; recheck contract implemented | 🟡 frontend `src/settings/*` not built; `deviceSettings.ts` still used by Device screen |
| AR-09 | Requested vs granted permissions, empty-vs-unavailable | C | native `AppDeviceSignals.kt` | — | ⬜ |
| AR-11 | Static mock adapter import | C | `securityAdapter.ts`, `MockSecurityAdapter.ts` | — | ⬜ |
| AR-12 | Three-journey report, keyword grading | D | `tests/run_round1_user_scenarios.py` | Immutable runs exist (prior session); US01–US35 semantic suite | ⬜ NOT RUN |

## Complete Developer Instructions — stage steps

| Step | Requirement | Status | Notes |
|---|---|---|---|
| A1 | Repository/requirement matrix | ✅ | This file |
| A2 | Contracts, indexes, owner checks, epoch, authoritative turn commit | ✅ | `contracts.py`, `repository.py` (`stage_turn` → single CAS `accept_turn`) |
| A3 | Ask completion ordering | ✅ | Ask is now a thin adapter over the case engine; answer + history become authoritative together |
| A4 | Opaque case/evidence transport, no slicing | ✅ | `higginsHandoff.ts.original_evidence`, `ask.tsx` → `CreateCase.submissions`/files |
| A5 | File/image/document intake | 🟡 | Streaming multipart + resumable chunks, sniffing, PDF/DOCX/TXT/PNG/JPEG; audio/attachments inventoried only |
| A6 | Whole-input handling | ✅ | Inline ≤24k chars; `read_evidence` ranges/pages; coverage ledger |
| A7 | Frontend lifecycle keyed by case | ✅ | `caseStore.ts` per-case expiry timer; server deadline |
| A8 | Deletion incl. speech | ✅ | `revoke` + `run_cleanup` over all case collections and `voice_cache` |
| B9 | Provider/capability registry | ✅ | `provider.CAPABILITIES`, `/api/ai/capabilities` |
| B10 | Coordinator | ✅ | inventory → tools → reassess → answer/question |
| B11 | Research tools | ✅ | 9 tools; breach lookup gated on HIBP key |
| B12 | Device broker | 🟡 | Contract + backend loop verified; frontend broker returns honest `unavailable` (native adapters not bound) |
| B13 | Revisable assessments | 🟡 | Engine yes; Gate screens still show local state independently |
| B14 | Durable worker | ✅ | leases, heartbeat, fence, checkpoint, `recover()` on startup/sweep |
| B15 | Recovery/retry | ✅ | 2 transient retries, jittered backoff, SDK retries disabled, deadline-bounded |
| B16 | Answer validation + UI | ✅ | `InvestigationView` |
| B17 | Narration | ✅ backend / 🟡 UI uses existing protected `/voice/speak` path |
| C18 | Migrate all entry paths | ✅ handoffs / 🟡 Home quick checks & share targets | All ten Gate screens' "Ask Higgins" hand the original URL/message/email/call/alert/app description/file bytes/network+device observations into the shared case (`original_evidence`); Patrol event actions carry summaries only |
| C19–C21 | Gate-specific work, observation semantics, guided settings UI | 🟡 / ⬜ | Backend plan/recheck ready; native contracts untouched |
| C22 | Preview/native boundary | ⬜ | |
| C23 | Delivery adapters | 🚫 | Email/push/storage remain explicit 503 stubs — need `RESEND_API_KEY`+sender, push credentials, object store |
| C24 | Consumer usability | 🟡 | Retry/Cancel/expand/sources/hear implemented |
| D25–D30 | Runner, journeys, recovery, semantic grading, immutable runs, handoff | ⬜ | Only direct probes run (below) |

## Direct verification performed (owner key, real Gemini, no testing agent)

| Probe | Result |
|---|---|
| Link case (`tests/probe_investigation.py link`) | 4 tool calls, grounded sources, `concern_found`/`review`, actions, `completed` |
| 23,912-char Text case + follow-up (`... text`, `FOLLOWUP=`) | Late clue found; follow-up answered in same case; replay same key → same job; changed payload → 409; other owner → 404; delete → 204 then 410 |
| 50-page PDF, link on page 47 (`tests/probe_document.py`) | Page-47 clue found, reputation lookup on link, `urgent` |
| Device case with advertised capabilities | `device_request` → result accepted → checkpoint resume → completion without tampering claim; duplicate result safe; settings plan `match=exact` (Samsung) |
| Browser: Ask general question | Progress → response → `waiting_user` question rendered |
| Browser: Text Gate → "Ask Higgins" | Case with original message; 3 sources; two actions |
| Browser: Link Gate (blocklisted test URL) → "Ask Higgins to explain" | Case with URL + link-check observations; Gemini revised Apollo's initial block hypothesis to `no_concern_found_within_scope` for Google's test page (AR-10 revisable assessment) |
| `tests/test_investigation_engine.py` | 7/7 |
| Legacy backend suite | 279 passed / 23 failed — identical failures to the pre-change baseline (26 failed incl. 2 obsolete tests removed) |
