// The Threat Case Evidence tab (domain/caseEvidence.ts): source evidence kept apart from what TC FlyBy and Magnum DI
// found, one status per piece from its own record, only stages that happened on the trail, and the findings in the
// case result's own words. Run: cd /app/frontend && node --test tests/caseEvidence.test.ts
import assert from "node:assert/strict";
import test from "node:test";

import { caseFindings } from "../src/domain/caseBriefing.ts";
import { caseEvidence, evidenceSummaryLine, evidenceTrail } from "../src/domain/caseEvidence.ts";
import type { PatrolEvent } from "../src/domain/types.ts";

function ev(partial: Partial<PatrolEvent> = {}): PatrolEvent {
  return {
    event_id: "e1", device_id: "phone-a", category: "message", state: "growling", status: "active", origin: "user",
    headline: "Message using CommBank's name checked", what_happened: "A text asked you to cancel a payment through a link.",
    why: ["commbank-cancel.co isn't CommBank's domain."], what_to_do: "Don't open the link.",
    indicator_host: "commbank-cancel.co", indicator_digest: null, verified_block: false, adapter_label: "test",
    occurred_at: "2026-10-28T01:12:00.000Z", resolved_at: null, investigation_case_id: "case-1",
    investigation_completed_at: "2026-10-28T01:12:30.000Z", investigation_answered_by: "teddy",
    evidence_provenance: "device_submission", processing_source: "apollosg_servers", evidence_representation: "full_record",
    ...partial,
  } as PatrolEvent;
}

const coverage = { status: "examined", unit: "characters", total: 168, examined: 168, materialGap: false } as never;
const item = (over: Record<string, unknown>) => ({
  id: "EV-1", caseId: "case-1", clientItemId: "c1", displayId: "EV-1", origin: "user_submission", kind: "text", parentId: null,
  availability: "available", mediaType: null, byteLength: null, integrityHash: null, provenance: null, coverage,
  simulation: null, transformations: [], label: "Submitted message text", expiresAt: "2026-10-28T02:00:00Z",
  collectedAt: "2026-10-28T01:12:00.000Z", ...over,
});

const finding = { id: "f1", text: "commbank-cancel.co carries CommBank's name, but it isn't CommBank's domain.", basis: "observation", confidence: "high", evidenceIds: ["EV-1", "EV-2"], sourceIds: [] };
const response = (over: Record<string, unknown> = {}) => ({
  revision: 1, overview: "Concerning.", explanationMarkdown: "", assessment: "concern_found", outcome: "concerning", attention: "review",
  attentionReason: null, findings: [finding], uncertainties: [], scope: "", sourceIds: [], remainingEvidenceIds: [], actions: [],
  recommendedActionId: null, question: null, completion: "complete", ...over,
});
const investigation = (over: Record<string, unknown> = {}, resp: Record<string, unknown> = {}) => ({
  caseId: "case-1", gates: ["text"], status: "complete", createdAt: "2026-10-28T01:12:00Z", completedAt: "2026-10-28T01:12:30Z",
  committedAt: "2026-10-28T01:12:30Z", question: "", sources: [], turns: [], patrolEventId: "e1", answeredBy: "teddy",
  evidenceItems: [item({}), item({ id: "EV-2", displayId: "EV-2", kind: "url", parentId: "EV-1", label: "URL from message", coverage: { status: "examined", unit: "items", total: 1, examined: 1, materialGap: false } })],
  response: response(resp), ...over,
}) as never;

const build = (e: PatrolEvent, inv: never | null) => caseEvidence({ event: e, investigation: inv, trace: null, records: [], facts: [e.headline] });

test("a message and the link taken out of it are named plainly, by where they came from", () => {
  const out = build(ev(), investigation());
  assert.deepEqual(out.device.map((p) => p.name), ["Message you submitted", "Link in the message"]);
  assert.match(out.device[0].description, /^The message you sent Apollo to check — 168 characters, read in full\.$/);
  assert.equal(out.device[1].description, "A link found in the message you sent Apollo to check.");
  for (const p of out.device) assert.doesNotMatch(`${p.name} ${p.description}`, /submitted message text|URL from message/i);
  // Only the item the case is about opens its full original.
  assert.deepEqual(out.device.map((p) => p.primary), [true, false]);
});

test("each piece's status comes from its own record — read in full and relied on is Supporting, never Verified", () => {
  const out = build(ev(), investigation());
  assert.deepEqual(out.device.map((p) => p.status), ["supporting", "supporting"]);
  // A device's own reading is the only device evidence that is Verified.
  const observed = build(ev(), investigation({ evidenceItems: [item({ origin: "device_observation", label: "observation:wifi.ssid" })] }));
  assert.equal(observed.device[0].status, "verified");
  assert.equal(observed.device[0].source, "This device");
  // Not read in full, a preview sample, or relied on by no finding: Unconfirmed.
  const partial = build(ev(), investigation({ evidenceItems: [item({ coverage: { status: "partial", unit: "characters", total: 168, examined: 40, materialGap: true } })] }));
  assert.equal(partial.device[0].status, "unconfirmed");
  const sample = build(ev(), investigation({ evidenceItems: [item({ simulation: { kind: "preview_device", label: "Sample", fixtureId: "x" } })] }));
  assert.equal(sample.device[0].status, "unconfirmed");
  const unused = build(ev(), investigation({}, { findings: [{ ...finding, evidenceIds: [] }] }));
  assert.equal(unused.device[0].status, "unconfirmed");
});

