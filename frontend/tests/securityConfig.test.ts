// Unit tests for the production security safeguard.
// Run: cd frontend && yarn test:security   (node:test via tsx)
import assert from "node:assert/strict";
import { test } from "node:test";

import { SecurityConfigurationError, validateSecurityConfig } from "../src/security/securityConfig.ts";

const ok = (input: Parameters<typeof validateSecurityConfig>[0]) => assert.doesNotThrow(() => validateSecurityConfig(input));
const rejected = (input: Parameters<typeof validateSecurityConfig>[0], needle: string) =>
  assert.throws(() => validateSecurityConfig(input), (e: unknown) => e instanceof SecurityConfigurationError && e.message.includes(needle));

test("1. development + mock → allowed", () => ok({ appEnvironment: "development", secureCoreMode: "mock", securityAdapterMode: "mock" }));
test("2. development + native → allowed", () => ok({ appEnvironment: "development", secureCoreMode: "native", securityAdapterMode: "native", nativeSecureCoreAvailable: true, nativeSecurityAdapterAvailable: true }));
test("3. production + native → allowed", () => ok({ appEnvironment: "production", secureCoreMode: "native", securityAdapterMode: "native", nativeSecureCoreAvailable: true, nativeSecurityAdapterAvailable: true }));
test("4. production + mock SecureCore → rejected", () => rejected({ appEnvironment: "production", secureCoreMode: "mock", securityAdapterMode: "native" }, "Production builds require native HuCentAI SecureCore"));
test("5. production + mock SecurityAdapter → rejected", () => rejected({ appEnvironment: "production", secureCoreMode: "native", securityAdapterMode: "mock" }, "native Apollo Security Adapter"));
test("6. native SecureCore selected but module unavailable → rejected (any env)", () => {
  rejected({ appEnvironment: "development", secureCoreMode: "native", securityAdapterMode: "mock", nativeSecureCoreAvailable: false }, "required but unavailable");
  rejected({ appEnvironment: "production", secureCoreMode: "native", securityAdapterMode: "native", nativeSecureCoreAvailable: false }, "required but unavailable");
  rejected({ appEnvironment: "staging", secureCoreMode: "mock", securityAdapterMode: "native", nativeSecurityAdapterAvailable: false }, "native security module is required but unavailable");
});
test("7. missing or invalid security mode / environment → rejected", () => {
  rejected({ appEnvironment: undefined, secureCoreMode: "mock", securityAdapterMode: "mock" }, "EXPO_PUBLIC_APP_ENV is missing");
  rejected({ appEnvironment: "prod", secureCoreMode: "native", securityAdapterMode: "native" }, "is invalid");
  rejected({ appEnvironment: "development", secureCoreMode: undefined, securityAdapterMode: "mock" }, "EXPO_PUBLIC_SECURECORE_MODE");
  rejected({ appEnvironment: "development", secureCoreMode: "mock", securityAdapterMode: "fake" }, "EXPO_PUBLIC_SECURITY_MODE");
});
test("staging + mock → allowed (explicit choice, incl. physical devices)", () => ok({ appEnvironment: "staging", secureCoreMode: "mock", securityAdapterMode: "mock" }));
