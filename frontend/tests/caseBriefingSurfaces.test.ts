// Home, Threats and notifications all say one case the same way: its Higgins Case Briefing, subject always named.
import assert from "node:assert/strict";
import { test } from "node:test";

import { needsYou } from "../src/domain/caseBriefing.ts";
import { briefedLine } from "../src/domain/higginsHomeVoice.ts";
import { matchesPatrolFilter, projectPatrolOutcomes } from "../src/domain/patrolOutcomes.ts";
import { notificationSummary } from "../src/push/notificationText.ts";

const event = (id: string, state: string, briefing: Record<string, unknown>) => ({
  event_id: id, device_id: "d", category: "email", state, status: "active", headline: "Stoko email checked",
  what_happened: String(briefing.summary), why: [], what_to_do: "", verified_block: false, evidence_provenance: "local_device",
  occurred_at: "2026-10-26T13:50:00Z", resolved_at: null, supporting_references: [], investigation_case_id: `case-${id}`,
  investigation_completed_at: "2026-10-26T14:00:00Z",
  case_briefing: { from: "briefing", subject: null, findings: [], unresolved: [], status: "", statusReason: "", recommendedAction: null,
    userActionRequired: false, actionReason: null, ...briefing },
}) as never;

const STOKO = event("stoko", "resting", { headline: "Stoko email checked",
  summary: '"hello@stoko.com" is a published Stoko contact. No scam warning was found for "stoko.com". Still unresolved: Apollo can\'t confirm who actually sent this.' });
const LOOKALIKE = event("alike", "barking", { headline: "Link using Stoko's name checked",
  summary: "The material names Stoko, but st0ko-login.co isn't Stoko's domain (stoko.com).",
  userActionRequired: true, actionReason: "Anything typed into that link goes to whoever runs st0ko-login.co, not Stoko." });

test("a Threats card is titled and summarised by the briefing, never by a generic line", () => {
  const [outcome] = projectPatrolOutcomes([STOKO]);
  assert.equal(outcome.title, "Stoko email checked");
  assert.match(outcome.summary, /"hello@stoko\.com" is a published Stoko contact\. No scam warning was found for "stoko\.com"\./);
  assert.match(outcome.summary, /Still unresolved: Apollo can't confirm who actually sent this\./);
  assert.equal(matchesPatrolFilter(outcome, "needs_you"), false);
});

test("the Home hero says the briefing's own words, and 'needs your decision' only with a reason", () => {
  assert.equal(briefedLine(LOOKALIKE), "Link using Stoko's name checked: The material names Stoko, but st0ko-login.co isn't Stoko's domain (stoko.com). It needs your decision.");
  assert.equal(briefedLine(STOKO), 'Stoko email checked: "hello@stoko.com" is a published Stoko contact.');
  const noReason = event("x", "barking", { headline: "Link checked", summary: "A finding.", userActionRequired: true, actionReason: null });
  assert.equal(needsYou(noReason), false);
  assert.equal(briefedLine(noReason), "Link checked: A finding.");
});

test("a notification names the subject and says a decision is owed only when it is", () => {
  assert.match(notificationSummary(LOOKALIKE), /^Higgins: The material names Stoko, but st0ko-login\.co isn't Stoko's domain \(stoko\.com\)\. This needs your decision\./);
  assert.doesNotMatch(notificationSummary(STOKO), /decision/);
  assert.match(notificationSummary(STOKO), /hello@stoko\.com/);
});
