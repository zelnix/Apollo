// Higgins' daily greeting. Run: yarn test:higgins
import assert from "node:assert/strict";
import { test } from "node:test";

import { dayKey, higginsGreeting, timeOfDay } from "../src/domain/higginsGreeting.ts";

const at = (h: number) => { const d = new Date(2026, 5, 15, h, 30); return d; };

test("time of day buckets", () => { assert.equal(timeOfDay(at(7)), "morning"); assert.equal(timeOfDay(at(13)), "afternoon"); assert.equal(timeOfDay(at(19)), "evening"); assert.equal(timeOfDay(at(23)), "night"); assert.equal(timeOfDay(at(3)), "night"); });
test("morning + patrolling is calm and signed by Higgins", () => { const g = higginsGreeting("resting", at(8)); assert.match(g.text, /^(Good morning|A very good morning)/); assert.match(g.text, /Higgins here\./); assert.match(g.text, /Apollo/); assert.equal(g.tone, "resting"); });
test("barking greeting points to Patrol and never says 'this morning' in the evening", () => { const g = higginsGreeting("barking", at(19)); assert.match(g.text, /^(Good evening|A pleasant evening)/); assert.match(g.text, /Patrol/); assert.doesNotMatch(g.text, /this morning/); });
test("deterministic within a day, varies across days", () => {
  assert.equal(higginsGreeting("resting", at(8)).text, higginsGreeting("resting", new Date(2026, 5, 15, 9, 0)).text);
  const texts = new Set([0, 1, 2].map((i) => higginsGreeting("resting", new Date(2026, 5, 15 + i, 8, 0)).text));
  assert.ok(texts.size > 1);
});
test("visibility lost points to Guard", () => { assert.match(higginsGreeting("lost", at(8)).text, /Guard/); });
test("dayKey is local calendar day", () => { assert.equal(dayKey(new Date(2026, 5, 7, 23, 59)), "2026-06-07"); });
