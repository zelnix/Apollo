// What Apollo asked this phone to show, and what became of it.
//
// Three facts are recorded and kept apart: an alert was handed to the OS ("shown"), an alert could not
// be handed over and why ("failed"), and a gentle alert was held because the person was in quiet hours
// ("held", released later). Tapping the notification is the only proof it actually arrived, so it is
// recorded separately as `openedAt`. Nothing here claims an alert was seen.
import { storage } from "@/src/utils/storage";

import type { LocalAlert } from "./notifications";

export type AlertLogState = "shown" | "held" | "failed";

export interface AlertLogEntry {
  id: string;
  title: string;
  body: string;
  /** When Apollo raised it. */
  at: string;
  state: AlertLogState;
  /** Why it could not be handed to the OS, in the OS's own words. */
  detail?: string | null;
  /** When a held alert was finally released, once quiet hours ended. */
  releasedAt?: string | null;
  /** When the person tapped it on this phone. */
  openedAt?: string | null;
}

interface HeldAlert { id: string; alert: LocalAlert; heldAt: string }

const LOG_KEY = "apollo.alerts.log";
const HELD_KEY = "apollo.alerts.held";
const MAX_LOG = 50;
const MAX_HELD = 20;

async function readJson<T>(key: string): Promise<T[]> {
  const raw = await storage.getItem<string | null>(key, null).catch(() => null);
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await storage.setItem(key, JSON.stringify(value)).catch(() => undefined);
}

export function readAlertLog(): Promise<AlertLogEntry[]> {
  return readJson<AlertLogEntry>(LOG_KEY);
}

export async function recordAlert(entry: AlertLogEntry): Promise<void> {
  const log = await readAlertLog();
  await writeJson(LOG_KEY, [entry, ...log].slice(0, MAX_LOG));
}

export async function updateAlert(id: string, patch: Partial<AlertLogEntry>): Promise<void> {
  const log = await readAlertLog();
  const next = log.map((e) => (e.id === id ? { ...e, ...patch } : e));
  await writeJson(LOG_KEY, next);
}

/** The person tapped this alert — recorded as the one honest sign it reached them. */
export function markAlertOpened(id: string): Promise<void> {
  return updateAlert(id, { openedAt: new Date().toISOString() });
}

/** A gentle alert raised during quiet hours: kept, not dropped. */
export async function holdAlert(id: string, alert: LocalAlert): Promise<void> {
  const held = await readJson<HeldAlert>(HELD_KEY);
  await writeJson(HELD_KEY, [...held, { id, alert, heldAt: new Date().toISOString() }].slice(-MAX_HELD));
  await recordAlert({ id, title: alert.title, body: alert.body, at: new Date().toISOString(), state: "held" });
}

export function readHeldAlerts(): Promise<HeldAlert[]> {
  return readJson<HeldAlert>(HELD_KEY);
}

/** Hand every held alert to the OS as its own notification, oldest first, and clear the queue. */
export async function releaseHeldAlerts(
  schedule: (alert: LocalAlert, id: string) => Promise<unknown>,
): Promise<number> {
  const held = await readHeldAlerts();
  if (held.length === 0) return 0;
  await writeJson(HELD_KEY, []);
  let released = 0;
  for (const item of held) {
    try {
      await schedule(item.alert, item.id);
      await updateAlert(item.id, { state: "shown", releasedAt: new Date().toISOString() });
      released += 1;
    } catch (error: unknown) {
      await updateAlert(item.id, { state: "failed", detail: error instanceof Error ? error.message : "This phone refused the notification." });
    }
  }
  return released;
}
