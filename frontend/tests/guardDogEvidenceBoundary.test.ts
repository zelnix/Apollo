import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGuardDogCandidateEvidence } from "../src/security/guarddog/GuardDogEvidenceBoundary.ts";

const valid = { evidenceId: "e-1", eventId: null, deviceId: null, platform: "android", osVersion: "Android", sdkVersion: null,
  observedAt: "2026-09-20T00:00:00Z", mechanism: "packet_filter", direction: "outbound", protocol: "tcp",
  destination: { ip: "203.0.113.20", domain: "controlled.example", port: 443 },
  attribution: { appId: null, processName: null, confidence: "unavailable" }, matchedRuleId: "r-1", threatId: null,
  requestedAction: "block", enforcedAction: "blocked", result: "verified", ruleSource: "local_blocklist",
  confidence: "high", sourceMetadata: { ipProtocolNumber: 6 }, correlationId: "engine-1" };

test("bridge accepts public-contract evidence", () => assert.equal(parseGuardDogCandidateEvidence(JSON.stringify([valid]))[0].protocol, "tcp"));
test("bridge rejects invalid protocol, source, destination and timestamp", () => {
  for (const row of [
    { ...valid, protocol: "iana-132" }, { ...valid, ruleSource: "signed_guarddog_bundle" },
    { ...valid, destination: { ...valid.destination, port: 70000 } }, { ...valid, observedAt: "not-time" },
    { ...valid, result: "accepted" }, { ...valid, enforcedAction: "allowed" },
    { ...valid, protocol: "unknown", destination: { ...valid.destination, port: null }, result: "verified" },
    { ...valid, sourceMetadata: [] },
  ]) assert.throws(() => parseGuardDogCandidateEvidence(JSON.stringify([row])));
});