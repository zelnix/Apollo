// One reader for this device's protection and capability state, shared by the Device Protections screen, the
// shareable report, and the live reading Higgins gets with every question — so all three can never
// disagree about what Apollo can and cannot do here.
//
// Every read is real. A failure stays a failure (`null` → "Apollo couldn't tell"); it is never
// flattened into "nothing found". A host with no native module (browser preview) is reported as
// exactly that, which is a different fact from a failed read.
//
// Three reads, all of them existing ones:
//   • capability statuses      → AppDeviceSdk.getAppDeviceCapabilities()
//   • provider protections     → detectNativeProtection()
//   • OS/OEM security settings → readDeviceSettingsSnapshot() + getDeviceSecuritySignals()
// The third feeds the Device Security Catalogue, which interprets it; nothing here infers a state.

import { Platform } from "react-native";
import * as Device from "expo-device";
import * as Localization from "expo-localization";

import { buildDeviceCapabilities, type CapabilityPlatform, type DeviceCapabilityView, type DeviceFacts, type NativeProtectionRead } from "@/src/domain/deviceCapabilities";
import { EMPTY_SECURITY_READ, type SecurityStateRead } from "@/src/domain/deviceSecurityCatalogue";
import { AppDeviceSdk, type AppDeviceCapabilities } from "@/src/security/appDeviceSdk";
import { pickerDeclaredByBuild } from "@/src/security/phonePickers";
import { detectNativeProtection } from "@/src/security/nativeProtectionEvidence";
import { getNativeModule } from "@/src/security/nativeBridge";
import { desktopHostKind } from "@/src/security/desktopHost";
import { readDeviceSettingsSnapshot } from "@/src/security/devicePosture";
import { securityAdapter } from "@/src/security/securityAdapter";
import { regionCountry } from "@/src/telemetry/deviceInfo";
import type { DeviceSignals } from "@/src/domain/deviceAnalysis";
import { privateDnsMode } from "@/src/domain/privateDnsAdvice";
import type { PrivateDnsStatus } from "@/src/domain/types";

export interface DeviceCapabilityReading {
  view: DeviceCapabilityView;
  /** False when Apollo isn't running on the device itself (browser preview). */
  hasNativeHost: boolean;
  capsReadFailed: boolean;
  nativeReadFailed: boolean;
  /** True when no OS/OEM settings read answered at all — those rows stay "can't verify". */
  securityReadFailed: boolean;
  /** The raw settings facts the rows were built from — used to describe exactly what changed between checks. */
  security: SecurityStateRead | null;
  readAt: string;
}

const FRESH_FOR_MS = 60_000;
let cached: DeviceCapabilityReading | null = null;
let inFlight: Promise<DeviceCapabilityReading> | null = null;

export function capabilityPlatform(): CapabilityPlatform {
  if (Platform.OS === "android") return "android";
  if (Platform.OS === "ios") return "ios";
  return desktopHostKind() ?? "web";
}

/** Android's own settings snapshot and the cross-platform signals, mapped into the catalogue's input. */
function toSecurityRead(
  posture: Awaited<ReturnType<typeof readDeviceSettingsSnapshot>>,
  signals: DeviceSignals | null,
  dns: PrivateDnsStatus | null,
): SecurityStateRead {
  // "unobservable" is not "off" — only a real reading becomes a state.
  const dnsRead = dns && dns.bypassLevel !== "unobservable" ? dns : null;
  const dnsMode = dnsRead ? privateDnsMode(dnsRead) : null;
  return {
    ...EMPTY_SECURITY_READ,
    screenLockSecure: posture?.screenLockSecure ?? signals?.screenLockSecure ?? null,
    biometricStatus: posture?.biometricStatus ?? null,
    developerOptions: posture?.developerOptionsEnabled ?? signals?.developerOptions ?? null,
    usbDebugging: posture?.usbDebuggingEnabled ?? null,
    unknownSources: posture?.unknownSourcesEnabled ?? signals?.unknownSourcesEnabled ?? null,
    securityPatch: posture?.securityPatch && posture.securityPatch !== "unknown" ? posture.securityPatch : (signals?.securityPatchDate ?? null),
    osVersion: signals?.osVersion ?? null,
    deviceAdmins: posture?.deviceAdmins ?? signals?.managementAdmins ?? null,
    // -1 from the native read means "couldn't read" — the catalogue keeps that unknown.
    userCertificateCount: posture?.userCertificateCount ?? signals?.userTrustedCertificates ?? null,
    rootIndicators: posture?.rootIndicators ?? signals?.systemIntegrity?.indicators ?? null,
    privateDnsActive: dnsRead ? dnsRead.privateDnsActive : null,
    privateDnsMode: dnsMode === "unknown" || dnsMode === "unsupported" ? null : dnsMode,
    privateDnsHost: dnsRead?.privateDnsServer ?? null,
    accessibilityServices: posture?.accessibilityServices ?? null,
    notificationListeners: posture?.notificationListeners ?? null,
    otherVpnActive: posture ? posture.otherVpnActive : null,
    osUpdatesCurrent: signals?.osUpdatesCurrent ?? null,
    antivirusEnabled: signals?.antivirusEnabled ?? null,
    systemProtections: signals?.systemIntegrity?.protections ?? null,
    osThreatReport: signals?.osThreatReport
      ? { source: signals.osThreatReport.source, status: signals.osThreatReport.status, protectionOff: signals.osThreatReport.protectionOff ?? null }
      : null,
  };
}

