import assert from "node:assert/strict";
import { test } from "node:test";

import { ANDROID_M1_CAPABILITIES, validateCapabilities } from "../src/capabilities.ts";
import { isGenuineBlockedEvent, validateSecurityEvent } from "../src/securityEvent.ts";

const genuine = {
  id: "evt-1",
  type: "THREAT_BLOCKED",
  source: "android-vpn-enforcement",
  occurredAt: "2026-06-15T00:00:00Z",
  destinationIp: "203.0.113.10",
  host: "m1-block-test.guarddog.example",
  sanitizedUrl: "https://m1-block-test.guarddog.example/",
  ruleId: "m1-controlled-block-001",
  rulesetId: "gd-m1-controlled-block",
  bundleVersion: 3,
  enforcementEvidenceId: "ev-abc",
};

test("genuine THREAT_BLOCKED with evidence is accepted", () => {
  const r = validateSecurityEvent(genuine);
  assert.ok(r.ok);
  assert.ok(isGenuineBlockedEvent(r.event));
});

test("THREAT_BLOCKED without evidence, wrong source, or without observed IP is rejected", () => {
  assert.equal(validateSecurityEvent({ ...genuine, enforcementEvidenceId: undefined }).ok, false);
  assert.equal(validateSecurityEvent({ ...genuine, source: "local-analysis" }).ok, false);
  assert.equal(validateSecurityEvent({ ...genuine, source: "rule-verifier" }).ok, false);
  assert.equal(validateSecurityEvent({ ...genuine, destinationIp: undefined }).ok, false);
  assert.equal(validateSecurityEvent({ ...genuine, ruleId: undefined }).ok, false);
});

test("sanitizedUrl with query/fragment/userinfo is rejected at the bridge boundary", () => {
  assert.equal(validateSecurityEvent({ ...genuine, sanitizedUrl: "https://x.example/a?token=1" }).ok, false);
  assert.equal(validateSecurityEvent({ ...genuine, sanitizedUrl: "https://x.example/a#f" }).ok, false);
  assert.equal(validateSecurityEvent({ ...genuine, sanitizedUrl: "https://u:p@x.example/a" }).ok, false);
  assert.equal(validateSecurityEvent({ ...genuine, sanitizedUrl: "https://[2001:db8::1]/a" }).ok, true);
});

test("non-blocked events do not need evidence", () => {
  const r = validateSecurityEvent({ id: "e", type: "PROTECTION_STATE_CHANGED", source: "protection-lifecycle", occurredAt: "2026-06-15T00:00:00Z", protectionState: "ACTIVE" });
  assert.ok(r.ok);
  assert.equal(isGenuineBlockedEvent(r.event), false);
});

test("capabilities cannot overclaim", () => {
  assert.ok(validateCapabilities(ANDROID_M1_CAPABILITIES));
  assert.equal(validateCapabilities({ ...ANDROID_M1_CAPABILITIES, dnsInterception: true }), null);
  assert.equal(validateCapabilities({ ...ANDROID_M1_CAPABILITIES, universalDeviceProtection: true }), null);
});
