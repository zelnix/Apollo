import { apiGet } from "@/src/api/client";

export interface HigginsHistoryItem { id: string; kind: "ordinary_chat" | "investigation" | "saved_report"; title: string; summary: string; status: "active" | "handled"; occurredAt: string; caseId: string | null; reportId: string | null }
export interface GovernmentFeedState { status: "fresh" | "stale" | "unavailable"; source: string; sourceUrl: string; lastSuccessAt: string | null }
export interface GovernmentAlert { title: string; url: string; summary: string; source: string; sourceUrl: string; publishedAt: string | null }

export function higginsHubHistory(limit = 50) { return apiGet<{ items: HigginsHistoryItem[]; redaction: string }>(`/higgins/history?limit=${limit}`); }
export function governmentScams(limit = 50) { return apiGet<{ coverage: string; generatedAt: string; feeds: Record<string, GovernmentFeedState>; items: GovernmentAlert[] }>(`/higgins/scams?limit=${limit}`); }