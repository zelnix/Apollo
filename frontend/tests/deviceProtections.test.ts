// Device Protections: exception-first grouping, change detection and the Home banner.
// Run: node --test tests/deviceProtections.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { changeBanner, diffProtectionSnapshots, protectionSnapshot, unseenChanges, whatToDoNow, type ProtectionChange } from "../src/domain/deviceProtectionChanges.ts";
import { deviceAreaRows, groupDeviceProtections, summariseDeviceProtections, type DeviceProtectionRow } from "../src/domain/deviceProtectionTypes.ts";
import { EMPTY_SECURITY_READ, securityProtectionRows, type SecurityStateRead } from "../src/domain/deviceSecurityCatalogue.ts";

const NOW = Date.parse("2026-06-15T12:00:00.000Z");
const read = (over: Partial<SecurityStateRead> = {}): SecurityStateRead => ({ ...EMPTY_SECURITY_READ, ...over });
const rows = (over: Partial<SecurityStateRead> = {}) => securityProtectionRows("android", read(over), NOW, { manufacturer: "samsung", osVersion: "15", model: "SM-S921B" });
const snap = (over: Partial<SecurityStateRead>, at: string) => protectionSnapshot(rows(over), read(over), at);

// ── Exception-first grouping ──────────────────────────────────────

test("verified deviations come first, unread settings need checking, healthy ones are protected", () => {
  const groups = groupDeviceProtections(rows({ screenLockSecure: false, developerOptions: true, usbDebugging: false, userCertificateCount: 0, rootIndicators: [] }));
  // Action before review: no screen lock (action) ahead of developer options on without USB debugging (review).
  assert.deepEqual(groups.needsAttention.map((r) => r.id), ["screen_lock", "developer_options"]);
  assert.deepEqual(groups.protectedRows.map((r) => r.id).sort(), ["system_integrity", "user_certificates"]);
  assert.ok(groups.needsChecking.some((r) => r.id === "app_scanner"));
  for (const row of groups.needsChecking) assert.equal(row.stateLabel, "Check manually");
  // Optional protections (SIM PIN) never crowd "Needs checking".
  assert.ok(groups.optional.some((r) => r.id === "sim_pin"));
  assert.ok(!groups.needsChecking.some((r) => r.optional));
  // Every row lands in exactly one group.
  const all = [...groups.needsAttention, ...groups.needsChecking, ...groups.protectedRows, ...groups.optional, ...groups.notAvailable];
  assert.equal(all.length, rows({ screenLockSecure: false, developerOptions: true, usbDebugging: false, userCertificateCount: 0, rootIndicators: [] }).length);
  assert.equal(new Set(all.map((r) => r.id)).size, all.length);
});

test("maker-specific protections are only offered on that maker's devices", () => {
  assert.ok(rows().some((r) => r.id === "samsung_auto_blocker"));
  assert.ok(!securityProtectionRows("android", read(), NOW, { manufacturer: "google", osVersion: "15", model: "Pixel 9" }).some((r) => r.id === "samsung_auto_blocker"));
});

// ── Device protection areas (the Device Protections tab) ─────────

test("each category leads with its issues, then what needs checking, then how much is protected", () => {
  const base = rows({ screenLockSecure: false });
  const byId = (list: DeviceProtectionRow[]) => Object.fromEntries(deviceAreaRows(list).map((r) => [r.id, r]));
  const areas = byId(base);
  assert.deepEqual(deviceAreaRows(base).map((r) => r.id), ["calls_messages", "apps", "privacy", "web", "access", "updates", "recovery"]);
  assert.equal(areas.access.title, "Device & Account Security");
  assert.equal(areas.access.label, "Needs attention");
  assert.equal(areas.access.note, "1 issue");
  assert.equal(areas.apps.label, "Need checking");
  assert.match(areas.apps.note, /^\d+ items? to check$/);
  // A category where everything readable is set as recommended counts what is protected out of what is there.
  const recovery = base.map((r) => (r.area === "recovery" ? { ...r, health: r.optional ? "check_manually" as const : "protected" as const } : r));
  const total = recovery.filter((r) => r.area === "recovery" && r.health !== "not_available").length;
  const ok = recovery.filter((r) => r.area === "recovery" && r.health === "protected").length;
  assert.equal(byId(recovery).recovery.label, "Protected");
  assert.equal(byId(recovery).recovery.note, `${ok} of ${total} protected`);
  // Nothing is "Protected" without a real read.
  for (const r of deviceAreaRows("not_here")) assert.deepEqual([r.status, r.label, r.note], ["unread", "Not checked", "Read on your phone"]);
  assert.ok(deviceAreaRows("reading").every((r) => r.status === "unread"));
});

