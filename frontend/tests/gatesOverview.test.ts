import assert from "node:assert/strict";
import { test } from "node:test";

import { buildGatesOverview } from "../src/domain/gates.ts";

const permission = (status: "granted" | "denied" | "blocked") => ({ id: "network_filter" as const, title: "Network filter", status, canAskAgain: status !== "blocked", why: "Required" });
const protection = (patch = {}) => ({ running: false, requested: true, operational: false, enforcementMethod: "dns_filter" as const, coverage: "Website traffic", coverageScope: [], lastVerified: null,
  degradedReason: "Permission missing", visibility: "none" as const, since: null, adapterLabel: "Native", checkedAt: new Date().toISOString(), ...patch });
const base = { platform: "android", checking: false, protection: protection(), permissions: [permission("denied")],
  capabilities: [{ id: "link_guard" as const, title: "Link Gate", status: "available" as const, detail: "Manual" },
    { id: "site_guard" as const, title: "Site Gate", status: "permission_required" as const, detail: "Permission" }],
  messaging: { smsFiltering: "unsupported" as const, linkInterception: "unsupported" as const, senderReputation: "unsupported" as const, shareExtension: "unsupported" as const, notificationIntegration: "unsupported" as const },
  calls: { callerIdentification: "unsupported" as const, callScreening: "unsupported" as const, numberReputation: "supported" as const, voicemailTranscript: "unsupported" as const, liveTranscript: "unsupported" as const } };

test("mixed protection condition uses exact summary, Higgins copy and restoration action", () => {
  const result = buildGatesOverview(base);
  assert.equal(result.summary, "Some protection needs attention");
  assert.equal(result.higgins, "Your link checks are available, but Site Gate is off. Restore Apollo’s protection permission to enable its automatic filtering.");
  assert.equal(result.primary?.actionLabel, "Restore protection");
  assert.equal(result.gates.find((gate) => gate.id === "link")?.status, "Ready to check");
  assert.equal(result.gates.find((gate) => gate.id === "site")?.status, "Needs attention");
});

test("requested on is not active without fresh operational evidence", () => {
  const result = buildGatesOverview({ ...base, permissions: [permission("granted")], protection: protection({ requested: true, running: true, operational: false, lastVerified: null }) });
  assert.equal(result.gates.find((gate) => gate.id === "site")?.status, "Needs attention");
});

test("stale verification never produces an Active Gate", () => {
  const stale = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  const result = buildGatesOverview({ ...base, permissions: [permission("granted")], protection: protection({ running: true, operational: true, lastVerified: stale, visibility: "full" }),
    capabilities: [...base.capabilities.filter((cap) => cap.id !== "site_guard"), { id: "site_guard" as const, title: "Site Gate", status: "active" as const, detail: "Stale" }] });
  assert.equal(result.gates.find((gate) => gate.id === "site")?.status, "Needs attention");
});

test("all available protection summary requires confirmed automatic evidence", () => {
  const result = buildGatesOverview({ ...base, permissions: [permission("granted")], protection: protection({ running: true, operational: true, lastVerified: new Date().toISOString(), visibility: "full" }),
    capabilities: [...base.capabilities.filter((cap) => cap.id !== "site_guard"), { id: "site_guard" as const, title: "Site Gate", status: "active" as const, detail: "Running" }] });
  assert.equal(result.gates.find((gate) => gate.id === "site")?.status, "Active");
  assert.equal(result.summary, "All available protection is active");
  assert.match(result.higgins, /Ready to check still require you to submit/);
});

test("preview cannot claim automatic filtering", () => {
  const result = buildGatesOverview({ ...base, platform: "web", protection: protection({ enforcementMethod: "simulated" }), permissions: [] });
  assert.equal(result.gates.find((gate) => gate.id === "site")?.status, "Unavailable on this device");
});

test("Email Gate requires a fresh monitor heartbeat, not only an enabled toggle", () => {
  const requested = buildGatesOverview({ ...base, email: { checking: false, configured: true, connected: true, monitoringRequested: true, lastCheckedAt: null, lastErrorAt: null } });
  assert.equal(requested.gates.find((gate) => gate.id === "email")?.status, "Needs attention");
  const active = buildGatesOverview({ ...base, email: { checking: false, configured: true, connected: true, monitoringRequested: true, lastCheckedAt: new Date().toISOString(), lastErrorAt: null } });
  assert.equal(active.gates.find((gate) => gate.id === "email")?.status, "Active");
});

test("overview contains exactly ten first-class Gates including manual File and Device Gates", () => {
  const result = buildGatesOverview(base);
  assert.equal(result.gates.length, 10);
  assert.deepEqual(result.gates.map((gate) => gate.id), ["site", "link", "text", "call", "network", "account", "email", "file", "app", "device"]);
  for (const id of ["file", "app", "device"] as const) {
    const gate = result.gates.find((item) => item.id === id);
    assert.equal(gate?.status, "Ready to check");
    assert.equal(gate?.mode, "Manual submission");
  }
  assert.match(result.gates.find((gate) => gate.id === "file")?.scope ?? "", /Cloud hosting is not a safety signal/);
  assert.match(result.gates.find((gate) => gate.id === "device")?.scope ?? "", /does not continuously scan every app/);
});