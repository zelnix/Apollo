// Support request reference (spec §7). AP-YYYYMMDD-<128-bit uppercase hex>, where the random portion
// is generated with the OS CSPRNG via expo-crypto — never Math.random, timestamps or counters. One
// reference per support request: persisted so reopening the same draft reuses it; a brand-new request
// mints a fresh one. The reference correlates the email, body and any exported report — it does NOT
// imply a backend ticket exists (there is no support backend).
import * as Crypto from "expo-crypto";

import { storage } from "@/src/utils/storage";

const CURRENT_KEY = "apollo.support.ref.current.v1";
const HISTORY_KEY = "apollo.support.ref.history.v1";
const HISTORY_CAP = 25;

export interface SupportRequestRef { reference: string; createdAt: string }

function utcDateStamp(d = new Date()): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Mint a new reference. 16 bytes (128 bits) of CSPRNG entropy, uppercase hex. */
export function mintSupportReference(d = new Date()): string {
  const bytes = Crypto.getRandomBytes(16);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return `AP-${utcDateStamp(d)}-${hex.toUpperCase()}`;
}

/** Past support requests, newest first — the Support Inbox (spec: remember past references). */
export async function getReferenceHistory(): Promise<SupportRequestRef[]> {
  const raw = await storage.getItem<string | null>(HISTORY_KEY, null);
  return raw ? (JSON.parse(raw) as SupportRequestRef[]) : [];
}

async function rememberReference(reference: string): Promise<void> {
  const prior = await getReferenceHistory();
  if (prior.some((r) => r.reference === reference)) return;
  const merged = [{ reference, createdAt: new Date().toISOString() }, ...prior].slice(0, HISTORY_CAP);
  await storage.setItem(HISTORY_KEY, JSON.stringify(merged));
}

/** The reference for the current support request. Reused across reopens until a new request is started. */
export async function getOrCreateSupportReference(): Promise<string> {
  const existing = await storage.getItem<string | null>(CURRENT_KEY, null);
  if (existing && /^AP-\d{8}-[0-9A-F]{32}$/.test(existing)) return existing;
  const fresh = mintSupportReference();
  await storage.setItem(CURRENT_KEY, fresh);
  await rememberReference(fresh);
  return fresh;
}

/** Start a genuinely new support request — mints and stores a new reference. */
export async function startNewSupportReference(): Promise<string> {
  const fresh = mintSupportReference();
  await storage.setItem(CURRENT_KEY, fresh);
  await rememberReference(fresh);
  return fresh;
}

/** Reopen a past request: make its reference current again so the email/report reuse it. */
export async function reopenSupportReference(reference: string): Promise<void> {
  if (/^AP-\d{8}-[0-9A-F]{32}$/.test(reference)) await storage.setItem(CURRENT_KEY, reference);
}
