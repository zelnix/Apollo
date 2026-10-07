// Local, on-device persistence for Higgins First Check (spec §12/§13: reuse existing history, do not
// build a second audit system elsewhere). Baseline = the onboarding result; history = each completed
// First Check / Re-check, newest first. All local; nothing is uploaded.

import type { FirstCheckReport } from "@/src/domain/firstCheck";
import { storage } from "@/src/utils/storage";

const BASELINE_KEY = "apollo.firstcheck.baseline.v1";
const HISTORY_KEY = "apollo.firstcheck.history.v1";
const HISTORY_CAP = 30;

export interface FirstCheckHistoryEntry {
  kind: "first_check" | "re_check";
  report: FirstCheckReport;
}

/** The most recent completed First Check / Re-check, or null if the baseline has never run. */
export async function getBaseline(): Promise<FirstCheckReport | null> {
  const raw = await storage.getItem<string | null>(BASELINE_KEY, null);
  return raw ? (JSON.parse(raw) as FirstCheckReport) : null;
}

export async function hasBaseline(): Promise<boolean> {
  return (await getBaseline()) !== null;
}

export async function getHistory(): Promise<FirstCheckHistoryEntry[]> {
  const raw = await storage.getItem<string | null>(HISTORY_KEY, null);
  return raw ? (JSON.parse(raw) as FirstCheckHistoryEntry[]) : [];
}

/** Save a completed check: it becomes the new baseline and is prepended to history. */
export async function saveFirstCheck(report: FirstCheckReport, kind: FirstCheckHistoryEntry["kind"]): Promise<void> {
  await storage.setItem(BASELINE_KEY, JSON.stringify(report));
  const prior = await getHistory();
  const merged = [{ kind, report }, ...prior].slice(0, HISTORY_CAP);
  await storage.setItem(HISTORY_KEY, JSON.stringify(merged));
}
