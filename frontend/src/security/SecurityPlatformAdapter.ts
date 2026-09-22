// SecurityPlatformAdapter — the contract every platform implementation fulfils.
// Application code must only use `securityAdapter` from "./securityAdapter".
// Capabilities are discovered dynamically; never assume iOS/Android parity.

import type { Capability, Visibility } from "@/src/domain/types";
import type { EnforcementEvidence, PlatformCapabilityProfile } from "./PlatformCapabilityProfile";

// AdapterKind lists the hosts this app can select at runtime (securityAdapter.ts): real Kotlin/Swift modules, the Windows/macOS
// desktop host (Tauri shell, typed commands), the real browser adapter, and the development-only device-preview harness.
export type AdapterKind = "ios" | "android" | "windows" | "macos" | "web" | "preview_harness";

export type PermissionUnavailableReason = "not_implemented" | "os_restricted" | "hardware_absent" | "configuration_missing" | "entitlement_missing" | "privacy_prohibited" | "source_refused" | "adapter_failed";

/**
 * PermissionObservation (spec §10A). `status`/`enabled`/`observedAt` are a FRESH OS observation; `requested`/`lastRequestedAt`
 * are Apollo's own recorded request history. Missing historical knowledge is null, never an invented true.
 */
export interface ProtectionPermission {
  id: "network_filter" | "vpn_config" | "accessibility" | "notifications";
  title: string;
  status: "granted" | "denied" | "undetermined" | "blocked" | "restricted" | "not_applicable" | "unavailable";
  canAskAgain: boolean;
  why: string;
  requested?: boolean | null;
  lastRequestedAt?: string | null;
  /** Service/special-access enablement, distinct from a permission grant. */
  enabled?: boolean | null;
  observedAt?: string | null;
  unavailableReason?: PermissionUnavailableReason | null;
  /** Native launch result; opening system UI is not the same as a granted permission. */
  requestState?: "already_granted" | "system_ui_opened" | "launch_failed" | "unsupported" | null;
}

/** Real device facts a native host can report (never inferred from screen size). */
export interface DeviceProfileFacts {
  manufacturer: string | null;
  model: string | null;
  osVersion: string | null;
  formFactor: "phone" | "tablet" | "desktop" | "laptop" | "convertible" | "unknown";
  locale: string | null;
}

/** How Site Guard actually enforces on this device. "simulated" only ever comes from the mock adapter. */
export type EnforcementMethod = "dns_filter" | "content_blocker" | "packet_filter" | "none" | "simulated";

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
  /** Recent enforcement evidence records. Non-enforcing hosts MUST always return []. */
  getEnforcementEvidence(): Promise<EnforcementEvidence[]>;
  /** Real device facts from the native host; browser/preview hosts return null (they cannot observe them). */
  getDeviceProfileFacts?(): Promise<DeviceProfileFacts | null>;
  /** Optional two-phase acknowledgement for adapters with a durable native evidence inbox. */
  acknowledgeEnforcementEvidence?(evidenceIds: string[]): Promise<void>;
}
