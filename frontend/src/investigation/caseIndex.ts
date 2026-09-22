// Patrol event → shared investigation case index. A Gate check that opened a case for an event records it here, so "Ask Higgins"
// from Patrol (or Home's recent scents) continues THAT case instead of opening a second context for the same incident.
import { storage } from "@/src/utils/storage";
import { apiGet, apiPost } from "@/src/api/client";

const KEY = "apollo.investigation.case_for_event";
const LIMIT = 200;

async function load(): Promise<Record<string, string>> {
  const raw = await storage.getItem<string | null>(KEY, null).catch(() => null);
  try { return raw ? (JSON.parse(raw) as Record<string, string>) : {}; } catch { return {}; }
}

export async function rememberCaseForEvent(eventId: string, caseId: string): Promise<void> {
  const map = await load();
  map[eventId] = caseId;
  const keys = Object.keys(map);
  for (const k of keys.slice(0, Math.max(0, keys.length - LIMIT))) delete map[k];
  await storage.setItem(KEY, JSON.stringify(map)).catch(() => undefined);
  await apiPost(`/patrol/events/${encodeURIComponent(eventId)}/investigation`, "patrol_sync", { case_id: caseId }).catch(() => undefined);
}

export async function forgetCase(caseId: string): Promise<void> {
  const map = await load();
  for (const [k, v] of Object.entries(map)) if (v === caseId) delete map[k];
  await storage.setItem(KEY, JSON.stringify(map)).catch(() => undefined);
}

export async function caseForEvent(eventId: string | null | undefined, knownCaseId?: string | null): Promise<string | null> {
  if (!eventId) return null;
  if (knownCaseId) return knownCaseId;
  try {
    const remote = await apiGet<{ caseId: string | null }>(`/patrol/events/${encodeURIComponent(eventId)}/investigation`);
    if (remote.caseId) { const map = await load(); map[eventId] = remote.caseId; await storage.setItem(KEY, JSON.stringify(map)); return remote.caseId; }
  } catch { /* local cache remains a continuity fallback while offline */ }
  return (await load())[eventId] ?? null;
}
