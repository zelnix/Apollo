# P0 review remediation — separate from Stage 1D and launch acceptance

**Status: SIX VERIFIED CLOSED P0 FINDINGS.**
**Updated:** 2026-09-20. Stage 1C.1 launch remains PASS. A separate Stage 1D test candidate is now
implemented; production certification/cutover and physical acceptance remain outstanding.
The P0 software remediation is complete and independently verified in `test_reports/iteration_64.json`.
This does not claim native packet-block, start/stop, notification-delivery, or Stage 1D acceptance.

### Post-closure correction — commit `21c126d` baseline

Iteration 65 strengthened P0-03/P0-05 after four persistence/retention gaps were identified:

- Every Patrol event retrieval revalidates historical packet truth; invalid legacy call-screening
  Biting is persistently downgraded and its enforcement evidence removed. Weekly/admin retrieval
  paths apply the same gate.
- An identical evidence replay is read-only and returns the current stored record, preserving later
  resolution/status changes.
- Mongo now enforces unique `(device_id,event_id)` and `(device_id,evidence_id)` receipt bindings;
  replacement and cross-event reuse fail with 409 under concurrent requests.
- The device outbox retains at most 256 pending entries and never evicts pending evidence. Overflow
  is persisted/reported and the locally retained event retries when capacity returns. Receipts are
  capped at 1,024 and retained for 30 days.

Evidence: main-agent full P0 backend **84/84**, frontend **21/21**, real Mongo race tests, preview
Patrol render, and frozen-source manifest **91/91** from `frontend/packages`; independent iteration
65 **50/50 backend**, **21/21 frontend + 2/2 preview checks**, including live unique-index proof.

## Source and intake provenance

- Full original: [Apollo_Review_2026-09-20.md](reviews/Apollo_Review_2026-09-20.md), archived
  unchanged from the user's upload. Its original historical launch-gate wording is preserved;
  the newer confirmed launch PASS remains authoritative for current status.
- Reviewed source: `da60c0372650dead26caeb25c458f8ca7cebd6a2`.
- Upload: `https://customer-assets-7cd3h4nn.emergentagent.net/job_threat-patrol-1/artifacts/1hpi9g0d_Apollo_Review_2026-09-20.md`.
- Original file SHA-256: `e2704cf1ee89850d8ca39fa50b136ce09575ff4e45e8cfafeb986288c6de2788`.
- The report numbers its findings 1–10. The user's follow-up assigns **P0-01–P0-06** to
  report findings 1–6. All six are **High severity / P0** per that report. P1 findings 7–10
  and subsequent recommendations remain preserved in the original; none is closed here.
- **P0-INTAKE: RESOLVED — original source received and all six P0 identities mapped.**
  This closes only the earlier identification gap, not a finding or any implementation gate.
- Reproductions below are **reported review evidence at the reviewed commit**, not tests
  independently rerun during this documentation-only revision.

## Individual findings — all VERIFIED CLOSED

| ID | User's finding / original report title | Required outcome | Status |
|---|---|---|---|
| P0-01 | Backend requests can reach internal addresses / “Backend outbound requests lack consistent internal-address protection” | Validate every destination/redirect; constrain actual outbound connections and resources | **VERIFIED CLOSED** |
| P0-02 | Protection freshness and recovery can mislead / “Live protection state and recovery can become misleading” | Fresh successful observations; historical blocks cannot conceal lost protection or establish recovery | **VERIFIED CLOSED** |
| P0-03 | Call rejection can produce biting / “Call rejection can produce the packet-block-only biting state” | Separate call-screening outcomes from packet-backed THREAT_BLOCKED/Biting | **VERIFIED CLOSED** |
| P0-04 | Privacy disclosure contradicts actual processing / “Privacy disclosure conflicts with real data flows” | Enforce the approved local-first data boundary, including automatic processing, and align disclosures | **VERIFIED CLOSED** |
| P0-05 | Upload policy rejects block evidence / “Block evidence cannot pass the Patrol upload policy” | Narrow validated payload; reliable durable/idempotent delivery; visible failures and retry | **VERIFIED CLOSED** |
| P0-06 | Unread files can receive “Fine to open” / “Unread or lightly inspected files can receive ‘Fine to open’” | Failed/limited inspection must not imply safety; bounded reads and accurate limitations | **VERIFIED CLOSED** |

### P0-01 — outbound destination/redirect protection

- **Source:** original finding 1; `backend/services/intel.py:118–142`, `services/webcrawl.py`,
  `routers/imapmail.py`, `services/imapmail.py` at the reviewed SHA.
