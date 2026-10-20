import assert from "node:assert/strict";
import test from "node:test";

import { recheckPlan } from "../src/domain/recheckPlan.ts";
import type { PatrolEvent } from "../src/domain/types.ts";

function ev(partial: Partial<PatrolEvent>): PatrolEvent {
  return {
    event_id: "e1", device_id: "d1", category: "device", state: "barking", status: "active",
    headline: "", what_happened: "", why: [], what_to_do: "",
    indicator_host: null, indicator_digest: null, verified_block: false, adapter_label: "test",
    occurred_at: "2026-06-10T09:00:00.000Z", resolved_at: null,
    ...partial,
  } as PatrolEvent;
}

test("a website case re-runs in place with its recorded link", () => {
  const plan = recheckPlan(ev({ category: "website", indicator_host: "paypal-secure.top" }));
  assert.deepEqual(plan, { kind: "link", label: "Re-check this website now", url: "https://paypal-secure.top/" });
});

test("a call case re-checks the recorded number", () => {
  const plan = recheckPlan(ev({ category: "call", local_indicator: "+61 412 345 678" }));
  assert.equal(plan.kind, "number");
});

test("device cases re-check in the Device check", () => {
  const plan = recheckPlan(ev({ category: "device" }));
  assert.equal(plan.kind, "gate");
  if (plan.kind === "gate") assert.equal(plan.route, "/device");
});

test("a website case with no recorded link says so instead of pretending", () => {
  const plan = recheckPlan(ev({ category: "website" }));
  assert.equal(plan.kind, "none");
  if (plan.kind === "none") assert.match(plan.reason, /didn't record a link/);
});
