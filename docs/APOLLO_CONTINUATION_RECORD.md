# Apollo — Continuation Record

Baseline reconciled from GitHub commit `ceb8108f815a408e450d6890d28dc4b6bfb55b22` (this session's HEAD at start was
already exactly this commit — no divergent work to reconcile).

Mandate in force: "Apollo — Complete Functionality and Device Delivery Instructions" (Packages 1–7). Working rules:
no testing agents / Playwright / scenario suites / live Gemini probes; targeted pytest + tsc/eslint only; no EAS
build commands (blocked in this sandbox — confirmed again this session); credentials never in Git/reports/chat.

## Package 1 — Recovery and evidence correctness: COMPLETE, verified this session

Files touched: `backend/routers/investigations.py`, `backend/services/higgins/evidence.py`, `backend/services/higgins/contracts.py`.
Tests: `backend/tests/test_recovery_fencing.py` (14 cases, all passing against real MongoDB; no Gemini calls).

### Second review pass (4 findings) — all resolved this session
1. **Heartbeat did not stop work on renewal failure; job/case writes were unconditional.** `_with_lease_renewal` now
   races the wrapped coroutine against the heartbeat with `asyncio.wait(FIRST_COMPLETED)`; a failed renewal (`matched_count
   == 0`) cancels the work immediately and raises `LeaseLost`, caught at each call site (defers to whichever attempt
   now owns the claim). The job resume write is now a `find_one_and_update` conditioned on the job's own
   `status ∈ {waiting_device,queued,retry_wait}` AND no unexpired lease held — it can no longer clobber a job a live
   coordinator turn is actively holding. The case update now goes through the existing `repo.cas()` helper instead of
   a raw `update_one`. No MongoDB transactions available (standalone instance, confirmed via `hello`) — mutual
   exclusion is the renewed fence; the job/case writes are additionally self-conditioned as a second, independent guard.
2. **A normal partial read was becoming a permanent gap.** Root cause: `mark_examined` was using its OWN output field
   (`coverage.materialGap`, which it overwrites every call as "not yet fully read") as the signal for "is this a
   permanent, ingestion-time gap" — self-referential. Added a new, dedicated `Coverage.permanent_gap` (alias
   `permanentGap`) field, set ONLY at ingestion (truncated/incomplete screenshot transcription, parser failure,
   unsupported format, encrypted/expanded/oversized documents) and NEVER written by `mark_examined`. An ordinary
   partial-then-complete read now correctly reaches `"examined"`.
3. **Upload replay could substitute a different file under the same `clientItemId`.** The replay/cleanup shortcut now
   compares the OTHER upload's `finalisation.digest` against this attempt's own content digest: identical content
   from a different upload attempt still replays (bind to the same evidence); different content now returns 409
   instead of silently returning the wrong file's evidence.
4. **Device-observation recovery reused a metadata-only evidence row.** Before reusing an `existing` observation
   evidence row, `_finish_device_submission` now confirms an actual content chunk exists in
   `investigation_content_chunks`; if not (crash between `insert_evidence` and `store_bytes`), the orphaned row is
   discarded and re-ingested fresh from the submission payload the claim already durably retained.

Package 1 is now considered fully complete per both review passes. Bugs found+fixed in the FIRST pass (scanned-page
`expires` NameError, invalid `Transformation(lossy=True)` kwarg, missing `storing`/`resuming` handling in
`_finish_device_submission`, attempt-specific upload cleanup, page-level coverage aggregation across text+image
children) remain in place and re-verified.

## Verification this session
- `backend/tests/test_recovery_fencing.py`: 14/14 pass (5 new: ordinary-partial-read-completes, digest-mismatch
  rejected, digest-match binds, orphaned-observation-metadata reingested, lease-loss-detected-and-cancelled).
- Regression: `test_investigation_persistence.py`, `test_investigation_engine.py`, `test_p0_evidence_receipt_indexes.py`,
  `test_enforcement_evidence_gate.py`: 25/25 pass. `ast.parse` clean on all changed files. Backend restarted cleanly.
- This was a read-only source review by the requester (tests not independently rerun on their side) — the above is
  this session's own fresh run, on the current HEAD, immediately after the fixes.

## Package 1 — Recovery and evidence correctness: RECONCILED against the detailed architecture mandate this session

Re-verified (not just re-read) against the specific architectural elements named in the owner's reconciliation
request — durable device-result inbox, one authoritative job owner, conditional checkpoint writes, attempt-isolated
evidence publication, extraction gaps vs. reading progress — by re-reading `repository.py`, `jobs.py`,
`investigations.py` end-to-end line by line, not by trusting last session's summary:
1. **Durable device-result inbox**: `investigation_device_requests` persists the canonical result at first contact
   (`device_results` claims via `find_one_and_update(..., "submission": None)`) BEFORE any ingestion is attempted, then
   advances through fenced, renewable-ownership stages (`claimed → storing → stored → resuming → resumed`) via
   `_claim_submission_stage` + `_finish_device_submission`; `recover()` resumes any request stuck in `claimed/storing/
   stored/resuming` past staleness. Confirmed durable and crash-safe, not just "acknowledged".
