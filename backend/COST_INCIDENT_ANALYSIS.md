# Apollo Usage Incident — Root-Cause Analysis
## Code-Level Investigation Report

Generated: 2026-06-XX (Code analysis only — no production database access from preview)
**Status: Active cost incident — NO further Gemini calls permitted.**

---

## Executive Summary

Analysis of every code path that generates `purpose="investigation"` Gemini calls reveals **six distinct callers**, of which **the automated mailbox monitor** is the most likely source of the unexplained call volume. The monitor runs every 15 minutes, creates a full Magnum DI investigation (up to 12 Gemini calls) for **every email** it finds, and operates silently in the background regardless of whether the user initiated anything.

---

## 1. All Code Paths That Generate `purpose="investigation"` Gemini Calls

| # | File | Line | Caller | Correlation ID Pattern | Max Calls/Invocation | Trigger |
|---|------|------|--------|----------------------|---------------------|---------|
| 1 | `coordinator.py` | 505 | Magnum DI tool loop | `case-{case_id}` | 10 (MAX_TOOL_ROUNDS) | Investigation job |
| 2 | `coordinator.py` | 525 | Forced conclusion | `case-{case_id}` | 1 | After 10 tool rounds |
| 3 | `coordinator.py` | 545 | Validation repair | `case-{case_id}` | 1 | JSON validation failure |
| 4 | `health_check.py` | 69 | Health check probe | `health-check` | 1 | Manual/admin health check |
| 5 | `investigation.py` | 246 | Message check (SMS/email) | `msg-check-{id}` | 2 (1 + 1 retry) | Direct message analysis API |
| 6 | `investigation.py` | 467 | Phone number check | `phone-check-{number}` | 2 (1 + 1 retry) | Direct phone analysis API |

**Total max per single investigation job:** 10 (tool rounds) + 1 (forced conclusion) + 1 (repair) = **12 generate() calls**

**With in-job retries (MAX_TRANSIENT_RETRIES=3):** Up to 12 × 3 = **36 generate() calls** per job run.

**With auto-resume (MAX_AUTO_RESUME=2):** Up to 36 × 3 = **108 generate() calls** per investigation case (absolute worst case).

---

## 2. The Mailbox Monitor — Most Likely Amplification Source

### How it works:
- **`mailbox_monitor_loop()`** (mailbox_monitor.py:439): Runs continuously in the background
- **Full scan interval:** Every `SCAN_SECONDS = 900` (15 minutes)
- **Pending check interval:** Every `PENDING_SECONDS = 20` (20 seconds)
- For each Gmail connection with `monitoring_enabled: true`, it:
  1. Calls `scan_gmail_through_shared_pipeline()` which reads emails via Gmail API
  2. For EACH email: calls `_submit_shared_case()` → creates an investigation case
  3. Each case creates a **job** (`repo.create_job()`) → `jobs.launch()` → full `coordinator.run_turn()`
  4. Each coordinator turn → up to 12 Gemini API calls

### Calculation:
- If the monitor found **N** emails during the period:
  - N × 12 (max calls per investigation) = N × 12 investigation calls
  - For 856 investigation calls: 856 ÷ 12 ≈ **71 emails investigated**
  - For 856 investigation calls with some at fewer rounds: could be ~100-200 emails

### Why the user didn't initiate these:
The mailbox monitor runs AUTOMATICALLY as a background task. The user initiated 2-3 investigations manually, but the monitor may have created dozens or hundreds of additional investigation cases for monitored emails.

---

## 3. The Job Recovery Sweep — Amplification After Billing Restoration

### How it works:
- **`jobs.recover()`** runs every 20 seconds via the maintenance supervisor
- **Phase 1** (jobs.py:296-332): Finds jobs in `["queued", "investigating", "retry_wait"]` with expired leases
  - If `deadline_at > now` and lease expired → **RELAUNCHES** the job
  - If `deadline_at <= now` and lease expired → Marks as failed
- **Phase 2** (jobs.py:334-372): Auto-resumes failed retryable jobs (up to MAX_AUTO_RESUME=2)
  - Excludes `NON_RESUMABLE_CODES`: `provider_configuration`, `policy_block`, etc.

### What happened during the billing outage:
1. Billing ran out → all Gemini calls returned HTTP 402
2. HTTP 402 → `ProviderFailure("provider_configuration", retryable=False)` → job marked as failed
3. `provider_configuration` is in `NON_RESUMABLE_CODES` → NOT auto-resumed ✓

### What happened when billing was restored:
1. **New jobs created by mailbox monitor** would now succeed → up to 12 calls each
2. **Any jobs still in "queued" or "retry_wait" from BEFORE the outage** with valid deadlines → relaunched by Phase 1
3. Each relaunched job → full coordinator turn → up to 12 Gemini calls

