// DesktopSecurityAdapter — Windows/macOS host (Tauri shell around the shared Expo web bundle, see /desktop).
// Real OS facts arrive through typed, allowlisted Tauri commands (desktop/src-tauri/src/main.rs). Anything the desktop
// host has not implemented yet is reported as unavailable with reason `not_implemented` — never simulated, never "safe".
import type { Capability } from "@/src/domain/types";
import { desktopHostKind } from "./desktopHost";
import { PLATFORM_CAPABILITY_BASELINES, type EnforcementEvidence, type PlatformCapabilityProfile } from "./PlatformCapabilityProfile";
import type {
  BlockResult, DeviceProfileFacts, NativeUrlAnalysis, NetworkStatus, ProtectionPermission, ProtectionStatus, SecurityPlatformAdapter, SecuritySignal,
} from "./SecurityPlatformAdapter";

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
type TauriGlobal = { __TAURI_INTERNALS__?: { invoke: Invoke }; __TAURI__?: { core?: { invoke: Invoke } } };

export function desktopHostPresent(): boolean {
  const g = globalThis as TauriGlobal;
  return !!(g.__TAURI_INTERNALS__?.invoke || g.__TAURI__?.core?.invoke) && desktopHostKind() != null;
}

/** Opens one of the fixed OS Settings destinations the desktop host allows (`open_settings_target`). */
export function openDesktopSettings(target: string): Promise<void> { return invoke<void>("open_settings_target", { target }); }

function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const g = globalThis as TauriGlobal;
  const fn = g.__TAURI_INTERNALS__?.invoke ?? g.__TAURI__?.core?.invoke;
  if (!fn) throw new Error("Desktop host bridge unavailable.");
  return fn<T>(command, args);
}

interface HostInfo { platform: "windows" | "macos"; osVersion: string; manufacturer: string | null; model: string | null; formFactor: DeviceProfileFacts["formFactor"]; locale: string; hostVersion: string }
interface HostNetwork { connected: boolean; type: NetworkStatus["type"]; vpnActive: boolean | null; ssid: string | null; wifiSecurity: NetworkStatus["wifiSecurity"] }
interface HostPermission { id: ProtectionPermission["id"]; state: ProtectionPermission["status"]; enabled: boolean | null; requested: boolean | null; lastRequestedAt: string | null; unavailableReason: ProtectionPermission["unavailableReason"] }
interface HostFilterStatus { enabled: boolean; blockedDomains: string[]; method: "hosts_dns_filter" }
interface HostFilterChange { verified: boolean; host: string; enabled: boolean; changedAt: string }

class DesktopSecurityAdapterImpl implements SecurityPlatformAdapter {
  // Explicit host identity: Higgins receives platform "windows"/"macos" with native-origin facts, not a browser profile.
  readonly kind: "windows" | "macos" = desktopHostKind() ?? "windows";
  readonly label = `Apollo desktop host (${desktopHostKind() === "macos" ? "macOS" : "Windows"})`;
  private info: HostInfo | null = null;

  private async host(): Promise<HostInfo> { return this.info ?? (this.info = await invoke<HostInfo>("host_info")); }

  async getCapabilities(): Promise<Capability[]> {
    return [
      { id: "link_guard", title: "Link Gate", status: "available", detail: "Checks links you paste into Apollo; it is a manual check." },
      { id: "known_threats", title: "Known Threat Lookup", status: "available", detail: "Privacy-preserving reputation checks using the link only." },
      { id: "site_guard", title: "Site Gate", status: "available", detail: "Applies an administrator-approved, OS hosts/DNS block rule to exact domains. It does not inspect packets or attribute traffic to apps." },
      { id: "connection_guard", title: "Network Gate", status: "available", detail: "Reads the active network interface and VPN state from the OS." },
      { id: "share_intake", title: "Open with Apollo", status: "available", detail: "Open or drop files into Apollo for File Gate." },
      { id: "message_guard", title: "Text Gate", status: "available", detail: "Checks texts and chats you paste or screenshot into Apollo." },
      { id: "app_guard", title: "App Gate", status: "available", detail: "Checks an app or device concern from the details you provide; installed-app inventory is not yet implemented." },
    ];
  }

