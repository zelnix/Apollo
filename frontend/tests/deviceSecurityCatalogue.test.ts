// Device Security Catalogue — the expanded OS/OEM protection coverage.
// Run: node --test tests/deviceSecurityCatalogue.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EMPTY_SECURITY_READ, patchAgeDays, securityCatalogueIds, securityProtectionRows,
  type SecurityStateRead,
} from "../src/domain/deviceSecurityCatalogue.ts";

const NOW = Date.parse("2026-06-15T12:00:00.000Z");
const read = (over: Partial<SecurityStateRead> = {}): SecurityStateRead => ({ ...EMPTY_SECURITY_READ, ...over });

// ── Coverage ───────────────────────────────────────────────────────

test("the catalogue covers every protection area the objective names", () => {
  const android = securityCatalogueIds("android");
  for (const id of [
    "screen_lock", "os_updates", "app_scanner", "safe_browsing", "unknown_sources",
    "find_my_device", "private_dns", "developer_options", "device_admin_apps",
    "user_certificates", "system_integrity", "caller_id_spam", "message_spam",
  ]) assert.ok(android.includes(id), `Android is missing ${id}`);

  const ios = securityCatalogueIds("ios");
  for (const id of ["screen_lock", "os_updates", "safe_browsing", "find_my_device", "silence_unknown_callers", "filter_unknown_senders", "lockdown_mode"]) {
    assert.ok(ios.includes(id), `iOS is missing ${id}`);
  }
  // Android-only settings must never be offered on an iPhone.
  for (const id of ["unknown_sources", "private_dns", "developer_options", "user_certificates"]) {
    assert.ok(!ios.includes(id), `${id} must not be offered on iOS`);
  }
  // Nothing is offered where Apollo is not on a phone.
  assert.deepEqual(securityCatalogueIds("web"), []);
});

test("every entry answers the three questions and never claims a state it cannot read", () => {
  for (const platform of ["android", "ios"] as const) {
    for (const row of securityProtectionRows(platform, read(), NOW)) {
      assert.ok(row.what.length > 20, `${row.id}: what it does`);
      assert.ok(row.benefit.length > 20, `${row.id}: how it helps`);
      assert.ok(row.guidance, `${row.id}: must carry guidance even when unreadable`);
      assert.ok(row.guidance!.steps.length >= 2, `${row.id}: must have real steps`);
      assert.ok(row.guidance!.recommended.length > 20, `${row.id}: must state the recommended configuration`);
      assert.ok(row.attributedTo.length > 0, `${row.id}: must name an owner`);
      // With an empty read, nothing may be reported as on or off.
      assert.equal(row.state, "not_verifiable");
      assert.equal(row.stateLabel, "Apollo can’t verify this");
      assert.equal(row.guidance!.selfCheck, true);
      assert.doesNotMatch(row.title, /verdict/i);
    }
  }
});

// ── Real reads produce real states ─────────────────────────────────

test("screen lock reports exactly what the read said, including biometrics", () => {
  const on = securityProtectionRows("android", read({ screenLockSecure: true, biometricStatus: "enrolled" }), NOW).find((r) => r.id === "screen_lock")!;
  assert.equal(on.state, "active");
  assert.match(on.detail, /secure screen lock/i);
  assert.match(on.detail, /Fingerprint or face unlock is also set up/);
  assert.equal(on.guidance!.selfCheck, false);

  const off = securityProtectionRows("android", read({ screenLockSecure: false }), NOW).find((r) => r.id === "screen_lock")!;
  assert.equal(off.state, "off");
  assert.equal(off.stateLabel, "Needs your attention");

  const noBio = securityProtectionRows("android", read({ screenLockSecure: true, biometricStatus: "none_enrolled" }), NOW).find((r) => r.id === "screen_lock")!;
  assert.match(noBio.detail, /none is set up yet/);
});

test("security patch age is a fact, and a stale patch is named as out of date", () => {
  assert.equal(patchAgeDays("2026-06-01", NOW), 14);
  assert.equal(patchAgeDays("2026-06", NOW), 14);
  assert.equal(patchAgeDays("not a date", NOW), null);
  assert.equal(patchAgeDays(null, NOW), null);

  const current = securityProtectionRows("android", read({ securityPatch: "2026-05-01" }), NOW).find((r) => r.id === "os_updates")!;
  assert.equal(current.state, "active");
  assert.match(current.detail, /2026-05-01/);
  assert.match(current.detail, /Apollo cannot tell whether a newer one is waiting/);

  const stale = securityProtectionRows("android", read({ securityPatch: "2025-06-01" }), NOW).find((r) => r.id === "os_updates")!;
  assert.equal(stale.state, "out_of_date");
  assert.equal(stale.stateLabel, "Out of date");
  assert.match(stale.detail, /about 13 months old/);
});

