// Resubmit after Magnum DI's one call + one retry: waits for the server's pause, then sends the same material again.
// Run: node --test tests/resubmit.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { canResubmit, formatWait, resubmitLabels, resubmitWaitSeconds } from "../src/investigation/resubmit.ts";

const NOW = Date.parse("2026-06-10T12:00:00Z");

test("the wait counts down to the server's resubmitAt and never goes negative", () => {
  assert.equal(resubmitWaitSeconds({ resubmitAt: new Date(NOW + 300_000).toISOString() }, NOW), 300);
  assert.equal(resubmitWaitSeconds({ resubmitAt: new Date(NOW + 1_500).toISOString() }, NOW), 2);
  assert.equal(resubmitWaitSeconds({ resubmitAt: new Date(NOW - 10_000).toISOString() }, NOW), 0);
});

test("no pause from the server means resubmit is available now", () => {
  assert.equal(resubmitWaitSeconds(null, NOW), 0);
  assert.equal(resubmitWaitSeconds({ resubmitAt: null }, NOW), 0);
  assert.equal(resubmitWaitSeconds({ resubmitAt: "not a date" }, NOW), 0);
});

test("the wait reads as m:ss", () => {
  assert.equal(formatWait(300), "5:00");
  assert.equal(formatWait(65), "1:05");
  assert.equal(formatWait(0), "0:00");
});

test("labels: waiting, ready and busy", () => {
  assert.equal(resubmitLabels(272, false).title, "Resubmit in 4:32");
  assert.match(resubmitLabels(272, false).description, /Everything you submitted is kept/);
  assert.equal(resubmitLabels(0, false).title, "Resubmit");
  assert.match(resubmitLabels(0, false).description, /nothing to re-enter/);
  assert.equal(resubmitLabels(0, true).title, "Resubmitting…");
});

test("a failure another attempt cannot fix offers no Resubmit", () => {
  assert.equal(canResubmit({ retryable: false }), false);
  assert.equal(canResubmit({ retryable: true }), true);
  assert.equal(canResubmit(null), true);
});
