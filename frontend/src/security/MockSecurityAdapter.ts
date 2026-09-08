// MockSecurityAdapter — DEVELOPMENT ONLY. Visibly labelled everywhere it is used.
// Simulates the native surface so the app can be built and tested before the
// Swift/Kotlin modules exist. Network status is read from expo-network (real,
// on-device) — everything else is simulated.

import * as Network from "expo-network";
import { Platform } from "react-native";

import type { Capability } from "@/src/domain/types";
import { storage } from "@/src/utils/storage";
import { PLATFORM_CAPABILITY_BASELINES, type EnforcementEvidence, type PlatformCapabilityProfile } from "./PlatformCapabilityProfile";
import type {
  BlockResult, NativeUrlAnalysis, NetworkStatus, ProtectionPermission, ProtectionStatus, SecurityPlatformAdapter, SecuritySignal,
} from "./SecurityPlatformAdapter";

export const MOCK_ADAPTER_LABEL = "MOCK adapter — simulated";
const PERMS_KEY = "apollo.mock.permissions";

type MockScenario = "NORMAL" | "PERMISSION_DENIED" | "BLOCK_UNVERIFIED" | "PROTECTION_UNAVAILABLE" | "OPEN_WIFI" | "CAPTIVE_PORTAL";

class MockSecurityAdapterImpl implements SecurityPlatformAdapter {
  readonly kind = "mock" as const;
  readonly label = MOCK_ADAPTER_LABEL;
  private running = false;
  private since: string | null = null;
  private blocked = new Set<string>();
  private permissions: Record<ProtectionPermission["id"], ProtectionPermission["status"]> = {
    network_filter: "undetermined", vpn_config: "not_applicable", accessibility: "not_applicable", notifications: "undetermined",
  };
  private hydrated: Promise<void> | null = null;
  /** Permission grants survive reloads (like a real OS grant would); everything else stays simulated per session. */
  private hydrate(): Promise<void> {
    if (!this.hydrated) {
      this.hydrated = storage.getItem<string | null>(PERMS_KEY, null)
        .then((saved) => { if (saved) this.permissions = { ...this.permissions, ...(JSON.parse(saved) as Partial<typeof this.permissions>) }; })
        .catch(() => undefined);
    }
    return this.hydrated;
  }
  scenario: MockScenario = "NORMAL";

  setScenario(s: MockScenario) { this.scenario = s; }

  async getCapabilities(): Promise<Capability[]> {
    await this.hydrate();
    const filterGranted = this.permissions.network_filter === "granted";
    const unavailable = this.scenario === "PROTECTION_UNAVAILABLE";
    return [
      { id: "link_guard", title: "Link Guard", status: this.running ? "active" : "available", detail: this.running ? "Checks links you paste or share into Apollo." : "Turn on protection to check links you paste or share." },
      { id: "known_threats", title: "Known Threat Lookup", status: this.running ? "active" : "available", detail: "Privacy-preserving reputation checks using the link only." },
      { id: "site_guard", title: "Site Guard", status: unavailable ? "unsupported" : filterGranted ? (this.running ? "active" : "inactive") : "permission_required", detail: unavailable ? "This device cannot run a content filter." : filterGranted ? "Warns about suspicious websites in supported browsers." : "Needs the network filter permission to see website visits." },
      { id: "connection_guard", title: "Connection Guard", status: this.running ? "active" : "available", detail: this.running ? "Warns about open or captive Wi‑Fi (simulated in mock mode)." : "Turn on protection to assess Wi‑Fi connections." },
      { id: "share_intake", title: "Share to Apollo", status: Platform.OS === "web" ? "coming_later" : "available", detail: Platform.OS === "web" ? "Share links, messages, emails, screenshots and files from other apps straight into the right Apollo check. Needs the native build (share sheet); on this preview use the Shared-with-Apollo screen via the apollo://share link." : "Share links, messages, emails, screenshots and files from other apps: Share → Apollo. Apollo works out which check fits and lets you switch." },
      { id: "message_guard", title: "Message Guard", status: this.running ? "active" : "available", detail: "Checks texts and chats you paste, share or screenshot into Apollo. Apollo never reads your messages automatically — the operating system doesn't allow it, and Apollo won't pretend otherwise." },
      { id: "app_guard", title: "App & Device Guard", status: this.running ? "active" : "available", detail: "Check This App and Check My Device work from what you tell Apollo. Automatic install monitoring, permission reading and app-to-network correlation need the native Security SDK (Android); iOS never exposes other apps' permissions." },
    ];
  }

