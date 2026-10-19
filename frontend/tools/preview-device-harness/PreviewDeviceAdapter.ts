// PreviewDeviceAdapter — DEVICE-PREVIEW HARNESS ONLY. This is the single permitted source of simulated device
// observations (spec §1A): it exists so the development *web* preview can exercise device flows the browser cannot
// observe. It is NOT part of any ordinary application build: native bundles never resolve it (hostAdapter.web.ts is
// web-only) and ordinary web builds leave EXPO_PUBLIC_DEVICE_PREVIEW_HARNESS unset, so the selection branch is dead.
// Every value it produces is labelled "MOCKED DEVICE INPUT — PREVIEW ONLY" and the device broker attaches that
// origin to every observation so Higgins, the case and reports disclose the substitution. It never verifies a block,
// never reports a real platform capability ceiling and never produces enforcement evidence.
// Gemini, research and the investigation engine remain real when this adapter is active.
import * as Network from "expo-network";

import type { Capability } from "@/src/domain/types";
import { PLATFORM_CAPABILITY_BASELINES, type EnforcementEvidence, type PlatformCapabilityProfile } from "@/src/security/PlatformCapabilityProfile";
import type {
  BlockResult, NativeUrlAnalysis, NetworkStatus, ProtectionPermission, ProtectionStatus, SecurityPlatformAdapter, SecuritySignal,
} from "@/src/security/SecurityPlatformAdapter";
import { storage } from "@/src/utils/storage";

export const PREVIEW_HARNESS_LABEL = "MOCKED DEVICE INPUT — PREVIEW ONLY";
export const PREVIEW_FIXTURE_ID = "preview-device-harness";
const PERMS_KEY = "apollo.preview.permissions";
const REQUESTS_KEY = "apollo.preview.permission_requests";

/** Fixture selected at bundle time (EXPO_PUBLIC_DEVICE_PREVIEW_FIXTURE); defaults to NORMAL. */
export type PreviewFixture = "NORMAL" | "PERMISSION_DENIED" | "BLOCK_UNVERIFIED" | "PROTECTION_UNAVAILABLE" | "OPEN_WIFI" | "CAPTIVE_PORTAL";
export const PREVIEW_FIXTURES: readonly PreviewFixture[] = ["NORMAL", "PERMISSION_DENIED", "BLOCK_UNVERIFIED", "PROTECTION_UNAVAILABLE", "OPEN_WIFI", "CAPTIVE_PORTAL"];

function fixtureFromEnv(): PreviewFixture {
  const raw = process.env.EXPO_PUBLIC_DEVICE_PREVIEW_FIXTURE;
  return PREVIEW_FIXTURES.includes(raw as PreviewFixture) ? (raw as PreviewFixture) : "NORMAL";
}

class PreviewDeviceAdapterImpl implements SecurityPlatformAdapter {
  readonly kind = "preview_harness" as const;
  readonly label = PREVIEW_HARNESS_LABEL;
  readonly fixture: PreviewFixture = fixtureFromEnv();
  private running = false;
  private since: string | null = null;
  private permissions: Record<ProtectionPermission["id"], ProtectionPermission["status"]> = {
    network_filter: "undetermined", vpn_config: "not_applicable", accessibility: "not_applicable", notifications: "undetermined",
  };
  private requests: Record<string, string> = {};
  private hydrated: Promise<void> | null = null;

  private hydrate(): Promise<void> {
    if (!this.hydrated) {
      this.hydrated = Promise.all([
        storage.getItem<string | null>(PERMS_KEY, null).then((saved) => { if (saved) this.permissions = { ...this.permissions, ...(JSON.parse(saved) as Partial<typeof this.permissions>) }; }),
        storage.getItem<string | null>(REQUESTS_KEY, null).then((saved) => { if (saved) this.requests = JSON.parse(saved) as Record<string, string>; }),
      ]).then(() => undefined).catch(() => undefined);
    }
    return this.hydrated;
  }

  async getCapabilities(): Promise<Capability[]> {
    await this.hydrate();
    const filterGranted = this.permissions.network_filter === "granted";
    const unavailable = this.fixture === "PROTECTION_UNAVAILABLE";
    const tag = ` (${PREVIEW_HARNESS_LABEL})`;
    return [
      { id: "link_guard", title: "Link Gate", status: "available", detail: "Checks links you paste or share into Apollo; it is a manual check." },
      { id: "known_threats", title: "Known Threat Lookup", status: "available", detail: "Privacy-preserving reputation checks using the link only." },
      { id: "site_guard", title: "Site Gate", status: unavailable ? "unsupported" : filterGranted ? (this.running ? "active" : "inactive") : "permission_required", detail: (unavailable ? "Simulated: this fixture cannot run a content filter." : filterGranted ? "Simulated filter state." : "Simulated: needs the network filter permission.") + tag },
      { id: "connection_guard", title: "Network Gate", status: this.running ? "active" : "available", detail: "Simulated Wi‑Fi conditions." + tag },
      { id: "share_intake", title: "Share to Apollo", status: "coming_later", detail: "Sharing from other apps needs the installed Apollo app." },
      { id: "message_guard", title: "Text Gate", status: "available", detail: "Checks texts and chats you paste, share or screenshot into Apollo." },
      { id: "app_guard", title: "App Gate", status: "available", detail: "Checks an app or device concern from the details you provide." },
    ];
  }

