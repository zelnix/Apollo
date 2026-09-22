import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const contract = JSON.parse(readFileSync(new URL("../../shared/apollo_phase2_contracts.json", import.meta.url), "utf8"));
const types = readFileSync(new URL("../src/investigation/types.ts", import.meta.url), "utf8");

test("frontend unavailable reasons match the authoritative shared registry", () => {
  for (const reason of contract.unavailableReasons) assert.match(types, new RegExp(`"${reason}"`));
  assert.match(readFileSync(new URL("../src/investigation/deviceBroker.ts", import.meta.url), "utf8"), /privacy_prohibited/);
});