  async getProtectionStatus(): Promise<ProtectionStatus> {
    const status = await invoke<HostFilterStatus>("filter_status");
    return { running: status.enabled, requested: status.enabled, operational: status.enabled, enforcementMethod: status.enabled ? "dns_filter" : "none",
      coverage: status.enabled ? `Exact-domain hosts filtering is active for ${status.blockedDomains.length} destination${status.blockedDomains.length === 1 ? "" : "s"}. It does not inspect packets or identify the originating app.` : "Desktop exact-domain filtering is available but not enabled.",
      coverageScope: status.enabled ? ["hosts:exact-domain"] : [], lastVerified: status.enabled ? new Date().toISOString() : null,
      degradedReason: status.enabled ? "Hosts/DNS scope only; WFP and Network Extension packet filtering are not claimed." : "administrator approval required",
      visibility: status.enabled ? "limited" : "none", since: null, adapterLabel: this.label, checkedAt: new Date().toISOString() };
  }
  async analyseURL(): Promise<NativeUrlAnalysis> { return { supported: false, verdict: "unknown", reasons: ["No native URL analyser on the desktop host; server-side checks are used."] }; }
  async analyseDomain(): Promise<NativeUrlAnalysis> { return { supported: false, verdict: "unknown", reasons: ["No native domain analyser on the desktop host."] }; }
  async blockDestination(host: string): Promise<BlockResult> {
    const changed = await invoke<HostFilterChange>("block_destination", { host });
    return { verified: changed.verified, method: "dns_filter", detail: `The exact domain ${changed.host} is in Apollo's administrator-approved hosts filter. This confirms the rule is live, not that a connection was observed or dropped.`, adapterLabel: this.label, blockedAt: changed.changedAt, evidence: null };
  }
  async unblockDestination(host: string): Promise<BlockResult> {
    const changed = await invoke<HostFilterChange>("unblock_destination", { host });
    return { verified: changed.verified, method: "dns_filter", detail: `The exact domain ${changed.host} was removed from Apollo's hosts filter.`, adapterLabel: this.label, blockedAt: null, evidence: null };
  }

  async getNetworkStatus(): Promise<NetworkStatus> {
    // A failed host observation propagates (the broker records it as unavailable/adapter_failed); it is never reported as "connected".
    const n = await invoke<HostNetwork>("network_status");
    return { connected: n.connected, type: n.type, isInternetReachable: null, inspectable: true, wifiSecurity: n.wifiSecurity, captivePortal: null, vpnActive: n.vpnActive, ssid: n.ssid, checkedAt: new Date().toISOString() };
  }
  async getSecuritySignals(): Promise<SecuritySignal[]> { return []; }
  async startProtection(): Promise<ProtectionStatus> { await invoke("request_permission", { args: { id: "network_filter" } }); return this.getProtectionStatus(); }
  async stopProtection(): Promise<ProtectionStatus> { await invoke("disable_filter"); return this.getProtectionStatus(); }

  async getProtectionPermissions(): Promise<ProtectionPermission[]> {
    const observedAt = new Date().toISOString();
    const rows = await invoke<HostPermission[]>("permissions");
    try {
      const notification = await import("@tauri-apps/plugin-notification");
      const granted = await notification.isPermissionGranted();
      const row = rows.find((item) => item.id === "notifications");
      if (row) { row.state = granted ? "granted" : row.requested ? "denied" : "undetermined"; row.enabled = granted; }
    } catch { /* host command remains authoritative when the notification plugin is unavailable */ }
    const titles: Record<ProtectionPermission["id"], string> = { network_filter: "Network filter service", vpn_config: "VPN configuration", accessibility: "Accessibility access", notifications: "Notifications" };
    return rows.map((r) => ({ id: r.id, title: titles[r.id], status: r.state, canAskAgain: r.state !== "denied", why: "Read from the operating system by the desktop host.",
      requested: r.requested, lastRequestedAt: r.lastRequestedAt, enabled: r.enabled, observedAt, unavailableReason: r.unavailableReason }));
  }
  async requestProtectionPermission(id: ProtectionPermission["id"]): Promise<ProtectionPermission> {
    if (id === "notifications") {
      const notification = await import("@tauri-apps/plugin-notification");
      await notification.requestPermission();
      await invoke("request_permission", { args: { id } });
    } else {
      await invoke("request_permission", { args: { id } });
    }
    return (await this.getProtectionPermissions()).find((p) => p.id === id)!;
  }
  async getPlatformCapabilityProfile(): Promise<PlatformCapabilityProfile> {
    const h = await this.host();
    const base = PLATFORM_CAPABILITY_BASELINES[h.platform];
    return { ...base, platformVersion: h.osVersion, sdkVersion: h.hostVersion,
      networkFiltering: "partial", packetVisibility: "none", dnsVisibility: "partial", processAttribution: "none", appAttribution: "none",
      domainVisibility: "partial", localBlocking: "partial", backgroundProtection: "partial", offlineProtection: "full",
      realTimeEvents: "none", scope: ["hosts:exact-domain"] };
  }
  async getEnforcementEvidence(): Promise<EnforcementEvidence[]> { return []; }
  async getDeviceProfileFacts(): Promise<DeviceProfileFacts> {
    const h = await this.host();
    return { manufacturer: h.manufacturer, model: h.model, osVersion: h.osVersion, formFactor: h.formFactor, locale: h.locale };
  }
}

export const DesktopSecurityAdapter: SecurityPlatformAdapter = new DesktopSecurityAdapterImpl();
