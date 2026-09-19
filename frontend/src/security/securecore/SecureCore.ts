// SecureCore — the single entry point the application uses.
// Mode: EXPO_PUBLIC_SECURECORE_MODE=mock|native (explicit build config, not __DEV__).
// SAFETY (see securityConfig.ts):
//  - Production requires native SecureCore only while a shipped feature depends on it
//    (NATIVE_SECURECORE_DEPENDENT_FEATURES). Today the list is empty: SecureCore is a contract stub,
//    API identity is server-issued device tokens, and the mock must stay visibly labelled as a mock.
//  - Native mode never falls back to the mock. If the native SDK is unavailable, boot fails closed
//    (securityBoot.ts → SafeStartScreen) — never a silent downgrade, never an OS crash.

import { SECURITY_CONFIG } from "@/src/config/appEnvironment";
import type { HuCentAISecureCore } from "./HuCentAISecureCore";
import { MOCK_SECURECORE_LABEL, MockSecureCore } from "./mock/MockSecureCore";
import { isNativeSecureCoreAvailable, NativeSecureCore } from "./native/NativeSecureCore";
import { selectFailClosed } from "../securityBoot";
import { validateSecurityConfig, type SecurityMode } from "../securityConfig";

export type SecureCoreMode = SecurityMode;
export const SECURECORE_MODE: SecureCoreMode = SECURITY_CONFIG.secureCoreMode;
export const IS_MOCK_SECURECORE = SECURECORE_MODE === "mock";
export const SECURECORE_LABEL = IS_MOCK_SECURECORE ? MOCK_SECURECORE_LABEL : "HuCentAI SecureCore (native)";
/** Truthful one-line status for Settings: the mock never protects anything, whatever the environment. */
export const SECURECORE_STATUS = IS_MOCK_SECURECORE
  ? "Not active — contract stub only. No shipped feature depends on native SecureCore yet; device identity uses server-issued tokens."
  : "Active — native HuCentAI SecureCore SDK present.";

function select(): HuCentAISecureCore {
  // Re-validate with runtime module availability (fail closed if native is missing).
  return selectFailClosed(
    () => validateSecurityConfig({
      appEnvironment: SECURITY_CONFIG.appEnvironment, secureCoreMode: SECURITY_CONFIG.secureCoreMode, securityAdapterMode: SECURITY_CONFIG.securityAdapterMode,
      nativeSecureCoreAvailable: SECURECORE_MODE === "native" ? isNativeSecureCoreAvailable() : undefined,
    }),
    () => (SECURECORE_MODE === "mock" ? MockSecureCore : NativeSecureCore),
  );
}

export const SecureCore: HuCentAISecureCore = select();

export type { HuCentAISecureCore } from "./HuCentAISecureCore";
export * from "./SecureCoreTypes";
export { SecureCoreError, userMessageFor } from "./SecureCoreErrors";
