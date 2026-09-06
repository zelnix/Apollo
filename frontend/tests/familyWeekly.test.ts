// Family Weekly Check-In sentences. Run: yarn test:family
import assert from "node:assert/strict";
import { test } from "node:test";

import { type FamilyWeekly, lastSeenLabel, weeklyDetails, weeklyHeadline } from "../src/domain/familyWeekly.ts";

const NOW = Date.parse("2026-06-15T12:00:00Z");
const base = (o: Partial<FamilyWeekly>): FamilyWeekly => ({ protected_device_id: "p", owner_name: "Mum", phone: "", week_start: "", total: 0, by_state: {}, alerts: 0, open_alerts: 0, handled_alerts: 0, blocked: 0, active_days: 0, shared_incidents: 0, shared_resolved: 0, last_seen_at: "2026-06-15T11:30:00Z", ...o });

test("nothing happened but phone active → quiet week, resting", () => { const h = weeklyHeadline(base({}), NOW); assert.equal(h.tone, "resting"); assert.match(h.text, /quiet week for Mum/); });
test("nothing synced and phone silent 7+ days → truthful no-news", () => { const h = weeklyHeadline(base({ last_seen_at: "2026-06-01T00:00:00Z" }), NOW); assert.equal(h.tone, "neutral"); assert.match(h.text, /hasn't heard from Mum's phone/); });
test("only calm checks → calm week with count", () => { const h = weeklyHeadline(base({ total: 12, active_days: 4 }), NOW); assert.equal(h.tone, "resting"); assert.match(h.text, /12 things/); assert.deepEqual(weeklyDetails(base({ total: 12, active_days: 4 })), ["12 checks over 4 days"]); });
test("alerts all handled → ears_up, nothing open", () => { const h = weeklyHeadline(base({ total: 5, alerts: 2, handled_alerts: 2 }), NOW); assert.equal(h.tone, "ears_up"); assert.match(h.text, /2 alerts .* handled them all/); });
test("open alert → growling, suggests a call", () => { const h = weeklyHeadline(base({ total: 5, alerts: 1, open_alerts: 1 }), NOW); assert.equal(h.tone, "growling"); assert.match(h.text, /1 alert still open/); });
test("details list blocked + shared incidents", () => {
  assert.deepEqual(weeklyDetails(base({ total: 3, active_days: 1, blocked: 1, handled_alerts: 1, shared_incidents: 1, shared_resolved: 1 })), ["3 checks over 1 day", "1 blocked by Apollo", "1 alert handled", "1 incident shared with you, all handled"]);
});
test("last seen labels", () => {
  assert.equal(lastSeenLabel(base({}), NOW), "Their Apollo was active in the last hour.");
  assert.equal(lastSeenLabel(base({ last_seen_at: "2026-06-15T06:00:00Z" }), NOW), "Their Apollo was active 6h ago.");
  assert.equal(lastSeenLabel(base({ last_seen_at: "2026-06-12T06:00:00Z" }), NOW), "Their Apollo was last active 3 days ago.");
  assert.equal(lastSeenLabel(base({ last_seen_at: null }), NOW), "Apollo has never heard from their phone.");
});
