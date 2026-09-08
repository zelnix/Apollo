// Higgins' check suggestions. The model ends a reply with a machine-readable line `CHECKS: link, message` (see
// backend/routers/ask.py). We strip that line from what the person reads and turn it into tappable links to the
// actual checks, then track which of them were completed after Higgins asked.

import type { EventCategory } from "./types.ts";

export type CheckId = "link" | "message" | "app" | "device" | "account" | "network";

/** `where` is the path a person takes with their thumb — Higgins says it, the chip shows it, and the chip also jumps there. */
export const CHECKS: Record<CheckId, { label: string; route: string; where: string }> = {
  link: { label: "Check a link", route: "/check", where: "Home → Check a link" },
  message: { label: "Check a message", route: "/message", where: "Home → Check a message" },
  app: { label: "Check an app", route: "/app-check", where: "Home → Check an app" },
  device: { label: "Check my device", route: "/device", where: "Home → Check my device" },
  account: { label: "Account Guard", route: "/account", where: "Home → Account Guard (or Guard tab → Open Account Guard)" },
  network: { label: "Network Guard", route: "/network", where: "Home → Network Guard (or Guard tab → Open Network Guard)" },
};

const IDS = Object.keys(CHECKS) as CheckId[];
const LINE = /^\s*CHECKS?\s*:\s*(.*)$/im;

/** Splits Higgins' reply into the text to show and the checks he asked for (deduped, in order, unknown ids dropped). */
export function parseChecks(content: string): { text: string; checks: CheckId[] } {
  const m = content.match(LINE);
  if (!m) return { text: content, checks: [] };
  const checks = Array.from(new Set(m[1].toLowerCase().split(/[,\s]+/).map((x) => x.replace(/[^a-z]/g, "")).filter((x): x is CheckId => IDS.includes(x as CheckId))));
  const text = content.replace(LINE, "").replace(/\n{3,}/g, "\n\n").trim();
  return { text, checks };
}

/** A check counts as done for a suggestion when it was completed AFTER Higgins asked. */
export function isDone(completedAt: string | undefined, askedAt: string): boolean {
  return !!completedAt && new Date(completedAt).getTime() >= new Date(askedAt).getTime();
}

export function progressLine(done: number, total: number): string {
  if (!total) return "";
  if (done === total) return total === 1 ? "Done — thank you." : `All ${total} done — thank you.`;
  return `${done} of ${total} done`;
}

// --- "Run a check" → which checks, exactly ---------------------------------------------------------------------------
// MOCK (standard list per situation) until native enforcement can report which protections actually failed
// verification. When that lands, derive this from the enforcement result instead of the table below.
export const RECOMMENDED_CHECKS_ARE_MOCK = true;
export const RECOMMENDED_CHECKS_NOTE = "Standard list for now — once Apollo can verify enforcement on this phone, he will name only the checks that actually need running.";

const BY_CATEGORY: Partial<Record<EventCategory, CheckId[]>> = {
  account: ["account", "device"], email: ["account", "message"], message: ["message", "account"], call: ["account", "device"],
  app: ["app", "device"], device: ["device", "account"], connection: ["network", "device"], link: ["link", "account"], website: ["link", "account"],
};
const STALE_VERIFICATION: CheckId[] = ["device", "network", "account"];

/** The checks Higgins means when Apollo is growling for want of a fresh check. Empty when no check is being asked for. */
export function recommendedChecks(r: { recovering: boolean; visibilityLost: boolean; drivingEvent: { category: EventCategory } | null }): CheckId[] {
  if (r.visibilityLost || !r.recovering) return [];
  if (r.drivingEvent) return BY_CATEGORY[r.drivingEvent.category] ?? ["device", "account"];
  return STALE_VERIFICATION;
}

const ORDINAL = ["first", "second", "third", "fourth", "fifth", "sixth"];

/** Spoken form for Higgins: names each check and where to find it, in order. */
export function checksSpoken(checks: CheckId[]): string {
  if (!checks.length) return "";
  const parts = checks.map((c, i) => `${checks.length > 1 ? `${ORDINAL[i] ?? `number ${i + 1}`}, ` : ""}${CHECKS[c].label} — under ${CHECKS[c].where.replace(/ \(.*\)$/, "")}`);
  return `${checks.length === 1 ? "The check to run is" : `The ${checks.length} checks to run, most important first:`} ${parts.join(". ")}.`;
}
// --- Follow-up: a day later, Higgins gently notices what is still waiting ------------------------------------------
export interface Suggestion { messageId: string; askedAt: string; checks: CheckId[]; snoozedUntil?: string }
export const FOLLOW_UP_AFTER_MS = 24 * 60 * 60 * 1000;
export const SNOOZE_MS = 24 * 60 * 60 * 1000;

/** Suggestions old enough to follow up on, not snoozed, with at least one check still not done since Higgins asked.
 *  Newest first; the same check is only surfaced once (from its most recent suggestion). */
export function pendingFollowUps(suggestions: Suggestion[], completed: Partial<Record<CheckId, string>>, now: Date = new Date()): { suggestion: Suggestion; outstanding: CheckId[] }[] {
  const seen = new Set<CheckId>();
  return [...suggestions]
    .sort((a, b) => new Date(b.askedAt).getTime() - new Date(a.askedAt).getTime())
    .filter((s) => now.getTime() - new Date(s.askedAt).getTime() >= FOLLOW_UP_AFTER_MS)
    .filter((s) => !s.snoozedUntil || new Date(s.snoozedUntil).getTime() <= now.getTime())
    .map((s) => ({ suggestion: s, outstanding: s.checks.filter((c) => !isDone(completed[c], s.askedAt) && !seen.has(c) && (seen.add(c), true)) }))
    .filter((x) => x.outstanding.length > 0);
}

export function followUpLine(outstanding: CheckId[], askedAt: string, now: Date = new Date()): string {
  const days = Math.max(1, Math.floor((now.getTime() - new Date(askedAt).getTime()) / FOLLOW_UP_AFTER_MS));
  const when = days === 1 ? "Yesterday" : `${days} days ago`;
  const names = outstanding.map((c) => CHECKS[c].label);
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${when} I suggested ${list}. No rush at all — ${names.length === 1 ? "it's" : "they're"} still waiting whenever you have a quiet moment.`;
}
