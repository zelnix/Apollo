// What Higgins asked for, on-device only, so he can gently follow up a day later (Home card). Idempotent per message.
import { useEffect, useState } from "react";

import type { CheckId, Suggestion } from "@/src/domain/higginsChecks";
import { storage } from "@/src/utils/storage";

const KEY = "apollo.higgins.suggestions.v1";
const MAX = 40;
let cache: Suggestion[] | null = null;
const listeners = new Set<(s: Suggestion[]) => void>();

async function load(): Promise<Suggestion[]> {
  if (!cache) { const raw = await storage.getItem<string | null>(KEY, null); cache = raw ? ((typeof raw === "string" ? JSON.parse(raw) : raw) as Suggestion[]) : []; }
  return cache;
}
async function save(next: Suggestion[]) { cache = next.slice(-MAX); await storage.setItem(KEY, JSON.stringify(cache)); listeners.forEach((l) => l(cache!)); }

export async function recordSuggestion(messageId: string, askedAt: string, checks: CheckId[]): Promise<void> {
  if (!checks.length) return;
  const cur = await load();
  if (cur.some((s) => s.messageId === messageId)) return;
  await save([...cur, { messageId, askedAt, checks }]);
}

export async function snoozeSuggestion(messageId: string, until: string): Promise<void> {
  const cur = await load();
  await save(cur.map((s) => (s.messageId === messageId ? { ...s, snoozedUntil: until } : s)));
}

export function useSuggestions(): Suggestion[] {
  const [s, setS] = useState<Suggestion[]>(cache ?? []);
  useEffect(() => { void load().then(setS); listeners.add(setS); return () => { listeners.delete(setS); }; }, []);
  return s;
}
