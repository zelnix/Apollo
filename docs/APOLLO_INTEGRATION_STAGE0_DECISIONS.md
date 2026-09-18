# Apollo Production Protection Integration — Stage 0 Decisions (2026-06)

**Status: DOCUMENTATION ONLY. No migration/implementation code in this milestone.**
Companion to `docs/APOLLO_PRODUCTION_PROTECTION_INTEGRATION_ASSESSMENT.md` (the target
architecture and full assessment). This document closes the six Stage-0 items the user required
to be locked *before* Stage 1 (engine promotion) may begin. Direction approved by the user;
these six items are the gate on starting any actual migration code.

**Frozen principles carried into every decision below (unconditional, restated from the user):**
- `com.guarddog.*` remains the proven native enforcement engine — never renamed.
- `main` keeps its existing `SecurityPlatformAdapter`/`PlatformCapabilityProfile`/`EnforcementEvidence` contracts as the consumer-facing seam — never redesigned to fit Guard Dog.
- `ApolloDnsVpnService` is retired as an *implementation*; `com.hucentai.apollosecurity`'s outward package/contract stays stable throughout migration.
- The acceptance harness (`phase6-*`, DNS/DoH characterization wizard) remains engineering/certification-only — never shipped into the consumer product.
- `THREAT_BLOCKED` remains evidence-backed only, from a real observed+dropped packet — never from a rule/DNS/intent match alone.
- **Apollo acts. Higgins interprets.** Higgins consumes deterministic native truth; Ask Higgins/LLM behavior must never create, alter, or upgrade enforcement evidence.

---

## 1. Production signing authority

**Decision: promote Guard Dog's existing signing backend (JCS canonicalization + Ed25519 + key registry + rule_bundle service) as the production signing authority — do not build a second one.** Specifics to close before Stage 1's backend work:

- **Where bundles are signed**: the same `rule_signer`/`key_registry`/`rule_bundle` services already proven in this repo's backend (`backend/app/services/`), running in whatever hosting environment `main`'s production backend uses — a promoted/shared service, not a copy.
- **Where the private signing key lives**: a **brand-new production Ed25519 keypair** (e.g. `gd-prod-ed25519-001`) generated fresh for production — **never** the existing test key `gd-m1-test-ed25519-001` (or its rollover `002`), which stays scoped to `m2-native-acceptance`'s own CI/physical-device testing forever. The production private key material must live in a proper secret store for whatever hosts the production backend (never committed, never in a `.env.example`, never in this sandbox).
- **How the public key is pinned in Apollo**: the exact same mechanism `com.guarddog.core`'s `TrustedKeyRegistry` already uses today (pinned public key(s) the native engine trusts) — only the key material changes, not the pinning mechanism.
- **Versioning/rollback**: production gets its **own independent bundle-version lineage**, starting fresh (never continuing or sharing a counter with `gd-m1-controlled-block`/`gd-m2-website-gate`/`gd-m2-dns-diagnostic-wizard`'s test version histories). The existing frozen-version-guard pattern (`GD_M1_FROZEN_BUNDLE_VERSION` → 409 `BUNDLE_FROZEN` unless explicitly unfrozen) is the template for how a production bundle version gets deliberately frozen/rolled back.
- **Key rotation**: adopt the same dual-key (`current` + `rollover`) pattern the test key already uses (`...001` + `...002`) from the production key's first day, so a future rotation is a proven, already-exercised procedure rather than a first-time event on a live system.
- **Revocation**: **open question, flagged for Stage 1 design** — needs an explicit answer for whether the native `TrustedKeyRegistry` is a build-time-pinned constant (in which case "revocation" means an app update) or is capable of fetching an updated trusted-key set from the backend at runtime (in which case a compromised key could be revoked server-side without an app update). Whichever it is, the answer must be made explicit and tested before production launch — not assumed.
- **Backend/bundle unavailable fallback**: the engine must **fail safe, not fail open** — if the backend is unreachable, the app continues enforcing the **last successfully accepted, signature-verified bundle** already on-device rather than silently disabling Website Gate or accepting an unsigned/unverified fallback. This mirrors the existing M1 provider-abstraction precedent (Google Web Risk stays fail-open/unavailable *for threat-intel lookups*, but that is a different layer from bundle acceptance itself, which must never silently degrade to "unprotected").
- **Guardrail (explicit, non-negotiable)**: production's `GD_SIGNING_ALLOWED_RULESETS`-equivalent allow-list must be a **disjoint set of ruleset IDs** from the test/certification ones (`gd-m1-controlled-block`, `gd-m2-website-gate`, `gd-m2-dns-diagnostic-wizard`). The current test key and test rulesets must **never** become the production authority by accident (e.g. via a copy-pasted `.env` or an unfrozen version bump against the wrong bundle).

---

## 2. Consumer adapter ownership (naming — corrected)

**Decision, restated precisely**: the package split is by **role**, not by which codebase is "kept" vs "replaced" wholesale:

```
com.hucentai.apollosecurity   =  Apollo-facing adapter / API   (existing package, KEPT — thin, product-owned)
com.guarddog.*                 =  protection engine              (existing package, KEPT — proven, product-agnostic, promoted as a dependency)
```

- `com.hucentai.apollosecurity`'s **implementation** (`ApolloDnsVpnService`'s own DNS loop, its `SharedPreferences` blocklist, its own `EnforcementEvidence` factories) is retired and replaced with delegation into `com.guarddog.*`'s engine calls.
- `com.hucentai.apollosecurity`'s **package identity, Expo module registration name, and everything `main`'s TypeScript already imports it as** (`NativeSecurityAdapters.ts`, `nativeBridge.ts`) stay exactly where they are — zero churn on the product-facing side.
- `com.guarddog.*` is imported as a native dependency of `com.hucentai.apollosecurity`'s new adapter code; it is never modified, never merged into, and never renamed to fit the product namespace.
- This supersedes the earlier assessment draft's §5.3/5.8 suggestion of inventing a brand-new adapter package name — both of those sections have been corrected in `docs/APOLLO_PRODUCTION_PROTECTION_INTEGRATION_ASSESSMENT.md` to match this decision.

