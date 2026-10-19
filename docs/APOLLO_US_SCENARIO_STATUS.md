# US01–US35 scenario status (2026-09-21) — **developer scenario execution stopped at owner direction (revision-1 package)**

Historical results below are preserved with their original scope. Every scenario not marked `complete` is now **`deferred — owner evaluation`**: the owner assesses real-life behaviour on installed devices; missing scripts/runs are not developer-completion prerequisites and are not unfinished developer implementation. No new scripts, runs or reports will be produced by the developer unless explicitly requested later.

Statuses follow spec §19: `complete` (normal-screen journey achieved required outcomes with evidence), `partial` (useful outcome via a direct API probe or a subset of the journey; not the ordinary user route), `failed`, `blocked` (named prerequisite), `not_run`. **No scenario below is counted as passed on the strength of a direct API call alone.** Full-suite live execution through `tests/run_round1_user_scenarios.py` with the `ScenarioOutcome` schema is still to be done (Stage D25–D29).

Runner: `tests/run_us_scenarios.py` (Playwright, 390×844, real Gemini + Search grounding, no mocks, typed grading on `assessment`/`attention`/`completion`/findings/sources/registered clues/turn count — never keywords). Immutable runs under `test_reports/us_runs/<timestamp>/outcomes.json` with screenshots. Latest: `20260921T073918` (US01/03/05/06, US11, US35) and `20260921T075047` (US24).

| ID | Status | Evidence / gap |
|---|---|---|
| US01 scare page + support number | complete (Link screen, blocklisted test URL) | 3 findings, 7 sources; Higgins revised Apollo's block to `no_concern_found_within_scope` for Google's test page. Screenshot-of-scare-page variant not run |
| US02 delegated domain invoice | deferred — owner evaluation | |
| US03 late payment-redirection clue | **complete (Text screen)** | 23k-char message; `concern_found`/`action_needed`; 4 findings, 2 sources; two phone clues registered; completion `partial` (honestly lists remaining) |
| US04 25 URLs | partial | API regression only (inventory, none dropped) |
| US05 three bank numbers | **complete (Text screen)** | three `phone clue` items registered; `concern_found`/`action_needed`; actions incl. `open_verified_source` |
| US06 benign reminder | **complete (Text screen)** | `no_concern_found_within_scope`/`none`; one gentle instruction; research performed and disclosed |
| US07–US10 | deferred — owner evaluation | |
| US11 EXE disguised as PDF | complete (API, as defined) | detected executable, `normalise` transformation, never executed |
| US12 50-page PDF | partial | API probe (page-47 clue) — File screen journey not run |
| US13 protection permission changed | partial | API probe + browser device loop (US24) |
| US14–US23 | partial / deferred — owner evaluation | see previous catalogue; US19 delete → 410 (API); US17 reconnect implemented, fault injection not run |
| US24 File/Device follow-up with question | **complete (Ask screen)** | 4 real device observations (mock adapter, labelled `simulation` server-side), long answer ending in a question, answer continued the same case (2 accepted turns) |
| US25 Retry identity | partial | idempotency regressions |
| US26–US29 | deferred — owner evaluation | |
| US30 guardian/family delivery | blocked | adapters implemented; owner credentials absent |
| US31 secret + advice | partial | regression: secret redacted, advice retained; original purge on secret implemented |
| US32–US34 | deferred — owner evaluation / partial (US33 via US13 probe) | |
| US35 cross-owner | complete (API, as defined) | all 404 |

Known UI gap: observation evidence carrying a `simulation` label is stored and rejected for native profiles, but the InvestigationView does not yet surface a visible "simulated (preview)" badge for it.
