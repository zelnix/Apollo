// Times Apollo stores are UTC; one saved without its zone must still read as UTC, so the phone shows its own local time.
import { test } from "node:test";
import assert from "node:assert/strict";

import { asUtc } from "../src/domain/utcTime.ts";
import { normalizeHistoricalEvent } from "../src/domain/packetEvidence.ts";
import type { PatrolEvent } from "../src/domain/types.ts";

test("a time saved without its zone is marked as UTC; anything else is unchanged", () => {
  assert.equal(asUtc("2026-10-25T05:33:00.123000"), "2026-10-25T05:33:00.123000Z");
  assert.equal(asUtc("2026-10-25T05:33:00Z"), "2026-10-25T05:33:00Z");
  assert.equal(asUtc("2026-10-25T05:33:00+00:00"), "2026-10-25T05:33:00+00:00");
  assert.equal(asUtc("2026-10-25T13:33:00+0800"), "2026-10-25T13:33:00+0800");
  assert.equal(asUtc(null), null);
  assert.equal(asUtc("not a time"), "not a time");
});

test("a threat's times are read as UTC, so 05:33 UTC is 1:33 pm on a phone in Perth", () => {
  const event = { event_id: "e", state: "growling", verified_block: false, occurred_at: "2026-10-25T05:33:00.123000", resolved_at: null } as unknown as PatrolEvent;
  const shown = normalizeHistoricalEvent(event);
  assert.equal(shown.occurred_at, "2026-10-25T05:33:00.123000Z");
  assert.equal(shown.resolved_at, null);
  assert.equal(Date.parse(shown.occurred_at), Date.UTC(2026, 9, 25, 5, 33, 0, 123));
  assert.ok(!("reopened_at" in shown), "absent times stay absent");
});
