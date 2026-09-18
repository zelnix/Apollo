# Apollo Production Protection Integration — Stage 0

**Status: DOCUMENTATION ONLY. No code changes result from this document.** This is an
architecture/ownership decision record, not an implementation. Code migration does not begin
until the open decisions in §8 are resolved and this document has been reviewed.

**This document lives in, and only governs, the Apollo main project (this `/app` workspace).**
It does not modify, and this workspace has no access to, `m2-native-acceptance` or any
`com.guarddog.*` source — see §0.

## 0. Cross-project relationship (context, not a decision)

Two separate Emergent projects/sessions are involved, and they are **not being merged**:

| | Apollo main (this workspace) | m2-native-acceptance (a different project/session) |
|---|---|---|
| Role | Active consumer product development | Frozen engineering/certification reference |
| Contains | Consumer Apollo app: Expo/React Native frontend, FastAPI/Mongo backend, Truth-of-State product logic, Higgins, Family/Text/Call/Email Guard, current `com.hucentai.apollosecurity` Android/iOS native module | The proven **GuardDog** native protection engine (`com.guarddog.*`) and its own physical-device certification work |
| Changed when | The consumer app, its UI/contracts, or backend change | The native protection engine itself changes, or needs to be re-certified |
| Present in `/app` today? | Yes — this is it | **No.** Not present, not accessible, not to be recreated here |

**Working rule going forward:** if the work changes the consumer Apollo app → Apollo main
(this workspace). If the work changes or re-certifies the proven native engine → belongs on
m2-native-acceptance, not here.

### Frozen external provenance (record only — nothing here is fetched or reproduced yet)

| Field | Value |
|---|---|
| Commit | `e5d11be912c76775c5a8b27b53218211484ca8bd` |
| CI run | `35171369548` |
| APK SHA-256 | `905d66a9ab5d9f70c22c4a2fce897cdf668d975908546e583b404db01f774335` |
| Production-relevant native modules | `packages/guarddog-android-sdk`, `packages/guarddog-expo-module`, native packages under `com.guarddog.*` |

This is the **only** legitimate source for the eventual GuardDog import (§4). It must never be
recreated from the assessment/planning prose describing it (see §7).

## 1. Production signing authority

**Current state (verified against this repo):**
- iOS bundle identifier: `app.hwg.apollo` (`frontend/app.json`).
- Android package: `app.hwg.apollo` (`frontend/app.json`); the `com.hucentai.apollosecurity`
  Expo module is a separate Gradle **library** (`group`/`namespace`), not the app's own identity.
- No `eas.json`, keystore, or `credentials.json` exists in this repo. Signing for both platforms
  is performed by the **Emergent-managed Publish/build pipeline** (per the platform's own build
  flow) — there is no separately self-managed EAS account or key material checked into `main`.
- The frozen APK SHA-256 above is a **certification artifact hash from the other project's own
  CI**, not a production Apollo signing key, and is not interchangeable with one.

**Decision (recommended default, needs explicit sign-off — see §8):**
1. The app-level signing identity (`app.hwg.apollo` on both platforms) does not change as a
   result of this integration. GuardDog's native code is imported as Gradle/CocoaPods module(s)
   **linked into** this same signed app — it is never a separately signed artifact.
2. When `guarddog-android-sdk` / `guarddog-expo-module` source (not the pre-built, already-signed
   APK) is imported, it will be compiled and signed as part of *this app's* own Emergent-managed
   build. This produces a **new** artifact hash — expected and correct. The frozen APK SHA-256
   above stays a certification-reference hash only; this repo never tries to reproduce it
   bit-for-bit, and no automation should compare against it as a build gate.
3. Any new native Gradle module/namespace introduced for GuardDog must not collide with
   `app.hwg.apollo` or `com.hucentai.apollosecurity` (open decision, §8).

## 2. Apollo-facing adapter ownership

- **`frontend/src/security/SecurityPlatformAdapter.ts`** is the canonical, cross-platform,
  Apollo-facing contract. Owned by Apollo main. Its method signatures
  (`getCapabilities`, `getProtectionStatus`, `analyseURL`, `analyseDomain`, `blockDestination`,
  `unblockDestination`, `getNetworkStatus`, `getSecuritySignals`, `startProtection`,
  `stopProtection`, `getProtectionPermissions`, `requestProtectionPermission`,
  `getPlatformCapabilityProfile`, `getEnforcementEvidence`) are **frozen** — this was already
  decided in `docs/android-consolidation-plan.md` §4 and is reaffirmed here, not re-opened.
