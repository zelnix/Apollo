# HuCentAI SecureCore — Integration Guide

Audience: the native security developer implementing the production SecureCore SDK (Swift for iOS, Kotlin for Android) and the Apollo security module.

## 1. Architecture

```
Application UI / feature logic  (app/**, src/store/ApolloContext.tsx)
        ↓ imports only
SecureCore  (src/security/securecore/SecureCore.ts)           ← single entry point
        ↓ selects by EXPO_PUBLIC_SECURECORE_MODE
┌──────────────────────────────┬──────────────────────────────────────┐
│ MockSecureCore (mock/)       │ NativeSecureCore (native/)           │
│ dev / test only, labelled    │ bridge → Expo Module "HuCentAISecureCore" │
│ "MOCK SecureCore — not real  │        → Swift SDK / Kotlin SDK      │
│  security"                   │                                      │
└──────────────────────────────┴──────────────────────────────────────┘
```

A parallel adapter exists for threat-protection features (`src/security/securityAdapter.ts` →
`MockSecurityAdapter` | `IOSSecurityAdapter` | `AndroidSecurityAdapter` → Expo Module `ApolloSecurity`
in `modules/apollo-security/`). Same rules apply: explicit mode, fail closed.

Application code never imports `MockSecureCore` or `NativeSecureCore` directly (the only exception is
`app/dev-tools.tsx`, which is unreachable unless the build runs in mock mode).

## 2. Public API (`HuCentAISecureCore`)

| Method | Returns | Notes |
|---|---|---|
| `initialize()` | `Promise<void>` | Must be called once at boot (ApolloProvider does this). |
| `getSecurityCapabilities()` | `SecurityCapabilities` | Truthful per-device capability report. |
| `createDeviceIdentity()` | `DeviceIdentity` | Idempotent. Hardware-backed keypair; `publicKey` is exportable, private key never leaves the keystore. |
| `deleteDeviceIdentity()` | `void` | Wipes keys. |
| `authenticate(reason?)` | `AuthenticationResult` | Biometric / device credential. |
| `signPayload(payload)` | `SignatureResult` | Sign with the device identity key. |
| `verifySignature(payload, signature)` | `VerificationResult` | |
| `encrypt(data)` / `decrypt(data)` | `EncryptionResult` / `DecryptionResult` | Keystore-backed symmetric key. |
| `getAttestation()` | `AttestationResult` | App Attest / DeviceCheck (iOS), Play Integrity (Android). |
| `getSecurityStatus()` | `SecurityStatus` | Includes `implementation` label — must be truthful. |

Types: `src/security/securecore/SecureCoreTypes.ts`. Extend only additively.

## 3. Native module contract

`NativeSecureCore.ts` calls `requireOptionalNativeModule("HuCentAISecureCore")` and expects each
method to return a **JSON string** matching the TypeScript result type (except `initialize` and
`deleteDeviceIdentity`, which resolve `void`). Create the module as an Expo local module
(`modules/hucentai-securecore/` with `expo-module.config.json`, `ios/*.swift`, `android/**/*.kt`),
mirroring `modules/apollo-security/`.

Error handling: reject promises with the error code as the message (e.g. `SC_AUTH_CANCELLED`) or
return `{ success: false, errorCode }` in the result object. The app maps codes with
`userMessageFor()` (`SecureCoreErrors.ts`) and never shows internals.

## 4. Error codes

`SC_NOT_INITIALIZED, SC_AUTH_FAILED, SC_AUTH_CANCELLED, SC_AUTH_UNAVAILABLE, SC_DEVICE_IDENTITY_MISSING,
SC_KEY_UNAVAILABLE, SC_SIGNING_FAILED, SC_ENCRYPTION_FAILED, SC_DECRYPTION_FAILED, SC_ATTESTATION_FAILED,
SC_INTEGRITY_FAILED, SC_NATIVE_MODULE_UNAVAILABLE, SC_TIMEOUT, SC_UNKNOWN`

## 5. Mock scenarios (dev only)

`MockSecureCore.setScenario(name)` / `MockScenarioEngine.set(name)` — names in
`mock/MockSecureCoreScenarios.ts`: NORMAL, BIOMETRIC_SUCCESS/FAILED/CANCELLED/UNAVAILABLE,
DEVICE_IDENTITY_MISSING/CREATED, KEY_UNAVAILABLE, HARDWARE_KEY_UNAVAILABLE, SIGNING_SUCCESS/FAILED,
ENCRYPTION_SUCCESS/FAILED, DECRYPTION_FAILED, ATTESTATION_SUCCESS/FAILED, DEVICE_INTEGRITY_FAILED,
SECURECORE_UNAVAILABLE, TIMEOUT, UNKNOWN_ERROR. UI: Settings → Developer tools (mock builds only).

The security adapter mock also supports: NORMAL, PERMISSION_DENIED, BLOCK_UNVERIFIED,
PROTECTION_UNAVAILABLE (`MockSecurityAdapter.setScenario`).

## 6. Environment configuration

