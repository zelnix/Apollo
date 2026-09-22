// Unit tests for the runtime security policy (spec §1A: no mocks in the application runtime).
// Run: cd frontend && yarn test:security   (node:test)
import assert from "node:assert/strict";
import { test } from "node:test";

import { SecurityConfigurationError, validateSecurityConfig } from "../src/security/securityConfig.ts";

const ok = (input: Parameters<typeof validateSecurityConfig>[0]) => assert.doesNotThrow(() => validateSecurityConfig(input));
const rejected = (input: Parameters<typeof validateSecurityConfig>[0], needle: string) =>
  assert.throws(() => validateSecurityConfig(input), (e: unknown) => e instanceof SecurityConfigurationError && e.message.includes(needle));

test("1. every environment is allowed on a native host that has the Apollo module", () => {
  for (const appEnvironment of ["development", "staging", "production"] as const) {
    ok({ appEnvironment, hostPlatform: "android", nativeSecurityAdapterAvailable: true });
    ok({ appEnvironment, hostPlatform: "ios", nativeSecurityAdapterAvailable: true });
    ok({ appEnvironment, hostPlatform: "web" });
  }
});
test("2. native host without the Apollo module → rejected in every environment (never a mock substitute)", () => {
  for (const appEnvironment of ["development", "staging", "production"] as const) {
    rejected({ appEnvironment, hostPlatform: "android", nativeSecurityAdapterAvailable: false }, "native security module is required");
    rejected({ appEnvironment, hostPlatform: "ios", nativeSecurityAdapterAvailable: false }, "native security module is required");
  }
});
test("3. the removed mode switches are not accepted as inputs any more", () => {
  const legacy = { appEnvironment: "development", retiredMode: "mock", securityAdapterMode: "mock" } as unknown as Parameters<typeof validateSecurityConfig>[0];
  const result = validateSecurityConfig(legacy);
  assert.deepEqual(Object.keys(result).sort(), ["androidEnforcementEngine", "appEnvironment", "devicePreviewHarness"]);
  assert.equal(result.devicePreviewHarness, "off");
});
test("4. device-preview harness: development web only", () => {
  ok({ appEnvironment: "development", devicePreviewHarness: "enabled", hostPlatform: "web" });
  ok({ appEnvironment: "development", devicePreviewHarness: "enabled" }); // preflight has no host platform
  rejected({ appEnvironment: "staging", devicePreviewHarness: "enabled", hostPlatform: "web" }, "only permitted in development");
  rejected({ appEnvironment: "production", devicePreviewHarness: "enabled", hostPlatform: "web" }, "only permitted in development");
  rejected({ appEnvironment: "development", devicePreviewHarness: "enabled", hostPlatform: "android", nativeSecurityAdapterAvailable: true }, "web-only");
  rejected({ appEnvironment: "development", devicePreviewHarness: "enabled", hostPlatform: "ios", nativeSecurityAdapterAvailable: true }, "web-only");
  rejected({ appEnvironment: "development", devicePreviewHarness: "yes", hostPlatform: "web" }, "is invalid");
  assert.equal(validateSecurityConfig({ appEnvironment: "production", devicePreviewHarness: "", hostPlatform: "web" }).devicePreviewHarness, "off");
  assert.equal(validateSecurityConfig({ appEnvironment: "production", devicePreviewHarness: "off", hostPlatform: "web" }).devicePreviewHarness, "off");
});
test("5. missing or invalid environment → rejected", () => {
  rejected({ appEnvironment: undefined }, "EXPO_PUBLIC_APP_ENV is missing");
  rejected({ appEnvironment: "prod" }, "is invalid");
});
test("6. GuardDog acceptance candidate is prohibited in production", () => {
  ok({ appEnvironment: "development", androidEnforcementEngine: "guarddog_acceptance", hostPlatform: "android", nativeSecurityAdapterAvailable: true });
  ok({ appEnvironment: "staging", androidEnforcementEngine: "guarddog_acceptance", hostPlatform: "android", nativeSecurityAdapterAvailable: true });
  rejected({ appEnvironment: "production", androidEnforcementEngine: "guarddog_acceptance", hostPlatform: "android", nativeSecurityAdapterAvailable: true }, "test-only");
  rejected({ appEnvironment: "development", androidEnforcementEngine: "other" }, "is invalid");
});