  async getProtectionStatus(): Promise<ProtectionStatus> {
    const caps = await this.getCapabilities();
    const active = caps.filter((c) => c.status === "active").length;
    const gaps = caps.some((c) => c.status === "permission_required" || c.status === "inactive");
    // Mock = preview fixtures only. It is never "operational": nothing on this device is enforced.
    return {
      running: false,
      requested: this.running,
      operational: false,
      enforcementMethod: "simulated",
      coverage: "Demo data only — nothing is filtered or blocked on this device.",
      coverageScope: [],
      lastVerified: null,
      degradedReason: this.running ? "Mock adapter: protection is simulated for the preview and enforces nothing." : null,
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
      return { verified: false, method: "none", detail: "Simulated: the platform could not confirm the block.", adapterLabel: this.label, blockedAt: null, evidence: null };
    }
    // A mock can never verify a block — that would let the preview say "Apollo is biting" with nothing enforced.
    this.blocked.add(host);
    return { verified: false, method: "none", detail: "Mock adapter (demo): nothing is blocked on this device. Native builds enforce with the DNS filter or Safari content blocker.", adapterLabel: this.label, blockedAt: null, evidence: null };
  }

  async unblockDestination(host: string): Promise<BlockResult> {
    this.blocked.delete(host);
    return { verified: false, method: "none", detail: "Mock adapter (demo): nothing to unblock on this device.", adapterLabel: this.label, blockedAt: null, evidence: null };
  }

  async getNetworkStatus(): Promise<NetworkStatus> {
    try {
      const s = await Network.getNetworkStateAsync();
      const map: Record<string, NetworkStatus["type"]> = { WIFI: "wifi", CELLULAR: "cellular", ETHERNET: "ethernet", VPN: "vpn", NONE: "none", UNKNOWN: "unknown" };
      const type = map[String(s.type)] ?? "other";
      const sim = this.scenario === "OPEN_WIFI" ? "open" : this.scenario === "CAPTIVE_PORTAL" ? "wpa" : undefined;
      return { connected: !!s.isConnected, type: sim ? "wifi" : type, isInternetReachable: s.isInternetReachable ?? null, inspectable: this.running, wifiSecurity: sim ?? (type === "wifi" ? "unknown" : "n/a"), captivePortal: this.scenario === "CAPTIVE_PORTAL" ? true : type === "wifi" ? false : null, vpnActive: type === "vpn", ssid: sim || type === "wifi" ? "Apollo-Mock-WiFi" : null, checkedAt: new Date().toISOString() };
    } catch {
      return { connected: true, type: "unknown", isInternetReachable: null, inspectable: false, wifiSecurity: "unknown", captivePortal: null, vpnActive: null, ssid: null, checkedAt: new Date().toISOString() };
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
    await this.hydrate();
    return [
      { id: "network_filter", title: "Network filter", status: this.permissions.network_filter, canAskAgain: this.permissions.network_filter !== "blocked", why: "Lets Apollo see which websites are opened so it can warn you." },
      { id: "notifications", title: "Notifications", status: this.permissions.notifications, canAskAgain: true, why: "Lets Apollo tell you when it barks." },
    ];
  }

  async requestProtectionPermission(id: ProtectionPermission["id"]): Promise<ProtectionPermission> {
    await delay(300);
    await this.hydrate();
    if (this.scenario === "PERMISSION_DENIED") this.permissions[id] = this.permissions[id] === "denied" ? "blocked" : "denied";
    else this.permissions[id] = "granted";
    await storage.setItem(PERMS_KEY, JSON.stringify(this.permissions)).catch(() => undefined);
    const all = await this.getProtectionPermissions();
    return all.find((p) => p.id === id)!;
  }

  // Mock always reports the "mock" baseline (every field "none"), NEVER the host OS's real
  // baseline, even though this may be running on a real iOS/Android device in Expo Go —
  // reporting a real platform's ceiling here would overclaim a capability nothing here provides.
  async getPlatformCapabilityProfile(): Promise<PlatformCapabilityProfile> {
    return PLATFORM_CAPABILITY_BASELINES.mock;
  }

  // Mock never enforces anything, on any device, ever — so it never has evidence to show.
  async getEnforcementEvidence(): Promise<EnforcementEvidence[]> {
    return [];
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const MockSecurityAdapter = new MockSecurityAdapterImpl();
