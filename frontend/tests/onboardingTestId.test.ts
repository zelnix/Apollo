import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../app/onboarding.tsx", import.meta.url), "utf8");

test("initial onboarding root has a stable smoke-test selector", () => {
  assert.match(source, /testID="initial-onboarding-root"/);
  assert.match(source, /testID="onboarding-screen"/);
});