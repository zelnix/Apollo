import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
const root = path.resolve(import.meta.dirname, ".."); const read = (name: string) => fs.readFileSync(path.join(root, name), "utf8");

test("CNG excludes retained native projects from Git and EAS input", () => {
  for (const file of [".gitignore", ".easignore"]) { const source = read(file); assert.match(source, /^\/android$/m); assert.match(source, /^\/ios$/m); }
});

test("production prebuild requires independent owner-controlled public roots", () => {
  const source = read("plugins/withGuardDogProductionTrust.js");
  for (const name of ["APOLLO_GUARDDOG_PRIMARY_ROOT_ID", "APOLLO_GUARDDOG_PRIMARY_ROOT_PUBLIC_KEY_B64", "APOLLO_GUARDDOG_RECOVERY_ROOT_ID", "APOLLO_GUARDDOG_RECOVERY_ROOT_PUBLIC_KEY_B64"]) assert.match(source, new RegExp(name));
  assert.match(source, /primaryKey === recoveryKey/); assert.match(source, /cannot use the GuardDog acceptance test key/);
});

test("generated project gate covers release identity trust FF10 icons and extensions", () => {
  const source = read("scripts/verify-generated-projects.mjs");
  for (const invariant of ["android_application_id_mismatch", "versionName", "versionCode", "allowBackup", "acceptance_trust_must_be_absent", "FamilyAssistProjectionService", "guarddog-core", "guarddog-vpn", "ic_launcher_foreground", "ApolloFamilyAssistBroadcast", "ios_embed_product_count_mismatch"]) assert.ok(source.includes(invariant), invariant);
});