// Higgins Triage — shared investigation contract (mirror of backend services/triage/contract.py).
// Three outcomes only. A Coverage Gap can prevent NO THREAT but can never create POSSIBLE THREAT,
// and never downgrades threat evidence Apollo actually has. Triage makes ZERO Gemini calls.

import catalogue from "./catalogue.ts";

export type TriageOutcome = "NO_THREAT_IDENTIFIED" | "POSSIBLE_THREAT_IDENTIFIED" | "LIMITED_UNABLE_TO_DETERMINE";
export type RuleResult = "met" | "not_met" | "not_applicable" | "coverage_gap";

export interface CatalogueRule {
  id: string;
  category: string;
  title: string;
  evidence?: string[];
  platformDependent?: boolean;
  gapCode?: string;
}

export interface RuleRecord {
  ruleId: string;
  title: string;
  category: string;
  applicable: boolean;
  checked: boolean;
  result: RuleResult;
  evidence: string[];
  coverageGap: string | null;
  detail: string;
}

export interface CoverageGapRecord {
  code: string;
  detail: string;
  recoverable: boolean;
  ruleIds: string[];
}

export interface RetryRecord {
  check: string;
  attempts: number;
  outcome: "succeeded" | "recovered" | "failed" | "not_retried_permanent";
}

export interface TriageInvestigationRecord {
  investigationId: string;
  catalogueVersion: number;
  sourceType: string;
  outcome: TriageOutcome;
  reason: string;
  rulesApplicable: string[];
  rulesChecked: string[];
  rulesMet: string[];
  rules: RuleRecord[];
  coverageGaps: CoverageGapRecord[];
  retries: RetryRecord[];
  correlation: Record<string, unknown>;
  recheckUseful: boolean;
  geminiCalls: 0;
  evaluatedAt: string;
}

export const CATALOGUE_VERSION: number = (catalogue as unknown as { version: number }).version;
export const RULES: CatalogueRule[] = (catalogue as unknown as { rules: CatalogueRule[] }).rules;
export const RULES_BY_ID: Record<string, CatalogueRule> = Object.fromEntries(RULES.map((r) => [r.id, r]));
export const RULES_BY_CATEGORY: Record<string, CatalogueRule[]> = RULES.reduce((acc, r) => {
  (acc[r.category] ||= []).push(r);
  return acc;
}, {} as Record<string, CatalogueRule[]>);

const GAP_META: Record<string, { recoverable: boolean; plain: string }> = Object.fromEntries(
  (catalogue as unknown as { coverageGapCodes: { code: string; recoverable: boolean; plain: string }[] })
    .coverageGapCodes.map((g) => [g.code, { recoverable: g.recoverable, plain: g.plain }]),
);

export const RETRY_ATTEMPTS: number = (catalogue as unknown as { retryPolicy: { attempts: number } }).retryPolicy.attempts;

export function gapIsRecoverable(code: string): boolean {
  return GAP_META[code]?.recoverable ?? false;
}

/** Plain-English translation of a Coverage Gap code — Higgins' wording, never a technical code. */
export function gapPlainEnglish(code: string): string {
  return GAP_META[code]?.plain ?? "ApolloSG couldn't complete part of this check.";
}

/** Historical SAFE/SUSPICIOUS/UNCERTAIN results, mapped for display only. */
export function legacyOutcome(verdict: string): TriageOutcome {
  const value = (verdict || "").toUpperCase();
  if (value === "SAFE") return "NO_THREAT_IDENTIFIED";
  if (value === "SUSPICIOUS") return "POSSIBLE_THREAT_IDENTIFIED";
  return "LIMITED_UNABLE_TO_DETERMINE";
}

export const OUTCOME_LABEL: Record<TriageOutcome, string> = {
  NO_THREAT_IDENTIFIED: "No threat identified",
  POSSIBLE_THREAT_IDENTIFIED: "Possible threat identified",
  LIMITED_UNABLE_TO_DETERMINE: "Limited — unable to determine",
};

/** Whether a "Check again" affordance can actually achieve something. */
export function recheckCanHelp(record: TriageInvestigationRecord | null | undefined): boolean {
  return !!record?.coverageGaps.some((gap) => gap.recoverable);
}
