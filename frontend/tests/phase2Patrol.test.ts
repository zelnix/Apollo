import assert from "node:assert/strict";
import { test } from "node:test";

import { projectPatrolOutcomes } from "../src/domain/patrolOutcomes.ts";
import type { PatrolEvent } from "../src/domain/types.ts";

const event = (overrides: Partial<PatrolEvent>): PatrolEvent => ({ event_id: "event-1", device_id: "device-1234", category: "message", state: "growling", status: "active", headline: "Message warning", what_happened: "The message used an urgent payment story.", why: ["Urgent request"], what_to_do: "Do not reply.", indicator_host: "example.test", indicator_digest: "same-indicator", verified_block: false, adapter_label: "Apollo", occurred_at: "2026-09-22T10:00:00Z", resolved_at: null, ...overrides });

test("V34 Patrol removes commands and folds a repeated incident into one outcome", () => {
  const outcomes = projectPatrolOutcomes([
    event({ event_id: "command", category: "protection", headline: "Enable protection requested", what_happened: "Request submitted." }),
    event({ event_id: "first" }),
    event({ event_id: "second", occurred_at: "2026-09-22T10:05:00Z" }),
  ]);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].repeatCount, 2);
  assert.equal(outcomes[0].status, "needs_you");
});

test("handled filter semantics come only from resolved/trusted/contained outcomes", () => {
  const [outcome] = projectPatrolOutcomes([event({ status: "resolved", resolved_at: "2026-09-22T10:02:00Z" })]);
  assert.equal(outcome.status, "handled");
});