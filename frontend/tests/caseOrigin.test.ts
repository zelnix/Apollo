// Threat Case origin rule — regression tests. Every Threat Case begins on the device that detected it; server
// processing, Magnum DI, syncing, privacy projection and missing evidence never move a case's origin; checks that
// didn't finish show the actual check and its recorded reason. Run: cd /app/frontend && node --test tests/caseOrigin.test.ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  ORIGIN_LABEL, caseOrigin, completenessLabel, evidenceSourceLabel, hasRecordedFindings, privacyNote, processingLabels, triageShortfalls,
} from "../src/domain/caseFacts.ts";
import { buildCaseSources, sourceHeading } from "../src/domain/caseSources.ts";
import { deviceCheckEvent } from "../src/domain/deviceCheckCase.ts";
import { mergeLocalAndRemoteEvents } from "../src/domain/eventMerge.ts";
import { buildEvidencePack } from "../src/domain/evidencePack.ts";
import { narrateEvent, narrateIncident } from "../src/domain/higginsNarration.ts";
import { projectedEventVoice } from "../src/domain/messageVoice.ts";
import { caseGroupKey } from "../src/domain/threatCase.ts";
import { gapPlainEnglish, type TriageInvestigationRecord } from "../src/domain/triage/contract.ts";
import type { ApolloState, PatrolEvent } from "../src/domain/types.ts";

/** Wording that would place a case, or its evidence, on some other device. */
const PROHIBITED = /another device|other device|device where it happened|originating device|not available on this device|not stored on this device|recorded on another device|browser session/i;

const PROVENANCES = ["local_device", "server_projected", "dns_observation", "native_protection", "incomplete", undefined] as const;

function ev(partial: Partial<PatrolEvent> = {}): PatrolEvent {
  return {
    event_id: "e1", device_id: "phone-a", category: "message", state: "growling", status: "active",
    headline: "Message: parcel redelivery text", what_happened: "A text asked for a redelivery fee through a link.",
    why: ["The link isn't on the courier's own website."], what_to_do: "Don't tap the link.",
    indicator_host: "parcel-fee.top", indicator_digest: null, verified_block: false, adapter_label: "test",
    occurred_at: "2026-10-26T14:10:00.000Z", resolved_at: null, ...partial,
  } as PatrolEvent;
}

const rule = (ruleId: string, code: string, reason: string) => ({
  ruleId, title: ruleId, category: "link", applicable: true, checked: false, result: "coverage_gap" as const,
  evidence: reason ? [reason] : [], coverageGap: code, detail: "",
});

function triage(over: Partial<TriageInvestigationRecord> = {}): TriageInvestigationRecord {
  return {
    investigationId: "tri-1", catalogueVersion: 3, sourceType: "message", outcome: "NO_THREAT_IDENTIFIED", reason: "x",
    rulesApplicable: ["LINK-01", "LINK-10", "PWA-01"], rulesChecked: [], rulesMet: [], rules: [], coverageGaps: [],
    incompleteChecks: [], retries: [], correlation: {}, recheckUseful: false, geminiCalls: 0, evaluatedAt: "2026-10-26T14:10:05.000Z",
    ...over,
  };
}

/** Every person-facing string a Threat Case produces from one event. */
function caseText(event: PatrolEvent): string[] {
  const sources = buildCaseSources({ event, investigation: null });
  const facts = [event.headline, ...event.why];
  return [
    caseOrigin(event).label, evidenceSourceLabel(event), ...processingLabels(event), completenessLabel(event), privacyNote(event) ?? "",
    ...sources.flatMap((s) => [sourceHeading(s), s.returned]),
    ...narrateEvent(event).map((c) => c.text),
    buildEvidencePack({ event, facts, sources }),
  ];
}

const variants = (): PatrolEvent[] => PROVENANCES.flatMap((evidence_provenance) => [
  ev({ evidence_provenance }),
  ev({ evidence_provenance, triage_investigation: triage() }),
  ev({ evidence_provenance, investigation_case_id: "case-1" }),
  ev({ evidence_provenance, investigation_case_id: "case-1", investigation_completed_at: "2026-10-26T14:12:00.000Z", investigation_answered_by: "teddy_kb" }),
]);

