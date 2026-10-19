import assert from "node:assert/strict";
import test from "node:test";
import { STATE_LABEL, STATE_NAME } from "../src/domain/types.ts";

test("Apollo's safe state is always presented as Patrolling", () => {
  assert.equal(STATE_NAME.resting, "Patrolling");
  assert.equal(STATE_LABEL.resting, "Apollo is Patrolling");
  assert.doesNotMatch(`${STATE_NAME.resting} ${STATE_LABEL.resting}`, /resting/i);
});