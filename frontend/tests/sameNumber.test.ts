// Same Number Reminder: the earlier result for the same number from the last 30 days.
// Run: node --test tests/sameNumber.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { daysAgo, earlierCheck, numberDigits, reminderTitle } from "../src/domain/sameNumber.ts";
import type { PatrolEvent } from "../src/domain/types";

const NOW = Date.parse("2026-10-29T12:00:00.000Z");
const daysBefore = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const call = (id: string, over: Partial<PatrolEvent> = {}): PatrolEvent => ({
  event_id: id, device_id: "d1", category: "call", state: "barking", status: "active", headline: "High-risk caller: +61419841238",
  what_happened: "", why: [], what_to_do: "", indicator_host: null, indicator_digest: null, verified_block: false,
  adapter_label: "", occurred_at: daysBefore(2), resolved_at: null, local_indicator: "+61419841238", origin: "user", ...over,
}) as PatrolEvent;

test("+61 and 0 forms of an Australian number are the same number", () => {
  assert.equal(numberDigits("+61 419 841 238"), "0419841238");
  assert.equal(numberDigits("0419-841-238"), "0419841238");
  assert.equal(numberDigits("+1 415 555 2671"), "14155552671");
});

test("a case about the same number in the last 30 days is the earlier result, and can be opened", () => {
  const e = earlierCheck({ number: "0419 841 238", key: null, events: [call("c1")], history: [], now: NOW });
  assert.ok(e);
  assert.equal(e.source, "case");
  assert.equal(e.eventId, "c1");
  assert.equal(e.state, "barking");
  assert.equal(e.summary, "High-risk caller: +61419841238");
  assert.equal(e.count, 1);
  assert.equal(reminderTitle(e), "You checked this number before");
});

test("an earlier check (kept as a one-way code) is matched by its code, newest first", () => {
  const history = [
    { at: daysBefore(1), state: "resting" as const, summary: "No strong risk signal", numberKey: "k1" },
    { at: daysBefore(3), state: "growling" as const, summary: "Some risk", numberKey: "k1" },
    { at: daysBefore(1), state: "barking" as const, summary: "Another number", numberKey: "k2" },
  ];
  const e = earlierCheck({ number: "+61419841238", key: "k1", events: [call("c1")], history, now: NOW });
  assert.ok(e);
  assert.equal(e.source, "check");
  assert.equal(e.summary, "No strong risk signal");
  assert.equal(e.eventId, "c1"); // the case about the number can still be opened
  assert.equal(e.count, 3);
});

test("a check and the case it opened count once; a case Apollo opened separately still counts", () => {
  const at = daysBefore(2);
  const history = [{ at: new Date(Date.parse(at) + 3_000).toISOString(), state: "growling" as const, summary: "Verify the caller", numberKey: "k1" }];
  const once = earlierCheck({ number: "+61419841238", key: "k1", events: [call("c1", { occurred_at: at })], history, now: NOW });
  assert.ok(once);
  assert.equal(once.count, 1);
  assert.equal(once.source, "check");
  assert.equal(once.eventId, "c1");
  const screened = earlierCheck({ number: "+61419841238", key: "k1", events: [call("c2", { occurred_at: at, origin: "apollo" })], history, now: NOW });
  assert.equal(screened?.count, 2);
});

test("nothing older than 30 days, another number, or a non-call case counts", () => {
  const events = [
    call("old", { occurred_at: daysBefore(31) }),
    call("other", { local_indicator: "+61400000000" }),
    call("sms", { category: "message", source_metadata: { type: "text", sender: "+61419841238" } }),
  ];
  const history = [{ at: daysBefore(40), state: "barking" as const, summary: "Old", numberKey: "k1" }];
  assert.equal(earlierCheck({ number: "+61419841238", key: "k1", events, history, now: NOW }), null);
});

test("a case Apollo opened says Apollo has seen the number", () => {
  const e = earlierCheck({ number: "+61419841238", key: null, events: [call("c1", { origin: "apollo" })], history: [], now: NOW });
  assert.ok(e);
  assert.equal(reminderTitle(e), "Apollo has seen this number before");
});

test("days ago reads as today, yesterday or N days ago", () => {
  assert.equal(daysAgo(new Date(NOW).toISOString(), NOW), "today");
  assert.equal(daysAgo(daysBefore(1), NOW), "yesterday");
  assert.equal(daysAgo(daysBefore(5), NOW), "5 days ago");
});
