# Gemini-only migration and architectural package status

**Date:** 2026-09-21. **Overall package: PARTIAL, not accepted as a completed ten-Gate rebuild.**

## Controlling instructions

The owner supplied `Apollo_Final_Code_Review_and_Developer_Package-2.md`, replacing package 1:
https://customer-assets-agu9un31.emergentagent.net/job_eb20d237-74e3-4864-b4b7-3c0adf4d1c8d/artifacts/acbopy2u_Apollo_Final_Code_Review_and_Developer_Package-2.md

Source-identity correction: the specification's upstream `e08d318...` commit cannot be resolved in this
fork's local Git history. The available starting reference is `33a2383`. The earlier conversational
statement that the checkout matched the reviewed commit was not established. Current working source
must be identified by its file hashes; the Git base alone does not include or prove these new changes.

All AI must use the owner's direct Gemini credentials: investigation, explanation, screenshot processing,
transcription and speech. No managed keys, gateways or alternative AI providers. Existing security-data
services and Gmail OAuth remain separate. No testing agent is authorised without explicit owner approval.
Physical Stage 1D remains CANCELLED; desktop native adapters remain backlog.

## Implemented and directly checked

- `backend/services/higgins/provider.py`: direct `google-genai` transport, explicit capability registry,
  account model metadata, complete-input token admission with an explicit wrapper reserve, SDK retries
  disabled, provider finish reason and usage preserved. Non-STOP responses are incomplete, never repaired
  into a canned answer. Registered recovery configuration is not yet used by a recovery coordinator.
- Active text model: `gemini-3-flash-preview`; vision/transcription use that compatible model.
  Speech: `gemini-3.1-flash-tts-preview`, configurable Higgins voice. These are actual tested account
  selections, not a claim that every registered/configurable model was tested.
- Removed runtime managed integration imports, managed key configuration and installed
  `emergentintegrations`, `litellm`, `openai` dependencies. No alternate-provider fallback remains.
  `scripts/check-gemini-configuration.py` checks active runtime/configuration/dependency boundaries.
- Migrated screenshot extraction, webpage interpretation, voice transcription and narration to the
  direct adapter. Deleted the unused message/app/account rewrite helpers and their authoritative-verdict
  prompts. Existing analysis routes retain compatibility response shapes.
- Investigation explanations and findings are no longer sliced or replaced by deterministic Higgins
  assessments. An unavailable answer has an empty explanation and explicit incomplete UI status.
  Evidence/source failures remain distinguishable from completion of the provider call.
- Ask uses separate stable turn IDs, payload-integrity checks, fixed scope expiry, recoverable pending
  leases, encrypted messages/context/responses, and deletion generation checks. A retry replays that
  turn, not the first question. EOF without both provider completion and application `done` is an error.
- General questions can retry. The UI counts only completed answers, stops voice during deletion,
  clears its query cache, and expires loaded conversation content at the server deadline. Rendered
  model prose no longer turns special text markers into executable UI actions.
- Handoff navigation now transfers private context in process memory and places only an opaque ID in
  the route. This is NOT yet the required full server-owned `InvestigationCase` handoff architecture.
- Speech now uses authenticated owner-specific audio IDs, encrypted expiring audio, read-time expiry,
  `private, no-store`, cancellation invalidation, and late-response fences. Narration is segmented without
  dropping the suffix; browser playback uses a revocable authenticated Blob rather than a public URL.
- Temporary legacy plaintext Ask/handoff/voice rows are discarded on startup. Expiry is checked before
  serving content, independently of Mongo TTL. A cleanup worker and owner deletion remove content copies;
  content-free scope tombstones remain to prevent stale reference reuse. Patrol reports are not purged.
- File picker copies are cleaned only within Apollo's owned picker directory; shared originals are never
  deleted. Metadata no longer retains the browser File/blob/data URI. Crash-recovery sweeping and local
  evidence expiry exist, but native cleanup has NOT been physically verified.
- Removed three-page/three-number investigation sampling and the manual message/email ten-link/four-
  thousand-character slices in the changed paths. A versioned policy rejects oversized transport work
  explicitly. Static-page text omissions include coverage ranges; this is not a whole-document pipeline.
  A shared absolute 120-second compatibility-route deadline includes queued external lookups. Timeout
  cancels outstanding work and returns explicit HTTP 504, not a completed or fabricated assessment.
