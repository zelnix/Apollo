# Apollo V1 — PRD & Build Log

## Original problem statement
Privacy-first mobile security app (iOS/Android, Expo + FastAPI + MongoDB) that detects, explains and — only where verified — blocks dangerous links, suspicious websites, unsafe connections and known threats. Four exact states: Resting / Growling / Barking / Biting. Apollo's Patrol shows what happened. Capability-aware, truthful UI; on-device-first; minimal indicators to backend; native module bridge (Swift/Kotlin) from day one; HuCentAI SecureCore mock SDK contract.

## User choices
- Ask Apollo: Gemini 3 Flash (user's own Google key, via emergentintegrations)
- Patrol: anonymous device ID + backend sync of event summaries (no accounts)
- Reputation: Google Safe Browsing (user key — currently rejected 401 by Google; surfaced truthfully as "Unavailable") + Apollo managed blocklist
- Design: dark "sentinel" palette (Sentinel Navy #0B1220, Charcoal, Slate, state colours green/amber/orange/red), Outfit + Geist fonts
- Native shell: TypeScript adapters + Swift/Kotlin Expo Module stubs + HuCentAI SecureCore mock SDK

## Architecture
- backend/server.py — FastAPI: /api/health, /api/devices/register, /api/intel/status, /api/intel/check (HMAC digest cache, blocklist + Safe Browsing), /api/patrol/events (upsert/list/patch/soft-delete), /api/trust, /api/ask/stream (SSE) + /api/ask/history
- frontend/src/domain — types, stateMachine (fast escalation, strict recovery: cooldown + fresh verification), risk (local deterministic URL checks), decision (local + intel → state), privacy (egress allow-list enforced in code), capability
- frontend/src/security — SecurityPlatformAdapter + Mock/IOS/Android adapters, fail-closed selector (EXPO_PUBLIC_SECURITY_MODE); securecore/ (HuCentAISecureCore contract, MockSecureCore + 21 scenarios, NativeSecureCore bridge, errors, safe logger, fail-closed selector EXPO_PUBLIC_SECURECORE_MODE)
- frontend/modules/apollo-security — local Expo Module: Swift + Kotlin stubs (truthful capabilities, blocks return verified:false)
- frontend/app — onboarding, (tabs)/{home,guard,patrol,ask,settings}, check (modal), patrol/[id], dev-tools (mock only)
- Docs: /app/SECURECORE_INTEGRATION.md

## Implemented (2026-06)
- Phase 1–5 MVP: domain layer, state machine, Patrol, capability model, privacy guardrails; native shell + truthful status UI; Check-a-link with local + intel; four states w/ thresholds; Patrol timeline + detail + Trust This (growling only, exact link) + revoke; verified block → Biting (mock adapter simulated, labelled); cautious de-escalation (2-min cooldown, verify-now freshness 10 min); Ask Apollo streaming explanation-only.
- Testing iteration 1: backend 13/13 after 422 fix; frontend flows verified (barking→biting→contained→growling→verify→resting; growling→trust→settings).

## Known gaps / notes
- Safe Browsing key returns 401 (API not enabled on the key's Google Cloud project or key restricted to Generative Language API). Enable "Safe Browsing API" for that project or create a separate key; backend picks it up from SAFE_BROWSING_API_KEY.
- Native Swift/Kotlin stubs only run in EAS dev/prod builds (Publish → build); Expo Go/web use labelled mocks.
- Connection Guard, Site Guard (real filter), Share intake: "coming later" (truthfully surfaced).

## Backlog
- P0: Real Safe Browsing key; EAS dev build smoke test of ApolloSecurity module
- P1: Share-sheet intake (iOS Share Extension / Android intent) → Link Guard; Safari content blocker / Android local VPN DNS filter for Site Guard
- P1: Threat-corpus + clean-set benchmark harness for launch gates (>=90% detect, <2% FP)
- P2: Connection Guard (Wi‑Fi safety), store permission copy review, Australian privacy disclosure screen
