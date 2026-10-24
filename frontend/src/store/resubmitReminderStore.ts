// Stopped investigations waiting out Magnum DI's pause, kept on this device only (ids and times — no content).
// Read by the quiet note on Ask Higgins; written by every investigation flow (caseStore).
import { useEffect, useState } from "react";
import { AppState } from "react-native";

import { dueReminder, type StoppedCase, withStopped } from "@/src/investigation/resubmit";
import { storage } from "@/src/utils/storage";

const KEY = "apollo.investigation.resubmitReminders.v2";
const CHECK_EVERY_MS = 15_000;
let cache: StoppedCase[] | null = null;
const listeners = new Set<() => void>();

async function load(): Promise<StoppedCase[]> {
  if (!cache) {
    const raw = await storage.getItem<string | null>(KEY, null).catch(() => null);
    try { cache = raw ? (JSON.parse(raw) as StoppedCase[]) : []; } catch { cache = []; }
  }
  return cache;
}

async function save(next: StoppedCase[]): Promise<void> {
  cache = next;
  listeners.forEach((listener) => listener());
  await storage.setItem(KEY, JSON.stringify(next)).catch(() => undefined);
}

export async function rememberStopped(stopped: Omit<StoppedCase, "status">): Promise<void> {
  const items = await load();
  const next = withStopped(items, stopped, Date.now());
  if (JSON.stringify(next) !== JSON.stringify(items)) await save(next);
}

export async function forgetStopped(caseId: string): Promise<void> {
  const items = await load();
  if (items.some((item) => item.caseId === caseId)) await save(items.filter((item) => item.caseId !== caseId));
}

export async function dismissStopped(caseId: string): Promise<void> {
  await save((await load()).map((item) => (item.caseId === caseId ? { ...item, status: "dismissed" as const } : item)));
}

/** The stopped case ready to resubmit now, other than the one already on screen. */
export function useDueResubmitReminder(openCaseId: string | null): StoppedCase | null {
  const [due, setDue] = useState<StoppedCase | null>(null);
  useEffect(() => {
    let alive = true;
    const check = () => { void load().then((items) => { if (alive) setDue(dueReminder(items, Date.now(), openCaseId)); }); };
    check();
    listeners.add(check);
    const timer = setInterval(check, CHECK_EVERY_MS);
    const sub = AppState.addEventListener("change", (state) => { if (state === "active") check(); });
    return () => { alive = false; listeners.delete(check); clearInterval(timer); sub.remove(); };
  }, [openCaseId]);
  return due;
}
