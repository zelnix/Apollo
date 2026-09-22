import assert from "node:assert/strict";
import { test } from "node:test";
import { buildGatesOverview } from "../src/domain/gates.ts";

const permission = (status: "granted" | "denied" | "blocked") => ({ id: "network_filter" as const, title: "Network filter", status, canAskAgain: status !== "blocked", why: "Required" });
const protection = (patch = {}) => ({ running: false, requested: true, operational: false, enforcementMethod: "dns_filter" as const, coverage: "Website traffic", coverageScope: [], lastVerified: null, degradedReason: "Permission missing", visibility: "none" as const, since: null, adapterLabel: "Native", checkedAt: new Date().toISOString(), ...patch });
const base = { platform: "android", checking: false, protection: protection(), permissions: [permission("denied")], capabilities: [{ id: "link_guard" as const, title: "Link Gate", status: "available" as const, detail: "Manual" }, { id: "site_guard" as const, title: "Site Gate", status: "permission_required" as const, detail: "Permission" }], messaging: { smsFiltering: "unsupported" as const, linkInterception: "unsupported" as const, senderReputation: "unsupported" as const, shareExtension: "unsupported" as const, notificationIntegration: "unsupported" as const }, calls: { callerIdentification: "unsupported" as const, callScreening: "unsupported" as const, numberReputation: "supported" as const, voicemailTranscript: "unsupported" as const, liveTranscript: "unsupported" as const } };

test("C21 produces one truthful consumer presentation per Gate", () => {
  const result = buildGatesOverview(base);
  assert.equal(result.gates.length, 10);
  assert.deepEqual(new Set(result.gates.map((gate) => gate.id)), new Set(["site", "link", "text", "call", "network", "account", "email", "file", "app", "device"]));
  for (const gate of result.gates) {
    assert.ok(gate.purpose.length > 30);
    assert.ok(gate.currentHelp.length > 20);
    assert.ok(gate.statusLabel);
    assert.equal("automaticStatus" in gate, false);
    assert.equal("onDemandStatus" in gate, false);
    assert.ok(!gate.primaryAction || Object.keys(gate.primaryAction).sort().join(",") === "id,label");
  }
});

test("Site Gate needs attention when native permission is missing", () => {
  const site = buildGatesOverview(base).gates.find((gate) => gate.id === "site")!;
  assert.equal(site.statusLabel, "Needs your attention");
  assert.equal(site.capability.automatic?.state, "permission_needed");
  assert.equal(site.primaryAction?.id, "restore_site");
});

test("stale enforcement never claims protection on", () => {
  const stale = new Date(Date.now() - 11 * 60 * 1000).toISOString();
  const site = buildGatesOverview({ ...base, permissions: [permission("granted")], protection: protection({ running: true, operational: true, lastVerified: stale, visibility: "full" }), capabilities: [{ id: "site_guard" as const, title: "Site Gate", status: "active" as const, detail: "Stale" }] }).gates.find((gate) => gate.id === "site")!;
  assert.notEqual(site.statusLabel, "Protection on");
  assert.equal(site.capability.automatic?.state, "temporarily_unavailable");
});

test("fresh native evidence is required for Protection on", () => {
  const site = buildGatesOverview({ ...base, permissions: [permission("granted")], protection: protection({ running: true, operational: true, lastVerified: new Date().toISOString(), visibility: "full" }), capabilities: [{ id: "site_guard" as const, title: "Site Gate", status: "active" as const, detail: "Running" }] }).gates.find((gate) => gate.id === "site")!;
  assert.equal(site.statusLabel, "Protection on");
  assert.equal(site.capability.automatic?.state, "running");
});

test("Email Gate requires a fresh successful service heartbeat", () => {
  const stale = buildGatesOverview({ ...base, email: { checking: false, configured: true, connected: true, monitoringRequested: true, lastCheckedAt: null, lastErrorAt: null } }).gates.find((gate) => gate.id === "email")!;
  assert.equal(stale.statusLabel, "Status unavailable");
  const live = buildGatesOverview({ ...base, email: { checking: false, configured: true, connected: true, monitoringRequested: true, lastCheckedAt: new Date().toISOString(), lastErrorAt: null } }).gates.find((gate) => gate.id === "email")!;
  assert.equal(live.statusLabel, "Watching");
});

test("File Gate purpose keeps cloud-hosting limitation", () => {
  const file = buildGatesOverview(base).gates.find((gate) => gate.id === "file")!;
  assert.match(file.purpose, /cloud download is not automatically trusted/i);
  assert.equal(file.capability.onDemand?.state, "ready");
});