test("every Threat Case's origin is the device that detected it", () => {
  for (const event of variants()) {
    assert.deepEqual(caseOrigin(event), { deviceId: "phone-a", label: ORIGIN_LABEL }, `origin for ${event.evidence_provenance}`);
    for (const text of caseText(event)) assert.doesNotMatch(text, PROHIBITED, `${event.evidence_provenance}: ${text}`);
  }
});

test("server_projected never changes the case's origin, and server analysis stays attached to the same case", () => {
  const local = ev({ evidence_provenance: "dns_observation", what_happened: "Apollo's DNS filter matched parcel-fee.top." });
  const remote = ev({ ...projectedEventVoice("message", "growling", false), evidence_provenance: "server_projected", device_id: "phone-a",
    what_happened: projectedEventVoice("message", "growling", false).whatHappened, investigation_case_id: "case-1" });
  const { events } = mergeLocalAndRemoteEvents([local], [remote]);
  assert.equal(events.length, 1, "one case");
  assert.equal(events[0].device_id, "phone-a");
  assert.equal(events[0].evidence_provenance, "dns_observation", "the summary never replaces what this device recorded");
  assert.equal(events[0].what_happened, local.what_happened);
  assert.equal(events[0].investigation_case_id, "case-1", "the server's analysis is attached to this case");
  assert.equal(caseOrigin(events[0]).label, ORIGIN_LABEL);
  // A server record with no local copy (e.g. after a reinstall) is still this device's own case.
  const onlyServer = ev({ evidence_provenance: "server_projected" });
  assert.equal(caseOrigin(onlyServer).deviceId, onlyServer.device_id);
  assert.match(privacyNote(onlyServer)!, /privacy-protected summary/);
  assert.doesNotMatch(privacyNote(ev({ evidence_provenance: "server_projected", triage_investigation: triage() }))!, PROHIBITED);
});

test("DNS, native protection, server-assisted analysis and incomplete records narrate what Apollo has", () => {
  for (const event of [
    ev({ evidence_provenance: "dns_observation" }), ev({ evidence_provenance: "native_protection", source_metadata: { type: "link", provider: "Samsung Message Guard" } }),
    ev({ evidence_provenance: "server_projected", triage_investigation: triage() }), ev({ evidence_provenance: "incomplete" }),
  ]) {
    assert.ok(hasRecordedFindings(event), `${event.evidence_provenance} carries what Apollo recorded`);
    const what = narrateEvent(event).find((c) => c.id === "what")!.text;
    assert.match(what, /redelivery fee/, `${event.evidence_provenance} is narrated from its own record`);
  }
  // Only the privacy summary: Higgins says exactly that, invents nothing, and points nowhere else.
  const summary = ev({ ...projectedEventVoice("message", "barking", false), evidence_provenance: "server_projected", state: "barking" });
  const chunks = narrateEvent(summary);
  assert.match(chunks.find((c) => c.id === "what")!.text, /privacy-protected summary/);
  assert.match(chunks.find((c) => c.id === "todo")!.text, /contact you already trust/);
  const incident = narrateIncident({ headline: "Connected", state: "barking", timeline: [ev({}), summary], exposure: [], steps: [], allResolved: false } as never);
  for (const c of incident) assert.doesNotMatch(c.text, PROHIBITED);
  for (const state of ["resting", "ears_up", "growling", "barking", "biting"] as ApolloState[]) {
    for (const v of [projectedEventVoice("message", state, false), projectedEventVoice("website", state, true)]) {
      for (const text of Object.values(v)) assert.doesNotMatch(text, PROHIBITED);
    }
  }
});

