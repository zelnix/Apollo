// Collector for Higgins First Check. Gathers the signals each platform legitimately exposes from the
// existing Diagnostic Core adapters (no new native subsystem, spec §11) and runs the pure engine.
// Prefers local processing: nothing here uploads installed-app lists, certificates or device config
// (spec §14). Fails honestly — a collection failure yields an ERROR report, never a clean one.

import { Platform } from "react-native";

import { EMPTY_SIGNALS, type DevicePlatform } from "@/src/domain/deviceAnalysis";
import { erroredFirstCheck, runFirstCheck, type FirstCheckInputs, type FirstCheckReport } from "@/src/domain/firstCheck";
import { AppDeviceSdk } from "@/src/security/appDeviceSdk";
import { IS_NATIVE_HOST, securityAdapter } from "@/src/security/securityAdapter";

export function currentPlatform(): DevicePlatform {
  const os = Platform.OS as string;
  return os === "ios" ? "ios" : os === "android" ? "android" : os === "windows" ? "windows" : os === "macos" ? "macos" : "web";
}

/** Runs the baseline. Each adapter call is contained so one failure can't abort the whole check. */
export async function collectFirstCheck(): Promise<FirstCheckReport> {
  const platform = currentPlatform();
  try {
    const signals = await AppDeviceSdk.getDeviceSecuritySignals(platform).catch(() => EMPTY_SIGNALS(platform));
    const [facts, protection] = await Promise.all([
      securityAdapter.getDeviceProfileFacts?.().catch(() => null) ?? Promise.resolve(null),
      securityAdapter.getProtectionStatus().catch(() => null),
    ]);
    const inputs: FirstCheckInputs = {
      platform,
      nativeHost: IS_NATIVE_HOST,
      signals,
      deviceFacts: facts ? { osVersion: facts.osVersion, manufacturer: facts.manufacturer, model: facts.model } : null,
      protection: protection ? { requested: protection.requested, operational: protection.operational, enforcementMethod: protection.enforcementMethod, adapterLabel: protection.adapterLabel } : null,
      osReportedThreat: null,
    };
    return runFirstCheck(inputs);
  } catch {
    return erroredFirstCheck(platform, EMPTY_SIGNALS(platform));
  }
}
