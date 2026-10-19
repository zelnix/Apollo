# Apollo: final code review and architectural implementation package

Reviewed 21 September 2026. Source: `zelnix/Apollo`, commit `33a23830cc8ac5fb34929542184fc29abff60d97`.

**Decision: preserve the working detection and recent usability fixes; rebuild the shared Higgins investigation path. Prompt tuning alone cannot satisfy the agreed product requirements.**

This is a read-only architectural review using 75 retrieved backend, frontend, native and report files, with focused tracing of the principal investigation, handoff, Settings, privacy, voice and scenario paths. It is not an exhaustive security audit of every repository file. No application code was modified; no tests, builds, live Gemini calls or testing agents were run. Findings below distinguish source observations from existing developer-generated report results. Production configuration, key ownership, OAuth operation and provider account retention settings were not inspected.

All 91 blobs under `frontend/packages/guarddog-*` match the previous reviewed commit `96f336f6573e2845a7a5c7b5d781ef82af75c03a`, with no additions or removals. This proves continuity between these two snapshots, not a new certification against an independently supplied original archive.

The developer owns implementation choices within this package and should finish coherent stages without routine micro-approval requests. Do not invoke a testing agent without the user's explicit approval. Report concrete unavailable credentials, platform access or genuinely new product decisions; do not turn ordinary coding decisions into approval gates. Stage 1D physical-device acceptance remains cancelled. Do not restart it. Native macOS/Windows enforcement remains backlog; cross-platform researched guidance is in scope.

## Mandatory provider correction — Gemini only, owner-managed credentials

This clarification supersedes any weaker provider wording elsewhere in this package. All Apollo/Higgins AI processing must use Gemini through the owner-supplied server-side Gemini configuration: investigation, contextual analysis, screenshot/vision interpretation, OCR where model-based, audio transcription, follow-up, explanations and read-aloud speech. Select the appropriate supported Gemini model for each modality; do not assume one model supports all modalities.

No Emergent-managed integration keys are permitted in application service paths, preview, native builds, acceptance runs or recovery configuration. No OpenAI, Claude or other AI-provider fallback. Recovery may use a separately configured, capability-compatible Gemini model with the owner's credentials; otherwise retry/resume or show an honest incomplete/unavailable state. Remove the requirement for `EMERGENT_LLM_KEY` and any enabled Emergent-managed AI gateway path, rather than merely leaving the key empty and retaining a fallback.

Use Google's supported Gemini client/API directly for AI calls. Inventory all call sites, including `backend/services/transcribe.py`, `backend/routers/voice.py`, screenshot/page extraction, investigation, Ask Higgins and shared utilities. Audit environment templates, build profiles, secrets references and documentation for legacy provider dependencies. This requirement is an implementation instruction; transcription's current provider was not independently traced by this review.

Specialist security data sources (for example Safe Browsing, IPQualityScore and HIBP), Gmail OAuth and OS-native observation/enforcement remain distinct from AI providers. They may continue under direct owner-managed credentials and the established purpose limits. Any email/push feature currently requiring an Emergent-managed key must be migrated to an appropriate directly configured service; report the exact missing credential without blocking unrelated work or silently preserving that dependency. Using Emergent as the development/hosting environment is not itself use of an Emergent-managed service key.

Existing encryption keys are separate from Gemini access. Preserve their intended scope and existing data compatibility; never substitute an API key for an encryption key. No key values may appear in chat, logs, reports or source control. Add a release check that enabled runtime provider selection and configuration references contain no disallowed AI provider or Emergent-managed integration key. Historical review findings may still name the old providers as evidence of what must change.

#### 🏛️ System Architecture & Data Flow

## 1. Product architecture and scope

Apollo detects and performs supported protective actions. Higgins investigates, interprets, explains and guides. A local detection is an initial hypothesis and observation, not an immutable conclusion about legitimacy. A Gemini investigation may escalate, qualify or reduce that hypothesis as evidence changes. It cannot invent an observed event or a completed protective action.

The person should obtain a better-informed investigation than they could easily assemble themselves: original submissions, relevant app/device observations and external research together. Do not promise identical output to the Gemini consumer app: models, tools and context differ. Judge usefulness against comparable direct-Gemini scenarios, including follow-up.

The required flow is:

1. A person submits an item or an existing, authorised Apollo capability observes a concern.
2. Create one investigation case shared by all relevant Gates. Inventory the original evidence and initial Apollo findings separately.
3. Gemini examines relevant original evidence plus observations, identifies gaps and requests research or additional supported observations.
4. A backend coordinator executes authorised read tools; a device broker requests fresh supported device observations. Neither treats source text as instructions.
5. Ask the person only for intent, circumstances or permission that Apollo cannot obtain independently.
6. Return the tool results and user answers to the same investigation. Revisit earlier assumptions when contradicted.
7. Higgins provides Gemini's actual explanation, sources, uncertainty and practical next action. Additional detail is expandable, not discarded.
8. Purge temporary original content when its processing purpose ends; preserve only explicitly permitted case state and user-saved reports. Expiry never extends merely because a retry occurs.

The ten Gates remain Site, Link, Text, Call, Network, Account, Email, App, File and Device. Manual File/Device checks remain “Ready to check”; neither becomes continuous monitoring through wording alone.

## 2. Current findings ranked by importance

These IDs are new architectural findings, not a renumbering or unsupported reopening of the historical P0-01–P0-06 backlog. P0 here means immediate correction during this package because of data lifecycle or false-completion risk; P1 means a core capability/reliability gap; P2 means supporting maintainability/operability work. Severity describes the potential effect, not proof of exploitation.

| ID | Priority / severity | Current source finding and consequence | Required disposition |
|---|---|---|---|
| AR-07 | P0 / High | `ask.py` persists redacted user messages and responses in `ask_messages` and cached replies in `ask_handoffs`; startup defines no TTL for them. Clear history deletes only messages. Native file picker requests a cache copy without an explicit cleanup lifecycle in the reviewed screen. | Introduce explicit retention/deletion ownership and legacy cleanup; clear all content-bearing copies, including handoff caches and application-created file copies. |
| AR-15 | P0 / High | `voice.py` sends read-aloud text to OpenAI via `EMERGENT_LLM_KEY`, stores audio in `voice_cache` without expiry in the reviewed startup, and serves it through an auth-exempt content-derived URL with one-year public caching. | Bring investigation narration under the configured provider and case lifecycle; owner-scoped expiring audio, authenticated retrieval and no public caching. Existing cached material needs cleanup. This is a separate speech path, not evidence that Gemini analysis uses OpenAI. |
| AR-05 | P0 / High | Investigation slices `exact_response` to 900 characters while UI can label it “shown verbatim”. `streamPost()` treats a successful HTTP close as success even if the terminal `done` event never arrived. | Remove silent answer slicing; require explicit application completion and provider termination metadata. Never mark interrupted prose complete. |
| AR-01 | P1 / Critical product gap | `investigation.py` supplies only pre-collected sources. `ask.py` is explicitly explanation-only. Neither path configures search/function tools or a continuing research loop. | Introduce one tool-enabled investigation coordinator; ordinary follow-up and initial Gate analysis use it. |
| AR-03 | P1 / High | Evidence is rejected or silently sliced at multiple layers: 4,000-character text, ten URLs, three page fetches, 800-character excerpts, two phone checks, eight short handoff findings and eight chat messages. | Central capacity policy, complete input inventory, chunking, paging, relevant retrieval and explicit coverage. |
| AR-14 | P1 / High | Link intelligence passes redirect/final-URL details into `investigate_message()`, but its prompt source construction reduces them to host/verdict/coverage. Blanket context redaction also removes phone/email and IP evidence. | Preserve relevant original identifiers and typed lookup results in private investigation context; do not confuse research evidence with credentials. |
| AR-02 | P1 / High | `OFFICIAL` is still a hardcoded organisation/domain/guidance table. `app_reputation()` is a name/catalogue heuristic. Neither authenticates an organisation or installed publisher. | Replace authority claims with researched sources and verifiable identifiers; retain catalogues only as labelled hints. |
| AR-04 | P1 / High | Ask handoffs now return accepted Gemini prose, but keyword/punctuation validators still reject ordinary wording. Latest File/Device journeys fail. Investigation still substitutes deterministic assessments and callback-trap templates. | Preserve accepted output; repair specific structural/factual failures through Gemini; remove substitute investigation assessments. |
| AR-13 | P1 / High | A failed follow-up's Retry in `frontend/app/(tabs)/ask.tsx` sends the original `handoff_id`. Backend `_claim_handoff()` can return the completed initial answer from cache, without answering the new question. | Use a distinct immutable turn ID/idempotency key for each question, retain case ID across turns, and retry only that turn. |
| AR-06 | P1 / High | Backend investigation permits two 55-second attempts plus lookups; frontend long request timeout is 60 seconds. Ask handoff retries twice at 40 seconds; general chat has a separate weaker recovery path. | Decouple jobs from transport; align deadlines, retry transient errors with backoff, reconnect to the same job and avoid multiplying SDK/application retries. |
| AR-10 | P1 / High | State reconciliation mostly allows Gemini to raise an initial warning; local warning forces shared investigation risk to warning. It cannot meaningfully clear a mistaken initial inference. | Separate initial signals, revisable investigation assessment, current protection health and immutable enforcement events. |
| AR-16 | P1 / High | `threatScent.ts` maps broad reported identities such as “a delivery company” to specific brands and escalates to Barking when two categories are linked. Merely checking one issue through two Gates can increase severity. | Link by explicit case/evidence relationships; distinguish duplicate checks from independent threat evidence; never manufacture a brand or escalation from the number of Gates. |
| AR-08 | P1 / High | Settings guidance is hardcoded Android/iOS text; web falls back to “On your phone”. No OEM research service or manufacturer/OS-specific guidance contract appears in the reviewed path. | Three-path permission/Settings service with verified source match and setting-specific outcome check. |
| AR-09 | P1 / High | Device/App Android support is catalogue-limited; permission output uses requested permissions without granted flags. Some read failures can become empty lists. Android active-admin presence is named a management profile. | Distinguish requested/granted/capability/observed behaviour and unavailable/empty; report exact platform semantics and app-visibility coverage. |
| AR-11 | P1 / High | Mock adapter is statically imported; configuration permits mock security on native development/staging builds and mock SecureCore under some production configurations. | Isolate preview device simulations; normal native artefacts must exclude them regardless of environment name. Preserve explicit unsupported adapters. |
| AR-12 | P1 / High | Latest live report contains only three browser journeys, zero complete, one partial and two failed. Keyword-based “accuracy”/“depth” scores cannot establish grounded investigation quality. | Preserve run history and scope, cover every Gate with real downstream scenarios, and assess scenario facts and useful outcomes. |

