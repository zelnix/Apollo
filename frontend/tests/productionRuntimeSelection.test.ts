import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("V37 ordinary production profiles resolve to exactly one production runtime owner", () => {
  const eas = JSON.parse(read("../eas.json"));
  for (const profile of ["production", "app-bundle"]) {
    assert.equal(eas.build[profile].env.EXPO_PUBLIC_APP_ENV, "production");
    assert.equal(eas.build[profile].env.EXPO_PUBLIC_ANDROID_ENFORCEMENT_ENGINE, "guarddog_production");
  }
  const host = read("../src/security/hostAdapter.ts");
  assert.equal((host.match(/new GuardDogProductionSecurityAdapter/g) ?? []).length, 1);
  assert.match(host, /guarddog_production/);
  assert.match(read("../src/security/securityConfig.ts"), /Legacy and test-only acceptance engines are prohibited/);
});

test("V37 production trust failure has no legacy or acceptance fallback", () => {
  const adapter = read("../src/security/guarddog/GuardDogProductionSecurityAdapter.ts");
  assert.doesNotMatch(adapter, /new GuardDogSecurityAdapter|new AndroidSecurityAdapter|return new AndroidSecurityAdapter/);
  assert.match(adapter, /throw refreshError/);
  const config = read("../src/config/appEnvironment.ts");
  assert.match(config, /androidEnforcementEngine: "guarddog_production"/);
});