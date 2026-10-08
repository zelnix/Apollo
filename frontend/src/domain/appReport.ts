// Saved App Reports — an on-device snapshot of a completed App Gate investigation the person can reopen
// later. Pure snapshot builder (testable); nothing here hits the network. The snapshot is a faithful copy
// of what was shown, including the honest coverage/limits — a saved report never becomes a safety guarantee.
import type { ApolloState } from "./types";

export interface AppReportSnapshot {
  id: string; savedAt: string; appLabel: string; state: ApolloState; stateName: string;
  title: string; verdict: string; recommendation: string; scenario: string; riskScore: number;
  identity: string[]; permissions: string[]; why: string[]; network: string[]; reputation: string | null;
  evidence: string[]; coverage: string[];
}

export interface AppReportInput {
  id: string; appLabel: string; state: ApolloState; stateName: string; title: string; verdict: string;
  recommendation: string; scenario: string; riskScore: number;
  identity: string[]; permissions: string[]; why: string[]; network: string[]; reputation: string | null;
  evidence: string[]; coverage: string[];
}

export function buildAppReportSnapshot(input: AppReportInput, now = Date.now()): AppReportSnapshot {
  return { ...input, savedAt: new Date(now).toISOString() };
}
