/**
 * Shared contracts for everything in the Device area that protects the person.
 *
 * Both halves of the Device Protections engine speak this language:
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

/**
 * The user-facing health of a protection — compared with the recommended state, never with what Apollo
 * may access. Unknown and non-compliant stay distinct: an unreadable setting is "Check manually" or
 * "Unable to check", never unsafe, and never protected.
 */
export type ProtectionHealth = "protected" | "review" | "action" | "check_manually" | "unable" | "not_available";

export const PROTECTION_HEALTH_LABEL: Record<ProtectionHealth, string> = {
  protected: "Protected",
  review: "Review recommended",
  action: "Action needed",
  check_manually: "Check manually",
  unable: "Unable to check",
  not_available: "Not available",
};

/** Where a state came from. A person's own say-so is never Apollo verification. */
export type ProtectionEvidence = "apollo_verified" | "check_manually" | "unable_to_check" | "not_checked" | "not_applicable";

export const PROTECTION_EVIDENCE_LABEL: Record<ProtectionEvidence, string> = {
  apollo_verified: "Apollo verified",
  check_manually: "Check manually",
  unable_to_check: "Unable to check",
  not_checked: "Not checked",
  not_applicable: "Not applicable",
};

const HEALTH_OF: Record<DeviceProtectionState, ProtectionHealth> = {
  active: "protected", as_recommended: "protected", installed_not_default: "review", off: "action", out_of_date: "review",
  absent: "not_available", unknown: "unable", not_verifiable: "check_manually", not_readable_here: "unable",
};
const EVIDENCE_OF: Record<DeviceProtectionState, ProtectionEvidence> = {
  active: "apollo_verified", as_recommended: "apollo_verified", installed_not_default: "apollo_verified", off: "apollo_verified",
  out_of_date: "apollo_verified", absent: "not_applicable", unknown: "unable_to_check", not_verifiable: "check_manually", not_readable_here: "not_checked",
};

export function healthFor(state: DeviceProtectionState, override?: ProtectionHealth): ProtectionHealth {
  // Only a real read can move a state's health, and only between the read outcomes.
  return override && EVIDENCE_OF[state] === "apollo_verified" ? override : HEALTH_OF[state];
}
export const evidenceFor = (state: DeviceProtectionState): ProtectionEvidence => EVIDENCE_OF[state];

/** The label shown for a state: "Set as recommended" for a safe-when-off setting, otherwise the health label. */
export function healthLabel(state: DeviceProtectionState, health: ProtectionHealth): string {
  return state === "as_recommended" ? "Set as recommended" : PROTECTION_HEALTH_LABEL[health];
}

/** The categories the Device area groups protections by, in reading order. */
export type ProtectionArea = "calls_messages" | "apps" | "privacy" | "web" | "access" | "updates" | "recovery";

export const PROTECTION_AREA_LABEL: Record<ProtectionArea, string> = {
  calls_messages: "Calls, messages and spam",
  apps: "Apps and app privileges",
  privacy: "Permissions and privacy",
  web: "Browser, web and network",
  access: "Device and account security",
  updates: "Updates and system integrity",
  recovery: "Anti-theft and find my device",
};

export const PROTECTION_AREA_ORDER: ProtectionArea[] = ["access", "apps", "privacy", "calls_messages", "web", "updates", "recovery"];

/** How widely one explanation of a protection is true — the broadest accurate scope is used for reuse. */
export type ExplanationScope = "os" | "os_version" | "oem" | "oem_os_version" | "model";

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
  /** Health compared with the recommended state. */
  health: ProtectionHealth;
  /** Where the state came from — Apollo's read, or nothing Apollo could read. */
  evidence: ProtectionEvidence;
  stateLabel: string;
  /** The honest sentence about this protection's state on this device. */
  detail: string;
  /** Who owns this protection. Apollo never substitutes its own name. */
  attributedTo: string;
  /** Worth having for some people, not for everyone — never listed under "Needs checking". */
  optional?: boolean;
  /** How widely Higgins' explanation of this protection is true (what it is, why it matters). */
  explanationScope: ExplanationScope;
  /** Provider rows only: whether Apollo may use the provider's classification as evidence. */
  classificationAccessible?: boolean;
  /** Provider rows only: the plain statement about that evidence. */
  evidenceLine?: string;
  /** Present whenever there is something the person can check or change. */
  guidance?: ProtectionGuidance;
}