test("the summary counts only what was read, and says when nothing could be", () => {
  const attention = summariseDeviceProtections(groupDeviceProtections(rows({ screenLockSecure: false })), true);
  assert.equal(attention.overall, "action");
  assert.equal(attention.headline, "1 setting needs attention");
  assert.match(attention.detail, /to check manually/);
  const calm = summariseDeviceProtections(groupDeviceProtections(rows({ screenLockSecure: true })), true);
  assert.equal(calm.overall, "check");
  assert.equal(calm.headline, "Verified settings are as recommended");
  const preview = summariseDeviceProtections(groupDeviceProtections(rows()), false);
  assert.equal(preview.overall, "unread");
  assert.equal(preview.headline, "Not checked here");
});

// ── Change detection ──────────────────────────────────────────────

test("USB debugging being switched on is reported as exactly that", () => {
  const before = snap({ developerOptions: true, usbDebugging: false }, "2026-06-14T09:00:00.000Z");
  const after = snap({ developerOptions: true, usbDebugging: true }, "2026-06-15T09:00:00.000Z");
  const changes = diffProtectionSnapshots(before, after);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].protectionId, "developer_options");
  assert.equal(changes[0].direction, "worse");
  assert.equal(changes[0].text, "USB debugging was turned on.");
  assert.equal(changes[0].at, "2026-06-15T09:00:00.000Z");
  // Higgins' next step names the exact switch, not just "Developer options".
  assert.equal(changes[0].kind, "usb_debugging");
  assert.match(whatToDoNow(changes[0]), /^Turn USB debugging off unless you switched it on yourself/);
});

test("a setting Apollo couldn't read on either side is never a change", () => {
  const before = snap({ usbDebugging: null, screenLockSecure: true }, "2026-06-14T09:00:00.000Z");
  const after = snap({ usbDebugging: true, screenLockSecure: null }, "2026-06-15T09:00:00.000Z");
  assert.deepEqual(diffProtectionSnapshots(before, after), []);
});

test("new privileges and a removed screen lock are named; fixing them is reported as better", () => {
  const before = snap({ screenLockSecure: true, accessibilityServices: ["TalkBack"], userCertificateCount: 0 }, "2026-06-14T09:00:00.000Z");
  const after = snap({ screenLockSecure: false, accessibilityServices: ["TalkBack", "QuickSupport"], userCertificateCount: 1 }, "2026-06-15T09:00:00.000Z");
  const changes = diffProtectionSnapshots(before, after);
  assert.ok(changes.some((c) => c.protectionId === "screen_lock" && c.direction === "worse" && /removed/.test(c.text)));
  assert.ok(changes.some((c) => c.protectionId === "accessibility_apps" && /QuickSupport was given Accessibility access/.test(c.text)));
  assert.ok(changes.some((c) => c.protectionId === "user_certificates" && /1 new hand-installed certificate appeared/.test(c.text)));
  const fixed = diffProtectionSnapshots(after, snap({ screenLockSecure: true, accessibilityServices: ["TalkBack", "QuickSupport"], userCertificateCount: 1 }, "2026-06-16T09:00:00.000Z"));
  assert.deepEqual(fixed.map((c) => [c.protectionId, c.direction]), [["screen_lock", "better"]]);
});

