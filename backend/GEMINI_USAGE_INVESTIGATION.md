# Gemini API Usage Investigation — Root Cause Analysis

**Date:** 16 October 2026
**Investigator:** Apollo Development Agent
**Scope:** Trace `provider.generate()` through Magnum DI to identify repeated large-context transmission

---

## 1. Google AI Studio Observations (User-Supplied)

| Model | Peak Input Tokens | Peak Output Tokens | Approx Requests |
|-------|------------------:|-------------------:|----------------:|
| Gemini 3 Flash | ~35–40M | not specified | hundreds |
| Gemini 3.8 Flash | ~75–80M | ~3M | ~1,000+ |

**Key inference:** Average input per Gemini 3.8 Flash request ≈ 75K tokens, implying large payloads per call — not merely high request count.

---

## 2. Architecture: How Magnum DI Calls Gemini

Every Gemini API call goes through **one** function: `provider.generate()` in `/app/backend/services/higgins/provider.py`. This is the single gateway.

Callers:

| Caller | File | Purpose | Typical Calls/Session |
|--------|------|---------|----------------------:|
| Coordinator loop | `coordinator.py:323` | Investigation (tool rounds) | 1–10 |
| Coordinator final | `coordinator.py:342` | Investigation (budget exhaust) | 0–1 |
| Coordinator repair | `coordinator.py:361` | Investigation (validation fix) | 0–1 |
| Research tool | `tools.py:120` | Google Search grounding | 1–6 per investigation |
| Chat (initial) | `chat.py:114` | Ordinary Higgins chat | 1 |
| Chat (tool use) | `chat.py:126` | Chat with context tools | 0–1 |
| Chat (repair) | `chat.py:137–138` | Chat parse repair | 0–1 |
| Health check | `health_check.py:68` | Diagnostic ping | rare |

---

## 3. What Is Retransmitted Per Coordinator Round

The coordinator (`coordinator.py`) maintains a `contents: list[types.Content]` that **grows with every round** and is sent **in full** on every `provider.generate()` call.

### Round-by-round content accumulation:

| Content | Where | Retransmitted Every Round? | Estimated Size |
|---------|-------|:--------------------------:|----------------|
| **System instruction** | `coordinator.SYSTEM` constant | YES (via `config` param) | 15,097 chars / ~3,774 tokens |
| **Tool declarations** | `toolbox.DECLARATIONS` (13 functions) | YES (via `tools` param) | 4,796 chars / ~1,199 tokens |
| **Inline evidence text** | `ev.model_parts()` → `contents[0]` | YES | Up to 24,000 chars per item |
| **Inline evidence images** | `ev.model_parts()` → `contents[0]` | YES | Binary, variable |
| **Investigation Brief JSON** | `_brief()` → `contents[0]` | YES | Variable (includes `previousTurns`) |
| **Previous turns history** | `brief["previousTurns"]` → `contents[0]` | YES | Full `answerOverview` + `answerExplanation` per turn |
| **Registered sources** | `brief["registeredSources"]` → `contents[0]` | YES | All sources accumulated in the case |
| **Model response (fn calls)** | `contents[N]` (role: model) | YES, all prior rounds | ~500–2,000 tokens per round |
| **Tool results (fn responses)** | `contents[N+1]` (role: user) | YES, all prior rounds | Up to 30,000 chars per `read_evidence`, 8,000 per `research`, 6,000 per `inspect_url` |
| **Device observation results** | Checkpoint restoration | YES | Variable |

### Critical finding: **The entire conversation is retransmitted every round.**
There is no summarisation, trimming, or caching of previous rounds.

---

## 4. Representative Investigation Token Table

**Scenario:** Suspicious email with 2 URLs, no attachments. Model runs 5 tool rounds (research sender, inspect URL 1, lookup reputation, inspect URL 2, register clue). No validation repair needed.

### Fixed overhead per call:
- System prompt: ~3,774 tokens
- Tool declarations: ~1,199 tokens
- **Subtotal overhead: ~4,973 tokens**

### Per-round breakdown:

