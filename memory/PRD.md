# Guard Dog — PRD / Memory

## Original problem statement (summary)
Frozen M1 execution spec (Part 4.1 Android real blocking proof + Part 5 FastAPI signed rules / threat intelligence). Preserve public SDK boundary (`requestPermission("vpn")`, `startProtection()`), truthfulness rule (THREAT_BLOCKED only from observed + dropped packet), privacy-first local-first boundary, canonical repository file plan, no parallel trees.

## User choices (2026-06)
- Scaffold canonical monorepo in /app from scratch; task board at docs/M1_TASK_BOARD.md; implement directly.
- Controlled endpoint placeholders via env: m1-block-test.guarddog.example / 203.0.113.10 (not acceptance targets).
- Google Web Risk: provider abstraction + env key wiring + mocked tests; no live key.
- Fresh M1 test-only Ed25519 keypair `gd-m1-test-ed25519-001` (+ rollover key 002); private keys in gitignored backend/.env; .env.example without secrets.
- Kotlin/Swift: complete source + tests, labelled code-review ready / not runtime-verified.

## Architecture
- backend/app (FastAPI, motor): routes health/config/rules/keys/intelligence; services jcs (rfc8785), rule_signer, key_registry, rule_bundle, provider_cache, intelligence; providers base + google_webrisk; repositories for the 5 allowed Mongo collections. server.py re-exports app.main:app.
- packages/guarddog-contracts: TS contracts; synced to frontend/src/contracts/shared by script.
- Android: guarddog-core (platform-agnostic; verifier, canonicalizer, engine, abstractions) ← guarddog-vpn (service, /32 route, TUN reader, drop reporter, deduper) ← expo module (records, adapters, module class).
- iOS: GuardDogCore (verifier, JCS, canonicalizer, CapabilityProvider) ← GuardDogNetworkFeasibility; Expo iOS module + DTO adapters (analysis-only, never THREAT_BLOCKED).
- apps/guarddog-mobile == frontend (symlink): SDK, contracts, harness, index.tsx harness screen.

## Implemented (2026-06)
- All spec files created (see docs/M1_TASK_BOARD.md). Backend 93 pytest passing; contracts 14 node tests passing; fixtures generated; web harness verified via screenshot (BLOCKED/SKIPPED honest states).
- Native gate round: signing guard (admin token + GD_SIGNING_ENABLED + confirm + ruleset allow-list + controlled-config check; secret redaction), endpoint verify/resign scripts, Gradle root + CI gate scripts (android/ios), Expo config plugin linking the Android SDK modules, android-dev-build script with merged-manifest checks, TunSession recovery + tests, proof report export (JSON + PDF via expo-print), docs/M1_NATIVE_GATE.md (status OPEN).

## Backlog / remaining
- Real endpoint injected 2026-06: blocktest.btciq.app / 52.25.179.131 / https://blocktest.btciq.app/ (verify script: single A record match, HTTPS 200). Live bundle NOT resigned (v17, old host) — waiting for user confirmation of Elastic IP association; then `python scripts/resign_controlled_bundle.py --confirm`. Live signing tests gated by GD_RUN_LIVE_TESTS=1.
- Out of scope for M1 (user decision): backend evidence upload/archiving of proof reports. Local JSON + PDF export only.
- P0 (blocked on inputs/native machine): real controlled host + static IPv4 + URL from user; run scripts/ci/android-native-gate.sh, ios-native-gate.sh, android-dev-build.sh; physical-device proof; recovery run; export report. M1 stays OPEN until then.
- P1: SharedPreferences store hardening (EncryptedSharedPreferences), backend admin auth beyond static token, provider retry/backoff.
- P2: iOS enforcement feasibility beyond M1 (out of scope), Threat Scent UX.