2. **One authoritative job owner**: `repo.acquire_lease` fences a job (`fence` + 30s `lease_until`) so only one
   worker holds it; `_with_lease_renewal` (added in the prior review pass) races a 40s-renewal heartbeat against the
   wrapped coroutine itself for the two long-lived ownership stages (upload finalisation, device-result resume) and
   cancels the work the moment renewal fails — not merely a background timestamp ping with unrelated work still
   running underneath it.
3. **Conditional checkpoint writes**: every case/job mutation in the hot path is a `find_one_and_update` conditioned
   on the mutator's own expected state (`epoch`, `work_epoch`, `active_job_id`, `lease_fence`, or the job's own
   `status ∈ {...}` + unexpired lease) — e.g. `_resume()`'s job write in `investigations.py` line ~614; a superseded
   attempt's write matches nothing and is silently a no-op rather than corrupting state it no longer owns.
4. **Attempt-isolated evidence publication**: `settle_write` (repository.py) captures the case epoch BEFORE an
   awaited content write and compensates (deletes the row) if the epoch moved during the write; `sweep_tombstones`
   is the backstop for a process that died before compensating. `discard_incomplete_ingestion` removes a
   metadata-only or crashed-mid-write evidence row before any resumed attempt can reuse it. Upload finalisation
   (`complete_upload`) additionally binds replay to a content digest, not just a client item ID.