/** Verified settings that don't meet the recommended state. Never an unread one. */
export function protectionsNeedingAttention(rows: DeviceProtectionRow[]): DeviceProtectionRow[] {
  return rows.filter((r) => r.health === "action" || r.health === "review");
}

export interface DeviceProtectionGroups {
  /** Verified settings that do not meet the recommended protection state, most serious first. */
  needsAttention: DeviceProtectionRow[];
  /** Important protections Apollo cannot verify automatically. */
  needsChecking: DeviceProtectionRow[];
  /** Verified compliant — collapsed by default. */
  protectedRows: DeviceProtectionRow[];
  /** Worth it for some people only, whatever their state. */
  optional: DeviceProtectionRow[];
  notAvailable: DeviceProtectionRow[];
}

/** Exception-first grouping for the Device Protections screen. */
export function groupDeviceProtections(rows: DeviceProtectionRow[]): DeviceProtectionGroups {
  const optional = rows.filter((r) => r.optional && r.health !== "action" && r.health !== "review");
  const core = rows.filter((r) => !optional.includes(r));
  return {
    needsAttention: [...core.filter((r) => r.health === "action"), ...core.filter((r) => r.health === "review")],
    needsChecking: core.filter((r) => r.health === "check_manually" || r.health === "unable"),
    protectedRows: core.filter((r) => r.health === "protected"),
    optional,
    notAvailable: core.filter((r) => r.health === "not_available"),
  };
}

export type DeviceProtectionsOverall = "action" | "review" | "check" | "protected" | "unread";

export interface DeviceProtectionsSummary { overall: DeviceProtectionsOverall; headline: string; detail: string }

/** The one-line status for the screen header and Home. Counts only what was really read. */
export function summariseDeviceProtections(groups: DeviceProtectionGroups, hasNativeHost: boolean): DeviceProtectionsSummary {
  const attention = groups.needsAttention.length;
  const checking = groups.needsChecking.length;
  const ok = groups.protectedRows.length;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (!hasNativeHost) return { overall: "unread", headline: "Not checked here", detail: "Open ApolloSG on your device to check its own protections." };
  const checkLine = checking ? `${plural(checking, "to check manually", "to check manually")}.` : "";
  if (attention) {
    const actions = groups.needsAttention.filter((r) => r.health === "action").length;
    return { overall: actions ? "action" : "review", headline: `${plural(attention, "setting needs", "settings need")} attention`, detail: [ok ? `${ok} protected.` : "", checkLine].filter(Boolean).join(" ") };
  }
  if (ok) return { overall: checking ? "check" : "protected", headline: "Verified settings are as recommended", detail: [`${ok} protected.`, checkLine].filter(Boolean).join(" ") };
  if (checking) return { overall: "check", headline: "Nothing verified needs attention", detail: `Apollo couldn't read these automatically — ${checkLine}` };
  return { overall: "unread", headline: "Nothing read yet", detail: "Apollo hasn't been able to read this device's protections." };
}

/**
 * Higgins' fixed sentence for a protection's current state — deterministic, from the evidence only.
 * No Gemini call is ever needed to say "This is already set as recommended."
 */
export function protectionStatusLine(row: Pick<DeviceProtectionRow, "health" | "detail"> & { state?: DeviceProtectionState }): string {
  if (row.state === "not_readable_here") return `Apollo couldn't read this here, so it isn't marked safe or unsafe. ${row.detail}`;
  switch (row.health) {
    case "protected": return `This is already set as recommended. ${row.detail}`;
    case "review": return `Worth reviewing. ${row.detail}`;
    case "action": return `This needs changing. ${row.detail}`;
    case "check_manually": return `Apollo can't read this setting on this device, so it isn't marked safe or unsafe. ${row.detail}`;
    case "unable": return `Apollo tried to read this and couldn't, so its state is unknown — not unsafe. ${row.detail}`;
    default: return `This protection isn't available on this device. ${row.detail}`;
  }
}
