import assert from "node:assert/strict";
import { test } from "node:test";

import { matchesPatrolFilter, patrolConsumerSummary, projectPatrolOutcomes } from "../src/domain/patrolOutcomes.ts";
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
  assert.equal(matchesPatrolFilter(outcomes[0], "needs_you"), true);
});

test("resolved filter semantics come only from resolved/trusted/contained outcomes", () => {
  const [outcome] = projectPatrolOutcomes([event({ status: "resolved", resolved_at: "2026-09-22T10:02:00Z" })]);
  assert.equal(matchesPatrolFilter(outcome, "resolved"), true);
});

test("Biting can only survive projection with verified block evidence", () => {
  assert.equal(projectPatrolOutcomes([event({ state: "biting", verified_block: false })])[0].state, "barking");
  assert.equal(projectPatrolOutcomes([event({ state: "biting", verified_block: true })])[0].state, "biting");
});

test("UX-06 patrol consumer summary: needs-you takes priority, else checking, else nothing", () => {
  assert.equal(patrolConsumerSummary([]), "Nothing needs you right now");
  // A growling outcome with a primaryAction counts as "needs you".
  const needs = projectPatrolOutcomes([event({ event_id: "n1" })]);
  assert.equal(patrolConsumerSummary(needs), "1 thing needs you");
  // An active ears_up warning with no action is a concern Apollo is checking, not a needs-you item.
  const checking = projectPatrolOutcomes([event({ event_id: "c1", state: "ears_up" })]);
  assert.equal(patrolConsumerSummary(checking), "Apollo is checking 1 concern");
  // A resting outcome needs nothing and isn't an active concern.
  const resolved = projectPatrolOutcomes([event({ event_id: "r1", state: "resting", status: "resolved", resolved_at: "2026-09-22T10:02:00Z" })]);
  assert.equal(patrolConsumerSummary(resolved), "Nothing needs you right now");
});
