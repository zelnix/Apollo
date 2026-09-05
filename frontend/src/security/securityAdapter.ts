// Adapter selector. Application code imports ONLY `securityAdapter` from here.
// Mode is an explicit build-time setting (EXPO_PUBLIC_SECURITY_MODE=mock|native),
// never inferred from __DEV__. Native mode fails closed if the module is missing.

import { Platform } from "react-native";

import { MockSecurityAdapter } from "./MockSecurityAdapter";
import { getNativeModule } from "./nativeBridge";
import { AndroidSecurityAdapter, IOSSecurityAdapter } from "./NativeSecurityAdapters";
import type { SecurityPlatformAdapter } from "./SecurityPlatformAdapter";

export type SecurityMode = "mock" | "native";

const rawMode = process.env.EXPO_PUBLIC_SECURITY_MODE;
if (rawMode !== "mock" && rawMode !== "native") {
  throw new Error(`EXPO_PUBLIC_SECURITY_MODE must be "mock" or "native" (got "${rawMode ?? "undefined"}").`);
}
export const SECURITY_MODE: SecurityMode = rawMode;
export const IS_MOCK_SECURITY = SECURITY_MODE === "mock";

function selectAdapter(): SecurityPlatformAdapter {
  if (SECURITY_MODE === "mock") return MockSecurityAdapter;
  // Native mode: fail closed. Never fall back to the mock.
  if (!getNativeModule()) {
    throw new Error("Apollo native security module is required but unavailable. Use an EAS development/production build.");
  }
  if (Platform.OS === "ios") return IOSSecurityAdapter;
  if (Platform.OS === "android") return AndroidSecurityAdapter;
  throw new Error(`Apollo native security is not supported on platform "${Platform.OS}".`);
}

export const securityAdapter: SecurityPlatformAdapter = selectAdapter();