/** Maker, OS version, model and region-setting country as the OS reports them — never guessed. */
export function deviceFacts(): DeviceFacts {
  const maker = Device.manufacturer ?? (Platform.OS === "ios" ? "Apple" : null);
  return {
    manufacturer: maker ? maker.toLowerCase() : null, osVersion: Device.osVersion ?? null, model: Device.modelName ?? null,
    country: regionCountry(Localization.getLocales()[0]?.regionCode) ?? null,
  };
}

async function read(): Promise<DeviceCapabilityReading> {
  const platform = capabilityPlatform();
  // A desktop host (the Tauri shell) is the device itself, even though Platform.OS is "web" there.
  const hasNativeHost = (Platform.OS !== "web" && !!getNativeModule()) || !!desktopHostKind();
  if (!hasNativeHost) {
    return {
      view: buildDeviceCapabilities({ platform, caps: null, native: null, hostIsDevice: false }),
      hasNativeHost: false, capsReadFailed: false, nativeReadFailed: false, securityReadFailed: false, security: null,
      readAt: new Date().toISOString(),
    };
  }
  const [capsResult, nativeResult, postureResult, signalsResult, dnsResult] = await Promise.allSettled([
    AppDeviceSdk.getAppDeviceCapabilities(),
    detectNativeProtection(),
    readDeviceSettingsSnapshot(),
    // Phones answer through the Expo module; Windows/macOS answer through the desktop host's audit.
    desktopHostKind()
      ? (securityAdapter.getDeviceSecuritySignals?.() ?? Promise.resolve(null))
      : AppDeviceSdk.getDeviceSecuritySignals(Platform.OS === "ios" ? "ios" : "android"),
    securityAdapter.getPrivateDnsStatus ? securityAdapter.getPrivateDnsStatus() : Promise.resolve(null),
  ]);
  const caps: AppDeviceCapabilities | null = capsResult.status === "fulfilled" ? capsResult.value : null;
  const native: NativeProtectionRead | null = nativeResult.status === "fulfilled" ? nativeResult.value : null;
  const posture = postureResult.status === "fulfilled" ? postureResult.value : null;
  const signals = signalsResult.status === "fulfilled" ? signalsResult.value : null;
  const dns = dnsResult.status === "fulfilled" ? dnsResult.value : null;

  const security = toSecurityRead(posture, signals, dns);
  return {
    view: buildDeviceCapabilities({ platform, caps, native, device: deviceFacts(), security, restrictedPickers: { callLog: pickerDeclaredByBuild("call_log"), sms: pickerDeclaredByBuild("sms") } }),
    security,
    hasNativeHost: true,
    capsReadFailed: caps === null,
    nativeReadFailed: native === null,
    securityReadFailed: posture === null && signals === null,
    readAt: new Date().toISOString(),
  };
}

/** Current capability reading. Cached briefly so a Higgins question doesn't re-run native reads. */
export async function readDeviceCapabilityState(force = false): Promise<DeviceCapabilityReading> {
  if (!force && cached && Date.now() - Date.parse(cached.readAt) < FRESH_FOR_MS) return cached;
  if (!force && inFlight) return inFlight;
  inFlight = read().then((value) => { cached = value; inFlight = null; return value; }, (error) => { inFlight = null; throw error; });
  return inFlight;
}
