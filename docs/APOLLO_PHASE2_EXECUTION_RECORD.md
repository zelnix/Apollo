# Apollo Phase 2 execution record

## Authorised baseline — 2026-09-22

- Controlling instruction: `Apollo_Consolidated_Architecture_and_Execution_Mandate-3.md`, **Phase 2 execution cover**.
- Exact full source HEAD recorded before any Phase 2 source change: `d1ab4ff22f7476fefd3999e6c292c3ac92f2e30b` (`main`, commit time `2026-09-22T14:17:17+00:00`).
- This workspace has no configured Git remote or upstream reference, so the recorded current saved `main` HEAD is the only repository HEAD available locally; it is not substituted with the older architectural review anchor.
- M1–M4 are accepted as the completed baseline and will not be reopened. Only a concrete Phase 2 regression may touch a baseline boundary.
- Active order: P2.1 → P2.2 → P2.3 → P2.4 → P2.5 → P2.6.
- Active register: C19–C25 and V27–V36.
- Bounded verification only: TypeScript, ESLint, provider-disabled pytest, native source/preflight checks and Cargo. No testing agent, Playwright, scenario suite or live Gemini probe.
- AI boundary: owner-managed `GEMINI_API_KEY` only. No Emergent-managed LLM key or alternate provider.
- Android application ID remains `app.apollo.hwg`.

## Workstream status

| Workstream | Status | Closure evidence |
|---|---|---|
| P2.1 — Architecture and navigation cleanup | Complete | C19–C20 implemented: retired security boundary removed; exact five-tab navigation, stack Settings and ten-item Check It catalogue compile and lint clean |
| P2.2 — Understandable Gate capability | Complete | C21 implemented: automatic and on-demand status are independent for all ten Gates; fresh mailbox heartbeat drives Email Gate; TypeScript and ESLint clean |
| P2.3 — Higgins chat and context | Complete | C22–C23 implemented: ordinary chat has no case/tool boundary; explicit transition remains separate; typed encrypted owner context enforces redaction/freshness; TypeScript/ESLint/Python lint clean and 3 provider-disabled pytest checks pass |
| P2.4 — Apollo's Patrol | Complete | C24 implemented: Patrol projects consumer outcomes, suppresses command/diagnostic events, folds repeated incidents and exposes only All / Needs you / Handled; TypeScript and ESLint clean |
| P2.5 — Higgins hub, history and learning | Complete | C25 implemented: central Higgins hub, current/recent work, redacted owner history, saved reports, learning and configured Australian-government alerts with fresh/stale/unavailable truth; TypeScript/ESLint/Python lint clean and provider-disabled ownership/feed pytest checks pass |
| P2.6 — Integration and current candidate | Source complete; installable artifact externally blocked | Integrated 1.1.0 / Android versionCode 2 source candidate passes all bounded checks. Apollo-owned Android release modules compile. A signed APK/AAB was not produced because this Linux ARM64 host has no supported React Native Hermes host compiler; no fake compiler or unsigned substitute was used. |

## Phase 2 closure register

| Finding | Closure |
|---|---|
| C19 | Retired security component removed from bundled source, tests, support copy and build selectors. Preflight rejects any reintroduction. |
| C20 | Root navigation is exactly Home, Higgins, Gates, Check It, Patrol. Settings is a stack/modal route with one shared, guarded header action. Home no longer duplicates checks. |
| C21 | Every Gate independently reports Automatic protection and Check when I ask. Email automatic state requires a fresh successful mailbox heartbeat. |
| C22 | Ordinary Higgins chat is a separate no-tools/no-case route. A case is created only by an explicit user action through the existing investigation API. |
| C23 | Typed context categories are encrypted, owner-scoped, redacted, provenance-labelled, freshness-bounded and count-limited. |
| C24 | Patrol projects meaningful consumer outcomes, excludes command/system noise and folds same-incident repeats into a repeat count. Filters are All, Needs you and Handled. |
| C25 | Higgins is the front door for ordinary chat, current/recent investigations, redacted history, saved reports, learning and configured Australian-government alerts. |

