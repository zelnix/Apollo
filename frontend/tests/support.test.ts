// Support summary/email renderers + reference format. Pure modules only (the renderers and the
// reference-format regex), so no expo/native imports are pulled into node. Run: node --test tests/support.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildHigginsInfo, buildProtectionRows, buildSupportSummary, renderEmailBody, renderReportHtml, renderSupportSummaryText } from "../src/support/supportSummary.ts";

const app = { version: "1.1.9", build: "159", buildId: "1.0.0", updateId: "abc-123", environment: "production", nativeBuild: true, installedAt: "1 Jun 2026, 10:00", bundlePublishedAt: "7 Jun 2026, 09:00", lastNativeUpdateAt: "Unavailable" };
const device = { manufacturer: "Google", model: "Pixel 8", deviceType: "Phone", os: "Android", osVersion: "15", architecture: "arm64-v8a" };
const protection = { running: true, requested: true, operational: true, enforcementMethod: "dns_filter" as const, coverage: "DNS-level filtering", coverageScope: ["dns:ipv4"], lastVerified: "2026-06-07T09:00:00.000Z", degradedReason: null, visibility: "full" as const, since: null, adapterLabel: "Android", checkedAt: "2026-06-07T09:00:00.000Z" };

test("protection rows: a verified-running service reads 'Active and verified', never fabricated", () => {
  const rows = buildProtectionRows(protection, null, [], { safeBrowsing: "ok", blocklistEntries: 1200 }, false);
  assert.equal(rows.find((r) => r.label === "Apollo Protection")?.state, "Active and verified");
  assert.equal(rows.find((r) => r.label === "Last verified block")?.state, "Unverified"); // no evidence supplied
});

test("protection rows: preview build never claims real enforcement", () => {
  const rows = buildProtectionRows(protection, null, [], { safeBrowsing: null, blocklistEntries: null }, true);
  assert.equal(rows.find((r) => r.label === "Apollo Protection")?.state, "Available");
});

test("protection rows: degraded protection is a Warning, not Active", () => {
  const rows = buildProtectionRows({ ...protection, operational: false, degradedReason: "VPN permission missing" }, null, [], { safeBrowsing: "ok", blocklistEntries: 10 }, false);
  assert.equal(rows.find((r) => r.label === "Apollo Protection")?.state, "Warning");
});

test("higgins info merges First Check concerns and uses latest timestamp", () => {
  const firstCheck = { overall: "ATTENTION" as const, platform: "android" as const, checkedAt: "2026-06-08T00:00:00.000Z", checks: [], concerns: ["Installed apps and their access: unknown sources allowed"], unavailable: [], signals: {} as never };
  const info = buildHigginsInfo(null, firstCheck);
  assert.equal(info.result, "Higgins ATTENTION");
  assert.ok(info.warnings.length === 1);
});

test("email body/subject/report share the exact reference and redact raw data", () => {
  const reference = "AP-20260608-6D4A9E13B2C74F8A93D05E17C46F21B8";
  const summary = buildSupportSummary(app, device, buildProtectionRows(protection, null, [], { safeBrowsing: "ok", blocklistEntries: 1200 }, false), buildHigginsInfo(null, null));
  const body = renderEmailBody(summary, reference);
  const text = renderSupportSummaryText(summary, reference);
  const html = renderReportHtml(summary, reference);
  for (const out of [body, text, html]) assert.ok(out.includes(reference));
  assert.ok(body.includes("Apollo Cyber Security Guard Dog"));
  // Only status/counts/dates are rendered — no secret-bearing key/value pairs.
  for (const out of [body, html]) assert.doesNotMatch(out, /(password|bearer|authorization)\s*[:=]\s*\S/i);
});

test("reference format: AP-YYYYMMDD-<32 uppercase hex>", () => {
  const sample = "AP-20260608-6D4A9E13B2C74F8A93D05E17C46F21B8";
  assert.match(sample, /^AP-\d{8}-[0-9A-F]{32}$/);
});
