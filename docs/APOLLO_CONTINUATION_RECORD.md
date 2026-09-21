# Apollo — Continuation Record

Baseline reconciled from GitHub commit `ceb8108f815a408e450d6890d28dc4b6bfb55b22` (this session's HEAD at start was
already exactly this commit — no divergent work to reconcile).

Mandate in force: "Apollo — Complete Functionality and Device Delivery Instructions" (Packages 1–7). Working rules:
no testing agents / Playwright / scenario suites / live Gemini probes; targeted pytest + tsc/eslint only; no EAS
build commands (blocked in this sandbox — confirmed again this session); credentials never in Git/reports/chat.

## Package 1 — Recovery and evidence correctness: COMPLETE, verified this session

Files touched: `backend/routers/investigations.py`, `backend/services/higgins/evidence.py`.
New tests: `backend/tests/test_recovery_fencing.py` (9 cases, all passing against real MongoDB; no Gemini calls).

- **1.1 Device-submission recovery** — `_finish_device_submission` now matches `state in ("claimed","storing")` and
  `state in ("stored","resuming")` (previously only exact `"claimed"`/`"stored"`, so a doc the sweeper picked up
  already sitting in `"storing"`/`"resuming"` fell through untouched). Covered by
  `test_device_submission_resumes_from_a_crashed_storing_state`.
- **1.2 Fencing of side effects + real renewal** — added `_with_lease_renewal()` (heartbeat every
  `LEASE_RENEWAL_SECONDS=40`, refreshing `stage_started_at`/`finalisation.started_at` under the SAME fence while the
  wrapped coroutine runs). Applied around `ev.ingest_file`/`ev.ingest_observation` (the "ingesting"/"storing" stages)
  and around the checkpoint+job+case+`jobs.launch` sequence (the "resuming" stage). No MongoDB replica set is
  available in this environment (`hello` reports no `setName`), so multi-document ACID transactions are not an
  option; mutual exclusion during the job/case writes is instead guaranteed by holding a live, renewed fence for
  their whole duration (only one attempt can be "resuming" while it is genuinely still heartbeating).
- **1.3 Upload publication** — the pre-commit cleanup of a same-`clientItemId` evidence row now checks whether that
  row is already owned by a DIFFERENT upload's `finalisation.state == "committed"` before deleting anything; if so it
  is not touched and this attempt's result points at the winning evidence instead of manufacturing a duplicate.
  Previously any matching row was deleted unconditionally, which could destroy a different, already-committed
  upload's evidence.
- **1.4 Coverage correctness (`mark_examined`)** —
  - A `materialGap` recorded at ingestion (60k-char transcription truncation, parser failure, omitted pages, ...) is
    now a permanent flag: reading everything that WAS retained can no longer flip status to `"examined"` or clear
    `materialGap`. Previously a full read of a truncated/partial item silently cleared its own gap.
  - Parent-document (scanned/mixed PDF) coverage is now aggregated from ALL relevant children — the extracted-text
    child (page-level, readable pages only — a page's offset entry now carries `readable: bool`) UNIONed with each
    rendered scanned-page image child (one page each) — instead of the last child to call `mark_examined` unilaterally
    overwriting the parent's status. Reading one scanned page image can no longer mark an entire multi-page document
    "examined" while other pages are unread; an empty extracted-text span for a scanned page can no longer count as
    having examined that page.

Bugs found and fixed while doing 1.3/1.4 in the PRIOR session (kept in place, re-verified this session): the scanned
page renderer's `expires` `NameError` and an invalid `Transformation(lossy=True)` kwarg — both silently swallowed by
the broad exception handler as "parser failed". `test_scanned_pdf_page_is_rendered_without_crashing` guards this.

Explicitly NOT done in Package 1 (would need MongoDB transactions/an outbox table, out of proportion for this pass):
a true atomic multi-document commit of evidence+job+case. The renewed-fence mutual-exclusion design is the practical
substitute the mandate allows ("a durable transition/outbox design with conditional writes and idempotent recovery").

## Verification this session

- `backend/tests/test_recovery_fencing.py`: 9/9 pass.
- Regression pass: `test_investigation_persistence.py`, `test_investigation_engine.py`, `test_link_investigation.py`,
  `test_gate2_message.py`, `test_p0_evidence_receipt_indexes.py`, `test_enforcement_evidence_gate.py`: 32/32 pass.
- `python -m ast` parse check on both changed files: OK. Backend restarted cleanly (no startup errors).
- Frontend was NOT touched this session (Package 1 is backend-only); prior session's `tsc --noEmit` / ESLint clean
  state is unaffected.

## Next (Package 2 — File/Device/shared entry flows): NOT STARTED

Primary files per the mandate: `frontend/app/file.tsx`, `frontend/app/device.tsx`, `GateInvestigation`,
`frontend/src/store/ApolloContext.tsx`, Home/Text/Message/Share/Patrol entry components and their backend routes.
Resume with 2.1 (File Gate evidence transfer) first — read the current `file.tsx` + its upload-completion call into
`complete_upload` (now fenced, see Package 1) before changing anything, then work through 2.2–2.5 in the order given
in the mandate.

## Untouched packages (3–7): NOT STARTED — see mandate text for exact scope per package.
