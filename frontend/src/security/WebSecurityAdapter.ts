// WebSecurityAdapter — the REAL browser host. Nothing here is simulated: the browser genuinely cannot run a
// network filter, read Wi‑Fi security or observe other apps, and every such capability is reported unavailable
// with its actual reason. Network reachability comes from expo-network (real), notifications from the browser's
// own Notification permission (real). Manual checks (links, texts, files, apps) are real backend investigations.
import * as Network from "expo-network";

import type { Capability } from "@/src/domain/types";
import { storage } from "@/src/utils/storage";
import { PLATFORM_CAPABILITY_BASELINES, type EnforcementEvidence, type PlatformCapabilityProfile } from "./PlatformCapabilityProfile";
import type {
  BlockResult, NativeUrlAnalysis, NetworkStatus, ProtectionPermission, ProtectionStatus, SecurityPlatformAdapter, SecuritySignal,
} from "./SecurityPlatformAdapter";

export const WEB_ADAPTER_LABEL = "Browser — no native protection on this device";
const REQUESTS_KEY = "apollo.web.permission_requests";

type BrowserNotificationApi = { permission: "granted" | "denied" | "default"; requestPermission(): Promise<"granted" | "denied" | "default"> };

function browserNotifications(): BrowserNotificationApi | null {
  const api = (globalThis as { Notification?: BrowserNotificationApi }).Notification;
  return api && typeof api.requestPermission === "function" ? api : null;
}

class WebSecurityAdapterImpl implements SecurityPlatformAdapter {
  readonly kind = "web" as const;
  readonly label = WEB_ADAPTER_LABEL;

  private async requests(): Promise<Record<string, string>> {
    const raw = await storage.getItem<string | null>(REQUESTS_KEY, null).catch(() => null);
    try { return raw ? (JSON.parse(raw) as Record<string, string>) : {}; } catch { return {}; }
  }

  async getCapabilities(): Promise<Capability[]> {
    return [
      { id: "link_guard", title: "Link Gate", status: "available", detail: "Checks links you paste into Apollo; it is a manual check." },
      { id: "known_threats", title: "Known Threat Lookup", status: "available", detail: "Privacy-preserving reputation checks using the link only." },
      { id: "site_guard", title: "Site Gate", status: "unsupported", detail: "A browser cannot run a website filter for this device. Install the Apollo app to enable Site Gate." },
      { id: "connection_guard", title: "Network Gate", status: "unsupported", detail: "Browsers do not expose Wi‑Fi security or captive-portal details. Network details you describe can still be investigated." },
      { id: "share_intake", title: "Share to Apollo", status: "coming_later", detail: "Sharing from other apps needs the installed Apollo app. In the browser, use the Shared-with-Apollo screen via the apollo://share link." },
      { id: "message_guard", title: "Text Gate", status: "available", detail: "Checks texts and chats you paste or screenshot into Apollo. Automatic access is never assumed." },
      { id: "app_guard", title: "App Gate", status: "available", detail: "Checks an app or device concern from the details you provide; the browser cannot read installed apps." },
    ];
  }

  async getProtectionStatus(): Promise<ProtectionStatus> {
    return {
      running: false, requested: false, operational: false, enforcementMethod: "none",
      coverage: "This browser build cannot filter or block anything on this device. Manual checks and Higgins are fully real.",
      coverageScope: [], lastVerified: null,
      degradedReason: "Browsers provide no network-filter or content-blocker mechanism to Apollo.",
      visibility: "none", since: null, adapterLabel: this.label, checkedAt: new Date().toISOString(),
    };
  }

  async analyseURL(): Promise<NativeUrlAnalysis> { return { supported: false, verdict: "unknown", reasons: ["No native URL analyser in a browser; Apollo's server-side link checks are used instead."] }; }
  async analyseDomain(): Promise<NativeUrlAnalysis> { return { supported: false, verdict: "unknown", reasons: ["No native domain analyser in a browser."] }; }

