// Scam Alerts tab count: new High and Extreme alerts the person hasn't seen. "Seen" means they were in the list
// when Scam Alerts was open. On the very first run everything already published counts as seen, so the count
// only ever reflects alerts that arrived since. Refreshed when the app opens or returns to the foreground,
// at most every 10 minutes; no background polling.
import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { countNewSevereAlerts } from "@/src/domain/tabBadges";
import { governmentScams, type GovernmentAlert } from "@/src/higgins/hubClient";
import { homeRegion } from "@/src/higgins/scamAlertUi";
import { storage } from "@/src/utils/storage";

const SEEN_KEY = "apollo.scamAlerts.seen.v1";
const KEEP_SEEN = 500;
const REFRESH_EVERY_MS = 10 * 60_000;
const HOME = homeRegion();

let latest: GovernmentAlert[] = [];
let seen: Set<string> | null = null;
let seenLoad: Promise<Set<string> | null> | null = null;
let count = 0;
let lastFetchAt = 0;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function recount() {
  const next = seen ? countNewSevereAlerts(latest, seen, HOME) : 0;
  if (next === count) return;
  count = next;
  listeners.forEach((listener) => listener());
}

/** The stored seen list, or null when this phone has never stored one. */
function loadSeen(): Promise<Set<string> | null> {
  seenLoad ??= storage.getItem<string | null>(SEEN_KEY, null).then((raw) => {
    try {
      const list = typeof raw === "string" ? (JSON.parse(raw) as unknown) : null;
      return Array.isArray(list) ? new Set(list.filter((url): url is string => typeof url === "string")) : null;
    } catch {
      return null;
    }
  });
  return seenLoad;
}

function saveSeen(set: Set<string>) {
  void storage.setItem(SEEN_KEY, JSON.stringify([...set].slice(-KEEP_SEEN)));
}

export function refreshScamAlertBadge(force = false): Promise<void> {
  if (inFlight) return inFlight;
  if (!force && Date.now() - lastFetchAt < REFRESH_EVERY_MS) return Promise.resolve();
  inFlight = (async () => {
    try {
      const [stored, result] = await Promise.all([seen ? Promise.resolve(seen) : loadSeen(), governmentScams()]);
      latest = [...result.alerts, ...result.emerging];
      lastFetchAt = Date.now();
      if (stored) seen = stored;
      else {
        seen = new Set(latest.map((alert) => alert.url));
        saveSeen(seen);
      }
      recount();
    } catch {
      // Offline or the service is busy: keep the last count rather than guessing.
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Scam Alerts is open showing [alerts]: they are no longer new. */
export async function markScamAlertsSeen(alerts: GovernmentAlert[]): Promise<void> {
  const set = seen ?? (await loadSeen()) ?? new Set<string>();
  seen = set;
  let added = false;
  for (const alert of [...alerts, ...latest]) {
    if (set.has(alert.url)) continue;
    set.add(alert.url);
    added = true;
  }
  if (added) saveSeen(set);
  recount();
}

export function getNewSevereAlertCount(): number { return count; }

/** [deviceId]: the service answers only a registered device, so the first fetch waits for it (and retries when it arrives). */
export function useNewSevereAlertCount(deviceId: string | null | undefined): number {
  useEffect(() => {
    if (!deviceId) return;
    void refreshScamAlertBadge();
    const sub = AppState.addEventListener("change", (state) => { if (state === "active") void refreshScamAlertBadge(); });
    return () => sub.remove();
  }, [deviceId]);
  return useSyncExternalStore(
    (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => count,
    () => 0,
  );
}
