// Bridge to the local Expo Module `ApolloSecurity` (Swift / Kotlin).
// Loaded lazily and fails closed: when the module is not present (Expo Go, web)
// `getNativeModule()` returns null and native adapters throw a clear error.

import { requireOptionalNativeModule } from "expo-modules-core";

export interface ApolloSecurityNativeModule {
  getCapabilities(): Promise<string>; // JSON string of Capability[]
  getProtectionStatus(): Promise<string>;
  analyseURL(url: string): Promise<string>;
  analyseDomain(domain: string): Promise<string>;
  blockDestination(host: string): Promise<string>;
  unblockDestination(host: string): Promise<string>;
  getNetworkStatus(): Promise<string>;
  getSecuritySignals(): Promise<string>;
  startProtection(): Promise<string>;
  stopProtection(): Promise<string>;
  getProtectionPermissions(): Promise<string>;
  requestProtectionPermission(id: string): Promise<string>;
}

let cached: ApolloSecurityNativeModule | null | undefined;

export function getNativeModule(): ApolloSecurityNativeModule | null {
  if (cached !== undefined) return cached;
  try {
    cached = requireOptionalNativeModule<ApolloSecurityNativeModule>("ApolloSecurity");
  } catch {
    cached = null;
  }
  return cached;
}

export class NativeModuleUnavailable extends Error {
  code = "SC_NATIVE_MODULE_UNAVAILABLE";
  constructor(platform: string) {
    super(`Apollo ${platform} security module is required but unavailable. Build with EAS (development build); Expo Go cannot load it.`);
    this.name = "NativeModuleUnavailable";
  }
}
