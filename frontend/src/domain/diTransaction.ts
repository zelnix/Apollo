// The Deep Investigation (DI) transaction: Magnum DI's real processing record for a case — what was
// prepared for Magnum DI, what came back (live, or the preview simulator) and the processing
// statistics — plus the recorded decision path. It is NOT evidence: evidence stays the original
// source Apollo received. The provider and model are never part of it.

import type { TriageInvestigationRecord } from "./triage/contract.ts";

export interface DiAttachment {
  mimeType: string;
  sizeBytes: number;
  dimensions?: { width: number; height: number };
  privacyScreening: string;
  redactionStatus: string;
  transmittedForm: string;
}

export interface DiTransaction {
  investigationId: string;
  engine: string;
  environment: string;
  mode: "Live" | "Simulated";
  simulated: boolean;
  status: string | null;
  failureCode: string | null;
  occurredAt: string | null;
  request: {
    systemPrompt?: string;
    investigationPrompt?: string;
    attachments?: DiAttachment[];
    attachmentCount?: number;
    tools?: string[];
    requestBytes?: number;
  };
  response: { text?: string; finishReason?: string | null };
  processing: {
    promptTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
    cachedTokens?: number | null;
    tokensAreEstimates?: boolean;
    tokensAreSimulated?: boolean;
    attachmentCount?: number;
    requestBytes?: number | null;
    durationMs?: number | null;
    geminiCalls?: number | null;
    retries?: number | null;
    cacheStatus?: string | null;
    cost?: { amountUsd?: number; basis?: string; note?: string };
  };
  notice: string | null;
}

/** What TC FlyBy recorded for the case (server `routing.teddy`, without the model). */
export interface FlybyTrace {
  ranAt: string | null;
  resolved: boolean;
  answeredBy: string | null;
  outcome: string | null;
  basis: string | null;
  messageType: string | null;
  pattern: { key: string; stage: string } | null;
  checks: { kind: string; status: string; route: string | null }[];
  searchCalls: number | null;
  searchQueries: number | null;
  cacheHits: number | null;
  magnumNeeded: boolean | null;
  magnumSearch: boolean | null;
  gaps: { item: string; what: string }[] | null;
  issues: { capability: string; text: string }[] | null;
  simulated: boolean | null;
}

/** The recorded decision path: Higgins Triage → TC FlyBy → Magnum DI → Higgins. A stage with no
 *  record is null — never inferred. */
export interface DiTrace {
  triage: TriageInvestigationRecord | null;
  flyby: FlybyTrace | null;
  magnum: { webSearch: boolean; searchQueries: number; itemsSent: number; simulated: boolean; at: string | null } | null;
  answeredBy: string | null;
  outcome: string | null;
  completion: string | null;
  settledReason: { ruleId: string; rule: string; by: string; sentence: string } | null;
  higgins: { status: "PASS" | "FAIL" | null; mode: string | null; attempts: number | null } | null;
}

/** How a number should be labelled in the DI tab: measured, estimated, or simulated. */
export function provenanceLabel(simulated: boolean, estimated: boolean | undefined): string {
  if (simulated) return "Simulated";
  return estimated ? "Estimated" : "Measured";
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "not recorded";
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
