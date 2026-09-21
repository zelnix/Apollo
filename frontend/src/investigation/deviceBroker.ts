// Device broker: answers coordinator device requests from Apollo's own security adapter. Nothing is manufactured:
// a capability is advertised only when the adapter exposes it; the MOCK adapter is labelled as a simulation on every value.
import { Platform } from "react-native";

import { IS_MOCK_SECURITY, securityAdapter } from "@/src/security/securityAdapter";
import type { ProtectionPermission } from "@/src/security/SecurityPlatformAdapter";
import type { DeviceProfile, DeviceRequest, DeviceResult } from "./types";

export const PERMISSION_IDS: ProtectionPermission["id"][] = ["network_filter", "vpn_config", "accessibility", "notifications"];
export const CAPABILITIES = {
  protection: "protection.status", network: "network.status", signals: "security.signals",
  permission: (id: ProtectionPermission["id"]) => `permission.${id}`, openSettings: "open_settings.app",
};

const SIMULATION = IS_MOCK_SECURITY ? { kind: "preview_device" as const, label: "MOCK adapter — simulated device, not this phone", fixtureId: "mock-security-adapter" } : null;

export function currentDeviceProfile(): DeviceProfile {
  const platform = Platform.OS === "android" ? "android" : Platform.OS === "ios" ? "ios" : "web";
  const nativeAdapter = !IS_MOCK_SECURITY && platform !== "web";
  return {
    platform, manufacturer: null, model: null, osVersion: Platform.OS === "web" ? null : String(Platform.Version), locale: "en-AU",
    evidenceOrigin: nativeAdapter ? "native" : "browser",
    // Simulated capabilities are advertised only in explicit mock mode (build-time flag), never inferred from __DEV__.
    capabilityIds: nativeAdapter || IS_MOCK_SECURITY
      ? [CAPABILITIES.protection, CAPABILITIES.network, CAPABILITIES.signals, ...PERMISSION_IDS.map(CAPABILITIES.permission), ...(platform === "web" ? [] : [CAPABILITIES.openSettings])]
      : [],
  };
}

function pick(values: Record<string, string | number | boolean | string[] | null>, fields: string[]) {
  return fields.length ? Object.fromEntries(Object.entries(values).filter(([k]) => fields.includes(k))) : values;
}

/** Fresh observation for a coordinator request. Requested and granted are reported as separate facts. */
export async function observe(request: DeviceRequest): Promise<DeviceResult> {
  const base = { requestId: request.id, caseRevision: request.caseRevision, capabilityId: request.capabilityId, observedAt: new Date().toISOString(), simulation: SIMULATION };
  if (!currentDeviceProfile().capabilityIds.includes(request.capabilityId)) return { ...base, status: "unavailable", observedAt: null, values: {} };
  try {
    if (request.capabilityId === CAPABILITIES.protection) {
      const s = await securityAdapter.getProtectionStatus();
      return { ...base, status: "observed", values: pick({ running: s.running, requested: s.requested, operational: s.operational, enforcementMethod: s.enforcementMethod, coverage: s.coverage, degradedReason: s.degradedReason, visibility: String(s.visibility), lastVerified: s.lastVerified, adapterLabel: s.adapterLabel }, request.fields) };
    }
    if (request.capabilityId === CAPABILITIES.network) {
      const n = await securityAdapter.getNetworkStatus();
      return { ...base, status: "observed", values: pick({ connected: n.connected, type: n.type, internetReachable: n.isInternetReachable, inspectable: n.inspectable, wifiSecurity: n.wifiSecurity, captivePortal: n.captivePortal, vpnActive: n.vpnActive }, request.fields) };
    }
    if (request.capabilityId === CAPABILITIES.signals) {
      const signals = await securityAdapter.getSecuritySignals();
      return { ...base, status: "observed", values: pick({ count: signals.length, signals: signals.slice(0, 50).map((x) => `${x.occurredAt} ${x.severity} ${x.code}: ${x.plain}`) }, request.fields) };
    }
    if (request.capabilityId.startsWith("permission.")) {
      const id = request.capabilityId.slice("permission.".length) as ProtectionPermission["id"];
      const permission = (await securityAdapter.getProtectionPermissions()).find((p) => p.id === id);
      if (!permission) return { ...base, status: "unavailable", observedAt: null, values: {} };
      if (permission.status === "not_applicable") return { ...base, status: "unavailable", values: { status: "not_applicable" } };
      return { ...base, status: "observed", values: pick({ status: permission.status, granted: permission.status === "granted", enabled: permission.status === "granted", canAskAgain: permission.canAskAgain, requestedByApollo: true }, request.fields) };
    }
    return { ...base, status: "unavailable", observedAt: null, values: {} };
  } catch {
    return { ...base, status: "failed", observedAt: null, values: {} };
  }
}
