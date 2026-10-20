// The "Current status" line must describe THIS case. A closed case must never read as still running.
// Run: cd /app/frontend && node --test tests/caseStatusLine.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { caseStatusLine } from "../src/domain/threatCase.ts";

const base = {
  event_id: "e1", device_id: "d1", category: "message", state: "growling", status: "active",
  headline: "Apollo flagged a text message for review", what_happened: "", why: [], what_to_do: "",
  occurred_at: "2026-10-20T16:48:00Z", resolved_at: null, verified_block: false, background: false,
  trust_allowed: false, evidence_provenance: "local_device",
} as never;

const withFields = (over: Record<string, unknown>) => ({ ...(base as object), ...over }) as never;

test("a closed case states it is closed, not investigating", () => {
  const line = caseStatusLine(withFields({ resolved_at: "2026-10-20T17:10:00Z", investigation_case_id: "case-1" }))!;
  assert.equal(line.running, false);
  assert.equal(line.title, "Closed");
  assert.match(line.detail, /Nothing is running/);
});

test("a closed case with nothing found says so", () => {
  const line = caseStatusLine(withFields({ resolved_at: "2026-10-20T17:10:00Z", state: "resting" }))!;
  assert.equal(line.title, "Closed — no threat found");
  assert.equal(line.running, false);
});

test("an open case with a live investigation is the only one that reads as running", () => {
  const line = caseStatusLine(withFields({ investigation_case_id: "case-1" }))!;
  assert.equal(line.title, "Investigating with Magnum DI");
  assert.equal(line.running, true);
});

test("a verified block and a case needing attention each state their own position", () => {
  const blocked = caseStatusLine(withFields({
    verified_block: true,
    enforcement_evidence: { mechanism: "packet_filter", enforced_action: "blocked", observed_at: "2026-10-20T16:49:00Z" },
  }))!;
  assert.equal(blocked.title, "Blocked by Apollo");
  assert.equal(blocked.running, false);

  const attention = caseStatusLine(withFields({ state: "barking" }))!;
  assert.equal(attention.title, "Waiting for you");
  assert.equal(attention.running, false);
});
