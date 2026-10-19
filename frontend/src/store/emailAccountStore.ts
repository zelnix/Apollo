// Local, on-device storage for the user's known email account identifiers.
// Phase 1: accounts are manually added or auto-registered when a Gmail account connects.
// No inbox access is implied — these are identity labels for filtering and attribution.
import { storage } from "@/src/utils/storage";

export interface EmailAccount {
  id: string;
  email: string;
  provider: "gmail" | "outlook" | "yahoo" | "icloud" | "other";
  connected: boolean;
  addedAt: string;
}

const KEY = "apollo.email_accounts.v1";

function detectProvider(email: string): EmailAccount["provider"] {
  const domain = (email.split("@")[1] ?? "").toLowerCase();
  if (domain.includes("gmail") || domain.includes("googlemail")) return "gmail";
  if (domain.includes("outlook") || domain.includes("hotmail") || domain.includes("live.") || domain.includes("microsoft")) return "outlook";
  if (domain.includes("yahoo")) return "yahoo";
  if (domain.includes("icloud") || domain.endsWith("me.com") || domain.endsWith("mac.com")) return "icloud";
  return "other";
}

async function read(): Promise<EmailAccount[]> {
  const raw = await storage.getItem<string | null>(KEY, null);
  if (!raw) return [];
  try { return JSON.parse(raw) as EmailAccount[]; } catch { return []; }
}

export async function listEmailAccounts(): Promise<EmailAccount[]> { return read(); }

export async function addEmailAccount(email: string, connected = false): Promise<EmailAccount> {
  const accounts = await read();
  const existing = accounts.find((a) => a.email.toLowerCase() === email.toLowerCase().trim());
  if (existing) {
    if (connected && !existing.connected) {
      existing.connected = true;
      await storage.setItem(KEY, JSON.stringify(accounts));
    }
    return existing;
  }
  const account: EmailAccount = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    email: email.toLowerCase().trim(),
    provider: detectProvider(email),
    connected,
    addedAt: new Date().toISOString(),
  };
  await storage.setItem(KEY, JSON.stringify([account, ...accounts]));
  return account;
}

export async function removeEmailAccount(id: string): Promise<EmailAccount[]> {
  const next = (await read()).filter((a) => a.id !== id);
  await storage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function providerLabel(provider: EmailAccount["provider"]): string {
  switch (provider) {
    case "gmail": return "Gmail";
    case "outlook": return "Outlook";
    case "yahoo": return "Yahoo Mail";
    case "icloud": return "iCloud Mail";
    default: return "Email";
  }
}
