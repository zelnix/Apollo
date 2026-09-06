// Higgins' narration of events and incidents. Run: yarn test:narration
import assert from "node:assert/strict";
import { test } from "node:test";

import { narrateEvent, narrateIncident } from "../src/domain/higginsNarration.ts";
import { buildIncidentPlan } from "../src/domain/incidentPlan.ts";
import type { PatrolEvent } from "../src/domain/types";

const ev = (o: Partial<PatrolEvent>): PatrolEvent => ({ event_id: "e1", device_id: "d", category: "message", state: "growling", status: "active", headline: "Message: CommBank SMS", what_happened: "A text claiming to be CommBank.", why: ["Link is not on CommBank's official domain", "Urgent wording."], what_to_do: "Don't tap the link.", indicator_host: null, indicator_digest: null, verified_block: false, adapter_label: "mock", occurred_at: "2026-06-01T09:14:00Z", resolved_at: null, ...o } as PatrolEvent);

test("event narration goes state → what → why (ordinals) → what to do", () => {
  const c = narrateEvent(ev({}));
  assert.deepEqual(c.map((x) => x.id), ["state", "what", "why", "todo"]);
  assert.match(c[0].text, /^Higgins here\. Apollo is growling\./);
  assert.match(c[2].text, /first, Link is not on CommBank's official domain\. second, Urgent wording\./);
  assert.match(c[3].text, /^What to do: Don't tap the link\./);
});
test("handled / contained events get a closing line", () => {
  assert.match(narrateEvent(ev({ status: "resolved" })).at(-1)!.text, /handled/);
  assert.match(narrateEvent(ev({ status: "resolved", state: "biting", verified_block: true })).at(-1)!.text, /blocked and is contained/);
});
test("incident narration: summary, events in order, plan steps with ticks", () => {
  const plan = buildIncidentPlan([ev({ event_id: "e1", scent_id: "s" }), ev({ event_id: "e2", scent_id: "s", category: "account", state: "barking", headline: "Account: Login prompt", occurred_at: "2026-06-01T09:16:00Z", why: ["You told Apollo: entered a password."] })]);
  const c = narrateIncident(plan, { [plan.steps[0].id]: true });
  assert.equal(c[0].id, "summary"); assert.match(c[0].text, /Apollo connected 2 events/);
  assert.match(c[1].text, /^It began, at .*message: CommBank SMS/); assert.match(c[2].text, /^Finally, at .*account/);
  const steps = c.filter((x) => x.id.startsWith("step-"));
  assert.equal(steps.length, plan.steps.length); assert.match(steps[0].text, /^Step 1, already done: /); assert.match(steps[1].text, /^Step 2: /);
  assert.equal(c.at(-1)!.id, "end");
});
