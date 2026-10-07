// CNG release-gate checks: ensure production config still has the minimum
// required GuardDog variables and the engine plugin is present.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { test } from "node:test";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("CNG: engine plugin exists and production env has required GuardDog variables", () => {
  // withGuardDogEngine.js is the sole remaining config plugin (withGuardDogProductionTrust.js was removed)
  assert.ok(existsSync(new URL("../plugins/withGuardDogEngine.js", import.meta.url)), "plugins/withGuardDogEngine.js must exist");
  // .env.production must contain the active GuardDog variables
  const env = read("../.env.production");
  for (const key of [
    "EXPO_PUBLIC_GUARDDOG_RULE_BUNDLE_URL",
    "EXPO_PUBLIC_GUARDDOG_CONTROLLED_HOST",
    "EXPO_PUBLIC_GUARDDOG_CONTROLLED_IPV4",
    "EXPO_PUBLIC_GUARDDOG_CONTROLLED_URL",
    "EXPO_PUBLIC_GUARDDOG_RULESET_ID",
  ]) {
    assert.ok(env.includes(key), `.env.production must include ${key}`);
  }
  // Old signing trust variables must NOT be present
  for (const stale of [
    "APOLLO_GUARDDOG_PRIMARY_ROOT_ID",
    "APOLLO_GUARDDOG_PRIMARY_ROOT_PUBLIC_KEY_B64",
    "APOLLO_GUARDDOG_RECOVERY_ROOT_ID",
    "APOLLO_GUARDDOG_RECOVERY_ROOT_PUBLIC_KEY_B64",
    "APOLLO_GUARDDOG_TRUST_DOMAIN",
    "APOLLO_GUARDDOG_TRUST_PROFILE",
    "EXPO_PUBLIC_GUARDDOG_TRUST_MANIFEST_URL",
  ]) {
    assert.ok(!env.includes(stale), `.env.production must NOT include stale variable ${stale}`);
  }
});