### What has improved and must be preserved

- `_guard_handoff_response()` no longer unconditionally returns a template. It returns validated model text and performs a real correction attempt when rejected.
- Follow-up validation requirements are relaxed according to the question rather than always enforcing initial-handoff requirements. Remaining failures still exist.
- Browser file selection now reads actual selected bytes. This is still a bounded local sample, not whole-file Gemini investigation.
- Device refresh and recheck exist. They are not yet a researched, setting-specific completion service.
- DNS failure has an explicit unavailable result and a guard against some unsupported inferences. That narrow guard does not cover every overclaim.
- Fallback origin is displayed instead of silently presented as Gemini. The fallback still violates the new required behaviour and must be removed from the investigation answer path.
- Real lookups and real Higgins responses are used by the reported latest browser run. A real call is not evidence of complete research or successful user experience.

Deterministic detection is real app logic, not a mock. Retain useful local detections and show them as Apollo observations during an outage. The rejected design is substituting a prewritten investigation/explanation for unavailable or inconvenient Gemini output. Likewise, strict action and credential controls remain necessary; indiscriminate restrictions on investigative evidence and prose are what must change.

### Report findings that require honest interpretation

`test_reports/round1_expected_vs_actual_live.md`, generated 2026-09-21T03:48:32Z, reports 35/35 local-logic expectations, **0/3 browser journeys complete, 1 partial, 2 failed**, and six device-only scenarios outside browser completion. The local 35 must not be counted as real investigation acceptance.

The partial Link response states that DNS failure often occurs with scam pages and says Apollo confirms the address is not authorised. The displayed evidence contains a failed page fetch and a static domain comparison; neither establishes owner authorisation. The runner nevertheless scores “accuracy=yes” because its test checks word patterns rather than that factual claim. File and Device follow-ups report “Higgins' answer did not meet Apollo's evidence rules. Retry.”

The runner supports filtered reruns but writes the same report filenames. A three-journey rerun can replace the ten-journey report; preserve immutable runs and a coverage index instead. These observations come from saved reports and source, not a new execution.

## 3. Requirement-to-code coverage, by Gate

| Gate | Current implemented ability in reviewed paths | Gap to close in this package | Main existing integration files |
|---|---|---|---|
| Site | Native web capability interfaces and protection-state checks; page/screenshot analysis paths. | Feed actual available browser/filter observations and screenshot/page evidence into a case; distinguish content suspicion, protection gap and an actual blocked packet. No universal visibility claim. | `frontend/src/security/webSdk.ts`, `NativeSecurityAdapters.ts`, `frontend/app/check.tsx`, `backend/routers/analysis.py` |
| Link | Local URL heuristics; reputation checks; redirect/domain context; static page fetch; Gemini assessment. | Research unknown organisations and destinations, preserve full non-secret URL components, inspect relevant page depth, follow leads and reconsider initial heuristics. | `frontend/src/domain/risk.ts`, `linkGuard.ts`, `frontend/app/check.tsx`, `backend/services/intel.py`, `webcrawl.py`, `investigation.py` |
| Text | Pattern extraction and submitted message analysis; screenshot OCR through Gemini. | Full relevant message/thread and original image access; international numbers; all entities; independent research and continuous follow-up. | `frontend/app/message.tsx`, `frontend/src/domain/messageAnalysis.ts`, `frontend/src/store/ApolloContext.tsx`, `backend/routers/analysis.py` |
| Call | User-reported caller requests/transcript; IPQualityScore support; separate native screening interfaces. | Investigate the transcript and claimed organisation together; answer missing factual questions through research; preserve phone identity uncertainty. No assumption of live audio access. | `frontend/app/call.tsx`, `frontend/src/domain/callAnalysis.ts`, `frontend/src/security/callSdk.ts`, `backend/services/phonerisk.py` |
| Network | Available SDK connection signals plus reported context; local assessment and Higgins summary handoff. | Tool-accessible fresh observations, explanation of captive portals/VPN scope, OEM guidance and targeted rechecks. No claim of inspecting all encrypted traffic. | `frontend/app/network.tsx`, `frontend/src/domain/networkAnalysis.ts`, `frontend/src/security/networkAccountSdk.ts` |
| Account | Submitted alert analysis and Gemini assessment; explicit HIBP endpoint if configured; manual incident context. | Cross-correlate sender, alert, user intent, breach lookup and actions; no password/username form; no inferred compromise from a notice alone. | `frontend/app/account.tsx`, `frontend/src/domain/accountAnalysis.ts`, `backend/routers/analysis.py` |
| Email | Manual email analysis and read-only Gmail OAuth/scan integration; attachment-name handoff. | Preserve sender/header/body/link/attachment relationships, investigate full relevant message, obtain attachment bytes only through supported authorised input; share case across Gates. | `frontend/app/email.tsx`, `frontend/src/domain/emailAnalysis.ts`, `backend/services/gmail.py`, `mailbox_monitor.py`, `frontend/src/store/ApolloContext.tsx` |
| App | Permission/purpose heuristics, remote-access catalogue, supported Android package observations, Gemini assessment. | Research actual package/publisher/store provenance and supplied evidence; separate requested permissions from grants; extend selected-app visibility where platform permits without claiming full inventory. | `frontend/app/app-check.tsx`, `frontend/src/domain/appAnalysis.ts`, `backend/routers/analysis.py`, native `AppDeviceSignals.kt` |
| File | Real bytes, 16-byte signature and up to 200,000-byte ASCII sample; 20 MiB limit; embedded-link extraction and handoff. | Safe supported document/image extraction and original evidence access by Gemini; content-aware chunks; all relevant links; cache cleanup. No malware-execution sandbox is authorised or implied. | `frontend/app/file.tsx`, `frontend/src/domain/fileInspection.ts`, `fileAnalysis.ts` |
| Device | Visible settings and protection health, catalogue remote apps, user reports, differences between snapshots and manual refresh. | OEM-specific guidance, exact setting outcomes, stale-read handling, requested/granted distinction, dormant apps and Apollo health investigation. | `frontend/app/device.tsx`, `frontend/src/domain/deviceAnalysis.ts`, `frontend/src/utils/deviceSettings.ts`, native `AppDeviceSignals.kt` |

Gmail/HIBP/provider configuration remains environment-dependent, not source-proven working. macOS/Windows enforcement is not to be fabricated. Their guidance may be available through exact platform sources even where observations/actions are unavailable.

## 4. Capacity and completeness policy

These are observed current application limits, not claims about Gemini's maximum capabilities:

