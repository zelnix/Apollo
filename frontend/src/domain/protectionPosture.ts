// Overall Protection Posture: one deterministic answer to "how well am I protected?", separate from Higgins.
//
// Every Apollo protection resolves to who covers it (ApolloSG, the device's own provider, or the person when they ask)
// or to unconfirmed / unavailable, and is weighed by how much it matters (essential / important / additional). Every
// device finding is weighed by its impact on Apollo's protection (none / minor / material / critical). The worst
// meaningful condition decides — never an average, never a count of green items:
//   1. not enough reliable evidence across the essential protections → Protection unknown
//   2. a critical protection or dependency defeated                  → Protection at risk
//   3. a material gap in essential or important coverage             → Protection reduced
//   4. only moderate gaps or unconfirmed protection remain           → Mostly protected
//   5. otherwise                                                     → Well protected
// Each result carries its reason codes and one fixed sentence saying why. Higgins explains it; it never decides it.
// Pure: unit-tested in node (tests/protectionPosture.test.ts).
import type { DeviceProtectionRow } from "./deviceProtectionTypes.ts";
import type { GateId, GatePresentation } from "./gates";
import { AREA_META, areaOfGate, type ProtectionAreaId } from "./protectionAreas.ts";

export type PostureStatus = "unknown" | "at_risk" | "reduced" | "mostly" | "well";
export type Importance = "essential" | "important" | "additional";
/** Who covers a protection right now. */
export type Coverage = "apollo" | "device" | "user_assisted" | "unconfirmed" | "unavailable";
export type Effect = "none" | "minor" | "moderate" | "material" | "critical";
export type DeviceImpact = "none" | "minor" | "material" | "critical";
/** What is wrong with a protection's coverage, if anything. */
export type Gap = "none" | "failed" | "disabled" | "not_set_up" | "unsupported" | "limited" | "unconfirmed" | "substitute_unconfirmed" | "substitute_off";

export const POSTURE_TITLE: Record<PostureStatus, string> = {
  unknown: "Protection unknown", at_risk: "Protection at risk", reduced: "Protection reduced", mostly: "Mostly protected", well: "Well protected",
};

/** How much each of Apollo's protections matters to the person's overall protection. */
export const CAPABILITY_IMPORTANCE: Record<GateId, Importance> = {
  site: "essential", link: "essential", text: "essential",
  call: "important", email: "important", network: "important",
  account: "additional", file: "additional", app: "additional", device: "additional",
};

/** Automatic help the person may choose not to use: not setting it up, or turning it off, leaves no gap. */
const OPTIONAL_AUTOMATIC = new Set<GateId>(["email"]);

/** What is missing when a protection isn't set up — the "because" in its sentence. */
const SETUP_MISSING: Partial<Record<GateId, string>> = {
  site: "the VPN permission it needs hasn't been granted",
  text: "notification access is off",
  call: "ApolloSG isn't set as your call screening app",
  network: "network information isn't allowed",
};

/** The device's own protections that can stand in for one of Apollo's when Apollo can't provide it here. */
const SUBSTITUTE_KIND: Partial<Record<GateId, DeviceProtectionRow["kind"]>> = { call: "call", text: "message" };
const SUBSTITUTE_IDS: Partial<Record<GateId, string[]>> = {
  call: ["caller_id_spam", "silence_unknown_callers", "samsung_auto_blocker", "au_carrier_scam_blocking"],
  text: ["message_spam", "filter_unknown_senders", "au_carrier_scam_blocking"],
};
const isSubstitute = (row: DeviceProtectionRow) =>
  (Object.keys(SUBSTITUTE_KIND) as GateId[]).some((id) => row.kind === SUBSTITUTE_KIND[id] || SUBSTITUTE_IDS[id]?.includes(row.id));

/** What a device setting that isn't as recommended does to Apollo's protection. Anything not listed: none. */
export const DEVICE_IMPACT: Record<string, DeviceImpact> = {
  system_integrity: "critical",
  private_dns: "material", other_vpn: "material", user_certificates: "material", device_admin_apps: "material",
  accessibility_apps: "material", remote_access: "material",
  screen_lock: "minor", os_updates: "minor", developer_options: "minor", unknown_sources: "minor", account_two_step: "minor",
  app_scanner: "minor", antivirus: "minor", safe_browsing: "minor", smartscreen: "minor", notification_readers: "minor",
  ios_developer_mode: "minor", firewall: "minor", uac: "minor", ransomware_protection: "minor",
};

