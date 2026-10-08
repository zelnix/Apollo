// Support request reference (spec §7). AP-YYYYMMDD-<128-bit uppercase hex>, where the random portion
// is generated with the OS CSPRNG via expo-crypto — never Math.random, timestamps or counters. One
// reference per support request: persisted so reopening the same draft reuses it; a brand-new request
// mints a fresh one. The reference correlates the email, body and any exported report — it does NOT
// imply a backend ticket exists (there is no support backend).
import * as Crypto from "expo-crypto";

import { storage } from "@/src/utils/storage";

const CURRENT_KEY = "apollo.support.ref.current.v1";

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

/** The reference for the current support request. Reused across reopens until a new request is started. */
export async function getOrCreateSupportReference(): Promise<string> {
  const existing = await storage.getItem<string | null>(CURRENT_KEY, null);
  if (existing && /^AP-\d{8}-[0-9A-F]{32}$/.test(existing)) return existing;
  const fresh = mintSupportReference();
  await storage.setItem(CURRENT_KEY, fresh);
  return fresh;
}

/** Start a genuinely new support request — mints and stores a new reference. */
export async function startNewSupportReference(): Promise<string> {
  const fresh = mintSupportReference();
  await storage.setItem(CURRENT_KEY, fresh);
  return fresh;
}