test("findings keep the case result's words and investigator; contrary findings are shown but never counted", () => {
  const inv = investigation();
  const out = build(ev(), inv);
  const found = caseFindings((inv as { response: never }).response);
  assert.deepEqual(out.findings.map((f) => f.text), found.map((f) => f.text));
  assert.equal(out.findings[0].by, "TC FlyBy");
  assert.deepEqual(out.findings[0].basedOn, ["Message you submitted (above)", "Link in the message (above)"]);
  const magnum = build(ev({ investigation_answered_by: "magnum" }), investigation({ answeredBy: "magnum" }));
  assert.equal(magnum.findings[0].by, "Magnum DI");

  const briefing = {
    version: 1, subject: null, headline: "h", summary: "s", supporting: [], contrary: [], unresolved: [], status: "Concerning",
    statusCode: "concerning", attention: "review", statusReason: "", userActionRequired: false, actionReason: null, recommendedAction: null,
    fidelity: { status: "PASS", failures: [] },
    findings: [
      { id: "f1", subject: null, subjectType: null, organisation: null, check: "", result: "", finding: finding.text, evidenceIds: ["EV-1"], sourceIds: [], materiality: "material", confidence: "high", basis: "observation", stance: "supporting" },
      { id: "f2", subject: null, subjectType: null, organisation: null, check: "", result: "", finding: "The sender number is a real CommBank number.", evidenceIds: ["EV-1"], sourceIds: [], materiality: "material", confidence: "high", basis: "observation", stance: "contrary" },
    ],
  };
  const mixed = build(ev(), investigation({}, { briefing }));
  assert.equal(mixed.findings.length, 2);
  assert.equal(mixed.findings[1].status, null);
  // The message (cited) + the supporting finding; the link no finding cites is Unconfirmed; the contrary one is in no count.
  assert.deepEqual(mixed.counts, { verified: 0, supporting: 2, unconfirmed: 1 });
});

test("the summary says how many pieces support the finding — Unconfirmed pieces never do", () => {
  assert.equal(evidenceSummaryLine({ total: 2, counts: { verified: 1, supporting: 1, unconfirmed: 0 } }), "2 pieces of evidence support this finding");
  assert.equal(evidenceSummaryLine({ total: 3, counts: { verified: 0, supporting: 1, unconfirmed: 2 } }), "1 piece of evidence supports this finding");
  assert.equal(evidenceSummaryLine({ total: 2, counts: { verified: 0, supporting: 0, unconfirmed: 2 } }), "2 pieces of evidence recorded, none of it confirmed");
  assert.equal(evidenceSummaryLine({ total: 0, counts: { verified: 0, supporting: 0, unconfirmed: 0 } }), "No evidence was recorded for this finding");
});

test("the trail lists only the stages that happened", () => {
  const triage = { evaluatedAt: "2026-10-28T01:12:01Z" } as never;
  const flyby = { ranAt: "2026-10-28T01:12:10Z", resolved: true } as never;
  const settled = evidenceTrail({ event: ev(), trace: { triage, flyby, magnum: null } as never, records: [] });
  assert.deepEqual(settled.map((s) => `${s.name}: ${s.status}`), ["Higgins Triage: Completed", "TC FlyBy: Completed"]);
  const escalated = evidenceTrail({
    event: ev({ investigation_answered_by: "magnum" }), trace: { triage, flyby: { ranAt: "2026-10-28T01:12:10Z", resolved: false }, magnum: { at: "2026-10-28T01:12:20Z" } } as never,
    records: [{ status: "success", failureCode: null, simulated: false, occurredAt: "2026-10-28T01:12:20Z" }] as never,
  });
  assert.deepEqual(escalated.map((s) => `${s.name}: ${s.status}`), ["Higgins Triage: Completed", "TC FlyBy: Escalated to Magnum DI", "Magnum DI: Completed"]);
  const running = evidenceTrail({ event: ev({ investigation_completed_at: null }), trace: null, records: [] });
  assert.deepEqual(running.map((s) => `${s.name}: ${s.status}`), ["TC FlyBy: In progress"]);
});

test("a case no investigation answered shows its own item, never an investigation finding", () => {
  const out = build(ev({ investigation_case_id: null, investigation_completed_at: null, origin: "apollo", evidence_provenance: "dns_observation", category: "connection" }), null);
  assert.equal(out.findings.length, 0);
  assert.equal(out.device.length, 1);
  assert.equal(out.device[0].status, "verified");
  assert.equal(out.collectedFrom, "Collected from this device.");
});
