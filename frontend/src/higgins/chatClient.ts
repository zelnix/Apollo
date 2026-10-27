import { apiDelete, apiGet, apiPost } from "@/src/api/client";
import type { NavLink } from "./appMap";
import type { DeviceSnapshot } from "./deviceSnapshot";

export interface HigginsChatAction { kind: "app_destination"; destination: "check_it" | "higgins_case"; label: string; purpose: string }
export interface HigginsContextUse { source: string; status: string; provenance: string[]; observedAt: string | null }
/** `reused`: an earlier answer Apollo reused instead of asking its provider again, and when it was last checked. */
export interface HigginsReused { provider: string; aiGenerated: boolean; lastCheckedAt: string; expiresAt: string }
export interface HigginsChatReply { turnId: string; conversationId: string; answer: string; evidenceBasis: string[]; uncertainty: string[]; clarification: string | null; contextUsed: HigginsContextUse[]; suggestedActions: HigginsChatAction[]; navigation: NavLink[]; investigationAvailable: boolean; investigativeWorkStarted: false; reused?: HigginsReused | null; simulated?: boolean; retention: { serverContentExpiresAt: string; localContentMaxSeconds: 3600; receiptOnlyAfterExpiry: true } }
/** `links` are validated Apollo destinations Higgins offered for this answer. `reusedAt`: the answer was reused, last checked then.
 *  `simulated`: the preview's stand-in for the AI tool wrote it — processed exactly as a live answer, only tagged. */
export interface HigginsChatMessage { id: string; turnId: string; role: "user" | "higgins"; content: string; createdAt: string; conversationId: string; links?: NavLink[]; reusedAt?: string; simulated?: boolean }

export function askHiggins(message: string, conversationId: string, turnId: string, previousTurnIds: string[], deviceSnapshot?: DeviceSnapshot) {
  return apiPost<HigginsChatReply>("/higgins/chat", "higgins_chat", { turnId, message, conversationId, previousTurnIds, ...(deviceSnapshot ? { deviceSnapshot } : {}) });
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
