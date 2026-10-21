/**
 * On-device saved-report storage.
 *
 * Stage 11 removed server-side report endpoints.  Reports are now snapshots
 * saved to AsyncStorage, never leaving the device.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import type { SavedReport } from "./client";

const REPORTS_KEY = "@apollo/saved_reports";

/** Read all saved reports from local storage. */
export async function listLocalReports(): Promise<SavedReport[]> {
  const raw = await AsyncStorage.getItem(REPORTS_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw) as SavedReport[]; } catch { return []; }
}

/** Persist a redacted snapshot of the current investigation response. */
export async function saveLocalReport(
  caseId: string,
  response: Record<string, unknown>,
  responseRevision: number,
): Promise<string> {
  const reportId = Crypto.randomUUID();
  const report: SavedReport = {
    reportId,
    caseId,
    gates: (response.gates as string[]) ?? [],
    savedAt: new Date().toISOString(),
    responseRevision,
    overview: (response.overview as string) ?? "",
    explanationMarkdown: (response.explanation_markdown as string) ?? "",
    assessment: (response.assessment as string) ?? "",
    attention: (response.attention as string) ?? "",
    scope: (response.scope as string) ?? "",
    findings: (response.findings as string[]) ?? [],
    uncertainties: (response.uncertainties as string[]) ?? [],
    sources: (response.sources as SavedReport["sources"]) ?? [],
    actions: (response.actions as SavedReport["actions"]) ?? [],
    historical: true,
    retentionNotice: "Saved locally on your device. Server evidence has been purged.",
  };
  const existing = await listLocalReports();
  existing.unshift(report);
  await AsyncStorage.setItem(REPORTS_KEY, JSON.stringify(existing));
  return reportId;
}

/** Delete a single saved report from local storage. */
export async function deleteLocalReport(reportId: string): Promise<void> {
  const existing = await listLocalReports();
  const filtered = existing.filter((r) => r.reportId !== reportId);
  await AsyncStorage.setItem(REPORTS_KEY, JSON.stringify(filtered));
}
