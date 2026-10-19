// Weekly Patrol digest — computed on-device from local Patrol events.

import type { ApolloState, PatrolEvent } from "./types";
import { buildIncidentPlan, CATEGORY_LABEL } from "./incidentPlan.ts";

export interface WeeklyDigest {
  from: string; to: string;
  checked: number; blocked: number; warned: number; letThrough: number; connection: number; trusted: number;
  topHosts: { host: string; count: number }[];
  quietDays: number;
  headline: string; summary: string;
  /** Connected incidents (Threat Scents with 2+ events) this week, open ones first. */
  incidents: DigestIncident[];
  openIncidents: number; handledIncidents: number; openSingles: number;
}
export interface DigestIncident { scent_id: string; headline: string; state: ApolloState; events: number; open: boolean; stopped: string[]; stillOpen: string[]; stepsTotal: number; occurred_at: string; brand: string | null }

export function buildDigestIncidents(week: PatrolEvent[]): DigestIncident[] {
  const groups = new Map<string, PatrolEvent[]>();
  for (const e of week) if (e.scent_id && e.state !== "resting") groups.set(e.scent_id, [...(groups.get(e.scent_id) ?? []), e]);
  return [...groups.entries()].filter(([, list]) => list.length >= 2).map(([scent_id, list]) => {
    const plan = buildIncidentPlan(list);
    const label = (e: PatrolEvent) => `${CATEGORY_LABEL[e.category]}: ${e.headline.replace(/^(Email|App|Device|Account|Network): /, "")}`;
    return { scent_id, headline: plan.headline, state: plan.state, events: list.length, open: !plan.allResolved, stopped: plan.timeline.filter((e) => e.status !== "active" || e.state === "biting").map(label), stillOpen: plan.timeline.filter((e) => e.status === "active" && e.state !== "biting").map(label), stepsTotal: plan.steps.length, occurred_at: plan.timeline[0].occurred_at, brand: plan.timeline.find((e) => e.claimed_brand)?.claimed_brand ?? null };
  }).sort((a, b) => Number(b.open) - Number(a.open) || Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
}

export function buildWeeklyDigest(events: PatrolEvent[], now = Date.now()): WeeklyDigest {
  const from = now - 7 * 24 * 3600 * 1000;
  const week = events.filter((e) => Date.parse(e.occurred_at) >= from && e.category !== "protection" && e.category !== "system");
  const checked = week.filter((e) => e.category === "link" || e.category === "known_threat" || e.category === "website" || e.category === "app" || e.category === "device" || e.category === "email").length;
  const blocked = week.filter((e) => e.state === "biting" && e.verified_block).length;
  const warned = week.filter((e) => e.state === "barking" || (e.state === "growling" && e.category !== "connection")).length;
  const letThrough = week.filter((e) => e.state === "resting" && (e.category === "link" || e.category === "website")).length;
  const connection = week.filter((e) => e.category === "connection").length;
  const trusted = week.filter((e) => e.status === "trusted").length;
  const hosts = new Map<string, number>();
  week.forEach((e) => { if (e.indicator_host && e.state !== "resting") hosts.set(e.indicator_host, (hosts.get(e.indicator_host) ?? 0) + 1); });
  const topHosts = [...hosts.entries()].map(([host, count]) => ({ host, count })).sort((a, b) => b.count - a.count).slice(0, 3);
  const days = new Set(week.map((e) => new Date(e.occurred_at).toDateString()));
  const quietDays = 7 - days.size;
  const incidents = buildDigestIncidents(week);
  const openIncidents = incidents.filter((i) => i.open).length;
  const handledIncidents = incidents.length - openIncidents;
  const inIncident = new Set(incidents.flatMap((i) => week.filter((e) => e.scent_id === i.scent_id).map((e) => e.event_id)));
  const openSingles = week.filter((e) => e.status === "active" && e.state !== "resting" && e.state !== "biting" && !inIncident.has(e.event_id)).length;
  const headline = week.length === 0 ? "A quiet week" : blocked > 0 ? `Apollo blocked ${blocked} threat${blocked > 1 ? "s" : ""}` : warned > 0 ? `Apollo warned you ${warned} time${warned > 1 ? "s" : ""}` : checked === 0 && connection > 0 ? `${connection} Wi‑Fi warning${connection > 1 ? "s" : ""}` : `${checked} link${checked > 1 ? "s" : ""} checked, all clear`;
  const summary = week.length === 0
    ? "No links checked and nothing to warn about. Apollo was patrolling quietly within the checks it could see."
    : `You checked ${checked} link${checked === 1 ? "" : "s"}. ${letThrough} looked fine, ${warned} needed care${blocked ? `, and ${blocked} ${blocked === 1 ? "was" : "were"} blocked after verification` : ""}.${connection ? ` ${connection} Wi‑Fi warning${connection === 1 ? "" : "s"}.` : ""} ${quietDays} quiet day${quietDays === 1 ? "" : "s"}.`;
  return { from: new Date(from).toISOString(), to: new Date(now).toISOString(), checked, blocked, warned, letThrough, connection, trusted, topHosts, quietDays, headline, summary, incidents, openIncidents, handledIncidents, openSingles };
}