test("incomplete checks show the actual check and their exact recorded failure", () => {
  const record = triage({
    incompleteChecks: [
      { check: "final_destination", status: "unresolved", failure: "nonexistent_domain", detail: "", source: "redirect", at: null },
      { check: "reputation", status: "unavailable", failure: "timeout", detail: "", source: "google_safe_browsing", at: null },
      { check: "sender_authentication", status: "unavailable", failure: "original_not_provided", detail: "", source: null, at: null },
      { check: "number_reputation", status: "unavailable", failure: null, detail: "carrier lookup returned 503", source: null, at: null },
    ],
    rules: [
      rule("LINK-01", "INTELLIGENCE_PROVIDER_UNAVAILABLE", "reputation lookup did not complete (timeout)"),
      rule("LINK-10", "INTELLIGENCE_PROVIDER_UNAVAILABLE", "domain registration age unavailable"),
      rule("PWA-01", "BROWSER_VISIBILITY_UNAVAILABLE", "PWA origin is not observable on this platform"),
    ],
    coverageGaps: [
      { code: "INTELLIGENCE_PROVIDER_UNAVAILABLE", detail: "reputation lookup did not complete (timeout)", recoverable: true, ruleIds: ["LINK-01", "LINK-10"] },
      { code: "BROWSER_VISIBILITY_UNAVAILABLE", detail: "PWA origin is not observable on this platform", recoverable: false, ruleIds: ["PWA-01"] },
    ],
  });
  const rows = triageShortfalls(record).map((r) => `${r.name} — ${r.status}: ${r.reason}`);
  assert.deepEqual(rows, [
    "Final destination — couldn't be verified: The website's address doesn't exist.",
    "Reputation check — didn't answer: The service timed out.",
    "Sender authentication — didn't answer: ApolloSG didn't receive the full email headers.",
    "Phone number reputation — didn't answer: Carrier lookup returned 503.",
    "Domain registration age — couldn't be checked: Domain registration age unavailable.",
    "Website the installed web app came from — couldn't be checked: PWA origin is not observable on this platform.",
  ]);
  const generic = new Set(["INTELLIGENCE_PROVIDER_UNAVAILABLE", "BROWSER_VISIBILITY_UNAVAILABLE"].map(gapPlainEnglish));
  const sources = buildCaseSources({ event: ev({ evidence_provenance: "local_device", triage_investigation: record }) });
  for (const s of sources) {
    assert.ok(!generic.has(s.returned), `generic gap wording replaced a recorded reason: ${s.returned}`);
    assert.doesNotMatch(s.name, /browser session/i);
  }
  assert.ok(sources.some((s) => s.name === "Final destination" && s.returned === "The website's address doesn't exist." && !s.answered));
  // A missing check narrows what was verified; it never becomes a concern.
  assert.equal(completenessLabel(ev({ triage_investigation: record })), "6 checks couldn't be completed — each is listed with its reason");
});

test("the Evidence Pack carries the five case facts and no device-location wording", () => {
  for (const event of variants()) {
    const pack = buildEvidencePack({ event, facts: [event.headline], sources: buildCaseSources({ event, investigation: null }) });
    assert.match(pack, /^Origin: Detected on this device$/m);
    assert.match(pack, /^Evidence: /m);
    assert.match(pack, /^Record: /m);
    assert.doesNotMatch(pack, PROHIBITED);
  }
  const withGaps = ev({ evidence_provenance: "local_device", triage_investigation: triage({
    incompleteChecks: [{ check: "final_destination", status: "unresolved", failure: "nonexistent_domain", detail: "", source: null, at: null }] }) });
  const pack = buildEvidencePack({ event: withGaps, facts: [], sources: buildCaseSources({ event: withGaps }) });
  assert.match(pack, /- Final destination — couldn't be verified: The website's address doesn't exist\./);
});

test("an independent detection on a second device is its own Threat Case, not a continuation of the first", () => {
  const first = ev({ event_id: "a-1", device_id: "phone-a", scent_id: "s-1", evidence_provenance: "local_device" });
  const second = ev({ event_id: "b-1", device_id: "phone-b", scent_id: "s-1", evidence_provenance: "local_device" });
  assert.notEqual(caseGroupKey(second), caseGroupKey(first));
  assert.equal(caseOrigin(second).deviceId, "phone-b");
  assert.equal(caseOrigin(first).deviceId, "phone-a");
  const checkA = deviceCheckEvent({ eventId: "c-a", deviceId: "phone-a", adapterLabel: "x", platformLabel: "android",
    briefing: { headline: "Looks good", findings: [], action: null, overall: "clear" } });
  const checkB = deviceCheckEvent({ eventId: "c-b", deviceId: "phone-b", adapterLabel: "x", platformLabel: "android",
    briefing: { headline: "Looks good", findings: [], action: null, overall: "clear" } });
  assert.notEqual(caseGroupKey(checkA), caseGroupKey(checkB));
  // Merging never folds one device's case into another's, and never rewrites a case's origin.
  const { events } = mergeLocalAndRemoteEvents([first], [{ ...first, device_id: "phone-b" }]);
  assert.equal(events[0].device_id, "phone-a");
});
