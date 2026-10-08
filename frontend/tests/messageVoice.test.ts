// Apollo message voice — guarantees no internal code ever reaches the user and that status is never
// overstated. Run: node --test tests/messageVoice.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { apolloStatusLabel, areaLabel, displayStateLabel, eventHistory, humanizeReason, investigationHistory, looksLikeInternalCode, projectedEventVoice, resultChip, scrubMessage, sourceLabel } from "../src/domain/messageVoice.ts";

test("area labels never expose raw category codes", () => {
  assert.equal(areaLabel("known_threat"), "a website safety check");
  assert.equal(areaLabel("call"), "a phone call");
  assert.equal(areaLabel("mystery_future_code"), "a security check");
});

test("resultChip replaces 'Something changed' with a specific state label", () => {
  assert.equal(resultChip("ears_up"), "Worth a look");
  assert.notEqual(resultChip("ears_up"), "Something changed");
  assert.equal(resultChip("resting", true), "Resolved");
});

test("source label turns user_started into 'Started by you'", () => {
  assert.equal(sourceLabel("user_started"), "Started by you");
  assert.equal(sourceLabel("background"), "Checked automatically in the background");
});

test("displayStateLabel never returns a snake_case code", () => {
  for (const code of ["safe", "monitoring", "warning", "danger", "blocked", "resolved", "unknown"]) assert.doesNotMatch(displayStateLabel(code), /_/);
});

test("humanizeReason strips an internal code but keeps genuine prose", () => {
  assert.doesNotMatch(humanizeReason("server_projection_of_recorded_outcome", "ears_up"), /server_projection|_/);
  assert.equal(humanizeReason("Apollo saw repeated failed logins.", "barking"), "Apollo saw repeated failed logins.");
});

test("status is never overstated: no verified block => never 'stopped'", () => {
  assert.equal(apolloStatusLabel("biting", { verifiedBlock: false }), "Flagged for your attention");
  assert.equal(apolloStatusLabel("biting", { verifiedBlock: true }), "Threat stopped");
});

test("projected (synced) event voice is plain English with no codes and no detail leak", () => {
  const v = projectedEventVoice("known_threat", "ears_up", false);
  for (const text of [v.headline, v.whatHappened, v.why, v.whatToDo]) assert.ok(!looksLikeInternalCode(text), `leaked code in: ${text}`);
  assert.match(v.whatHappened, /worth a look/i);
  const blocked = projectedEventVoice("website", "biting", true);
  assert.match(blocked.whatHappened, /blocked/i);
});

test("looksLikeInternalCode catches the exact screenshot offenders", () => {
  for (const bad of ["known_threat", "ears_up", "user_started", "server_projection_of_recorded_outcome"]) assert.ok(looksLikeInternalCode(bad));
  assert.ok(!looksLikeInternalCode("Apollo ran a website safety check"));
});

test("scrubMessage rewrites any internal code in free text to plain English", () => {
  assert.doesNotMatch(scrubMessage("Higgins saw a known_threat and set ears_up."), /known_threat|ears_up|_/);
  assert.equal(scrubMessage("All clear — no concern."), "All clear — no concern.");
  assert.ok(!looksLikeInternalCode(scrubMessage("state is server_projection_of_recorded_outcome now")));
});

test("investigationHistory gives a plain-English, code-free progress list ending in a status", () => {
  const h = investigationHistory({ turns: [{ question: "Is this safe?", overview: "state ears_up found" }], phase: "idle", completion: "complete" });
  assert.ok(h.length >= 2);
  for (const e of h) assert.ok(!looksLikeInternalCode(e.text), `history leaked: ${e.text}`);
  assert.match(h[h.length - 1].text, /completed/i);
});


test("eventHistory renders a plain-English timeline with no codes, ordered, incl. resolution", () => {
  const hist = eventHistory(
    { category: "known_threat", state: "barking", occurred_at: "2026-06-01T10:00:00.000Z", resolved_at: "2026-06-01T12:00:00.000Z", verified_block: false },
    [{ occurredAt: "2026-06-01T11:00:00.000Z", effectiveState: "warning", summary: "server_projection_of_recorded_outcome", revision: 2 }],
  );
  assert.equal(hist.length, 3);
  assert.ok(hist[0].at < hist[1].at && hist[1].at < hist[2].at, "entries must be time-ordered");
  for (const e of hist) assert.ok(!looksLikeInternalCode(e.text), `history leaked a code: ${e.text}`);
  assert.match(hist[2].text, /resolved/i);
});
