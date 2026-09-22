import * as Crypto from "expo-crypto";

import { redactInvestigationSecrets as redactUserSecrets } from "./privacy";
import { handoffFingerprint, reserveHandoff } from "./handoffDedupe";
import { storeHandoff } from './handoffTransfer';
import type { ApolloState, EventCategory, PatrolEvent } from "./types";

export type HigginsGate = "site" | "link" | "text" | "call" | "network" | "account" | "email" | "app" | "file" | "device" | "incident";
export type HigginsProvenance = "observed" | "inferred" | "user_reported";
export type HigginsFindingStatus = "confirmed" | "warning" | "uncertain";

export interface HigginsIssueFinding {
  summary: string;
  provenance: HigginsProvenance;
  status: HigginsFindingStatus;
}

export interface HigginsAvailableAction {
  label: string;
  instruction: string;
}

/** Original submitted evidence carried whole (secret-redacted only, never sliced) into the shared investigation case. */
export type HigginsOriginalEvidence =
  | { kind: "text" | "url"; value: string; label?: string }
  | { kind: "file"; uri: string; name: string; mediaType: string; size?: number };

export interface HigginsIssueContext {
  gate: HigginsGate;
  issue_summary: string;
  assessment_state: ApolloState | "unknown";
  findings: HigginsIssueFinding[];
  uncertainty: string[];
  confirmed_protective_actions: string[];
  user_reported_actions: string[];
  available_actions?: HigginsAvailableAction[];
  original_evidence?: HigginsOriginalEvidence[];
  case_id?: string; // continue this shared investigation case instead of opening a new one
  event_id?: string; // Patrol issue this case belongs to
}

const recent = new Map<string, number>();

function protectedValues(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => redactUserSecrets(value).trim()).filter(Boolean);
}

export function issueContext(input: HigginsIssueContext): HigginsIssueContext {
  return {
    gate: input.gate,
    issue_summary: redactUserSecrets(input.issue_summary).trim(),
    assessment_state: input.assessment_state,
    findings: input.findings.map((finding) => ({
      summary: redactUserSecrets(finding.summary).trim(),
      provenance: finding.provenance,
      status: finding.status,
    })).filter((finding) => finding.summary),
    uncertainty: protectedValues(input.uncertainty),
    confirmed_protective_actions: protectedValues(input.confirmed_protective_actions),
    user_reported_actions: protectedValues(input.user_reported_actions),
    available_actions: (input.available_actions ?? []).map((action) => ({
      label: redactUserSecrets(action.label).trim(),
      instruction: redactUserSecrets(action.instruction).trim(),
    })).filter((action) => action.label && action.instruction),
    case_id: typeof input.case_id === "string" && input.case_id ? input.case_id : undefined,
    event_id: typeof input.event_id === "string" && input.event_id ? input.event_id : undefined,
    original_evidence: (input.original_evidence ?? []).map((item) => item.kind === "file" ? item : ({ kind: item.kind, value: redactUserSecrets(item.value).trim(), label: item.label })).filter((item) => item.kind === "file" ? !!item.uri : !!item.value),
  };
}

export function parseHigginsIssueContext(raw: string): HigginsIssueContext | null {
  try {
    const value = JSON.parse(raw) as Partial<HigginsIssueContext>;
    const gates: HigginsGate[] = ["site", "link", "text", "call", "network", "account", "email", "app", "file", "device", "incident"];
    const states = ["sniffing", "resting", "ears_up", "growling", "barking", "biting", "unknown"];
    if (!value || !gates.includes(value.gate as HigginsGate) || !states.includes(String(value.assessment_state)) || typeof value.issue_summary !== "string" || !Array.isArray(value.findings) || !Array.isArray(value.uncertainty) || !Array.isArray(value.confirmed_protective_actions) || !Array.isArray(value.user_reported_actions)) return null;
    if (value.findings.some((finding) => !finding || typeof finding.summary !== "string" || !["observed", "inferred", "user_reported"].includes(finding.provenance) || !["confirmed", "warning", "uncertain"].includes(finding.status))) return null;
    if (value.case_id != null && typeof value.case_id !== "string") return null;
    if (value.event_id != null && typeof value.event_id !== "string") return null;
    if (value.original_evidence != null && (!Array.isArray(value.original_evidence) || value.original_evidence.some((item) => !item || !["text", "url", "file"].includes(item.kind) || (item.kind === "file" ? typeof item.uri !== "string" : typeof item.value !== "string")))) return null;
    if (value.available_actions != null && (!Array.isArray(value.available_actions) || value.available_actions.some((action) => !action || typeof action.label !== "string" || typeof action.instruction !== "string"))) return null;
    return issueContext(value as HigginsIssueContext);
  } catch { return null; }
}

export function contextFromEvent(event: PatrolEvent, gate: HigginsGate, summary = event.headline): HigginsIssueContext {
  return issueContext({
    gate,
    issue_summary: summary,
    assessment_state: event.state,
    findings: [
      { summary: event.what_happened, provenance: event.verified_block ? "observed" : "inferred", status: event.verified_block ? "confirmed" : event.state === "barking" ? "warning" : "uncertain" },
      ...event.why.map((reason) => ({ summary: reason, provenance: "inferred" as const, status: "uncertain" as const })),
    ],
    uncertainty: event.verified_block ? [] : ["No protective block was confirmed for this issue."],
    confirmed_protective_actions: event.verified_block ? ["Apollo confirmed an on-device protective block."] : [],
    user_reported_actions: event.recovery_kinds ?? [],
    available_actions: [{ label: "Use the next action on this result", instruction: event.what_to_do }],
    event_id: event.event_id,
  });
}

export function gateForCategory(category: EventCategory): HigginsGate {
  if (category === "message") return "text";
  if (category === "connection") return "network";
  if (category === "known_threat" || category === "website") return "link";
  if (category === "protection" || category === "system") return "device";
  return category;
}

/** One dispatcher for issue-specific Higgins actions. It deduplicates rapid taps before navigation. */
export function openHigginsHandoff(router: { push: (href: never) => void }, context: HigginsIssueContext, question: string): string | null {
  const safe = issueContext(context);
  const cleanQuestion = redactUserSecrets(question).trim();  // never sliced: the question is part of the evidence
  if (!safe.issue_summary || (!cleanQuestion && !safe.case_id)) return null;  // continuing an existing case needs no new question
  const fingerprint = handoffFingerprint(safe.gate, safe.issue_summary, safe.findings, cleanQuestion || `case:${safe.case_id}`);
  const now = Date.now();
  if (!reserveHandoff(recent, fingerprint, now)) return null;
  const handoffId = Crypto.randomUUID();
  storeHandoff(handoffId, safe, cleanQuestion);
  router.push({ pathname: "/(tabs)/ask", params: { handoffId } } as never);
  return handoffId;
}