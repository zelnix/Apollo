// Device broker: answers coordinator device requests from Apollo's own security host. Nothing is manufactured:
//  - a capability is advertised only when this host implements it (native module, browser API, or a Settings
//    destination this platform can open);
//  - `requested` (Apollo's recorded request history) and `state` (fresh OS observation) are separate facts;
//  - an unavailable observation carries its actual reason (`unavailableReason`), never an invented value;
//  - the device-preview harness is the only source of simulated inputs and is labelled on every value.
import * as Device from "expo-device";
import * as Localization from "expo-localization";
import { Platform } from "react-native";

import { IS_NATIVE_HOST, IS_PREVIEW_HARNESS, securityAdapter } from "@/src/security/securityAdapter";
import type { DeviceProfileFacts, ProtectionPermission } from "@/src/security/SecurityPlatformAdapter";
import { supportedSettingsDescriptors } from "@/src/settings/guidance";
import { EgressViolation } from "@/src/domain/privacy";
import type { DeviceProfile, DeviceRequest, DeviceResult, UnavailableReason } from "./types";

export const PERMISSION_IDS: ProtectionPermission["id"][] = ["network_filter", "vpn_config", "accessibility", "notifications"];
export const CAPABILITIES = {
  protection: "protection.status", network: "network.status", signals: "security.signals",
  permission: (id: ProtectionPermission["id"]) => `permission.${id}`,
};

const SIMULATION = IS_PREVIEW_HARNESS ? { kind: "preview_device" as const, label: "MOCKED DEVICE INPUT — PREVIEW ONLY", fixtureId: "preview-device-harness" } : null;

let nativeFacts: DeviceProfileFacts | null = null;

/** Loads the native host's device facts once (manufacturer/model/OS/form factor). Safe to call repeatedly; failures leave expo-device values. */
export async function primeDeviceFacts(): Promise<void> {
  if (nativeFacts || !IS_NATIVE_HOST || !securityAdapter.getDeviceProfileFacts) return;
  try { nativeFacts = await securityAdapter.getDeviceProfileFacts(); } catch { nativeFacts = null; }
}

function formFactor(): DeviceProfile["formFactor"] {
  if (nativeFacts?.formFactor) return nativeFacts.formFactor;
  switch (Device.deviceType) {
    case Device.DeviceType.PHONE: return "phone";
    case Device.DeviceType.TABLET: return "tablet";
    case Device.DeviceType.DESKTOP: return "desktop";
    default: return "unknown";
  }
}

export function currentDeviceProfile(): DeviceProfile {
  const platform: DeviceProfile["platform"] = Platform.OS === "android" ? "android" : Platform.OS === "ios" ? "ios"
    : securityAdapter.kind === "windows" || securityAdapter.kind === "macos" ? securityAdapter.kind : "web";
  const settings = supportedSettingsDescriptors().map((d) => d.id);
  // Observations this host implements. Web: real reachability, real protection state ("none") and the browser's own
  // notification permission. Native/preview: the full adapter surface plus this platform's Settings destinations.
  const capabilityIds = IS_NATIVE_HOST || IS_PREVIEW_HARNESS
    ? [CAPABILITIES.protection, CAPABILITIES.network, CAPABILITIES.signals, ...PERMISSION_IDS.map(CAPABILITIES.permission), ...settings]
    : [CAPABILITIES.protection, CAPABILITIES.network, CAPABILITIES.permission("notifications")];
  return {
    platform,
    manufacturer: IS_NATIVE_HOST ? nativeFacts?.manufacturer ?? Device.manufacturer ?? null : null,
    model: IS_NATIVE_HOST ? nativeFacts?.model ?? Device.modelName ?? null : null,
    osVersion: IS_NATIVE_HOST ? nativeFacts?.osVersion ?? (Platform.OS === "web" ? null : `${Device.osName ?? Platform.OS} ${Device.osVersion ?? String(Platform.Version)}`.trim()) : null,
    formFactor: IS_NATIVE_HOST ? formFactor() : "unknown",
    locale: nativeFacts?.locale ?? Localization.getLocales()[0]?.languageTag ?? "en-AU",
    evidenceOrigin: IS_NATIVE_HOST ? "native" : "browser",
    capabilityIds,
  };
}

