// SecureCore — the single entry point the application uses.
// Mode: EXPO_PUBLIC_SECURECORE_MODE=mock|native (explicit build config, not __DEV__).
// PRODUCTION SAFETY: native mode never falls back to the mock. If the native SDK
// is unavailable, we throw and the app fails closed.

import type { HuCentAISecureCore } from "./HuCentAISecureCore";
import { MOCK_SECURECORE_LABEL, MockSecureCore } from "./mock/MockSecureCore";
import { isNativeSecureCoreAvailable, NativeSecureCore } from "./native/NativeSecureCore";

export type SecureCoreMode = "mock" | "native";

const rawMode = process.env.EXPO_PUBLIC_SECURECORE_MODE;
if (rawMode !== "mock" && rawMode !== "native") {
  throw new Error(`EXPO_PUBLIC_SECURECORE_MODE must be "mock" or "native" (got "${rawMode ?? "undefined"}").`);
}
export const SECURECORE_MODE: SecureCoreMode = rawMode;
export const IS_MOCK_SECURECORE = SECURECORE_MODE === "mock";
export const SECURECORE_LABEL = IS_MOCK_SECURECORE ? MOCK_SECURECORE_LABEL : "HuCentAI SecureCore (native)";

function select(): HuCentAISecureCore {
  if (SECURECORE_MODE === "mock") return MockSecureCore;
  if (!isNativeSecureCoreAvailable()) {
    throw new Error("HuCentAI SecureCore native SDK is required but unavailable.");
  }
  return NativeSecureCore;
}

export const SecureCore: HuCentAISecureCore = select();

export type { HuCentAISecureCore } from "./HuCentAISecureCore";
export * from "./SecureCoreTypes";
export { SecureCoreError, userMessageFor } from "./SecureCoreErrors";