  async getProtectionStatus(): Promise<ProtectionStatus> {
    const caps = await this.getCapabilities();
    const active = caps.filter((c) => c.status === "active").length;
    const gaps = caps.some((c) => c.status === "permission_required" || c.status === "inactive");
    return {
      running: false, requested: this.running, operational: false, enforcementMethod: "simulated",
      coverage: `${PREVIEW_HARNESS_LABEL}: nothing is filtered or blocked on this device.`, coverageScope: [], lastVerified: null,
      degradedReason: this.running ? "Preview harness: protection is simulated and enforces nothing." : null,
      visibility: !this.running || active === 0 ? "none" : gaps ? "limited" : "full",
      since: this.since, adapterLabel: this.label, checkedAt: new Date().toISOString(),
    };
  }

  async analyseURL(): Promise<NativeUrlAnalysis> { return { supported: false, verdict: "unknown", reasons: ["No native URL analyser in the preview harness."] }; }
  async analyseDomain(): Promise<NativeUrlAnalysis> { return { supported: false, verdict: "unknown", reasons: ["No native domain analyser in the preview harness."] }; }

  async blockDestination(): Promise<BlockResult> {
    // The harness can never verify a block: nothing is enforced, so no "biting" can ever be derived from it.
    return { verified: false, method: "simulated", detail: `${PREVIEW_HARNESS_LABEL}: nothing is blocked on this device.`, adapterLabel: this.label, blockedAt: null, evidence: null };
  }
  async unblockDestination(): Promise<BlockResult> {
    return { verified: false, method: "simulated", detail: `${PREVIEW_HARNESS_LABEL}: nothing to unblock on this device.`, adapterLabel: this.label, blockedAt: null, evidence: null };
  }

  async getNetworkStatus(): Promise<NetworkStatus> {
    const checkedAt = new Date().toISOString();
    try {
      const s = await Network.getNetworkStateAsync();
      const map: Record<string, NetworkStatus["type"]> = { WIFI: "wifi", CELLULAR: "cellular", ETHERNET: "ethernet", VPN: "vpn", NONE: "none", UNKNOWN: "unknown" };
      const type = map[String(s.type)] ?? "other";
      const sim = this.fixture === "OPEN_WIFI" ? "open" : this.fixture === "CAPTIVE_PORTAL" ? "wpa" : undefined;
      return { connected: !!s.isConnected, type: sim ? "wifi" : type, isInternetReachable: s.isInternetReachable ?? null, inspectable: this.running, wifiSecurity: sim ?? (type === "wifi" ? "unknown" : "n/a"), captivePortal: this.fixture === "CAPTIVE_PORTAL" ? true : type === "wifi" ? false : null, vpnActive: type === "vpn", ssid: sim ? "Apollo-Preview-WiFi" : null, checkedAt };
    } catch {
      return { connected: true, type: "unknown", isInternetReachable: null, inspectable: false, wifiSecurity: "unknown", captivePortal: null, vpnActive: null, ssid: null, checkedAt };
    }
  }

  async getSecuritySignals(): Promise<SecuritySignal[]> { return []; }

  async startProtection(): Promise<ProtectionStatus> {
    if (this.fixture !== "PROTECTION_UNAVAILABLE") { this.running = true; this.since = new Date().toISOString(); }
    return this.getProtectionStatus();
  }
  async stopProtection(): Promise<ProtectionStatus> { this.running = false; this.since = null; return this.getProtectionStatus(); }

  async getProtectionPermissions(): Promise<ProtectionPermission[]> {
    await this.hydrate();
    const observedAt = new Date().toISOString();
    const row = (id: ProtectionPermission["id"], title: string, why: string): ProtectionPermission => ({
      id, title, status: this.permissions[id], canAskAgain: this.permissions[id] !== "blocked", why: `${why} (${PREVIEW_HARNESS_LABEL})`,
      requested: !!this.requests[id], lastRequestedAt: this.requests[id] ?? null, enabled: this.permissions[id] === "granted", observedAt, unavailableReason: null,
    });
    return [
      row("network_filter", "Network filter", "Simulated network-filter permission."),
      row("notifications", "Notifications", "Simulated notification permission."),
    ];
  }

  async requestProtectionPermission(id: ProtectionPermission["id"]): Promise<ProtectionPermission> {
    await this.hydrate();
    this.requests[id] = new Date().toISOString();
    if (this.fixture === "PERMISSION_DENIED") this.permissions[id] = this.permissions[id] === "denied" ? "blocked" : "denied";
    else this.permissions[id] = "granted";
    await Promise.all([storage.setItem(PERMS_KEY, JSON.stringify(this.permissions)), storage.setItem(REQUESTS_KEY, JSON.stringify(this.requests))]).catch(() => undefined);
    return (await this.getProtectionPermissions()).find((p) => p.id === id)!;
  }

  // Never the host OS's real ceiling: the harness provides nothing, so it reports the empty web baseline.
  async getPlatformCapabilityProfile(): Promise<PlatformCapabilityProfile> { return PLATFORM_CAPABILITY_BASELINES.web; }
  async getEnforcementEvidence(): Promise<EnforcementEvidence[]> { return []; }
}

export const PreviewDeviceAdapter = new PreviewDeviceAdapterImpl();