function pick(values: Record<string, string | number | boolean | string[] | null>, fields: string[]) {
  return fields.length ? Object.fromEntries(Object.entries(values).filter(([k]) => fields.includes(k))) : values;
}

function unavailable(base: Omit<DeviceResult, "status" | "values" | "unavailableReason">, reason: UnavailableReason, values: DeviceResult["values"] = {}): DeviceResult {
  return { ...base, status: "unavailable", observedAt: null, values, unavailableReason: reason };
}

/** Fresh observation for a coordinator request. Requested and granted are reported as separate facts. */
export async function observe(request: DeviceRequest): Promise<DeviceResult> {
  const base = { requestId: request.id, caseRevision: request.caseRevision, capabilityId: request.capabilityId, observedAt: new Date().toISOString(), simulation: SIMULATION };
  if (!currentDeviceProfile().capabilityIds.includes(request.capabilityId)) return unavailable(base, IS_NATIVE_HOST ? "not_implemented" : "os_restricted");
  try {
    if (request.capabilityId === CAPABILITIES.protection) {
      const s = await securityAdapter.getProtectionStatus();
      return { ...base, status: "observed", unavailableReason: null, values: pick({ running: s.running, requested: s.requested, operational: s.operational, enforcementMethod: s.enforcementMethod, coverage: s.coverage, degradedReason: s.degradedReason, visibility: String(s.visibility), lastVerified: s.lastVerified, adapterLabel: s.adapterLabel }, request.fields) };
    }
    if (request.capabilityId === CAPABILITIES.network) {
      const n = await securityAdapter.getNetworkStatus();
      return { ...base, status: "observed", unavailableReason: null, values: pick({ connected: n.connected, type: n.type, internetReachable: n.isInternetReachable, inspectable: n.inspectable, wifiSecurity: n.wifiSecurity, captivePortal: n.captivePortal, vpnActive: n.vpnActive }, request.fields) };
    }
    if (request.capabilityId === CAPABILITIES.signals) {
      const signals = await securityAdapter.getSecuritySignals();
      return { ...base, status: "observed", unavailableReason: null, values: pick({ count: signals.length, signals: signals.slice(0, 50).map((x) => `${x.occurredAt} ${x.severity} ${x.code}: ${x.plain}`) }, request.fields) };
    }
    if (request.capabilityId.startsWith("permission.")) {
      const id = request.capabilityId.slice("permission.".length) as ProtectionPermission["id"];
      const permission = (await securityAdapter.getProtectionPermissions()).find((p) => p.id === id);
      if (!permission) return unavailable(base, "not_implemented");
      if (permission.status === "not_applicable" || permission.status === "unavailable") {
        return unavailable(base, permission.unavailableReason ?? "os_restricted", { status: permission.status, requested: permission.requested ?? null, lastRequestedAt: permission.lastRequestedAt ?? null });
      }
      const state = permission.status === "blocked" ? "denied" : permission.status;
      return {
        ...base, status: state === "denied" ? "denied" : state === "undetermined" ? "permission_required" : "observed", unavailableReason: null,
        values: pick({
          status: permission.status, state, granted: permission.status === "granted",
          enabled: permission.enabled ?? (permission.status === "granted"), canAskAgain: permission.canAskAgain,
          requested: permission.requested ?? null, lastRequestedAt: permission.lastRequestedAt ?? null, permissionObservedAt: permission.observedAt ?? base.observedAt,
        }, request.fields),
      };
    }
    if (request.capabilityId.startsWith("open_settings.")) {
      // Opening Settings is an action, not an observation; the case engine asks for it through an ActionProposal.
      return unavailable(base, "not_implemented", { note: "Settings destinations are executed as actions after a user gesture, not observed." });
    }
    return unavailable(base, "not_implemented");
  } catch (e: unknown) {
    if (e instanceof EgressViolation) return { ...base, status: "failed", observedAt: null, values: { error: "Apollo's privacy boundary prohibited this observation." }, unavailableReason: "privacy_prohibited" };
    return { ...base, status: "failed", observedAt: null, values: { error: e instanceof Error ? e.message : "adapter failure" }, unavailableReason: "adapter_failed" };
  }
}
