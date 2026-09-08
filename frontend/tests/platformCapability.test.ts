// Cross-Platform Architecture Directive — PlatformCapabilityProfile & EnforcementEvidence.
// Run: yarn test:platform
//
// Core invariant under test: capability presence or a rule/threat match is NEVER enough to
// authorise a THREAT_BLOCKED / "biting" transition. Only EnforcementEvidence with
// result === "verified" (and a real mechanism) may do that. See PlatformCapabilityProfile.ts.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  anyVerifiedBlock,
  CAPABILITY_PROFILE_VERSION,
  isVerifiedEnforcement,
  PLATFORM_CAPABILITY_BASELINES,
  type EnforcementEvidence,
  type SdkPlatform,
} from "../src/security/PlatformCapabilityProfile.ts";

const CAPABILITY_FIELDS = [
  "networkFiltering", "packetVisibility", "dnsVisibility", "processAttribution", "appAttribution",
  "domainVisibility", "localBlocking", "backgroundProtection", "offlineProtection", "realTimeEvents",
] as const;

const ALL_PLATFORMS: SdkPlatform[] = ["android", "ios", "windows", "macos", "mock"];

const evidence = (o: Partial<EnforcementEvidence> = {}): EnforcementEvidence => ({
  evidenceId: "ev-1", eventId: null, deviceId: "dev-1", platform: "android", osVersion: "15", sdkVersion: "1.0",
  observedAt: "2026-06-01T00:00:00Z", mechanism: "vpn_service", direction: "outbound", protocol: "https",
  destination: { ip: "1.2.3.4", domain: "evil.example", port: 443 },
  attribution: { appId: "com.example.mail", processName: "mail", confidence: "high" },
  matchedRuleId: "rule-1", threatId: "threat-1", requestedAction: "block", enforcedAction: "blocked",
  result: "verified", ruleSource: "cloud_intel", confidence: "high", sourceMetadata: {}, correlationId: "scent-1",
  ...o,
});

test("1. all four real platforms + mock are representable with a valid, versioned capability shape", () => {
  for (const p of ALL_PLATFORMS) {
    const profile = PLATFORM_CAPABILITY_BASELINES[p];
    assert.equal(profile.platform, p, `baseline key ${p} must self-report platform=${p}`);
    assert.equal(profile.capabilityVersion, CAPABILITY_PROFILE_VERSION);
    for (const field of CAPABILITY_FIELDS) {
      assert.ok(["full", "partial", "none"].includes(profile[field]), `${p}.${field} must be full|partial|none, got ${profile[field]}`);
    }
  }
});

test("2. mock baseline overclaims nothing — every capability is 'none', even though Expo Go runs on a real OS", () => {
  const mock = PLATFORM_CAPABILITY_BASELINES.mock;
  for (const field of CAPABILITY_FIELDS) assert.equal(mock[field], "none", `mock.${field} must be none`);
});

test("3. iOS never claims process/app attribution (Apple does not expose it to third-party extensions)", () => {
  assert.equal(PLATFORM_CAPABILITY_BASELINES.ios.processAttribution, "none");
  assert.equal(PLATFORM_CAPABILITY_BASELINES.ios.appAttribution, "none");
});

test("4. Android and Windows claim full packet+DNS+attribution visibility (VpnService / WFP)", () => {
  for (const p of ["android", "windows"] as const) {
    assert.equal(PLATFORM_CAPABILITY_BASELINES[p].packetVisibility, "full");
    assert.equal(PLATFORM_CAPABILITY_BASELINES[p].dnsVisibility, "full");
    assert.equal(PLATFORM_CAPABILITY_BASELINES[p].processAttribution, "full");
  }
});

test("5. isVerifiedEnforcement: true only for a real mechanism + verified result + blocked action", () => {
  assert.equal(isVerifiedEnforcement(evidence()), true);
  assert.equal(isVerifiedEnforcement(null), false);
  assert.equal(isVerifiedEnforcement(undefined), false);
});

test("6. a rule/threat match alone (unverified) can NEVER authorise a block — the core Truth-of-State guarantee", () => {
  // High-confidence cloud intel match, requestedAction=block, but the OS never confirmed enforcement.
  const matchedButUnverified = evidence({ result: "unverified" });
  assert.equal(isVerifiedEnforcement(matchedButUnverified), false);
  assert.equal(anyVerifiedBlock([matchedButUnverified]), false);
});

test("7. a failed enforcement attempt is never verified, even if the action requested was 'block'", () => {
  assert.equal(isVerifiedEnforcement(evidence({ result: "failed", enforcedAction: "none" })), false);
});

test("8. simulated/none mechanisms can never be verified, even if result says 'verified' (defends the mock adapter)", () => {
  assert.equal(isVerifiedEnforcement(evidence({ mechanism: "simulated", result: "verified", enforcedAction: "blocked" })), false);
  assert.equal(isVerifiedEnforcement(evidence({ mechanism: "none", result: "verified", enforcedAction: "blocked" })), false);
});

test("9. enforcedAction must be 'blocked' — a verified 'monitored' or 'allowed' result is not a block", () => {
  assert.equal(isVerifiedEnforcement(evidence({ enforcedAction: "monitored" })), false);
  assert.equal(isVerifiedEnforcement(evidence({ enforcedAction: "allowed" })), false);
});

test("10. anyVerifiedBlock: empty/absent evidence is false, never assumed true", () => {
  assert.equal(anyVerifiedBlock([]), false);
  assert.equal(anyVerifiedBlock(null), false);
  assert.equal(anyVerifiedBlock(undefined), false);
});

test("11. anyVerifiedBlock: true once at least one record in the list truly verifies a block", () => {
  const mixed = [evidence({ result: "unverified" }), evidence({ result: "failed" }), evidence()];
  assert.equal(anyVerifiedBlock(mixed), true);
});
