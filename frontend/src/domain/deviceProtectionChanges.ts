// Device Protections — what changed since the previous check.
//
// Compares the last two real assessments and reports meaningful protection drift: a setting moving away
// from (or back to) the recommended state, or a new privilege appearing. It reports the observed change
// only — never who made it or why. A setting Apollo could not read on either side is never a change:
// unknown is not unsafe, and losing a reading is not a protection being switched off.
//
// Pure: no React, no native imports, no clock of its own.
import type { DeviceProtectionRow, ProtectionHealth } from "./deviceProtectionTypes.ts";
import { PROTECTION_HEALTH_LABEL } from "./deviceProtectionTypes.ts";
import type { SecurityStateRead } from "./deviceSecurityCatalogue.ts";

export interface ProtectionFacts {
  usbDebugging: boolean | null;
  developerOptions: boolean | null;
  unknownSources: boolean | null;
  screenLockSecure: boolean | null;
  deviceAdmins: string[] | null;
  accessibilityServices: string[] | null;
  notificationListeners: string[] | null;
  userCertificateCount: number | null;
  otherVpnActive: boolean | null;
  appScannerOff: boolean | null;
}

export interface ProtectionSnapshot {
  at: string;
  health: Record<string, { title: string; health: ProtectionHealth }>;
  facts: ProtectionFacts;
}

export interface ProtectionChange {
  id: string;
  protectionId: string;
  title: string;
  /** "worse" moves away from the recommended state or adds a privilege; "better" moves back. */
  direction: "worse" | "better";
  text: string;
  at: string;
}

const READ_HEALTH: ProtectionHealth[] = ["protected", "review", "action"];
const RANK: Partial<Record<ProtectionHealth, number>> = { protected: 0, review: 1, action: 2 };

export function protectionSnapshot(rows: DeviceProtectionRow[], read: SecurityStateRead | null, at: string): ProtectionSnapshot {
  const r = read;
  return {
    at,
    health: Object.fromEntries(rows.map((row) => [row.id, { title: row.title, health: row.health }])),
    facts: {
      usbDebugging: r?.usbDebugging ?? null,
      developerOptions: r?.developerOptions ?? null,
      unknownSources: r?.unknownSources ?? null,
      screenLockSecure: r?.screenLockSecure ?? null,
      deviceAdmins: r?.deviceAdmins ?? null,
      accessibilityServices: r?.accessibilityServices ?? null,
      notificationListeners: r?.notificationListeners?.filter((name) => !/apollo/i.test(name)) ?? null,
      userCertificateCount: r && r.userCertificateCount !== null && r.userCertificateCount >= 0 ? r.userCertificateCount : null,
      otherVpnActive: r?.otherVpnActive ?? null,
      appScannerOff: r?.osThreatReport && r.osThreatReport.status !== "not_available" && r.osThreatReport.status !== "error"
        ? r.osThreatReport.protectionOff ?? null : null,
    },
  };
}

type Flag = { key: keyof ProtectionFacts; protectionId: string; title: string; on: string; off: string };
// A switch whose RISKY value is `true`, except screenLockSecure where the risky value is `false` (inverted).
const FLAGS: Flag[] = [
  { key: "usbDebugging", protectionId: "developer_options", title: "USB debugging", on: "USB debugging was turned on.", off: "USB debugging was turned off." },
  { key: "developerOptions", protectionId: "developer_options", title: "Developer options", on: "Developer options were turned on.", off: "Developer options were turned off." },
  { key: "unknownSources", protectionId: "unknown_sources", title: "Installing apps from outside the store", on: "Installing apps from outside the store was allowed.", off: "Installing apps from outside the store is no longer allowed." },
  { key: "otherVpnActive", protectionId: "other_vpn", title: "Another VPN", on: "Another VPN app started routing this phone's traffic.", off: "The other VPN app is no longer routing this phone's traffic." },
  { key: "appScannerOff", protectionId: "app_scanner", title: "App scanning", on: "Your device's app scanning reported it was switched off.", off: "Your device's app scanning reported it is switched on again." },
];

function newNames(before: string[] | null, after: string[] | null): string[] {
  if (!before || !after) return [];
  return after.filter((name) => !before.includes(name));
}

