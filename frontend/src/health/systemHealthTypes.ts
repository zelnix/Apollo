import type { SavedReport } from "@/src/investigation/client";

export type CheckStatus = "pending" | "checking" | "healthy" | "degraded" | "unavailable";
export type CheckCode = string | null;
export interface CheckRow { status: CheckStatus; code: CheckCode; checkedAt: string | null }
/** Read from Apollo's saved records — whether the Gemini key is set and how the last real Gemini call went. No test call is made. */
export interface ProviderStatus { keyConfigured: boolean; lastCall: { at: string | null; worked: boolean; failureCode: string | null; purpose: string | null } | null }
export interface FullHealthCheck {
  checking: boolean;
  overall: CheckStatus;
  checkedAt: string | null;
  device: CheckRow;
  backend: CheckRow;
  higgins: CheckRow;
  report: CheckRow;
  checkId: string | null;
  provider?: ProviderStatus | null;
}
export interface BackendProbe { schemaVersion: number; status: string; service: string; checkedAt: string }
export interface Readiness { schemaVersion: number; status: "healthy" | "degraded" | "unavailable"; checkedAt: string; components: { id: string; status: string; code: string | null }[] }
export interface HigginsAdmission {
  checkId: string;
  state: "queued" | "running";
  createdAt: string;
  expiresAt: string;
}
export interface HigginsCheck {
  schemaVersion: number;
  checkId: string;
  state: "completed" | "failed";
  createdAt: string;
  expiresAt: string;
  checkedAt: string | null;
  cached: boolean;
  investigation: { status: "pending" | "healthy" | "unavailable"; code: string | null; provider?: ProviderStatus | null };
  report: { status: "pending" | "healthy" | "unavailable"; code: string | null; fixture: SavedReport | null };
  cleanup: { status: "pending" | "complete" | "failed" };
}
export type HigginsJob = HigginsAdmission | HigginsCheck;
const empty = (): CheckRow => ({ status: "pending", code: null, checkedAt: null });
export const INITIAL_CHECK: FullHealthCheck = { checking: false, overall: "pending", checkedAt: null,
  device: empty(), backend: empty(), higgins: empty(), report: empty(), checkId: null };