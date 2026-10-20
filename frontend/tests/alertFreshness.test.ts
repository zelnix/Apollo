// Alert freshness badge: the "updated X ago" line must be honest about when Apollo last
// successfully read the official sources. Run: cd frontend && node --test tests/alertFreshness.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { agoLabel, alertFreshness } from "../src/domain/alertFreshness.ts";

const NOW = Date.parse("2026-06-10T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

test("relative labels across the ranges", () => {
  assert.equal(agoLabel(NOW - 10_000, NOW), "just now");
  assert.equal(agoLabel(NOW - 60_000, NOW), "1 minute ago");
  assert.equal(agoLabel(NOW - 25 * 60_000, NOW), "25 minutes ago");
  assert.equal(agoLabel(NOW - 2 * 3_600_000, NOW), "2 hours ago");
  assert.equal(agoLabel(NOW - 26 * 3_600_000, NOW), "yesterday");
  assert.equal(agoLabel(NOW - 3 * 86_400_000, NOW), "3 days ago");
  assert.match(agoLabel(NOW - 40 * 86_400_000, NOW), /2026/);
});

test("fresh pull is not stale and carries an exact timestamp", () => {
  const f = alertFreshness(ago(2 * 3_600_000), NOW);
  assert.equal(f.label, "Updated 2 hours ago");
  assert.equal(f.stale, false);
  assert.ok(f.exact.length > 0);
});

test("a pull older than a day is marked stale", () => {
  assert.equal(alertFreshness(ago(3 * 86_400_000), NOW).stale, true);
});

test("unknown or unparsable timestamps never claim a refresh", () => {
  for (const value of [null, undefined, "", "not-a-date"]) {
    const f = alertFreshness(value, NOW);
    assert.equal(f.label, "Checking official sources…");
    assert.equal(f.stale, true);
    assert.equal(f.exact, "");
    assert.doesNotMatch(f.label, /Updated/);
  }
});

test("a future timestamp never reads as negative time", () => {
  assert.equal(alertFreshness(new Date(NOW + 60_000).toISOString(), NOW).label, "Updated just now");
});