test("the app scanner is attributed to whoever answered, not to Apollo", () => {
  const on = securityProtectionRows("android", read({ osThreatReport: { source: "Google Play Protect", status: "none_reported", protectionOff: false } }), NOW).find((r) => r.id === "app_scanner")!;
  assert.equal(on.state, "active");
  assert.equal(on.attributedTo, "Google Play Protect");
  assert.match(on.detail, /stays its finding — Apollo reports it as theirs, never as its own/);

  const off = securityProtectionRows("android", read({ osThreatReport: { source: "Google Play Protect", status: "none_reported", protectionOff: true } }), NOW).find((r) => r.id === "app_scanner")!;
  assert.equal(off.state, "off");
  assert.match(off.detail, /its own scanning is switched off/);

  // A failed or unavailable report is unknown, never an all-clear.
  const unavailable = securityProtectionRows("android", read({ osThreatReport: { source: "Google Play Protect", status: "not_available" } }), NOW).find((r) => r.id === "app_scanner")!;
  assert.equal(unavailable.state, "not_verifiable");
});

test("developer options, certificates and admin apps report the real read", () => {
  const rows = (r: Partial<SecurityStateRead>) => securityProtectionRows("android", read(r), NOW);

  const devOn = rows({ developerOptions: true, usbDebugging: true }).find((r) => r.id === "developer_options")!;
  assert.equal(devOn.state, "off");
  assert.match(devOn.detail, /USB debugging is on as well/);
  const devOff = rows({ developerOptions: false }).find((r) => r.id === "developer_options")!;
  assert.equal(devOff.state, "as_recommended");
  assert.equal(devOff.stateLabel, "Set as recommended");

  // -1 from the native read means "couldn't read" and must stay unverifiable.
  assert.equal(rows({ userCertificateCount: -1 }).find((r) => r.id === "user_certificates")!.state, "not_verifiable");
  assert.equal(rows({ userCertificateCount: 0 }).find((r) => r.id === "user_certificates")!.state, "as_recommended");
  const certs = rows({ userCertificateCount: 2 }).find((r) => r.id === "user_certificates")!;
  assert.equal(certs.state, "off");
  assert.match(certs.detail, /2 hand-installed certificates are/);

  const admins = rows({ deviceAdmins: ["com.acme.mdm"] }).find((r) => r.id === "device_admin_apps")!;
  assert.equal(admins.state, "off");
  assert.match(admins.detail, /com.acme.mdm/);
  assert.equal(rows({ deviceAdmins: [] }).find((r) => r.id === "device_admin_apps")!.state, "as_recommended");
});

test("Private DNS and system integrity never guess", () => {
  const dnsOff = securityProtectionRows("android", read({ privateDnsActive: false }), NOW).find((r) => r.id === "private_dns")!;
  assert.equal(dnsOff.state, "off");
  const dnsOn = securityProtectionRows("android", read({ privateDnsActive: true }), NOW).find((r) => r.id === "private_dns")!;
  assert.equal(dnsOn.state, "active");
  assert.equal(securityProtectionRows("android", read(), NOW).find((r) => r.id === "private_dns")!.state, "not_verifiable");

  const rooted = securityProtectionRows("android", read({ rootIndicators: ["su_binary:/system/bin/su"] }), NOW).find((r) => r.id === "system_integrity")!;
  assert.equal(rooted.state, "off");
  assert.match(rooted.detail, /indicators, not proof/);
  assert.equal(securityProtectionRows("android", read({ rootIndicators: [] }), NOW).find((r) => r.id === "system_integrity")!.state, "as_recommended");
});

test("the instructions name the person's actual phone and messaging apps", () => {
  const samsung = securityProtectionRows("android", read({ defaultDialerPackage: "com.samsung.android.dialer", defaultSmsPackage: "com.samsung.android.messaging" }), NOW);
  assert.match(samsung.find((r) => r.id === "caller_id_spam")!.guidance!.steps.join(" "), /Samsung Phone app/);
  assert.match(samsung.find((r) => r.id === "message_spam")!.guidance!.steps.join(" "), /Samsung Messages/);

  // An unknown OEM still gets usable, generic instructions — no OEM list required.
  const other = securityProtectionRows("android", read({ defaultDialerPackage: "com.oem.unknown.dialer", defaultSmsPackage: "com.oem.unknown.sms" }), NOW);
  assert.match(other.find((r) => r.id === "caller_id_spam")!.guidance!.steps.join(" "), /Open the Phone app/);
  assert.match(other.find((r) => r.id === "screen_lock")!.guidance!.steps.join(" "), /Security & privacy|Passwords & security/);
});

test("every deep link points at a settings target the app can actually open", () => {
  const targets = new Set(["apps", "accessibility", "vpn", "security", "unknown_sources", "overlay", "notification_access", "all_files", "developer"]);
  for (const platform of ["android", "ios"] as const) {
    for (const row of securityProtectionRows(platform, read(), NOW)) {
      assert.ok(targets.has(row.guidance!.action.target), `${row.id}: unknown settings target ${row.guidance!.action.target}`);
      assert.ok(row.guidance!.action.path.length > 5, `${row.id}: must show the path to follow`);
      assert.ok(row.guidance!.action.label.length > 5, `${row.id}: must label its button`);
    }
  }
});
