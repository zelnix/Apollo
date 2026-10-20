# Hidden Fallback Audit — Apollo (June 2026)

Method: read the error paths, not the word "fallback". Every `try/except`, `catch`, default value,
`or`/`??` substitution, timeout path, provider switch, cache recovery, parse/validation recovery and
native-capability read in the frontend, backend and SDK bridges was classified.

Legend: **REMOVE** = manufactured a substitute result · **CHANGE** = useful resilience, dishonest
presentation · **KEEP** = already truthful.

---

## REMOVE — manufactured success (fixed)

| # | Location | What it did | Now |
|---|---|---|---|
| 1 | `backend/services/higgins/coordinator.py` | When Gemini's reply failed validation, Apollo **built a HigginsResponse out of the raw text**: `assessment: "uncertain"`, `attention: "review"`, a fabricated finding *"Investigation completed. Review the analysis above."*, `completion: "complete"`. A failed investigation was shown as a finished one. | The turn fails (`Outcome("invalid")`). Gemini's actual reply is carried verbatim (redacted, ≤4000 chars) into `DiagnosticDetail.provider_response` with `provider_model` and `provider_finish_reason`. Nothing is reshaped into findings. |
| 2 | `frontend/src/security/firstCheckSignals.ts` | A failed device-signal read was replaced with `EMPTY_SIGNALS` and the First Check then **graded the device** from signals it never read. | A read failure returns `erroredFirstCheck(...)` naming the failed read; no grading occurs. |
| 3 | `frontend/src/store/ApolloContext.tsx` (message gate) | URL coverage was read from `parsed.source` — a field that does not exist on `IntelResult` — so every link was recorded as `coverage: "intel"`. **"Reputation unavailable" became "checked"**, defeating the LIMITED Triage outcome. | Uses the real `parsed.coverage`; `"none"` maps to `"unavailable"`. |
| 4 | `frontend/app/call-guard.tsx` | When the investigation case was never created but reputation data existed, the phase was set to **`completed` with `error: null`**. | Phase is `failed` with the server's reason; reputation still displayed; retry offered. |
| 5 | `frontend/src/security/{call,messaging,web,appDevice}Sdk.ts` | One lenient helper returned the caller's fallback on **any** failure, so a native module that threw or returned unreadable JSON was indistinguishable from "nothing found" / "not blocked" / "unsupported". | New `nativeJson()` (`src/security/nativeDiagnostics.ts`): module **absent** → the declared "no capability on this host" value; module **present but failing** → records the failure and throws `NativeCallFailed`. |

## REMOVE-class bugs the audit uncovered (hidden by the swallows above)

- **Tier-2 escalation was dead on three gates.** `message_investigation`, `call_investigation` and
  `number_risk_investigation` were not registered in `EgressEndpoint`, so `enforceEgress` threw
  `TypeError` on `allowed.has(...)`. Every Magnum DI escalation from the message, call and
  number-risk gates failed — and `catch { /* investigation is async */ }` hid it. Endpoints are now
  registered with exactly the keys each backend route reads.
- **`client_item_id` was not a UUID** (`"call-content"`, `"number-risk"`) → 422 from
  `/investigations`. Now `Crypto.randomUUID()`.
- **The case id was read from the wrong field** (`remote.case_id`; the route returns
  `{ case: { id } }`), so even a successful escalation was never linked to the event.
- **Apollo's deterministic findings were dropped**: the message escalation sent `local_findings`,
  which `MessageAnalyseIn` does not accept. They now travel as `signals`, which the route reads.

## CHANGE — resilience kept, failure now visible

