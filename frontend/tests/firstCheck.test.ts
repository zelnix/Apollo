// Higgins First Check engine — cross-platform capability-based malware/compromise baseline.
// Run: node --test tests/firstCheck.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { EMPTY_SIGNALS, type DevicePlatform, type DeviceSignals } from "../src/domain/deviceAnalysis.ts";
import { deriveOverall, diffFirstCheck, erroredFirstCheck, osThreatNotAvailable, runFirstCheck, type FirstCheckInputs } from "../src/domain/firstCheck.ts";

const NONE_REPORTED = { status: "none_reported" as const, source: "Google Play Protect", detail: "No harmful apps.", threats: [], protectionOff: false };
const androidSignals = (over: Partial<DeviceSignals> = {}): DeviceSignals => ({
  ...EMPTY_SIGNALS("android"), unknownSourcesEnabled: false, thirdPartyAccessibilityServices: [], overlayApps: [],
  notificationAccessApps: [], vpnActive: false, vpnProviderKnown: null, managementProfile: "none", userTrustedCertificates: 0,
  remoteAccessApps: [], developerOptions: false, screenLockSecure: true,
  systemIntegrity: { indicators: [], checked: ["root tool files"], protections: [] }, ...over,
});
const inputs = (platform: DevicePlatform, signals: DeviceSignals, over: Partial<FirstCheckInputs> = {}): FirstCheckInputs => ({
  platform, nativeHost: true, signals,
  deviceFacts: { osVersion: "OS 15", manufacturer: "M", model: "X" },
  protection: { requested: true, operational: true, enforcementMethod: "dns_filter", adapterLabel: "Apollo security module" },
  osReportedThreat: signals.osThreatReport ?? osThreatNotAvailable(platform, true), ...over,
});
const androidInputs = (s: DeviceSignals, over: Partial<FirstCheckInputs> = {}) => inputs("android", { ...s, osThreatReport: s.osThreatReport ?? NONE_REPORTED }, over);
const byId = (r: ReturnType<typeof runFirstCheck>, id: string) => r.checks.find((c) => c.id === id)!;

test("CLEAR: healthy Android with Play Protect reporting nothing", () => {
  const r = runFirstCheck(androidInputs(androidSignals()));
  assert.equal(r.overall, "CLEAR");
  assert.equal(byId(r, "os_reported_threat").result, "PASS");
  assert.equal(byId(r, "apollo_integrity").result, "PASS");
});

test("ATTENTION: unknown sources is CAUTION, never beyond", () => {
  const r = runFirstCheck(androidInputs(androidSignals({ unknownSourcesEnabled: true })));
  assert.equal(r.overall, "ATTENTION");
  assert.ok(byId(r, "install_sources").action);
});

test("HIGH RISK: heuristics (remote access, root files) are SUSPICIOUS, never CONFIRMED", () => {
  const r = runFirstCheck(androidInputs(androidSignals({ remoteAccessApps: ["AnyDesk"], systemIntegrity: { indicators: ["root tools present"], checked: [], protections: [] } })));
  assert.equal(r.overall, "HIGH_RISK");
  assert.equal(byId(r, "device_integrity").result, "SUSPICIOUS");
  assert.ok(!r.checks.some((c) => c.result === "CONFIRMED_THREAT"));
});

test("CONFIRMED THREAT only from a trusted OS report (Play Protect / Defender)", () => {
  const android = runFirstCheck(androidInputs(androidSignals({ osThreatReport: { status: "reported", source: "Google Play Protect", detail: "1 harmful app", threats: ["Fake Bank"], protectionOff: false } })));
  assert.equal(android.overall, "CONFIRMED_THREAT");
  assert.match(byId(android, "os_reported_threat").evidence ?? "", /Fake Bank/);
  const win = runFirstCheck(inputs("windows", { ...EMPTY_SIGNALS("windows"), osThreatReport: { status: "reported", source: "Microsoft Defender Antivirus", detail: "1 active", threats: ["Trojan:Win32/X"], protectionOff: false } }));
  assert.equal(win.overall, "CONFIRMED_THREAT");
});

test("Every platform always gets an explicit OS threat row — unsupported is NOT_AVAILABLE, never PASS", () => {
  for (const p of ["ios", "macos", "android", "windows", "web"] as DevicePlatform[]) {
    const r = runFirstCheck(inputs(p, EMPTY_SIGNALS(p), { nativeHost: p !== "web" }));
    const row = byId(r, "os_reported_threat");
    assert.equal(row.result, "NOT_AVAILABLE", p);
    assert.ok(row.platformLimitation, p);
    assert.notEqual(r.overall, "CLEAR", p);
  }
});

