// "Starter memory" persistence — remembers the ordinary questions a person asks Higgins most often
// so they can be offered back as one-tap chips. Stored locally only (AsyncStorage), never sent anywhere.
// Pure logic lives in ./starterMemoryCore (unit-tested); this file just loads/saves.
import { storage } from "@/src/utils/storage";
import { recordInto, type StarterEntry } from "./starterMemoryCore";

export { topStarters, type StarterEntry } from "./starterMemoryCore";

const KEY = "apollo.higgins.starter-memory.v1";

export async function loadStarterMemory(): Promise<StarterEntry[]> {
  const raw = await storage.getItem<string | null>(KEY, null);
  if (!raw) return [];
  try { return JSON.parse(raw) as StarterEntry[]; } catch { return []; }
}
export async function recordStarter(text: string): Promise<StarterEntry[]> {
  const next = recordInto(await loadStarterMemory(), text);
  await storage.setItem(KEY, JSON.stringify(next));
  return next;
}
export async function clearStarterMemory(): Promise<void> { await storage.removeItem(KEY); }
