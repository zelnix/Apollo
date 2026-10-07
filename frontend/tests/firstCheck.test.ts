// Higgins First Check engine — verifies CLEAR, ATTENTION, HIGH RISK, CONFIRMED THREAT, LIMITED CHECK,
// ERROR and the Re-check diff (spec acceptance criteria §16.15 / §17.25). Run: node --test tests/firstCheck.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { EMPTY_SIGNALS, type DeviceSignals } from "../src/domain/deviceAnalysis.ts";
import { deriveOverall, diffFirstCheck, erroredFirstCheck, runFirstCheck, type FirstCheckInputs } from "../src/domain/firstCheck.ts";

const androidSignals = (over: Partial<DeviceSignals> = {}): DeviceSignals => ({
  ...EMPTY_SIGNALS("android"), unknownSourcesEnabled: false, thirdPartyAccessibilityServices: [], overlayApps: [],
  notificationAccessApps: [], vpnActive: false, vpnProviderKnown: null, managementProfile: "none", userTrustedCertificates: 0,
  remoteAccessApps: [], developerOptions: false, ...over,
});

const androidInputs = (signals: DeviceSignals, over: Partial<FirstCheckInputs> = {}): FirstCheckInputs => ({
  platform: "android", nativeHost: true, signals,
  deviceFacts: { osVersion: "Android 15", manufacturer: "Google", model: "Pixel" },
  protection: { requested: true, operational: true, enforcementMethod: "dns_filter", adapterLabel: "Android security module" },
  osReportedThreat: null, ...over,
});

test("CLEAR: healthy Android with nothing flagged", () => {
  const r = runFirstCheck(androidInputs(androidSignals()));
  assert.equal(r.overall, "CLEAR");
  assert.ok(r.checks.find((c) => c.id === "apollo_integrity")?.result === "PASS");
});

test("ATTENTION: a CAUTION signal (unknown sources) never escalates past ATTENTION", () => {
  const r = runFirstCheck(androidInputs(androidSignals({ unknownSourcesEnabled: true })));
  assert.equal(r.overall, "ATTENTION");
  assert.ok(r.concerns.length >= 1);
});

test("HIGH RISK: remote-access app is SUSPICIOUS (heuristic) → HIGH_RISK, never CONFIRMED", () => {
  const r = runFirstCheck(androidInputs(androidSignals({ remoteAccessApps: ["AnyDesk"] })));
  assert.equal(r.overall, "HIGH_RISK");
  assert.ok(!r.checks.some((c) => c.result === "CONFIRMED_THREAT"));
});

test("CONFIRMED THREAT only from a deterministic OS threat report", () => {
  const r = runFirstCheck(androidInputs(androidSignals(), { osReportedThreat: { present: true, detail: "Trojan.X found" } }));
  assert.equal(r.overall, "CONFIRMED_THREAT");
});

test("LIMITED CHECK: iOS exposes little → not CLEAR", () => {
  const inputs: FirstCheckInputs = {
    platform: "ios", nativeHost: true, signals: EMPTY_SIGNALS("ios"),
    deviceFacts: { osVersion: "iOS 18", manufacturer: "Apple", model: "iPhone" },
    protection: { requested: true, operational: true, enforcementMethod: "content_blocker", adapterLabel: "iOS security module" },
    osReportedThreat: null,
  };
  const r = runFirstCheck(inputs);
  assert.equal(r.overall, "LIMITED_CHECK");
  assert.ok(r.unavailable.length >= 2);
});

test("ERROR: a failed run is honest, never clean", () => {
  const r = erroredFirstCheck("android", EMPTY_SIGNALS("android"));
  assert.equal(r.overall, "ERROR");
});

test("NOT_AVAILABLE is never upgraded to PASS by deriveOverall", () => {
  const overall = deriveOverall([
    { id: "a", category: "device_integrity", title: "t", supported: false, executed: false, result: "NOT_AVAILABLE", confidence: "low", severity: "none", evidenceRef: null, explanation: "", platformLimitation: null },
    { id: "b", category: "application_risk", title: "t", supported: false, executed: false, result: "NOT_AVAILABLE", confidence: "low", severity: "none", evidenceRef: null, explanation: "", platformLimitation: null },
  ]);
  assert.equal(overall, "LIMITED_CHECK");
});

test("Re-check diff flags a new SUSPICIOUS app as a worse change, and resolution as better", () => {
  const baseline = runFirstCheck(androidInputs(androidSignals()));
  const worse = runFirstCheck(androidInputs(androidSignals({ remoteAccessApps: ["AnyDesk"] })));
  const worseDiff = diffFirstCheck(baseline, worse);
  assert.ok(worseDiff.some((c) => c.direction === "worse" && c.title.includes("Installed apps")));

  const betterDiff = diffFirstCheck(worse, baseline);
  assert.ok(betterDiff.some((c) => c.direction === "better"));
});

test("Re-check across different platforms produces no misleading diff", () => {
  const a = runFirstCheck(androidInputs(androidSignals()));
  const iosInputs: FirstCheckInputs = { platform: "ios", nativeHost: true, signals: EMPTY_SIGNALS("ios"), deviceFacts: null, protection: null, osReportedThreat: null };
  const i = runFirstCheck(iosInputs);
  assert.deepEqual(diffFirstCheck(a, i), []);
});
