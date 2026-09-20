import assert from "node:assert/strict";
import { test } from "node:test";

import { patrolSafeSummary } from "../src/domain/investigation.ts";
import { escalateForUrl } from "../src/domain/messageAnalysis.ts";
import { enforceEgress } from "../src/domain/privacy.ts";

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

test("Patrol summary strips direct identifiers and secret codes", () => {
  const safe = patrolSafeSummary("Email person@example.com or call +61 400 000 222 with code 998877 at https://example.com/path?token=x");
  assert.doesNotMatch(safe, /person@example|400 000|998877|token=x/);
  assert.match(safe, /\[email\]|\[phone\]|\[code\]/);
});

test("malicious reputation is a warning, never packet-backed biting", () => {
  assert.equal(escalateForUrl("resting", "malicious"), "barking");
});