// Collects REAL app + device metadata for the Support screen and email (spec §3). Every value is
// sourced from a genuine platform API; anything a platform can't reliably give becomes "Unavailable".
// Installation dates are never fabricated or conflated: the OTA bundle date and the native
// install/update dates are reported as the distinct things they are (spec §3 caution).
import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Updates from "expo-updates";
import { Platform } from "react-native";

import { APP_ENV } from "@/src/config/appEnvironment";
import { IS_NATIVE_HOST } from "@/src/security/securityAdapter";

export const UNAVAILABLE = "Unavailable";

export interface SupportAppInfo {
  version: string;
  build: string;
  buildId: string;
  updateId: string;
  environment: string;
  nativeBuild: boolean;
  installedAt: string;
  bundlePublishedAt: string;
  lastNativeUpdateAt: string;
}
export interface SupportDeviceInfo {
  manufacturer: string;
  model: string;
  deviceType: string;
  os: string;
  osVersion: string;
  architecture: string;
}

const fmt = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString() : UNAVAILABLE);
const DEVICE_TYPE: Record<number, string> = { 0: "Unknown", 1: "Phone", 2: "Tablet", 3: "Desktop", 4: "TV" };

export async function collectAppDeviceInfo(): Promise<{ app: SupportAppInfo; device: SupportDeviceInfo }> {
  const version = Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? UNAVAILABLE;
  const build = Application.nativeBuildVersion ?? UNAVAILABLE;

  // OTA update identity (genuine when running an EAS Update; absent on embedded/preview launches).
  let updateId = UNAVAILABLE, bundlePublishedAt = UNAVAILABLE, buildId = UNAVAILABLE;
  try {
    if (Updates.isEnabled && !Updates.isEmbeddedLaunch) {
      updateId = Updates.updateId ?? UNAVAILABLE;
      bundlePublishedAt = Updates.createdAt ? Updates.createdAt.toLocaleString() : UNAVAILABLE;
    }
    buildId = Updates.runtimeVersion ?? UNAVAILABLE; // runtime (build) identity, where exposed
  } catch { /* Updates not available in this environment — stays Unavailable */ }

  // Native install / last-native-update dates. These are NOT the OTA JS update date (spec §3).
  let installedAt = UNAVAILABLE, lastNativeUpdateAt = UNAVAILABLE;
  if (IS_NATIVE_HOST) {
    try { installedAt = fmt((await Application.getInstallationTimeAsync())?.toISOString() ?? null); } catch { /* keep Unavailable */ }
    if (Platform.OS === "android") {
      try { lastNativeUpdateAt = fmt((await Application.getLastUpdateTimeAsync())?.toISOString() ?? null); } catch { /* keep Unavailable */ }
    }
  }

  const app: SupportAppInfo = {
    version, build, buildId, updateId, environment: APP_ENV, nativeBuild: IS_NATIVE_HOST,
    installedAt, bundlePublishedAt, lastNativeUpdateAt,
  };

  let deviceType = UNAVAILABLE;
  try { deviceType = DEVICE_TYPE[await Device.getDeviceTypeAsync()] ?? "Unknown"; } catch { /* keep Unavailable */ }
  const device: SupportDeviceInfo = {
    manufacturer: Device.manufacturer ?? UNAVAILABLE,
    model: Device.modelName ?? UNAVAILABLE,
    deviceType,
    os: Device.osName ?? Platform.OS,
    osVersion: Device.osVersion ?? UNAVAILABLE,
    architecture: Device.supportedCpuArchitectures?.join(", ") ?? UNAVAILABLE,
  };
  return { app, device };
}