| Layer | Current boundary | Treatment |
|---|---|---|
| Submission | Frontend privacy and backend message/account schemas: 4,000 characters; sender 80; URLs 10 | Replace lossy/preemptive limits with evidence uploads and paged inventory; retain explicit transport abuse bounds. |
| Screenshot extraction | Upload reads at most 6,000,001 bytes; extracted text 4,000; URLs ten of up to 500 chars | Retain clear upload errors; add supported original-image analysis and pages/items inventory. |
| Research inputs | Three page fetches, page text 800 chars, two phone lookups with AU assumption | Adaptive batches and correct numbering context; every relevant entity accounted for. |
| Alternate page path | Sends 4,000 chars though prompt says “up to 6000” | Single source of capacity truth; remove misleading prompt wording. |
| Handoff | Eight findings ×180 chars, six uncertainty entries, four actions, summary 240; seed question 500 | Replace summary-only contract with case/evidence references. Summaries are navigation, never sole evidence. |
| Conversation | Message schema 2,000 chars; model receives eight previous messages | Evidence-backed continuation with full retrievable active-case history and preserved unresolved questions. |
| Output | 900-char answer, short field slices; 120/150-word prompts; three-item prompt lists; 1,200/3,000 model output budgets | Model-generated overview plus expandable full explanation. No post-generation slicing. |
| Read aloud | Frontend truncates each spoken item to 1,500 characters; backend accepts 1,500 characters | Segment the complete chosen response at sentence boundaries; never silently stop before the practical action. |
| File | Single picker item; 20 MiB; 200,000-byte sample; ASCII extraction; first ten links | Support declared safe formats and multiple case items; inventory binary/compressed/unreadable portions. Never equate sampled bytes with full document parsing. |
| Transport | 60-second long request vs up to 110 seconds of model attempts | Asynchronous job with events/polling and consistent absolute deadline. |

Implement `InvestigationCapacityPolicy` from server configuration and provider capability metadata. Each configured bound requires a purpose, unit, version and overflow behaviour. Do not replace 4,000 with another unexamined magic number. Provider capacity is obtained for the selected model; reserve space for tool schemas, research results, output and provider-specific reasoning overhead. Measure actual token usage. Long inputs are segmented with stable offsets/page numbers and cross-segment entity relationships; synthesis must revisit relevant original segments rather than only summarising summaries.

Initial operational design: inventory first; stage tool requests in limited concurrent batches; default active work slice of two minutes; offer continuation when more research is useful. This time budget controls scheduling, not how much text silently disappears. The existing 15-minute interrupted-content expiry is a hard lifecycle boundary, independent of the work slice. Select file/request ceilings according to deployed parser and infrastructure capabilities, publish them before upload, and support multipart/chunked ingestion within those ceilings.

The implementation must demonstrate at least the acceptance fixtures below (12,000-character message, 25 distinct URLs, three relevant numbers, 50-page supported document and 12-turn investigation), or explicitly record the concrete infrastructure/provider reason it cannot. These are acceptance workloads, not assertions of unlimited capacity or new provider limits.

Every input item has coverage: not started, partial, examined, unavailable, or explicitly out of scope with reason. “Complete” means the agreed question was addressed and all supplied items were dispositioned; it never means the device or item is universally safe. A material unexamined item yields a partial investigation, with continuation if supported.

## 5. Component boundaries

Proposed new files below are implementation targets, not existing code:

- `backend/services/higgins/provider.py`: sole Gemini adapter using the user's backend-managed `GEMINI_API_KEY`; exposes full responses, finish reasons, grounding metadata, usage and typed tool calls. Use Google's supported Gemini SDK/API directly. Preserve specialist security data integrations with direct owner-managed credentials; migrate any remaining Emergent-key dependencies.
- `backend/services/higgins/coordinator.py`: one case/turn/step state machine for all Gates and follow-ups. Chooses research vs device observation vs user question, subject to supported tool contracts.
- `backend/services/higgins/evidence.py` and `capacity.py`: temporary evidence ingest, transformations, coverage and model-context assembly.
- `backend/services/higgins/tools.py`: typed read-only research/observation tool registry; separate action proposals from execution.
- `backend/services/higgins/validation.py`: schema, citation references, completion, action capability and enforcement-claim validation. No broad prose replacement or keyword-based insistence on a particular sentence style.
- `backend/services/higgins/jobs.py`, `retention.py`: leases, step idempotency, reconnect/retry, cancellation, expiry and cleanup.
- `backend/services/higgins/settings_guidance.py`: independently sourced OEM guidance matched to platform, manufacturer, model, OS and locale.
- `backend/routers/investigations.py`: authenticated case/job API. Existing analysis/ask endpoints temporarily adapt to it; do not maintain two investigative engines.
- `frontend/src/investigation/{types,client,deviceBroker,caseStore}.ts`: generated/shared contracts, case continuation, event reconnect and actual device observation results.
- `frontend/src/components/InvestigationView.tsx`: actual response, expandable detail, citations, coverage, progress, Retry/Continue/Cancel and user question.
- `frontend/src/settings/{guidance,actions,recheck}.ts`: permission requests, checked navigation descriptors and target-specific rechecks.

Gemini Search grounding, URL context, function calling and token accounting have distinct API contracts. Confirm the chosen model/API/SDK supports the required combination; if a single request cannot combine tools, use separate grounded research calls and Apollo tool calls coordinated within the same case. Do not silently omit a tool. Keep model IDs/configuration explicit rather than embedding another preview-model string across routes. Preserve tool-call IDs and any provider-required continuation fields internally; do not request or display hidden chain-of-thought. Provide concise evidence-based reasons and source links instead.

