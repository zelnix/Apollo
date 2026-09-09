import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ANDROID_M1_CAPABILITIES,
  ANDROID_M1_CAPABILITY_PROFILE,
  ANDROID_M2_CAPABILITIES,
  ANDROID_M2_DNS_COVERAGE_TAG,
  ANDROID_M2_DNS_VISIBILITY_SCOPE,
  validateCapabilities,
  validatePlatformCapabilityProfile,
} from "../src/capabilities.ts";
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

test("Gate Guard M2: ANDROID_M1_CAPABILITY_PROFILE is a faithful restatement of ANDROID_M1_CAPABILITIES (dnsVisibility/domainVisibility false)", () => {
  assert.equal(ANDROID_M1_CAPABILITY_PROFILE.dnsVisibility, false);
  assert.equal(ANDROID_M1_CAPABILITY_PROFILE.domainVisibility, false);
  assert.equal(ANDROID_M1_CAPABILITY_PROFILE.platform, "android");
  assert.ok(validatePlatformCapabilityProfile(ANDROID_M1_CAPABILITY_PROFILE));
});

test("Gate Guard M2: ANDROID_M2_CAPABILITIES is additive-only (differs from M1 profile by exactly dnsVisibility/domainVisibility)", () => {
  const diffKeys = Object.keys(ANDROID_M2_CAPABILITIES).filter(
    (k) => (ANDROID_M2_CAPABILITIES as Record<string, unknown>)[k] !== (ANDROID_M1_CAPABILITY_PROFILE as Record<string, unknown>)[k],
  );
  assert.deepEqual(diffKeys.sort(), ["dnsVisibility", "domainVisibility"]);
  assert.ok(validatePlatformCapabilityProfile(ANDROID_M2_CAPABILITIES));
});

test("Gate Guard M2.1: Android capability-truth correction -- dnsVisibility/domainVisibility stay true (mechanism genuinely works for what it sees) but the exported scope disclosure explicitly disclaims system-wide/universal DNS coverage", () => {
  // Locks in the actual decision: values were NOT flipped to false (that would erase the one real
  // capability gain this milestone built); the correction is the explicit, testable scope statement.
  assert.equal(ANDROID_M2_CAPABILITIES.dnsVisibility, true);
  assert.equal(ANDROID_M2_CAPABILITIES.domainVisibility, true);
  assert.equal(typeof ANDROID_M2_DNS_VISIBILITY_SCOPE, "string");
  assert.ok(ANDROID_M2_DNS_VISIBILITY_SCOPE.length > 0);
  const scope = ANDROID_M2_DNS_VISIBILITY_SCOPE.toLowerCase();
  // Must name both real-world bypass mechanisms this correction exists for...
  assert.ok(scope.includes("private dns") || scope.includes("dot"), "must disclose Private DNS/DoT bypass");
  assert.ok(scope.includes("doh"), "must disclose app-embedded DoH bypass");
  // ...and must explicitly disclaim universal/system-wide coverage, not just describe the mechanism.
  assert.ok(scope.includes("never system-wide") || scope.includes("not system-wide") || scope.includes("universal"), "must explicitly disclaim system-wide/universal coverage");
  assert.ok(scope.includes("dns:udp-53"), "disclosure text must name the concrete scope tag");
});

test("Gate Guard M2.1: ANDROID_M2_DNS_COVERAGE_TAG is a standalone, machine-readable scope tag -- not wired into any shared/main type", () => {
  assert.equal(ANDROID_M2_DNS_COVERAGE_TAG, "dns:udp-53");
  assert.equal(typeof ANDROID_M2_DNS_COVERAGE_TAG, "string");
});

test("PlatformCapabilityProfile validator rejects unknown platform, missing/mistyped fields", () => {
  assert.equal(validatePlatformCapabilityProfile({ ...ANDROID_M2_CAPABILITIES, platform: "atari" }), null);
  assert.equal(validatePlatformCapabilityProfile({ ...ANDROID_M2_CAPABILITIES, dnsVisibility: "yes" }), null);
  const { networkFiltering, ...missing } = ANDROID_M2_CAPABILITIES;
  assert.equal(validatePlatformCapabilityProfile(missing), null);
  // windows/macos are accepted platform values even though no profile constant exists for them yet.
  assert.ok(validatePlatformCapabilityProfile({ ...ANDROID_M2_CAPABILITIES, platform: "windows" }));
});

test("Gate Guard M2: SecurityEvent validates with the additive fields present", () => {
  const withM2Fields = {
    ...genuine,
    verdict: "block",
    platform: "android",
    osVersion: "16",
    engineVersion: "m2.1.0",
    enforcementMechanism: "android-vpn-dns-sinkhole-drop",
    direction: "outbound",
    actionRequested: "block",
    actionEnforced: "block",
    confidence: 0.97,
    applicationIdentity: null,
  };
  const r = validateSecurityEvent(withM2Fields);
  assert.ok(r.ok, (r as { ok: false; reason: string }).reason);
  assert.ok(isGenuineBlockedEvent(r.event));
});

test("Gate Guard M2: malformed additive fields are rejected; M1-shaped events (no additive fields at all) are unaffected", () => {
  assert.equal(validateSecurityEvent({ ...genuine, platform: "atari" }).ok, false);
  assert.equal(validateSecurityEvent({ ...genuine, direction: "sideways" }).ok, false);
  assert.equal(validateSecurityEvent({ ...genuine, actionEnforced: "maybe" }).ok, false);
  assert.equal(validateSecurityEvent({ ...genuine, confidence: 1.5 }).ok, false);
  assert.equal(validateSecurityEvent({ ...genuine, applicationIdentity: 42 }).ok, false);
  // The exact original M1 fixture, untouched, must still validate exactly as before this change.
  assert.ok(validateSecurityEvent(genuine).ok);
});
