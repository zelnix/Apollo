import { apiDelete, apiGet, apiPost } from "@/src/api/client";

export interface HigginsChatAction { kind: "app_destination"; destination: "check_it" | "higgins_case"; label: string; purpose: string }
export interface HigginsChatReply { answer: string; intent: "answer" | "clarify" | "investigation_recommended"; clarification: string | null; action: HigginsChatAction | null; conversationId: string; contextCategories: string[]; investigativeWorkStarted: false }
export interface HigginsChatMessage { id: string; role: "user" | "higgins"; content: string; createdAt: string; conversationId: string }

export function askHiggins(message: string, conversationId: string) {
  return apiPost<HigginsChatReply>("/higgins/chat", "higgins_chat", { message, conversationId });
}
export function higginsHistory(deviceId: string) {
  return apiGet<{ items: HigginsChatMessage[]; kind: "ordinary_chat" }>(`/ask/history?device_id=${encodeURIComponent(deviceId)}`);
}
export function clearHigginsHistory(deviceId: string) {
  return apiDelete<{ deleted: number; investigationsDeleted: 0 }>(`/ask/history?device_id=${encodeURIComponent(deviceId)}`);
}
export function rememberHigginsContext(value: { category: "recent_outcome" | "protection_state" | "preference" | "goal" | "permission"; summary: string; provenance: "device_observation" | "apollo_outcome" | "user_report" | "user_preference"; observedAt?: string }) {
  return apiPost<{ item: unknown }>("/higgins/context", "higgins_context", value);
}