  async blockDestination(): Promise<BlockResult> {
    return { verified: false, method: "none", detail: "A browser cannot block destinations for this device. Nothing was blocked.", adapterLabel: this.label, blockedAt: null, evidence: null };
  }
  async unblockDestination(): Promise<BlockResult> {
    return { verified: false, method: "none", detail: "Nothing was blocked in the browser, so nothing was unblocked.", adapterLabel: this.label, blockedAt: null, evidence: null };
  }

  async getNetworkStatus(): Promise<NetworkStatus> {
    const checkedAt = new Date().toISOString();
    try {
      const s = await Network.getNetworkStateAsync();
      const map: Record<string, NetworkStatus["type"]> = { WIFI: "wifi", CELLULAR: "cellular", ETHERNET: "ethernet", VPN: "vpn", NONE: "none", UNKNOWN: "unknown" };
      const type = map[String(s.type)] ?? "other";
      return { connected: !!s.isConnected, type, isInternetReachable: s.isInternetReachable ?? null, inspectable: false, wifiSecurity: type === "wifi" ? "unknown" : "n/a", captivePortal: null, vpnActive: type === "vpn" ? true : null, ssid: null, checkedAt };
    } catch {
      return { connected: true, type: "unknown", isInternetReachable: null, inspectable: false, wifiSecurity: "unknown", captivePortal: null, vpnActive: null, ssid: null, checkedAt };
    }
  }

  async getSecuritySignals(): Promise<SecuritySignal[]> { return []; }

  // A browser cannot start protection. The request is not recorded as intent because nothing could honour it.
  async startProtection(): Promise<ProtectionStatus> { return this.getProtectionStatus(); }
  async stopProtection(): Promise<ProtectionStatus> { return this.getProtectionStatus(); }

  async getProtectionPermissions(): Promise<ProtectionPermission[]> {
    const observedAt = new Date().toISOString();
    const requests = await this.requests();
    const api = browserNotifications();
    const notifications: ProtectionPermission = api
      ? { id: "notifications", title: "Browser notifications", status: api.permission === "granted" ? "granted" : api.permission === "denied" ? "denied" : "undetermined", canAskAgain: api.permission !== "denied", why: "Lets this browser show Apollo alerts while the page is open.", requested: !!requests.notifications, lastRequestedAt: requests.notifications ?? null, enabled: api.permission === "granted", observedAt, unavailableReason: null }
      : { id: "notifications", title: "Browser notifications", status: "unavailable", canAskAgain: false, why: "This browser exposes no notification permission API.", requested: !!requests.notifications, lastRequestedAt: requests.notifications ?? null, enabled: null, observedAt, unavailableReason: "os_restricted" };
    const restricted = (id: ProtectionPermission["id"], title: string, why: string): ProtectionPermission =>
      ({ id, title, status: "not_applicable", canAskAgain: false, why, requested: null, lastRequestedAt: null, enabled: null, observedAt, unavailableReason: "os_restricted" });
    return [
      restricted("network_filter", "Network filter", "Browsers cannot host a network filter."),
      restricted("vpn_config", "Local VPN", "Browsers cannot configure a VPN."),
      restricted("accessibility", "Accessibility service", "Browsers expose no accessibility-service permission to web pages."),
      notifications,
    ];
  }

  async requestProtectionPermission(id: ProtectionPermission["id"]): Promise<ProtectionPermission> {
    const requests = await this.requests();
    requests[id] = new Date().toISOString();
    await storage.setItem(REQUESTS_KEY, JSON.stringify(requests)).catch(() => undefined);
    if (id === "notifications") {
      const api = browserNotifications();
      if (api && api.permission === "default") await api.requestPermission().catch(() => undefined);
    }
    return (await this.getProtectionPermissions()).find((p) => p.id === id)!;
  }

  async getPlatformCapabilityProfile(): Promise<PlatformCapabilityProfile> { return PLATFORM_CAPABILITY_BASELINES.web; }
  async getEnforcementEvidence(): Promise<EnforcementEvidence[]> { return []; }
}

export const WebSecurityAdapter: SecurityPlatformAdapter = new WebSecurityAdapterImpl();