## Phase 2 verification register

| Check | Result | Evidence |
|---|---|---|
| V27 | Pass | Retired source tree deleted; zero current app/source/test/script references; device-test security preflight passes. |
| V28 | Pass | Exact tab order, ten immutable Check It items, stack Settings, direct typed destinations and guarded repeated taps compile and lint clean. |
| V29 | Pass | Ten Gate rows expose separate `automaticStatus` and `onDemandStatus`; no shared mode/status field remains. |
| V30 | Pass | Site uses current OS/native evidence; Text/Call use native capability; Email uses connection/request/fresh-success/error truth; manual checks remain available without automatic claims. |
| V31 | Pass | Provider-disabled pytest proves ordinary chat creates zero investigation cases, jobs, events or evidence. |
| V32 | Pass | Provider-disabled pytest proves the separate explicit investigation endpoint creates the case; mobile action is user-triggered. |
| V33 | Pass | Provider-disabled pytest proves context/history owner isolation, secret redaction and stale-context exclusion. |
| V34 | Pass | Pure outcome projection excludes command text, deduplicates a repeated incident and derives Handled only from contained/resolved/trusted outcomes. |
| V35 | Pass | Higgins hub, current/recent work, history, saved reports, learning and New scams routes compile and lint clean. |
| V36 | Pass | Government parser accepts only allowlisted HTTPS `cyber.gov.au` article links and UI exposes fresh/stale/unavailable plus non-comprehensive coverage. No Gemini summarisation is used. |

## Integrated candidate record

- Candidate: `Apollo 1.1.0 · Android 2 · Phase 2 RC1`.
- Android application ID: `app.apollo.hwg` (unchanged).
- Starting saved HEAD: `d1ab4ff22f7476fefd3999e6c292c3ac92f2e30b`.
- Tracked source delta digest: `80db902ef748a9152b478626d5efe9507b5106f36210f371d8bf9d4fa406eae1`.
- Full frontend/backend/desktop source manifest: 595 files, SHA-256 `89ff568a486debe27e174d794ac650837699aa6ac1c0fae46e4bb8dba92768da` (tracked plus untracked candidate files; generated builds, caches, dependencies and env files excluded).
- TypeScript: pass.
- ESLint: pass.
- Python lint: pass.
- Provider-disabled pytest: 53 pass in the final completed Phase 2 run; no live Gemini scenario.
- Security/native dependency preflight: pass; 181 app sources and 923 installed packages checked.
- Cargo: `apollo-desktop v1.1.0` check pass.
- Android release Kotlin: `guarddog-core`, `guarddog-vpn` and `apollo-security` pass with SDK 36 / Java 17. The compile exposed and closed two concrete baseline build defects: missing serialization classpath and a stale removed receiver reference.
- Full Android bundle: externally blocked on this ARM64 Linux host at Hermes JS compilation (`OS not recognized`). React Native provides no compatible Hermes host compiler here. No fake compiler, unsigned artifact or fabricated candidate URL was created.
- GuardDog production-default cutover remains separate and was not activated by Phase 2.

## Runtime and readiness note

- Final runtime check: Supervisor reports MongoDB, backend and Expo RUNNING; `/api/health` returns `ok / apollo-v1`; the protected preview proxy returns HTTP 200.
- The static deployment scanner reports one unresolved `--tunnel` complaint against `/etc/supervisor/conf.d/supervisord.conf`. That file explicitly declares itself read-only and already supplies the protected `EXPO_PACKAGER_PROXY_URL`; it was not modified. The scanner otherwise passed compilation, env, URL, CORS, secret, database and source checks.
- This scanner complaint is recorded as a platform-policy false positive against a working protected proxy, not hidden or relabelled as a source fix.
