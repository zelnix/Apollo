// Gate Health Log — a short, on-device history of when each gate last verified as actively WORKING
// (i.e. its status was "Watching"). This is evidence of healthy automatic protection over time; it is
// never fabricated — an entry is only added when buildGatesOverview reports a gate as Watching.
import { storage } from "@/src/utils/storage";

const KEY = "apollo.gatehealth.log.v1";
const CAP = 10; // keep the last 10 "confirmed working" timestamps per gate
const THROTTLE_MS = 10 * 60 * 1000; // don't record more than once per 10 minutes per gate

export type GateHealthLog = Record<string, string[]>; // gateId -> ISO timestamps, newest first

async function read(): Promise<GateHealthLog> {
  const raw = await storage.getItem<string | null>(KEY, null);
  if (!raw) return {};
  try { return JSON.parse(raw) as GateHealthLog; } catch { return {}; }
}

export async function getGateHealthLog(): Promise<GateHealthLog> { return read(); }
export async function getLastWorking(gateId: string): Promise<string | null> { return (await read())[gateId]?.[0] ?? null; }

/** Record that these gates are confirmed working right now. Throttled per gate; capped at CAP entries. */
export async function recordWorking(gateIds: string[], now = Date.now()): Promise<GateHealthLog> {
  if (gateIds.length === 0) return read();
  const log = await read();
  let changed = false;
  for (const id of gateIds) {
    const entries = log[id] ?? [];
    const last = entries[0] ? Date.parse(entries[0]) : 0;
    if (Number.isFinite(last) && now - last < THROTTLE_MS) continue;
    log[id] = [new Date(now).toISOString(), ...entries].slice(0, CAP);
    changed = true;
  }
  if (changed) await storage.setItem(KEY, JSON.stringify(log));
  return log;
}

/** Short relative label for the log headline, e.g. "just now", "2 hours ago", "yesterday". */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "unknown";
  const diff = Math.max(0, now - t);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min > 1 ? "s" : ""} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr > 1 ? "s" : ""} ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day} days ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
