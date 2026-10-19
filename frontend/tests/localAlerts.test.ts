import assert from "node:assert/strict";
import { test } from "node:test";
import { eventLocalAlert, protectionLocalAlert } from "../src/push/localAlerts.ts";
import type { PatrolEvent, PatrolEnforcementEvidence } from "../src/domain/types.ts";
import type { ProtectionStatus } from "../src/security/SecurityPlatformAdapter.ts";

const when = new Date().toISOString();
const packet: PatrolEnforcementEvidence = {
  evidence_id: "packet-1", event_id: "packet-1", device_id: "local", platform: "android", os_version: null, sdk_version: null,
  observed_at: when, mechanism: "dns_filter", direction: "outbound", protocol: "dns", destination_ip: null,
  destination_domain: "example.org", destination_port: 53, app_id: null, process_name: null, attribution_confidence: "high",
  matched_rule_id: "rule-1", threat_id: null, requested_action: "block", enforced_action: "blocked", result: "verified",
  rule_source: "signed", confidence: "high", correlation_id: null,
};
const event: PatrolEvent = {
  event_id: "packet-1", device_id: "local", category: "connection", state: "biting", status: "blocked", headline: "Apollo blocked example.org",
  what_happened: "A real packet was dropped.", why: [], what_to_do: "Review the blocked connection.", indicator_host: "example.org",
  indicator_digest: null, verified_block: true, adapter_label: "native", occurred_at: when, resolved_at: null, background: true,
  enforcement_evidence: packet,
};

test("Apollo is biting local alert requires correlated, verified packet-drop evidence", () => {
  assert.equal(eventLocalAlert(event)?.title, "Apollo is biting");
  assert.equal(eventLocalAlert({ ...event, verified_block: false }), null);
  assert.equal(eventLocalAlert({ ...event, enforcement_evidence: null }), null);
  assert.equal(eventLocalAlert({ ...event, enforcement_evidence: { ...packet, result: "unverified" } }), null);
  assert.equal(eventLocalAlert({ ...event, enforcement_evidence: { ...packet, event_id: "different-event" } }), null);
  assert.equal(eventLocalAlert({ ...event, category: "call" }), null);
});

test("automatic device detections can alert without inventing an enforcement block", () => {
  assert.equal(eventLocalAlert({ ...event, state: "barking", status: "active", verified_block: false, enforcement_evidence: null })?.channel, "threats");
  assert.equal(eventLocalAlert({ ...event, state: "growling", status: "active", verified_block: false, enforcement_evidence: null })?.channel, "growling");
  assert.equal(eventLocalAlert({ ...event, category: "link", background: false, state: "barking" }), null);
  assert.equal(eventLocalAlert({ ...event, status: "resolved" }), null);
});

const protection: ProtectionStatus = {
  running: true, requested: true, operational: true, enforcementMethod: "dns_filter", coverage: "On-device DNS", coverageScope: [],
  lastVerified: when, degradedReason: null, visibility: "full", since: when, adapterLabel: "native", checkedAt: when,
};

test("health alerts describe OS observations, not a user's request", () => {
  assert.equal(protectionLocalAlert(protection, { ...protection, operational: false, running: false, lastVerified: null, degradedReason: "VPN stopped." })?.title, "Higgins: Protection needs attention");
  assert.equal(protectionLocalAlert({ ...protection, operational: false, running: false }, protection)?.title, "Apollo protection restored");
  assert.equal(protectionLocalAlert(protection, { ...protection, requested: false, operational: false }), null);
});