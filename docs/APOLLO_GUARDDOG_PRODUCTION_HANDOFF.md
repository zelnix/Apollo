# GuardDog production-default source handoff

Authority: the owner-uploaded `Apollo GuardDog Production-Default Activation` instructions recorded in `memory/APOLLO_GUARDDOG_PRODUCTION_AUTHORITY.md`.

## Developer-owned result

| Work package | Source status |
|---|---|
| GD-PROD-01 | Production/app-bundle select only `guarddog_production`; acceptance remains staging-only; production fallback is prohibited. |
| GD-PROD-02 | `apollo-security` is the only autolinked bridge and process owner; frozen Expo owner remains excluded. |
| GD-PROD-03 | Distinct primary/recovery Ed25519 public roots, strict signed manifests, monotonic generations/versions, revocation, rollback floors, expiry and HMAC-bound no-backup state are enforced. |
| GD-PROD-04 | Production now wires the accepted engine into the frozen M2 DNS gateway, sinkhole routes, physical-network IPv4 DNS forwarder, allow-only override store and packet-drop reporter. |
| GD-PROD-05 | WorkManager refresh/expiry plus boot, unlock, package-update and physical-network DNS reconciliation are source-wired. |
| GD-PROD-06 | Existing generic protection UI receives truthful Website Gate coverage, active/degraded state and evidence-only Biting semantics. |
| GD-PROD-07 | Static checks cover selection, one owner, trust boundaries, M2 runtime wiring, lifecycle triggers, package identity and private-key exclusion. |
| GD-PROD-08 | This handoff records source scope and the separate release-owner steps below. |

## Preserved safety boundaries

- Android package: `app.apollo.hwg`.
- Frozen `frontend/packages/guarddog-*` source is not edited.
- Private signing keys never enter source, app configuration, build environments, logs or chat.
- Production rejects missing, malformed, expired, revoked, wrong-domain, wrong-profile, rollback and conflicting signed authority.
- Biting remains possible only after the active TUN observes and intentionally drops a fresh packet under current signed authority.
- DNS interception covers plaintext IPv4 UDP/53; Private DNS, DoH, DoT, QUIC and IPv6 are not claimed as covered.

## Release-owner inputs and acceptance

The owner/release team must complete the detailed checklist in the final handoff response: generate and protect offline roots, publish signed trust/rule JSON over HTTPS, provide only public configuration, create signed candidates on approved hosts, and record physical-device lifecycle/enforcement/rollback evidence. Source completion does not claim those results.

## Changed-file manifest

Pre-save baseline HEAD: `19c1f9a475a657fbf5f150c964cf6aca3c613c5a`. The final handoff SHA must be recorded after the owner uses **Save to GitHub**.

| SHA-256 | File |
|---|---|
| `cc823231845ce92ac853d13514c2cbbe85eef4464e1ac2982cce70ef93446c55` | `frontend/modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloGuardDogNetworkObserver.kt` |
| `06a2a82d82c43dfbbd2371512a845b72cfb2313735b6283efe3f54787b07f072` | `frontend/modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloGuardDogProductionRuntime.kt` |
| `f1f997723748c8f04cad742e1fe3d2d81847b130f977c1f511951a24596855c2` | `frontend/modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloGuardDogProductionTrust.kt` |
| `d69d110e8a2805d4d75f9dff9f638ccc8e6dce947bcfac8b890c0e89e5a24d4` | `frontend/modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloGuardDogRestartReceiver.kt` |
| `1d41e6cefd74a0c89e334509a8e44b1450a12a78fb3aae0e40ceb1705eaa6913` | `frontend/modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloSecurityModule.kt` |
| `e29cb7e211d570bfe0cd0fc98f9c38894c22db686547cc68ca8518a6fbef6bfc` | `frontend/modules/apollo-security/android/src/main/AndroidManifest.xml` |
| `f43a7dc297c4da07a5f2ad394acbce5295f039960180204fb81d0f1432b6c029` | `frontend/plugins/withGuardDogProductionTrust.js` |
| `7ab98d13ec95bdd649b2b3034a733ab3b3cf964067da45a0f55f1e8b9ee3414c` | `frontend/scripts/security-preflight.mjs` |
| `42a21e4d7f094f4cc0b7d4371df631634a92db8a7ced248542511f0d605209b8` | `frontend/src/security/guarddog/GuardDogProductionConfig.ts` |
| `ccf8457d95afa3dc0f964117dbb430a44ecbca65578a6e50cd835d08e9dbdbf8` | `frontend/src/security/guarddog/GuardDogProductionSecurityAdapter.ts` |
| `4a9db9764edce701e855243d66a434ecc66d92b3f62a2655b0b864e75a11b4c0` | `frontend/tests/test_guarddog_production_source.py` |
| `d683de81b67b78e5754601ea05d1dfa80f5b26696a42c938df91a6d460119811` | `docs/APOLLO_GUARDDOG_PRODUCTION_TRUST.md` |
| `9e284c4acea23ae7f8db767868f9262977a847c9f554a28ad59308ca1dc1bbe9` | `docs/APOLLO_GUARDDOG_PRODUCTION_HANDOFF.md` before this manifest section |
| `e4594e4ca5698f247f7756bf8da54adf5d549f7817cde06c2e27997f0cd044af` | `memory/APOLLO_GUARDDOG_PRODUCTION_AUTHORITY.md` |

The handoff file's own hash necessarily changes when its manifest is appended; use the repository SHA as the final package identity.

## Bounded validation

- TypeScript and ESLint: pass.
- Frontend source/unit checks: 381/381 pass.
- GuardDog production source checks: 9/9 pass; frozen source manifest: 91/91 unchanged.
- Provider-disabled backend Phase 2/recovery checks: 58/58 pass; no Gemini call.
- `:apollo-security:compileDebugKotlin`: pass on compileSdk/targetSdk 36, minSdk 26, Kotlin 2.1.20.
- Production security/native-dependency preflight and Package 6 preflight: pass; resolved package is `app.apollo.hwg`.
- Cargo check and Rust unit tests: 5/5 pass.
- Windows WFP x64 MinGW source cross-link: pass.
- Not run or claimed: Playwright, testing agent, automated scenarios, live Gemini, signed artifacts, or physical-device acceptance.