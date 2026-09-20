// Security configuration policy — pure, dependency-free so it can be unit-tested
// with node:test and reused by the build-time preflight script.
//
// Rules (policy amended 2026-06 to describe the architecture that actually exists):
//  - APP_ENV must be one of development | staging | production (never derived from __DEV__).
//  - Modes must be exactly "mock" or "native".
//  - production ⇒ the Apollo Security Adapter MUST be native (it is the live enforcement/capability
//    surface). Mock is allowed in development and staging, including native builds on physical devices.
//  - production ⇒ HuCentAI SecureCore MUST be native ONLY while a shipped feature depends on that native
//    module (NATIVE_SECURECORE_DEPENDENT_FEATURES). API identity uses server-issued device tokens, so today
//    SecureCore is a contract stub and the list is empty; the mock is permitted but must stay labelled as such.
//  - native mode ⇒ the native module must be present (fail closed), in every environment.

export type AppEnvironment = "development" | "staging" | "production";
export type SecurityMode = "mock" | "native";
export type AndroidEnforcementEngine = "legacy" | "guarddog_acceptance";

export const APP_ENVIRONMENTS: readonly AppEnvironment[] = ["development", "staging", "production"];

/**
 * Shipped features that genuinely require the native HuCentAI SecureCore module (`HuCentAISecureCore`).
 * Add a feature id here the moment production code depends on native SecureCore — production builds will then
 * fail closed unless EXPO_PUBLIC_SECURECORE_MODE=native and the module is present. Read by the build-time
 * preflight (scripts/security-preflight.mjs) as well — keep it a plain literal array.
 */
export const NATIVE_SECURECORE_DEPENDENT_FEATURES: readonly string[] = [];

export class SecurityConfigurationError extends Error {
  constructor(message: string) {
    super(`SECURITY CONFIGURATION ERROR: ${message}`);
    this.name = "SecurityConfigurationError";
  }
}

export interface SecurityConfigInput {
  appEnvironment: string | undefined;
  secureCoreMode: string | undefined;
  securityAdapterMode: string | undefined;
  androidEnforcementEngine?: string | undefined;
  /** Presence of the native modules. Pass `undefined` to skip the availability check (build-time preflight). */
  nativeSecureCoreAvailable?: boolean;
  nativeSecurityAdapterAvailable?: boolean;
  /** Override of NATIVE_SECURECORE_DEPENDENT_FEATURES (tests only). */
  nativeSecureCoreDependentFeatures?: readonly string[];
}

export interface ValidatedSecurityConfig {
  appEnvironment: AppEnvironment;
  secureCoreMode: SecurityMode;
  securityAdapterMode: SecurityMode;
  androidEnforcementEngine: AndroidEnforcementEngine;
}

function parseEnv(value: string | undefined): AppEnvironment {
  if (!value) throw new SecurityConfigurationError("EXPO_PUBLIC_APP_ENV is missing. Set it to development, staging or production.");
  if (!APP_ENVIRONMENTS.includes(value as AppEnvironment)) throw new SecurityConfigurationError(`EXPO_PUBLIC_APP_ENV="${value}" is invalid. Use development, staging or production.`);
  return value as AppEnvironment;
}

function parseMode(name: string, value: string | undefined): SecurityMode {
  if (value !== "mock" && value !== "native") throw new SecurityConfigurationError(`${name} must be "mock" or "native" (got "${value ?? "undefined"}").`);
  return value;
}

export function validateSecurityConfig(input: SecurityConfigInput): ValidatedSecurityConfig {
  const appEnvironment = parseEnv(input.appEnvironment);
  const secureCoreMode = parseMode("EXPO_PUBLIC_SECURECORE_MODE", input.secureCoreMode);
  const securityAdapterMode = parseMode("EXPO_PUBLIC_SECURITY_MODE", input.securityAdapterMode);
  const androidEnforcementEngine = input.androidEnforcementEngine ?? "legacy";
  if (androidEnforcementEngine !== "legacy" && androidEnforcementEngine !== "guarddog_acceptance") {
    throw new SecurityConfigurationError(`EXPO_PUBLIC_ANDROID_ENFORCEMENT_ENGINE="${androidEnforcementEngine}" is invalid.`);
  }
  if (appEnvironment === "production" && androidEnforcementEngine !== "legacy") {
    throw new SecurityConfigurationError("The GuardDog Stage 1D candidate is test-only and cannot be selected in production.");
  }
  if (androidEnforcementEngine === "guarddog_acceptance" && securityAdapterMode !== "native") {
    throw new SecurityConfigurationError("The GuardDog Stage 1D candidate requires EXPO_PUBLIC_SECURITY_MODE=native.");
  }

  const dependents = input.nativeSecureCoreDependentFeatures ?? NATIVE_SECURECORE_DEPENDENT_FEATURES;
  if (appEnvironment === "production" && securityAdapterMode !== "native") {
    throw new SecurityConfigurationError("Production builds require the native Apollo Security Adapter (EXPO_PUBLIC_SECURITY_MODE=native).");
  }
  if (appEnvironment === "production" && dependents.length > 0 && secureCoreMode !== "native") {
    throw new SecurityConfigurationError(`Production builds require native HuCentAI SecureCore (EXPO_PUBLIC_SECURECORE_MODE=native) because these shipped features depend on it: ${dependents.join(", ")}.`);
  }
  if (secureCoreMode === "native" && input.nativeSecureCoreAvailable === false) {
    throw new SecurityConfigurationError("HuCentAI SecureCore native SDK is required but unavailable. Use an EAS build that includes the native module.");
  }
  if (securityAdapterMode === "native" && input.nativeSecurityAdapterAvailable === false) {
    throw new SecurityConfigurationError("Apollo native security module is required but unavailable. Use an EAS build that includes modules/apollo-security.");
  }
  return { appEnvironment, secureCoreMode, securityAdapterMode, androidEnforcementEngine };
}
