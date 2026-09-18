# Apollo Production Protection Integration Assessment (2026-06)

**Status: ASSESSMENT ONLY — no code, no migration, no refactor performed in this milestone.**
Renamed from "Android Native Consolidation Assessment" per explicit user correction: this is
**not** a decision about merging two competing whole applications. It is a decision about how
the already-frozen, physically-proven `com.guarddog.*` native enforcement engine becomes the
**production protection engine** underneath the separate, existing consumer Apollo app —
without importing the engineering/acceptance harness, and without weakening any frozen guarantee.

Investigation method: this sandbox has no git remote (`origin` not configured), so GitHub `main`
was inspected read-only via its public web/raw endpoints (`github.com/zelnix/Apollo`, branch
`main`) — file trees, `app.json`, `SecurityPlatformAdapter.ts`, `ApolloDnsVpnService.kt`, and the
`backend/` directory listing were read directly from source. `m2-native-acceptance` (this
sandbox's checked-out branch, HEAD `e5d11be9`) was inspected locally. No files on either side
were modified.

---

## 0. The actual relationship (corrected framing)

| | `m2-native-acceptance` (this sandbox) | GitHub `main` |
|---|---|---|
| Role in the Apollo project | **Native enforcement + diagnostic proof environment.** Where VPN/TUN, DNS, Website Gate, signed-rule, evidence and acceptance rigor is designed, tested, and frozen before anything touches real users. | **Consumer-facing Apollo application.** The product people actually install: Home/Guard/Patrol/Ask Higgins/Settings, family pairing, guardian alerts, Site/Network/Account/App/Message/Call Guards. |
| App identity | `com.emergent.guarddogm.k6cugf` / "Apollo Native Gates" | `app.hwg.apollo` / "Apollo" |
| Native protection module | `packages/guarddog-android-sdk` (`com.guarddog.core`, `com.guarddog.vpn`) + `packages/guarddog-expo-module` (`com.guarddog.expo`) | `frontend/modules/apollo-security/android` (`com.hucentai.apollosecurity`) |
| Backend | FastAPI: Ed25519-signed rule bundles, threat-intel provider abstraction, DNS-diagnostics receipts | FastAPI: family pairing, guardian alerts, Ask Higgins (Gemini + OpenAI TTS), admin audit, HIBP breach checks, `PatrolEvent` |
| Freeze status | M1 🔒 FROZEN · M2.1 Website Gate 🔒 FROZEN PASS · Phase 6A 🔒 FROZEN PASS · DNS/DoH characterization instrument 🔒 FROZEN | Actively developed (commits as recent as last week — "Truth-of-State Correction," Higgins voice, voice notes, etc.) |
| Current coupling | **Zero.** `packages/guarddog-*` does not exist on `main`; `frontend/modules/apollo-security` does not exist on this branch. Confirmed by direct inspection of both trees. | |

This was **intentional**, per the user: the two were deliberately kept apart while M2.1/Phase 6A/
the DNS-DoH instrument were still being designed, tested, and proven. That validation is now
complete. The question this document answers is narrower than "which app wins" — it is:

> **How does the proven `com.guarddog.*` engine become the production protection engine under
> the consumer Apollo app, while the engineering/acceptance harness stays exactly where it is?**

---

## 1. Architecture map

### 1a. Current state (two isolated stacks, one repo, two branches)

```
GitHub repo: zelnix/Apollo
│
├── branch: main  ─────────────────────────────  CONSUMER APOLLO (app.hwg.apollo)
│     frontend/ (Expo)                            "Apollo" — Home/Guard/Patrol/Ask Higgins/Settings
│       app/…                                     Guardian pairing · push · voice notes · Ask Higgins (Gemini+TTS)
│       src/security/                             SecurityPlatformAdapter (mock/ios/android), PlatformCapabilityProfile,
│         securecore/                             EnforcementEvidence, NativeSecurityAdapters, MockSecurityAdapter
│       modules/apollo-security/android/           com.hucentai.apollosecurity — ApolloDnsVpnService (DNS-only VPN,
│         (single Kotlin file + DnsPacket.kt)      SharedPreferences blocklist, NXDOMAIN synth, 50-entry evidence log)
│     backend/ (FastAPI)                           family/guardian, PatrolEvent+_derive_verified_block(), Ask Higgins,
│                                                   admin audit, HIBP — own Mongo schema, own routers
│
└── branch: m2-native-acceptance  ──────────────  NATIVE ENFORCEMENT + DIAGNOSTIC PROOF ("Apollo Native Gates")
      frontend/ (Expo)                              app/index.tsx = engineering harness home (NOT a consumer screen)
        app/phase6-automated.tsx  🔒 FROZEN         Automated M2.1 acceptance runner
        app/dns-capability-diagnostic.tsx 🔒 FROZEN Guided DNS/DoH characterization wizard
        src/sdk/GuardDogSecuritySDK.ts              PUBLIC SDK boundary: requestPermission("vpn"), startProtection()…
      packages/guarddog-android-sdk/
        guarddog-core  (com.guarddog.core)          Verifier/canonicalizer/engine, rule bundle verify, trusted keys
        guarddog-vpn   (com.guarddog.vpn)           Real VpnService, TUN, DNS sinkhole, selective /32 routing, recovery
      packages/guarddog-expo-module/ (com.guarddog.expo)  Bridge: 15+ sync functions, DTO adapters
      backend/ (FastAPI)                            Ed25519 rule signing (JCS), key registry, rule_bundle, provider_cache,
                                                     intelligence (Web Risk abstraction) — own Mongo schema, own routers
```

### 1b. Target state (recommended — see §6 for full detail)

```
Consumer Apollo app (main)  — UI, guardian/family, Ask Higgins persona, unrelated Guards — UNCHANGED
        │  (existing SecurityPlatformAdapter interface — zero UI-facing contract change)
        ▼
Apollo Protection Service   — NEW thin adapter module living in `main`; implements SecurityPlatformAdapter
        │  (calls into the promoted engine exactly like the harness's GuardDogSecuritySDK.ts does today)
        ▼
Production Protection Engine — promoted, unmodified `com.guarddog.core` + `com.guarddog.vpn` (Website Gate,
                                signed-rule verification, TUN/selective-route/recovery, VpnStateRepository)
        │
        ▼
Diagnostic Core             — the now-FROZEN M2.1/Phase 6A/DNS-DoH characterization results become the
                                documented, honest capability ceiling this production build ships with
                                (e.g. "plaintext UDP/53 only; Private DNS Strict and app DoH are UNOBSERVABLE,
                                not claimed as bypassed or blocked")
        │
        ▼
Higgins (interpretation layer) — the consumer app's EXISTING "Higgins" persona (Ask Higgins voice/chat) is the
                                natural home for "Higgins Checkup" — narrates real evidence/health state instead
                                of today's simpler EnforcementEvidence from ApolloDnsVpnService
```

The engineering/acceptance harness (`m2-native-acceptance`'s own frontend app, `phase6-*`, the
DNS/DoH wizard, ephemeral-key CI test lanes) is **not** part of this diagram — it stays a separate
certification environment that re-validates the engine whenever it changes, exactly as it does today.

---

## 2. Ownership matrix

| Capability / concern | Owned today by | Recommended production owner | Notes |
|---|---|---|---|
| VPN/TUN lifecycle (establish, recover, revoke-detect) | `com.guarddog.vpn` (`GuardDogVpnService`, `TunSession`, `VpnStateRepository` w/ live OS consent re-derivation) | **`com.guarddog.vpn`, unchanged** | Physically proven on Pixel 10 across 6+ rounds (Phase 6A). `ApolloDnsVpnService`'s lifecycle is far simpler (no live-consent re-derivation, no recovery inspector) and is the weaker of the two. |
| DNS packet parsing/classification | Both (`DnsPacketClassifier`/`DnsQueryParser` vs `DnsPacket.kt`) | **`com.guarddog.vpn`'s classifier**, unchanged | Duplication — see §4. Guard Dog's version has full IPv4/UDP+checksum response synthesis, dedup, and its own JVM test suite (10+ classes). |
| Rule authority / signing | `com.guarddog.core` (`RuleBundleVerifier`, `TrustedKeyRegistry`) + backend (JCS canonicalization, Ed25519) | **Guard Dog's signed-bundle pipeline** | `main`'s blocklist is an unsigned `SharedPreferences` string set — no authenticity guarantee at all. This is a real security upgrade, not just a dedup. |
| Website/Site Gate DNS-sinkhole enforcement | `com.guarddog.vpn` (`SinkholeBindingStore`, `WebsiteGatePacketAuthorizer`, `WebsiteGateAddressing` — RFC 5737 TEST-NET-1, never RFC1918/loopback) vs `ApolloDnsVpnService` (fixed `10.111.0.1/32`, NXDOMAIN synth) | **Guard Dog's Website Gate**, unchanged | Same job, same DNS-only approach in spirit; Guard Dog's is the rigorously proven superset. |
| Evidence / "verified block" model | `BlockedThreatEvidence` (Guard Dog: only from an observed+dropped real TUN packet) vs `EnforcementEvidence` (main: `verifiedDnsBlock()`/`ruleActivated()`, `result: "verified"\|"unverified"`) | **Guard Dog's stricter definition becomes canonical**, exposed through main's EXISTING `EnforcementEvidence` TS shape (see §5.6) | Independently, `main`'s own backend already added `_derive_verified_block()` (never trust a direct patch) — same philosophy, less rigor. This is a strict tightening, not a redesign of main's contract. |
| Capability profile / "what can this build see" | `PlatformCapabilityProfile` (Guard Dog: boolean profile, heavily-commented scope) vs `PlatformCapabilityProfile` (main: tri-state `CapabilityLevel` + `coverageScope: string[]`) | **Main's tri-state shape is the target contract** (already the consumer-facing one); Guard Dog's now-frozen DNS/DoH characterization results become the *evidence* backing main's `coverageScope` tags | Already partially aligned — Phase 5.2 of this project deliberately added `ANDROID_M2_DNS_COVERAGE_TAG = "dns:udp-53"` using main's own tag vocabulary, without importing its type. |
| Recovery/lifecycle acceptance testing | `phase6-automated.tsx` + `phase6AutomatedHarness.ts` (frozen) | **Stays exactly where it is** | This is the re-certification suite for the engine, not a production artifact. It should keep running against the engine after every future engine change, from its current home. |
| DNS/DoH capability characterization | `dns-capability-diagnostic.tsx` (frozen) | **Stays exactly where it is** | Same reasoning — a diagnostic tool, not a shippable feature. |
| Signed-rule backend (Ed25519, key registry, rule_bundle service) | Guard Dog's FastAPI backend | **Becomes the shared signing authority**, consumed by main's backend/app rather than duplicated | See §5.7. Requires its own follow-up decision on hosting/ownership; flagged, not decided here. |
| Consumer UX (Home/Guard/Patrol/Ask Higgins/Settings, family/guardian, push) | `main` exclusively | **`main`, entirely unchanged** | Out of scope for this assessment by design. |

---

## 3. Dependency map

**Current: zero cross-branch dependency.** Neither branch imports, requires, or references the
other's packages. `packages/guarddog-android-sdk`/`packages/guarddog-expo-module` do not exist on
`main`; `frontend/modules/apollo-security` does not exist on `m2-native-acceptance`.

**Post-integration (target), one new dependency edge only:**

```
main/frontend  →  (new) Apollo Protection Service adapter  →  packages/guarddog-android-sdk
                                                             →  packages/guarddog-expo-module
main/backend   →  (new, optional/future) signed-bundle client  →  Guard Dog's rule-signing backend service
```

No edge should ever run the other direction (harness branch depending on consumer-app code), and
no edge should make the harness's own frontend (`app/index.tsx`, `phase6-*`, the DNS/DoH wizard)
reachable from `main` at all — see §7's "do not touch" list and §8's repo-hygiene guardrails.

---

## 4. Duplication / conflict list

1. **Two DNS-only VPN implementations doing the same job at different rigor levels** — `com.guarddog.vpn`'s Website Gate vs `ApolloDnsVpnService`. Not a naming collision (different packages); a genuine functional duplicate. **Resolution: retire `ApolloDnsVpnService`'s internals, keep its external contract shape** (see §5.3).
2. **Two `PlatformCapabilityProfile` types with different shapes** (boolean profile vs tri-state+tags). Already flagged in this project's own Phase 5.2 note as deliberately not reconciled at the type level. **Resolution: main's shape is the target; Guard Dog's frozen characterization results populate it as real evidence** (see §2).
3. **Two "evidence" concepts with the same spirit, different strength** (`BlockedThreatEvidence` vs `EnforcementEvidence`). Both already converge on "never trust an intent/rule-match alone — require an actual observed action." **Resolution: no conflict, only a strength upgrade** (see §5.6).
4. **Two independent rule-authority models** — signed Ed25519 bundles (Guard Dog) vs an unsigned local `SharedPreferences` set (main). **This is the most consequential duplication**, since it is a real security-posture gap in the shipping consumer app today, not merely a code-organization one. Flagged as the highest-value part of this integration (see §5.7).
5. **The "Higgins" name already exists in `main`** as the AI voice/chat persona (Ask Higgins), which is a happy convergence, not a conflict — the future "Higgins Checkup" milestone can extend the SAME persona with real health-state narration, rather than inventing a second "Higgins."

No conflicting Mongo collections, no conflicting API routes, no conflicting npm/gradle package names were found (`com.guarddog.*` vs `com.hucentai.apollosecurity` do not collide as Android package IDs or Gradle module names).

---

## 5. Answers to the nine assessment questions

### 5.1 Which `com.guarddog.*` components are production-worthy reusable native libraries?
- **`packages/guarddog-android-sdk/guarddog-core`** — entirely production-worthy as-is: `GuardDogSDKEngine`, `RuleBundleVerifier`, `TrustedKeyRegistry`, `BundleVersionStore`, `HostCanonicalizer`, `UrlSanitizer`, the `SecurityEvent`/`BlockedThreatEvidence` model.
- **`packages/guarddog-android-sdk/guarddog-vpn`** — entirely production-worthy as-is: `GuardDogVpnService`, `TunSession` (+ recovery), `SelectiveRouteInstaller`, `PacketDropReporter`, the full DNS-gateway/sinkhole stack (`DnsGatewayPacketHandler`, `DnsPacketClassifier`, `DnsQueryParser`, `DnsResponseSynthesizer`, `SinkholeBindingStore`, `WebsiteGatePacketAuthorizer`, `WebsiteGateAddressing`, `WebsiteGateOverrideStore`), `UpstreamDnsForwarder`/`SocketProtector`/`ProtectedUdpDnsForwarder`, `VpnStateRepository`, `VpnLifecycleState`, `RecoveryStatus`, `ControlledEndpointResolver` (swap for a production resolver config — see the pre-existing PRD backlog item on the hardcoded-public-resolver limitation), `BlockedFlowDeduper`, `ProtectionNotificationFactory`.
- **`packages/guarddog-expo-module`'s production-relevant functions**: `configureWebsiteGate`, `acceptWebsiteGateRuleBundle`, `getWebsiteGateStatus`, override management, `getProtectionState`/`getEnforcementStats`/`getEnforcementEvidence`, `getBuildProvenance`, `requestPermission`/`startProtection`/`stopProtection`. These map directly onto `SecurityPlatformAdapter`'s existing method names in `main` almost 1:1.

### 5.2 Which parts are engineering/acceptance-only and must remain out of the consumer app?
- `frontend/app/index.tsx` (harness home screen), `phase6-acceptance.tsx`, `phase6-automated.tsx` + `phase6AutomatedHarness.ts`/`phase6AutomatedReport.ts` (🔒 frozen acceptance runner), `dns-capability-diagnostic.tsx` + `dnsCapabilityDiagnostic.ts`/`dnsWizardProbeGate.ts`/`dnsCapabilityDiagnosticReport.ts` (🔒 frozen diagnostic wizard).
- `GuardDogExpoModule.kt` functions that only exist for the harness: `getPhase6DeviceProvenance`, `getDnsCapabilityDeviceSnapshot`, `openPrivateDnsSettings`, `listHttpsCapableBrowsers`, `openUrlInBrowserPackage` — these are tester tools, not consumer features. (They can stay in the shared native module without harm since they're inert unless called, but no consumer UI should ever call them.)
- Backend: the `GD_CI_EPHEMERAL_KEY` test-signing lane, the controlled test domains/rulesets (`gd-m1-controlled-block`, `gd-m2-website-gate`'s test rows, `gd-m2-dns-diagnostic-wizard`), `docs/M2_PHASE6_ACCEPTANCE_TEMPLATE.md`, `docs/dns-capability-characterization.md`.
- The entire `.github/workflows/native-gates.yml` CI pipeline stays as the engine's own certification gate — it should keep running from `m2-native-acceptance` (or wherever the engine's source-of-truth lives after integration), never be duplicated into `main`'s own CI.

### 5.3 Should `com.hucentai.apollosecurity`'s DNS VPN be retired, wrapped, or replaced?
**Replaced internally, wrapped externally — and the `com.hucentai.apollosecurity` package itself is KEPT as the adapter, per the corrected §5.8.** Recommendation: **retire `ApolloDnsVpnService`'s implementation**, but **preserve its external contract exactly** — `SecurityPlatformAdapter`, `PlatformCapabilityProfile`, `EnforcementEvidence`, `BlockResult`, `ProtectionStatus` all stay as they are in `main` today (zero UI/consumer-facing change). A new adapter class, living IN the existing `com.hucentai.apollosecurity` package (Apollo's own namespace, not a new one), implements that same interface but delegates internally to the promoted `com.guarddog.*` engine instead of running `ApolloDnsVpnService`'s own DNS-loop code. This is a **wrap-and-swap**, not a retire-with-gap: the consumer app never loses Site Guard functionality during the transition, and gains the stronger signed-rule/TUN-recovery/selective-routing engine underneath the same UI contract and the same package identity.

### 5.4 How does the consumer Apollo UI talk to the production protection engine?
Through the **existing, unmodified `SecurityPlatformAdapter` interface** in `main` — this is the correct, already-in-place seam. The new adapter implementation's `kind` becomes something like `"guarddog-android"` (a new `AdapterKind` variant, additive to the existing `"mock"|"ios"|"android"` union), and its methods (`getProtectionStatus`, `blockDestination`, `startProtection`, `getEnforcementEvidence`, `getPlatformCapabilityProfile`, etc.) call into `GuardDogSecuritySDK.ts`'s equivalents (`requestPermission("vpn")`, `startProtection()`, `configureWebsiteGate()`, `getWebsiteGateStatus()`, `getEnforcementEvidence()`) and translate Guard Dog's evidence/capability shapes into main's existing `EnforcementEvidence`/`PlatformCapabilityProfile` shapes. No screen, no `ApolloContext` state-machine code, no backend route in `main` needs to change for this seam to work.

### 5.5 How is evidence/health state/enforcement telemetry exposed to Higgins later?
Two layers, matching the target diagram in §1b:
1. **Diagnostic Core → capability ceiling**: the now-frozen DNS/DoH characterization results (3 CAPTURED/0 BYPASSED/2 UNOBSERVABLE from the Pixel 10 run) become the documented, static `coverageScope` tags this production build ships with (e.g. `"dns:udp-53"`, explicitly excluding `"dns:dot"`/`"dns:doh"` until/unless a future milestone proves otherwise) — Higgins narrates from real, evidence-backed capability claims, never an inferred one.
2. **Engine → live evidence**: `getEnforcementEvidence()`/`getEnforcementStats()` (already exposed by `GuardDogSecuritySDK.ts`) feed the new adapter, which feeds `main`'s existing `EnforcementEvidence`/`getEnforcementEvidence()` surface, which is exactly what "Ask Higgins"/the future "Higgins Checkup" would read from — no new plumbing concept needed, just a stronger source underneath an interface Higgins-adjacent code already expects.

### 5.6 How do frozen THREAT_BLOCKED semantics survive integration unchanged?
The invariant — **a DNS/rule/threat-intel match alone must never emit `THREAT_BLOCKED`; only an authorized, real, observed TUN packet drop can** — lives entirely inside `com.guarddog.core`/`com.guarddog.vpn` and is unaffected by who calls into it. Since §5.3's recommendation is "wrap, don't rewrite," the engine's enforcement decision path is never touched by the integration work itself. The one place this invariant's *strength* changes anything for `main` is `EnforcementEvidence.result: "verified"` — post-integration, `"verified"` can only mean "Guard Dog observed and dropped a real packet," which is **strictly stronger** than `main`'s current `verifiedDnsBlock()` (already real-packet-based, so this is consistent, not a behavior change) and strictly stronger than `ruleActivated()` (already fixed by `main`'s own recent "Truth-of-State Correction" commit to report `result: "unverified"` for a manual tap — so no regression, only a tightening at the source).

### 5.7 How do signed rules and Website Gate ownership move into the production architecture?
Flagged as the highest-value, highest-effort part of this integration, **decision deferred to its own follow-up assessment** (explicitly not decided here, per the "no migration/refactor yet" instruction): the two realistic options are (a) `main`'s backend becomes a client of Guard Dog's existing signing backend/service for its Site Guard blocklist (single signing authority, one Ed25519 keypair, one bundle format), or (b) the signing service itself is promoted/duplicated into `main`'s own backend using the same JCS/Ed25519/key-registry code, keeping the two backends independent but architecturally identical. Recommendation leans toward (a) for single-source-of-truth simplicity, but this needs its own data-ownership/hosting decision with the user before any implementation.

### 5.8 How should Android package/module naming eventually be normalized?
**Corrected per user direction (supersedes this section's original draft, which proposed a brand-new adapter package name — that is NOT the recommendation):**
- **Do not rename `com.guarddog.*`.** It is physically proven, frozen, and a rename carries real regression risk (Gradle module paths, Kotlin package declarations, native-gates CI paths, `AndroidManifest.xml` component references) for zero functional benefit. It remains the protection **engine** package, promoted as a native dependency, never touched by the integration work itself.
- **`com.hucentai.apollosecurity` is KEPT, not retired** — it becomes the Apollo-facing **adapter/API** package: `ApolloDnsVpnService`'s own implementation is retired and its logic replaced with calls that delegate into `com.guarddog.*`, but the package identity, Expo bridge module name, and everything `main`'s TypeScript layer (`SecurityPlatformAdapter`, `NativeSecurityAdapters`, `nativeBridge.ts`) already imports stays exactly where it is.
- Net effect: **`com.hucentai.apollosecurity` = Apollo-facing adapter/API` (thin, product-owned) · `com.guarddog.*` = protection engine (proven, untouched, product-agnostic)`** — clean product naming with zero rename risk to either side. See the Stage 0 decisions doc (`docs/APOLLO_INTEGRATION_STAGE0_DECISIONS.md`) item 2 for the full ownership statement.

### 5.9 How is branch/repo cross-contamination prevented during the transition?
See §8 below — significant enough to warrant its own section.

---

## 6. Recommended target architecture (restated as a decision, not just a diagram)

Adopt the layering in §1b: **Consumer Apollo app → Apollo Protection Service (new, thin, in `main`) →
Production Protection Engine (promoted `com.guarddog.core`+`com.guarddog.vpn`, unmodified) →
Diagnostic Core (frozen characterization results as the documented capability ceiling) → Higgins
(existing persona, extended later).**

This is **engine integration, not application consolidation** — `main` keeps its entire product
surface, backend, and identity; `m2-native-acceptance` keeps its entire acceptance/diagnostic
harness and continues to be the place the engine gets re-certified whenever it changes.

---

## 7. Staged migration plan (if/when this recommendation is approved — NOT started)

1. **Stage 0 — Decisions needed from the user before any code**: (a) signing-authority hosting choice (§5.7), (b) exact package name for the new adapter module (§5.8), (c) which mechanism carries `guarddog-android-sdk`/`guarddog-expo-module` into `main`'s tree (git submodule, subtree, or a published local package) — flagged, not decided here.
2. **Stage 1 — Promote the engine, touch nothing else**: copy/link `packages/guarddog-android-sdk` + `packages/guarddog-expo-module` into `main`'s dependency tree, unmodified. Re-run `native-gates` against `main`'s own build to confirm the engine compiles cleanly in that app shell before any adapter code is written.
3. **Stage 2 — Build the adapter, in parallel with the old path**: implement the new `SecurityPlatformAdapter`-conformant class calling into the promoted engine; wire it behind a feature flag/build variant so `ApolloDnsVpnService` keeps running in production while the new path is validated.
4. **Stage 3 — Physical-device parity test**: run the SAME kind of positive/negative enforcement checks Phase 6A already proved (real block, 5 false-Biting negatives, recovery/revoke/restart/network-transition) against the NEW adapter path inside `main`'s actual app shell — this is a new, `main`-side acceptance pass, not a re-run of the frozen `m2-native-acceptance` harness.
5. **Stage 4 — Cutover**: once Stage 3 passes, switch the feature flag, retire `ApolloDnsVpnService`'s implementation, keep its contract shape as documented in §5.3.
6. **Stage 5 — Backend signing-authority migration** (per whichever Stage-0 decision was made) — separate from the native cutover, can happen before or after Stage 4.
7. **Stage 6 — Only after Stage 4 is live and stable**: Higgins Checkup can begin, now reading from the production engine's real evidence instead of `ApolloDnsVpnService`'s simpler log.

---

## 8. Explicit "do not touch" areas (unconditional, regardless of which migration option is chosen later)

- `phase6-automated.tsx`, `phase6AutomatedHarness.ts` — 🔒 FROZEN M2.1/Phase 6A acceptance logic.
- `dns-capability-diagnostic.tsx`, `dnsCapabilityDiagnostic.ts`, `dnsWizardProbeGate.ts` — 🔒 FROZEN DNS/DoH characterization instrument.
- The `THREAT_BLOCKED`-only-from-a-real-observed-drop invariant, anywhere it is enforced in `com.guarddog.core`/`com.guarddog.vpn`.
- The signed-bundle freeze mechanics (`GD_M1_FROZEN_BUNDLE_VERSION`, existing rule bundle version histories for `gd-m1-controlled-block`/`gd-m2-website-gate`/`gd-m2-dns-diagnostic-wizard`).
- `main`'s existing `SecurityPlatformAdapter`/`PlatformCapabilityProfile`/`EnforcementEvidence` **type shapes** (only new implementations are added; the interfaces themselves are the stable integration seam and should not be redesigned to fit Guard Dog — Guard Dog's data gets translated to fit them).
- `main`'s consumer UI, family/guardian/backend routes, Ask Higgins chat/TTS — entirely out of scope for this or any near-term protection-engine work.

---

## 9. Repo/branch hygiene — preventing cross-contamination during the transition

1. **Never merge `m2-native-acceptance` wholesale into `main`.** Doing so would drag the entire engineering harness (`phase6-*`, the DNS/DoH wizard, `GD_CI_EPHEMERAL_KEY`, controlled test domains, the M1/M2-only backend routes) into the production consumer app — exactly the outcome this whole assessment exists to prevent.
2. **Never merge `main`'s consumer-app code into `m2-native-acceptance`.** The harness must stay a minimal, purpose-built certification environment — adding consumer UI/backend surface to it would make it a second, competing copy of the very app it is supposed to be testing underneath.
3. **The actual integration work (when approved) should happen on a new branch off `main`**, pulling in only `packages/guarddog-android-sdk` and `packages/guarddog-expo-module` (mechanism to be decided per Stage 0), never the harness frontend or its test-only backend routes.
4. **Recommend a lightweight CI guard** (in whichever branch ends up hosting the integration) that fails if consumer-app files (`frontend/app/(guardian)/**`, `backend/routers/family*`, etc.) ever appear inside the engine package directories, or vice versa — cheap insurance against accidental cross-contamination during a multi-session integration effort.
5. **Each branch should carry a one-paragraph README stating its role** ("this branch is the native enforcement/diagnostic proof environment; consumer app code does not belong here" / "this branch is the consumer Apollo app; the protection engine is a promoted dependency, not inline source") — cheap, permanent context for whichever agent/session picks this up next.

---

## 10. Migration-risk analysis (summary)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Engine doesn't compile cleanly inside `main`'s different Expo/Gradle config | Medium | Blocks Stage 1 | Stage 1 is scoped exactly to catch this early, before any adapter code is written |
| `main`'s simpler `EnforcementEvidence`/`PlatformCapabilityProfile` shapes can't losslessly represent Guard Dog's richer evidence | Low | Adapter-layer complexity only | Adapter translates one-way (richer→simpler); no information main needs is lost, only extra Guard Dog detail is dropped at the seam |
| Accidental harness/consumer-app cross-contamination during multi-session integration | Medium (this is a multi-week, multi-session effort) | High — could reintroduce test-only code/keys into production | §9's guardrails (branch hygiene, CI check, README) |
| Regression to the frozen M2.1/Phase 6A invariants while promoting the engine | Low if untouched, Medium if "helpfully" adjusted mid-promotion | High — would un-freeze proven guarantees | Stage 1 is explicitly "copy/link, unmodified"; any adjustment found necessary must go back through this project's own frozen-boundary process, not be made silently during integration |
| Backend signing-authority decision (§5.7) stalls the whole integration | Medium | Delays Stage 5 only, not Stages 1-4 | Native-engine promotion (Stages 1-4) does not depend on the signing-authority decision — `main` can temporarily keep its own unsigned blocklist as an interim rule source while the engine swap happens, then adopt signed bundles in Stage 5 |
| Package/module rename attempted too early | Low if this doc is followed | Medium — real regression risk to proven code | §5.8's explicit "don't rename yet" recommendation |

---

## 11. What this assessment deliberately does NOT do

- Does not migrate, port, or copy a single line of code between the two stacks.
- Does not rename any existing package, module, or file.
- Does not decide the backend signing-authority question (§5.7) — flagged for a dedicated follow-up.
- Does not touch `phase6-automated.tsx`, `phase6AutomatedHarness.ts`, the DNS/DoH wizard, or any frozen M1/M2.1 rule/bundle state.
- Does not start Higgins Checkup — per the user's own stated order, that follows this assessment's approval and any resulting integration work, not before.

**Next step: user review and approval of this assessment before any migration/implementation work begins.**
