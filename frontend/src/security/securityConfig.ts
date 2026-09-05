// Security configuration policy — pure, dependency-free so it can be unit-tested
// with node:test and reused by the build-time preflight script.
//
// Rules:
//  - APP_ENV must be one of development | staging | production (never derived from __DEV__).
//  - Modes must be exactly "mock" or "native".
//  - production ⇒ both modes MUST be native. Mock is allowed in development and staging,
//    including native builds installed on physical devices.
//  - native mode ⇒ the native module must be present (fail closed), in every environment.

export type AppEnvironment = "development" | "staging" | "production";
export type SecurityMode = "mock" | "native";

export const APP_ENVIRONMENTS: readonly AppEnvironment[] = ["development", "staging", "production"];

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
  /** Presence of the native modules. Pass `undefined` to skip the availability check (build-time preflight). */
  nativeSecureCoreAvailable?: boolean;
  nativeSecurityAdapterAvailable?: boolean;
}

export interface ValidatedSecurityConfig {
  appEnvironment: AppEnvironment;
  secureCoreMode: SecurityMode;
  securityAdapterMode: SecurityMode;
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

  if (appEnvironment === "production" && secureCoreMode !== "native") {
    throw new SecurityConfigurationError("Production builds require native HuCentAI SecureCore (EXPO_PUBLIC_SECURECORE_MODE=native).");
  }
  if (appEnvironment === "production" && securityAdapterMode !== "native") {
    throw new SecurityConfigurationError("Production builds require the native Apollo Security Adapter (EXPO_PUBLIC_SECURITY_MODE=native).");
  }
  if (secureCoreMode === "native" && input.nativeSecureCoreAvailable === false) {
    throw new SecurityConfigurationError("HuCentAI SecureCore native SDK is required but unavailable. Use an EAS build that includes the native module.");
  }
  if (securityAdapterMode === "native" && input.nativeSecurityAdapterAvailable === false) {
    throw new SecurityConfigurationError("Apollo native security module is required but unavailable. Use an EAS build that includes modules/apollo-security.");
  }
  return { appEnvironment, secureCoreMode, securityAdapterMode };
}
