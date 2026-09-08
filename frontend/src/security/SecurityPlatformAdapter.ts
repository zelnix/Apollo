// SecurityPlatformAdapter — the contract every platform implementation fulfils.
// Application code must only use `securityAdapter` from "./securityAdapter".
// Capabilities are discovered dynamically; never assume iOS/Android parity.

import type { Capability, Visibility } from "@/src/domain/types";
import type { EnforcementEvidence, PlatformCapabilityProfile } from "./PlatformCapabilityProfile";

// AdapterKind is deliberately narrower than SdkPlatform (see PlatformCapabilityProfile.ts):
// it lists only the implementations this app can actually select at runtime today
// (securityAdapter.ts). Windows/macOS have no adapter yet, but the capability/evidence
// TYPES below already represent them so no redesign is needed when those adapters land.
export type AdapterKind = "mock" | "ios" | "android";

export interface ProtectionPermission {
  id: "network_filter" | "vpn_config" | "accessibility" | "notifications";
  title: string;
  status: "granted" | "denied" | "undetermined" | "blocked" | "not_applicable";
  canAskAgain: boolean;
  why: string;
}

/** How Site Guard actually enforces on this device. "simulated" only ever comes from the mock adapter. */
export type EnforcementMethod = "dns_filter" | "content_blocker" | "none" | "simulated";

/**
 * Truth-of-state contract. Three distinct facts, never collapsed into one Boolean:
 *  - requested:   the person turned protection on (their intent; persisted by the native layer).
 *  - operational: the enforcement mechanism is running/enabled RIGHT NOW as observed from the OS
 *                 (Android: the DNS VpnService is up; iOS: the Safari content blocker is enabled and rules are written).
 *  - lastVerified: when the OS last confirmed that observation.
 * `running` is kept for existing callers and is always identical to `operational`.
 * The UI reports these; it never decides them.
 */
export interface ProtectionStatus {
  running: boolean;
  requested: boolean;
  operational: boolean;
  enforcementMethod: EnforcementMethod;
  /** Plain-language statement of exactly what is covered — and what is not. */
  coverage: string;
  /** Machine-readable scope tags, e.g. ["dns:ipv4", "dns:udp-53"] or ["browser:safari"]. */
  coverageScope: string[];
  lastVerified: string | null;
  /** Why requested ≠ operational (null when they agree). */
  degradedReason: string | null;
  visibility: Visibility;
  since: string | null;
  adapterLabel: string; // visible label, e.g. "MOCK adapter — simulated"
  checkedAt: string;
}

export interface NetworkStatus {
  connected: boolean;
  type: "wifi" | "cellular" | "ethernet" | "vpn" | "other" | "unknown" | "none";
  isInternetReachable: boolean | null;
  /** Whether the adapter can actually inspect connection safety. */
  inspectable: boolean;
  /** Wi‑Fi security as reported by the platform. "n/a" when not on Wi‑Fi, "unknown" when the platform hides it. */
  wifiSecurity: "open" | "wep" | "wpa" | "wpa3" | "enterprise" | "unknown" | "n/a";
  captivePortal: boolean | null;
  vpnActive: boolean | null;
  /** Network name when the platform reveals it (needs location permission on both platforms). */
  ssid: string | null;
  checkedAt: string;
}

export interface SecuritySignal {
  code: string;
  severity: "info" | "growl" | "bark";
  plain: string;
  occurredAt: string;
}

export interface NativeUrlAnalysis {
  supported: boolean; // false when the platform has no native analyser
  verdict: "clean" | "suspicious" | "malicious" | "unknown";
  reasons: string[];
}

export interface BlockResult {
  /** True when the platform confirms the block RULE is now live (filter running + host enforced
   * going forward). This is NOT a claim that any packet has been dropped yet — see `evidence`,
   * which for this call is either null or explicitly unverified. Only EnforcementEvidence with
   * result:"verified" (from an actually-observed drop) may ever authorise THREAT_BLOCKED/"biting". */
  verified: boolean;
  method: "network_extension" | "vpn_service" | "dns_filter" | "content_blocker" | "simulated" | "none";
  detail: string;
  adapterLabel: string;
  blockedAt: string | null;
  /** Full evidence backing `verified`. Null for mock (never enforces) or when the platform gave none. */
  evidence?: EnforcementEvidence | null;
}

export interface SecurityPlatformAdapter {
  readonly kind: AdapterKind;
  readonly label: string;
  getCapabilities(): Promise<Capability[]>;
  getProtectionStatus(): Promise<ProtectionStatus>;
  analyseURL(url: string): Promise<NativeUrlAnalysis>;
  analyseDomain(domain: string): Promise<NativeUrlAnalysis>;
  blockDestination(host: string): Promise<BlockResult>;
  unblockDestination(host: string): Promise<BlockResult>;
  getNetworkStatus(): Promise<NetworkStatus>;
  getSecuritySignals(): Promise<SecuritySignal[]>;
  startProtection(): Promise<ProtectionStatus>;
  stopProtection(): Promise<ProtectionStatus>;
  getProtectionPermissions(): Promise<ProtectionPermission[]>;
  requestProtectionPermission(id: ProtectionPermission["id"]): Promise<ProtectionPermission>;
  /** Cross-platform capability ceiling for this adapter's platform. See PlatformCapabilityProfile.ts. */
  getPlatformCapabilityProfile(): Promise<PlatformCapabilityProfile>;
  /** Recent enforcement evidence records. Mock MUST always return []. */
  getEnforcementEvidence(): Promise<EnforcementEvidence[]>;
}