const EFFECT: Record<Exclude<Gap, "none">, Record<Importance, Effect>> = {
  failed: { essential: "critical", important: "material", additional: "moderate" },
  disabled: { essential: "material", important: "material", additional: "minor" },
  not_set_up: { essential: "material", important: "moderate", additional: "minor" },
  substitute_off: { essential: "material", important: "material", additional: "minor" },
  unsupported: { essential: "moderate", important: "moderate", additional: "minor" },
  substitute_unconfirmed: { essential: "moderate", important: "moderate", additional: "minor" },
  unconfirmed: { essential: "moderate", important: "moderate", additional: "minor" },
  limited: { essential: "moderate", important: "minor", additional: "minor" },
};
const RANK: Record<Effect, number> = { none: 0, minor: 1, moderate: 2, material: 3, critical: 4 };
const IMPORTANCE_RANK: Record<Importance, number> = { essential: 0, important: 1, additional: 2 };

export interface CapabilityAssessment {
  id: GateId; title: string; importance: Importance; coverage: Coverage; gap: Gap; effect: Effect;
  /** The device protection standing in for it, when one does (or would). */
  substitute: DeviceProtectionRow | null;
}

export interface PostureFinding {
  /** Stable reason code, e.g. ESSENTIAL_NOT_SET_UP:text, DEVICE_MATERIAL:private_dns. */
  code: string;
  effect: Effect;
  kind: "capability" | "device";
  title: string;
  /** The short clause used after "…, but". */
  clause: string;
  /** The full sentence for this finding. */
  sentence: string;
  /** Where the person fixes or checks it. */
  route: string;
  importance: Importance | null;
}

