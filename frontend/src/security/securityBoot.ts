// Security boot boundary — dependency-free so it is unit-testable with node:test.
//
// Every security selector (appEnvironment.ts, SecureCore.ts, securityAdapter.ts) used to THROW at JS module
// load. In a release Hermes bundle that is an uncaught exception during start-up → the OS "Apollo keeps
// stopping" dialog. Fail-closed is right; an OS crash is the wrong way to express it.
//
// Now the selectors go through `selectFailClosed`: the first SecurityConfigurationError is recorded here and
// the selector returns a *fail-closed stand-in* whose every member throws that same error. app/_layout.tsx
// reads `getSecurityBootError()` before mounting anything and renders SafeStartScreen instead of the app —
// no providers, no navigation, no protection start-up, no background work. The stand-ins exist only so that
// module evaluation (expo-router evaluates every route module eagerly in production) cannot crash; they can
// never report a status, so no "Apollo is guarding" state can ever be derived from them.

import { SecurityConfigurationError } from "./securityConfig.ts";

let bootError: SecurityConfigurationError | null = null;

export function recordSecurityBootError(error: unknown): SecurityConfigurationError {
  const err = error instanceof SecurityConfigurationError
    ? error
    : new SecurityConfigurationError(error instanceof Error ? error.message : String(error));
  if (!bootError) bootError = err;
  return err;
}

/** The first security configuration failure seen during start-up, or null when the app may start. */
export function getSecurityBootError(): SecurityConfigurationError | null {
  return bootError;
}

/** Tests only — the registry is module state. */
export function resetSecurityBootErrorForTests(): void {
  bootError = null;
}

/**
 * Stand-in returned when a security component must not be selected. Every property read yields a function
 * that throws the recorded error, so any attempt to use protection after a blocked boot fails loudly and
 * nothing can ever be reported as operational.
 */
export function failClosed<T extends object>(error: SecurityConfigurationError): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      if (prop === "then" || typeof prop === "symbol") return undefined; // not a thenable, safe to log
      return () => { throw error; };
    },
    has() { return false; },
  });
}

/**
 * Runs `validate` then `choose`. On SecurityConfigurationError (or any throw) the error is recorded and a
 * fail-closed stand-in is returned instead of crashing module evaluation.
 */
export function selectFailClosed<T extends object>(validate: () => void, choose: () => T): T {
  try {
    validate();
    return choose();
  } catch (error) {
    return failClosed<T>(recordSecurityBootError(error));
  }
}

export interface SafeStartCopy {
  title: string;
  reason: string;
  meaning: string;
  guidance: string;
}

/** Plain-language copy for the blocking screen. Never claims any protection is active. */
export function safeStartCopy(error: SecurityConfigurationError): SafeStartCopy {
  return {
    title: "Apollo can't start safely.",
    reason: error.message.replace(/^SECURITY CONFIGURATION ERROR:\s*/, ""),
    meaning: "Apollo has not started. Nothing is being watched, checked or blocked, and nothing has been sent anywhere.",
    guidance: "This build is missing a required security component, so Apollo stops here rather than pretend. Install an updated build of Apollo, or contact Harmony Wellness Group support.",
  };
}
