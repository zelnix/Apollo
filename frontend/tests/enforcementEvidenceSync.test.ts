// Cross-Platform Architecture Directive — SDK-layer → domain-layer evidence mapping.
// Run: node --test tests/enforcementEvidenceSync.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { toPatrolEnforcementEvidence } from "../src/domain/enforcementEvidenceSync.ts";
import { isVerifiedEnforcement, type EnforcementEvidence } from "../src/security/PlatformCapabilityProfile.ts";

const sample: EnforcementEvidence = {
  evidenceId: "ev-1", eventId: null, deviceId: "dev-1", platform: "android", osVersion: "Android 15", sdkVersion: "1.0.0",
  observedAt: "2026-06-01T00:00:00Z", mechanism: "dns_filter", direction: "outbound", protocol: "dns",
  destination: { ip: null, domain: "evil.example", port: 53 },
  attribution: { appId: null, processName: null, confidence: "unavailable" },
  matchedRuleId: "evil.example", threatId: null, requestedAction: "block", enforcedAction: "blocked",
  result: "verified", ruleSource: "local_blocklist", confidence: "high", sourceMetadata: {}, correlationId: null,
};

test("1. maps every camelCase/nested SDK field to its snake_case/flat backend counterpart, losslessly", () => {
  const mapped = toPatrolEnforcementEvidence(sample);
  assert.equal(mapped.evidence_id, sample.evidenceId);
  assert.equal(mapped.device_id, sample.deviceId);
  assert.equal(mapped.os_version, sample.osVersion);
  assert.equal(mapped.sdk_version, sample.sdkVersion);
  assert.equal(mapped.observed_at, sample.observedAt);
  assert.equal(mapped.destination_domain, sample.destination.domain);
  assert.equal(mapped.destination_ip, sample.destination.ip);
  assert.equal(mapped.destination_port, sample.destination.port);
  assert.equal(mapped.app_id, sample.attribution.appId);
  assert.equal(mapped.process_name, sample.attribution.processName);
  assert.equal(mapped.attribution_confidence, sample.attribution.confidence);
  assert.equal(mapped.matched_rule_id, sample.matchedRuleId);
  assert.equal(mapped.requested_action, sample.requestedAction);
  assert.equal(mapped.enforced_action, sample.enforcedAction);
  assert.equal(mapped.rule_source, sample.ruleSource);
  assert.equal(mapped.correlation_id, sample.correlationId);
});

test("2. mapping never changes whether the evidence would be considered verified", () => {
  assert.equal(isVerifiedEnforcement(sample), true);
  const mapped = toPatrolEnforcementEvidence(sample);
  assert.equal(mapped.result, "verified");
  assert.equal(mapped.enforced_action, "blocked");
  assert.equal(mapped.mechanism, "dns_filter");
});

test("3. an unverified/simulated record maps through honestly too — mapping does not launder the truth", () => {
  const fake: EnforcementEvidence = { ...sample, mechanism: "simulated" };
  assert.equal(isVerifiedEnforcement(fake), false);
  const mapped = toPatrolEnforcementEvidence(fake);
  assert.equal(mapped.mechanism, "simulated"); // still visible to the backend gate, not hidden or coerced
});

test("4. a manual 'Block' tap's rule-activation evidence (ApolloSecurityModule.blockDestination shape) is never verified", () => {
  // Mirrors exactly what the Android native module's blockDestination() now returns for the
  // manual-tap flow: result="unverified", enforcedAction="none", ruleSource="user_override".
  // A tap is a REQUEST, never a VERIFIED block — see ApolloContext.blockEvent().
  const ruleActivated: EnforcementEvidence = {
    ...sample, enforcedAction: "none", result: "unverified", ruleSource: "user_override",
  };
  assert.equal(isVerifiedEnforcement(ruleActivated), false);
  const mapped = toPatrolEnforcementEvidence(ruleActivated);
  assert.equal(mapped.result, "unverified");
  assert.equal(mapped.enforced_action, "none");
});
