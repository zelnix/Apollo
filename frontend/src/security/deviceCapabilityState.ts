// One reader for this device's capability state, shared by the Device Capabilities screen, the
// shareable report, and the live reading Higgins gets with every question — so all three can never
// disagree about what Apollo can and cannot do here.
//
// Both reads are real. A failure stays a failure (`null` → "Apollo couldn't tell"); it is never
// flattened into "nothing found". A host with no native module (browser preview) is reported as
// exactly that, which is a different fact from a failed read.

import { Platform } from "react-native";

import { buildDeviceCapabilities, type CapabilityPlatform, type DeviceCapabilityView, type NativeProtectionRead } from "@/src/domain/deviceCapabilities";
import { AppDeviceSdk, type AppDeviceCapabilities } from "@/src/security/appDeviceSdk";
import { detectNativeProtection } from "@/src/security/nativeProtectionEvidence";
import { getNativeModule } from "@/src/security/nativeBridge";
import { desktopHostKind } from "@/src/security/desktopHost";

export interface DeviceCapabilityReading {
  view: DeviceCapabilityView;
  /** False when Apollo isn't running on the device itself (browser preview). */
  hasNativeHost: boolean;
  capsReadFailed: boolean;
  nativeReadFailed: boolean;
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

async function read(): Promise<DeviceCapabilityReading> {
  const platform = capabilityPlatform();
  const hasNativeHost = Platform.OS !== "web" && !!getNativeModule();
  if (!hasNativeHost) {
    return {
      view: buildDeviceCapabilities({ platform, caps: null, native: null, hostIsDevice: false }),
      hasNativeHost: false, capsReadFailed: false, nativeReadFailed: false,
      readAt: new Date().toISOString(),
    };
  }
  const [capsResult, nativeResult] = await Promise.allSettled([
    AppDeviceSdk.getAppDeviceCapabilities(),
    detectNativeProtection(),
  ]);
  const caps: AppDeviceCapabilities | null = capsResult.status === "fulfilled" ? capsResult.value : null;
  const native: NativeProtectionRead | null = nativeResult.status === "fulfilled" ? nativeResult.value : null;
  return {
    view: buildDeviceCapabilities({ platform, caps, native }),
    hasNativeHost: true,
    capsReadFailed: caps === null,
    nativeReadFailed: native === null,
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