- **`frontend/modules/apollo-security`** (`com.hucentai.apollosecurity` on Android,
  `ApolloSecurityModule.swift` on iOS) **remains the Apollo-facing adapter/product layer.**
  Confirmed explicitly for this integration: `ApolloDnsVpnService.kt` is left untouched (§6), and
  the eventual target is this same package translating into GuardDog underneath — not being
  replaced by it. It owns:
  - Translating `SecurityPlatformAdapter` calls into calls against whichever engine is underneath.
  - Translating the engine's own evidence/status into `EnforcementEvidence` / `ProtectionStatus` /
    `PlatformCapabilityProfile` **unchanged in meaning** (pure translation shim — see §3, §5).
  - Apollo-specific product surfaces that are not enforcement itself: permission UX, device/
    security signals, product-level status presentation. These stay here regardless of engine.
- **`com.guarddog.*` (`guarddog-android-sdk`, `guarddog-expo-module`)** becomes the underlying
  enforcement *engine dependency* once imported — owned/maintained upstream, proven via
  m2-native-acceptance's own certification. Apollo main consumes its public SDK surface only
  through the adapter shim above; it never modifies GuardDog internals and application/product
  code never calls `com.guarddog.*` APIs directly.

## 3. How `com.guarddog.*` is eventually imported into Apollo main

