import assert from "node:assert/strict";
import { test } from "node:test";

import { buildHomeAttention } from "../src/domain/homeAttention.ts";
import type { GatePresentation } from "../src/domain/gates.ts";
import type { PatrolEvent } from "../src/domain/types.ts";

const gate = (over: Partial<GatePresentation> & Pick<GatePresentation, "id" | "tone">): GatePresentation => ({
  id: over.id, title: over.title ?? "Internet Gate", purpose: "", currentHelp: over.currentHelp ?? "Protection stopped.",
  statusLabel: "Action needed", tone: over.tone,
  capability: over.capability ?? { automatic: { kind: "monitoring", state: "interrupted", limitation: "Reconnect to restore protection." } },
  primaryAction: over.primaryAction ?? { id: "check_network", label: "Reconnect Internet Gate" },
});

const event = (over: Partial<PatrolEvent>): PatrolEvent => ({
  event_id: "e1", device_id: "d1", category: "app", state: "barking", status: "active",
  headline: "Suspicious app", what_happened: "An app can control your screen.", why: ["remote access"],
  what_to_do: "Remove the app in Settings.", indicator_host: null, indicator_digest: null, verified_block: false,
  adapter_label: "Apollo", occurred_at: "2026-10-08T04:00:00Z", resolved_at: null, ...over,
});

test("a gate in Action needed becomes a specific attention item (gate named + Higgins step)", () => {
  const items = buildHomeAttention({ gates: [gate({ id: "site", tone: "action", title: "Site Gate", currentHelp: "Website protection stopped.", primaryAction: { id: "restore_site", label: "Turn on Site Gate" }, capability: { automatic: { kind: "enforcement", state: "interrupted", limitation: "Turn Site Gate back on." } } })], events: [] });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "gate");
  assert.equal(items[0].title, "Site Gate needs attention");
  assert.equal(items[0].problem, "Website protection stopped.");
  assert.equal(items[0].higgins, "Turn Site Gate back on.");
  assert.equal(items[0].actionLabel, "Turn on Site Gate");
});

test("an active barking event becomes an attention item naming the gate and the fix", () => {
  const items = buildHomeAttention({ gates: [], events: [event({})] });
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, "event");
  assert.equal(items[0].gate, "App Gate");
  assert.equal(items[0].problem, "An app can control your screen.");
  assert.equal(items[0].higgins, "Remove the app in Settings.");
  assert.match(items[0].route, /^\/patrol\//);
});

test("optional setup and 'worth checking' growls never create attention items (no false barking)", () => {
  const gates = [gate({ id: "text", tone: "neutral" }), gate({ id: "email", tone: "neutral" })];
  const events = [event({ event_id: "g1", state: "growling" }), event({ event_id: "r1", state: "resting", status: "resolved", resolved_at: "2026-10-08T04:05:00Z" })];
  assert.deepEqual(buildHomeAttention({ gates, events }), []);
});

test("a resolved barking event is no longer active, so it drops out of attention", () => {
  const items = buildHomeAttention({ gates: [], events: [event({ status: "resolved", resolved_at: "2026-10-08T04:05:00Z" })] });
  assert.equal(items.length, 0);
});

test("gate failures are listed before event decisions", () => {
  const items = buildHomeAttention({ gates: [gate({ id: "site", tone: "action" })], events: [event({})] });
  assert.equal(items[0].kind, "gate");
  assert.equal(items[1].kind, "event");
});
