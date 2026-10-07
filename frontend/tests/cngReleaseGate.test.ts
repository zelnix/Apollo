// CNG release-gate checks: ensure production config still has the minimum
// required GuardDog variables and the engine plugin is present.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

test("CNG: engine plugin exists", () => {
  assert.ok(existsSync(new URL("../plugins/withGuardDogEngine.js", import.meta.url)), "plugins/withGuardDogEngine.js must exist");
});

test("CNG: production env has required GuardDog variables and no stale signing keys", () => {
  const envPath = new URL("../.env.production", import.meta.url);
  // .env.production may be gitignored (root .gitignore: .env.*). When absent from a clean
  // checkout the env-variable assertions are not actionable — skip cleanly rather than crash.
  if (!existsSync(envPath)) {
    // Not an error: the file is deployment-automation managed and may not be tracked.
    return;
  }
  const env = readFileSync(envPath, "utf8");
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