export interface ProtectionPosture {
  status: PostureStatus;
  title: string;
  /** Why, in one fixed sentence. */
  reason: string;
  /** Every finding with an effect, worst first. */
  findings: PostureFinding[];
  capabilities: CapabilityAssessment[];
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const gateRoute = (id: GateId) => `/gate-details?gate=${id}&category=${areaOfGate(id)}`;
const rowRoute = (row: DeviceProtectionRow) => `/capability/${encodeURIComponent(row.id)}`;

function gateGap(g: GatePresentation): Gap {
  const auto = g.capability.automatic;
  if (!auto) return g.statusLabel === "Manual check" ? "none" : g.statusLabel === "Unable to verify" ? "unconfirmed" : "unsupported";
  switch (auto.state) {
    case "running": return auto.coverageLimited && !auto.manualOnly ? "limited" : "none";
    case "interrupted": return "failed";
    case "off_by_choice": return "disabled";
    case "permission_needed": case "setup_needed": case "not_activated": return "not_set_up";
    case "unsupported": return "unsupported";
    default: return "unconfirmed"; // checking, temporarily unavailable, unverified
  }
}

/** The device's own stand-in for an Apollo protection: active, unconfirmed, verified off, or none. */
function substituteFor(id: GateId, rows: DeviceProtectionRow[]): { state: "active" | "unconfirmed" | "off" | "none"; row: DeviceProtectionRow | null } {
  const candidates = rows.filter((r) => r.kind === SUBSTITUTE_KIND[id] || SUBSTITUTE_IDS[id]?.includes(r.id));
  const active = candidates.find((r) => r.health === "protected");
  if (active) return { state: "active", row: active };
  const core = candidates.filter((r) => !r.optional);
  const unread = core.find((r) => r.health === "check_manually" || r.health === "unable");
  if (unread) return { state: "unconfirmed", row: unread };
  const off = core.find((r) => r.health === "action" || r.health === "review");
  return off ? { state: "off", row: off } : { state: "none", row: null };
}

export function assessCapability(g: GatePresentation, rows: DeviceProtectionRow[]): CapabilityAssessment {
  const importance = CAPABILITY_IMPORTANCE[g.id];
  const base = { id: g.id, title: g.title, importance, substitute: null as DeviceProtectionRow | null };
  const gap = gateGap(g);
  const auto = g.capability.automatic;
  const canCheck = g.capability.onDemand?.state === "ready";
  if (gap === "none") return { ...base, gap, effect: "none", coverage: auto?.state === "running" && !auto.manualOnly ? "apollo" : "user_assisted" };
  if (gap === "failed") return { ...base, gap, effect: EFFECT.failed[importance], coverage: "unavailable" };
  if (gap === "limited") return { ...base, gap, effect: EFFECT.limited[importance], coverage: "apollo" };
  if (gap === "unconfirmed") return { ...base, gap, effect: EFFECT.unconfirmed[importance], coverage: "unconfirmed" };
  if (OPTIONAL_AUTOMATIC.has(g.id) && (gap === "not_set_up" || gap === "disabled")) return { ...base, gap: "none", effect: "none", coverage: canCheck ? "user_assisted" : "unavailable" };
  const coverage: Coverage = canCheck ? "user_assisted" : "unavailable";
  // Off or not set up: the person can turn Apollo's own protection on, so that is the gap.
  if (gap !== "unsupported") return { ...base, gap, effect: EFFECT[gap][importance], coverage };
  // Apollo can't provide it automatically on this device: the device's own protection may cover it instead.
  const sub = substituteFor(g.id, rows);
  if (sub.state === "active") return { ...base, substitute: sub.row, gap: "none", effect: "none", coverage: "device" };
  if (sub.state === "unconfirmed") return { ...base, substitute: sub.row, gap: "substitute_unconfirmed", effect: EFFECT.substitute_unconfirmed[importance], coverage: "unconfirmed" };
  if (sub.state === "off") return { ...base, substitute: sub.row, gap: "substitute_off", effect: EFFECT.substitute_off[importance], coverage: "unavailable" };
  // Nothing at all covers an essential protection: that is a material gap, not a platform note.
  const effect: Effect = !canCheck && importance === "essential" ? "material" : EFFECT.unsupported[importance];
  return { ...base, gap, effect, coverage };
}

function capabilityFinding(c: CapabilityAssessment): PostureFinding {
  const name = c.title; const n = lower(name); const sub = c.substitute?.title ?? "your device's own protection";
  const missing = SETUP_MISSING[c.id] ?? "it hasn't been set up";
  const level = c.importance === "essential" ? "ESSENTIAL" : c.importance === "important" ? "IMPORTANT" : "ADDITIONAL";
  const words: Record<Exclude<Gap, "none">, { clause: string; sentence: string }> = {
    failed: { clause: `${n} has stopped`, sentence: c.effect === "critical"
      ? `ApolloSG's ${n} has stopped, so it isn't protecting you right now. Turn it back on now.`
      : `ApolloSG's ${n} has stopped. Turn it back on to restore this protection.` },
    disabled: { clause: `${n} is turned off`, sentence: `${name} is turned off. Turn it back on to restore this protection.` },
    not_set_up: { clause: `${n} isn't set up yet`, sentence: `ApolloSG can't currently provide automatic ${n} because ${missing}. Turn it on to restore this protection.` },
    substitute_off: { clause: `${n} isn't covered on your device`, sentence: `ApolloSG can't provide ${n} on this device and ${sub} is off. Turn it on to restore this protection.` },
    unsupported: c.coverage === "unavailable"
      ? { clause: `${n} isn't available on this device`, sentence: `${name} isn't available on this device.` }
      : { clause: `${n} can't run automatically on this device`, sentence: `${name} can't run automatically on this device. Use Check whenever you're unsure.` },
    substitute_unconfirmed: { clause: `${n} still needs to be checked on your device`, sentence: `${name} still needs to be checked on your device. ApolloSG can't provide it here, and Apollo can't confirm whether ${sub} is on.` },
    unconfirmed: { clause: `Apollo couldn't confirm ${n}`, sentence: `Apollo couldn't confirm ${n} right now.` },
    limited: { clause: `${n} is working with limits`, sentence: `${name} is working with limits.` },
  };
  const w = words[c.gap as Exclude<Gap, "none">];
  const route = c.substitute && (c.gap === "substitute_unconfirmed" || c.gap === "substitute_off") ? rowRoute(c.substitute) : gateRoute(c.id);
  return { code: `${level}_${c.gap.toUpperCase()}:${c.id}`, effect: c.effect, kind: "capability", title: name, clause: w.clause, sentence: w.sentence, route, importance: c.importance };
}

function deviceFinding(row: DeviceProtectionRow): PostureFinding | null {
  if (row.optional || isSubstitute(row)) return null;
  const impact = DEVICE_IMPACT[row.id] ?? "none";
  let effect: Effect = "none";
  if (row.health === "action") effect = impact;
  // A verified setting weakens Apollo by its full impact, even when the person may have chosen it; only a critical
  // dependency read as "review" (not confirmed defeated) counts as material.
  else if (row.health === "review") effect = impact === "critical" ? "material" : impact;
  else if ((row.health === "check_manually" || row.health === "unable") && (impact === "material" || impact === "critical")) effect = "moderate";
  if (effect === "none") return null;
  const unconfirmed = row.health === "check_manually" || row.health === "unable";
  const clause = unconfirmed ? `Apollo couldn't confirm ${lower(row.title)} on your device` : `${lower(row.title)} on your device needs a look`;
  const sentence = unconfirmed ? `Apollo couldn't confirm ${lower(row.title)} on your device. ${row.detail}`
    : effect === "critical" ? `${row.title}: ${row.detail} This puts your protection at risk. Act on it now.`
      : `${row.title} on your device weakens Apollo's protection. ${row.detail}`;
  return { code: `DEVICE_${effect.toUpperCase()}:${row.id}`, effect, kind: "device", title: row.title, clause, sentence, route: rowRoute(row), importance: null };
}

const DEVICE_UNREAD = (reading: boolean): PostureFinding => ({
  code: reading ? "DEVICE_READING" : "DEVICE_UNREAD", effect: "moderate", kind: "device", title: "Device protections",
  clause: reading ? "Apollo is still reading your device's own settings" : "your device's own settings can't be read here",
  sentence: reading ? "Apollo is still reading your device's own settings." : "Your device's own settings can only be read in the app on your phone.",
  route: "/device-protection", importance: null,
});

const worstFirst = (a: PostureFinding, b: PostureFinding) => RANK[b.effect] - RANK[a.effect]
  || (a.importance ? IMPORTANCE_RANK[a.importance] : 3) - (b.importance ? IMPORTANCE_RANK[b.importance] : 3);

export function protectionPosture(input: {
  gates: GatePresentation[];
  /** No protection reading has completed yet. */
  checking: boolean;
  /** The device's own protections as read, or why they aren't available. */
  device: DeviceProtectionRow[] | "reading" | "not_here";
}): ProtectionPosture {
  const rows = Array.isArray(input.device) ? input.device : [];
  const capabilities = input.gates.map((g) => assessCapability(g, rows));
  const findings = [
    ...capabilities.filter((c) => c.effect !== "none").map(capabilityFinding),
    ...rows.map(deviceFinding).filter((f): f is PostureFinding => !!f),
    ...(Array.isArray(input.device) ? [] : [DEVICE_UNREAD(input.device === "reading")]),
  ].sort(worstFirst);
  const result = (status: PostureStatus, reason: string): ProtectionPosture => ({ status, title: POSTURE_TITLE[status], reason, findings, capabilities });

  // 1. Not enough reliable evidence across the essential protections.
  const essentials = capabilities.filter((c) => c.importance === "essential");
  const unconfirmed = essentials.filter((c) => c.coverage === "unconfirmed");
  if (input.checking) return result("unknown", "Apollo is still checking your protection.");
  if (!essentials.length || unconfirmed.length * 2 > essentials.length) {
    const names = unconfirmed.map((c) => lower(c.title)).join(" or ");
    return result("unknown", `Apollo doesn't have enough reliable evidence yet to tell how well you're protected.${names ? ` It couldn't confirm ${names}.` : ""}`);
  }
  const at = (effect: Effect) => findings.filter((f) => f.effect === effect);
  const more = (list: PostureFinding[]) => (list.length > 1 ? ` ${list.length - 1} more ${list.length === 2 ? "item needs" : "items need"} attention too.` : "");
  // 2. A critical protection or dependency defeated. 3. A material gap.
  const critical = at("critical");
  if (critical.length) return result("at_risk", critical[0].sentence + more(critical));
  const material = at("material");
  if (material.length) return result("reduced", material[0].sentence + more(material));
  // 4. Only moderate gaps or unconfirmed protection remain.
  const moderate = at("moderate");
  if (moderate.length) {
    const apolloNormal = !capabilities.some((c) => ["failed", "disabled", "not_set_up", "unconfirmed", "limited"].includes(c.gap) && c.effect === "moderate");
    const others = moderate.length > 1 ? `, and ${moderate.length - 1} more ${moderate.length === 2 ? "thing needs" : "things need"} a look` : "";
    return result("mostly", `${apolloNormal ? "ApolloSG is working normally. " : ""}Most important protections are covered, but ${moderate[0].clause}${others}.`);
  }
  // 5. Everything essential and important is covered, and no device setting weakens Apollo.
  return result("well", "ApolloSG's important protections are working, and the device protections Apollo relies on are correctly configured.");
}

// ── What the Protection screen and Home show from it ─────────────────────────

export type AreaStatus = "at_risk" | "attention" | "check" | "protected" | "ready" | "unavailable";
export interface AreaRow { id: ProtectionAreaId; title: string; description: string; status: AreaStatus; label: string; note: string }

const AREAS: { id: ProtectionAreaId; description: string }[] = [
  { id: "websites_links", description: "Blocks risky and malicious sites." },
  { id: "email_accounts", description: "Checks for scams and dangerous content." },
  { id: "messages_calls", description: "Detects scam messages, suspicious links and risky calls." },
  { id: "device_internet", description: "Watches this device and its connections." },
  { id: "apps_files", description: "Checks apps and files for known risks." },
];

/** One row per protection area: its worst effect, or who covers it. */
export function areaRows(posture: ProtectionPosture): AreaRow[] {
  return AREAS.map(({ id, description }) => {
    const caps = posture.capabilities.filter((c) => areaOfGate(c.id) === id);
    const row = (status: AreaStatus, label: string, note: string): AreaRow => ({ id, title: AREA_META[id].title, description, status, label, note });
    const count = (effects: Effect[]) => caps.filter((c) => effects.includes(c.effect)).length;
    const issues = count(["material", "critical"]);
    const plural = (k: number, one: string) => `${k} ${one}${k === 1 ? "" : "s"}`;
    if (count(["critical"])) return row("at_risk", "At risk", plural(issues, "issue"));
    if (issues) return row("attention", "Needs attention", plural(issues, "issue"));
    const toCheck = count(["moderate"]);
    if (toCheck) return row("check", "To check", `${toCheck} to check`);
    if (caps.some((c) => c.coverage === "apollo")) return row("protected", "Protected", "By ApolloSG");
    if (caps.some((c) => c.coverage === "device")) return row("protected", "Protected", "By your device");
    if (caps.some((c) => c.coverage === "user_assisted")) return row("ready", "Ready", "When you check");
    return row("unavailable", "Not available", "On this device");
  });
}

/** "4 protected · 2 need attention" — at most two parts, keeping what needs the person. */
export function countLine(c: { protected: number; attention: number; toCheck: number }): string {
  const parts = [
    c.protected ? `${c.protected} protected` : "",
    c.attention ? `${c.attention} need${c.attention === 1 ? "s" : ""} attention` : "",
    c.toCheck ? `${c.toCheck} to check` : "",
  ].filter(Boolean);
  return (parts.length === 3 ? parts.slice(1) : parts).join(" · ") || "None available here";
}

/** Apollo's protection areas counted from the rows the Protection screen shows, so Home agrees with it. */
export function areaCounts(rows: AreaRow[]) {
  const n = (statuses: AreaStatus[]) => rows.filter((r) => statuses.includes(r.status)).length;
  return { protected: n(["protected", "ready"]), attention: n(["at_risk", "attention"]), toCheck: n(["check"]) };
}
