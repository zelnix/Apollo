// On-device persistence for Saved Checks (link / message / internet). Capped, newest first. No server.
import { buildSavedCheck, type SavedCheck, type SavedCheckInput } from "@/src/domain/savedCheck";
import { storage } from "@/src/utils/storage";

const KEY = "apollo.savedchecks.v1";
const CAP = 40;

async function read(): Promise<SavedCheck[]> {
  const raw = await storage.getItem<string | null>(KEY, null);
  if (!raw) return [];
  try { return JSON.parse(raw) as SavedCheck[]; } catch { return []; }
}

export async function listSavedChecks(): Promise<SavedCheck[]> { return read(); }

export async function saveCheck(input: SavedCheckInput): Promise<SavedCheck> {
  const snapshot = buildSavedCheck(input);
  const next = [snapshot, ...(await read()).filter((r) => r.id !== snapshot.id)].slice(0, CAP);
  await storage.setItem(KEY, JSON.stringify(next));
  return snapshot;
}

export async function deleteSavedCheck(id: string): Promise<SavedCheck[]> {
  const next = (await read()).filter((r) => r.id !== id);
  await storage.setItem(KEY, JSON.stringify(next));
  return next;
}
