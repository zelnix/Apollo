// SecureCore — the single entry point the application uses.
// Mode: EXPO_PUBLIC_SECURECORE_MODE=mock|native (explicit build config, not __DEV__).
// PRODUCTION SAFETY (see securityConfig.ts):
//  - EXPO_PUBLIC_APP_ENV=production REQUIRES native mode; a mock configuration throws at load.
//  - Native mode never falls back to the mock. If the native SDK is unavailable, we throw and fail closed.
//  - Mock is permitted in development and staging, including builds on physical devices.

import { SECURITY_CONFIG } from "@/src/config/appEnvironment";
import type { HuCentAISecureCore } from "./HuCentAISecureCore";
import { MOCK_SECURECORE_LABEL, MockSecureCore } from "./mock/MockSecureCore";
import { isNativeSecureCoreAvailable, NativeSecureCore } from "./native/NativeSecureCore";
import { validateSecurityConfig, type SecurityMode } from "../securityConfig";

export type SecureCoreMode = SecurityMode;
export const SECURECORE_MODE: SecureCoreMode = SECURITY_CONFIG.secureCoreMode;
export const IS_MOCK_SECURECORE = SECURECORE_MODE === "mock";
export const SECURECORE_LABEL = IS_MOCK_SECURECORE ? MOCK_SECURECORE_LABEL : "HuCentAI SecureCore (native)";

function select(): HuCentAISecureCore {
  // Re-validate with runtime module availability (fail closed if native is missing).
  validateSecurityConfig({
    appEnvironment: SECURITY_CONFIG.appEnvironment, secureCoreMode: SECURITY_CONFIG.secureCoreMode, securityAdapterMode: SECURITY_CONFIG.securityAdapterMode,
    nativeSecureCoreAvailable: SECURECORE_MODE === "native" ? isNativeSecureCoreAvailable() : undefined,
  });
  return SECURECORE_MODE === "mock" ? MockSecureCore : NativeSecureCore;
}

export const SecureCore: HuCentAISecureCore = select();

export type { HuCentAISecureCore } from "./HuCentAISecureCore";
export * from "./SecureCoreTypes";
export { SecureCoreError, userMessageFor } from "./SecureCoreErrors";
