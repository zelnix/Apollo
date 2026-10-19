// Per-case report progress ("Called bank", "Reported to police"), kept on this device only.
import { storage } from "@/src/utils/storage";

export type ReportStep = "calledBank" | "reportedPolice";
export type ReportProgress = Partial<Record<ReportStep, string>>;

const KEY = "apollo.report_progress.v1";

async function readAll(): Promise<Record<string, ReportProgress>> {
  try { const v = JSON.parse((await storage.getItem(KEY, "{}")) ?? "{}"); return v && typeof v === "object" ? v : {}; }
  catch { return {}; }
}

export async function loadReportProgress(caseKey: string): Promise<ReportProgress> {
  return (await readAll())[caseKey] ?? {};
}

/** Ticks (records the time) or unticks a step for a case. */
export async function setReportStep(caseKey: string, step: ReportStep, done: boolean): Promise<ReportProgress> {
  const all = await readAll();
  const next = { ...(all[caseKey] ?? {}) };
  if (done) next[step] = new Date().toISOString(); else delete next[step];
  all[caseKey] = next;
  await storage.setItem(KEY, JSON.stringify(all));
  return next;
}

export async function deleteReportProgress(caseKey: string) {
  const all = await readAll();
  if (!(caseKey in all)) return;
  delete all[caseKey];
  await storage.setItem(KEY, JSON.stringify(all));
}
