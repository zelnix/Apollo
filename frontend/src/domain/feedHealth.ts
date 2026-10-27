// Feed Health: plain-language presentation of /api/feeds/health. The server owns the 24-hour status rule;
// this module only turns its answer into labels, tones and relative times. Pure — no React Native imports.
import type { Tone } from "@/src/components/ui";

export type FeedStatus = "healthy" | "stale" | "failing";
export interface FeedHealthError { message: string; code: string | null; detail: string | null; at: string | null }
export interface FeedHealthRow {
  feedId: string; source: string; feedUrl: string; contentType: string; status: FeedStatus;
  lastSuccessAt: string | null; lastCheckedAt: string | null; recordCount: number | null; lastError: FeedHealthError | null;
  relay?: string | null; relayCopyAt?: string | null;
}
export interface FeedHealthReport {
  generatedAt: string; staleAfterHours: number;
  summary: Record<FeedStatus, number> & { total: number }; feeds: FeedHealthRow[];
}

export const FEED_STATUS_LABEL: Record<FeedStatus, string> = { healthy: "Healthy", stale: "Stale", failing: "Failing" };
const FEED_STATUS_TONE: Record<FeedStatus, Tone> = { healthy: "resting", stale: "growling", failing: "barking" };
export function feedStatusTone(status: FeedStatus): Tone { return FEED_STATUS_TONE[status]; }

const CONTENT_TYPE_LABEL: Record<string, string> = {
  live_alert: "Live alerts", official_advice: "Official advice", threat_listing: "Threat list", threat_knowledge: "Threat knowledge",
};
export function contentTypeLabel(type: string): string { return CONTENT_TYPE_LABEL[type] ?? "Government feed"; }

/** "just now", "5 minutes ago", "3 hours ago", "2 days ago"; `never` when there is no time. */
export function relativeAge(iso: string | null, now: number = Date.now(), never = "Never"): string {
  if (!iso) return never;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return never;
  const minutes = Math.max(0, Math.floor((now - ms) / 60000));
  if (minutes < 1) return "just now";
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (minutes < 60) return plural(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, "hour");
  return plural(Math.floor(hours / 24), "day");
}

export function recordCountLabel(count: number | null): string {
  if (count === null || count === undefined) return "No records loaded yet";
  return `${count} record${count === 1 ? "" : "s"} in the last sync`;
}

/** For feeds read through a relay because the source blocks cloud servers; null for direct feeds. */
export function relayLabel(feed: Pick<FeedHealthRow, "relay" | "relayCopyAt">, now: number = Date.now()): string | null {
  if (feed.relay !== "internet_archive") return null;
  return feed.relayCopyAt
    ? `Read through the Internet Archive · copy made ${relativeAge(feed.relayCopyAt, now)}`
    : "Read through the Internet Archive";
}

export function summaryHeadline(report: Pick<FeedHealthReport, "summary">): string {
  const { total, healthy } = report.summary;
  if (total === 0) return "No government feeds are switched on";
  if (healthy === total) return total === 1 ? "The feed is healthy" : `All ${total} feeds are healthy`;
  const attention = total - healthy;
  return `${attention} of ${total} feed${total === 1 ? "" : "s"} need${attention === 1 ? "s" : ""} attention`;
}
