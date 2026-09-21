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

## Next (Package 2 — File/Device/shared entry flows): NOT STARTED

Primary files per the mandate: `frontend/app/file.tsx`, `frontend/app/device.tsx`, `GateInvestigation`,
`frontend/src/store/ApolloContext.tsx`, Home/Text/Message/Share/Patrol entry components and their backend routes.
Resume with 2.1 (File Gate evidence transfer) first — read the current `file.tsx` + its upload-completion call into
`complete_upload` (now fenced, see Package 1) before changing anything, then work through 2.2–2.5 in the order given
in the mandate.

## Untouched packages (3–7): NOT STARTED — see mandate text for exact scope per package.
