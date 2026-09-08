// Higgins' check suggestions: parsing the machine-readable trailer and completion tracking.
import assert from "node:assert/strict";
import { test } from "node:test";

import { isDone, parseChecks, progressLine } from "../src/domain/higginsChecks.ts";

test("trailer is stripped and ids parsed in order, deduped, unknown dropped", () => {
  const r = parseChecks("Do run Check a message and Check my accounts, would you?\n\nCHECKS: message, account, message, banana");
  assert.equal(r.text, "Do run Check a message and Check my accounts, would you?");
  assert.deepEqual(r.checks, ["message", "account"]);
});
test("no trailer → text untouched, no checks", () => { const r = parseChecks("Growling means uncertain."); assert.equal(r.text, "Growling means uncertain."); assert.deepEqual(r.checks, []); });
test("tolerates case, 'CHECK:' and odd spacing", () => { assert.deepEqual(parseChecks("x\ncheck:  Link ;device").checks, ["link", "device"]); });
test("completion only counts after Higgins asked", () => {
  assert.equal(isDone("2026-06-01T10:00:00Z", "2026-06-01T09:00:00Z"), true);
  assert.equal(isDone("2026-06-01T08:00:00Z", "2026-06-01T09:00:00Z"), false);
  assert.equal(isDone(undefined, "2026-06-01T09:00:00Z"), false);
});
test("progress wording", () => { assert.equal(progressLine(0, 2), "0 of 2 done"); assert.equal(progressLine(2, 2), "All 2 done — thank you."); assert.equal(progressLine(1, 1), "Done — thank you."); assert.equal(progressLine(0, 0), ""); });
