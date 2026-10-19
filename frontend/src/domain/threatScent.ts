// Threat Scent — connects related events (message → link → login → call) inside a time window so
// risk escalates on the attack *sequence*, not just single events. Pure function over Patrol events.

import type { ApolloState, PatrolEvent } from "./types";
import { STATE_RANK } from "./stateMachine.ts";

export const SCENT_WINDOW_MS = 30 * 60 * 1000;

export interface ThreatScent {
  scent_id: string;
  events: PatrolEvent[];
  /** Highest observed state; checking another Gate never independently increases severity. */
  state: ApolloState;
  brand: string | null;
  host: string | null;
  summary: string;
}

function keysFor(e: PatrolEvent): string[] {
  const keys: string[] = [];
  if (e.claimed_brand) keys.push(`brand:${e.claimed_brand.toLowerCase().replace(/[^a-z0-9]/g, "")}`);
  if (e.indicator_host) {
    const host = e.indicator_host.toLowerCase().replace(/^www\./, "");
    keys.push(`host:${host}`);
  }
  return keys;
}
const GENERIC_BRANDS = new Set(['yourbank', 'adeliverycompany', 'atolloperator', 'agovernmentagency', 'yourtelco', 'atechcompany']);
function normKeys(e: PatrolEvent): string[] {
  return keysFor(e).filter(k => !k.startsWith('brand:') || !GENERIC_BRANDS.has(k.slice(6)));
}

/** Find an existing scent id that a new event should join (shared brand/host, or explicit scent, within the window). */
export function findScentFor(event: PatrolEvent, events: PatrolEvent[], now = Date.now()): string | null {
  const keys = new Set(normKeys(event));
  const t = Date.parse(event.occurred_at) || now;
  for (const e of events) {
    if (e.event_id === event.event_id || e.state === "resting") continue;
    if (Math.abs(t - Date.parse(e.occurred_at)) > SCENT_WINDOW_MS) continue;
    if (event.scent_id && e.scent_id === event.scent_id) return e.scent_id;
    // Similar brands/hosts are leads, not proof that two checks share an incident.
    // Only an explicit transferred incident reference joins cases.
    if (event.scent_id === e.event_id && keys.size) return e.scent_id ?? e.event_id;
  }
  return null;
}

export function buildScents(events: PatrolEvent[], now = Date.now()): ThreatScent[] {
  const groups = new Map<string, PatrolEvent[]>();
  for (const e of events) {
    if (!e.scent_id) continue;
    groups.set(e.scent_id, [...(groups.get(e.scent_id) ?? []), e]);
  }
  const out: ThreatScent[] = [];
  for (const [scent_id, list] of groups) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
    const state = sorted.reduce<ApolloState>((acc, e) => (STATE_RANK[e.state] > STATE_RANK[acc] ? e.state : acc), "resting");
    const brand = sorted.find((e) => e.claimed_brand)?.claimed_brand ?? null;
    const host = sorted.find((e) => e.indicator_host)?.indicator_host ?? null;
    const recent = now - Date.parse(sorted[sorted.length - 1].occurred_at) <= 24 * 60 * 60 * 1000;
    const parts = sorted.map((e) => ({ message: "a suspicious message", link: "a link check", website: "a website visit", known_threat: "a known threat", connection: "a network warning", protection: "a protection change", system: "a system event", call: "a phone call", app: "an app install", device: "a device change", account: "an account alert", email: "a suspicious email", file: "a file check", family: "a family update" }[e.category]));
    out.push({ scent_id, events: sorted, state, brand, host,
      summary: `${recent ? "These events may be connected." : "Earlier connected events."} ${brand ? `A ${brand} message` : parts[0].replace(/^a /, "A ")} was followed by ${parts.slice(1).join(", then ")}.` });
  }
  return out.sort((a, b) => Date.parse(b.events[b.events.length - 1].occurred_at) - Date.parse(a.events[a.events.length - 1].occurred_at));
}
