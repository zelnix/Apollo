// Collector for Higgins First Check. Gathers the signals each platform legitimately exposes from the
// existing Diagnostic Core adapters (no new native subsystem, spec §11) and runs the pure engine.
// Prefers local processing: nothing here uploads installed-app lists, certificates or device config
// (spec §14). Fails honestly — a collection failure yields an ERROR report, never a clean one.

import { Platform } from "react-native";

import { EMPTY_SIGNALS, type DevicePlatform } from "@/src/domain/deviceAnalysis";
import { erroredFirstCheck, osThreatNotAvailable, runFirstCheck, type FirstCheckInputs, type FirstCheckReport } from "@/src/domain/firstCheck";
import { AppDeviceSdk } from "@/src/security/appDeviceSdk";
import { IS_NATIVE_HOST, securityAdapter } from "@/src/security/securityAdapter";

export function currentPlatform(): DevicePlatform {
  // The Windows/macOS desktop host runs the web bundle, so Platform.OS is "web" there — trust the adapter's kind.
  if (securityAdapter.kind === "windows" || securityAdapter.kind === "macos") return securityAdapter.kind;
  const os = Platform.OS as string;
  return os === "ios" ? "ios" : os === "android" ? "android" : os === "windows" ? "windows" : os === "macos" ? "macos" : "web";
}

/** The stages this collector actually performs, in order. Progress is reported as each one really
 *  starts — it is never a timed animation. */
export const FIRST_CHECK_STAGES = [
  "Reading this device's security signals",
  "Reading Apollo's protection state",
  "Reading Apollo's security rules",
  "Working out what it means",
] as const;

export type FirstCheckProgress = { step: number; total: number; label: string };

/** Runs the baseline. A failure to READ the device signals is reported as an ERROR report naming the
 *  failed read — Apollo never substitutes empty signals and then grades the device as if it had read them. */
export async function collectFirstCheck(onProgress?: (p: FirstCheckProgress) => void): Promise<FirstCheckReport> {
  const platform = currentPlatform();
  const total = FIRST_CHECK_STAGES.length;
  const stage = (step: number) => onProgress?.({ step, total, label: FIRST_CHECK_STAGES[step - 1] });
  try {
    stage(1);
    // Desktop hosts (Windows/macOS) read their signals through the Tauri adapter; phones through the native module.
    const desktop = platform === "windows" || platform === "macos";
    let raw;
    try {
      raw = desktop && securityAdapter.getDeviceSecuritySignals
        ? await securityAdapter.getDeviceSecuritySignals()
        : await AppDeviceSdk.getDeviceSecuritySignals(platform);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return erroredFirstCheck(platform, EMPTY_SIGNALS(platform), undefined,
        `Higgins couldn't read this device's security signals, so no part of the check could run (${detail}).`);
    }
    const signals = { ...EMPTY_SIGNALS(platform), ...raw };
    stage(2);
    const [facts, protection, connection] = await Promise.all([
      securityAdapter.getDeviceProfileFacts?.().catch(() => null) ?? Promise.resolve(null),
      securityAdapter.getProtectionStatus().catch(() => null),
      securityAdapter.getNetworkStatus().catch(() => null),
    ]);
    stage(3);
    // Only platforms that can report rule state implement this; a failed read stays unknown.
    const ruleBundle = securityAdapter.getRuleBundleStatus
      ? await securityAdapter.getRuleBundleStatus().catch(() => ({
          observable: true, current: null as boolean | null, expiresAt: null,
          detail: "Apollo couldn't read the state of its security rules. This is not a confirmation that they are current.",
        }))
      : null;
    const inputs: FirstCheckInputs = {
      platform,
      nativeHost: IS_NATIVE_HOST,
      signals,
      deviceFacts: facts ? { osVersion: facts.osVersion, manufacturer: facts.manufacturer, model: facts.model } : null,
      protection: protection ? { requested: protection.requested, operational: protection.operational, enforcementMethod: protection.enforcementMethod, adapterLabel: protection.adapterLabel } : null,
      // Each platform adapter supplies its trusted OS threat report when it has one; otherwise an explicit NOT_AVAILABLE.
      osReportedThreat: signals.osThreatReport ?? osThreatNotAvailable(platform, IS_NATIVE_HOST),
      connection,
      ruleBundle,
    };
    stage(4);
    return runFirstCheck(inputs);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return erroredFirstCheck(platform, EMPTY_SIGNALS(platform), undefined,
      `Higgins couldn't complete the initial security check (${detail}).`);
  }
}
