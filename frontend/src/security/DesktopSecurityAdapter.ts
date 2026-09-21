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

class DesktopSecurityAdapterImpl implements SecurityPlatformAdapter {
  // Explicit host identity: Higgins receives platform "windows"/"macos" with native-origin facts, not a browser profile.
  readonly kind: "windows" | "macos" = desktopHostKind() ?? "windows";
  readonly label = `Apollo desktop host (${desktopHostKind() === "macos" ? "macOS" : "Windows"}) — filtering not yet implemented`;
  private info: HostInfo | null = null;

  private async host(): Promise<HostInfo> { return this.info ?? (this.info = await invoke<HostInfo>("host_info")); }

  async getCapabilities(): Promise<Capability[]> {
    const h = await this.host();
    const filterDetail = h.platform === "windows"
      ? "Windows Filtering Platform driver/service not yet implemented in this build (not an OS limitation)."
      : "macOS Network Extension (content filter) not yet implemented in this build (not an OS limitation).";
    return [
      { id: "link_guard", title: "Link Gate", status: "available", detail: "Checks links you paste into Apollo; it is a manual check." },
      { id: "known_threats", title: "Known Threat Lookup", status: "available", detail: "Privacy-preserving reputation checks using the link only." },
      { id: "site_guard", title: "Site Gate", status: "unsupported", detail: filterDetail },
      { id: "connection_guard", title: "Network Gate", status: "available", detail: "Reads the active network interface and VPN state from the OS." },
      { id: "share_intake", title: "Open with Apollo", status: "available", detail: "Open or drop files into Apollo for File Gate." },
      { id: "message_guard", title: "Text Gate", status: "available", detail: "Checks texts and chats you paste or screenshot into Apollo." },
      { id: "app_guard", title: "App Gate", status: "available", detail: "Checks an app or device concern from the details you provide; installed-app inventory is not yet implemented." },
    ];
  }

  async getProtectionStatus(): Promise<ProtectionStatus> {
    return { running: false, requested: false, operational: false, enforcementMethod: "none",
      coverage: "The desktop host cannot filter or block network traffic yet: the native filtering service is not implemented in this build.",
      coverageScope: [], lastVerified: null, degradedReason: "not_implemented: desktop filtering service", visibility: "none", since: null, adapterLabel: this.label, checkedAt: new Date().toISOString() };
  }
  async analyseURL(): Promise<NativeUrlAnalysis> { return { supported: false, verdict: "unknown", reasons: ["No native URL analyser on the desktop host; server-side checks are used."] }; }
  async analyseDomain(): Promise<NativeUrlAnalysis> { return { supported: false, verdict: "unknown", reasons: ["No native domain analyser on the desktop host."] }; }
  async blockDestination(): Promise<BlockResult> { return { verified: false, method: "none", detail: "Desktop filtering is not implemented in this build; nothing was blocked.", adapterLabel: this.label, blockedAt: null, evidence: null }; }
  async unblockDestination(): Promise<BlockResult> { return { verified: false, method: "none", detail: "Nothing was blocked, so nothing was unblocked.", adapterLabel: this.label, blockedAt: null, evidence: null }; }

  async getNetworkStatus(): Promise<NetworkStatus> {
    // A failed host observation propagates (the broker records it as unavailable/adapter_failed); it is never reported as "connected".
    const n = await invoke<HostNetwork>("network_status");
    return { connected: n.connected, type: n.type, isInternetReachable: null, inspectable: true, wifiSecurity: n.wifiSecurity, captivePortal: null, vpnActive: n.vpnActive, ssid: n.ssid, checkedAt: new Date().toISOString() };
  }
  async getSecuritySignals(): Promise<SecuritySignal[]> { return []; }
  async startProtection(): Promise<ProtectionStatus> { return this.getProtectionStatus(); }
  async stopProtection(): Promise<ProtectionStatus> { return this.getProtectionStatus(); }

  async getProtectionPermissions(): Promise<ProtectionPermission[]> {
    const observedAt = new Date().toISOString();
    const rows = await invoke<HostPermission[]>("permissions");
    const titles: Record<ProtectionPermission["id"], string> = { network_filter: "Network filter service", vpn_config: "VPN configuration", accessibility: "Accessibility access", notifications: "Notifications" };
    return rows.map((r) => ({ id: r.id, title: titles[r.id], status: r.state, canAskAgain: r.state !== "denied", why: "Read from the operating system by the desktop host.",
      requested: r.requested, lastRequestedAt: r.lastRequestedAt, enabled: r.enabled, observedAt, unavailableReason: r.unavailableReason }));
  }
  async requestProtectionPermission(id: ProtectionPermission["id"]): Promise<ProtectionPermission> {
    await invoke("request_permission", { id });
    return (await this.getProtectionPermissions()).find((p) => p.id === id)!;
  }
  async getPlatformCapabilityProfile(): Promise<PlatformCapabilityProfile> {
    const h = await this.host();
    // The deployed host has NO filtering yet; report the empty baseline, never the OS ceiling documented for a future adapter.
    return { ...PLATFORM_CAPABILITY_BASELINES.web, platform: h.platform, platformVersion: h.osVersion, sdkVersion: h.hostVersion };
  }
  async getEnforcementEvidence(): Promise<EnforcementEvidence[]> { return []; }
  async getDeviceProfileFacts(): Promise<DeviceProfileFacts> {
    const h = await this.host();
    return { manufacturer: h.manufacturer, model: h.model, osVersion: h.osVersion, formFactor: h.formFactor, locale: h.locale };
  }
}

export const DesktopSecurityAdapter: SecurityPlatformAdapter = new DesktopSecurityAdapterImpl();
