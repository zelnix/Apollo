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

import { followUpLine, pendingFollowUps } from "../src/domain/higginsChecks.ts";
const now = new Date("2026-06-03T09:00:00Z");
const twoDays = "2026-06-01T08:00:00Z", yesterday = "2026-06-02T08:00:00Z", today = "2026-06-03T08:00:00Z";
test("follow-up only after a day, only for checks still not done since asked", () => {
  const due = pendingFollowUps([{ messageId: "a", askedAt: yesterday, checks: ["device", "account"] }, { messageId: "b", askedAt: today, checks: ["link"] }], { account: "2026-06-02T12:00:00Z" }, now);
  assert.equal(due.length, 1); assert.deepEqual(due[0].outstanding, ["device"]);
});
test("snoozed suggestions wait; older duplicates of a surfaced check are collapsed", () => {
  assert.equal(pendingFollowUps([{ messageId: "a", askedAt: yesterday, checks: ["device"], snoozedUntil: "2026-06-04T00:00:00Z" }], {}, now).length, 0);
  const due = pendingFollowUps([{ messageId: "old", askedAt: twoDays, checks: ["device"] }, { messageId: "new", askedAt: yesterday, checks: ["device"] }], {}, now);
  assert.equal(due.length, 1); assert.equal(due[0].suggestion.messageId, "new");
});
test("completion before the ask does not count", () => {
  assert.equal(pendingFollowUps([{ messageId: "a", askedAt: yesterday, checks: ["link"] }], { link: twoDays }, now).length, 1);
});
test("gentle wording", () => {
  assert.equal(followUpLine(["device"], yesterday, now), "Yesterday I suggested Check my device. No rush at all — it's still waiting whenever you have a quiet moment.");
  assert.match(followUpLine(["device", "account", "link"], twoDays, now), /^2 days ago I suggested Check my device, Account Guard and Check a link\. .*they're/);
});

// --- "Run a check" always names the checks -----------------------------------------------------------------------
import { checksSpoken, recommendedChecks } from "../src/domain/higginsChecks.ts";

test("stale verification lists the standard checks; visibility lost and steady states list none", () => {
  assert.deepEqual(recommendedChecks({ recovering: true, visibilityLost: false, drivingEvent: null }), ["device", "network", "account"]);
  assert.deepEqual(recommendedChecks({ recovering: false, visibilityLost: true, drivingEvent: null }), []);
  assert.deepEqual(recommendedChecks({ recovering: false, visibilityLost: false, drivingEvent: null }), []);
});

test("post-incident cooldown lists checks that fit the resolved event's category", () => {
  assert.deepEqual(recommendedChecks({ recovering: true, visibilityLost: false, drivingEvent: { category: "account" } }), ["account", "device"]);
  assert.deepEqual(recommendedChecks({ recovering: true, visibilityLost: false, drivingEvent: { category: "connection" } }), ["network", "device"]);
  assert.deepEqual(recommendedChecks({ recovering: true, visibilityLost: false, drivingEvent: { category: "known_threat" } }), ["device", "account"]);
});

test("spoken form names every check and where to find it, in order", () => {
  const spoken = checksSpoken(["device", "account"]);
  assert.match(spoken, /2 checks to run, most important first/);
  assert.match(spoken, /first, Check my device — under Home → Check my device/);
  assert.match(spoken, /second, Account Guard — under Home → Account Guard\./);
  assert.equal(checksSpoken(["link"]), "The check to run is Check a link — under Home → Check a link.");
  assert.equal(checksSpoken([]), "");
});
