// SecurityPlatformAdapter — the contract every platform implementation fulfils.
// Application code must only use `securityAdapter` from "./securityAdapter".
// Capabilities are discovered dynamically; never assume iOS/Android parity.

import type { Capability, Visibility } from "@/src/domain/types";

export type AdapterKind = "mock" | "ios" | "android";

export interface ProtectionPermission {
  id: "network_filter" | "vpn_config" | "accessibility" | "notifications";
  title: string;
  status: "granted" | "denied" | "undetermined" | "blocked" | "not_applicable";
  canAskAgain: boolean;
  why: string;
}

export interface ProtectionStatus {
  running: boolean;
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
  /** True ONLY when the platform confirmed the destination is now blocked. */
  verified: boolean;
  method: "network_extension" | "vpn_service" | "dns_filter" | "content_blocker" | "simulated" | "none";
  detail: string;
  adapterLabel: string;
  blockedAt: string | null;
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
}
