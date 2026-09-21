# US01–US35 scenario status (2026-09-21, engine session)

Statuses follow spec §19: `complete` (normal-screen journey achieved required outcomes with evidence), `partial` (useful outcome via a direct API probe or a subset of the journey; not the ordinary user route), `failed`, `blocked` (named prerequisite), `not_run`. **No scenario below is counted as passed on the strength of a direct API call alone.** Full-suite live execution through `tests/run_round1_user_scenarios.py` with the `ScenarioOutcome` schema is still to be done (Stage D25–D29).

| ID | Status | Evidence / gap |
|---|---|---|
| US01 scare page + support number | not_run | Site handoff now carries URL + link-check observations; screenshot evidence path exists via File/Text |
| US02 delegated domain invoice | not_run | Engine researches organisations; Email handoff carries full email |
| US03 late payment-redirection clue | partial | API probe: 23,912-char message, clue after ~22k found; follow-up "I already paid" answered in same case |
| US04 25 URLs, decisive #24 | partial | Regression: 25 URLs inventoried, none dropped; Gemini disposition of #24 not run |
| US05 three bank numbers | not_run | `lookup_reputation(phone)` with region inference implemented |
| US06 benign appointment reminder | not_run | Validation permits `attention: none`, no action |
| US07 Wi-Fi profile install | not_run | Network handoff carries signals text |
| US08 reset code entered | not_run | Account handoff carries alert + user-reported action |
| US09 Gmail attachment name only | not_run | Attachment bytes must be uploaded; filename alone stays metadata coverage |
| US10 dormant remote-support app | not_run | `research_application` implemented; App handoff carries described app |
| US11 EXE disguised as PDF | partial | Regression: MZ bytes declared PDF → detected executable, `normalise` transformation, coverage `unavailable`, never executed |
| US12 50-page PDF, link page 47 | partial | API probe: page-47 clue found, reputation lookup, `urgent`; not via File screen |
| US13 protection permission changed | partial | API probe: device request → result → resume, no tampering claim; settings plan `match=exact` |
| US14 return without granting | partial | `/recheck` returns `not_yet_correct`/`cannot_observe`; Device screen UI not wired |
| US15 four platforms | not_run | |
| US16 12-turn correction | partial | 2 turns in one case verified; 12-turn budget/history compaction not exercised |
| US17 connection drop | partial | Client reconnects from `after=`; server keeps job; fault injection not run |
| US18 rate limit + source failure | not_run | Retry classification/backoff implemented |
| US19 cancel/delete then revisit | partial | Delete → 410, idempotent repeat; expiry revisit not run |
| US20 prompt injection | not_run | System prompt + tool authority boundaries in place |
| US21 preview simulation labelled | not_run | AR-11 not started |
| US22 unknown organisation | partial | Link probe researched AusPost/Linkt claims with grounded sources |
| US23 screenshot vs OCR | not_run | Original image inline to Gemini implemented |
| US24 >900-char answer with question | complete (browser) | Ask general question: long explanation rendered, `waiting_user` question shown |
| US25 second question fails, Retry | partial | Idempotency: same key → same job; changed payload → 409; failure injection not run |
| US26 benign notice via Email + Link | not_run | |
| US27 read aloud then delete | not_run | Case speech job + cleanup implemented |
| US28 storage failure before publish | not_run | Staged/accepted commit implemented; injection harness absent |
| US29 old case expires, new continues | not_run | Per-case expiry timers implemented |
| US30 guardian/family without delivery | blocked | Adapters unimplemented; 503 |
| US31 advice mentions password + real secret | partial | Regression: secret redacted, advice retained |
| US32 legitimate powerful permission | not_run | |
| US33 internet ok, protection stopped | partial | Same probe as US13: concern separated from connectivity |
| US34 readable vs encrypted document | partial | Encrypted PDF → `unavailable` coverage path implemented; not run end-to-end |
| US35 guessed IDs from another owner | complete (API) | Regression: case/evidence/sources/turns/delete → 404 for another owner |

Browser journeys executed this session (real Gemini, 390×844 preview): Ask general question (US24-like); Text Gate → "Ask Higgins" with original message → 3 sources, two actions (Text concerning variant). All other Gate journeys: **not_run**.