| Round | Reason | New Content Added | Approx Input Tokens | Approx Output Tokens | Cumulative Input | Content Retransmitted |
|------:|--------|-------------------|--------------------:|---------------------:|-----------------:|----------------------|
| 0 | Initial analysis + tool selection | Evidence text (~500 tok) + Brief JSON (~2,000 tok) | **~7,500** | ~1,500 | 7,500 | System + tools + evidence + brief |
| 1 | Process research_public_sources result | Research answer (~2,000 tok) | **~11,000** | ~1,200 | 18,500 | All of Round 0 + model R0 response + research result |
| 2 | Process inspect_url result | Page text (~1,500 tok) | **~13,700** | ~1,000 | 32,200 | All of Rounds 0–1 + model R1 + URL inspect result |
| 3 | Process lookup_reputation result | Reputation data (~300 tok) | **~15,000** | ~1,200 | 47,200 | All of Rounds 0–2 + model R2 + reputation result |
| 4 | Process inspect_url #2 result | Page text (~1,500 tok) | **~17,700** | ~1,000 | 64,900 | All of Rounds 0–3 + model R3 + URL inspect result |
| 5 | Final JSON investigation report | (no new content) | **~18,700** | ~4,000 | 83,600 | All of Rounds 0–4 + model R4 response |
| | **TOTALS** | | | **~9,900** | **83,600** | |

**Estimated cost for this 6-call investigation (Gemini 3.8 Flash):**
- Input: 83,600 tokens × $0.75/M = **$0.063**
- Output: 9,900 tokens × $3.75/M = **$0.037**
- **Total: ~$0.10 per simple investigation**

### For a complex investigation (PDF + 10 tool rounds):

| Round | Approx Input Tokens | Cumulative Input |
|------:|--------------------:|-----------------:|
| 0 | ~25,000 (large PDF inline) | 25,000 |
| 1 | ~30,000 | 55,000 |
| 2 | ~35,000 | 90,000 |
| ... | grows ~5K/round | ... |
| 10 | ~75,000 | **550,000+** |
| Final | ~80,000 | 630,000+ |
| Repair | ~85,000 | 715,000+ |

**Estimated cost: ~$0.54 input + ~$0.15 output = ~$0.69 per complex investigation.**

---

## 5. Maximum Generation Count Per Investigation

| Layer | Max Calls | Mechanism |
|-------|----------:|-----------|
| Coordinator tool rounds | 10 | `MAX_TOOL_ROUNDS = 10` |
| Budget exhaustion final | 1 | Forces final JSON after round limit |
| Validation repair | 1 | Re-generates if JSON fails validation |
| **Per coordinator run** | **12** | |
| Research calls (within tools) | 6 | `research_calls >= 6` budget |
| **Per coordinator run (total)** | **18** | 12 coordinator + 6 research |
| Transient retries | ×4 | `MAX_TRANSIENT_RETRIES = 3` + initial |
| **Per job** | **~72** | 18 × 4 (but checkpointed, so realistically ~25) |
| Auto-resume | ×3 | `MAX_AUTO_RESUME = 2` + initial |
| **Per case (theoretical max)** | **~216** | 72 × 3 |
| **Per case (realistic max)** | **~40** | Checkpoints prevent full restarts |

### Chat calls (separate from investigations):
- Per chat exchange: 1–3 calls (initial + optional tool follow-up + optional repair)
- These use the shorter chat system prompt (~789 tokens) and no conversation history accumulation

---

## 6. Root Causes of High Token Usage

### Primary: Cumulative conversation retransmission (70–80% of input cost)
Every coordinator round sends the **entire** conversation from round 0. By round 10, the model receives round 0's evidence + all 9 prior model responses + all 9 prior tool result sets. This is O(n²) in rounds.

### Secondary: Tool result verbosity (15–20% of input cost)
- `read_evidence`: returns up to **30,000 characters** per call
- `research_public_sources`: returns up to **8,000 characters** per call (AND stores the full result as evidence)
- `inspect_url`: returns up to **6,000 characters** per call
- These large payloads are then retransmitted in every subsequent round.

### Tertiary: previousTurns in the investigation brief (5–10% for multi-turn cases)
Multi-turn investigations include the **full** `answerExplanation` (Markdown) from all prior turns in the initial brief. Each explanation can be 2,000+ tokens.

### Not the primary cause: Request count
While ~1,000 requests is significant, the Google data showing 75M input tokens / ~1,000 requests = ~75K average input per request confirms that **per-request payload size**, not request count, is the main driver.

---

## 7. Duplicate/Concurrent Execution Check

### Protections already in place:
1. **Lease fencing** (`repo.acquire_lease`, `repo.heartbeat`): Only one worker can process a job at a time.
2. **CAS (Compare-And-Swap) updates** (`repo.cas`): Prevent concurrent case state mutations.
3. **Epoch/work_epoch matching**: Stale job runs are cancelled on acquisition.
4. **Consumed request IDs**: Device observation results are consumed exactly once.
5. **Tool call ledger**: Completed tool calls are replayed from the ledger, never re-executed.