/** Meaningful changes between two real assessments. Never inferred, never from an unread value. */
export function diffProtectionSnapshots(prev: ProtectionSnapshot, next: ProtectionSnapshot): ProtectionChange[] {
  const changes: Omit<ProtectionChange, "id" | "at">[] = [];
  const covered = new Set<string>();
  const add = (protectionId: string, title: string, direction: ProtectionChange["direction"], text: string) => {
    changes.push({ protectionId, title, direction, text });
    covered.add(protectionId);
  };
  const a = prev.facts, b = next.facts;

  for (const flag of FLAGS) {
    const before = a[flag.key], after = b[flag.key];
    if (typeof before !== "boolean" || typeof after !== "boolean" || before === after) continue;
    add(flag.protectionId, flag.title, after ? "worse" : "better", after ? flag.on : flag.off);
  }
  if (typeof a.screenLockSecure === "boolean" && typeof b.screenLockSecure === "boolean" && a.screenLockSecure !== b.screenLockSecure) {
    add("screen_lock", "Screen lock", b.screenLockSecure ? "better" : "worse", b.screenLockSecure ? "A secure screen lock was set." : "The secure screen lock was removed.");
  }
  for (const name of newNames(a.deviceAdmins, b.deviceAdmins)) add("device_admin_apps", "Device-admin control", "worse", `${name} was given device-admin control.`);
  for (const name of newNames(a.accessibilityServices, b.accessibilityServices)) add("accessibility_apps", "Accessibility access", "worse", `${name} was given Accessibility access, so it can read and control the screen.`);
  for (const name of newNames(a.notificationListeners, b.notificationListeners)) add("notification_readers", "Notification access", "worse", `${name} can now read your notifications.`);
  if (a.userCertificateCount !== null && b.userCertificateCount !== null && b.userCertificateCount > a.userCertificateCount) {
    const n = b.userCertificateCount - a.userCertificateCount;
    add("user_certificates", "Installed certificates", "worse", `${n} new hand-installed certificate${n === 1 ? "" : "s"} appeared on this device.`);
  }

  // Any other protection whose verified health moved. Unread on either side is not a change.
  for (const [id, after] of Object.entries(next.health)) {
    const before = prev.health[id];
    if (!before || covered.has(id) || before.health === after.health) continue;
    if (!READ_HEALTH.includes(before.health) || !READ_HEALTH.includes(after.health)) continue;
    const worse = (RANK[after.health] ?? 0) > (RANK[before.health] ?? 0);
    add(id, after.title, worse ? "worse" : "better", `${after.title} changed from ${PROTECTION_HEALTH_LABEL[before.health]} to ${PROTECTION_HEALTH_LABEL[after.health]}.`);
  }
  return changes.map((change, i) => ({ ...change, id: `${change.protectionId}:${next.at}:${i}`, at: next.at }));
}

/** Changes worth showing: the recent ones, newest first. */
export function recentChanges(changes: ProtectionChange[], now: number, days = 14): ProtectionChange[] {
  return changes.filter((c) => now - Date.parse(c.at) <= days * 86_400_000).sort((x, y) => Date.parse(y.at) - Date.parse(x.at));
}

/** Recent changes the person hasn't opened yet. They carry the "Changed" tag and the Home banner until opened. */
export function unseenChanges(changes: ProtectionChange[], seen: Iterable<string>, now: number, days = 14): ProtectionChange[] {
  const opened = new Set(seen);
  return recentChanges(changes, now, days).filter((c) => !opened.has(c.id));
}

export interface ChangeBanner {
  title: string;
  text: string;
  /** True when any change moved away from the recommended state. */
  worse: boolean;
  /** The one protection to open, or null when several changed (open the list instead). */
  protectionId: string | null;
}

/** Home's banner for unopened changes — the observed change only, never who made it or why. */
export function changeBanner(unseen: ProtectionChange[]): ChangeBanner | null {
  if (!unseen.length) return null;
  const ids = [...new Set(unseen.map((c) => c.protectionId))];
  const worse = unseen.some((c) => c.direction === "worse");
  if (ids.length === 1) {
    const more = unseen.length - 1;
    return {
      title: worse ? "A device protection changed" : "A device protection is back as recommended",
      text: more ? `${unseen[0].text} (${more} more change${more === 1 ? "" : "s"} to the same setting.)` : unseen[0].text,
      worse,
      protectionId: ids[0],
    };
  }
  const shown = unseen.slice(0, 2).map((c) => c.text).join(" ");
  const rest = unseen.length - 2;
  return { title: `${ids.length} device protections changed`, text: rest > 0 ? `${shown} And ${rest} more.` : shown, worse, protectionId: null };
}
