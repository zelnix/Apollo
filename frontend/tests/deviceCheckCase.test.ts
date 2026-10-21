// A completed device check becomes a case, recorded honestly.
// Run: cd /app/frontend && node --test tests/deviceCheckCase.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { deviceCheckEvent } from "../src/domain/deviceCheckCase.ts";
import { threatCaseStatus, caseGroupKey } from "../src/domain/threatCase.ts";

const build = (overall: string, findings: string[], action: string | null = null) =>
  deviceCheckEvent({
    eventId: "e1", deviceId: "d1", adapterLabel: "Apollo security module", platformLabel: "android",
    checkedAt: "2026-10-20T14:39:00Z",
    briefing: { headline: overall === "clear" ? "Your device looks good" : "1 item needs your attention", findings, action, overall },
  });

test("a clean check stays an open case that found nothing, until the person closes it", () => {
  const event = build("clear", ["12 settings are correctly configured."]);
  assert.equal(event.category, "device");
  assert.equal(event.state, "resting");
  assert.equal(event.status, "active");
  assert.equal(event.resolved_at, null);
  assert.equal(threatCaseStatus(event), "monitoring");
  assert.match(event.what_to_do, /Nothing to do/);
});

test("every check on a device shares one case key, so a recheck is not a new case", () => {
  const first = build("action", ["Screen lock is off."], "Turn the screen lock on.");
  const second = deviceCheckEvent({
    eventId: "e2", deviceId: "d1", adapterLabel: "Apollo security module", platformLabel: "android",
    checkedAt: "2026-10-20T15:10:00Z",
    briefing: { headline: "Your device looks good", findings: ["13 settings are correctly configured."], action: null, overall: "clear" },
  });
  assert.equal(first.case_key, "device-check:d1");
  assert.equal(caseGroupKey(second), caseGroupKey(first));
  // Two separate patrol entries — the full trail stays in patrol history.
  assert.notEqual(first.event_id, second.event_id);
  // One case in Threats, showing the latest check.
  const seen = new Set<string>();
  const cases = [second, first].filter((e) => !seen.has(caseGroupKey(e)) && seen.add(caseGroupKey(e)));
  assert.deepEqual(cases.map((e) => e.event_id), ["e2"]);
});

test("a check on another device is its own case", () => {
  const mine = build("clear", ["All good."]);
  const other = deviceCheckEvent({
    eventId: "e3", deviceId: "d2", adapterLabel: "Apollo security module", platformLabel: "ios",
    checkedAt: "2026-10-20T15:10:00Z",
    briefing: { headline: "Your device looks good", findings: ["All good."], action: null, overall: "clear" },
  });
  assert.notEqual(caseGroupKey(other), caseGroupKey(mine));
});

test("items needing attention are filed as an open case carrying the one action", () => {
  const event = build("action", ["Apollo protection is off — no automatic protection is running."],
                      "Open Apollo's protection settings and turn protection on.");
  assert.equal(event.state, "growling");
  assert.equal(event.status, "active");
  assert.equal(event.resolved_at, null);
  // "growling": a real concern found, but not an active attack — Apollo does not overstate it.
  assert.equal(threatCaseStatus(event), "monitoring");
  assert.equal(event.what_to_do, "Open Apollo's protection settings and turn protection on.");
  assert.deepEqual(event.why, ["Apollo protection is off — no automatic protection is running."]);
});

test("a check that did not run is never recorded as clear", () => {
  const event = build("error", ["The read failed, so this check did not run."]);
  assert.notEqual(event.state, "resting");
  assert.equal(event.status, "active");
  assert.equal(event.headline, "Device check didn't run");
  assert.match(event.what_happened, /did not complete/);
});

test("the case carries what it is, for the list and for history", () => {
  const event = build("review", ["Screen lock could be improved."], "Review the screen lock.");
  assert.equal(event.evidence_provenance, "local_device");
  assert.equal(event.verified_block, false);
  assert.equal(event.background, false);
  assert.equal(event.source_metadata?.type, "device");
  assert.equal(event.occurred_at, "2026-10-20T14:39:00Z");
});
