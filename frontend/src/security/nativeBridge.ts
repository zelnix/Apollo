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
  // Cross-Platform Architecture Directive: capability/evidence contract (JSON strings);
  // see src/security/PlatformCapabilityProfile.ts. Native side may not implement these yet —
  // NativeAdapterBase fails closed via NativeModuleUnavailable exactly like every other call.
  getPlatformCapabilityProfile(): Promise<string>;
  getEnforcementEvidence(): Promise<string>;
  /** Real manufacturer/model/OS/form-factor/locale facts (JSON DeviceProfileFacts). */
  getDeviceProfileFacts(): Promise<string>;
  getGuardDogCandidateCapabilities(): Promise<string>;
  getGuardDogCandidateStatus(): Promise<string>;
  configureGuardDogCandidate(configJson: string): Promise<string>;
  acceptGuardDogCandidateBundle(bundleJson: string): Promise<string>;
  startGuardDogCandidate(): Promise<string>;
  stopGuardDogCandidate(): Promise<string>;
  analyzeGuardDogCandidateUrl(url: string): Promise<string>;
  getGuardDogCandidateEvidence(): Promise<string>;
  acknowledgeGuardDogCandidateEvidence(idsJson: string): Promise<string>;
  getGuardDogCandidateRecovery(): Promise<string>;
  probeGuardDogCandidateFresh(timeoutMs: number): Promise<string>;
  getGuardDogCandidateProvenance(): Promise<string>;
  runGuardDogCandidateAcceptance(timeoutMs: number): Promise<string>;
  getGuardDogProductionCapabilities(): string;
  getGuardDogProductionStatus(): string;
  configureGuardDogProduction(configJson: string): string;
  installGuardDogProductionTrustManifest(manifestJson: string): string;
  acceptGuardDogProductionRuleBundle(bundleJson: string): string;
  refreshGuardDogProductionAuthority(): Promise<string>;
  startGuardDogProduction(): Promise<string>;
  stopGuardDogProduction(): Promise<string>;
  analyzeGuardDogProductionUrl(url: string): string;
  getGuardDogProductionEvidence(): string;
  acknowledgeGuardDogProductionEvidence(idsJson: string): string;
  getGuardDogProductionRecovery(): string;
  // Gate 2 — Text & Messaging (SDK contract). Each returns a JSON string; see src/security/messagingSdk.ts.
  getMessagingCapabilities(): Promise<string>;
  analyseMessageMetadata(metadataJson: string): Promise<string>;
  checkSenderReputation(sender: string): Promise<string>;
  registerShareHandler(): Promise<string>;
  getRecentMessageSecurityEvents(): Promise<string>;
  acknowledgeMessageSecurityEvents(idsJson: string): Promise<string>;
  configureTextBackgroundHandoff(configJson: string): Promise<string>;
  /** Text Guard (Android only): deep-links to Settings > Notification access so the person can
   * grant/revoke Apollo's NotificationListenerService permission (ApolloSmsListenerService.kt).
   * iOS reports { opened: false } — there is no equivalent settings screen on that platform. */
  openSmsListenerSettings(): Promise<string>;
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
  /** Call Guard (Android): launches the RoleManager.ROLE_CALL_SCREENING request so the person can
   * select Apollo as their call-screening app (ApolloCallScreeningService.kt). iOS opens the app's
   * own Settings page instead — Apple has no deep link to Phone > Call Blocking & Identification. */
  requestCallScreeningRole(): Promise<string>;
  /** Numbers seen ringing with no local block/allow/risk signal, queued for a background reputation
   * lookup (mailbox semantics — draining clears the queue). Always [] on iOS: CXCallDirectoryProvider
   * gets no per-call callback at all, unlike Android's CallScreeningService. */
  getPendingCallLookups(): Promise<string>;
  /** The device-local block/allow/auto-risky number sets Call Guard's native screening/directory
   * mechanism actually reads — {block: string[], allow: string[], autoRisky: string[]}. */
  getCallBlockAllowList(): Promise<string>;
  addCallListEntry(entryJson: string): Promise<string>;
  removeCallListEntry(entryJson: string): Promise<string>;
  /** Adds a number to the device-local "autoRisky" set (populated after a high-risk
   * POST /api/call/risk-check result) so Call Guard's native mechanism blocks it going forward. */
  markNumberRisky(entryJson: string): Promise<string>;
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
