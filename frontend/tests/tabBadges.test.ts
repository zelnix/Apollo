import assert from "node:assert/strict";
import { test } from "node:test";

import { badgeText, countNeedingYou, countNewSevereAlerts } from "../src/domain/tabBadges.ts";

const event = (id: string, state: string, at: string, extra: Record<string, unknown> = {}) =>
  ({ event_id: id, case_key: extra.case_key ?? id, state, occurred_at: at, ...extra }) as never;

test("Threats counts each case that still needs the person, once, by its latest event", () => {
  const events = [
    event("a1", "barking", "2026-06-01T10:00:00Z", { case_key: "a" }),
    event("a2", "barking", "2026-06-01T11:00:00Z", { case_key: "a" }),
    event("b1", "biting", "2026-06-01T09:00:00Z"),
    event("c1", "growling", "2026-06-01T09:00:00Z"),
    event("d1", "barking", "2026-06-01T09:00:00Z", { resolved_at: "2026-06-01T12:00:00Z" }),
  ];
  assert.equal(countNeedingYou(events), 2);
});

test("a handled case stops counting when its latest event is handled", () => {
  const events = [
    event("a1", "barking", "2026-06-01T10:00:00Z", { case_key: "a" }),
    event("a2", "barking", "2026-06-01T11:00:00Z", { case_key: "a", resolved_at: "2026-06-01T11:00:00Z" }),
  ];
  assert.equal(countNeedingYou(events), 0);
  assert.equal(countNeedingYou([]), 0);
});

test("Scam Alerts counts only new High and Extreme alerts that apply here", () => {
  const alerts = [
    { url: "u1", severity: "HIGH", appliesIn: "everywhere" },
    { url: "u2", severity: "EXTREME", appliesIn: "AU" },
    { url: "u3", severity: "MODERATE", appliesIn: "everywhere" },
    { url: "u4", severity: "LOW", appliesIn: "AU" },
    { url: "u5", severity: "HIGH", appliesIn: "US" },
    { url: "u6", severity: "HIGH", appliesIn: "AU" },
    { url: "u1", severity: "HIGH", appliesIn: "everywhere" },
  ];
  assert.equal(countNewSevereAlerts(alerts, new Set(["u6"]), "AU"), 2);
  assert.equal(countNewSevereAlerts(alerts, new Set(["u1", "u2", "u6"]), "AU"), 0);
  assert.equal(countNewSevereAlerts(alerts, new Set(), "US"), 2);
});

test("the badge shows nothing at zero and caps at 9+", () => {
  assert.equal(badgeText(0), undefined);
  assert.equal(badgeText(-1), undefined);
  assert.equal(badgeText(3), "3");
  assert.equal(badgeText(9), "9");
  assert.equal(badgeText(12), "9+");
});
