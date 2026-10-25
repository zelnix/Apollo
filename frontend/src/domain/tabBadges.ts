// Counts shown on the bottom tabs. Pure: no React Native, so the rules are unit-tested in node.
import { caseGroupKey, threatCaseStatus } from "./threatCase.ts";
import type { PatrolEvent } from "./types";

/** Threats tab: threat cases that still need the person ("Needs you"). One per case — the case's latest event —
 *  the same way the Threats list groups them; it falls as each case is handled. */
export function countNeedingYou(events: PatrolEvent[]): number {
  const latest = new Map<string, PatrolEvent>();
  for (const event of events) {
    const key = caseGroupKey(event);
    const held = latest.get(key);
    if (!held || Date.parse(event.occurred_at) > Date.parse(held.occurred_at)) latest.set(key, event);
  }
  let count = 0;
  for (const event of latest.values()) if (threatCaseStatus(event) === "attention") count += 1;
  return count;
}

export interface BadgeAlert { url: string; severity: string; appliesIn: string }
const SEVERE = new Set(["HIGH", "EXTREME"]);

/** Scam Alerts tab: High and Extreme alerts for this country (or everywhere) the person hasn't seen yet. */
export function countNewSevereAlerts(alerts: BadgeAlert[], seen: ReadonlySet<string>, home: string): number {
  const counted = new Set<string>();
  for (const alert of alerts) {
    if (!SEVERE.has(alert.severity) || seen.has(alert.url)) continue;
    if (alert.appliesIn !== "everywhere" && alert.appliesIn !== home) continue;
    counted.add(alert.url);
  }
  return counted.size;
}

/** What the badge shows: nothing at zero, the number up to 9, then "9+". */
export function badgeText(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count > 9 ? "9+" : String(count);
}
