// What changed between two device checks — only ever what each check actually recorded.
// Run: cd /app/frontend && node --test tests/deviceCheckProgress.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { comparableChecks, compareDeviceChecks } from "../src/domain/deviceCheckProgress.ts";

const check = (id: string, outcome: string, title = id) => ({ id, title, outcome });

test("a setting read as correct after being a problem is reported as fixed", () => {
  const progress = compareDeviceChecks([check("lock", "action", "Screen lock")], [check("lock", "checked", "Screen lock")]);
  assert.deepEqual(progress.changes.map((c) => c.kind), ["fixed"]);
  assert.match(progress.changes[0].detail, /Was needing attention/);
  assert.equal(progress.summary, "1 fixed");
});

test("a problem the later check couldn't read is never counted as fixed", () => {
  const progress = compareDeviceChecks([check("vpn", "action")], [check("vpn", "unavailable")]);
  assert.deepEqual(progress.changes.map((c) => c.kind), ["not_confirmed"]);
  assert.match(progress.changes[0].detail, /not confirmed fixed/);
  assert.equal(progress.summary, "1 not confirmed");
});

test("new and still-open problems are named separately", () => {
  const progress = compareDeviceChecks(
    [check("lock", "action", "Screen lock"), check("updates", "checked", "Updates")],
    [check("lock", "review", "Screen lock"), check("updates", "action", "Updates")],
  );
  assert.deepEqual(progress.changes.map((c) => [c.id, c.kind]), [["lock", "still_open"], ["updates", "new_problem"]]);
  assert.equal(progress.summary, "1 new · 1 still needing attention");
});

test("unchanged correct settings produce no noise", () => {
  const progress = compareDeviceChecks([check("lock", "checked")], [check("lock", "checked")]);
  assert.deepEqual(progress.changes, []);
  assert.equal(progress.summary, "Nothing changed since the last check.");
});

test("stored review results are read; anything else is not comparable", () => {
  assert.deepEqual(comparableChecks({ overall: "review", results: [{ id: "lock", title: "Screen lock", outcome: "action", risk: null }] }),
                   [{ id: "lock", title: "Screen lock", outcome: "action" }]);
  assert.equal(comparableChecks({ state: "growling", findings: [] }), null);
  assert.equal(comparableChecks(null), null);
  assert.equal(comparableChecks({ results: [{ id: 1 }] }), null);
});
