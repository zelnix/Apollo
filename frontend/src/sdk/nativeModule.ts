// JS side of the native module. Resolves the native module when present (dev/production
// build with the module linked) and degrades honestly otherwise (Expo Go / web):
// capabilities report no enforcement and startProtection() stays INACTIVE.
// NOTE: an identical copy lives in packages/guarddog-expo-module/src/index.ts because Metro
// cannot resolve outside its project root; keep both in sync. (Fixed in Gate Guard M2.1 Phase 5 --
// this comment previously pointed at a stale apps/guarddog-mobile path.)
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

// --- Gate Guard M2 Website Gate (Phase 5): additive bridge surface. None of the above M1 types/methods are touched. ---

/** Truthful, live snapshot of the Website Gate's native state -- dnsGatewayActive is set only by a
 * live TUN session that actually built the DNS gateway pipeline, never assumed from configuration alone. */
export interface NativeWebsiteGateStatus {
  configured: boolean;
  dnsGatewayActive: boolean;
  acceptedRulesetId: string | null;
  acceptedBundleVersion: number | null;
  acceptedKeyId: string | null;
  overrideCount: number;
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
  // Gate Guard M2 Website Gate: the sinkhole pool / virtual DNS endpoint are never passed here --
  // they are always the fixed native WebsiteGateAddressing constants.
  configureWebsiteGate(config: { upstreamDnsResolverIpv4: string | null; bindingLifetimeMs: number }): void;
  acceptWebsiteGateRuleBundle(rawJson: string): NativeRuleBundleResult;
  getWebsiteGateStatus(): NativeWebsiteGateStatus;
  /** Local, reversible, auditable ALLOW-only override. Can only ever prevent a sinkhole arming the
   * signed rule bundle would otherwise trigger for `host` -- never arms a binding itself, never
   * produces a THREAT_BLOCKED. Returns false if `host` fails native canonicalization. */
  setWebsiteGateAllowOverride(config: { host: string; allowed: boolean }): boolean;
  getWebsiteGateOverrides(): string[];
  clearWebsiteGateOverrides(): void;
  addListener(eventName: string, listener: (payload: unknown) => void): { remove(): void };
}

export const GuardDogNative: GuardDogNativeModule | null = requireOptionalNativeModule<GuardDogNativeModule>("GuardDogSecurity");
