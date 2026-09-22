// Security configuration policy — pure, dependency-free so it can be unit-tested
// with node:test and reused by the build-time preflight script.
//
// Rules (spec §1A "no mocks in the application runtime"):
//  - APP_ENV must be one of development | staging | production (never derived from __DEV__).
//  - There is NO mock/native mode switch any more. Android and iOS always use the Apollo native security
//    module and fail closed when it is absent (Expo Go). Web always uses the real browser adapter.
//  - The only permitted simulation is the separate device-preview harness (frontend/tools, web-only host selector),
//    selectable ONLY by EXPO_PUBLIC_DEVICE_PREVIEW_HARNESS=enabled in a *development* *web* host. Staging and
//    production reject the flag; native hosts reject it regardless of environment.
//  - The GuardDog Stage 1D candidate engine stays test-only (never production).

export type AppEnvironment = "development" | "staging" | "production";
export type AndroidEnforcementEngine = "legacy" | "guarddog_acceptance" | "guarddog_production";
export type DevicePreviewHarness = "off" | "enabled";

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
  /** Raw EXPO_PUBLIC_DEVICE_PREVIEW_HARNESS value. Anything other than "enabled" (or empty/"off") is rejected. */
  devicePreviewHarness?: string | undefined;
  /** react-native Platform.OS of the running host. Omit for build-time preflight. */
  hostPlatform?: string | undefined;
  /** Presence of the Apollo native module on a native host. Omit to skip the availability check (preflight). */
  nativeSecurityAdapterAvailable?: boolean;
}

export interface ValidatedSecurityConfig {
  appEnvironment: AppEnvironment;
  androidEnforcementEngine: AndroidEnforcementEngine;
  devicePreviewHarness: DevicePreviewHarness;
}

function parseEnv(value: string | undefined): AppEnvironment {
  if (!value) throw new SecurityConfigurationError("EXPO_PUBLIC_APP_ENV is missing. Set it to development, staging or production.");
  if (!APP_ENVIRONMENTS.includes(value as AppEnvironment)) throw new SecurityConfigurationError(`EXPO_PUBLIC_APP_ENV="${value}" is invalid. Use development, staging or production.`);
  return value as AppEnvironment;
}

function parseHarness(value: string | undefined): DevicePreviewHarness {
  if (value === undefined || value === "" || value === "off") return "off";
  if (value === "enabled") return "enabled";
  throw new SecurityConfigurationError(`EXPO_PUBLIC_DEVICE_PREVIEW_HARNESS="${value}" is invalid. Use "enabled" only for the development web preview host, otherwise leave it unset.`);
}

export function validateSecurityConfig(input: SecurityConfigInput): ValidatedSecurityConfig {
  const appEnvironment = parseEnv(input.appEnvironment);
  const androidEnforcementEngine = input.androidEnforcementEngine ?? "legacy";
  if (androidEnforcementEngine !== "legacy" && androidEnforcementEngine !== "guarddog_acceptance" && androidEnforcementEngine !== "guarddog_production") {
    throw new SecurityConfigurationError(`EXPO_PUBLIC_ANDROID_ENFORCEMENT_ENGINE="${androidEnforcementEngine}" is invalid.`);
  }
  if (appEnvironment === "production" && androidEnforcementEngine === "guarddog_acceptance") {
    throw new SecurityConfigurationError("The GuardDog Stage 1D candidate is test-only and cannot be selected in production.");
  }
  if (androidEnforcementEngine === "guarddog_production" && appEnvironment !== "production") {
    throw new SecurityConfigurationError("GuardDog production authority can be selected only in a production build.");
  }
  const devicePreviewHarness = parseHarness(input.devicePreviewHarness);
  if (devicePreviewHarness === "enabled") {
    if (appEnvironment !== "development") {
      throw new SecurityConfigurationError(`The device-preview harness (simulated device inputs) is only permitted in development; this build is "${appEnvironment}".`);
    }
    if (input.hostPlatform !== undefined && input.hostPlatform !== "web") {
      throw new SecurityConfigurationError(`The device-preview harness is web-only; it cannot be activated on "${input.hostPlatform}".`);
    }
  }
  if ((input.hostPlatform === "android" || input.hostPlatform === "ios") && input.nativeSecurityAdapterAvailable === false) {
    throw new SecurityConfigurationError("Apollo native security module is required but unavailable. Use a build that includes modules/apollo-security (Expo Go cannot load it).");
  }
  return { appEnvironment, androidEnforcementEngine, devicePreviewHarness };
}
