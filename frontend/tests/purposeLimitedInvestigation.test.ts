import assert from "node:assert/strict";
import { test } from "node:test";

import { patrolSafeSummary } from "../src/domain/investigation.ts";
import { escalateForUrl } from "../src/domain/messageAnalysis.ts";
import { enforceEgress, redactUserSecrets } from "../src/domain/privacy.ts";

test("purpose-limited message egress preserves context but redacts secret URL parameters", () => {
  const payload = enforceEgress("message_check", { device_id: "device-123", sender: "Bank Alerts",
    text: "Review the claimed payment", urls: ["https://user:pass@example.com/reset?token=secret&invoice=42#frag"],
    local_state: "growling", scenario: "M02", signals: ["payment"], claimed_brand: "Bank", second_opinion: true });
  assert.equal(payload.text, "Review the claimed payment");
  assert.match(payload.urls[0], /invoice=42/);
  assert.match(payload.urls[0], /token=%5Bredacted%5D/);
  assert.doesNotMatch(payload.urls[0], /user|pass|secret|frag/);
});

test("purpose-limited link investigation redacts secrets and bounds local findings", () => {
  const payload = enforceEgress("link_investigation", { device_id: "device-123", url: "https://user:pass@example.com/reset?token=secret&invoice=42#frag",
    local_state: "growling", local_findings: ["The domain does not match the claimed bank."], claimed_brand: "Example Bank" });
  assert.match(payload.url, /invoice=42/);
  assert.match(payload.url, /token=%5Bredacted%5D/);
  assert.doesNotMatch(payload.url, /user|pass|secret|frag/);
  assert.throws(() => enforceEgress("link_investigation", { ...payload, local_findings: Array(13).fill("bounded") }));
});

test("message and Ask Higgins redact submitted login secrets before egress", () => {
  const raw = "username: person@example.com password=Winter!42 PIN is 4488 OTP: 113355 recovery code ABCD-EFGH";
  const safe = redactUserSecrets(raw);
  for (const secret of ["person@example.com", "Winter!42", "4488", "113355", "ABCD-EFGH"]) assert.doesNotMatch(safe, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const message = enforceEgress("message_check", { device_id: "device-123", sender: "Unknown", text: raw, urls: [], local_state: "barking", scenario: "M01", signals: ["Code request"], claimed_brand: null, second_opinion: true });
  assert.doesNotMatch(message.text, /Winter!42|4488|113355|ABCD-EFGH/);
  const ask = enforceEgress("ask_apollo", { device_id: "device-123", message: "My PIN is 4488", context: null });
  assert.equal(ask.message, "My PIN is [redacted]");
  assert.equal(ask.conversation_id, "general");
  assert.equal(redactUserSecrets("I received a password reset link"), "I received a password reset link");
});

test("Ask Higgins accepts only bounded structured issue context and preserves provenance", () => {
  const payload = enforceEgress("ask_apollo", { device_id: "device-123", message: "What next?", handoff_id: "handoff-123", conversation_id: "handoff-123", context: {
    gate: "account", issue_summary: "Claimed password reset", assessment_state: "ears_up",
    findings: [{ summary: "Visible sender claims Google", provenance: "observed", status: "uncertain" }],
    uncertainty: ["Sender is not authenticated"], confirmed_protective_actions: [], user_reported_actions: ["Requested a reset"],
  } });
  assert.equal(payload.context.findings[0].provenance, "observed");
  assert.throws(() => enforceEgress("ask_apollo", { ...payload, context: { ...payload.context, unrestricted_event: { password: "secret" } } }));
});

test("Patrol summary strips direct identifiers and secret codes", () => {
  const safe = patrolSafeSummary("Email person@example.com or call +61 400 000 222 with code 998877 at https://example.com/path?token=x");
  assert.doesNotMatch(safe, /person@example|400 000|998877|token=x/);
  assert.match(safe, /\[email\]|\[phone\]|\[code\]/);
});

test("malicious reputation is a warning, never packet-backed biting", () => {
  assert.equal(escalateForUrl("resting", "malicious"), "barking");
});