Promotion is a **deliberate, reviewed import of frozen source** — not a git merge of
`m2-native-acceptance`, not a re-implementation from prose, and not something achievable from
inside this workspace alone (it has no access to the other project's files today).

1. **Transfer (human-mediated, outside this workspace's reach):** a pinned, clean snapshot of
   `packages/guarddog-android-sdk`, `packages/guarddog-expo-module`, and any `com.guarddog.*`
   native source, taken at commit `e5d11be912c76775c5a8b27b53218211484ca8bd`, is exported from
   the other project and provided into this one. *How* that transfer happens is an open decision
   (§8) — this document does not assume a mechanism.
2. **Landing point:** a **dedicated consolidation branch** in Apollo main — never `main` directly,
   never a reference to/merge of `m2-native-acceptance`. This matches the commitment already made
   in `docs/android-consolidation-plan.md` §2.4 and §4.
3. **Integrity check before anything is wired up:** the imported source's commit/hash must match
   the frozen provenance in §0 exactly. Any drift is a *new, unreviewed* change, not an extension
   of the already-proven engine, and re-triggers certification rather than inheriting it.
4. **Vendor vs. reference (open decision, §8):** recommend vendoring a pinned copy into this repo
   (e.g. under a new `packages/` or `native/guarddog/` path) rather than a live external
   dependency/submodule, so `main`'s build is never silently affected by unrelated changes
   happening on the other project.
5. **Wiring (later stage, not Stage 0):** only after import, `frontend/src/security/future/
   GuardDogSecurityAdapter.ts` — today a type-only, not-wired placeholder — gets fleshed into the
   real Android Apollo adapter shim, implementing `SecurityPlatformAdapter` exactly and forwarding
   GuardDog's own evidence upward unmodified in meaning (per its existing header comment).

## 4. Production vs. certification/test boundary

- **m2-native-acceptance's job:** prove the GuardDog engine on physical devices via its own
  acceptance process. Not touched for day-to-day product work. Never re-run or edited from this
  workspace.
- **Apollo main's job:** build and ship the consumer product, consuming the engine *only* after
  it is certified and *only* via the adapter shim in §2 — never re-implementing or re-proving the
  engine's own internal logic inside product code (this is the exact duplication
  `docs/android-consolidation-plan.md` already froze against).
- **Both proofs are required, independently, and neither substitutes for the other:**
  - `backend/tests/test_enforcement_evidence_gate.py` and
    `docs/android-physical-device-acceptance.md` are Apollo main's own proof that *whichever*
    engine is plugged in still obeys the Truth-of-State gate (`_derive_verified_block`,
    `isVerifiedEnforcement`).
  - GuardDog's own acceptance on m2-native-acceptance proves the engine itself works.
  - The swap is production-ready only when both are green for the same pinned commit.

## 5. Higgins truth/diagnostic interface

- **Today:** Higgins (`backend/routers/ask.py`, `HIGGINS_SYSTEM_PROMPT`) is a plain-language
  explainer only. It is told Apollo's state definitions (Patrolling/Growling/Barking/Biting) and
  recommends named checks via a machine-readable `CHECKS: <ids>` trailer — it never decides state
  and never fabricates enforcement facts; those still come untouched from
  `PlatformCapabilityProfile` / `EnforcementEvidence` / `_derive_verified_block`.
- **"Higgins Checkup" (future — not built in Stage 0):** its data-source contract is fixed here
  so it isn't built against something that changes under it later. Checkup must be a **read-only
  diagnostic surface** over the exact same Truth-of-State primitives already defined —
  `ProtectionStatus` (requested/operational/lastVerified), `PlatformCapabilityProfile` (capability
  ceiling), `EnforcementEvidence` (verified facts) — never a new, parallel source of truth, and
  always reached through `SecurityPlatformAdapter`, the same as every other product surface. This
  makes Checkup automatically engine-agnostic: it needs no changes when the GuardDog swap (§3)
  eventually happens underneath it.
- Explicit non-goal for Stage 0: no Higgins Checkup implementation here — only this contract.

## 6. Migration stages and rollback boundaries

| Stage | What happens | Where |
|---|---|---|
| **0 (this doc)** | Architecture/ownership/boundary decisions. No code changes. | Apollo main — **we are here** |
| 1 | Human-mediated import of the pinned GuarDog snapshot (§3) | Dedicated consolidation branch off Apollo main |
| 2 | Flesh out the real Android Apollo adapter (today's placeholder) behind a build-time flag, running **side by side** with `AndroidSecurityAdapter` — not replacing it | Consolidation branch |
| 3 | Physical-device acceptance for GuardDog *inside Apollo main's own build* — a new acceptance doc, sibling to `docs/android-physical-device-acceptance.md`, independent of GuardDog's acceptance on m2-native-acceptance (different app shell/build pipeline) | Consolidation branch |
| 4 | Cutover: `securityAdapter.ts::selectAdapter()` switches Android's real adapter to the GuardDog-backed one, behind an explicit, reversible config (mirrors today's `EXPO_PUBLIC_SECURITY_MODE` mock/native pattern) | Apollo main, post-merge |
| 5 | Only after a full release cycle proven stable in production: remove `ApolloDnsVpnService.kt`/`DnsPacket.kt` (legacy engine) | Apollo main |

**Rollback boundary:** because `SecurityPlatformAdapter`'s contract never changes, rollback at
any point **before Stage 5** is just flipping the adapter-selection config back — no data
migration, no schema change (`EnforcementEvidence`/`ProtectionStatus` shapes are identical
regardless of engine). **Stage 5 is the only stage where rollback is not free** (it requires
re-vendoring deleted files from git history) — it should only happen after a separate, explicit
approval, not automatically once Stage 4 looks fine.

## 7. Explicit do-not-touch areas

- Do not modify `m2-native-acceptance` (not present in this workspace regardless).
- Do not modify or expand `ApolloDnsVpnService.kt` / `DnsPacket.kt` — frozen per
  `docs/android-consolidation-plan.md` §2.
- Do not flesh out `frontend/src/security/future/GuardDogSecurityAdapter.ts` into a working
  adapter yet.
- Do not change `SecurityPlatformAdapter.ts` method signatures.
- Do not change `backend/routers/patrol.py::_derive_verified_block` or the Biting/`verified_block`
  invariant.
- Do not attempt to reconstruct `com.guarddog.*` logic from assessment/planning prose — it must
  come from the frozen source at commit `e5d11be912c76775c5a8b27b53218211484ca8bd` itself, never
  a rewrite from a description of it.
- Do not begin any code migration (Stage 1+) until §8 is resolved and this document is reviewed.

## 8. Open decisions requiring explicit sign-off before Stage 1

1. **Transfer mechanism:** how does the pinned GuardDog snapshot actually move from the other
   Emergent project/session into this one? This workspace has no access to fetch it itself.
2. **Vendor vs. external dependency:** vendored pinned copy (recommended, §3.4) vs. a live
   submodule/published package reference.
3. **New Gradle namespace/group** for the imported GuardDog modules — must not collide with
   `app.hwg.apollo` or `com.hucentai.apollosecurity`.
4. **Confirm production signing identity unchanged:** `app.hwg.apollo` stays the app's bundle/
   package id through this integration (§1) — needs explicit sign-off since it's already the
   live App/Play Store identity.
5. **Who owns re-running m2-native-acceptance** if a regression is found in the frozen engine
   after import — this workspace, or the other project/session.

## 9. Non-goals of this document

- No code changes in this repo.
- No implementation of the Android Apollo adapter.
- No import of any `com.guarddog.*` source.
- No modification of `m2-native-acceptance`.
- Does not supersede `docs/android-consolidation-plan.md` or
  `docs/android-physical-device-acceptance.md` — it sits alongside them; that document's
  Android-specific freeze directives are incorporated by reference here, not duplicated or
  re-decided.
