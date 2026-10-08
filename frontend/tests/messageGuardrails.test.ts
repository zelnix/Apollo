// Message guardrails (standing requirement). These fail the build if ANY generated user-facing message
// leaks an internal code, overstates protection ("blocked"/"stopped" without verified enforcement), or
// routes to a screen that doesn't exist. Run: node --test tests/messageGuardrails.test.ts
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

import type { ApolloState, EventCategory, PatrolEvent } from "../src/domain/types.ts";
import { assessmentLabel, attentionLabel, looksLikeInternalCode, projectedEventVoice } from "../src/domain/messageVoice.ts";
import { resolveApolloState } from "../src/domain/stateMachine.ts";
import { buildGatesOverview } from "../src/domain/gates.ts";
import { patrolPayload } from "../src/domain/patrolPayload.ts";
import { enforceEgress } from "../src/domain/privacy.ts";
import { eventLocalAlert } from "../src/push/localAlerts.ts";

const CATEGORIES: EventCategory[] = ["link", "website", "connection", "known_threat", "protection", "system", "message", "call", "app", "device", "account", "email", "file", "family"];
const STATES: ApolloState[] = ["resting", "ears_up", "growling", "barking", "biting"];
const BLOCK = /\b(blocked|stopped|stop)\b/i;

function evt(over: Partial<PatrolEvent> = {}): PatrolEvent {
  return {
    event_id: "ev-1", device_id: "dev-1", category: "website", state: "ears_up", status: "active",
    headline: "Apollo ran a website safety check", what_happened: "worth a look", why: ["summary"],
    what_to_do: "Open it on that phone.", occurred_at: new Date().toISOString(), resolved_at: null,
    verified_block: false, background: true, indicator_host: null, local_indicator: null,
    indicator_digest: null, scenario: null, scent_id: null, claimed_brand: null,
    investigation_case_id: null, enforcement_evidence: null, supporting_references: [], ...over,
  } as PatrolEvent;
}

test("projected (synced) event text never leaks a code and never overstates a block", () => {
  for (const category of CATEGORIES) for (const state of STATES) for (const verified of [false, true]) {
    const v = projectedEventVoice(category, state, verified);
    for (const text of [v.headline, v.whatHappened, v.why, v.whatToDo]) {
      assert.ok(!looksLikeInternalCode(text), `code leaked for ${category}/${state}/${verified}: ${text}`);
      if (!verified) assert.ok(!BLOCK.test(text), `overstated block without evidence for ${category}/${state}: ${text}`);
    }
  }
});

test("patrol_sync egress output (what the server stores + re-projects) is clean plain English", () => {
  const SYNCABLE: EventCategory[] = ["link", "website", "connection", "known_threat", "protection", "system", "message", "call", "app", "device", "account", "email"];
  for (const category of SYNCABLE) for (const state of STATES.filter((s) => s !== "biting")) {
    const out = enforceEgress("patrol_sync", patrolPayload(evt({ category, state }), "dev-1")) as Record<string, string>;
    for (const key of ["headline", "what_happened", "what_to_do"]) {
      assert.ok(!looksLikeInternalCode(out[key]), `egress ${key} leaked code for ${category}/${state}: ${out[key]}`);
      assert.ok(!BLOCK.test(out[key]), `egress ${key} overstated block for ${category}/${state}: ${out[key]}`);
    }
  }
});

test("Apollo status reasons name the area, expose no code, and deep-link to the exact event", () => {
  for (const state of ["barking", "growling", "ears_up"] as ApolloState[]) {
    const r = resolveApolloState({ events: [evt({ event_id: "ev-42", state, category: "call" })], visibility: "full", lastVerifiedAt: new Date().toISOString(), now: Date.now() });
    assert.ok(!looksLikeInternalCode(r.reason), `reason leaked code: ${r.reason}`);
    assert.match(r.reason, /phone call/i);
    assert.equal(r.reasonRoute, "/patrol/ev-42");
  }
  assert.ok(existsSync("app/patrol/[id].tsx"), "home status deep-link target must exist");
});

test("every notification routes to a screen that actually exists (no dead links)", () => {
  const alert = eventLocalAlert(evt({ state: "barking", status: "active" }));
  assert.ok(alert, "expected a barking alert");
  assert.match(alert!.actionUrl, /^\/patrol\//);
  assert.ok(alert!.body && !looksLikeInternalCode(alert!.body));
  // The deep-link target must be a real route file.
  assert.ok(existsSync("app/patrol/[id].tsx"), "patrol detail route must exist for notification deep-link");
});

const ALLOWED_GATE_LABELS = new Set(["Watching", "Ready to check", "Check in progress", "Setup available", "Off", "Limited", "Action needed", "Unavailable", "Unable to verify"]);

test("Gate alerts: every gate presentation is plain English with an actionable, code-free button", () => {
  const overview = buildGatesOverview({ platform: "android", checking: false, protection: null, permissions: [], capabilities: [], messaging: null, calls: null });
  assert.equal(overview.gates.length, 10);
  for (const g of [...overview.gates, ...(overview.primary ? [overview.primary] : [])]) {
    assert.ok(ALLOWED_GATE_LABELS.has(g.statusLabel), `unknown/leaky gate status label: ${g.statusLabel}`);
    for (const text of [g.currentHelp, g.purpose, g.capability.automatic?.limitation ?? ""]) assert.ok(!looksLikeInternalCode(text), `gate ${g.id} leaked a code: ${text}`);
    if (g.primaryAction) { assert.ok(g.primaryAction.label.trim().length > 0 && !looksLikeInternalCode(g.primaryAction.label), `gate ${g.id} action label bad: ${g.primaryAction.label}`); assert.ok(g.primaryAction.id.trim().length > 0, `gate ${g.id} action has no id to route with`); }
  }
  assert.ok(!looksLikeInternalCode(overview.summary) && !looksLikeInternalCode(overview.higgins));
});

test("Higgins chat replies: every verdict maps to plain English, never a raw enum", () => {
  for (const a of ["concern_found", "no_concern_found_within_scope", "uncertain"]) {
    const label = assessmentLabel(a);
    assert.ok(label.trim().length > 0 && !looksLikeInternalCode(label), `assessment leaked: ${label}`);
  }
  for (const a of ["none", "review", "action_needed", "urgent"]) {
    const label = attentionLabel(a);
    assert.ok(label.trim().length > 0 && !looksLikeInternalCode(label), `attention leaked: ${label}`);
  }
  // The investigation view must not interpolate raw enums into the UI.
  const view = readFileSync("src/components/InvestigationView.tsx", "utf8");
  assert.doesNotMatch(view, /\.(assessment|attention)\.replace|\{response\.(assessment|attention)\}/, "InvestigationView must render verdicts via messageVoice labels, not raw enums");
  // Live scrub: the model's free text must pass through scrubMessage before it reaches the user.
  assert.match(view, /scrubMessage\(response\.overview\)/, "Higgins overview must be live-scrubbed");
  assert.match(view, /scrubMessage/g);
});