Google references consulted: [Search grounding](https://ai.google.dev/gemini-api/docs/google-search), [function calling](https://ai.google.dev/gemini-api/docs/function-calling), [URL context](https://ai.google.dev/gemini-api/docs/url-context), [token accounting](https://ai.google.dev/gemini-api/docs/tokens). Grounding metadata and required source attribution must reach the UI; model knowledge alone is not a retrieved source.

## 6. Exact logical types and storage semantics

Use equivalent Pydantic models on the backend, strict enums and generated TypeScript types. ISO strings use UTC; IDs are opaque UUIDs; quantities are nonnegative integers. Reject unknown request fields. A reference is always ownership-checked, never an arbitrary storage path or fetch URL.

```typescript
type Gate = 'site'|'link'|'text'|'call'|'network'|'account'|'email'|'app'|'file'|'device';
type CaseStatus = 'queued'|'investigating'|'waiting_device'|'waiting_user'|
  'retry_wait'|'partial'|'complete'|'failed'|'cancelled'|'expired';
type Origin = 'user_submission'|'device_observation'|'external_source'|'apollo_inference';
type CoverageStatus = 'not_started'|'partial'|'examined'|'unavailable'|'out_of_scope';
type Assessment = 'concern_found'|'no_concern_found_within_scope'|'uncertain';
interface Coverage {
  status: CoverageStatus;
  unit: 'bytes'|'characters'|'pages'|'items';
  total: number|null;
  examined: number;
  omittedRanges: Array<{start: number; end: number; reason: string}>;
  reason: string|null;
}
interface EvidenceItem {
  id: string; caseId: string; origin: Origin; kind: string;
  parentId: string|null; collectedAt: string; observedAt: string|null;
  expiresAt: string; contentRef: string|null; mediaType: string|null;
  simulation: null|{kind: 'preview_device'; label: string};
  availability: 'available'|'unavailable'|'permission_required';
  coverage: Coverage;
  transformations: Array<{
    kind: 'secret_redaction'|'ocr'|'decode'|'chunk'|'normalise';
    description: string; sourceStart: number|null; sourceEnd: number|null;
  }>;
}
interface SourceReference {
  id: string; url: string; title: string; retrievedAt: string;
  retrieval: 'fetched'|'search_result'|'unavailable';
  authority: 'official'|'independent'|'self_claimed'|'unknown';
  authorityBasis: string; evidenceIds: string[];
}
interface Finding {
  id: string; text: string; basis: 'observation'|'user_report'|'inference';
  confidence: 'low'|'medium'|'high'; evidenceIds: string[]; sourceIds: string[];
  supersedesFindingIds: string[];
}
interface Question {
  id: string; text: string; reasonNeeded: string;
  answerType: 'text'|'yes_no'|'choice'; choices: string[];
}
interface ActionProposal {
  id: string; kind: 'instruction'|'open_settings'|'request_permission'|'recheck'|'open_verified_source';
  label: string; instruction: string; capabilityId: string|null;
  executionDescriptorId: string|null; requiresUserGesture: boolean;
  sourceIds: string[];
}
interface HigginsResponse {
  revision: number; overview: string; explanationMarkdown: string;
  assessment: Assessment; findings: Finding[]; uncertainties: string[];
  sourceIds: string[]; recommendedActionId: string|null;
  actions: ActionProposal[]; question: Question|null;
  scope: string; remainingEvidenceIds: string[];
  completion: 'complete'|'partial'|'waiting_user';
}
interface InvestigationCase {
  id: string; revision: number; gates: Gate[]; status: CaseStatus;
  createdAt: string; updatedAt: string; expiresAt: string;
  evidence: EvidenceItem[]; sources: SourceReference[];
  response: HigginsResponse|null; activeJobId: string|null;
  pendingDeviceRequestIds: string[]; cleanupStatus: 'not_due'|'pending'|'complete'|'failed';
}
interface Job {
  id: string; caseId: string; turnId: string; status: CaseStatus;
  deadlineAt: string; retryAt: string|null; attempt: number;
  lastEventSequence: number; failure: Failure|null;
}
interface Failure {
  code: 'invalid_input'|'provider_configuration'|'rate_limited'|'provider_unavailable'|
    'transport_interrupted'|'incomplete_output'|'unsupported_format'|'evidence_expired'|
    'budget_exhausted'|'device_unavailable'|'permission_denied'|'response_invalid'|'cleanup_failed';
  message: string; retryable: boolean; retryAfterSeconds: number|null;
  missingEvidenceIds: string[];
}
interface DeviceProfile {
  platform: 'android'|'ios'|'windows'|'macos'|'web';
  manufacturer: string|null; model: string|null; osVersion: string|null;
  locale: string; evidenceOrigin: 'native'|'user_reported'|'browser';
  capabilityIds: string[];
}
interface SettingsPlan {
  id: string; caseId: string; target: string; device: DeviceProfile;
  match: 'exact'|'platform_only'|'unresolved';
  mode: 'permission_request'|'settings_link'|'instructions';
  instructions: string[]; sourceIds: string[]; executionDescriptorId: string|null;
  expectedObservation: {capabilityId: string; field: string; expectedValue: boolean|string}|null;
}
type RecheckResult = {
  planId: string; checkedAt: string;
  outcome: 'correct'|'not_yet_correct'|'cannot_observe'|'failed';
  evidenceIds: string[]; explanation: string;
};
```

The model returns `HigginsResponse`; the coordinator owns IDs, origin metadata, job status and source registration. A model cannot self-attest a device observation, provenance or enforcement event. Support explicit reasoning/interpretation in findings without requiring every inference to be falsely labelled externally verified.

Use existing Mongo infrastructure with new collections:

| Collection | Exact identity/index requirements | Content/lifecycle |
|---|---|---|
| `investigation_cases` | unique `(owner_id, case_id)`; `expires_at` TTL; revision compare-and-swap | encrypted temporary context/response, non-raw metadata and job reference. No raw text in indexed fields. |
| `investigation_evidence` | unique `(owner_id, case_id, evidence_id)`; `expires_at` TTL | encrypted processing copies or references with offsets/coverage; source snapshots if needed. |
| `investigation_jobs` | unique `(owner_id, case_id, idempotency_key)`; index `lease_until`; expiry | keyed payload digest, state, lease, fence revision, deadlines and step completion. |
| `investigation_events` | unique `(job_id, sequence)`; expiry | replayable progress and response events scoped to owner; content expires with case. |
| `investigation_cleanup` | unique cleanup task ID; `next_attempt_at` index | opaque object/provider IDs only, bounded retry; no recoverable raw content. |

Mongo TTL is a cleanup backstop, not immediate erasure. Explicit cleanup runs on completion, cancel and expiry; a sweeper handles crashes. Always enforce expiry before reads/tool execution, including during TTL lag. Use a real configured encryption/key lifecycle, not mock SecureCore. Keep active leases and integrity records minimal. Existing Patrol enforcement/delivery records retain their separate established purpose; do not delete that evidence merely because raw investigation content expires.

Raw originals are removed immediately after the relevant processing finishes. A still-active multi-step investigation can hold necessary temporary copies within the established 15-minute ceiling. If a completed case needs new research into deleted originals, explain that they must be resubmitted. Ongoing follow-up may use purpose-limited derived context, but it too is temporary unless the user explicitly saves a redacted report. Do not silently convert an investigation into persistent chat history. Reports must exclude raw submissions, secrets and unnecessary identifiers. Device-change baselines are a separate necessary local feature: keep the minimum fields, expose reset/deletion and do not treat them as raw investigation archives.

Provider-side processing policy is not controlled merely by deleting Apollo memory. Verify the configured Gemini account's data settings, explicitly delete uploaded provider files when used, and state any provider-controlled retention accurately. Do not promise zero provider retention without evidence. The [Files API](https://ai.google.dev/gemini-api/docs/files) supplies file-management operations; using uploads creates a separate cleanup obligation.

Speech is another processing copy: the reviewed voice route is an OpenAI/Emergent integration with persistent public-cache semantics. Migrate investigation read-aloud to an explicitly configured Gemini speech capability using the owner's key where the account supports it, preserving Higgins' intended voice characteristics as closely as supported. Do not silently fall back to another cloud provider. Gemini documents a distinct [speech-generation API](https://ai.google.dev/gemini-api/docs/speech-generation); do not assume the text investigation model is also a speech model. Text investigation continues if narration is unavailable. Audio must use owner-scoped temporary IDs, authenticated retrieval or tightly scoped short-lived playback tickets, `Cache-Control: private, no-store`, and the case's cleanup policy. Stop playback and invalidate pending audio generation on cancellation. Already downloaded or publicly cached historic bytes cannot be retroactively guaranteed erased; purge controlled stores and remove old public access without falsely promising otherwise.

#### 🔌 API & Interface Contracts

## 7. Public backend endpoints

All paths below include `/api`. Use existing device/session bearer authentication, deriving owner identity server-side. Never trust a client `device_id` to choose another owner's case. Route compatibility is internal; frontend Gate names remain unchanged.

| Endpoint | Request | Response / semantics |
|---|---|---|
| `POST /api/investigations` | `CreateCase` + `Idempotency-Key` | 201 `{case: InvestigationCase}`; repeated same key/payload returns same case; conflicting payload 409. |
| `POST /api/investigations/{id}/evidence` | multipart `file`, `kind`, `parentId?`, `clientItemId`; or JSON text/observation submission | 201 `{evidence: EvidenceItem}`; 413/415 explicit before model execution; failed items remain inventoried. |
| `POST /api/investigations/{id}/turns` | `SubmitTurn` + `Idempotency-Key` | 202 `{job: Job}`; only one mutating turn per case revision; 409 stale revision. |
| `GET /api/investigations/{id}` | no body | 200 case; 410 expired; paged evidence/source expansion where needed. |
| `GET /api/investigations/{id}/jobs/{jobId}/events?after={sequence}` | bearer auth | SSE event envelope below; polling job endpoint is equivalent fallback. |
| `GET /api/investigations/{id}/jobs/{jobId}` | no body | 200 `{job: Job, caseRevision: number}`; supports transport recovery. |
| `POST /api/investigations/{id}/jobs/{jobId}/resume` | `{expectedRevision: number}` + idempotency key | 202 same logical job or a bounded continuation; 410 if needed evidence expired. |
| `POST /api/investigations/{id}/jobs/{jobId}/cancel` | `{expectedRevision: number}` | 202 `{status:'cancelled', cleanupStatus:'pending'|'complete'}`; late results cannot republish. |
| `DELETE /api/investigations/{id}` | no body | 202 deletion pending or 204 deletion complete; repeated delete is safe; invalidate all reads immediately. |
| `POST /api/investigations/{id}/device-results` | `DeviceResult` | 202 accepted; duplicate identical result safe; mismatch/stale/unsolicited request 409. |
| `POST /api/investigations/{id}/settings-plan` | `{target: string, device: DeviceProfile}` | 200 `{plan: SettingsPlan}` or 202 research job. |
| `POST /api/investigations/{id}/settings-plan/{planId}/recheck` | `{deviceResultIds: string[]}` | 200 `RecheckResult`; only fresh matching observations can establish success. |
| `POST /api/investigations/{id}/speech` | `{responseRevision: number, section: 'overview'|'explanation'}` | 202 `{job: Job}`; speak only an owner-authorised response revision, not arbitrary unbounded text. |
| `GET /api/investigations/{id}/speech/{audioId}` | bearer auth or validated one-purpose playback ticket | streamed audio; ownership/expiry checked; private/no-store; 410 after deletion. |

```typescript
interface CreateCase {
  gate: Gate;
  question: string;
  submissions: Array<{clientItemId: string; kind: 'text'|'url'; value: string}>;
  initialFindingRefs: string[];
  deviceProfile: DeviceProfile|null;
}
interface SubmitTurn {
  expectedRevision: number;
  message: string;
  answerToQuestionId: string|null;
  evidenceIds: string[];
}
type IngestEvidence =
  | {clientItemId: string; kind: 'text'; text: string; parentId: string|null}
  | {clientItemId: string; kind: 'url'; url: string; parentId: string|null}
  | {clientItemId: string; kind: 'observation'; deviceResult: DeviceResult; parentId: string|null};
interface DeviceResult {
  requestId: string; caseRevision: number; capabilityId: string;
  status: 'observed'|'unavailable'|'permission_required'|'denied'|'failed';
  observedAt: string;
  values: Record<string, string|number|boolean|string[]|null>;
  simulation: null|{kind:'preview_device'; label:string};
}
interface DeviceRequest {
  id: string; capabilityId: string; fields: string[]; reason: string;
  caseRevision: number; expiresAt: string;
}
interface EventPayloads {
  progress: {message: string; phase: 'ingest'|'observe'|'research'|'assess'|'respond'};
  device_request: DeviceRequest;
  question: Question;
  response: {response: HigginsResponse; sources: SourceReference[]};
  retry_scheduled: {retryAt: string; failure: Failure};
  partial: {responseRevision: number|null; reason: Failure; canContinue: boolean};
  completed: {responseRevision: number; cleanupStatus: 'pending'|'complete'};
  failed: Failure;
  cancelled: {cleanupStatus: 'pending'|'complete'};
  expired: {missingEvidenceIds: string[]; cleanupStatus: 'pending'|'complete'};
}
type InvestigationEvent = {
  [K in keyof EventPayloads]: {
    sequence: number; jobId: string; caseId: string; revision: number; at: string;
    type: K; payload: EventPayloads[K];
  }
}[keyof EventPayloads];
```

Example accepted turn response:

```json
{"job":{"id":"job-opaque-id","caseId":"case-opaque-id","turnId":"turn-opaque-id","status":"investigating","deadlineAt":"2026-09-21T12:02:00Z","retryAt":null,"attempt":0,"lastEventSequence":0,"failure":null}}
```

Example failure body (applies to HTTP errors and typed failed events):

```json
{"error":{"code":"evidence_expired","message":"The temporary file copy has been deleted. Select it again to continue that part of the investigation.","retryable":false,"retryAfterSeconds":null,"missingEvidenceIds":["evidence-opaque-id"]}}
```

Do not echo secrets in validation errors. 401/403 are identity/authorisation errors; 404 conceals non-owned cases; 409 revision/idempotency conflicts; 410 expiry; 413/415 unsupported size/format; 429 admission throttling with retry timing; 503 provider capability/configuration unavailable. An external source's 404/DNS error is a tool result, not a global case failure or proof of fraud.

## 8. Gemini tool interfaces and execution rules

Expose these typed tools where appropriate. Use provider-supported search tooling within a controlled research call; do not expose arbitrary shell/SQL/HTTP-with-credentials execution.

| Tool | Arguments | Result |
|---|---|---|
| `read_evidence` | `{evidenceId, start?, end?, pages?}` | content or supported image/file part + coverage + expiry; never unowned storage references |
| `research_public_sources` | `{question, entities: string[], preferredDomains: string[]}` | grounded answer, real sources, retrieval metadata and limitations |
| `inspect_url` | `{urlEvidenceId, purpose, cursor?}` | original/final URL relation, redirects, parsed content segments, source status and coverage |
| `lookup_reputation` | `{evidenceId, kind:'url'|'domain'|'phone'}` | provider result, timestamp, coverage/configuration state; no hit is not identity authentication |
| `request_device_observation` | `{capabilityId, reason, fields:string[]}` | observed result or pending device request; no unsupported capabilities manufactured |
| `lookup_breach` | `{identifierEvidenceId}` | only for an explicitly authorised breach investigation; no credential requests |
| `research_settings` | `{target, deviceProfile}` | `SettingsPlan` with real OEM/platform sources and match status |
| `ask_user` | `{question: Question}` | waiting-user state; only after app/research routes cannot resolve the fact |

Case identity and ownership come from coordinator context, not model-controlled arguments. Tool arguments must validate against advertised capabilities and known evidence IDs. Loop prevention uses typed request fingerprints and progress: do not repeat an unavailable observation endlessly. Conflicting evidence is recorded and investigated, not overwritten.

Research can follow relevant leads beyond initial entities. Preserve the user's useful identifiers in private model processing when necessary; strip authentication tokens, passwords and codes. Public search requests get only minimum relevant public identifiers or paraphrased queries—not the full private submission. If built-in search can formulate uncontrolled queries from its prompt, isolate the research call from private originals and return its sourced findings to the private assessment call. Secret-bearing links must not be followed as authenticated actions. A source is not “official” merely because its page says so or its domain resembles a brand.

Reuse SSRF-resistant outbound fetching with revalidation on redirects, DNS/IP changes, IPv4/IPv6 and response limits. Do not execute untrusted attachments, submit credentials, follow payment actions or enable arbitrary page JavaScript as part of this package. Unsupported content becomes an explicit gap, not an invented inspection result.

## 9. Response and action boundary

Preserve actual accepted Gemini overview/explanation text. Render Markdown safely and link citations to registered sources. Formatting and hiding detail behind an expander must not change the assessment. No `[:900]`, template replacement, forced PayPal conclusion, or generic rewrite of findings.

Validation checks schema, known source/evidence IDs, temporal relevance, completion metadata and the relation between an action proposal and a supported capability. It must not require exact uncertainty words, an imperative last sentence or a particular mascot phrase. A natural clarification question is an acceptable response. Return machine-readable violations to Gemini for one targeted repair; do not substitute a different assessment on failure.

Do not attempt to prove every factual statement with a regex. Use grounded structured findings and, for suspicious unsupported claims, request a source-aware correction. Keep external verification distinct from inference. Biting is derived exclusively through the existing enforcement gate, never a model output field. A quoted phrase from scam material must not itself trigger an unsupported-capability rejection.

Action execution is separate from prose: the backend issues a checked action descriptor with permitted platform operation and parameters; the frontend maps it to known code. Model-generated links/intents are not executed directly. Permission dialogs and settings writes require the appropriate user gesture/OS consent. Read-only checks already authorised for the case do not require repetitive approval.

No response-tailoring engine is included by default. If later added, version its permitted operations, retain the original during processing, prevent semantic alteration and evaluate it separately. The current corrective work should remove ad hoc tailoring rather than create another undocumented layer.

#### 🛠️ Implementation Step-by-Step

## 10. Stage A — faithful evidence, lifecycle and reliable completion

1. **Baseline and migration ownership.** Record the saved SHA and preserve all later valid developer changes. Inventory live callers of `analysis.py`, `ask.py`, `privacy.ts`, `higginsHandoff.ts` and `ApolloContext.tsx`. Mark old unused second-opinion helpers for removal only after caller search; do not infer they are live because a restrictive prompt exists in their source.
2. **Define the shared contracts.** Add the case/evidence/job types above, strict Pydantic validation, generated frontend types and Mongo indexes. Add per-owner revision/idempotency checks. Register new routes with existing authentication. A case reference replaces duplicated route-encoded summaries and becomes the common cross-Gate identity.
3. **Fix false completion immediately.** In `client.ts`, require terminal application completion; successful HTTP EOF alone is interrupted. In `investigation.py`, remove answer slicing and distinguish valid JSON from provider-complete output. UI must not say “verbatim” after alteration. Keep existing local observations visible as observations while a job is incomplete.
4. **Implement evidence ingress and capacity.** Replace 4,000/ten-item privacy restrictions with schema-governed evidence submission. Preserve relevant original content, meaningful URL paths/queries, screenshots and relationships. Redact actual secrets and record transformations without storing secret values. Expose coverage before any synthesis.
5. **File and screenshot lifecycle.** Extend `fileInspection.ts` with format-aware supported extraction as a service, not just ASCII samples. Keep safe local signature checks. Add document/image intake to the case; prohibit executing attachments. Dispose app-created picker cache files/object URLs and upload spools in success/error/cancel paths; sweep after interruption. Never delete the original user's file.
6. **Retention migration.** Replace indefinite `ask_messages`/`ask_handoffs` content with temporary scoped case storage. Clear history must also invalidate cached handoff replies and active jobs. Purge superseded raw chat content under the agreed discard policy; do not delete user-saved Patrol reports indiscriminately. Add provider-file cleanup and local content expiration. No raw prompt/body/response logging in production telemetry.

Also include `backend/routers/voice.py`, `frontend/src/voice/higgins.ts` and `core/auth.py` in Stage A: remove public access to user-derived cached speech, replace cross-user content-hash identity with owner-scoped audio IDs and clean legacy cache entries. Stage B adds the configured speech provider through the shared provider boundary. Remove the 1,500-character narration slice; queue complete sentence-level segments and preserve Cancel/Stop behaviour.

Stage A completion: an accepted item is fully inventoried and retrievable within its processing lifetime; long inputs are not silently lost; interrupted output is never successful; deletion covers all application-managed copies. This stage does not claim full research is delivered.

## 11. Stage B — real Higgins investigation, follow-up and resilience

7. **Provider adapter.** Consolidate Gemini calls and use the owner's existing server key. Replace the Higgins AI wrapper path with Google's supported Gemini client, preserving tool, grounding and finish metadata across every AI modality. Pin a compatible version and document required feature combinations. Configure primary and optional equivalent-capability recovery models explicitly; no non-Gemini AI provider and no Emergent-managed key in any runtime or fallback path. Use model-recommended parameters rather than assuming temperature zero repairs reasoning.
8. **Research and tool loop.** Implement evidence reading, search grounding, safe URL inspection, reputation, device requests and OEM guidance. Replace hardcoded organisation authority with dynamic research. Entity extraction must include unknown organisations and names, not only entries in a brand dictionary. Additional Gemini-discovered entities must trigger actual lookups when useful—not appear only after all research has finished.
9. **Revisable assessment.** Retain initial deterministic signals, but allow Gemini's reasoned assessment to revise the conclusion. Remove forced warning from `local_state` and forced callback-template substitution. Maintain separate current protection state and enforcement events. A changed interpretation never rewrites evidence or removes an existing protective rule automatically.
10. **Unify Ask and Gate investigation.** Route all ten Gates into the same case, with recent sources, originals still within lifetime, unresolved questions and tool history. Follow-ups can research rather than only rephrase. A switch to another Gate adds observations to the existing case. Preserve user-selected context and avoid repeating questions already answered by app observations.

Correct the existing Retry bug as part of this step, even before full migration: use separate initial-handoff identity and per-turn request identity. A second question must never reuse the initial-answer cache key. Update conversation counters to count terminal successful responses, not merely nonempty partial text. Clear issue context/query parameters after transfer; route through opaque case references instead of serialised findings in browser URLs. In `threatScent.ts`, remove generic-brand substitution and automatic category-count escalation; correlation is a lead to investigate, not an independent threat finding.
11. **Resilient job execution.** Start work with a short 202 response. Workers use leases with expiry, fencing revisions and step-level idempotency. Recover abandoned processing states after lease timeout; reject late workers. Stream sequenced events with polling fallback. A disconnected client does not create a second investigation. General chat and structured handoffs share this reliability path.
12. **Retry policy.** Classify configuration/auth/input failures as non-retryable; transient network/provider/rate-limit failures use exponential backoff and jitter with provider retry guidance, within the job deadline. Proposed default: initial call plus two transient retries; one semantic correction; at most one capability-matched model switch per turn. These budgets are versioned operational defaults, not model-quality shortcuts. Reuse completed tool results where fresh; do not duplicate paid lookups or permissions. Honour cancellation between steps and during provider calls where supported. If exhausted, show partial/incomplete plus Retry/Continue—not `_fallback()` as Higgins.
13. **Output presentation.** Replace blanket phrase validators with the explicit response contract. Render actual overview and expandable explanation with sources; no hard total word ceiling. Short clear status/error messages may be deterministic, but must never impersonate a completed investigation. Show what is still being examined and whether a source failed.

Google's [troubleshooting guidance](https://ai.google.dev/gemini-api/docs/troubleshooting) supports classifying retryable failures and using backoff; account for the chosen SDK's own retries so nested retries do not multiply silently. Provider recovery must preserve required research capabilities.

Stage B completion: realistic scenarios trigger genuine research and follow-up, Higgins can resolve app-answerable questions, and a provider interruption recovers or ends honestly without template substitution.

## 12. Stage C — Gate-specific closure and guided device actions

14. **Text/Link/Site/Email.** Keep original message structure, display-link versus destination distinctions, redirect chains, timestamps and source context. Remove blanket TLD suspicion as a conclusion. Treat unknown official domains as research questions, including legitimate regional and delegated services. Original screenshot is available to the model when relevant; OCR is an auxiliary observation. Distinguish email attachment filename from actual content. For connected email, maintain read-only OAuth and explicit monitoring opt-in; never add IMAP/password fields.

Keep actual `url_context` redirect/final-URL and domain observations in the model input rather than reducing them to verdict labels. Refactor blanket phone/email/IP redaction to a purpose-aware boundary: an IP tied to a suspicious destination can be evidence; a user's unrelated IP is not needed. The main Link reputation call currently reduces the input to origin-only via `minimalIndicator`, while later investigation may check a fuller URL; reconcile those two assessments explicitly so path-specific threats are not hidden behind an origin-only “clean” label. Do not transmit actual authentication secrets, and do not follow tokenised links whose retrieval itself performs a sensitive action.
15. **Call/Account.** Send transcript/circumstances and relevant observed data into the case. Phone lookup region must derive from a valid international number or known context, not universal AU. Caller reputation is not identity. Ask only about user actions/intent, never codes or passwords. HIBP results and account-provider notices are different evidence. No password/username collection workflow; an email supplied solely for an explicit breach lookup remains purpose-limited, not an account credential store.
16. **App/Device observations.** Update Apollo-owned native contracts to report requested permissions separately from granted permissions and enabled special access. Preserve unsupported/read-error as unavailable, not an empty inventory. Report Android active admins as active admins rather than all device-management profiles. Catalogue scope is explicit. Extend app assessment for a selected observable package where supported; research package/publisher/store provenance without asserting visibility beyond OS access. Keep dormant capability and active behaviour separate. Treat Apollo's stopped service as a protection gap, not proof of tampering.
17. **Network/File.** Use real available network signals and a typed unavailable result for encrypted traffic/process attribution the platform cannot expose. File analysis checks supported actual content with coverage, cross-Gate links and safe further reading. Archive contents, unsupported binaries and encrypted material are explicit limitations; do not invent full malware scanning.
18. **Settings guidance.** Replace `deviceSettings.ts` generic paths with typed plans. Capture available platform/manufacturer/model/OS/locale; ask for a missing device detail only when it changes instructions. Research official OEM/platform documentation and record applicability. Allow (a) OS permission request/direct supported operation after consent, (b) deepest supported settings link plus persistent instructions, (c) exact sourced navigation instructions. No arbitrary settings-intent generation. When no matching instructions are established, explain that limitation and provide the verified support source rather than guess.
19. **Settings outcome.** Bind the plan to a target capability and expected value. On return or “Check again”, collect fresh target observations and compare; return correct/not-yet-correct/cannot-observe/failed. Do not simply rerun the whole device screen and announce success. OS “opened settings” is not “setting fixed”. Keep appropriate user-confirmed completion distinct if the OS cannot expose verification. Windows/macOS guidance can be delivered without implementing their enforcement adapters.
20. **Preview isolation.** Move allowed device fixtures behind a preview-only entry point and visible field-level origin labels. Remove static mock imports from normal native bundles; reject native mock mode in all ordinary build profiles, not only production. Unused SecureCore stubs become explicitly unavailable, not fake crypto/security operations. Real app logic, Gemini and external lookups remain live in preview. A missing native module fails honestly; it does not choose simulation automatically.

Stage C completion: every Gate has its evidence and investigation path, platform limits are specific, and settings journeys offer the best supported action with a meaningful outcome check. No physical acceptance is implied by browser evidence.

## 13. Stage D — scenario acceptance and release handoff

21. **Repair the regression harness.** Preserve the existing runner command and useful journeys. Store immutable run directories with source SHA, frontend/backend build/config identity, scenario catalogue version, model/tool configuration and explicit run selection. Write a latest-index pointer, not destructive replacement of coverage. Track NOT RUN in addition to complete/partial/failed/blocked.
22. **Run real user journeys.** Only scenario submissions and explicitly marked preview-only device inputs are simulated. Gemini, research, lookups and app logic are real. Fault recovery scenarios may deliberately disconnect transport or use a test-only error-injection proxy; label this failure injection and never inject successful findings. No runtime mock endpoints or fake research responses. No testing agent without approval.
23. **Assess meaning, not magic words.** Expected outcomes describe actual facts, uncertainty, useful questions and working actions. Use interaction assertions and source/tool records; reserve qualitative judgement for a transparent reviewer rubric. If model-assisted grading is used, it is separately labelled and cannot alone establish success. Exact source text varies; required evidence relationships do not. Do not award accuracy just because forbidden words are absent.
24. **Final handoff.** Deliver changed-file list, requirement coverage, per-Gate outcomes, live reports, unresolved platform/provider limitations, capacity policy, configured capability matrix and retention design. Reconfirm frozen GuardDog continuity through source comparison. Complete the authorised package rather than asking approval after each file/stage. Save final source and identify its SHA; do not claim tests/builds that were not run.

#### 🛡️ Edge Cases & Error Handling

## 14. Required failure behaviour

| Case | Required result |
|---|---|
| Scam clue after character 4,000, link 11 or page excerpt 800 | Full input inventory and relevant chunk retrieval; clue considered or explicit incomplete coverage. Never a clean conclusion based on the prefix. |
| Gemini discovers a new number/name mid-investigation | Actual tool lookup/research if relevant; distinguish a search lead from established association. |
| Lookalike site has DNS failure, no reputation hit | Unavailable inspection and inconclusive reputation; explain other actual concern without inventing takedown or unauthorised ownership. |
| Legitimate delegated/region-specific organisation domain | Research relationship; revise initial brand mismatch if supported. A static allowlist cannot decide. |
| Dangerous-looking content contains legitimate quoted warnings | Treat quoted text as evidence, not instructions or automatic rule triggers. Investigate context. |
| Provider stops at token limit, even after punctuation or parseable JSON | Inspect finish metadata; request continuation/correction or mark partial. Punctuation is not completeness. |
| HTTP stream closes without completion event | Reconnect/poll job; never call successful completion merely because status is 200. |
| 429/503/timeout | Backoff within budget, visible reconnecting state and no duplicate work; incomplete result with usable Retry if exhausted. |
| Invalid key/unsupported model/tool combination | Configuration failure with operator diagnostic; do not endlessly retry or silently drop tools. |
| User cancels while provider request completes | Cancellation revision wins; discard late content and clean it up. No new Patrol result or resurrected conversation. |
| Server dies with job marked processing | Expired lease permits recovery with fencing; original worker cannot publish after takeover. |
| Duplicate submit/retry across devices or reconnect | Same owner/key/payload returns same operation. Different payload under same key is 409; no concurrent double action. |
| Initial Higgins answer succeeds; later follow-up fails and is retried | Retry the later turn, not the original handoff; never display the initial cached answer as a successful reply to the new question. |
| One source disagrees with another | Preserve both, assess source dates/authority and explain uncertainty; research further if useful. |
| Long case exceeds processing lifetime | Purge required content; 410 with exact resubmission requirement. Do not silently extend raw retention. |
| Image/document contains password or code | Secret redaction in every relevant modality before avoidable transmission; preserve useful surroundings and record loss. Never request the secret. If safe isolation is impossible, ask for a corrected submission. |
| File metadata unknown or parser encounters decompression bomb | Enforce streamed byte/expanded-content/time bounds before excessive allocation; return unsupported/partial. Never execute file. |
| Provider file deletion fails | Local content access revoked; tracked bounded cleanup retry, no false “all copies deleted” claim; provider policy stated accurately. |
| User asks Higgins to read an investigation aloud, then deletes it | Audio is owner-scoped and temporary; cancel queued generation/playback and remove controlled cache copies. No public year-long audio URL. |
| Settings opens but user changes a different item | Target-specific recheck reports not-yet-correct or cannot-observe; user confirmation alone is not observed success. |
| Device observation missing, stale, simulated or denied | Status preserved through model context/UI; unknown never becomes false/empty/clean. Native normal builds reject simulations. |
| User revisits after evidence purged | Show any explicitly saved redacted report as historical; request new data for fresh claims. |
| New research lowers the initial concern | Update assessment with explanation; retain original observations and actual enforcement history. Do not auto-unblock or silently change protection rules. |
| Gmail disconnected or OAuth expires | Explicit reconnect through provider consent; no username/password alternative. No false mailbox completion. |

#### 🧪 Testing Criteria

## 15. Scenario-first acceptance catalogue

These are developer instructions for the authorised implementation, not tests executed by this review. Preserve the reusable scenario runner. Each fixture has an input-only scenario file and separate expected outcomes; never supply expected diagnosis to Higgins.

| ID / real situation | Gates and expected detection | Expected investigation and Higgins outcome |
|---|---|---|
| S01: Browser displays “your phone is infected” and a support number | Site, Link, Call as relevant; suspicious page behaviour/content | Inspect actual supplied page/image, research claimed provider and number, explain scare tactics and one practical action; never claim device infection from the popup. |
| S02: Regional business sends a legitimate invoice from an unfamiliar delegated domain | Email, Link | Research organisation/domain relationship; revise a weak local suspicion where supported, identify remaining payment uncertainty, do not rely on brand table. |
| S03: Long message contains the payment-redirection request after character 10,000 | Text, Account if payment made | Find the late clue, connect it to the earlier context and ask only whether user acted. Full coverage accounting required. |
| S04: A message includes 25 distinct URLs; relevant fraudulent destination is number 24 | Text, Link | Inventory all URLs, inspect relevant destination and relationships, record failures/continuation honestly. No first-ten omission. |
| S05: Claimed bank call supplies three numbers, including a distinct callback number | Call, Account | Distinguish caller ID, callback and independently sourced contact; investigate third number, ask about actions but never request code. |
| S06: Expected appointment reminder with no payment or credential request | Text, Call where relevant | Avoid inventing suspicion; explain findings proportionately and allow no action if warranted. No forced alarming template. |
| S07: Public Wi-Fi portal asks to install a profile | Network, Device, File | Inspect submitted portal/profile evidence, explain available observations and investigate correct device-specific removal guidance if installed. |
| S08: User receives account reset they did not initiate, then reports entering a code | Account, Link | Preserve conversation; investigate recovery implications, research official steps and propose one immediate action. No password/code collection. |
| S09: Gmail message references an invoice attachment but bytes are unavailable | Email, File | Explain that filename is not inspection; obtain authorised bytes or ask the user to select the file. Keep source context. |
| S10: Legitimate remote-support app is installed but dormant | App, Device | Report capability versus active use; research actual package/publisher where visible; ask whether support was expected only if necessary. Inactivity is not safety and installation is not malice. |
| S11: Google Drive download is an executable disguised as PDF | File, App if installed | Use actual signature, explain mismatch and source irrelevance, investigate next action using what the user did. No generic malware scan claim. |
| S12: Supported 50-page document contains deceptive links on page 47 | File, Link | Parse relevant complete content/pages, retain visual context where useful, inspect late links and explain evidence; explicit partial for unreadable pages. |
| S13: User's Apollo protection permission changed | Device, Network/Site | Observe actual gap; research exact OEM/OS guidance; open supported path and recheck target. No tampering claim from stopped service alone. |
| S14: User returns from Settings without granting the permission | Device | Specific not-yet-correct outcome with next step; no “fixed” from pressing Done. |
| S15: Same Settings problem on Android, iOS, Windows and macOS | Device | Each gets matched official guidance and honest action/observation capability. Browser test does not claim actual OS setting verification. |
| S16: Twelve-turn investigation, user later contradicts an early assumption | Relevant Gates share one case | Retrieve unresolved facts, update conclusion and retain original/revised distinction; do not forget after eight messages. |
| S17: Gemini connection drops during answer and recovers | Any Gate | Same job resumes; no duplicate findings; actual completed explanation delivered once. |
| S18: Gemini rate limit, then unavailable; one external source also fails | Link/Text | Backoff, use another Gemini model only if owner-configured and capability-compatible, preserve completed research and show honest remaining gap. No canned investigation answer. |
| S19: User cancels/deletes during investigation, then retries after expiry | File/Text | All managed temporary copies inaccessible/deleted according to policy; expired evidence explicitly requested again; no replayed cached private answer. |
| S20: Prompt injection embedded in webpage or file | Link/File | Ignore instructions in evidence; investigate content; no credentials/search leakage, arbitrary actions or fabricated sources. |
| S21: Preview contains simulated device signal; normal native build configured identically | Device/Network | Visible simulation origin throughout preview; normal native build rejects or excludes simulator. All Gemini/lookups real. |
| S22: Unknown organisation/name absent from all application catalogues | Any relevant Gate | Actual research and identity/association distinctions; honest ambiguity for common names, not invented ownership. |
| S23: Screenshot layout contradicts OCR-only reading | Text/Account | Gemini can inspect original image and revise mistaken extraction; disclose unreadable sections. |
| S24: Provider answer exceeds 900 characters and ends with a useful question | File/Device | Preserve full accepted answer, no style-based rejection; user answer continues investigation. |
| S25: First answer succeeds; second question fails once and user taps Retry | File/Device | Actual second question is answered exactly once; initial cached answer is not replayed as its answer. |
| S26: Person checks one benign delivery notice through Email and Link | Email, Link | One case, no invented courier identity and no automatic Barking solely because two Gates ran. |
| S27: Long Higgins explanation is read aloud and then deleted | Any Gate | Complete chosen section is spoken in order; stop/retry work; no silent tail truncation; protected temporary audio is deleted with the case. |

For each run capture: scenario version; exact source/build identity; environment; actual model/tool capability config; all selected and skipped journeys; what the user saw; actual tools/sources used; relevant evidence coverage; outcomes and reason. Synthetic scenario artifacts may be retained as regression data. Do not retain real personal raw submissions in test reports.

Acceptance rubric: correct relevant Gates; important clues followed; app-answerable questions resolved automatically; real research when needed; accurate distinction between observation/inference; useful explanation and action; continued context; full or explicitly incomplete coverage; no unsupported protection claims. Review benign and ambiguous outcomes, not just threats. Compare selected scenarios with direct Gemini using equivalent user material, and document the benefit of Apollo's additional evidence rather than asserting universal superiority.

## 16. Focused contract and integration regressions

These support the scenario suite; they do not replace it. No new tests were run during this review.

1. Evidence segmentation reconstructs the complete normalised input and preserves offsets, late clues, URLs and duplicates; omitted ranges are explicit.
2. Case ownership rejects cross-device evidence/source/job IDs; same-key payload conflicts return 409.
3. Cancellation fencing discards a late response; lease takeover prevents double publication; replay sequence is stable across reconnect.
4. Provider finish reason and terminal event are both required; punctuation and valid JSON alone cannot establish completion.
5. Retry classification, Retry-After, total attempt/deadline budget and SDK retry interaction behave as specified; invalid-key loops are impossible.
6. Prompt/evidence content cannot introduce tool authority or executable intents; unsupported actions cannot be executed by prose.
7. Research with private material emits only approved minimum public query information; raw content is not logged or stored beyond its lifecycle.
8. Delete/expiry clears content and cached handoffs, prevents resurrection from in-flight workers and handles cleanup failures truthfully. Test TTL lag as well as explicit cleanup.
9. Requested permissions, granted permissions, missing reads and actual empty values remain distinct end to end.
10. Settings completion requires fresh matching observations; user confirmation/cancel/different setting cannot yield observed success.
11. Genuine model questions, long answers and varied uncertainty language survive validation; invalid source IDs and unsupported enforcement claims trigger repair/incomplete, not templates.
12. Native packaging excludes preview simulators and their activation paths; browser preview labels fixture origin; missing native capability is unavailable.
13. Existing packet-evidence acceptance rules, call/non-packet separation and immutable delivery/idempotency remain unchanged.
14. Saved runs retain requested scope; a three-journey rerun cannot make seven omitted journeys disappear or count them complete.
15. Failed follow-up retries use a turn-specific cache key, not the first successful answer's handoff ID; nonterminal text does not increase completed-answer counts.
16. Read-aloud retrieval rejects another owner, expires with the case and never emits a public caching header for user-derived content; the spoken last sentence is retained.

Transport fault injection and provider-adapter contract fixtures belong only in isolated test code and are explicitly fault simulations, never app-runtime mock findings. End-to-end acceptance continues to use real provider responses and lookups.

## Consolidated requirements disposition at the reviewed commit

| Requirement | Review disposition | Closure |
|---|---|---|
| Ten selectable Gates and supporting local checks | Implemented in reviewed integration paths; completeness differs by Gate | Preserve; Stage C closes each evidence path. |
| Faithful originals plus available app/device evidence | Partial; summaries, lossy redaction and excerpts dominate | Stage A evidence contract; Stage B on-demand retrieval. |
| Use only owner-managed Gemini; no Emergent-managed service keys | Analysis reads `GEMINI_API_KEY`; deployed owner/config not verified; speech uses separate provider/key | Stage B capability/config registry and speech migration. |
| Full relevant research, unknown organisations and official-source discovery | Missing in reviewed investigation/Ask tool configuration | Stage B research tools and entity follow-through. |
| App resolves Gemini's follow-up evidence requests | Missing; Ask is explanation-only | Stage B device/research tool loop. |
| Actual model explanation reaches user without templates | Partial; Ask improved, shared investigation still replaces/slices | Stage A completion fix; Stage B removes substitutes. |
| Gemini can revise initial assessment | Defective/restricted | Stage B revised assessment projection, separate enforcement. |
| Real processing capacity and disclosed coverage | Partial limits; missing complete inventory/continuation | Stage A central policy and segmented retrieval. |
| Retry/resume without canned answers | Partial; timeout mismatch, wrong follow-up cache and no robust leases | Stage A/B job/turn identity and recovery. |
| Purpose-limited content, then purge | Partial; chat/handoff/audio/cache lifecycle gaps | Stage A cleanup and migration; provider policy accounted for. |
| No password/username collection; Gmail OAuth allowed | Approved flows are password-free in reviewed account/Gmail paths; no whole-repo historical credential scan performed | Preserve and include secrets/modalities regression. |
| Three Settings assistance paths and OEM-specific instructions | Partial navigation; researched matching missing | Stage C settings service. |
| Confirm correct setting after user returns | Partial general refresh; missing target-bound outcome | Stage C fresh observed recheck. |
| Existing/dormant apps and Apollo health | Partial and platform-limited; ambiguous native permission semantics | Stage C observation contract and researched interpretation. |
| Native mock exclusion / clearly marked preview-only device substitutes | Defective configuration policy relative to latest requirement | Stage C packaging and runtime boundary. |
| Real reusable user scenarios across every Gate | Suite exists; latest saved browser run is incomplete subset with two failures | Stage D immutable coverage and semantic acceptance. |
| Plain explanation, useful action, deeper detail and accessible read-aloud | Partial; fixed output limits, generic guidance and speech truncation | Stage B/C rendering/action/audio work. |
| Frozen GuardDog unchanged; physical Stage 1D cancelled | Frozen blobs match prior reviewed snapshot; cancellation retained | Preserve; not a new native certification claim. |

## 17. Definition of done and developer handoff

- Every requirement below has a code location and outcome: ten Gates; faithful originals; capacity/coverage; dynamic organisation and OEM research; app-assisted follow-up; contextual continuity; revisable assessments; actual model explanation; resilient jobs; deletion; credential-free input; guided Settings; preview isolation; live scenario regression.
- Remove old investigative template/fallback branches once routes migrate; do not leave dormant feature flags that can silently re-enable them in ordinary app builds.
- Provide one requirements matrix with implemented/partial/missing/defective/platform-limited status. A platform limitation requires its concrete unavailable capability, not a generic disclaimer.
- No blanket “all green” from the deterministic 35 or isolated unit totals. Report actual live journey counts and remaining incomplete outcomes.
- No routine permission requests between steps. The developer may resolve normal implementation details. Explicitly identify external input blockers with completed surrounding work.
- Do not change frozen GuardDog packages or public enforcement semantics; do not restart cancelled physical Stage 1D work. No production-default enforcement cutover is authorised by this investigation redesign.

## Source pointers for reviewers

All links below are pinned to the reviewed commit. Proposed files above do not yet exist by virtue of this document.

- [Shared investigation: sources, limits, templates, forced state and output slicing](https://github.com/zelnix/Apollo/blob/33a23830cc8ac5fb34929542184fc29abff60d97/backend/services/investigation.py)
- [Ask Higgins: prompts, validation, retry, history, persistence and deletion](https://github.com/zelnix/Apollo/blob/33a23830cc8ac5fb34929542184fc29abff60d97/backend/routers/ask.py)
- [Analysis endpoints, upload limits, app catalogue and HIBP](https://github.com/zelnix/Apollo/blob/33a23830cc8ac5fb34929542184fc29abff60d97/backend/routers/analysis.py)
- [Backend startup indexes](https://github.com/zelnix/Apollo/blob/33a23830cc8ac5fb34929542184fc29abff60d97/backend/server.py)
- [Frontend evidence restrictions and egress](https://github.com/zelnix/Apollo/blob/33a23830cc8ac5fb34929542184fc29abff60d97/frontend/src/domain/privacy.ts)
- [Higgins summary handoff](https://github.com/zelnix/Apollo/blob/33a23830cc8ac5fb34929542184fc29abff60d97/frontend/src/domain/higginsHandoff.ts)
- [Frontend timeout and SSE completion](https://github.com/zelnix/Apollo/blob/33a23830cc8ac5fb34929542184fc29abff60d97/frontend/src/api/client.ts)
- [Assessment UI verbatim/fallback labels](https://github.com/zelnix/Apollo/blob/33a23830cc8ac5fb34929542184fc29abff60d97/frontend/src/components/MessageAssessmentResult.tsx)
- [Apollo state and message/email/link orchestration](https://github.com/zelnix/Apollo/blob/33a23830cc8ac5fb34929542184fc29abff60d97/frontend/src/store/ApolloContext.tsx)
- [File picker and lifecycle](https://github.com/zelnix/Apollo/blob/33a23830cc8ac5fb34929542184fc29abff60d97/frontend/app/file.tsx)
- [File byte/sample bounds](https://github.com/zelnix/Apollo/blob/33a23830cc8ac5fb34929542184fc29abff60d97/frontend/src/domain/fileInspection.ts)
- [Device observations and refresh](https://github.com/zelnix/Apollo/blob/33a23830cc8ac5fb34929542184fc29abff60d97/frontend/app/device.tsx)
- [Settings navigation](https://github.com/zelnix/Apollo/blob/33a23830cc8ac5fb34929542184fc29abff60d97/frontend/src/utils/deviceSettings.ts)
- [Native Android App/Device observation semantics](https://github.com/zelnix/Apollo/blob/33a23830cc8ac5fb34929542184fc29abff60d97/frontend/modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/AppDeviceSignals.kt)
- [Security configuration allowing native dev/staging mocks](https://github.com/zelnix/Apollo/blob/33a23830cc8ac5fb34929542184fc29abff60d97/frontend/src/security/securityConfig.ts)
- [Latest saved live report](https://github.com/zelnix/Apollo/blob/33a23830cc8ac5fb34929542184fc29abff60d97/test_reports/round1_expected_vs_actual_live.md)
- [Scenario runner and keyword-based grading](https://github.com/zelnix/Apollo/blob/33a23830cc8ac5fb34929542184fc29abff60d97/tests/run_round1_user_scenarios.py)
- [Ask screen follow-up Retry identity and completion counters](https://github.com/zelnix/Apollo/blob/33a23830cc8ac5fb34929542184fc29abff60d97/frontend/app/%28tabs%29/ask.tsx)
- [Threat correlation and automatic multi-Gate escalation](https://github.com/zelnix/Apollo/blob/33a23830cc8ac5fb34929542184fc29abff60d97/frontend/src/domain/threatScent.ts)
- [Speech provider, persistent cache and public response](https://github.com/zelnix/Apollo/blob/33a23830cc8ac5fb34929542184fc29abff60d97/backend/routers/voice.py)
- [Read-aloud truncation and playback lifecycle](https://github.com/zelnix/Apollo/blob/33a23830cc8ac5fb34929542184fc29abff60d97/frontend/src/voice/higgins.ts)
