// Security configuration policy — pure, dependency-free so it can be unit-tested
// with node:test and reused by the build-time preflight script.
//
// Rules (spec §1A "no mocks in the application runtime"):
//  - APP_ENV must be one of development | staging | production (never derived from __DEV__).
//  - There is NO mock/native mode switch any more. Android and iOS always use the Apollo native security
//    module and fail closed when it is absent (Expo Go). Web always uses the real browser adapter.
//  - There is no simulated device adapter at all. Preview simulation is a BUILD decision
//    (EXPO_PUBLIC_PREVIEW_BUILD, see babel.config.js) that governs sample INPUTS only; it can never
//    stand in for a real device read.
//  - The GuardDog production authority is the only permitted production engine.

export type AppEnvironment = "development" | "staging" | "production";
export type AndroidEnforcementEngine = "guarddog_production";

export const APP_ENVIRONMENTS: readonly AppEnvironment[] = ["development", "staging", "production"];

export class SecurityConfigurationError extends Error {
  constructor(message: string) {
    super(`SECURITY CONFIGURATION ERROR: ${message}`);
    this.name = "SecurityConfigurationError";
  }
}

export interface SecurityConfigInput {
  appEnvironment: string | undefined;
  androidEnforcementEngine?: string | undefined;
  /** react-native Platform.OS of the running host. Omit for build-time preflight. */
  hostPlatform?: string | undefined;
  /** Presence of the Apollo native module on a native host. Omit to skip the availability check (preflight). */
  nativeSecurityAdapterAvailable?: boolean;
}

export interface ValidatedSecurityConfig {
  appEnvironment: AppEnvironment;
  androidEnforcementEngine: AndroidEnforcementEngine;
}

function parseEnv(value: string | undefined): AppEnvironment {
  if (!value) throw new SecurityConfigurationError("EXPO_PUBLIC_APP_ENV is missing. Set it to development, staging or production.");
  if (!APP_ENVIRONMENTS.includes(value as AppEnvironment)) throw new SecurityConfigurationError(`EXPO_PUBLIC_APP_ENV="${value}" is invalid. Use development, staging or production.`);
  return value as AppEnvironment;
}

export function validateSecurityConfig(input: SecurityConfigInput): ValidatedSecurityConfig {
  const appEnvironment = parseEnv(input.appEnvironment);
  const androidEnforcementEngine = input.androidEnforcementEngine ?? "guarddog_production";
  if (androidEnforcementEngine !== "guarddog_production") {
    throw new SecurityConfigurationError(`EXPO_PUBLIC_ANDROID_ENFORCEMENT_ENGINE="${androidEnforcementEngine}" is invalid. Only "guarddog_production" is supported.`);
  }
  if (appEnvironment === "production" && androidEnforcementEngine !== "guarddog_production") {
    throw new SecurityConfigurationError("Production Android builds require Apollo's GuardDog production authority. Legacy and test-only acceptance engines are prohibited.");
  }
  if (androidEnforcementEngine === "guarddog_production" && appEnvironment !== "production") {
    throw new SecurityConfigurationError("GuardDog production authority can be selected only in a production build.");
  }
  if ((input.hostPlatform === "android" || input.hostPlatform === "ios") && input.nativeSecurityAdapterAvailable === false) {
    throw new SecurityConfigurationError("Apollo native security module is required but unavailable. Use a build that includes modules/apollo-security (Expo Go cannot load it).");
  }
  return { appEnvironment, androidEnforcementEngine };
}