- Incident correlation no longer maps generic brands to named organisations, joins independent checks
  just on brand/host similarity, or raises severity merely because more Gates were used. Broader typed
  relationship evidence and cross-case joins remain unfinished.

## Configuration, key ownership and migration boundaries

The existing owner's `GEMINI_API_KEY`, Gmail configuration/keys, database credentials and framework
configuration were preserved. A separate investigation-content key was generated locally, stored in a
0600 file under the git-ignored `backend/.secrets/` directory and referenced by `INVESTIGATION_KEY_FILE`.
It is not derived from or interchangeable with the Gemini/Gmail credentials. The creation utility refuses
to overwrite an existing key and never prints a value. Preserve this key in an owner-controlled persistent
secret location and keep a protected backup before moving environments. It is not part of a Git export.

Google account-side retention is NOT independently verified by these API checks. No report should claim
zero provider retention. No Gemini Files objects are created by the current inline-processing adapter.

### Currently unavailable — exact owner configuration/access needed

| Flow | Current behaviour | Needed for a direct replacement |
|---|---|---|
| Guardian email | Explicit HTTP 503; no send and no fake-success recipient | `RESEND_API_KEY`, a verified `RESEND_FROM_EMAIL` and sender-domain authorisation |
| Push delivery/registration | Explicit HTTP 503; no relay submission | Owner Expo push/project access, delivery credential policy and native token re-registration/migration |
| Family voice-note upload/playback | Explicit HTTP 503, no new upload | Owner-controlled object-store endpoint/bucket/access credentials and access to migrate or erase historical managed objects |

These flows are **not working**. Removing an unapproved dependency was required, but disconnecting it is
not completion of its replacement. Historic externally stored family audio has NOT been claimed erased.
Gmail read-only OAuth, configured reputation/HIBP services and native enforcement code were not replaced.

## Direct verification performed (no testing agent)

| Check | Actual result | Scope |
|---|---|---|
| Python import/compile/static checks | Pass after removal of obsolete imports | Code checks, not semantic acceptance |
| TypeScript and edited-frontend ESLint | Pass | Code checks |
| Owner-key runtime/configuration guard | Pass | Does not certify whole-package readiness |
| General Gemini Ask | Real response, provider STOP + application done | Direct owner key, no injected answer |
| Same-turn replay / mismatched payload | Exact replay; changed payload returns 409 | Turn identity |
| Follow-up retry | Replays follow-up, not original answer | Actual separate Gemini response |
| Speech generation | Actual Gemini WAV returned | API synthesis, not human/native voice acceptance |
| Audio access | Unauthenticated 401; other owner 404; owner 200; no-store | Owner isolation |
| Audio deletion | Subsequent access unavailable | Temporary audio invalidation |
| Transcription | Actual generated WAV transcribed by Gemini | No alternate provider |
| Screenshot | Actual synthetic image extracted by Gemini with STOP and usage | No injected OCR/AI answer |
| Long text | All 13,863 supplied characters processed; STOP | Not a fifty-page PDF or all-file-format acceptance |
| Narration segmentation | All 5,832 characters reassembled exactly across five bounded sections | Pure local invariant; not five native playback sections |
| Encrypted conversation | Actual completed user/answer records encrypted; no plaintext content fields | Database inspection on dedicated verification identity |
| Hard expiry | Same-turn retry does not extend expiry; expired reference returns 410 before TTL | Isolated synthetic expiry drill |
| Absolute work deadline | Cancels both outstanding child tasks; explicit 504 non-completion | Isolated scheduling drill, not a mocked provider |
| AI opt-out | Route schema preserved; zero model attempts and no invented answer | Actual API request |
| Delete while Gemini runs | No completion delivered and no owner content repopulated | Real in-flight provider request, not a provider mock |
| Mobile preview | Real answer reaches completed UI; clear-history removes transcript | 390 × 844 web preview, not physical-device evidence |
| Local regression preflight | 35/35 | Local application logic only |
| Native/package preservation | 126 tracked files unchanged from fork baseline `33a2383` | Not native build/device acceptance |
| Full ten browser journeys | **NOT_RUN** in this iteration | No inherited or inflated completion claim |

