// Local, on-device history for MANUAL checks (Check tab). Each completed manual check records a
// plain-English, code-free line so the result screen can show "what you've checked before". No raw
// indicators are stored — only the gate, a short summary and the outcome state. A number check also
// keeps the number as a one-way code (`numberKey`), so the Same Number Reminder can match a repeat check
// without the number itself being stored here.
import * as Crypto from "expo-crypto";

import { numberDigits } from "@/src/domain/sameNumber";
import type { ApolloState } from "@/src/domain/types";
import { storage } from "@/src/utils/storage";

export type CheckGate = "call" | "text" | "message" | "app" | "network" | "device" | "account" | "email" | "link" | "vision";

export interface CheckHistoryEntry { at: string; state: ApolloState; summary: string; numberKey?: string }

const KEY = (gate: CheckGate) => `apollo.checkhistory.${gate}.v1`;
/** Enough to cover the reminder's 30 days; the history card shows the latest few. */
const CAP = 50;

/** The one-way code a number is kept under: the same for every way of writing the same number. */
export function numberKeyOf(number: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `apollo.number.v1:${numberDigits(number)}`);
}

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
