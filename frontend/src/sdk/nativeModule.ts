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

export interface NativeBuildProvenance {
  apkSha256: string | null;
  apkSizeBytes: number | null;
  splitApks: number;
  packageName: string | null;
  versionName: string | null;
  versionCode: number | string | null;
  debuggable: boolean | null;
}

/**
 * Harness-only: one fresh-socket probe of the configured controlled endpoint (new TCP socket → TLS with the canonical hostname → one GET,
 * `Connection: close`; the socket is never VpnService.protect()ed). `synDropShape` is true ONLY for phase=tcp-connect + outcome=timeout to
 * the configured IPv4 — the sole network-level shape consistent with the SYN being dropped inside the /32 TUN.
 */
export interface NativeFreshProbe {
  freshSocket: true;
  expectedIpv4: string;
  resolvedIpv4: string | null;
  phase: "dns" | "tcp-connect" | "tls-handshake" | "http";
  outcome: "ok" | "timeout" | "refused" | "unreachable" | "dns-failed" | "tls-failed" | "http-error" | "error";
  httpStatus: number | null;
  elapsedMs: number;
  detail: string;
  synDropShape: boolean;
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
  /** Harness-only, read-only: true when the OS holds no VPN consent for this app (VpnService.prepare() would return an intent). No dialog. */
  isVpnConsentRequired(): boolean;
  getBuildProvenance(): Promise<NativeBuildProvenance>;
  probeControlledEndpointFresh(timeoutMs: number): Promise<NativeFreshProbe>;
  addListener(eventName: string, listener: (payload: unknown) => void): { remove(): void };
}

export const GuardDogNative: GuardDogNativeModule | null = requireOptionalNativeModule<GuardDogNativeModule>("GuardDogSecurity");
