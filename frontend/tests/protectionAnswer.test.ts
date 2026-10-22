// "Is my device protected?" — Higgins answers the question: plain English first, one problem at a
// time, one action at a time, technical detail only when asked.
// Run: cd /app/frontend && node --test tests/protectionAnswer.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { getProtectionStatus } from "../src/higgins/diagnosticCore.ts";

// Shaped as the health snapshot really carries gates: tone drives "needs attention", and the
// capability's automatic state drives "running".
const gate = (over: Record<string, unknown> = {}) => ({
  id: "site", title: "Website protection", statusLabel: "Watching", tone: "ok",
  capability: { automatic: { state: "running", limitation: null } },
  resolved: { coverageState: "active_verified", isAutomatic: true },
  ...over,
} as never);

const offGate = (id: string, title: string, tone: string, limitation: string | null) =>
  gate({ id, title, statusLabel: "Off", tone, capability: { automatic: { state: "off", limitation } },
         resolved: { coverageState: "off", isAutomatic: false } });

const unsupportedGate = (id: string, title: string) =>
  gate({ id, title, statusLabel: "Not available on this device", tone: "neutral",
         capability: { automatic: { state: "unsupported", limitation: "This platform doesn't allow it." } },
         resolved: { coverageState: "unsupported", isAutomatic: false } });

const snapshot = (over: Record<string, unknown> = {}) => ({
  revision: 1, checkedAt: "2026-10-20T02:43:00Z", trigger: "user_action", checking: false,
  // ProtectionStatus reports `running` — there is no `state` field, so a fixture that sets one
  // reads as "not running" and every answer below would start with "No —".
  capabilities: [], protection: { running: true, requested: true, operational: true },
  permissions: [], network: null, ruleBundle: null, lastCheckFailure: null, gates: [gate()],
  ...over,
} as never);

test("fully protected: answers yes, names no problem, adds no technical clutter", () => {
  const out = getProtectionStatus(snapshot());
  assert.match(out.summary, /^Yes —/);
  assert.match(out.summary, /all 1 protections on this device are on/);
  assert.match(out.summary, /I last checked at/);
  assert.equal(out.attentionNeeded, false);
});

test("something needs attention: answers partly, names ONE problem and ONE action", () => {
  const out = getProtectionStatus(snapshot({
    gates: [
      offGate("site", "Website protection", "action", "it's switched off"),
      offGate("call", "Call protection", "action", "it's switched off"),
    ],
  }));
  assert.match(out.summary, /^Partly\./);
  // one problem only — the second gate is not named in the main answer
  assert.match(out.summary, /website protection/i);
  assert.ok(!/call protection/i.test(out.summary), out.summary);
  // one action
  assert.equal((out.summary.match(/Open Apollo's protection settings/g) ?? []).length, 1);
  assert.equal(out.attentionNeeded, true);
});

test("never claims nothing needs attention while protections are off", () => {
  const out = getProtectionStatus(snapshot({
    gates: [gate(), unsupportedGate("call", "Call protection")],
  }));
  assert.ok(!/No issues need attention/.test(out.summary), out.summary);
  assert.match(out.summary, /1 of the 2 protections on this device is on/);
  assert.match(out.summary, /other one isn't available on this device/);
});

test("protection service down: answers no and gives the single step", () => {
  const out = getProtectionStatus(snapshot({ protection: { running: false, requested: false, operational: false } }));
  assert.match(out.summary, /^No — Apollo's protection isn't running/);
  assert.match(out.summary, /turn Apollo's protection back on/);
  assert.ok(!/No issues need attention/.test(out.summary));
  assert.equal(out.attentionNeeded, true);
});

test("the unavailable security-rule check is not dumped into the answer", () => {
  const out = getProtectionStatus(snapshot());
  assert.ok(!/security rules/i.test(out.summary), out.summary);
  // The fact itself is still recorded for "More details".
  assert.match(String((out.facts as Record<string, unknown>).rulesDetail), /can't report the state/);
});
