// Why a Triage result ended Limited — cause codes for telemetry and the admin "Limited by cause" report.
// Pure. Only codes leave the device: never the link, number, message or any content.

import type { LookupFailure } from "../reputationLookup.ts";
import type { RetryRecord, TriageInvestigationRecord } from "./contract.ts";

export interface CauseContext {
  /** How the reputation lookup this Triage depended on failed, when it did. */
  reputationFailure?: LookupFailure | null;
  /** The caller-number reputation decision, for a number check. */
  numberDecision?: string | null;
}

/** One cause per distinct reason the record is Limited; [] for any other outcome. */
export function limitedCauses(record: TriageInvestigationRecord, ctx: CauseContext = {}): string[] {
  if (record.outcome !== "LIMITED_UNABLE_TO_DETERMINE") return [];
  const causes = new Set<string>();
  for (const gap of record.coverageGaps) {
    if (gap.code === "INTELLIGENCE_PROVIDER_UNAVAILABLE") causes.add(`reputation_${ctx.reputationFailure ?? "unavailable"}`);
    else if (gap.code === "INSUFFICIENT_EVIDENCE") causes.add(ctx.numberDecision === "review" ? "number_risk_moderate" : "insufficient_evidence");
    else if (gap.code === "DETERMINISTIC_CHECK_ERROR") causes.add("rule_execution_error");
    else causes.add(`gap_${gap.code.toLowerCase()}`);
  }
  return [...causes];
}

/** The failure kind for a caller-number reputation answer that established nothing. */
export function numberLookupFailure(result: { decision: string; source?: string | null }): LookupFailure | null {
  if (result.decision !== "unknown") return null;
  if (result.source === "not_configured") return "not_configured";
  if (result.source === "unavailable") return "provider_unavailable";
  return "no_data";
}

export interface TriageTelemetry {
  source_type: string;
  outcome: string;
  causes: string[];
  gap_codes: string[];
  catalogue_version: number;
  lookup_check: string | null;
  lookup_attempts: number | null;
  lookup_outcome: string | null;
}

/** The whole telemetry payload: outcome and cause codes only. */
export function triageTelemetry(record: TriageInvestigationRecord, ctx: CauseContext = {}, lookup?: RetryRecord | null): TriageTelemetry {
  return {
    source_type: record.sourceType,
    outcome: record.outcome,
    causes: limitedCauses(record, ctx),
    gap_codes: record.coverageGaps.map((g) => g.code),
    catalogue_version: record.catalogueVersion,
    lookup_check: lookup?.check ?? null,
    lookup_attempts: lookup?.attempts ?? null,
    lookup_outcome: lookup?.outcome ?? null,
  };
}
