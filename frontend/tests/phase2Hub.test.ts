import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../app/(tabs)/ask.tsx", import.meta.url), "utf8");

test("Higgins hub remains available when an ordinary transcript exists", () => {
  assert.match(source, /!investigationMode \? <View testID="higgins-hub"/);
  assert.doesNotMatch(source, /!investigationMode && chatMessages\.length === 0 \? <View testID="higgins-hub"/);
});

test("Higgins hub keeps six independent front doors", () => {
  for (const id of ["higgins-hub-chat", "higgins-hub-current", "higgins-hub-recent", "higgins-hub-scams", "higgins-hub-learning", "higgins-hub-reports"]) assert.match(source, new RegExp(id));
  assert.match(source, /higginsHubHistory\(12\)/);
  assert.match(source, /setHubError\(true\)/);
});