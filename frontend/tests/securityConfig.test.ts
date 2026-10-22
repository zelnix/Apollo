// Unit tests for the runtime security policy (spec §1A: no mocks in the application runtime).
// Run: cd frontend && yarn test:security   (node:test)
//
// Current policy (post signing-key removal):
//   - Only "guarddog_production" engine is permitted, and only in production.
//   - Development/staging builds always fail validation (boot safety screen).
//   - No mock/native mode switches.
//   - There is no simulated device host to configure at all.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { SecurityConfigurationError, validateSecurityConfig } from "../src/security/securityConfig.ts";

const ok = (input: Parameters<typeof validateSecurityConfig>[0]) => assert.doesNotThrow(() => validateSecurityConfig(input));
const rejected = (input: Parameters<typeof validateSecurityConfig>[0], needle: string | RegExp) =>
  assert.throws(() => validateSecurityConfig(input), (e: unknown) =>
    e instanceof SecurityConfigurationError && (typeof needle === "string" ? e.message.includes(needle) : needle.test(e.message)));

test("1. production with guarddog_production and native module present → passes", () => {
  ok({ appEnvironment: "production", hostPlatform: "android", nativeSecurityAdapterAvailable: true });
  ok({ appEnvironment: "production", hostPlatform: "ios", nativeSecurityAdapterAvailable: true });
  ok({ appEnvironment: "production", hostPlatform: "web" });
  // Engine defaults to guarddog_production when omitted
  ok({ appEnvironment: "production", androidEnforcementEngine: "guarddog_production", hostPlatform: "android", nativeSecurityAdapterAvailable: true });
});

test("2. production native host without the Apollo module → rejected", () => {
  rejected({ appEnvironment: "production", hostPlatform: "android", nativeSecurityAdapterAvailable: false }, "native security module is required");
  rejected({ appEnvironment: "production", hostPlatform: "ios", nativeSecurityAdapterAvailable: false }, "native security module is required");
});

test("3. guarddog_production in development or staging → rejected (production-only engine)", () => {
  // Engine defaults to guarddog_production, which is rejected outside production
  rejected({ appEnvironment: "development", hostPlatform: "android", nativeSecurityAdapterAvailable: true }, "production");
  rejected({ appEnvironment: "staging", hostPlatform: "android", nativeSecurityAdapterAvailable: true }, "production");
  rejected({ appEnvironment: "development", hostPlatform: "web" }, "production");
  rejected({ appEnvironment: "staging", hostPlatform: "web" }, "production");
});

test("4. any engine other than guarddog_production → rejected", () => {
  rejected({ appEnvironment: "production", androidEnforcementEngine: "guarddog_acceptance" }, "is invalid");
  rejected({ appEnvironment: "production", androidEnforcementEngine: "legacy" }, "is invalid");
  rejected({ appEnvironment: "development", androidEnforcementEngine: "other" }, "is invalid");
  rejected({ appEnvironment: "production", androidEnforcementEngine: "" }, "is invalid");
});

test("5. missing or invalid environment → rejected", () => {
  rejected({ appEnvironment: undefined }, "EXPO_PUBLIC_APP_ENV is missing");
  rejected({ appEnvironment: "prod" }, "is invalid");
});

test("6. the removed mode switches are silently ignored (not accepted as active inputs)", () => {
  // Passing old mode switches doesn't cause a crash, they're just ignored.
  // The config still fails for non-production env (guarddog_production is production-only).
  const legacy = { appEnvironment: "production", retiredMode: "mock", securityAdapterMode: "mock", devicePreviewHarness: "enabled" } as unknown as Parameters<typeof validateSecurityConfig>[0];
  const result = validateSecurityConfig(legacy);
  assert.deepEqual(Object.keys(result).sort(), ["androidEnforcementEngine", "appEnvironment"]);
});

test("7. there is no device-preview harness to configure — the security config cannot select a simulated host", () => {
  const config = readFileSync(new URL("../src/security/securityConfig.ts", import.meta.url), "utf8");
  assert.doesNotMatch(config, /devicePreviewHarness|DevicePreviewHarness|PreviewDeviceAdapter/);
  // Preview simulation is a build decision about sample INPUTS; it can never stand in for a device read.
  assert.deepEqual(Object.keys(validateSecurityConfig({ appEnvironment: "production", hostPlatform: "web" })).sort(),
    ["androidEnforcementEngine", "appEnvironment"]);
});