---

## 3. Engine promotion/import method

**Decision: an auditable, provenance-preserving, mechanical promotion — never a manual rewrite.**

- **Frozen source commit**: `e5d11be912c76775c5a8b27b53218211484ca8bd` on `m2-native-acceptance` (the commit behind the physical Pixel 10 run that froze the DNS/DoH characterization instrument; also carries the already-frozen M2.1/Phase 6A state). Any later commit that only changes engineering-harness files (not `packages/guarddog-android-sdk`/`packages/guarddog-expo-module`) does not change which commit is "the frozen engine source" — but if the engine packages themselves are ever touched again post-freeze, the pinned commit must be explicitly re-confirmed against the new SHA before promotion, not silently advanced.
- **Mechanism**: promotion must be a **mechanical, scriptable copy** of exactly `packages/guarddog-android-sdk/` and `packages/guarddog-expo-module/` from that pinned commit (e.g. `git subtree`/`git archive` extraction, or an equivalent reproducible export) into the new integration branch — never hand-retyped or "cleaned up" during the copy. A reviewer must be able to mechanically diff the promoted copy against `git show e5d11be9:packages/guarddog-android-sdk` (etc.) and get zero unexplained differences.
- **Provenance record**: the promotion commit on the new integration branch must carry a manifest (e.g. `ENGINE_PROVENANCE.md` or `.engine-provenance.json` alongside the promoted directories) recording: source repo/branch, exact source commit SHA (`e5d11be9...`), the exact native-gates CI run ID that certified that commit (`35171369548`), and the promotion date. This makes any *future* divergence between the promoted copy and the source mechanically detectable (diff against the recorded SHA) rather than a matter of memory.
- **Branch policy**: the integration work begins on a **new branch created from `main`** (the consumer app's own branch), never by converting `m2-native-acceptance` into the consumer app and never by merging `m2-native-acceptance` wholesale into `main` (see the assessment doc §9 for the full cross-contamination guardrails, restated below in item 4).

---

## 4. Production vs certification boundary — explicit manifest

**Promoted into `main` (production):**
| Module | Component |
|---|---|
| `packages/guarddog-android-sdk/guarddog-core` | `GuardDogSDKEngine`, `RuleBundleVerifier`, `TrustedKeyRegistry`, `BundleVersionStore`, `HostCanonicalizer`, `UrlSanitizer`, `SecurityEvent`/`BlockedThreatEvidence` |
| `packages/guarddog-android-sdk/guarddog-vpn` | `GuardDogVpnService`, `TunSession`(+recovery), `SelectiveRouteInstaller`, `PacketDropReporter`, `DnsGatewayPacketHandler`, `DnsPacketClassifier`, `DnsQueryParser`, `DnsResponseSynthesizer`, `SinkholeBindingStore`, `WebsiteGatePacketAuthorizer`, `WebsiteGateAddressing`, `WebsiteGateOverrideStore`, `UpstreamDnsForwarder`/`SocketProtector`/`ProtectedUdpDnsForwarder`, `VpnStateRepository`, `VpnLifecycleState`, `RecoveryStatus`, `ControlledEndpointResolver` (reconfigured for production, not the test controlled-endpoint), `BlockedFlowDeduper`, `ProtectionNotificationFactory` |
| `packages/guarddog-expo-module` (production-relevant subset) | `configureWebsiteGate`, `acceptWebsiteGateRuleBundle`, `getWebsiteGateStatus`, override management (`setWebsiteGateAllowOverride`/`getWebsiteGateOverrides`/`clearWebsiteGateOverrides`), `getProtectionState`, `getEnforcementStats`, `getEnforcementEvidence`, `getBuildProvenance`, `requestPermission`, `startProtection`, `stopProtection` |
| Backend | `rule_signer`, `key_registry`, `rule_bundle` services (new production keypair/ruleset IDs per item 1 — the *code*, not the test data, is what's promoted) |

**Remains certification-only (never shipped into `main`):**
| Module | Component |
|---|---|
| Frontend | `app/index.tsx` (harness home), `phase6-acceptance.tsx`, `phase6-automated.tsx` + `phase6AutomatedHarness.ts`/`phase6AutomatedReport.ts` 🔒, `dns-capability-diagnostic.tsx` + `dnsCapabilityDiagnostic.ts`/`dnsWizardProbeGate.ts`/`dnsCapabilityDiagnosticReport.ts` 🔒 |
| Native (diagnostic-only functions) | `GuardDogExpoModule.kt`'s `getPhase6DeviceProvenance`, `getDnsCapabilityDeviceSnapshot`, `openPrivateDnsSettings`, `listHttpsCapableBrowsers`, `openUrlInBrowserPackage` — tester tools; harmless if physically present but **no consumer UI may ever call them** |
| Backend | `GD_CI_EPHEMERAL_KEY` test-signing lane, test rulesets (`gd-m1-controlled-block`, `gd-m2-website-gate`, `gd-m2-dns-diagnostic-wizard`) and their test keypair(s), the DNS-diagnostics receipt endpoint (`/api/dns-diagnostics/receipts/{nonce}`) |
| CI/docs | `.github/workflows/native-gates.yml` (stays the engine's own certification gate, run from wherever the engine's source-of-truth lives), `docs/M2_PHASE6_ACCEPTANCE_TEMPLATE.md`, `docs/dns-capability-characterization.md` |

**Diagnostic APIs that exist in the promoted native module but must stay unreachable from any consumer screen**: the five tester-tool functions listed above. Recommendation for Stage 1: leave them present in the promoted `guarddog-expo-module` copy (removing them would diverge from the pinned source per item 3) but do not wire any `main` UI/adapter code to call them.

**Test endpoints/keys/rules that must never ship**: `gd-m1-test-ed25519-001`/`002`, every `blocktest.btciq.app`/`dnsprobe.*`/`dnswiz-*` controlled hostname, `GD_CI_EPHEMERAL_KEY`, `GD_ADMIN_TOKEN=ci-admin`-style CI-only credentials.

---

## 5. Higgins truth boundary (defined now, NOT built — Higgins Checkup remains un-started)

**Decision: define the read-only native health/evidence interface Higgins will eventually consume, so Stage 1+ engine work exposes the right shape from day one — without building Higgins Checkup itself.**

Higgins may read and narrate, once wired (a future milestone, not this one):
- Protection active/inactive (`getProtectionState()`)
- Secure connection/TUN health (open/closed, selective route active)
- DNS gateway state (`dnsGatewayActive`)
- Rule validity/currentness (accepted ruleset ID + bundle version + signature-verified timestamp; whether the current bundle is stale/frozen)
- Last verified enforcement evidence (`getEnforcementEvidence()`/`getEnforcementStats()` — real, observed-drop-backed records only)
- Capability gaps (the frozen DNS/DoH characterization results — e.g. "plaintext DNS visible; Private DNS Strict and browser DoH are not currently provable either way")

**Absolute boundary, restated as an implementation requirement for whoever builds Higgins Checkup later**: Higgins (Ask Higgins/Gemini or any LLM-driven narration) is a **read-only consumer** of the above facts. It must never:
- independently decide or assert that Apollo blocked a threat,
- create, alter, upgrade, or "helpfully reinterpret" any `EnforcementEvidence`/`BlockedThreatEvidence` record,
- promote an UNOBSERVABLE/NOT_TESTABLE capability into a BYPASSED/CAPTURED claim through inference or confident-sounding language.

`Apollo acts. Higgins interprets.` — this boundary is definitional, not a suggestion, and should be treated with the same rigor as the `THREAT_BLOCKED` invariant itself when Higgins Checkup is eventually implemented.

---

## 6. Commit status

`docs/APOLLO_PRODUCTION_PROTECTION_INTEGRATION_ASSESSMENT.md` and this file are committed together in the same local commit as this Stage 0 closure (see git log) — both must reach GitHub via "Save to GitHub" (this sandbox has no push access) before being treated as the durable, auditable decision record the user requested.

---

## Status / next step

All six Stage 0 items are now documented. **Stage 1 (engine promotion) does not begin until the user reviews this document and gives explicit go-ahead** — per their own instruction: "stop and report back before Stage 1 implementation."
