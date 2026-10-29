// Repeat Caller Alerts are raised by Android's call screening, often while ApolloSG is closed. Each one is noted on
// its screened call; this copies new ones into the on-device alert history, so the person can see what Apollo told them.
import { repeatAlertLogRows } from "@/src/domain/screenedCalls";
import { ScreenedCalls } from "@/src/security/screenedCalls";
import { storage } from "@/src/utils/storage";

import { recordAlert } from "./alertLog";

const SYNCED_KEY = "apollo.alerts.repeat_caller.synced_at";
let running: Promise<void> | null = null;

export function syncRepeatCallerAlerts(): Promise<void> {
  if (!ScreenedCalls.isSupported()) return Promise.resolve();
  running ??= (async () => {
    const since = Number(await storage.getItem<string | null>(SYNCED_KEY, null)) || 0;
    const rows = repeatAlertLogRows(await ScreenedCalls.list(), since);
    for (const row of rows) await recordAlert(row);
    if (rows.length) await storage.setItem(SYNCED_KEY, String(Date.parse(rows[rows.length - 1].at)));
  })().finally(() => { running = null; });
  return running;
}
