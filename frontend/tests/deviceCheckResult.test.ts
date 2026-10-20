// Higgins Device Check → universal Check Result mapping, security-rule state and connection row.
// Run: node --test tests/deviceCheckResult.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { EMPTY_SIGNALS, type DeviceSignals } from "../src/domain/deviceAnalysis.ts";
import { osThreatNotAvailable, runFirstCheck, type FirstCheckInputs } from "../src/domain/firstCheck.ts";
import { deviceCheckResult } from "../src/domain/firstCheckResultModel.ts";

const NONE_REPORTED = { status: "none_reported" as const, source: "Google Play Protect", detail: "No harmful apps.", threats: [], protectionOff: false };
const signals = (over: Partial<DeviceSignals> = {}): DeviceSignals => ({
  ...EMPTY_SIGNALS("android"), unknownSourcesEnabled: false, thirdPartyAccessibilityServices: [], overlayApps: [],
  notificationAccessApps: [], vpnActive: false, vpnProviderKnown: null, managementProfile: "none", userTrustedCertificates: 0,
  remoteAccessApps: [], developerOptions: false, screenLockSecure: true,
  systemIntegrity: { indicators: [], checked: ["root tool files"], protections: [] }, osThreatReport: NONE_REPORTED, ...over,
});
const online = { connected: true, type: "wifi" as const, isInternetReachable: true, inspectable: true, wifiSecurity: "wpa3" as const, captivePortal: false, vpnActive: false, ssid: "Home", checkedAt: new Date().toISOString() };
const inputs = (over: Partial<FirstCheckInputs> = {}): FirstCheckInputs => ({
  platform: "android", nativeHost: true, signals: signals(),
  deviceFacts: { osVersion: "Android 15", manufacturer: "M", model: "X" },
  protection: { requested: true, operational: true, enforcementMethod: "packet_filter", adapterLabel: "Apollo security module" },
  osReportedThreat: NONE_REPORTED,
  connection: online,
  ruleBundle: { observable: true, current: true, expiresAt: new Date(Date.now() + 3600_000).toISOString(), detail: "Rules valid." },
  ...over,
});
const row = (r: ReturnType<typeof runFirstCheck>, id: string) => r.checks.find((c) => c.id === id)!;

test("security rules: current rules pass, expired rules are a concern with one action", () => {
  const ok = runFirstCheck(inputs());
  assert.equal(row(ok, "security_rules").result, "PASS");

  const stale = runFirstCheck(inputs({ ruleBundle: { observable: true, current: false, expiresAt: new Date(Date.now() - 1000).toISOString(), detail: "Rules expired." } }));
  const staleRow = row(stale, "security_rules");
  assert.equal(staleRow.result, "CAUTION");
  assert.ok(staleRow.action);
});

test("security rules: unknown or unobservable is never a pass", () => {
  const unknown = runFirstCheck(inputs({ ruleBundle: { observable: true, current: null, expiresAt: null, detail: "Could not read." } }));
  assert.equal(row(unknown, "security_rules").result, "ERROR");

  const none = runFirstCheck(inputs({ ruleBundle: null }));
  assert.equal(row(none, "security_rules").result, "NOT_AVAILABLE");
  assert.equal(row(none, "security_rules").executed, false);
});

test("connection: unread connection is not available, open Wi-Fi is a concern", () => {
  const unread = runFirstCheck(inputs({ connection: null }));
  assert.equal(row(unread, "connection").result, "NOT_AVAILABLE");

  const open = runFirstCheck(inputs({ connection: { ...online, wifiSecurity: "open" } }));
  assert.equal(row(open, "connection").result, "CAUTION");

  const offline = runFirstCheck(inputs({ connection: { ...online, connected: false, isInternetReachable: false } }));
  assert.equal(row(offline, "connection").result, "INFORMATION");
});

test("result model: one headline, one action, unavailable checks never read as passed", () => {
  const report = runFirstCheck(inputs({
    ruleBundle: { observable: true, current: false, expiresAt: new Date(Date.now() - 1000).toISOString(), detail: "Rules expired." },
    connection: null,
  }));
  const { model, actionRoute } = deviceCheckResult(report, "re_check");

  assert.equal(model.gate, "Device Re-check");
  assert.ok(model.headline.length > 0);
  assert.equal(typeof model.whatToDo, "string");           // exactly one action string
  assert.ok(actionRoute && actionRoute.route.length > 0);   // and one destination
  const connection = model.items.find((i) => i.id === "connection")!;
  assert.equal(connection.status, "not_performed");
  assert.notEqual(connection.status, "clear");
  assert.ok(model.evidence.some((e) => e.label.startsWith("Not checked —")));
});

test("result model: a failed run reports low confidence and no fabricated pass", () => {
  const preview = runFirstCheck({
    ...inputs(), nativeHost: false, connection: null, ruleBundle: null, protection: null,
    signals: { ...signals(), osThreatReport: undefined },
    osReportedThreat: osThreatNotAvailable("android", false),
  });
  const { model } = deviceCheckResult(preview, "re_check");
  assert.equal(model.confidence, "Low");
  assert.ok(model.items.every((i) => i.status !== "clear" || !i.name.includes("malware report")));
});
