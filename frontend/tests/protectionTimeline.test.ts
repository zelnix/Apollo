import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTodayTimeline, quietDayLine } from "../src/domain/protectionTimeline.ts";
import type { PatrolEvent } from "../src/domain/types.ts";

const NOW = new Date("2026-06-10T14:00:00Z").getTime();
const todayIso = (hours: number, minutes = 0) => new Date(new Date(NOW).setUTCHours(hours, minutes, 0, 0)).toISOString();
const yesterdayIso = () => new Date(NOW - 36 * 60 * 60 * 1000).toISOString();

const ev = (over: Partial<PatrolEvent>): PatrolEvent => ({
  event_id: "e", device_id: "d", category: "message", state: "growling", status: "active",
  headline: "Suspicious text", what_happened: "A text asked for money.", why: [], what_to_do: "",
  indicator_host: null, indicator_digest: null, verified_block: false, adapter_label: "Apollo",
  occurred_at: todayIso(10), resolved_at: null, ...over,
});

test("today's growling scam event is in the timeline, named by its gate", () => {
  const items = buildTodayTimeline({ events: [ev({})], gateHealthLog: {}, now: NOW });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "flagged");
  assert.match(items[0].title, /Text Gate/);
  assert.equal(items[0].tone, "growling");
});

test("yesterday's event is excluded (today only)", () => {
  const items = buildTodayTimeline({ events: [ev({ occurred_at: yesterdayIso() })], gateHealthLog: {}, now: NOW });
  assert.deepEqual(items, []);
});

test("gate health log 'Watching confirmed' entries from today are included", () => {
  const items = buildTodayTimeline({ events: [], gateHealthLog: { site: [todayIso(9)] }, now: NOW });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "confirmed_watching");
  assert.equal(items[0].tone, "resting");
  assert.match(items[0].title, /Site Gate.*Watching/);
});

test("resolved events today add a second 'resolved' entry (ordered newest first)", () => {
  const items = buildTodayTimeline({ events: [ev({ status: "resolved", occurred_at: todayIso(9), resolved_at: todayIso(11) })], gateHealthLog: {}, now: NOW });
  assert.equal(items.length, 2);
  assert.equal(items[0].kind, "resolved"); // 11:00 — newest first
  assert.equal(items[1].kind, "flagged");  // 09:00
});

test("verified block today becomes a 'blocked' entry (biting tone)", () => {
  const items = buildTodayTimeline({ events: [ev({ state: "biting", verified_block: true, headline: "Blocked phishing" })], gateHealthLog: {}, now: NOW });
  assert.equal(items[0].kind, "blocked");
  assert.equal(items[0].tone, "biting");
});

test("empty timeline is honest — the quiet-day line gives a plain-English reassurance", () => {
  const items = buildTodayTimeline({ events: [], gateHealthLog: {}, now: NOW });
  assert.deepEqual(items, []);
  assert.ok(quietDayLine().toLowerCase().includes("today"));
});
