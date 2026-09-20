// Application environment — explicit, never inferred from __DEV__.
// Never throws at module load: an invalid configuration is recorded on the security boot registry
// (app/_layout.tsx then shows SafeStartScreen) and the strictest fail-closed values are returned so
// nothing mock can be selected downstream.
import { recordSecurityBootError } from "@/src/security/securityBoot";
import { validateSecurityConfig, type AppEnvironment, type ValidatedSecurityConfig } from "@/src/security/securityConfig";
import Constants from "expo-constants";

function resolve(): ValidatedSecurityConfig {
  try {
    const candidate = Constants.expoConfig?.extra?.guardDogCandidate as { engine?: string } | undefined;
    return validateSecurityConfig({
      appEnvironment: process.env.EXPO_PUBLIC_APP_ENV,
      secureCoreMode: process.env.EXPO_PUBLIC_SECURECORE_MODE,
      securityAdapterMode: process.env.EXPO_PUBLIC_SECURITY_MODE,
      androidEnforcementEngine: candidate?.engine ?? process.env.EXPO_PUBLIC_ANDROID_ENFORCEMENT_ENGINE,
    });
  } catch (error) {
    recordSecurityBootError(error);
    return { appEnvironment: "production", secureCoreMode: "native", securityAdapterMode: "native", androidEnforcementEngine: "legacy" };
  }
}

const validated = resolve();

export const APP_ENV: AppEnvironment = validated.appEnvironment;
export const IS_PRODUCTION = APP_ENV === "production";
export const SECURITY_CONFIG = validated;
