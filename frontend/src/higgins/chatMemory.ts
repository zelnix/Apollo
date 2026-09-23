import { storage } from "@/src/utils/storage";
import type { HigginsChatMessage } from "./chatClient";

const KEY = "apollo.higgins.ordinary-chat.v2";
const MAX_AGE_MS = 60 * 60 * 1000;

function fresh(items: HigginsChatMessage[]): HigginsChatMessage[] {
  const cutoff = Date.now() - MAX_AGE_MS;
  return items.filter((item) => Date.parse(item.createdAt) > cutoff).slice(-40);
}

export async function loadLocalChat(): Promise<HigginsChatMessage[]> {
  const raw = await storage.secureGet<string | null>(KEY, null);
  if (!raw) return [];
  try {
    const items = fresh(JSON.parse(raw) as HigginsChatMessage[]);
    await storage.secureSet(KEY, JSON.stringify(items));
    return items;
  } catch { await storage.secureRemove(KEY); return []; }
}

export async function saveLocalChat(items: HigginsChatMessage[]): Promise<void> {
  await storage.secureSet(KEY, JSON.stringify(fresh(items)));
}

export async function clearLocalChat(): Promise<void> { await storage.secureRemove(KEY); }