// MockSecurityAdapter — DEVELOPMENT ONLY. Visibly labelled everywhere it is used.
// Simulates the native surface so the app can be built and tested before the
// Swift/Kotlin modules exist. Network status is read from expo-network (real,
// on-device) — everything else is simulated.

import * as Network from "expo-network";

import type { Capability } from "@/src/domain/types";
import type {
  BlockResult, NativeUrlAnalysis, NetworkStatus, ProtectionPermission, ProtectionStatus, SecurityPlatformAdapter, SecuritySignal,
} from "./SecurityPlatformAdapter";

export const MOCK_ADAPTER_LABEL = "MOCK adapter — simulated";

type MockScenario = "NORMAL" | "PERMISSION_DENIED" | "BLOCK_UNVERIFIED" | "PROTECTION_UNAVAILABLE";

class MockSecurityAdapterImpl implements SecurityPlatformAdapter {
  readonly kind = "mock" as const;
  readonly label = MOCK_ADAPTER_LABEL;
  private running = false;
  private since: string | null = null;
  private blocked = new Set<string>();
  private permissions: Record<ProtectionPermission["id"], ProtectionPermission["status"]> = {
    network_filter: "undetermined", vpn_config: "not_applicable", accessibility: "not_applicable", notifications: "undetermined",
  };
  scenario: MockScenario = "NORMAL";

  setScenario(s: MockScenario) { this.scenario = s; }

  async getCapabilities(): Promise<Capability[]> {
    const filterGranted = this.permissions.network_filter === "granted";
    const unavailable = this.scenario === "PROTECTION_UNAVAILABLE";
    return [
      { id: "link_guard", title: "Link Guard", status: this.running ? "active" : "available", detail: this.running ? "Checks links you paste or share into Apollo." : "Turn on protection to check links you paste or share." },
      { id: "known_threats", title: "Known Threat Lookup", status: this.running ? "active" : "available", detail: "Privacy-preserving reputation checks using the link only." },
      { id: "site_guard", title: "Site Guard", status: unavailable ? "unsupported" : filterGranted ? (this.running ? "active" : "inactive") : "permission_required", detail: unavailable ? "This device cannot run a content filter." : filterGranted ? "Warns about suspicious websites in supported browsers." : "Needs the network filter permission to see website visits." },
      { id: "connection_guard", title: "Connection Guard", status: "coming_later", detail: "Unsafe Wi‑Fi and connection checks arrive in a later release." },
      { id: "share_intake", title: "Share to Apollo", status: "coming_later", detail: "Share links from other apps straight into Apollo. Requires a native build." },
    ];
  }

  async getProtectionStatus(): Promise<ProtectionStatus> {
    const caps = await this.getCapabilities();
    const active = caps.filter((c) => c.status === "active").length;
    const gaps = caps.some((c) => c.status === "permission_required" || c.status === "inactive");
    return {
      running: this.running,
      visibility: !this.running || active === 0 ? "none" : gaps ? "limited" : "full",
      since: this.since,
      adapterLabel: this.label,
      checkedAt: new Date().toISOString(),
    };
  }

  async analyseURL(): Promise<NativeUrlAnalysis> {
    return { supported: false, verdict: "unknown", reasons: ["No native URL analyser in mock mode."] };
  }
  async analyseDomain(): Promise<NativeUrlAnalysis> {
    return { supported: false, verdict: "unknown", reasons: ["No native domain analyser in mock mode."] };
  }

  async blockDestination(host: string): Promise<BlockResult> {
    await delay(500);
    if (this.scenario === "BLOCK_UNVERIFIED") {
      return { verified: false, method: "none", detail: "Simulated: the platform could not confirm the block.", adapterLabel: this.label, blockedAt: null };
    }
    this.blocked.add(host);
    return { verified: true, method: "simulated", detail: "Simulated block confirmed by the mock adapter.", adapterLabel: this.label, blockedAt: new Date().toISOString() };
  }

  async unblockDestination(host: string): Promise<BlockResult> {
    this.blocked.delete(host);
    return { verified: true, method: "simulated", detail: "Simulated unblock.", adapterLabel: this.label, blockedAt: null };
  }

  async getNetworkStatus(): Promise<NetworkStatus> {
    try {
      const s = await Network.getNetworkStateAsync();
      const map: Record<string, NetworkStatus["type"]> = { WIFI: "wifi", CELLULAR: "cellular", ETHERNET: "ethernet", VPN: "vpn", NONE: "none", UNKNOWN: "unknown" };
      return { connected: !!s.isConnected, type: map[String(s.type)] ?? "other", isInternetReachable: s.isInternetReachable ?? null, inspectable: false, checkedAt: new Date().toISOString() };
    } catch {
      return { connected: true, type: "unknown", isInternetReachable: null, inspectable: false, checkedAt: new Date().toISOString() };
    }
  }

  async getSecuritySignals(): Promise<SecuritySignal[]> { return []; }

  async startProtection(): Promise<ProtectionStatus> {
    await delay(400);
    if (this.scenario !== "PROTECTION_UNAVAILABLE") { this.running = true; this.since = new Date().toISOString(); }
    return this.getProtectionStatus();
  }
  async stopProtection(): Promise<ProtectionStatus> {
    this.running = false; this.since = null;
    return this.getProtectionStatus();
  }

  async getProtectionPermissions(): Promise<ProtectionPermission[]> {
    return [
      { id: "network_filter", title: "Network filter", status: this.permissions.network_filter, canAskAgain: this.permissions.network_filter !== "blocked", why: "Lets Apollo see which websites are opened so it can warn you." },
      { id: "notifications", title: "Notifications", status: this.permissions.notifications, canAskAgain: true, why: "Lets Apollo tell you when it barks." },
    ];
  }

  async requestProtectionPermission(id: ProtectionPermission["id"]): Promise<ProtectionPermission> {
    await delay(300);
    if (this.scenario === "PERMISSION_DENIED") this.permissions[id] = this.permissions[id] === "denied" ? "blocked" : "denied";
    else this.permissions[id] = "granted";
    const all = await this.getProtectionPermissions();
    return all.find((p) => p.id === id)!;
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const MockSecurityAdapter = new MockSecurityAdapterImpl();
