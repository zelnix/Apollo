// JS side of the native module. Resolves the native module when present (dev/production
// build with the module linked) and degrades honestly otherwise (Expo Go / web):
// capabilities report no enforcement and startProtection() stays INACTIVE.
// NOTE: an identical copy lives in apps/guarddog-mobile/src/sdk/nativeModule.ts because
// Metro cannot resolve outside its project root; keep both in sync.
import { requireOptionalNativeModule } from "expo-modules-core";

export interface NativeProtectionState {
  state: string;
  consentGranted: boolean;
  reason?: string | null;
  updatedAt: string;
}

export interface NativeRuleBundleResult {
  accepted: boolean;
  rejectReason?: string | null;
  rulesetId?: string | null;
  bundleVersion?: number | null;
  keyId?: string | null;
  ruleCount: number;
}

export interface NativeRecoveryStatus {
  lifecycle: string;
  tunOpen: boolean;
  selectiveRouteActive: boolean;
  vpnTransportPresent: boolean;
  routeCidr: string | null;
  dropReporterAttached: boolean;
  recovered: boolean;
}

export interface GuardDogNativeModule {
  getCapabilities(): Record<string, unknown>;
  getProtectionState(): NativeProtectionState;
  configure(config: { controlledHost: string; controlledIpv4: string; controlledUrl: string; rulesetId: string; dedupeWindowMs: number }): void;
  acceptRuleBundle(rawJson: string): NativeRuleBundleResult;
  analyzeUrl(url: string): { sanitizedUrl: string; host: string; verdict: string; ruleId: string | null } | null;
  requestPermission(kind: string): Promise<"granted" | "denied" | "unsupported">;
  startProtection(): Promise<NativeProtectionState>;
  stopProtection(): Promise<NativeProtectionState>;
  getEnforcementStats(): Record<string, number> | null;
  getRecoveryStatus(): NativeRecoveryStatus;
  addListener(eventName: string, listener: (payload: unknown) => void): { remove(): void };
}

export const GuardDogNative: GuardDogNativeModule | null = requireOptionalNativeModule<GuardDogNativeModule>("GuardDogSecurity");
