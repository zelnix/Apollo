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
  /** Short title, e.g. "Site Gate — Watching confirmed" or "Scam text flagged". */
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
  link: "Link Gate", website: "Site Gate", known_threat: "Site Gate", protection: "Site Gate",
  connection: "Internet Gate", system: "Device Gate", device: "Device Gate", message: "Text Gate",
  call: "Call Gate", app: "App Gate", account: "Account Gate", email: "Email Gate", file: "File Gate",
  family: "Family alert",
};

const GATE_LABEL_BY_ID: Record<string, string> = {
  site: "Site Gate", link: "Link Gate", text: "Text Gate", call: "Call Gate", network: "Internet Gate",
  account: "Account Gate", email: "Email Gate", file: "File Gate", app: "App Gate", device: "Device Gate",
};

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
      let title = `${gate} — flagged`;
      if (e.state === "biting" && e.verified_block) { kind = "blocked"; title = `${gate} — blocked a threat`; }
      else if (e.state === "sniffing") { kind = "investigating"; title = `${gate} — investigating`; }
      else if (e.state === "ears_up") { title = `${gate} — ears up`; }
      else if (e.state === "growling") { title = `${gate} — flagged a concern`; }
      else if (e.state === "barking") { title = `${gate} — needs your decision`; }
      out.push({
        id: `event:${e.event_id}:flagged`,
        kind,
        tone: toneForEventState(e.state),
        title,
        summary: (e.headline || e.what_happened || "Apollo noticed something.").trim(),
        at: e.occurred_at,
        timeLabel: fmtTime(e.occurred_at, now),
        route: `/patrol/${encodeURIComponent(e.event_id)}`,
      });
    }

    // Resolved entry (only if resolved today AND distinct from the flagged time).
    if (resolvedAt && isSameLocalDay(resolvedAt, now) && resolvedAt !== occurredAt) {
      out.push({
        id: `event:${e.event_id}:resolved`,
        kind: "resolved",
        tone: "resting",
        title: `${gate} — resolved`,
        summary: `The earlier alert from ${gate} has been resolved.`,
        at: e.resolved_at as string,
        timeLabel: fmtTime(e.resolved_at as string, now),
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