- **Reported evidence:** fake transport attempted a public URL then loopback. Crawler has a
  validation-to-connection DNS window; IMAP takes unrestricted user host/port. No external
  targets were probed; actual server-network reachability was not established by the review.
- **Required remediation:** one hardened connection policy; reject nonpublic IPv4/IPv6 at
  every hop, bind the connection to validated addresses, constrain redirects/body/time/concurrency;
  define an approved IMAP host/port policy. No unbounded GET fallback.
- **Verification:** isolated transports for initial private destinations, public-to-private
  redirects, DNS changes between check/connect, IPv4/IPv6 edge cases, oversized bodies/timeouts;
  separately assess actual egress restrictions with authorization, not a live scan in this task.
- **Closure:** hardened pinned transport in `backend/services/outbound.py` and shared callers;
  destination, redirect, DNS-rebinding, body, deadline, concurrency and HEAD→GET fallback
  regressions pass. Independently verified in iteration 64. **VERIFIED CLOSED.**

### P0-02 — protection freshness / recovery

- **Source:** original finding 2; `frontend/src/domain/stateMachine.ts:36–97` and
  `src/store/ApolloContext.tsx:185–293,340–365,754–756`.
- **Reported evidence:** a pre-resolution verification still satisfied recovery after cooldown;
  an old unresolved block masked absent visibility; timer changes do not invalidate resolution;
  refresh time can be recorded without successful native verification.
- **Required remediation:** separate present health, recent enforcement and unresolved user
  action; require successful post-resolution observations; clock-driven expiry and appropriate
  foreground/native probes; failed/stale observations stay unknown/unavailable, not healthy.
- **Verification:** fake clocks with no unrelated rerenders, pre-resolution-only recovery,
  old block + revoked permission, foreground after service loss and failed native probe;
  authorized physical lifecycle tests follow separately. Do not generate threat traffic to
  manufacture freshness or erase historic evidence to make current state appear healthy.
- **Dependency:** native lifecycle may be recorded independently; truthful consumer health /
  recovery acceptance cannot pass while these behaviors persist (plan D6/A5-health).
- **Closure:** freshness/recovery observations now require current successful evidence, expire on
  the clock and foreground transitions, and never let historic enforcement conceal current loss.
  Pure clock/recovery regressions pass. **VERIFIED CLOSED.** Physical lifecycle acceptance remains
  a separate Stage 1D/device gate.

### P0-03 — call rejection is not a packet block

- **Source:** original finding 3; `ApolloCallScreeningService.kt:99–117`,
  `frontend/src/store/ApolloContext.tsx:226–265`, `src/security/PlatformCapabilityProfile.ts`,
  `backend/routers/patrol.py:20–42`.
- **Reported evidence:** call rejection creates `verifiedCallBlock`; consumer and server
  accept `call_screening` into biting. No separate OS completion receipt was established.
- **Required remediation:** distinct call-screening event/result and qualified completion
  wording. A submitted **or completed** call rejection must never become packet-backed
  THREAT_BLOCKED/Biting. Preserve authentic packet positives and the backend invariant;
  any needed cross-platform schema change is separately reviewed, not hidden in Stage 1D.
- **Verification:** rejected/submitted call, call evidence and manual block pass through the
  complete consumer/egress/backend path without Biting; authentic native packet-drop evidence
  still yields the appropriate packet event. Test absent OS completion receipts honestly.
- **Dependency:** mandatory negative acceptance A5-call is **blocked pending verified P0-03
  remediation**; P0-05 must also be resolved to exercise the full upload path honestly.
- **Closure:** call-screening requests are represented as non-packet Barking events; frontend and
  backend packet gates reject call/manual/simulated evidence while retaining genuine packet
  positives. Historical retrieval now applies and persists the same fail-closed decision. Full
  negative-path regressions pass. **VERIFIED CLOSED.**

### P0-04 — approved privacy boundary and automatic processing

- **Source:** original finding 4; `frontend/app/privacy-disclosure.tsx:18–25`,
  `src/domain/privacy.ts`, `src/store/ApolloContext.tsx:436–504`, `backend/routers/analysis.py`.
- **Reported evidence:** “never leaves device”/exhaustive disclosure conflicts with message,
  screenshot and connector processing; notification capture can automatically request cloud
  second opinion. Top-level allow-listing does not redact nested content; phone numbers can
  inhabit call-event headlines and `destination_domain`.
- **Required remediation:** enforce existing local-first/raw-content restrictions, including
  disabling or keeping conflicting automatic processing local. A future optional cloud path
  needs an explicit product-policy decision and separate informed choice, not retrospective
  wording changes alone. Maintain recipient/retention/revocation inventory and minimal indicators.
