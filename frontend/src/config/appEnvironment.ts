// Application environment — explicit, never inferred from __DEV__.
// Never throws at module load: an invalid configuration is recorded on the security boot registry
// (app/_layout.tsx then shows SafeStartScreen) and the strictest fail-closed values are returned so
// no simulated component can be selected downstream.
import Constants from "expo-constants";
import { Platform } from "react-native";

import { recordSecurityBootError } from "@/src/security/securityBoot";
import { validateSecurityConfig, type AppEnvironment, type ValidatedSecurityConfig } from "@/src/security/securityConfig";

function resolve(): ValidatedSecurityConfig {
  try {
    const candidate = Constants.expoConfig?.extra?.guardDogCandidate as { engine?: string } | undefined;
    return validateSecurityConfig({
      appEnvironment: process.env.EXPO_PUBLIC_APP_ENV,
      androidEnforcementEngine: candidate?.engine ?? process.env.EXPO_PUBLIC_ANDROID_ENFORCEMENT_ENGINE,
      devicePreviewHarness: process.env.EXPO_PUBLIC_DEVICE_PREVIEW_HARNESS,
      hostPlatform: Platform.OS,
    });
  } catch (error) {
    recordSecurityBootError(error);
    return { appEnvironment: "production", androidEnforcementEngine: "guarddog_production", devicePreviewHarness: "off" };
  }
}

const validated = resolve();

export const APP_ENV: AppEnvironment = validated.appEnvironment;
export const IS_PRODUCTION = APP_ENV === "production";
export const SECURITY_CONFIG = validated;
