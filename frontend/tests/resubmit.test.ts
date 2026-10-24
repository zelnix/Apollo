// Resubmit after Magnum DI's one call + one retry: waits for the server's pause, then sends the same material again.
// Run: node --test tests/resubmit.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { canResubmit, dueReminder, formatWait, resubmitLabels, resubmitWaitSeconds, type StoppedCase, withStopped } from "../src/investigation/resubmit.ts";

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

// ── Quiet reminder on Ask Higgins ────────────────────────────────────────────
const at = (ms: number) => new Date(NOW + ms).toISOString();
const stopped = (over: Partial<StoppedCase> = {}): Omit<StoppedCase, "status"> =>
  ({ caseId: "case-a", jobId: "job-a", resubmitAt: at(300_000), expiresAt: at(900_000), ...over });

test("the note appears only once the pause is over, and never after the case expires", () => {
  const items = withStopped([], stopped(), NOW);
  assert.equal(dueReminder(items, NOW, null), null, "still in Magnum DI's pause");
  assert.equal(dueReminder(items, NOW + 300_000, null)?.caseId, "case-a", "ready to resubmit");
  assert.equal(dueReminder(items, NOW + 900_000, null), null, "the case itself has expired");
});

test("no note for the investigation already on screen, or one the person dismissed", () => {
  const items = withStopped([], stopped(), NOW);
  assert.equal(dueReminder(items, NOW + 400_000, "case-a"), null);
  const dismissed = items.map((item) => ({ ...item, status: "dismissed" as const }));
  assert.equal(dueReminder(dismissed, NOW + 400_000, null), null);
});

test("remembering the same pause keeps a dismissal; a new pause brings the note back", () => {
  const dismissed = withStopped([], stopped(), NOW).map((item) => ({ ...item, status: "dismissed" as const }));
  assert.equal(withStopped(dismissed, stopped(), NOW)[0].status, "dismissed");
  const again = withStopped(dismissed, stopped({ resubmitAt: at(600_000) }), NOW);
  assert.equal(again.length, 1);
  assert.equal(again[0].status, "waiting");
});

test("expired cases are dropped and malformed times never remind", () => {
  const old = withStopped([], stopped({ caseId: "old", expiresAt: at(-1) }), NOW - 10_000);
  assert.deepEqual(withStopped(old, stopped(), NOW).map((item) => item.caseId), ["case-a"]);
  const bad = withStopped([], stopped({ resubmitAt: "not a date" }), NOW);
  assert.equal(dueReminder(bad, NOW + 400_000, null), null);
});
