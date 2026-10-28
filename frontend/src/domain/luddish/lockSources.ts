// Higgins Luddish L1 — the Evidence Lock for each kind of result ApolloSG shows: a check result worked out on the phone,
// a TC FlyBy / Magnum DI investigation, and a Patrol finding handed to Ask Higgins. Each takes the state and findings
// exactly as recorded; nothing is recomputed or inferred. Pure: type imports only.
import type { CheckResultModel } from "../checkResult.ts";
import type { HigginsIssueContext } from "../higginsHandoff.ts";
import type { HigginsResponse } from "../../investigation/types.ts";
import { lockEvidence, type Basis, type EvidenceLock } from "./lock.ts";
import { stateFromAssessment, stateFromOutcome, stateFromPatrol, stateFromTone } from "./rules.ts";

const OPEN_STATUSES = new Set(["incomplete", "unavailable", "error", "not_performed", "not_configured"]);

/** A check result worked out on the phone (link, message, call, email, file, app, account, device, internet). */
export function lockFromCheckResult(model: CheckResultModel): EvidenceLock {
  return lockEvidence({
    state: stateFromTone(model.tone),
    subject: model.subject,
    headline: model.headline,
    findings: model.items.filter((i) => !OPEN_STATUSES.has(i.status)).map((i) => ({ text: i.finding, basis: "recorded" as Basis, by: "Apollo" })),
    explanation: model.higginsSays,
    uncertainties: model.items.filter((i) => OPEN_STATUSES.has(i.status)).map((i) => `${i.name}: ${i.finding}`),
    actions: model.whatToDo ? [model.whatToDo] : [],
    blockedBy: null,
  });
}

const BASIS: Record<string, Basis> = { observation: "observed", user_report: "reported", inference: "inferred" };

/** A finished TC FlyBy or Magnum DI result. */
export function lockFromInvestigation(response: HigginsResponse, by: string): EvidenceLock {
  return lockEvidence({
    state: response.outcome ? stateFromOutcome(response.outcome) : stateFromAssessment(response.assessment),
    headline: response.overview,
    findings: (response.findings ?? []).map((f) => ({ text: f.text, basis: BASIS[f.basis] ?? "recorded", confidence: f.confidence ?? null, by })),
    reason: response.attentionReason,
    uncertainties: response.uncertainties ?? [],
    actions: (response.actions ?? []).map((a) => a.instruction || a.label).filter(Boolean),
    how: response.scope,
  });
}

const PROVENANCE: Record<string, Basis> = { observed: "observed", inferred: "inferred", user_reported: "reported" };

/** A Patrol finding, incident or Device Check result handed to Ask Higgins. */
export function lockFromIssue(context: HigginsIssueContext): EvidenceLock {
  return lockEvidence({
    state: stateFromPatrol(context.assessment_state),
    headline: context.issue_summary,
    findings: context.findings.map((f) => ({ text: f.summary, basis: PROVENANCE[f.provenance] ?? "recorded", by: "Apollo" })),
    uncertainties: context.uncertainty,
    actions: (context.available_actions ?? []).map((a) => a.instruction || a.label).filter(Boolean),
  });
}
