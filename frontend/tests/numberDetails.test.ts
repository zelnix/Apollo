// Number Details on a call's top card: which number a case is about, and the three rows in plain words.
// Run: node --test tests/numberDetails.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { callNumberOf, numberDetailItems } from "../src/domain/numberDetails.ts";
import type { PatrolEvent } from "../src/domain/types";
import type { OriginalSource } from "../src/store/originalSource";

const event = (over: Partial<PatrolEvent>): PatrolEvent => ({ event_id: "e1", category: "call", state: "growling", ...over }) as PatrolEvent;
const original = (over: Partial<OriginalSource>): OriginalSource => ({ kind: "call", capturedAt: "2026-10-29T10:00:00.000Z", origin: "this_device", ...over }) as OriginalSource;

test("a checked number comes from the kept original's Number field", () => {
  assert.equal(callNumberOf(original({ fields: [{ label: "Number", value: "+61419841238" }] }), null), "+61419841238");
});

test("a screened call with no kept original uses the number the case recorded", () => {
  assert.equal(callNumberOf(null, event({ local_indicator: "0419 841 238" })), "0419 841 238");
});

test("only calls get number details", () => {
  assert.equal(callNumberOf(null, event({ category: "message", local_indicator: "0419841238" })), null);
  assert.equal(callNumberOf(original({ kind: "text", fields: [{ label: "From", value: "0419841238" }] }), null), null);
  assert.equal(callNumberOf(null, event({ local_indicator: null })), null);
});

test("the rows say what the numbering plan gives, and say so when it gives nothing", () => {
  const mobile = numberDetailItems({ number: "+61419841238", valid: true, country_code: "AU", country: "Australia", line_type: "Mobile", network: "Telstra" });
  assert.deepEqual(mobile.map((i) => [i.label, i.value]), [["Country", "Australia"], ["Line type", "Mobile"], ["Original network", "Telstra"]]);
  const landline = numberDetailItems({ number: "+61298765432", valid: true, country_code: "AU", country: "Australia", line_type: "Landline", network: null });
  assert.equal(landline[2].value, "Not given for this number");
  const invalid = numberDetailItems({ number: "+61200000000", valid: false, country_code: "AU", country: "Australia", line_type: null, network: null });
  assert.equal(invalid[1].value, "Not a number in use");
});
