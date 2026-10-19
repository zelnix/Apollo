# Android Native Consolidation Plan

**Status: PREPARATION ONLY.** No code in `main` changes as a result of this document. This is a
recorded architecture decision + freeze directive, not an implementation.

**Do not merge `m2-native-acceptance` into `main`. Do not remove the current VPN implementation.
Wait for M2 physical-device acceptance and a dedicated consolidation branch/PR.**

## 1. Why this document exists

A review of `main` against `m2-native-acceptance` found significant duplication between:

- **`main`'s existing enforcement stack** — `ApolloDnsVpnService.kt` + `DnsPacket.kt`, a DNS-only
  (`UDP/53`) `VpnService` tunnel, exposed to the app through `ApolloSecurityModule.kt`'s
  implementation of the `SecurityPlatformAdapter` native contract.
- **`m2-native-acceptance`'s in-progress engine** — the **GuardDogSecurity SDK** and
  **GuardDogVpnService**, a more capable native enforcement engine (including "M2 Website Gate"
  functionality) being built on a separate branch/fork.

Both stacks solve the same underlying problem (Android-side network enforcement) for the same
product. Building both out in parallel inside `main` would only deepen the duplication. This
document freezes further investment in the legacy stack inside `main` and records the target
shape of the eventual consolidation, without pre-empting the M2 branch's own acceptance process.

## 2. Freeze directive for `main` (effective immediately)

1. **Do not expand** `ApolloDnsVpnService.kt`, `DnsPacket.kt`, or any other part of the existing
   Android DNS/VPN enforcement implementation in `main`.
2. **Do not delete it yet.** Treat it as **legacy-but-still-operational** — it remains the *only*
   real Android enforcement path in `main` until GuardDog has passed physical-device acceptance.
   Removing it before a replacement lands would leave `main` with zero real Android enforcement.
3. **Do not attempt to independently recreate "M2 Website Gate" functionality** inside
   `frontend/modules/apollo-security`. That capability belongs to the GuardDog engine being built
   on `m2-native-acceptance`; re-implementing any part of it in `main` recreates the exact
   duplication this plan exists to avoid.
4. **Do not merge `m2-native-acceptance` wholesale into `main`.** The eventual change is a
   *swap of the enforcement layer underneath the adapter* (see §4), delivered via a dedicated
   consolidation branch/PR — not a branch merge. This is gated on:
   - M2 physical-device acceptance (tracked separately in
     `docs/android-physical-device-acceptance.md`).
   - A dedicated consolidation branch that lands the new adapter layer described below.

## 3. What continues unchanged (business as usual)

Everything product-facing and non-enforcement-native keeps moving normally on `main`:

- `SecurityPlatformAdapter` (`frontend/src/security/SecurityPlatformAdapter.ts`) — remains the
  **canonical, cross-platform, Apollo-facing contract**. Its public method signatures do not
  change as part of any future Android consolidation.
- The Truth-of-State model (Requested / Operational / Verified protection).
- The Patrol/evidence pipeline, front and back (`enforcementEvidenceSync.ts`, `ApolloContext.tsx`,
  `backend/routers/patrol.py`).
- Backend `verified_block` derivation (`_derive_verified_block`) and the Biting invariant — see
  §5, which this consolidation must never weaken for any current or future native engine.
- UI state handling across Home/Guard/Patrol/Higgins/Settings.
- Network/device signals (e.g. `NetworkAccountSdk`, `AppDeviceSignals`) and other non-enforcement
  application features.

## 4. Target future architecture (not yet implemented)

```
Apollo product code (screens, ApolloContext, Patrol/evidence pipeline)
      │
      ▼
SecurityPlatformAdapter            frontend/src/security/SecurityPlatformAdapter.ts
                                    — UNCHANGED, canonical cross-platform contract
      │
      ▼
Android Apollo adapter             NEW — a thin translation/shim layer that will eventually
                                    replace today's direct binding from ApolloSecurityModule.kt
                                    to ApolloDnsVpnService. See the placeholder reference in §6.
      │
      ▼
GuardDogSecurity SDK                from m2-native-acceptance — not present in main yet
      │
      ▼
GuardDogVpnService                  the actual native VPN / enforcement engine
```

**Critical invariant for the "Android Apollo adapter" layer, once it is built:** it must be a
*pure translation layer*. It forwards GuardDog's own `EnforcementEvidence` upward, unmodified in
meaning, into the existing Patrol/evidence pipeline. It must never itself decide that something
is "verified" — that decision stays exactly where it is today: server-side, in
`_derive_verified_block`, based on evidence content, never on which native engine produced it.

### What must survive the eventual swap completely unchanged

- Every `SecurityPlatformAdapter` method signature (`getCapabilities`, `getProtectionStatus`,
  `analyseURL`, `analyseDomain`, `blockDestination`, `unblockDestination`, `getNetworkStatus`,
  `getSecuritySignals`, `startProtection`, `stopProtection`, `getProtectionPermissions`,
  `requestProtectionPermission`, `getPlatformCapabilityProfile`, `getEnforcementEvidence`).
- The `PlatformCapabilityProfile` / `EnforcementEvidence` TS and Pydantic types.
- The Patrol/evidence sync pipeline and the backend Biting invariant (§5).
- Apollo-specific Android functionality that does not belong inside a VPN engine — e.g. device /
  security signals, permission surfaces, product-level status presentation. These stay owned by
  `frontend/modules/apollo-security` regardless of which engine ends up powering enforcement.

## 5. Truth-of-State invariant (reaffirmed for every current and future native engine)

`main` must never translate any of the following into `THREAT_BLOCKED` / "Apollo is biting":

- a rule match,
- a requested block,
- a manual block activation (a user tapping "Block"),
- an SDK status report,
- or a capability claim (a `PlatformCapabilityProfile` field, `full`/`partial`/`none`, or a scope
  tag) on its own.

**Only verified native enforcement evidence** — an `EnforcementEvidence` record with a real
mechanism (not `simulated`/`none`), `result: "verified"`, and `enforced_action: "blocked"` — may
authorise Biting. This is enforced today, server-side, regardless of native engine, in
`backend/routers/patrol.py::_derive_verified_block`, with `state="biting"` rejected outright
(HTTP 422) on both POST and PATCH when that evidence is missing or insufficient (see
`backend/tests/test_enforcement_evidence_gate.py`). When GuardDog eventually supplies evidence
through the new Android Apollo adapter, it flows through this exact same gate — the gate does not
change, and does not need to, for the swap to be safe.

## 6. Placeholder reference

`frontend/src/security/future/GuardDogSecurityAdapter.ts` is a **type-only, not-wired**
placeholder capturing the shape described in §4. It is not imported by `securityAdapter.ts`,
`NativeSecurityAdapters.ts`, or anything else in the app, and has zero runtime effect.
`AndroidSecurityAdapter` (in `NativeSecurityAdapters.ts`) remains the only real Android adapter
until this plan's gating conditions (§2.4) are met.

## 7. Non-goals of this document

- This is a planning artifact only.
- It does not implement the Android Apollo adapter, does not touch `ApolloDnsVpnService.kt` /
  `DnsPacket.kt`, and does not merge or reference any code from `m2-native-acceptance`.
- Actually swapping the enforcement backend is future work, gated on the M2 physical-device
  acceptance result and a dedicated consolidation branch.
