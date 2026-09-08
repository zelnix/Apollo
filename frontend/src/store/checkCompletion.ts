// Completion record for Apollo's checks (on-device only). Each check screen calls markCheckDone() when a check has
// actually produced a result; Higgins' suggestion chips read it to show what's been done since he asked.
import { useEffect, useState } from "react";

import type { CheckId } from "@/src/domain/higginsChecks";
import { storage } from "@/src/utils/storage";

const KEY = "apollo.checks.completed.v1";
type Record_ = Partial<Record<CheckId, string>>;
let cache: Record_ | null = null;
const listeners = new Set<(r: Record_) => void>();

async function load(): Promise<Record_> {
  if (!cache) { const raw = await storage.getItem<string | null>(KEY, null); cache = raw ? (JSON.parse(raw) as Record_) : {}; }
  return cache;
}

export async function markCheckDone(kind: CheckId): Promise<void> {
  const cur = await load();
  cache = { ...cur, [kind]: new Date().toISOString() };
  await storage.setItem(KEY, JSON.stringify(cache));
  listeners.forEach((l) => l(cache!));
}

export function useCheckCompletion(): Record_ {
  const [r, setR] = useState<Record_>(cache ?? {});
  useEffect(() => { void load().then(setR); listeners.add(setR); return () => { listeners.delete(setR); }; }, []);
  return r;
}
