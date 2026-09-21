# Apollo saved-source review and developer continuation instructions

Reviewed source: [`59725fc093c46b1e8bfac1196ea95ee9a004ab15`](https://github.com/zelnix/Apollo/commit/59725fc093c46b1e8bfac1196ea95ee9a004ab15)  
Review date: 21 September 2026  
Comparison baseline: `8e1412d72214f9c5a878688dacc65457818617b4`  
Method: read-only source and implementation-record review. No application tests, live investigations, native execution or testing agents were run for this review.

**Verdict: substantial shared-engine implementation is present, but Stages A and B remain partial. Stage C remains partial and Stage D remains incomplete.** The findings below identify source-level failure paths; they are not claims that those failures were reproduced against the running application.

This is an incremental correction package for the already-authorized **Apollo Complete Developer Instructions** and Package-2. Continue that package through Stages A–D. Do not substitute this review for its remaining requirements, restart planning, or ask for routine stage approvals. The owner has already authorized implementation.

The remote save contains six commits and 45 changed files relative to the comparison baseline. No files under `frontend/packages/guarddog-*` changed in that comparison. This is a source-diff observation, not a new 91-file hash certification.

## Priority and delivery decision

“High” means an existing requirement cannot be accepted with the current failure path. These are new shared-engine review findings, not a blanket reopening of the historically closed P0-01–P0-06 list.

| Rank | Finding | Severity | User consequence |
|---|---|---|---|
| 1 | R01 — Accepted answers and history are not crash-consistent | High | Higgins can show an answer and then forget the exchange, or a stale attempt can damage accepted history. |
| 2 | R02 — Deletion and expiry permit late content writes | High | Temporary content can be recreated after cleanup reports completion. |
| 3 | R03 — Uploaded originals bypass authentication-secret handling | High | A file can retain a recoverable password/code; uploaded text can pass that raw content to Gemini. |
| 4 | R04 — Retry and recovery are not durably resumable throughout research | High | Investigations can repeat work, become stuck, or lose a completed answer's terminal state. |
| 5 | R05 — Document coverage can overstate examination | High | Material pages or document structures can be missed while completion appears stronger than the actual inspection. |
| 6 | R06 — Upload storage cannot support its advertised file size | High | A file within the advertised limit can fail, and finalization can discard its resumable upload before successful ingestion. |
| 7 | R07 — Research cannot reliably select and follow every relevant clue | High | Later links/numbers are inaccessible to particular tools; truncated research and inconsistent source IDs can impair the answer. |
| 8 | R08 — Settings “exact match” and “fresh recheck” are overstated | High | Apollo can claim instructions match the device or a setting was corrected without sufficient supporting observations. |
| 9 | R09 — Browser continuation, Retry and case isolation have gaps | High | Device continuation can replay an old request; Retry can replay a failure; an older case callback can affect a newer case. |
| 10 | R10 — Recommended actions and speech are not fully connected to cases | High | A visible action can do nothing; the new case lifecycle is not necessarily the lifecycle used by the narration button. |

The case contracts, Gemini tool coordinator, evidence repository, job machinery and investigation view are useful implementation progress. Happy-path examples do not resolve these specific gaps.

#### 🏛️ System Architecture & Data Flow

### R01 — Make the accepted turn an immutable authoritative record

**Source:** [repository.py, turn staging/acceptance/history](https://github.com/zelnix/Apollo/blob/59725fc093c46b1e8bfac1196ea95ee9a004ab15/backend/services/higgins/repository.py#L308), [staged-record cleanup](https://github.com/zelnix/Apollo/blob/59725fc093c46b1e8bfac1196ea95ee9a004ab15/backend/services/higgins/repository.py#L372), [job finalization](https://github.com/zelnix/Apollo/blob/59725fc093c46b1e8bfac1196ea95ee9a004ab15/backend/services/higgins/jobs.py#L122).

The case compare-and-swap accepts the answer before a separate write changes the turn bundle to `staged=False`. History requires both acceptance and that flag. A crash between those writes leaves an accepted answer absent from history; cleanup can subsequently delete its still-staged bundle.

Staging also overwrites a record keyed by logical `turn_id`. A losing attempt can overwrite the winner's bundle and then delete the staged record after losing the case comparison.

**Correction:** store immutable bundles per attempt/commit. Atomically accept a reference to the exact bundle and its digest on the case. Read history from those accepted references; never require a second mutable flag for visibility. Garbage collection must exclude every referenced bundle. Enforce logical-turn and payload consistency independently of the caller's idempotency key. Losing attempts may clean only their own unaccepted bundle.

Recovery must recognize an already accepted commit and repair job/event projections from it without another Gemini conclusion. A crash after acceptance but before job completion currently encounters a cleared `active_job_id` and can be classified as cancellation.

### R02 — Fence content publication and deletion, not just answer acceptance

**Source:** [content writes](https://github.com/zelnix/Apollo/blob/59725fc093c46b1e8bfac1196ea95ee9a004ab15/backend/services/higgins/repository.py#L176), [events](https://github.com/zelnix/Apollo/blob/59725fc093c46b1e8bfac1196ea95ee9a004ab15/backend/services/higgins/repository.py#L293), [cleanup](https://github.com/zelnix/Apollo/blob/59725fc093c46b1e8bfac1196ea95ee9a004ab15/backend/services/higgins/repository.py#L334), [speech writes after provider return](https://github.com/zelnix/Apollo/blob/59725fc093c46b1e8bfac1196ea95ee9a004ab15/backend/routers/investigations.py#L440).

Content insertion, chunk storage and event publication do not all enforce the lifecycle epoch. An upload or speech request admitted before deletion can finish afterward and write content back. Speech checks before awaiting Gemini, then inserts audio without a post-return lifecycle check. Event publication can insert even if its job was deleted.

Cleanup reports complete after one pass and does not automatically revisit a completed scope for such late writes. Several content TTL indexes also specify an additional 3,600 seconds beyond `expires_at`. Open event streams validate the case on entry, not throughout delivery.

**Correction:** couple child writes to the live scope using transactional lifecycle checks or a properly coordinated writer barrier and cleanup protocol. A standalone check before an awaited write is insufficient. Revalidate before delivering streamed content and discard late provider results after cancellation/deletion/expiry. Cleanup completion must mean no admitted writer can recreate usable content. Retain retryable cleanup state when removal fails.

Remove the deliberate extra hour from the content TTL backstop. Logical access must stop at the authoritative deadline; physical cleanup status and delay must be reported honestly rather than described as instantaneous deletion.

### R03 — Preserve useful evidence while removing actual secrets before storage

**Source:** [file ingestion](https://github.com/zelnix/Apollo/blob/59725fc093c46b1e8bfac1196ea95ee9a004ab15/backend/services/higgins/evidence.py#L146), [text redaction](https://github.com/zelnix/Apollo/blob/59725fc093c46b1e8bfac1196ea95ee9a004ab15/backend/services/higgins/evidence.py#L64), [model inputs](https://github.com/zelnix/Apollo/blob/59725fc093c46b1e8bfac1196ea95ee9a004ab15/backend/services/higgins/evidence.py#L271).

`ingest_file` stores the original bytes before derived-text redaction. Encryption does not satisfy the instruction not to retain recoverable authentication secrets. A TXT original is classified as `text`, so the normal model-input path can read the unredacted parent as well as its redacted derivative. Image secret preflight remains unfinished.

**Correction:** implement the approved modality-specific secret handling before avoidable persistence or transmission. Keep necessary originals request-scoped during preflight; persist a sanitized representation and a transformation record without removed values. Complete the Gemini-only image preflight/crop path already specified. When safe isolation is not possible, request only the necessary crop or resubmission.

Preserve meaningful organisation names, addresses, numbers, URLs, relationships and surrounding text. This correction must not become blanket redaction or a restriction on useful investigation. Purge originals when their processing purpose ends, while retaining only permitted follow-up context until the unchanged case deadline.

### R04 — Persist research continuation and make every transition fence-aware

**Source:** [coordinator checkpointing](https://github.com/zelnix/Apollo/blob/59725fc093c46b1e8bfac1196ea95ee9a004ab15/backend/services/higgins/coordinator.py#L107), [retry/failure transitions](https://github.com/zelnix/Apollo/blob/59725fc093c46b1e8bfac1196ea95ee9a004ab15/backend/services/higgins/jobs.py#L39), [recovery](https://github.com/zelnix/Apollo/blob/59725fc093c46b1e8bfac1196ea95ee9a004ab15/backend/services/higgins/jobs.py#L145).

Normal research/tool steps are not checkpointed; the saved checkpoint is written when pausing for a device request. Retries reconstruct local counters and can repeat confirmed completed research. A heartbeat during `retry_wait` fails because heartbeat only matches `investigating`. Failure transitions on the case do not consistently require the current lease fence. Recovery excludes jobs whose work deadline has already passed, leaving them potentially active until case expiry.

**Correction:** persist completed tool results, continuation, budget usage and retry state throughout the turn. Reload the latest checkpoint after lease acquisition. Reuse confirmed completed work; explicitly represent an interrupted external call whose outcome is unknown. Include epoch/fence checks in success, failure, retry, device-wait and event transitions. Make heartbeat behavior consistent with retained-lease retry waits. Reconcile abandoned jobs past their work deadline into a resumable failure or expiry. Do not extend the case's original deadline.

### R05 — Separate extraction, delivery to Gemini and completed examination

**Source:** [PDF/DOCX extraction](https://github.com/zelnix/Apollo/blob/59725fc093c46b1e8bfac1196ea95ee9a004ab15/backend/services/higgins/evidence.py#L113), [coverage calculation](https://github.com/zelnix/Apollo/blob/59725fc093c46b1e8bfac1196ea95ee9a004ab15/backend/services/higgins/evidence.py#L226), [response validation](https://github.com/zelnix/Apollo/blob/59725fc093c46b1e8bfac1196ea95ee9a004ab15/backend/services/higgins/validation.py#L17).

PDF extraction slices to 200 pages before recording the total, so additional pages disappear from the recorded total/omissions. DOCX extraction reads body paragraphs and main-part hyperlinks, omitting other structures such as tables. Any overlap with a page counts that page as examined. Inline evidence is marked examined while constructing the request, before Gemini succeeds. Validation receives ID sets but not the coverage ledger, so material omissions do not prevent a claimed complete response.

An image rejected by the pixel budget remains available and can still be sent by the image branch of `model_parts`.

**Correction:** retain actual totals and explicit omitted ranges. Implement the specified scanned-document and structured-document processing, or accurately inventory unsupported portions until implemented. Track extraction and provider delivery separately from examination; a failed provider call must not advance completed coverage. Require full range coverage to count a whole page. Enforce unavailable/budget states at model dispatch.

Validate completion against scope and unresolved material coverage. Return factual incompatibilities to Gemini for repair; do not replace its assessment with canned text. A bounded, explicitly scoped answer can still be useful, but must not imply the whole submitted document was checked.

### R06 — Store upload chunks separately and make finalization recoverable

**Source:** [upload API](https://github.com/zelnix/Apollo/blob/59725fc093c46b1e8bfac1196ea95ee9a004ab15/backend/routers/investigations.py#L174).

All encrypted upload chunks accumulate inside one MongoDB document, although files up to 32 MiB are accepted. MongoDB's BSON document limit is 16 MiB, so the advertised upper range cannot fit this design; encryption encoding adds further overhead. [MongoDB document-size limit](https://www.mongodb.com/docs/manual/reference/limits/#bson-document-size).

Finalization deletes upload state before validating total length and completing ingestion. Chunk conflict checking is a read followed by an unconditional update, so concurrent different chunks can overwrite one another. The request body is fully buffered before the chunk-size check.

**Correction:** use separate bounded chunk records or an equivalent owner-scoped blob store. Enforce chunk digest uniqueness atomically. Stream-limit request bodies and reserve aggregate case capacity atomically. Preserve upload state until evidence acceptance is committed and finalization replay returns the same result. Bound parser expansion/time as well as original file bytes. Account for originals and derived content without silent truncation.

### R07 — Register individual clues and preserve complete research results

**Source:** [research inputs/results and sources](https://github.com/zelnix/Apollo/blob/59725fc093c46b1e8bfac1196ea95ee9a004ab15/backend/services/higgins/tools.py#L76), [URL/reputation selection](https://github.com/zelnix/Apollo/blob/59725fc093c46b1e8bfac1196ea95ee9a004ab15/backend/services/higgins/tools.py#L103), [source deduplication](https://github.com/zelnix/Apollo/blob/59725fc093c46b1e8bfac1196ea95ee9a004ab15/backend/services/higgins/repository.py#L169).

URL inspection requires a registered URL item, but extracted links inside text/documents are not individually registered for this tool. Reputation lookup selects the first matching URL/phone from an item, without a selector for later clues. The tool registry has no corresponding path for registering an arbitrary newly discovered lead.

Grounded research silently clips the question to 600 characters, entities to eight and the returned answer to 6,000 characters. These are separate bottlenecks from the larger user-message limit.

Research assigns a new source UUID per result while repository deduplication retains the earlier URL's ID. Repeated research can return an ID that was never registered, causing reference validation failures.

**Correction:** register relevant clues with parent evidence and exact location; let tools address a specific clue, including one found during research. Pass discovered URLs through the existing safe-fetch boundary. Use stable canonical source IDs returned by the repository. Store full bounded research outputs with continuation references, and disclose any budget omissions; never silently truncate a completed research answer.

Known-domain hints may help source discovery, but a static list must not determine the conclusion or be sufficient to label a source official. Establish source authority and applicability from the actual research. Higgins remains responsible for the substantive explanation and uncertainty.

### R08 — Make Settings plans and rechecks specific to the action and fresh observation

**Source:** [Settings research matching](https://github.com/zelnix/Apollo/blob/59725fc093c46b1e8bfac1196ea95ee9a004ab15/backend/services/higgins/tools.py#L216), [plan/recheck endpoints](https://github.com/zelnix/Apollo/blob/59725fc093c46b1e8bfac1196ea95ee9a004ab15/backend/routers/investigations.py#L374), [device-result admission](https://github.com/zelnix/Apollo/blob/59725fc093c46b1e8bfac1196ea95ee9a004ab15/backend/routers/investigations.py#L345).

“Exact” currently means the manufacturer appears in any source title or host. It does not establish the source's applicability to the requested setting and OS/device. Plans infer capabilities by substring and assume every target expects `enabled=true`, which is wrong for actions that disable dangerous access.

Plans do not save `created_at`, although freshness checks depend on it. The fallback compares an observation timestamp with itself, allowing an older observation to support “fresh” confirmation. Request expiry, observation freshness and revision binding are not fully validated.

**Correction:** bind each plan to a supported action descriptor, intended target value, device profile and applicable researched instructions. Record plan creation and a recheck request issued after the action/return. Accept only appropriately timed, matching observations; distinguish requested, granted, available, user-reported and simulated values. A preview fixture must never become native proof. Return `cannot_observe` when the platform cannot confirm, with useful instructions and clearly labelled user confirmation.

### R09 — Repair frontend continuation, Retry and case ownership

**Source:** [caseStore.ts](https://github.com/zelnix/Apollo/blob/59725fc093c46b1e8bfac1196ea95ee9a004ab15/frontend/src/investigation/caseStore.ts#L19).

After a device result, the client restarts the same event stream from sequence zero. That replays the earlier terminal device request. Duplicate submission returns no `jobId`, yet the client uses it for the next stream. A failed event sets the phase but does not update the stored job status, so follow-up Retry can resubmit the old idempotency key and replay the already failed job.

Old reconnect timers, asynchronous refreshes and the prior expiry timer are not tied to a case-generation token. Starting a new case does not immediately clear the old expiry timer.

**Correction:** continue after the consumed sequence, make device-result replay return the original stable identifiers, and reject changed replay payloads. Retry a failed logical turn through resume, using authoritative job state. Fence every async callback/timer by case ID and local generation; abort and clear old work on case changes. Check authoritative expiry when the app resumes. Preserve a retryable server-deletion operation even if clearing the local view succeeds but the network deletion fails.

### R10 — Connect actual user actions and narration to the new engine

**Source:** [InvestigationView action/speech controls](https://github.com/zelnix/Apollo/blob/59725fc093c46b1e8bfac1196ea95ee9a004ab15/frontend/src/components/InvestigationView.tsx#L53), [Ask component wiring](https://github.com/zelnix/Apollo/blob/59725fc093c46b1e8bfac1196ea95ee9a004ab15/frontend/app/(tabs)/ask.tsx#L95), [action descriptors](https://github.com/zelnix/Apollo/blob/59725fc093c46b1e8bfac1196ea95ee9a004ab15/backend/services/higgins/validation.py#L55).

Only source-opening has a direct handler in the view. Other actions depend on optional `onAction`, which Ask does not pass. Validation constructs actions with no execution descriptor. The narration button still receives text through the older speech component rather than the new case-speech contract. Ask also labels every `answered` phase “Answer complete,” including a partial response.

**Correction:** finish the approved Settings/action dispatcher, permission path, supported deep links, instructions and return/recheck UI. Do not render an inert action as an executable button. Bind speech to case/revision/selected response, stop and clear it on lifecycle events, and preserve full selected narration. Make visible completion agree with the actual case/response outcome.

#### 🔌 API & Interface Contracts

Retain the shared public contracts unless a correction is needed; migrate callers together. The following are required internal semantics, not a request to rebuild a second engine.

| Boundary | Required contract |
|---|---|
| Accepted turn | Immutable `commitId`, logical `turnId`, payload digest, attempt/fence, case epoch and accepted revision. History resolves the exact accepted bundle. |
| Content write | Owner, case, lifecycle epoch, expiry and operation identity. Rejected late writes cannot leave publishable or orphaned content after completed cleanup. |
| Tool execution | Stable call identity, normalized arguments digest, status, confirmed result reference, coverage changes and persisted budget usage. Unknown interrupted calls remain explicit. |
| Evidence/clue | Parent evidence ID, offset/page or source location, kind, availability and stable clue ID. Tools select the intended clue rather than the first regex match. |
| Source registration | Canonical registration returns the stored source ID, including on deduplication. Authority and retrieval metadata remain distinct from the source's claims. |
| Device-result replay | Identical replay returns the same `jobId` and `evidenceId`; changed result under that request identity returns conflict. Match request, scope, deadline and result types. |
| Settings plan | Creation time, device applicability, action descriptor, expected target value and post-action recheck binding. No universal `enabled=true` assumption. |
| Upload finalization | Idempotently resolves to the same evidence ID; uncommitted failures preserve valid uploaded chunks. |
| Speech | References the authorized case and response revision; inherits its expiry and deletion. No independent content scope silently substitutes for it. |

Use the existing typed failure/status vocabulary. Keep recoverable provider errors visible; use the owner's Gemini configuration only. Missing third-party delivery credentials must block only the affected delivery, not research or implementation of its adapter.

#### 🛠️ Implementation Step-by-Step

1. **Backend repository and lifecycle — Stage A:** implement R01–R03 together so history, deletion and evidence ingress share one coherent ownership/lifecycle model. Include upload finalization from R06. Repair derived job/event views from authoritative commits.
2. **Evidence and capacity — Stage A:** complete R05–R06. Update the capability response and capacity documentation to actual behavior: text size, file size, aggregate bytes, page coverage, URL inventory, tool budgets and continuation. Do not solve capacity bugs by quietly lowering useful supported input.
3. **Coordinator and tools — Stage B:** complete R04 and R07. Follow relevant unfamiliar-organisation/app clues, answer from available Apollo evidence before asking the person, and preserve the full substantive Gemini response. Avoid hardcoded conclusions and alternative AI providers.
4. **Settings, broker and frontend — Stage C:** complete R08–R10 plus the declared unfinished native requested-versus-granted contracts, broker bindings, Settings UI and Device recheck. Implement platform-unavailable outcomes honestly. Physical-device acceptance remains cancelled.
5. **All ten Gate entry paths — Stage C:** finish Site, Link, Text, Call, Network, Account, Email, App, File and Device through their normal screens and follow-ups. An Ask button alone is not full Gate migration. Preserve original evidence and case continuity across Home, share, attachments, Gate results, Ask and saved historical reports.
6. **Integrations and preview isolation — Stage C:** implement the owner-configured email, push and family-storage adapters rather than leaving unconditional 503 placeholders. Record credential blockers per integration. Isolate permitted unavailable-device fixtures from native production paths and visibly label their origin. All Higgins responses and external research stay real.
7. **Regression and delivery records — Stage D:** complete US01–US35 using the existing user-scenario harness and the approved expected outcomes. Correct matrix rows to match implementation and normal-screen outcomes. Reconcile baseline failures by exact test/failure identity; “pre-existing” is not equivalent to green.
8. **Complete the existing package:** deliver changed-file mapping for every requirement, corrected scenario records and one consolidated remaining-blocker list. Continue between these steps without routine approvals. Do not invoke a testing agent without the owner's explicit approval.

#### 🛡️ Edge Cases & Error Handling

| Situation | Required outcome |
|---|---|
| Worker crashes immediately after accepting an answer | Same answer and history remain authoritative; job/stream state is repaired without generating a second conclusion. |
| Expired worker finishes after a replacement worker wins | It cannot alter the winner's answer, history, case state, sources or published events. |
| User deletes while an upload or speech call is in flight | Nothing is resurrected or played; cleanup remains pending until late writers cannot recreate content. |
| A document contains a secret and a relevant late clue | Remove the actual secret while preserving the clue/context; do not store an unredacted recoverable original. |
| PDF exceeds page budget or contains scans/tables | Inventory actual content and gaps; process supported parts; qualify completion and offer useful continuation. |
| A research answer exceeds inline transport budget | Retain a bounded full result with pagination/reference; disclose any true omission. |
| Duplicate device result arrives after reconnect | Return the same identifiers, do not rerun observation or restart at the old request event. |
| Settings action disables access rather than enabling it | Recheck the action's actual intended value with a fresh matching observation. |
| Old case expires while a newer one is opening | Only the old scope expires; old callbacks cannot overwrite the newer view. |
| Gemini or a configured external service is unavailable | Preserve valid context, show the typed failure and useful retry; never insert a canned investigation answer. |

#### 🧪 Testing Criteria

Extend the already-authorized regression work. Do not count mocked Higgins responses or external lookups as acceptance. The scenario inputs may be fictional; preview-only device observations must be explicitly labelled. Infrastructure interruptions can be deliberately introduced to exercise recovery without fabricating findings.

| User journey or failure exercise | Required acceptance |
|---|---|
| Read Higgins' answer, restart the worker at acceptance, then ask a follow-up | One accepted answer; history survives; follow-up uses the exchange; no duplicate conclusion. Exercise the stale-worker overlap as a focused persistence regression. |
| Delete an investigation while upload/research/narration is completing | Immediate loss of access; no later content/event/audio reappearance; cleanup outcome is inspectable and accurate. |
| Submit a TXT/PDF/screenshot containing a fictional password and useful surrounding clues | No recoverable secret in retained originals, derived records, events or logs; the legitimate clues still reach the investigation. Use no real credentials in fixtures. |
| Submit a long document with a late link, a scanned page and a table clue | Relevant content is examined or explicitly inventoried as unprocessed; no false whole-document completion. Include a file above 200 pages. |
| Submit a valid file near the advertised size limit; interrupt and resume | Chunks fit storage; replay is stable; accepted bytes match; finalization failure preserves recoverability. |
| Submit several links and callback numbers, with the significant clue later in the material | Higgins can address the specific later clue, safely inspect it and use real research; repeated sources keep valid IDs. |
| Gemini temporarily rate-limits an investigation with completed research steps | Confirmed results are reused; retries remain bounded across restart; work-deadline expiry produces a usable terminal/retry state. |
| Device observation is requested during a browser journey | Result resumes once after the consumed event; duplicate replay is harmless; unavailable/fixture origin remains visible. |
| Higgins recommends a supported Settings change and the user returns | The button works; guidance matches supported applicability; only a fresh matching observation can confirm the intended value. |
| Start another case while a prior reconnect/expiry callback remains pending | The newer case is unaffected. Clearing history retains a way to finish/retry server deletion. |
| Listen to a long accepted explanation, then delete/expire the case | All selected content is narrated in order; deletion/expiry stops playback and invalidates its case-bound audio. |
| Run the original US24 File/Device follow-up scenario | A real long explanation ending in a question is rendered and the answer continues that investigation. A generic long Ask response is not a substitute. |

Run the complete US01–US35 matrix through the intended entry points, retaining expected versus actual Gate selection, detection, investigation, explanation, action and follow-up. Report each as complete, partial, failed, blocked or not run. Direct supporting API exercises remain appropriate for scenarios explicitly defined that way, such as cross-owner access denial.

The developer's reported 7/7 new tests, live probes and legacy-suite counts remain developer-reported evidence for this review. This review neither reran them nor establishes a production-ready release.

**Preserved constraints:** owner-managed Gemini only; no Emergent keys or alternate AI fallback; no authentication-credential collection/storage; frozen GuardDog source unchanged; “Apollo is biting” requires real observed intentional packet blocking; Stage 1D physical-device acceptance remains cancelled; macOS/Windows enforcement remains backlog; no testing agent without explicit owner approval.