5. **Extraction gaps vs. reading progress**: `Coverage.permanent_gap` (evidence.py) is set ONLY at ingestion
   (truncated transcription, parser failure, unsupported format, scanned-page budget cutoff) and is NEVER written by
   `mark_examined`; `mark_examined`'s own `materialGap` output ("not yet fully read") cannot resolve a
   `permanent_gap` by re-reading the same already-limited retained content. Confirmed still correctly separated
   (this was the prior session's fix; re-verified present and unchanged).

Files re-verified: `backend/routers/investigations.py`, `backend/services/higgins/repository.py`,
`backend/services/higgins/jobs.py`, `backend/services/higgins/evidence.py`. No further backend changes were needed —
the architecture already satisfies the five elements above. Commit unchanged from last session's Package 1 head;
this reconciliation added no new commits (verification-only), confirmed via `pytest backend/tests/test_recovery_fencing.py`
(14/14) and the four adjacent regression files (25/25) both green again this session.

## Package 2 — File/Device/shared entry flows: Device Gate, File Gate, Text/Email Gate duplicate removal DONE this session

1. **File Gate acknowledgement boundary (frontend)** — `uploadFileEvidence` (single-shot multipart, no resume, and
   NOT replay-safe on retry — a retried multipart POST with the same `clientItemId` hits `ingest_file`'s plain
   `insert_evidence`, which 409s outright rather than replaying) has been replaced as the Gate's upload path by a
   new `uploadFileEvidenceResumable` (`frontend/src/investigation/client.ts`) that drives the ALREADY-HARDENED
   Package-1 resumable endpoints (`POST /uploads`, `PUT /uploads/{id}/chunks/{index}`, `POST /uploads/{id}/complete`
   — digest-checked replay, fenced finalisation). `frontend/src/investigation/caseStore.ts`'s `start()` now reads the
   file once into memory and reports a `FileUploadHandle` (uploadId + bytes + next chunk index) back to the caller
   after every step; on failure the handle is retained in a `pendingUpload` ref and `retry()` resumes the SAME
   upload session from the SAME chunk — never re-reading or discarding the original file, never recreating the
   case. `state.caseData` is now set immediately on case creation (previously only after every file + the opening
   turn succeeded), so the existing `InvestigationView` retry button — which requires `caseData` to render at all —
   now actually appears when a file upload or the opening turn fails, instead of silently having no retry
   affordance. Also fixed: `frontend/src/domain/privacy.ts`'s `investigation` egress allow-list was missing
   `filename`/`mediaType`/`declaredBytes` — needed by the new `POST /uploads` body — which would have been silently
   stripped, breaking every upload; added.
2. **Device Gate stable case identity** — `app/device.tsx` passed the LIVE, `useMemo`-recomputed `result` (recomputed
   on every self-report toggle and every recheck) directly as `GateInvestigation`'s `submission`. Since
   `GateInvestigation` keys a NEW investigation off object identity, every toggle of a "Tell Higgins what you've
   noticed" switch was silently discarding the in-progress conversation and opening a brand-new, separately billed
   investigation. Added a `submission` snapshot state that updates ONLY when a real check cycle completes (mount,
   or "I changed it — check again" via the `checking` flag) — never on a self-report toggle, which now only updates
   the live `result` shown on screen. This was the only Gate using this reactive pattern; the other 7 Gates
   (account/app-check/call/check/email/message/network) already hold `result` in plain `useState`, set once per
   "finish"-style call, so they were not affected.
3. **Text/Email Gate duplicate investigation paths removed** — `app/message.tsx` and `app/email.tsx` both call the
   legacy `/message/analyse` endpoint first (a standalone Gemini "second opinion" producing its own
   `assessment`/`explanation`, rendered via `MessageAssessmentResult`), and ALSO rendered `GateInvestigation`, which
   auto-starts a SECOND, independent shared-engine investigation (its own Gemini turn) the instant the result
   renders — two full Gemini analyses of the identical content, back to back, every single check, without the
   person asking twice. Added an `autoStart` prop to `GateInvestigation` (default `true`, unchanged for the other 7
   Gates); Text and Email Gate now pass `autoStart={false}`, so the shared-engine case is created only the first
   time the person actually taps "Ask Higgins about this message/email" (existing `openHigginsHandoff` → Ask tab
   path, unchanged). The legacy assessment's findings are still handed to Higgins as reusable context
   ("already performed; do not repeat the same lookups") when that follow-up happens.
4. **Home/Share intake, Patrol continuation** — audited, already correct from prior work (not from this session):
   `frontend/app/share.tsx` routes shared content to the same Gate screens audited above (file/message/etc., which
   all run the shared case engine); `frontend/src/components/EventActions.tsx`'s "Ask Higgins to explain" on a
   Patrol event resolves `caseForEvent(event.event_id)` first and continues that exact case (`case_id` handoff)
   instead of opening a duplicate. No changes needed; verified by reading the code, not assumed from the commit log.

Verification this session (frontend, no live Gemini calls, no testing_agent, no Playwright): `npx tsc --noEmit`
clean project-wide; `eslint` clean on every file touched (`client.ts`, `caseStore.ts`, `privacy.ts`, `device.tsx`,
`GateInvestigation.tsx`, `message.tsx`, `email.tsx`); existing frontend `node:test` suites re-run
(`purposeLimitedInvestigation.test.ts`, `p0TruthPrivacyFile.test.ts`) — 14/15 pass, the 1 failure
(`+61400000000` phone redaction inside an `ask_apollo` context payload) reproduces identically on the pre-change
HEAD (confirmed via `git stash`), so it is pre-existing and out of this session's scope, not a regression.
Backend: full `pytest backend/tests` re-run for regression — 307/324 pass; the 17 failures are all in files this
session (and the immediately prior Package-1 session) never touched (`test_family*.py`, `test_family_voice.py`,
`test_gate7_app.py`, `test_gate4_callguard_risk.py`, `test_device_auth.py`, `test_purpose_limited_investigation.py`,
`test_iter71_purpose_limited_contracts.py`); `RESEND_API_KEY` is unset in this sandbox (`email_configured()` is
False), which alone explains every `test_family*` guardian/confirm-token failure — a Package 7 configuration
blocker, recorded individually per the mandate, not a regression to chase now.

## Next (remainder of Package 2, then Packages 3–5 continuously): resume here

Package 2 is now functionally complete per the mandate's own listed items (2.1–2.5). Continue directly into:
- Package 3 — investigation depth and limits (document continuation slicing, content/clue limit audit, structured
  observations to Gemini, org/app research completion).
- Package 4 — Gate-specific behaviour (Text/SMS protected storage, Email Gate shared engine integration — note:
  Email Gate's INITIAL analysis is still the legacy `/message/analyse` path by design per #3 above, deliberately
  deferred rather than replaced, to avoid a live-Gemini-dependent rewrite of the primary verdict card without the
  ability to test it live this session; App Gate platform visibility; remaining Site/Link/Call/Network/Account
  Gates).
- Package 5 — guided actions, reports, lifecycle (Settings assistance, saved vs temporary reports, orphaned family
  voice upload cleanup).
- Package 6 stays active in parallel per the owner's correction (Android candidate refresh, Windows/macOS native
  work, unblocked iOS configuration) — not yet picked up this session; EAS build commands remain unavailable in
  this sandbox per every prior session's confirmation.
- Package 7 unblocked adapters continue in parallel; `RESEND_API_KEY` absence is the one blocker recorded above.

## Untouched packages (3, most of 4, 5, 6, 7): NOT STARTED — see mandate text for exact scope per package.