test("any other verified health move is reported once, by name", () => {
  const before = snap({ securityPatch: "2026-05-01" }, "2026-06-14T09:00:00.000Z");
  const after = protectionSnapshot(securityProtectionRows("android", read({ securityPatch: "2026-05-01" }), Date.parse("2027-07-01T00:00:00.000Z")), read({ securityPatch: "2026-05-01" }), "2027-07-01T00:00:00.000Z");
  const changes = diffProtectionSnapshots(before, after);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].text, "Security updates changed from Protected to Action needed.");
  assert.equal(changes[0].direction, "worse");
});

// ── "Changed" tag and Home banner ────────────────────────────────

const change = (id: string, protectionId: string, direction: ProtectionChange["direction"], at: string, text = `${protectionId} changed.`, kind?: string): ProtectionChange =>
  ({ id, protectionId, title: protectionId, direction, text, at, ...(kind ? { kind } : {}) });

test("every change carries one short pre-written next step; a fix needs nothing", () => {
  const worseIds = ["developer_options", "unknown_sources", "other_vpn", "app_scanner", "screen_lock", "device_admin_apps", "accessibility_apps", "notification_readers", "user_certificates"];
  for (const id of worseIds) {
    const todo = whatToDoNow({ protectionId: id, direction: "worse" });
    assert.ok(todo.length > 10 && todo.length <= 110, `${id}: short next step (${todo.length})`);
    assert.notEqual(todo, "Open it to see what Higgins recommends.", `${id}: must be specific`);
  }
  assert.match(whatToDoNow({ protectionId: "developer_options", direction: "worse", kind: "usb_debugging" }), /USB debugging/);
  assert.equal(whatToDoNow({ protectionId: "os_updates", direction: "worse" }), "Open it to see what Higgins recommends.");
  assert.equal(whatToDoNow({ protectionId: "screen_lock", direction: "better" }), "Nothing to do — it's back as recommended.");
});

test("a change stays unopened until its protection is opened, and old ones fade", () => {
  const changes = [
    change("a", "developer_options", "worse", "2026-06-15T09:00:00.000Z"),
    change("b", "screen_lock", "better", "2026-06-14T09:00:00.000Z"),
    change("c", "other_vpn", "worse", "2026-05-01T09:00:00.000Z"),
  ];
  assert.deepEqual(unseenChanges(changes, [], NOW).map((c) => c.id), ["a", "b"]);
  assert.deepEqual(unseenChanges(changes, ["a"], NOW).map((c) => c.id), ["b"]);
});

test("the Home banner opens the one changed protection, or the list when several changed", () => {
  assert.equal(changeBanner([]), null);
  const one = changeBanner([change("a", "developer_options", "worse", "2026-06-15T09:00:00.000Z", "USB debugging was turned on.", "usb_debugging")])!;
  assert.equal(one.protectionId, "developer_options");
  assert.equal(one.worse, true);
  assert.equal(one.text, "USB debugging was turned on.");
  assert.match(one.todo, /^Turn USB debugging off/);
  const better = changeBanner([change("b", "screen_lock", "better", "2026-06-15T09:00:00.000Z")])!;
  assert.equal(better.worse, false);
  assert.match(better.title, /back as recommended/);
  assert.match(better.todo, /^Nothing to do/);
  const many = changeBanner([
    change("b", "screen_lock", "better", "2026-06-15T09:00:00.000Z", "A secure screen lock was set."),
    change("a", "developer_options", "worse", "2026-06-15T09:00:00.000Z", "USB debugging was turned on.", "usb_debugging"),
    change("c", "notification_readers", "worse", "2026-06-15T09:00:00.000Z", "X can now read your notifications."),
  ])!;
  assert.equal(many.protectionId, null);
  assert.equal(many.title, "3 device protections changed");
  assert.match(many.text, /And 1 more\.$/);
  // With several, Higgins leads with the first change that needs doing — never the good news.
  assert.match(many.todo, /^First: Turn USB debugging off/);
  const allFixed = changeBanner([
    change("b", "screen_lock", "better", "2026-06-15T09:00:00.000Z"),
    change("d", "other_vpn", "better", "2026-06-15T09:00:00.000Z"),
  ])!;
  assert.match(allFixed.todo, /^Nothing to do/);
});

