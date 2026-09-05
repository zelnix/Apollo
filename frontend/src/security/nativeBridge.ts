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
  // Gate 2 — Text & Messaging (SDK contract). Each returns a JSON string; see src/security/messagingSdk.ts.
  getMessagingCapabilities(): Promise<string>;
  analyseMessageMetadata(metadataJson: string): Promise<string>;
  checkSenderReputation(sender: string): Promise<string>;
  registerShareHandler(): Promise<string>;
  getRecentMessageSecurityEvents(): Promise<string>;
  // Gate 3 — Website & Browser (SDK contract). JSON strings; see src/security/webSdk.ts.
  getWebProtectionCapabilities(): Promise<string>;
  getDomainReputation(domain: string): Promise<string>;
  getRedirectAssessment(url: string): Promise<string>;
  allowDestination(domain: string): Promise<string>;
  getRecentWebThreatEvents(): Promise<string>;
  // Gate 4 — Phone Calls (SDK contract). JSON strings; see src/security/callSdk.ts.
  getCallProtectionCapabilities(): Promise<string>;
  getCallerMetadata(): Promise<string>;
  checkNumberReputation(number: string): Promise<string>;
  reportCallContext(contextJson: string): Promise<string>;
  getRecentCallSecurityEvents(): Promise<string>;
  // Gate 7 — Apps & Device (SDK contract). JSON strings; see src/security/appDeviceSdk.ts.
  getAppDeviceCapabilities(): Promise<string>;
  getInstalledAppAssessment(packageId: string): Promise<string>;
  getRecentInstallEvents(): Promise<string>;
  getDeviceSecuritySignals(): Promise<string>;
  getRecentAppSecurityEvents(): Promise<string>;
  // Gate 8 — Network & Accounts (SDK contract). JSON strings; see src/security/networkAccountSdk.ts.
  getNetworkProtectionCapabilities(): Promise<string>;
  getVPNState(): Promise<string>;
  getRecentNetworkEvents(): Promise<string>;
  getRecentAccountSecurityEvents(): Promise<string>;
  submitAccountSecurityEvent(eventJson: string): Promise<string>;
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
