// Weekly Patrol digest — computed on-device from local Patrol events.

import type { PatrolEvent } from "./types";

export interface WeeklyDigest {
  from: string; to: string;
  checked: number; blocked: number; warned: number; letThrough: number; connection: number; trusted: number;
  topHosts: { host: string; count: number }[];
  quietDays: number;
  headline: string; summary: string;
}

export function buildWeeklyDigest(events: PatrolEvent[], now = Date.now()): WeeklyDigest {
  const from = now - 7 * 24 * 3600 * 1000;
  const week = events.filter((e) => Date.parse(e.occurred_at) >= from && e.category !== "protection" && e.category !== "system");
  const checked = week.filter((e) => e.category === "link" || e.category === "known_threat" || e.category === "website").length;
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
  const headline = week.length === 0 ? "A quiet week" : blocked > 0 ? `Apollo blocked ${blocked} threat${blocked > 1 ? "s" : ""}` : warned > 0 ? `Apollo warned you ${warned} time${warned > 1 ? "s" : ""}` : `${checked} link${checked > 1 ? "s" : ""} checked, all clear`;
  const summary = week.length === 0
    ? "No links checked and nothing to warn about. Apollo was resting within the checks it could see."
    : `You checked ${checked} link${checked === 1 ? "" : "s"}. ${letThrough} looked fine, ${warned} needed care${blocked ? `, and ${blocked} ${blocked === 1 ? "was" : "were"} blocked after verification` : ""}.${connection ? ` ${connection} Wi‑Fi warning${connection === 1 ? "" : "s"}.` : ""} ${quietDays} quiet day${quietDays === 1 ? "" : "s"}.`;
  return { from: new Date(from).toISOString(), to: new Date(now).toISOString(), checked, blocked, warned, letThrough, connection, trusted, topHosts, quietDays, headline, summary };
}
