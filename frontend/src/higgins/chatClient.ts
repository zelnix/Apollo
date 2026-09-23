import { apiDelete, apiGet, apiPost } from "@/src/api/client";

export interface HigginsChatAction { kind: "app_destination"; destination: "check_it" | "higgins_case"; label: string; purpose: string }
export interface HigginsContextUse { source: string; status: string; provenance: string[]; observedAt: string | null }
export interface HigginsChatReply { turnId: string; conversationId: string; answer: string; evidenceBasis: string[]; uncertainty: string[]; clarification: string | null; contextUsed: HigginsContextUse[]; suggestedActions: HigginsChatAction[]; investigationAvailable: boolean; investigativeWorkStarted: false; retention: { serverContentExpiresAt: string; localContentMaxSeconds: 3600; receiptOnlyAfterExpiry: true } }
export interface HigginsChatMessage { id: string; turnId: string; role: "user" | "higgins"; content: string; createdAt: string; conversationId: string }

export function askHiggins(message: string, conversationId: string, turnId: string, previousTurnIds: string[]) {
  return apiPost<HigginsChatReply>("/higgins/chat", "higgins_chat", { turnId, message, conversationId, previousTurnIds });
}
export function higginsHistory(deviceId: string) {
  return apiGet<{ items: HigginsChatMessage[]; receipts: unknown[]; kind: "ordinary_chat" }>(`/higgins/chat/history?device_id=${encodeURIComponent(deviceId)}`);
}
export function clearHigginsHistory(deviceId: string) {
  return apiDelete<{ deleted: number; investigationsDeleted: 0 }>(`/ask/history?device_id=${encodeURIComponent(deviceId)}`);
}
export function rememberHigginsContext(value: { category: "recent_outcome" | "protection_state" | "preference" | "goal" | "permission"; summary: string; provenance: "device_observation" | "apollo_outcome" | "user_report" | "user_preference"; observedAt?: string }) {
  return apiPost<{ item: unknown }>("/higgins/context", "higgins_context", value);
}