---

## 4. Why "0 investigations in last 24h" vs "856 investigation calls"

### Two completely different queries against different collections:

| Metric | Collection | Query | What it counts |
|--------|-----------|-------|---------------|
| "Investigations in last 24h" | `investigation_reports` | `created_at >= now - 24h` | **Completed investigation report documents** |
| "856 investigation calls" | `gemini_usage` | `timestamp >= midnight UTC, purpose="investigation"` | **Individual Gemini API calls** tagged as investigation |

### Additional discrepancy:
- "Last 24 hours" = **rolling window** (now minus 24h)
- "Today" = **calendar day** (midnight UTC to now)

If investigation_reports has 0 documents in the last 24h, it means NO investigation reports were written. This could happen if:
1. The investigations are still in progress (not yet committed)
2. The investigations failed before generating a report
3. The investigation reports are written to a different collection than what's being queried
4. The timestamp field on reports doesn't match the expected format

---

## 5. Cost Gap Analysis: $12.56 estimated vs ~$19 actual

### What Apollo's estimator DOES track:
- ✅ Input tokens (billed at model's input rate)
- ✅ Output tokens (billed at model's output rate minus thinking)
- ✅ Thinking tokens (billed at thinking rate)
- ✅ Cached input tokens (billed at discounted cached rate)

### What Apollo's estimator DOES NOT track:

| Missing Item | Impact | Details |
|-------------|--------|---------|
| **Google Search grounding** | **~$3.47** (99 research calls × $35/1k queries) | Research calls use `google_search=GoogleSearch()`. Google charges per search grounding query. With 99 research calls, this is a significant untracked cost. |
| **Tool use tokens** | Unknown | Function declarations sent as tools add to the prompt. The estimator uses `count_tokens()` for admission but the recorded `tokens.input` from the response may differ. |
| **count_tokens() API calls** | **$0** | These calls are free (not billed by Google). |
| **Pricing table accuracy** | Variable | The pricing in `gemini_usage.py` uses hardcoded rates that may not match current Google billing. |
| **Multi-turn context growth** | Baked into input tokens | Each successive tool round includes the full prior conversation. This IS counted in input tokens, but the cumulative effect is what makes investigations expensive. |

### Estimated gap reconciliation:
```
Apollo estimated total:              $12.56
Google Search grounding (~99 calls): +$3.47  (at $35/1k)
Pricing table drift:                 +$1-3   (depends on actual rates)
Estimated actual:                    $17-19
Actual credit reduction:             ~$19
```

---

## 6. Token Accumulation Per Investigation (Compaction Impact)

### Without compaction:
Each tool round accumulates ALL prior context:
- Round 0: ~X tokens (system + evidence + brief)
- Round 1: ~X + Δ (adds model response + tool result from round 0)
- Round 10: ~X + 10Δ
- Total across 10 rounds: ~10X + 55Δ (arithmetic sum)

### With compaction (if active):
- Previous tool results summarized → Δ reduced
- Earlier conversation turns trimmed → X growth capped
- Expected: ~$0.08 per 11-call investigation

### What needs verification from production data:
1. The `extra.compaction_active` flag on each record
2. Whether records with no compaction flag are from before the compaction was deployed
3. Whether mailbox-monitor-triggered investigations use the compacted coordinator path

---

## 7. Recommended Production Data Queries

The enhanced Reconciliation page (`/api/admin/reconciliation`) will show all of this when accessed from production. Key things to look for:

1. **Correlation ID patterns:**
   - `case-*` → Coordinator investigation (Magnum DI / mailbox monitor)
   - `msg-check-*` → Message check API
   - `phone-check-*` → Phone check API
   - `health-check` → Health check probe
   - `research` → Research/grounding calls
   - `chat-*` → Chat calls
   - `scam-analysis` → Public advisory analysis

2. **High call counts per correlation_id** indicate the tool loop ran many rounds

3. **Many distinct `case-*` correlation IDs** indicate many separate investigations were created (likely by mailbox monitor)

4. **Timestamp clustering** will reveal whether calls were batched (monitor scan) or spread out (user-initiated)

---

## 8. Immediate Remediation Recommendations (DO NOT IMPLEMENT YET)

1. **Add Google Search grounding cost to estimator** — Track grounding search queries and apply per-query pricing
2. **Add purpose=MAILBOX_MONITOR** — Separate mailbox-triggered investigations from user-initiated ones in tracking
3. **Add daily Gemini budget cap** — Hard-stop all calls when estimated cost exceeds a configurable threshold
4. **Rate-limit mailbox monitor investigations** — Max N concurrent investigation jobs from the monitor
5. **Add tool-round cap per investigation from monitor** — Lower MAX_TOOL_ROUNDS for automated scans
