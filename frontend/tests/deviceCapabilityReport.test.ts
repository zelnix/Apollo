// The shareable Device Capabilities report + the capability lines Higgins receives.
// Run: yarn test:device-capabilities-report
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildDeviceCapabilities, type NativeCapabilityReads, type NativeProtectionRead } from "../src/domain/deviceCapabilities.ts";
import { buildDeviceCapabilityReportHtml, deviceCapabilityReportTitle, type DeviceReportMeta } from "../src/domain/deviceCapabilityReport.ts";

const CAPS: NativeCapabilityReads = {
  installEvents: "unsupported", appPermissions: "supported", accessibilityServices: "supported",
  overlayApps: "unsupported", notificationAccess: "permission_required", vpnState: "supported",
  profileState: "supported", appNetworkCorrelation: "supported",
};

const NATIVE: NativeProtectionRead = {
  callProtection: [{
    provider: "Samsung Smart Call", packageName: "com.samsung.android.smartcallprovider",
    installed: true, isDefaultHandler: true, feature: "Caller ID & spam filtering",
    classificationAccessible: false,
    note: "Samsung Smart Call verdict is not accessible through a supported Samsung API.",
  }],
  messageProtection: [],
  defaultDialerPackage: "com.samsung.android.dialer",
  defaultSmsPackage: "com.samsung.android.messaging",
};

const META: DeviceReportMeta = {
  deviceLabel: "Galaxy S25", osLabel: "Android 16", manufacturer: "Samsung", platformLabel: "Android",
  lastCheckedAt: "2026-06-01T09:00:00.000Z", generatedAt: "2026-06-02T09:00:00.000Z",
  apolloProtection: "running", hasNativeHost: true,
};

const androidView = () => buildDeviceCapabilities({ platform: "android", caps: CAPS, native: NATIVE });

test("the report is titled for the device it describes", () => {
  assert.equal(deviceCapabilityReportTitle(META), "Apollo device capabilities — Galaxy S25");
});

test("native protection appears under its provider's name, with the provider's own note", () => {
  const html = buildDeviceCapabilityReportHtml(androidView(), META);
  assert.match(html, /What this device protects/);
  assert.match(html, /<td>Samsung Smart Call<\/td>/);
  assert.match(html, /<td>Active on your device<\/td>/);
  assert.match(html, /the named provider’s, not Apollo’s/);
});

test("every OS and OEM protection reaches the report, with its owner and honest state", () => {
  const html = buildDeviceCapabilityReportHtml(androidView(), META);
  for (const title of ["Screen lock", "Security updates", "App scanning", "Dangerous-site warnings", "Find My Device", "Private DNS", "Developer options and USB debugging"]) {
    assert.ok(html.includes(`<td>${title}</td>`), `missing protection: ${title}`);
  }
  assert.match(html, /<td>Apollo can’t verify this<\/td>/);
  assert.match(html, /never reported as on or off/);
});

test("every capability reaches the report as a table row with its status", () => {
  const html = buildDeviceCapabilityReportHtml(androidView(), META);
  assert.match(html, /Apollo’s capabilities on this device/);
  assert.match(html, /<tr><th>Capability<\/th><th>Status<\/th><th>What this means<\/th><\/tr>/);
  // One row per capability the engine resolved, each carrying exactly one declared status.
  const view = androidView();
  const total = view.apolloCanUse.length + view.needsPermission.length + view.notAccessible.length + view.unknown.length + view.unavailable.length;
  assert.equal(total, 13);
  for (const row of [...view.apolloCanUse, ...view.needsPermission, ...view.notAccessible, ...view.unavailable]) {
    assert.ok(html.includes(`<td>${row.title}</td>`), `missing capability row: ${row.title}`);
  }
  assert.match(html, /<td>Available to Apollo<\/td>/);
  assert.match(html, /<td>Permission needed<\/td>/);
  assert.ok(html.includes("Protection worth checking"));
  assert.match(html, /Google Play Protect/);
  assert.match(html, /Turn on ‘Scan apps with Play Protect’/);
});

test("the report never claims a setting Apollo cannot read is on or off", () => {
  const html = buildDeviceCapabilityReportHtml(androidView(), META);
  assert.doesNotMatch(html, /Play Protect is (on|off|enabled|disabled)/i);
  assert.match(html, /does not expose to Apollo; Apollo states that rather than claiming they are on or off/);
});

test("a failed read is reported as unknown in the report, never as clear", () => {
  const view = buildDeviceCapabilities({ platform: "android", caps: null, native: null });
  const html = buildDeviceCapabilityReportHtml(view, META);
  assert.match(html, /<td>Apollo couldn’t check<\/td>/);
  assert.match(html, /unknown, not clear/);
});

test("a host that is not the device says so instead of reporting no protection", () => {
  const view = buildDeviceCapabilities({ platform: "web", caps: null, native: null });
  const html = buildDeviceCapabilityReportHtml(view, { ...META, hasNativeHost: false, platformLabel: "this browser" });
  assert.match(html, /was not running on the device itself/);
});

test("no device check recorded is stated plainly", () => {
  const html = buildDeviceCapabilityReportHtml(androidView(), { ...META, lastCheckedAt: null });
  assert.match(html, /Last device check: no check recorded/);
});

test("device labels are HTML-escaped", () => {
  const html = buildDeviceCapabilityReportHtml(androidView(), { ...META, deviceLabel: '<img src=x onerror="alert(1)">' });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});