- **Verification:** intercept manual, screenshot, automatic notification, call, inbox, voice
  and family payloads; local-only/cancel sends no raw personal content; inspect strings/nested
  values, not just field names. This is not a legal compliance certification.
- **Dependency:** P0-05's allowed evidence subset and D4 retention/replay must satisfy this
  boundary; **do not allow arbitrary `enforcement_evidence` objects or raw call numbers**.
- **Closure:** raw message, screenshot, inbox, caller and breach cloud paths are disabled or reduced
  to reviewed minimal indicators; automatic notification checks remain local; nested egress is
  schema constrained and disclosure copy matches. Payload regressions pass. **VERIFIED CLOSED.**

### P0-05 — reliable, privacy-safe evidence delivery

- **Source:** original finding 5; `frontend/src/domain/privacy.ts:17–22`, `src/api/client.ts`,
  `src/store/ApolloContext.tsx:410–414`, `tests/enforcementEvidenceSync.test.ts`.
- **Reported evidence:** the actual egress policy rejects `enforcement_evidence` with a privacy
  error. All sync errors are treated as offline; seen IDs are recorded before server delivery;
  no durable delivery outbox is evident. Four passing mapper tests do not cross this boundary.
- **Required remediation:** a narrow privacy-reviewed nested schema through egress and API;
  visible policy/schema vs transient-network failures; durable pending-delivery state and
  idempotent retry/acknowledgement. A local “seen” event is not a server-delivery receipt.
  Do not relax verification to a client Boolean or bypass P0-04 to make delivery succeed.
- **Verification:** native evidence → mapper → egress → authenticated API → persisted Patrol
  → eligible notification, with policy rejection, offline/restart/retry and duplicate replay.
  Require server acknowledgement/persistence, not just queued local state or a mapper unit pass.
- **Hard dependency disposition:** P0-05 no longer blocks a future A4E device run. A4N native
  packet blocking and actual eligible notification delivery still require their own observed
  device evidence and are not claimed by software tests.
  Failure to upload is not evidence that the native drop failed, nor permission to mark the
  full pipeline PASS. Notification eligibility/delivery remains independently observed.
- **Closure:** the reviewed evidence schema crosses mapper → nested egress → authenticated API;
  the durable outbox distinguishes retryable/policy failures, survives restart, prevents stale
  version overwrite, is capacity/retention bounded without pending eviction, and uses dual-unique
  server idempotency/conflict receipts. Identical replay is read-only. Offline/replay/race
  regressions and live Mongo fixtures pass. **VERIFIED CLOSED.**

### P0-06 — unread/limited file inspection cannot authorize opening

- **Source:** original finding 6; `frontend/app/file.tsx:65–76`,
  `frontend/src/domain/fileAnalysis.ts:55–89`.
- **Reported evidence:** unread `invoice.pdf` yielded resting, matching-type/no-content claims
  and “Fine to open”; read failures fall back to filename/MIME. Whole-file reads precede sampling.
- **Required remediation:** failed reads explicitly say inspection was impossible; heuristics
  state their actual limited coverage without implying malware absence or safe opening.
  Bound reads and enforce size limits before loading the whole file.
- **Verification:** unreadable/missing bytes, renamed archives, compressed Office content,
  links outside the sample, malformed and huge files. No failed or limited inspection may
  yield unsupported safety reassurance.
- **Closure:** reads are bounded before analysis; missing, failed and partial inspection never
  authorizes opening or claims safety. Unreadable/oversized/limited regressions pass.
  **VERIFIED CLOSED.** Separate from native launch/integration.

## Closure and sequencing rules

- Current count: **0 OPEN, 6 VERIFIED CLOSED**. P0-INTAKE remains RESOLVED.
- Every finding retains its original identity and reviewed SHA. Closure evidence is recorded in
  iterations 62–64; iteration 64 independently confirms the final four blockers. Device acceptance
  still requires source SHA + APK build ID/hash + device/OS evidence.
- Lifecycle reached VERIFIED CLOSED for all six software findings. Native runtime acceptance is a
  separate lifecycle and must not be inferred from this closure.
- Launch, compile, CI, native dependency audit or isolated mapper success closes none of them.
- P0 means the review's recommended blocker before an external pilot/release of the affected
  feature. Keep remediation separate from Stage 1D; expose dependencies rather than hiding them.
- D1–D6 must be resolved and implementation approved before Stage 1D starts. A separate
  backlog does not authorize unsafe full-pipeline acceptance or production-default cutover.
- Frozen-source defects go to the engine owner, not a local certified-source edit. The proposed
  minimal Apollo status enum extension is separately reviewed; it does not fix P0-02/03/05.