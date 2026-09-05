// Incident Timeline — one Threat Scent as an ordered story (email → link → login → MFA) with ONE combined
// Stay With Me plan. Steps are derived from what actually happened (categories, scenarios, recoveries),
// deduplicated and ordered by urgency: stop the live access first, then locks, then money, then clean-up.

import { RECOVERY_STEPS, type RecoveryKind } from "./recovery.ts";
import { type ApolloState, type EventCategory, type PatrolEvent, STATE_RANK_ORDER } from "./types.ts";

export const CATEGORY_LABEL: Record<EventCategory, string> = { link: "Link checked", website: "Website", connection: "Network", known_threat: "Known threat", protection: "Protection", system: "System", message: "Message", call: "Phone call", app: "App", device: "Device", account: "Account alert", email: "Email" };
export const CATEGORY_GLYPH: Record<EventCategory, string> = { link: "🔗", website: "🌐", connection: "📡", known_threat: "⛔", protection: "🛡️", system: "⚙️", message: "💬", call: "📞", app: "📱", device: "🛡️", account: "🔐", email: "✉️" };

export interface IncidentStep { id: string; text: string; source: RecoveryKind | "generic" }
export interface IncidentPlan { headline: string; state: ApolloState; timeline: PatrolEvent[]; kinds: RecoveryKind[]; steps: IncidentStep[]; exposure: string[]; allResolved: boolean }

/** Urgency order for merging recovery kinds into one plan. */
const KIND_ORDER: RecoveryKind[] = ["remote", "code", "mfa_approved", "password", "card", "money", "banking_during_access", "locked_out", "accessibility", "profile", "app", "download", "clicked", "called", "info"];
/** Labels written into event.why by recordRecovery ("You told Apollo: …") — parsed back into kinds. */
const TOLD_LABEL: Record<RecoveryKind, string> = { clicked: "opened the link", password: "entered a password", code: "shared a verification code", money: "sent money", info: "shared personal information", app: "installed an app", card: "entered card or bank details", download: "downloaded a file", called: "called the number shown", remote: "gave someone remote access", accessibility: "granted accessibility access", profile: "installed a profile or certificate", banking_during_access: "used banking while they had access", mfa_approved: "approved a login prompt", locked_out: "lost access to the account" };
const KIND_LABEL: Record<RecoveryKind, string> = { remote: "someone had remote access", code: "a verification code was shared", mfa_approved: "a login prompt was approved", password: "a password was entered", card: "card or bank details were entered", money: "money was sent", banking_during_access: "banking was used during the access", locked_out: "an account is locked", accessibility: "accessibility access was granted", profile: "a profile or certificate was installed", app: "an app was installed", download: "a file was downloaded", clicked: "a link was opened", called: "the number was called", info: "personal information was shared" };

/** Infer which recoveries matter from the events themselves (explicit recoveries + scenario hints). */
export function inferRecoveryKinds(events: PatrolEvent[]): RecoveryKind[] {
  const kinds = new Set<RecoveryKind>();
  for (const e of events) {
    for (const w of e.why) { const m = w.match(/^You told Apollo: (.+)\.$/); if (m) for (const k of Object.keys(TOLD_LABEL) as RecoveryKind[]) if (TOLD_LABEL[k] === m[1]) kinds.add(k); }
    const sc = e.scenario ?? "";
    if (/^AC12/.test(sc)) kinds.add("code");
    if (/^AC11/.test(sc)) kinds.add("password");
    if (/^AC0[12]|^AC17/.test(sc)) kinds.add("mfa_approved");
    if (/^AC1[48]/.test(sc)) kinds.add("locked_out");
    if (/^A01/.test(sc) && e.state === "barking") kinds.add("remote");
    if (/^D01/.test(sc)) kinds.add("remote");
    if (/^D0[23]/.test(sc)) kinds.add("profile");
  }
  return KIND_ORDER.filter((k) => kinds.has(k));
}

export function buildIncidentPlan(events: PatrolEvent[]): IncidentPlan {
  const timeline = [...events].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  const state = timeline.reduce<ApolloState>((acc, e) => (STATE_RANK_ORDER.indexOf(e.state) > STATE_RANK_ORDER.indexOf(acc) ? e.state : acc), "resting");
  const kinds = inferRecoveryKinds(timeline);
  const seen = new Set<string>();
  const steps: IncidentStep[] = [];
  const push = (text: string, source: IncidentStep["source"]) => { const key = text.toLowerCase().replace(/[^a-z]/g, "").slice(0, 60); if (seen.has(key)) return; seen.add(key); steps.push({ id: `${source}-${steps.length}`, text, source }); };
  for (const k of kinds) for (const st of RECOVERY_STEPS[k]) push(st, k);
  if (!kinds.length) {
    const brand = timeline.find((e) => e.claimed_brand)?.claimed_brand;
    push("Don't act on any of these messages, calls or prompts. Nothing has been lost yet if you haven't typed, paid or approved anything.", "generic");
    push(`Contact ${brand ?? "the organisation"} yourself — official app, or the number on your card or their real website — and ask whether any of this was them.`, "generic");
    push("Deny any login or approval prompt you didn't start, and don't share codes with anyone.", "generic");
    push("Block the sender / number and delete the message. Report it via Scamwatch (scamwatch.gov.au).", "generic");
  } else {
    push("When you've done the above: block the sender or number, delete the messages, and report it via Scamwatch (scamwatch.gov.au) or ReportCyber (cyber.gov.au).", "generic");
  }
  const brand = timeline.find((e) => e.claimed_brand)?.claimed_brand;
  const cats = Array.from(new Set(timeline.map((e) => CATEGORY_LABEL[e.category].toLowerCase())));
  const headline = `${brand ? `${brand} impersonation` : "Connected scam attempt"} — ${cats.slice(0, 3).join(" → ")}${cats.length > 3 ? " → …" : ""}`;
  return { headline, state, timeline, kinds, steps, exposure: kinds.map((k) => KIND_LABEL[k]), allResolved: timeline.every((e) => e.status !== "active") };
}
