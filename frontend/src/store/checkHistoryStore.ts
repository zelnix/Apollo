// Local, on-device history for MANUAL checks (Check tab). Each completed manual check records a
// plain-English, code-free line so the result screen can show "what you've checked before". No raw
// indicators are stored — only the gate, a short summary and the outcome state.
import type { ApolloState } from "@/src/domain/types";
import { storage } from "@/src/utils/storage";

export type CheckGate = "call" | "text" | "message" | "app" | "network" | "device" | "account" | "email" | "link";

export interface CheckHistoryEntry { at: string; state: ApolloState; summary: string }

const KEY = (gate: CheckGate) => `apollo.checkhistory.${gate}.v1`;
const CAP = 10;

export async function getCheckHistory(gate: CheckGate): Promise<CheckHistoryEntry[]> {
  const raw = await storage.getItem<string | null>(KEY(gate), null);
  return raw ? (JSON.parse(raw) as CheckHistoryEntry[]) : [];
}

/** Record a completed manual check. Summary must already be plain English (no internal codes). */
export async function recordCheck(gate: CheckGate, entry: CheckHistoryEntry): Promise<void> {
  const prior = await getCheckHistory(gate);
  const merged = [entry, ...prior].slice(0, CAP);
  await storage.setItem(KEY(gate), JSON.stringify(merged));
}
