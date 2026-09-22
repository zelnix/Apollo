// Higgins' check suggestions. The model ends a reply with a machine-readable line `CHECKS: link, message` (see
// backend/routers/ask.py). We strip that line from what the person reads and turn it into tappable links to the
// actual checks, then track which of them were completed after Higgins asked.

import type { Capability, EventCategory } from "./types.ts";

export type CheckId = "link" | "message" | "file" | "app" | "device" | "account" | "network";

export const CHECKS: Record<CheckId, { label: string; actionLabel: string; purpose: string; route: string }> = {
  link: { label: "Check a link", actionLabel: "Check a link", purpose: "See where the link leads before opening it.", route: "/check" },
  message: { label: "Check a message", actionLabel: "Check a message", purpose: "Paste, share or add a screenshot of the message.", route: "/message" },
  file: { label: "File Gate", actionLabel: "Open File Gate", purpose: "Choose or share the file you want Apollo to examine.", route: "/file" },
  app: { label: "Check an app", actionLabel: "Check an app", purpose: "Review the app's source, access and available device facts.", route: "/app-check" },
  device: { label: "Device Gate", actionLabel: "Open Device Gate", purpose: "Check important protection, permission and device changes.", route: "/device" },
  account: { label: "Account Gate", actionLabel: "Open Account Gate", purpose: "Review the account warning without sharing a password or code.", route: "/account" },
  network: { label: "Network Gate", actionLabel: "Open Network Gate", purpose: "Review the connection facts this device can see.", route: "/network" },
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
// Standard list per situation until native enforcement can report which protections actually failed verification.
// When that lands, derive this from the enforcement result instead of the table below. No disclaimer is shown for
// this — the only thing Higgins calls out by name is a real permission gap (see higginsPermissionNote below).

const BY_CATEGORY: Partial<Record<EventCategory, CheckId[]>> = {
  account: ["account", "device"], email: ["account", "message"], message: ["message", "account"], call: ["account", "device"],
  app: ["app", "device"], device: ["device", "account"], connection: ["network", "device"], link: ["link", "account"], website: ["link", "account"], known_threat: ["file", "device", "account"],
};
const STALE_VERIFICATION: CheckId[] = ["device", "network", "account"];

/** The checks Higgins means when Apollo is growling for want of a fresh check. Empty when no check is being asked for. */
export function recommendedChecks(r: { recovering: boolean; visibilityLost: boolean; drivingEvent: { category: EventCategory } | null }): CheckId[] {
  if (r.visibilityLost) return ["device"];
  if (!r.recovering) return [];
  if (r.drivingEvent) return BY_CATEGORY[r.drivingEvent.category] ?? ["device", "account"];
  return STALE_VERIFICATION;
}

const ORDINAL = ["first", "second", "third", "fourth", "fifth", "sixth"];

/** Spoken form for Higgins: Apollo opens each named check directly. */
export function checksSpoken(checks: CheckId[]): string {
  if (!checks.length) return "";
  const parts = checks.map((c, i) => `${checks.length > 1 ? `${ORDINAL[i] ?? `number ${i + 1}`}, ` : ""}${CHECKS[c].actionLabel}`);
  return `${checks.length === 1 ? "The check I need you to run is" : `The ${checks.length} checks I need you to run, most important first:`} ${parts.join(". ")}.`;
}

/** Higgins, in the first person, naming any real permission gap — never a generic "this list is mock" disclaimer.
 *  Returns null when every capability Apollo needs is already granted. */
export function higginsPermissionNote(capabilities: Capability[]): string | null {
  const gaps = capabilities.filter((c) => c.status === "permission_required");
  if (!gaps.length) return null;
  const first = gaps[0].title.replace(/ Guard$/i, " Gate");
  return `Apollo needs your permission for ${first}. Open that Gate and choose its setup action. Apollo will check the result when you return.${gaps.length > 1 ? " Other items will remain listed in Gates." : ""}`;
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