### Finding: No evidence of duplicate concurrent execution.
The fencing and checkpoint system is sound. A crashed job is recovered from its checkpoint, not restarted from scratch.

---

## 8. Proposed Minimal Fixes

### Fix 1: Per-call payload composition recording ✅ IMPLEMENTED
Every `provider.generate()` call now records a `payload_audit` with:
- System prompt size, tool count
- Per-round: role, text_chars, binary_parts, fn_calls, fn_responses
- Totals: text_chars, est_tokens, binary_parts
- Available via `GET /api/usage/gemini/trace/{correlation_id}`

### Fix 2: Summarise consumed tool results before retransmission
**Impact: ~30–50% input token reduction**

After the model has processed a tool result and responded, replace the full text in the conversation with a compact reference:
```
[Tool result for research_public_sources — 8,000 chars processed, stored as evidence {snapshot_id}. Key entities: {extracted}. Use read_evidence to re-examine.]
```
The full result is already stored as evidence (snapshot) and accessible via `read_evidence`.
This preserves investigation depth (model can re-read via tool call) while avoiding O(n²) retransmission.

**Risk:** Low. The model has already seen and acted on the full text. If it needs to re-examine, `read_evidence` is available.

### Fix 3: Cap inline tool result size
**Impact: ~10–20% input token reduction**

| Tool | Current Max | Proposed Max | Rationale |
|------|------------:|-------------:|-----------|
| `research_public_sources` | 8,000 chars | 4,000 chars | Full result stored as evidence; model can read_evidence for rest |
| `read_evidence` | 30,000 chars | 12,000 chars | Already supports pagination via range/pages |
| `inspect_url` | 6,000 chars | 4,000 chars | Full snapshot stored as evidence |

### Fix 4: Trim previousTurns in the investigation brief
**Impact: ~5–15% for multi-turn investigations**

Include only `answerOverview` (2–4 sentences) in `previousTurns`, not the full `answerExplanation` (potentially many paragraphs). The full explanation is available in the committed turn record if the model needs it.

### Fix 5: Google Context Caching (future, requires API support evaluation)
**Impact: ~90% cost reduction on the system prompt + tool declarations overhead**

Google's context caching API allows caching the system instruction and a prefix of the content. The cached portion is billed at ~10× lower rates. The system prompt (3,774 tokens) + tool declarations (1,199 tokens) = 4,973 tokens could be cached, saving ~$0.003 per call at current rates.

**Note:** Context caching has a minimum cache size and TTL requirements that need evaluation.

### NOT proposed (would reduce investigation depth):
- ❌ Reducing `MAX_TOOL_ROUNDS` below 10
- ❌ Removing tool capabilities
- ❌ Shortening the system prompt's investigation framework
- ❌ Reducing inline evidence thresholds below what's needed for initial assessment

---

## 9. Cost Reconciliation Against A$160 Charge

### Estimated usage at current rates (Gemini 3.8 Flash):

| Metric | Value |
|--------|------:|
| Observed input tokens | ~75–80M |
| Observed output tokens | ~3M |
| Input cost (@ $0.75/M) | $56.25–60.00 |
| Output cost (@ $3.75/M) | $11.25 |
| Thinking tokens (estimated ~2× output) | $22.50 |
| **Estimated USD total** | **~$90–94** |
| **Estimated AUD (@ 1.55)** | **~A$140–145** |

### Possible additional charges:
- Gemini 3 Flash usage (~35–40M input): ~$10–12 USD at Flash rates
- Google Search grounding (per-query fee): variable, not in token billing
- Context caching TTL charges: if context caching was enabled by the SDK

### Conclusion:
The A$160 charge is **consistent** with ~75M input tokens + ~3M output tokens + thinking tokens + Gemini 3 Flash usage + potential grounding fees. The primary driver is cumulative conversation retransmission in multi-round investigations, not an error or misconfiguration.

---

## 10. Implementation Status

| Item | Status |
|------|--------|
| Per-call payload audit recording | ✅ Implemented |
| Per-investigation trace endpoint | ✅ Implemented (`GET /api/usage/gemini/trace/{id}`) |
| Admission token recording | ✅ Implemented |
| Tool result summarisation (Fix 2) | ⏳ Proposed, awaiting approval |
| Tool result cap reduction (Fix 3) | ⏳ Proposed, awaiting approval |
| previousTurns trimming (Fix 4) | ⏳ Proposed, awaiting approval |
| Context caching evaluation (Fix 5) | ⏳ Future evaluation |
