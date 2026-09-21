// Native host selection (iOS / Android). Metro resolves this file for native bundles and
// `hostAdapter.web.ts` for the browser, so no browser or preview-harness code exists in a native build.
import { Platform } from "react-native";

import { SECURITY_CONFIG } from "@/src/config/appEnvironment";
import { GuardDogSecurityAdapter } from "./guarddog/GuardDogSecurityAdapter";
import { getNativeModule } from "./nativeBridge";
import { AndroidSecurityAdapter, IOSSecurityAdapter } from "./NativeSecurityAdapters";
import { SecurityConfigurationError, validateSecurityConfig } from "./securityConfig";
import type { SecurityPlatformAdapter } from "./SecurityPlatformAdapter";

export function validateHost(): void {
  validateSecurityConfig({
    appEnvironment: SECURITY_CONFIG.appEnvironment,
    androidEnforcementEngine: SECURITY_CONFIG.androidEnforcementEngine,
    devicePreviewHarness: SECURITY_CONFIG.devicePreviewHarness,
    hostPlatform: Platform.OS,
    nativeSecurityAdapterAvailable: getNativeModule() != null,
  });
}

export function chooseHostAdapter(): SecurityPlatformAdapter {
  if (Platform.OS === "ios") return IOSSecurityAdapter;
  if (Platform.OS === "android") {
    return SECURITY_CONFIG.androidEnforcementEngine === "guarddog_acceptance" ? new GuardDogSecurityAdapter() : AndroidSecurityAdapter;
  }
  throw new SecurityConfigurationError(`Apollo has no native security host for platform "${Platform.OS}" in this build.`);
}