| Location | Change |
|---|---|
| `backend/services/higgins/jobs.py` | `response_invalid` copy no longer claims a repair attempt that does not exist ("It's trying to generate a corrected response" — there are no repair loops). Terminal message: *"Gemini returned a response Apollo couldn't validate. No investigation conclusion has been substituted — Gemini's actual reply is kept in the technical details."* |
| `backend/routers/investigations.py` `_launch_investigation` | Returned `(None, None)` on any failure. Now returns `(case_id, job, error)`: a created case is not thrown away, the failing stage is named, and "case opened but no turn started" is distinguished. |
| `backend/routers/analysis.py`, `backend/routers/call.py` | `MessageAnalyseOut`, `LinkInvestigateOut`, `PhoneInvestigateResponse` carry `investigation_error`; the gates pass it to the person. URL/phone intel still stands on its own. |
| `backend/services/intel.py` | `expand_redirects` silently returned a truncated chain, and a timeout became `chain = [value]` — i.e. "no redirects". New `expand_redirects_detailed()` returns `(chain, complete, reason)`. An incomplete expansion adds an `unavailable` `redirect_expansion` source and degrades `full` coverage to `partial`; the last hop is no longer called the final destination. |
| `backend/services/triage_engine.py` | Redirect records were written as `status: "ok"` even when expansion failed, and a failed Safe Browsing check on the final hop was `except: pass`. Now `status: "incomplete"` + `detail`, `final_url: null` with `last_seen_url`, and an unchecked destination is recorded as `unavailable`. |
| `backend/services/triage/engine.py` | `LINK-02` treats `incomplete` like `unavailable` → `NETWORK_CHECK_FAILED` coverage gap instead of "no malicious destination found". |
| `backend/services/higgins/chat.py` | Unreadable chat replies no longer say "Could you try rephrasing?" as if the question were the problem — they state the reply came back unreadable and that nothing was made up in its place. |
| `frontend/src/store/ApolloContext.tsx` (call risk) | `markNumberRisky` failure was swallowed while Apollo still told the person *"Apollo will reject future calls from this number automatically."* That sentence now requires a device confirmation (`ok === true`); otherwise Apollo says automatic blocking has **not** started and why. |
| `frontend/src/store/ApolloContext.tsx` ×3 gates | A failed/empty Tier-2 escalation appends an honest line to the event's `why`: Apollo couldn't start the deeper investigation, and the result is deterministic-only. |
| `frontend/src/store/ApolloContext.tsx` (DNS inbox, Private DNS, urgent refresh) | Silent catches now call `recordNativeFailure(...)`. Private DNS failure explicitly states it is **not** a confirmation that Private DNS is off. |
| `frontend/src/security/guarddog/GuardDogProductionSecurityAdapter.ts` | `getDnsThreatObservations` no longer returns `[]` on a failed read (propagates); `getCapabilities` reports the real error instead of asserting "rules missing/expired"; `triggerUrgentRuleRefresh` no longer swallows. |
| `frontend/src/protection/healthCoordinator.ts` + `src/domain/gates.ts` | A failed messaging/call capability read is now `unverified` (new `messagingReadFailed` / `callsReadFailed` inputs) rather than looking like a pending check or an unsupported platform. |
| `frontend/app/device.tsx` | "Device check incomplete… visible limits are listed below" (which implied a completed, limited check) → "Device check didn't run", with the real reason and "Nothing here says the device is clear". |
| `frontend/app/app-check.tsx` | A failed installed-app read no longer yields an empty list; a failed app-detail read no longer silently proceeds as if the device had been read. |
| `frontend/app/text-guard.tsx` | Automatic scanning shows **"Couldn't check"** when the capability read fails, instead of "Off"/"Not available". |
| `frontend/app/setup-gates.tsx` | The setup recap lists gates whose state Apollo could not read instead of omitting them; a failed device read is no longer reported as "That didn't open". |
| `frontend/src/components/InvestigationView.tsx` | Prefers the server's classified failure message; adds a `response_invalid` explanation; shows the verbatim provider reply, model and finish reason in the technical details and the copyable diagnostics. |
| `frontend/src/pipelines/textGuardPipeline.ts` | A failed read of the local findings queue reports a gap instead of behaving like "no findings". |

## KEEP — already truthful (verified, unchanged)

- `services/higgins/provider.py` — typed `ProviderFailure` with code/HTTP status/finish reason; **no
  silent model or provider switching**; mock mode never falls back to production.
- `services/intel.py` Safe Browsing — malformed or unreachable degrades to `unavailable`, never `clear`.
- `services/virustotal.py`, `services/rdap.py`, `services/phonerisk.py` — explicit
  `unknown`/`error`/`not_configured`/`unavailable` states; phone risk raises 503 after retries rather
  than inventing a decision.
- Deterministic Triage coverage gaps, bounded transient retries, `not_retried_permanent` for permanent
  platform limits, and `LIMITED ≠ POSSIBLE THREAT`.
- `WebSecurityAdapter` — states plainly that a browser blocks nothing; every unavailable capability
  carries its real reason.
- `NativeSecurityAdapters` — fails closed via `NativeModuleUnavailable`.
- `services/higgins/health_check.py` — synthetic input is labelled synthetic everywhere.
- `services/system_health.py` — every failure branch downgrades a named component with a code.
- `src/store/deliveryQueue.ts` — verifies the server acknowledgement matches the event, marks 4xx and
  `EgressViolation` as blocked (permanent failures are not retried), and says the event stays on the phone.
- `services/mailbox_monitor.py` — explicit `failed` / `budget_paused` / `temporary_case_unavailable` states.
- `readEmailCapability()` — "unable to verify" is explicitly not "disconnected".
- Local `JSON.parse` of app storage returning `[]`/`{}` — empty local state, not a security conclusion.
- Scam-alert caching — age and source are now shown by the freshness line (`alertFreshness`).

## Known gaps not addressed in this pass

- `runProtectionHealthCheck` returns the previous snapshot when a check fails. No data is fabricated
  and `checkedAt` keeps its original (older) timestamp, so it is classified KEEP, but the UI does not
  yet say "this check failed; showing the previous reading".
- `tests/protectionTruth.test.ts` and `tests/failureModes.test.ts` import
  `src/domain/protectionTruth.ts`, which no longer exists (`masterCopy` is gone from `src/`). They
  cannot run. ~25 frontend test files also fail to load under `node --test` because relative imports
  omit the `.ts` extension (Metro resolves them; Node's type-stripping does not). Pre-existing;
  unchanged by this pass.
