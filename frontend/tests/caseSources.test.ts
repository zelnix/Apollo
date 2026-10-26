import assert from "node:assert/strict";
import test from "node:test";

import { buildCaseSources } from "../src/domain/caseSources.ts";
import type { PatrolEvent } from "../src/domain/types.ts";

function ev(partial: Partial<PatrolEvent>): PatrolEvent {
  return {
    event_id: "e1", device_id: "d1", category: "device", state: "barking", status: "active",
    headline: "Device management profile is active", what_happened: "", why: [], what_to_do: "",
    indicator_host: null, indicator_digest: null, verified_block: false,
    adapter_label: "test", occurred_at: "2026-06-10T09:00:00.000Z", resolved_at: null,
    ...partial,
  } as PatrolEvent;
}

test("an on-device finding reports the device as the source and what it recorded", () => {
  const sources = buildCaseSources({ event: ev({ evidence_provenance: "local_device", why: ["Profile name: Acme MDM", "Granted rights: install apps"] }) });
  assert.equal(sources.length, 1);
  assert.match(sources[0].name, /This device/);
  assert.equal(sources[0].returned, "Read directly on the device — 2 recorded details about the finding");
  assert.equal(sources[0].answered, true);
});

test("Triage is reported with its counts, says Magnum DI was not engaged, and gaps name the source in plain English", () => {
  const sources = buildCaseSources({
    event: ev({
      evidence_provenance: "local_device",
      triage_investigation: {
        investigationId: "tri-1", catalogueVersion: 1, sourceType: "link",
        outcome: "LIMITED_UNABLE_TO_DETERMINE", reason: "A reputation service didn't answer.",
        rulesApplicable: ["L01", "L02", "L03"], rulesChecked: ["L01", "L02"], rulesMet: ["L01"], rules: [],
        coverageGaps: [{ code: "INTELLIGENCE_PROVIDER_UNAVAILABLE", detail: "", recoverable: true, ruleIds: ["L03"] }],
        retries: [], correlation: {}, recheckUseful: true, geminiCalls: 0, evaluatedAt: "2026-06-10T09:01:00.000Z",
      },
    }),
  });
  const triage = sources.find((s) => s.id === "triage")!;
  assert.equal(triage.returned, "2 of 3 applicable checks completed, 1 matched. Magnum DI was not engaged.");
  const gap = sources.find((s) => s.id.startsWith("gap:"))!;
  assert.equal(gap.name, "Threat-reputation service");
  assert.equal(gap.returned, "A reputation service didn't answer in time.");
  assert.equal(gap.answered, false);
  assert.ok(sources.every((s) => !/\bAI\b|[A-Z]+_[A-Z]+/.test(s.returned)));
});

test("a Triage that opened an investigation says where it went", () => {
  const triage = {
    investigationId: "tri-2", catalogueVersion: 1, sourceType: "call", outcome: "POSSIBLE_THREAT_IDENTIFIED" as const, reason: "x",
    rulesApplicable: ["C01"], rulesChecked: ["C01"], rulesMet: ["C01"], rules: [], coverageGaps: [], retries: [], correlation: {},
    recheckUseful: false, geminiCalls: 0 as const, evaluatedAt: "2026-06-10T09:01:00.000Z",
  };
  const escalated = buildCaseSources({ event: ev({ triage_investigation: triage, investigation_case_id: "case-9" }), investigation: null });
  assert.match(escalated.find((s) => s.id === "triage")!.returned, /Escalated to Magnum DI\.$/);
  const settled = buildCaseSources({
    event: ev({ triage_investigation: triage, investigation_case_id: "case-9" }),
    investigation: { answeredBy: "teddy_official", response: { findings: [] }, sources: [] } as never,
  });
  assert.match(settled.find((s) => s.id === "triage")!.returned, /TC FlyBy settled it — Magnum DI was not engaged\.$/);
  assert.equal(settled.find((s) => s.id === "magnum")!.name, "TC FlyBy investigation");
});

test("a DNS detection names the list that matched", () => {
  const sources = buildCaseSources({ event: ev({ category: "website", evidence_provenance: "dns_observation", indicator_host: "paypal-secure.top" }) });
  assert.match(sources[0].name, /known-threat list/);
  assert.match(sources[0].returned, /paypal-secure\.top/);
});

test("an investigation whose result isn't stored locally is reported honestly", () => {
  const sources = buildCaseSources({ event: ev({ evidence_provenance: "local_device", investigation_case_id: "case-1" }), investigation: null });
  const magnum = sources.find((s) => s.id === "magnum")!;
  assert.equal(magnum.returned, "Result not stored on this device");
  assert.equal(magnum.answered, false);
});
