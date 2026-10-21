import assert from "node:assert/strict";
import test from "node:test";

import { buildEvidencePack } from "../src/domain/evidencePack.ts";
import type { PatrolEvent } from "../src/domain/types.ts";

const event = {
  event_id: "e1", device_id: "d1", category: "device", state: "barking", status: "resolved",
  headline: "Device management profile is active", what_happened: "", why: [], what_to_do: "",
  indicator_host: null, indicator_digest: null, verified_block: false, adapter_label: "test",
  occurred_at: "2026-06-10T09:00:00.000Z", resolved_at: "2026-06-12T09:00:00.000Z",
} as PatrolEvent;

test("the pack lists the recorded facts and every source with what it returned", () => {
  const pack = buildEvidencePack({
    event,
    facts: ["Device management profile is active", "Profile name: Acme MDM"],
    sources: [
      { id: "device", name: "This device", returned: "Read directly on the device — 2 recorded details", at: "2026-06-10T09:00:00.000Z", answered: true },
      { id: "gap", name: "Threat-reputation service", returned: "A reputation service didn't answer in time.", at: null, answered: false },
    ],
  });
  assert.match(pack, /Apollo Threat Case TC-2026-/);
  assert.match(pack, /Status: Handled/);
  assert.match(pack, /- Profile name: Acme MDM/);
  assert.match(pack, /- This device: Read directly on the device/);
  assert.match(pack, /Threat-reputation service — didn't answer/);
  assert.match(pack, /no interpretation has been added/);
});

test("the pack is honest when nothing was recorded", () => {
  const pack = buildEvidencePack({ event, facts: [], sources: [] });
  assert.match(pack, /No detail was recorded on this device/);
  assert.match(pack, /No sources were recorded for this case/);
});
