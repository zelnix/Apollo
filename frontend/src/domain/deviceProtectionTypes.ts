/**
 * Shared contracts for everything in the Device area that protects the person.
 *
 * Both halves of the Device Capabilities engine speak this language:
 *   • `deviceCapabilities.ts`      — Apollo's own capabilities and the provider protections it reads.
 *   • `deviceSecurityCatalogue.ts` — every OS/OEM protection Apollo can usefully guide on.
 *
 * It lives in its own file purely so those two can share types without importing each other.
 */

import type { SettingsTarget } from "../utils/deviceSettings";

export type CapabilityPlatform = "android" | "ios" | "web" | "windows" | "macos";

export interface CapabilityAction {
  target: SettingsTarget;
  path: string;
  label: string;
}

/**
 * The state of one protection on this device.
 *
 * `not_verifiable` is the honest answer whenever the platform gives Apollo no way to read a setting.
 * It is never upgraded to "active" and never downgraded to "off" — Apollo does not infer either.
 */
export type DeviceProtectionState =
  /** Confirmed on, by a real read. */
  | "active"
  /** A setting whose SAFE value is "off" (side-loading, developer options) is set the safe way. */
  | "as_recommended"
  /** Present on the device but not the active handler, so its protection isn't being applied. */
  | "installed_not_default"
  /** Confirmed off or needing attention, by a real read. */
  | "off"
  /** Confirmed present but behind — used for security-update level. */
  | "out_of_date"
  /** Genuinely not on this device at all. */
  | "absent"
  /** Apollo asked and the read failed. */
  | "unknown"
  /** The platform gives Apollo no way to read this. The person can still check it themselves. */
  | "not_verifiable"
  /** Apollo is not on the device itself (browser preview), so nothing could be read. */
  | "not_readable_here";

export const PROTECTION_STATE_LABEL: Record<DeviceProtectionState, string> = {
  active: "Active on your device",
  as_recommended: "Set as recommended",
  installed_not_default: "Installed, not active",
  off: "Needs your attention",
  out_of_date: "Out of date",
  absent: "Not on this device",
  unknown: "Apollo couldn’t check",
  not_verifiable: "Apollo can’t verify this",
  not_readable_here: "Can’t be read in this preview",
};

/** The categories the Device area groups protections by, in reading order. */
export type ProtectionArea = "calls_messages" | "apps" | "web" | "access" | "updates" | "recovery";

export const PROTECTION_AREA_LABEL: Record<ProtectionArea, string> = {
  calls_messages: "Calls and messages",
  apps: "Apps on this device",
  web: "Web and network",
  access: "Who can get in",
  updates: "Updates and system",
  recovery: "If it is lost or stolen",
};

export const PROTECTION_AREA_ORDER: ProtectionArea[] = ["calls_messages", "apps", "web", "access", "updates", "recovery"];

/**
 * Rows grouped by category, in reading order. Empty categories are dropped.
 *
 * Both kinds of row carry an `area`, so a device protection and an Apollo capability covering the
 * same ground (calls, apps, the network…) sit in the same category for the person.
 */
export function protectionsByArea<T extends { area: ProtectionArea }>(rows: T[]): { area: ProtectionArea; label: string; rows: T[] }[] {
  return PROTECTION_AREA_ORDER
    .map((area) => ({ area, label: PROTECTION_AREA_LABEL[area], rows: rows.filter((r) => r.area === area) }))
    .filter((group) => group.rows.length > 0);
}

/** What Higgins recommends for a protection, and how the person checks it for themselves. */
export interface ProtectionGuidance {
  /** The recommended configuration, phrased without claiming the current one. */
  recommended: string;
  /** Step-by-step instructions for checking it on this device. */
  steps: string[];
  /** Deep link to the closest supported settings screen, plus the path to follow from there. */
  action: CapabilityAction;
  /** True when only the person can confirm this — Apollo cannot read it. */
  selfCheck: boolean;
}

/** One protection on this device: a provider's, the OS's, or the OEM's — never Apollo's own. */
export interface DeviceProtectionRow {
  id: string;
  /** The protection's own name, or the provider's name where a provider owns it. */
  title: string;
  /** One line describing what it covers. */
  subtitle: string;
  kind: "call" | "message" | "device";
  /** Which category this protection belongs to on the Device screen. */
  area: ProtectionArea;
  state: DeviceProtectionState;
  stateLabel: string;
  /** The honest sentence about this protection's state on this device. */
  detail: string;
  /** Who owns this protection. Apollo never substitutes its own name. */
  attributedTo: string;
  /** What it is, in plain words. */
  what: string;
  /** How it helps protect the person. */
  benefit: string;
  /** Provider rows only: whether Apollo may use the provider's classification as evidence. */
  classificationAccessible?: boolean;
  /** Provider rows only: the plain statement about that evidence. */
  evidenceLine?: string;
  /** Present whenever there is something the person can check or change. */
  guidance?: ProtectionGuidance;
}

/** Rows worth acting on: not confirmed active, and something can actually be done about it. */
export function protectionsNeedingAttention(rows: DeviceProtectionRow[]): DeviceProtectionRow[] {
  return rows.filter((r) =>
    r.state !== "active" && r.state !== "as_recommended" && r.state !== "absent"
    && r.state !== "not_readable_here" && !!r.guidance);
}