test("Scanner switched off (Defender real-time / Play Protect) is CAUTION with an action", () => {
  const r = runFirstCheck(inputs("windows", { ...EMPTY_SIGNALS("windows"), osThreatReport: { status: "not_available", source: "Microsoft Defender Antivirus", detail: "off", threats: [], protectionOff: true } }));
  assert.equal(byId(r, "os_reported_threat").result, "CAUTION");
  assert.ok(byId(r, "os_reported_threat").action);
});

test("OS report failure is ERROR, not clean", () => {
  const r = runFirstCheck(androidInputs(androidSignals({ osThreatReport: { status: "error", source: "Google Play Protect", detail: "timeout", threats: [], protectionOff: null } })));
  assert.equal(byId(r, "os_reported_threat").result, "ERROR");
});

test("iOS: jailbreak check runs, Apple limits are explained, overall is LIMITED not CLEAR", () => {
  const sig: DeviceSignals = { ...EMPTY_SIGNALS("ios"), vpnActive: false, managementProfile: "unknown", screenLockSecure: true, systemIntegrity: { indicators: [], checked: ["jailbreak files"], protections: [] } };
  const r = runFirstCheck(inputs("ios", sig));
  assert.equal(byId(r, "device_integrity").result, "PASS");
  assert.equal(byId(r, "application_risk").result, "NOT_AVAILABLE");
  assert.match(byId(r, "application_risk").platformLimitation ?? "", /Apple/);
  assert.equal(r.overall, "LIMITED_CHECK");
  assert.match(r.capabilityNote ?? "", /Apple/);
});

test("macOS: SIP or Gatekeeper off → CAUTION (weakened protection, not malware)", () => {
  const sig: DeviceSignals = { ...EMPTY_SIGNALS("macos"), unknownSourcesEnabled: true, managementProfile: "none",
    systemIntegrity: { indicators: [], checked: [], protections: [{ name: "System Integrity Protection", enabled: false }, { name: "Gatekeeper", enabled: false }] } };
  const r = runFirstCheck(inputs("macos", sig));
  assert.equal(byId(r, "device_integrity").result, "CAUTION");
  assert.equal(byId(r, "install_sources").result, "CAUTION");
  assert.equal(r.overall, "ATTENTION");
});

test("Windows: Defender clean + tamper protection on + SmartScreen on executes real checks", () => {
  const sig: DeviceSignals = { ...EMPTY_SIGNALS("windows"), unknownSourcesEnabled: false, firewallEnabled: true, antivirusEnabled: true, osUpdatesCurrent: true,
    osThreatReport: { status: "none_reported", source: "Microsoft Defender Antivirus", detail: "clean", threats: [], protectionOff: false },
    systemIntegrity: { indicators: [], checked: [], protections: [{ name: "Defender tamper protection", enabled: true }] } };
  const r = runFirstCheck(inputs("windows", sig));
  assert.equal(r.overall, "CLEAR");
  assert.equal(byId(r, "os_reported_threat").result, "PASS");
});

test("ERROR: a failed run is honest, never clean", () => {
  assert.equal(erroredFirstCheck("android", EMPTY_SIGNALS("android")).overall, "ERROR");
});

test("NOT_AVAILABLE is never upgraded to PASS by deriveOverall", () => {
  const row = { title: "t", supported: false, executed: false, result: "NOT_AVAILABLE" as const, confidence: "low" as const, severity: "none" as const, evidenceRef: null, explanation: "", platformLimitation: null };
  assert.equal(deriveOverall([{ ...row, id: "a", category: "device_integrity" }, { ...row, id: "b", category: "application_risk" }]), "LIMITED_CHECK");
});

test("Re-check diff flags a new SUSPICIOUS app as worse, and resolution as better", () => {
  const baseline = runFirstCheck(androidInputs(androidSignals()));
  const worse = runFirstCheck(androidInputs(androidSignals({ remoteAccessApps: ["AnyDesk"] })));
  assert.ok(diffFirstCheck(baseline, worse).some((c) => c.direction === "worse" && c.title.includes("Installed apps")));
  assert.ok(diffFirstCheck(worse, baseline).some((c) => c.direction === "better"));
});

test("Re-check across different platforms produces no misleading diff", () => {
  const a = runFirstCheck(androidInputs(androidSignals()));
  const i = runFirstCheck(inputs("ios", EMPTY_SIGNALS("ios")));
  assert.deepEqual(diffFirstCheck(a, i), []);
});
