// On-device persistence for Saved App Reports (App Gate). Capped list, newest first. No server storage.
import { buildAppReportSnapshot, type AppReportInput, type AppReportSnapshot } from "@/src/domain/appReport";
import { storage } from "@/src/utils/storage";

const KEY = "apollo.appreports.v1";
const CAP = 30;

async function read(): Promise<AppReportSnapshot[]> {
  const raw = await storage.getItem<string | null>(KEY, null);
  if (!raw) return [];
  try { return JSON.parse(raw) as AppReportSnapshot[]; } catch { return []; }
}

export async function listAppReports(): Promise<AppReportSnapshot[]> { return read(); }
export async function getAppReport(id: string): Promise<AppReportSnapshot | null> { return (await read()).find((r) => r.id === id) ?? null; }

export async function saveAppReport(input: AppReportInput): Promise<AppReportSnapshot> {
  const snapshot = buildAppReportSnapshot(input);
  const next = [snapshot, ...(await read()).filter((r) => r.id !== snapshot.id)].slice(0, CAP);
  await storage.setItem(KEY, JSON.stringify(next));
  return snapshot;
}

export async function deleteAppReport(id: string): Promise<AppReportSnapshot[]> {
  const next = (await read()).filter((r) => r.id !== id);
  await storage.setItem(KEY, JSON.stringify(next));
  return next;
}
