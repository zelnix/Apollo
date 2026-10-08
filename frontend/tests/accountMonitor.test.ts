// Account Gate — exposure monitoring domain logic. Run: node --test tests/accountMonitor.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildWeeklyReport, deriveGateState, diffExposures, isDue, maskEmail, scanSummary, type AccountScan } from "../src/domain/accountMonitor.ts";

const scan = (results: AccountScan["results"], at = new Date().toISOString()): AccountScan => ({ at, provider: "xposedornot", sourceLabel: "XposedOrNot", results });
const found = (email: string, names: string[], pw = false): AccountScan["results"][number] => ({ email, status: "found", breaches: names.map((n) => ({ name: n, date: "" })), passwordExposed: pw, detail: "" });
const clear = (email: string): AccountScan["results"][number] => ({ email, status: "clear", breaches: [], passwordExposed: false, detail: "" });
const unavailable = (email: string): AccountScan["results"][number] => ({ email, status: "unavailable", breaches: [], passwordExposed: false, detail: "couldn't check" });

test("maskEmail hides the local part but keeps the domain", () => {
  assert.equal(maskEmail("joanne@gmail.com"), "jo***@gmail.com");
  assert.match(maskEmail("ab@x.io"), /@x\.io$/);
});

test("isDue is true with no prior check and after 7 days", () => {
  assert.equal(isDue(null), true);
  assert.equal(isDue(new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString()), true);
  assert.equal(isDue(new Date(Date.now() - 24 * 3600 * 1000).toISOString()), false);
});

test("diffExposures reports newly-appeared and resolved breaches only", () => {
  const prev = scan([found("me@x.io", ["Alpha"])]);
  const next = scan([found("me@x.io", ["Alpha", "Beta"])]);
  const d = diffExposures(prev, next);
  assert.deepEqual(d.newExposures, [{ email: "me@x.io", breaches: ["Beta"] }]);
  assert.deepEqual(d.resolved, []);
  const d2 = diffExposures(next, scan([found("me@x.io", ["Beta"])]));
  assert.deepEqual(d2.resolved, [{ email: "me@x.io", breaches: ["Alpha"] }]);
});

test("gate state covers the key outcomes", () => {
  const now = Date.now();
  const fresh = new Date(now).toISOString();
  const stale = new Date(now - 9 * 24 * 3600 * 1000).toISOString();
  assert.equal(deriveGateState({ monitoredCount: 0, lastScan: null, lastCheckedAt: null, checking: false }).state, "not_set_up");
  assert.equal(deriveGateState({ monitoredCount: 1, lastScan: null, lastCheckedAt: null, checking: true }).state, "checking");
  assert.equal(deriveGateState({ monitoredCount: 1, lastScan: scan([clear("me@x.io")], fresh), lastCheckedAt: fresh, checking: false, now }).state, "no_exposure");
  assert.equal(deriveGateState({ monitoredCount: 1, lastScan: scan([found("me@x.io", ["A"], true)], fresh), lastCheckedAt: fresh, checking: false, now }).state, "action_needed");
  assert.equal(deriveGateState({ monitoredCount: 1, lastScan: scan([found("me@x.io", ["A"])], fresh), lastCheckedAt: fresh, checking: false, now }).state, "exposure_found");
  assert.equal(deriveGateState({ monitoredCount: 1, lastScan: scan([clear("me@x.io")], stale), lastCheckedAt: stale, checking: false, now }).state, "overdue");
});

test("weekly report is generated even when clean, flags partial coverage, never leaks a raw email", () => {
  const report = buildWeeklyReport(scan([clear("joanne@gmail.com"), unavailable("bob@x.io")]), null);
  assert.ok(report.sections.some((s) => s.title === "What to do"));
  assert.ok(report.sections.some((s) => s.title === "Couldn't be checked this time"));
  const flat = JSON.stringify(report);
  assert.ok(!flat.includes("joanne@gmail.com"));
  assert.ok(flat.includes("jo***@gmail.com"));
  assert.equal(report.sourceLabel, "XposedOrNot");
});

test("password exposure drives a growling report headline", () => {
  const report = buildWeeklyReport(scan([found("me@x.io", ["Breach"], true)]), null);
  assert.equal(report.overall, "growling");
  assert.equal(scanSummary(scan([found("me@x.io", ["Breach"], true)])).passwordExposed, true);
});
