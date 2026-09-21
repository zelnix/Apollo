// One mapping from a Gate's HigginsIssueContext to the shared CreateCase input (used by Gate screens and the Ask tab).
import * as Crypto from "expo-crypto";

import type { HigginsIssueContext } from "@/src/domain/higginsHandoff";
import type { CreateCase, Gate } from "./types";

/** Handoff findings become Apollo's initial (revisable) observations in the shared case. */
export function initialFindings(context: HigginsIssueContext): string[] {
  return [
    `Apollo ${context.gate} check summary: ${context.issue_summary} (Apollo state: ${context.assessment_state})`,
    ...context.findings.map((f) => `${f.provenance === "observed" ? "Observed" : f.provenance === "user_reported" ? "User reported" : "Apollo inferred"} (${f.status}): ${f.summary}`),
    ...context.uncertainty.map((u) => `Uncertain: ${u}`),
    ...context.confirmed_protective_actions.map((a) => `Confirmed protective action: ${a}`),
    ...context.user_reported_actions.map((a) => `User reported action: ${a}`),
  ];
}

export function createCaseInput(context: HigginsIssueContext | null, question: string): { input: Omit<CreateCase, "deviceProfile">; files: { uri: string; name: string; mediaType: string }[] } {
  const originals = context?.original_evidence ?? [];
  return {
    input: {
      gate: context && context.gate !== "incident" ? (context.gate as Gate) : null,
      question,
      submissions: originals.flatMap((item) => item.kind === "file" ? [] : [{ clientItemId: Crypto.randomUUID(), kind: item.kind, value: item.value, label: item.label ?? "" }]),
      initialFindingRefs: [],
      initialFindings: context ? initialFindings(context) : [],
    },
    files: originals.flatMap((item) => item.kind === "file" ? [{ uri: item.uri, name: item.name, mediaType: item.mediaType }] : []),
  };
}
