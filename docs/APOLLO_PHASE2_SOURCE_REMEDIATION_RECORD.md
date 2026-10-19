# Apollo Phase 2 source-remediation record

## Starting checkpoint — 2026-09-22

- Controlling instruction: `Apollo_Phase2_Source_Remediation_Developer_Instructions-1.md`.
- Exact starting Git SHA: `6fbd5b3bd5711a2ef0530da7c24a162ca2b57e79` on local `main`.
- The starting SHA exactly matches the source reviewed by the remediation instruction.
- No Git remote/upstream is configured in this workspace. The platform does not permit this agent to create/push a remediation branch; the final GitHub SHA therefore requires the supported Save to GitHub action after all source checks pass.
- Execution order: P2.0 → C19/C20 → C21 → C22 → C23 → C24 → C25 history/hub → C25 learning → C25 New scams → one integration pass.
- Preserved boundaries: `app.apollo.hwg`; owner-only `GEMINI_API_KEY`; frozen GuardDog source; existing case/evidence lifecycle; observed-packet-only Biting; zero runtime mocks outside the labelled browser fixture.
- Bounded verification only: TypeScript, ESLint, provider-disabled pytest, focused non-browser Node/component tests, Cargo and source/native-dependency preflight.

## Status

| Requirement | Status |
|---|---|
| P2.0 / V37 source subset | Complete in source |
| C19–C20 / V27–V28 | Complete |
| C21 / V29–V30 | Complete |
| C22 / V31 | Complete |
| C23 / V32–V33 | Complete |
| C24 / V34 | Complete |
| C25 / V35–V36 | Complete |
| Final integration | Complete in local source; GitHub save pending |

## Closure evidence

### P2.0 — production GuardDog default
- Ordinary `production` and `app-bundle` profiles select `guarddog_production`; acceptance remains test-only.
- Production rejects legacy and acceptance engines. Missing, invalid or expired signed authority yields an inactive typed status and never falls back.
- Production and staging preflight both pass with bounded source inputs; no artifact was built and no signing/field packet was attempted.
- All tracked files under the frozen GuardDog package roots are byte-unchanged from `6fbd5b3bd5711a2ef0530da7c24a162ca2b57e79` (`git diff` exit 0). The reviewed tree contains 406 tracked package files / 71 source-like files after generated-build exclusion; none were edited.

### C19–C20 — cleanup and navigation
- Retired source directory and guide are removed; active source, configuration, support, tests and design inputs have zero references.
- Preflight scans 261 active app/source/test/script files and rejects reintroduction.
- Root navigation remains exactly Home, Higgins, Gates, Check It, Patrol. Settings remains a shared top-right stack action.
- Settings double taps are guarded and `useFocusEffect` re-enables later openings without timers.

### C21 — Gate presentation
- One `GatePresentation` per Gate replaces split technical cards. Ten exact purposes, current-help copy, one status, optional genuine attention and one primary action are rendered.
- Automatic capability uses fresh native/service observations; Email requires a fresh successful heartbeat; Network no longer depends on Site Gate.
- Attention-first, working-automatic-second and on-demand-ready-third sorting is implemented.

### C22–C23 — ordinary chat, context and availability truth
- Ordinary Higgins chat has only seven registered read-only context functions. It has no search, browsing, file reading, evidence or case-start capability.
- Context results include provenance, observed/fresh-through timestamps, confidence and explicit none/unavailable states.
- Canonical unavailable reasons live in `shared/apollo_phase2_contracts.json`; frontend/backend contracts include privacy-prohibited and source-refused reasons.
- Device results without a required unavailable reason are rejected. Privacy egress violations map to `privacy_prohibited`, not adapter failure.

### C24 — Patrol
- Consumer output now uses five meaningful states, typed category/source, result, result basis, repeat count, primary/secondary actions and why-this-rating.
- Filters are exactly All activity, Needs you, Warnings, Threats stopped and Resolved.
- Commands/diagnostics are excluded; repeated same-incident outcomes collapse; Biting is downgraded unless verified block evidence exists.

### C25 — Higgins hub, history, learning and New scams
- Higgins hub remains visible regardless of ordinary transcript state and keeps independent entry points for chat, live work, recent work, history, saved reports, learning and New scams.
- Redacted investigation summaries are projected before temporary case cleanup. History adds search, filters, pagination, reopen and owner-scoped soft delete.
- Backend seeds exactly 35 owner-curated practical articles with full metadata and bodies. Consumer list/detail routes are no-store readers; article bodies do not ship in the bundle.
- Admin-authenticated APIs edit/publish/archive articles, inspect feed registry/status, refresh one/all feeds and write audit records.
- New scams accepts only recognised Australian government hosts, separates live alerts from official advice, exposes source/freshness/age, and falls back to official advice without relabelling it as new.

## Bounded validation record
- TypeScript: pass.
- ESLint: pass.
- Python lint: pass.
- Focused Node unit/source tests: **373 passed**.
- Provider-disabled pytest: **61 passed**; no live Gemini call.
- Staging and production security/native-dependency preflight: pass; 261 active files scanned.
- Cargo: pass.
- Backend startup/health: pass; exactly 35 published learning articles initialised.
- Active retired-reference search: zero results. Historical records were intentionally retained.
- Source manifest: 606 frontend/backend/desktop/shared files, SHA-256 `ed31a214ebccdaf80a9fae4e5dd4b9700e50d5ef58d8fc6f23eedd98a9749e67` (dependencies, generated builds, caches and env files excluded).

## Required final source handoff
- Starting/reviewed SHA remains `6fbd5b3bd5711a2ef0530da7c24a162ca2b57e79` because this agent cannot commit or push.
- The complete remediation is present in the local working tree. The final GitHub SHA is pending the supported Save to GitHub action and must be passed to the separate build owner before any fresh signed candidate is produced.
- No app-build profile was run; no artifact was generated; no device verification, signing, field packet, release-note packet or deployment was performed.
