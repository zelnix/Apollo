// Protection Timeline — a short "what Apollo has done today" list for the Protection Details screen.
// Merges three real on-device sources (no new infra, no new scanning):
//   1. Patrol events (every category) that occurred or resolved today — "Apollo flagged X / resolved X".
//   2. Gate Health Log entries from today — "Apollo confirmed [Gate] is Watching".
// Honest about quiet days: if nothing happened, the UI surfaces a reassurance line instead of empty.
// Pure, unit-testable.

import type { PatrolEvent } from "./types";
import type { GateHealthLog } from "@/src/store/gateHealthLog";

export type TimelineKind = "flagged" | "resolved" | "blocked" | "confirmed_watching" | "investigating";
export type TimelineTone = "resting" | "ears_up" | "growling" | "barking" | "biting" | "neutral";

export interface TimelineEntry {
  id: string;
  kind: TimelineKind;
  tone: TimelineTone;
  /** Short title, e.g. "Website protection — Watching confirmed" or "Scam text flagged". */
  title: string;
  /** One-line plain-English summary. */
  summary: string;
  /** ISO timestamp used for ordering + the time label. */
  at: string;
  /** Short "9:42 am" label for display. */
  timeLabel: string;
  /** Route to open on tap, when applicable (e.g. an investigation). */
  route?: string;
}

const GATE_FOR_CATEGORY: Record<string, string> = {
  link: "Link checking", website: "Website protection", known_threat: "Website protection", protection: "Website protection",
  connection: "Internet monitoring", system: "Device monitoring", device: "Device monitoring", message: "Message screening",
  call: "Call screening", app: "App checking", account: "Account alerts", email: "Email monitoring", file: "File checking",
  family: "Family alert",
};

const GATE_LABEL_BY_ID: Record<string, string> = {
  site: "Website protection", link: "Link checking", text: "Message screening", call: "Call screening", network: "Internet monitoring",
  account: "Account alerts", email: "Email monitoring", file: "File checking", app: "App checking", device: "Device monitoring",
};

/** Build a short, specific description of the event instead of the generic gate name.
 *  e.g. "Suspicious email from Kogan.com" or "Scam call from +1 (555) 010-1234". */
function describeEvent(e: PatrolEvent, gateFallback: string): string {
  const cat = e.category;
  const indicator = e.indicator_host || "";
  const brand = e.claimed_brand || "";
  const sender = brand || indicator;

  if (cat === "email" && sender) {
    return `Email from ${sender}`;
  }
  if (cat === "call" && indicator) {
    return `Call from ${indicator}`;
  }
  if ((cat === "message" || cat === ("text" as string)) && sender) {
    return `Text from ${sender}`;
  }
  if ((cat === "link" || cat === "website" || cat === "known_threat") && indicator) {
    return `Site: ${truncate(indicator, 40)}`;
  }
  // Fall back to headline if it's short enough, otherwise use gate name.
  const hl = (e.headline || "").trim();
  if (hl && hl.length <= 50) return hl;
  return gateFallback;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

function toneForEventState(state: PatrolEvent["state"]): TimelineTone {
  if (state === "biting") return "biting";
  if (state === "barking") return "barking";
  if (state === "growling") return "growling";
  if (state === "ears_up") return "ears_up";
  if (state === "resting") return "resting";
  return "neutral";
}

function fmtTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  const sameDay = isSameLocalDay(t, now);
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

/** Local-day equality (so "today" uses the person's local timezone, not UTC). */
function isSameLocalDay(a: number, b: number): boolean {
  const da = new Date(a); const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

/** Build the "what Apollo has done today" timeline. Newest first. Caps at `limit` entries. */
export function buildTodayTimeline(input: {
  events: PatrolEvent[];
  gateHealthLog: GateHealthLog;
  now?: number;
  limit?: number;
}): TimelineEntry[] {
  const now = input.now ?? Date.now();
  const limit = input.limit ?? 12;
  const out: TimelineEntry[] = [];

  // 1) Patrol events — flagged / blocked / resolved / investigating.
  for (const e of input.events) {
    const occurredAt = Date.parse(e.occurred_at);
    const resolvedAt = e.resolved_at ? Date.parse(e.resolved_at) : null;
    const gate = GATE_FOR_CATEGORY[e.category] ?? "Apollo";

    // Flagged / blocked / investigating entry (uses occurred_at).
    if (Number.isFinite(occurredAt) && isSameLocalDay(occurredAt, now)) {
      let kind: TimelineKind = "flagged";
      let tone = toneForEventState(e.state);
      let summary = (e.headline || e.what_happened || "Apollo noticed something.").trim();

      // Build a descriptive title from the event instead of the generic gate name.
      // e.g. "Suspicious email from Kogan.com" instead of "Email Gate — flagged".
      const shortSubject = describeEvent(e, gate);

      // If the event has since been resolved, update the SAME entry instead of creating a new row.
      const isResolved = e.status === "resolved" || e.status === "trusted" || (resolvedAt != null);
      let title: string;
      if (isResolved) {
        kind = "resolved";
        tone = "resting";
        title = `${shortSubject} — resolved`;
        const resolvedTime = resolvedAt ? fmtTime(e.resolved_at as string, now) : "";
        summary = resolvedTime
          ? `Resolved at ${resolvedTime}. ${summary}`
          : `Resolved. ${summary}`;
      } else if (e.state === "biting" && e.verified_block) {
        kind = "blocked"; title = `${shortSubject} — blocked`;
      } else if (e.state === "sniffing") {
        kind = "investigating"; title = `${shortSubject} — investigating`;
      } else if (e.state === "ears_up") {
        title = `${shortSubject} — sniffing`;
      } else if (e.state === "growling") {
        title = `${shortSubject} — flagged a concern`;
      } else if (e.state === "barking") {
        title = `${shortSubject} — needs your decision`;
      } else {
        title = shortSubject;
      }

      out.push({
        id: `event:${e.event_id}:flagged`,
        kind,
        tone,
        title,
        summary,
        at: e.occurred_at,
        timeLabel: fmtTime(e.occurred_at, now),
        route: `/patrol/${encodeURIComponent(e.event_id)}`,
      });
    }
  }

  // 2) Gate Health Log — "Watching" confirmations today.
  for (const [gateId, entries] of Object.entries(input.gateHealthLog)) {
    const label = GATE_LABEL_BY_ID[gateId] ?? gateId;
    for (const iso of entries) {
      const t = Date.parse(iso);
      if (!Number.isFinite(t) || !isSameLocalDay(t, now)) continue;
      out.push({
        id: `watch:${gateId}:${iso}`,
        kind: "confirmed_watching",
        tone: "resting",
        title: `${label} — Watching confirmed`,
        summary: `Apollo confirmed ${label} is actively protecting.`,
        at: iso,
        timeLabel: fmtTime(iso, now),
      });
    }
  }

  // Newest first, capped.
  out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  return out.slice(0, limit);
}

/** A short "all's been quiet" reassurance line when the timeline is empty today. */
export function quietDayLine(): string {
  return "Nothing to report today — Apollo has been on patrol with no concerns raised.";
}