`frontend/.env` (development)
```
EXPO_PUBLIC_APP_ENV=development     # development | staging | production
EXPO_PUBLIC_SECURECORE_MODE=mock    # or native
EXPO_PUBLIC_SECURITY_MODE=mock      # or native
```
`frontend/.env.production` pins `production` / `native` / `native`.
Missing or invalid values throw at module load and fail the build preflight.

## 7. Production fail-closed rule — guarantees

Policy amended 2026-06 so it describes the architecture that actually exists. Enforced in **three** places,
all sharing `src/security/securityConfig.ts` (pure, unit-tested):

1. **Runtime (app load)** — `src/config/appEnvironment.ts` validates `EXPO_PUBLIC_APP_ENV`
   (`development | staging | production`, never derived from `__DEV__`) plus both mode variables.
   `SecureCore.ts` and `securityAdapter.ts` re-validate with the real native-module availability.
   A violation is **recorded** on `src/security/securityBoot.ts` (first error wins) and the selector returns a
   fail-closed stand-in whose every member throws; `app/_layout.tsx` reads `getSecurityBootError()` before
   mounting anything and renders `SafeStartScreen` ("Apollo can't start safely." + the exact reason + Try again /
   Close). No providers, navigation, protection start-up or background work run behind it. This replaced the
   previous throw-at-module-load, which in a release Hermes bundle was an OS "Apollo keeps stopping" crash
   (first physical-device run, Stage 1C.1).
2. **Build time** — `scripts/security-preflight.mjs` runs as the EAS `eas-build-pre-install` hook
   (and via `yarn security:preflight`). It reads `NATIVE_SECURECORE_DEPENDENT_FEATURES` from
   `securityConfig.ts` and fails a production build if the adapter mode is not native, if SecureCore is not
   native while dependents exist, or if any setting is missing/invalid. `.env.production` pins
   `APP_ENV=production`, `SECURITY_MODE=native`, `SECURECORE_MODE=mock`.
3. **Tests** — `yarn test:security` (`tests/securityConfig.test.ts`, 9) and `yarn test:boot`
   (`tests/securityBoot.test.ts`, 6: invalid production config → recorded error + stand-in, real adapter factory
   never runs, stand-in can never yield a protection status, blocking copy never claims protection, valid
   production config → normal start-up, missing native adapter → still blocked).

Rules:
- `production` ⇒ `EXPO_PUBLIC_SECURITY_MODE=native` **and** the `ApolloSecurity` module present. No exceptions —
  this is the live enforcement/capability surface and is never weakened.
- `production` ⇒ `EXPO_PUBLIC_SECURECORE_MODE=native` **only while** `NATIVE_SECURECORE_DEPENDENT_FEATURES`
  is non-empty. Today it is empty: API identity is server-issued device tokens (`src/auth/deviceIdentity.ts`),
  SecureCore is a contract stub, and the mock is permitted but shown in Settings as "NOT ACTIVE (MOCK)" with
  `SECURECORE_STATUS`. Add a feature id to the list the moment production code depends on native SecureCore.
- `development` and `staging` may use `mock`, including native builds installed on physical devices, but must
  set their mode explicitly — there is no fallback/default.
- `native` mode with the module absent fails closed in **every** environment. There is never a silent
  fallback to the mock.
- EAS profiles (managed by Emergent in `eas.json`) should set `EXPO_PUBLIC_APP_ENV` per profile;
  `.env.production` covers the production bundle even if the profile omits it, and the preflight infers
  `production` from `EAS_BUILD_PROFILE=production`.

## 8. How the app uses SecureCore today

- Boot: `SecureCore.initialize()`; if a device identity exists, `createDeviceIdentity()` returns it and the
  `deviceId` becomes the anonymous ID for backend sync (`ApolloProvider`).
- Onboarding: `createDeviceIdentity()` → register device with backend.
- Settings shows `SECURECORE_LABEL` so testers always see whether the build is mock or native.
- `authenticate / signPayload / getAttestation / encrypt / decrypt` are wired and exercised from dev tools; no
  production feature depends on them yet, so the native SDK can land without UI changes.

## 9. Logging

`SecureCoreLogger.log(eventName, meta)` accepts only an allow-list of event names (see
`SecureCoreLogger.ts`). Never log keys, secrets, tokens, credentials, decrypted data or biometrics.
The native SDK should follow the same rule.

## 10. Files to replace / extend

- Implement: `modules/hucentai-securecore/**` (new Expo module, Swift + Kotlin).
- Adjust if the JSON shape changes: `src/security/securecore/native/NativeSecureCore.ts`.
- Implement the protection module bodies: `modules/apollo-security/ios/ApolloSecurityModule.swift`,
  `modules/apollo-security/android/src/main/java/com/hucentai/apollosecurity/ApolloSecurityModule.kt`.
  `blockDestination` must return `verified: true` **only** when the platform confirms the block; the
  app never shows "Biting" otherwise.
- Do not modify: `SecureCore.ts` selector semantics, `HuCentAISecureCore.ts`, application screens.

## 11. Rules

- No production cryptography, key storage, biometrics or attestation in JavaScript.
- Never let the mock ship in production; never silently fall back.
- Keep the `implementation` label truthful in `getSecurityStatus()`.