The immutable preflight report is:
`test_reports/round1_runs/20260921T052622-36a53a2b/round1_expected_vs_actual_repeatable.json`
and its Markdown sibling. All ten browser journeys are explicitly NOT_RUN. The runner now creates unique
run directories, records commit/scenario/source metadata and updates a separate latest index rather than
overwriting historical journey reports. Expanded semantic AR11 coverage is still pending.
The final run fingerprints 194 application/harness source files; the Git commit field is explicitly only
the base reference. Earlier runs and the inherited live report are preserved unchanged.

### Defects actually traced during verification

1. The Developer API rejects Vertex-only `CountTokensConfig.system_instruction/tools`. Token admission
   now counts complete content plus a system/schema surrogate and reserves wrapper overhead. The image
   was not the cause. A real screenshot retest passed; route errors now distinguish provider failure.
2. The inherited Higgins persona supplied example state claims. A real follow-up echoed an unobserved
   Apollo state. Those examples were removed and state/inference separation clarified. A subsequent live
   UI answer did not claim an attack or a state change. This does not prove universal claim grounding.
3. Existing redaction treated “one-time code with” as an actual code and changed 13,863 characters to
   14,283. Normal policy language is now preserved while explicit `password=...` and numeric code values
   remain redacted. The actual long-input retest matched all 13,863 characters. This is not a complete
   secret-detection guarantee, particularly for images and unlabelled credentials.
4. Manual probes initially used the wrong app-version length, response field and push route. Those were
   verification assumptions, not application/provider failures. Probes were corrected to the actual
   contract. An upstream Git reference was also unavailable, as noted above; no commit identity was invented.

## Architectural acceptance matrix — honest remaining scope

| Requirement | Status | Remaining work |
|---|---|---|
| AR01 shared tool investigation | NOT IMPLEMENTED | Full typed case/evidence/coverage/source/verdict/response models; bounded tool coordinator; durable jobs and progress/cancel/resume |
| AR02 revisable hypotheses | PARTIAL | Gemini can reconsider supplied observations; remove remaining static authority assumptions and reconcile final Gate UI states |
| AR03 model-selected organisations | NOT IMPLEMENTED | Public grounded research and verified official contacts, not a local brand dictionary |
| AR04 phone facts | PARTIAL | Configured reputation retained; contextual number extraction/country inference/ownership research and full dispositions |
| AR05 faithful response | PARTIAL | No canned Higgins substitution or answer clipping; full typed provenance/meaning contract and semantic suite remain |
| AR06 original evidence into case | PARTIAL | Opaque navigation and encrypted retained compact context; full source/document/attachment case ingest absent |
| AR07 async job semantics | PARTIAL | Turn identity, completion, leases, expiry and deletion tested; durable job coordinator, persisted snapshots and exact transport-failure recovery absent |
| AR08 real files | PARTIAL | Picker-copy ownership cleanup only; complete PDF/DOCX/image/audio/attachment parsing and coverage absent |
| AR09 independent App research | NOT IMPLEMENTED | Official listings/package IDs/developer/privacy-policy/network ownership research |
| AR10 capability-aware device help | NOT IMPLEMENTED | Structured fresh observations, evidence-bound action registry, supported settings research/landing confirmation |
| AR11 scenario discipline | PARTIAL | Immutable runs and NOT_RUN accounting implemented; full legitimate/ambiguous/threatening and required failure matrix not run |
| AR12 fixture boundary | PARTIAL | Source remains untouched; config guard can reject preview adapter for production; production native admission hardening not completed |
| AR13 all-copy lifecycle | PARTIAL | Encrypted temporary Ask/speech, fencing, server deletion and picker lifecycle added; whole-case/other-screen/crash/native/provider-copy inventory and verification absent |
| AR14 purpose-specific evidence | PARTIAL | Private evidence redaction separated from durable Patrol; complete typed redaction/coverage policy and local secret preflight for images remain |
| AR15 bounded whole coverage | PARTIAL | Old primary text/answer slices removed, input admission/counters added; true page/document batching, input dispositions, history compaction and 12+ follow-up/case budget tests absent |
| AR16 private full narration | PARTIAL | Direct Gemini, protected audio and lossless sections implemented; native lifecycle, human voice acceptance and complete late-section failure matrix absent |

Do not mark Stages A–D complete based on this migration. Next implementation remains the shared case and
research/job architecture, followed by evidence-complete Gate migration and the new semantic suite. No
routine stage approval is needed; testing-agent use still needs explicit approval. Missing service keys
are real blockers for those specific integrations, not an excuse to call the remaining architecture done.