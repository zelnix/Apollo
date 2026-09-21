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

export interface HigginsIssueContext {
  gate: HigginsGate;
  issue_summary: string;
  assessment_state: ApolloState | "unknown";
  findings: HigginsIssueFinding[];
  uncertainty: string[];
  confirmed_protective_actions: string[];
  user_reported_actions: string[];
  available_actions?: HigginsAvailableAction[];
}

const recent = new Map<string, number>();

function bounded(values: string[] | undefined, limit: number, chars: number): string[] {
  return (values ?? []).map((value) => redactUserSecrets(value).trim().slice(0, chars)).filter(Boolean).slice(0, limit);
}

export function issueContext(input: HigginsIssueContext): HigginsIssueContext {
  return {
    gate: input.gate,
    issue_summary: redactUserSecrets(input.issue_summary).trim().slice(0, 240),
    assessment_state: input.assessment_state,
    findings: input.findings.slice(0, 8).map((finding) => ({
      summary: redactUserSecrets(finding.summary).trim().slice(0, 180),
      provenance: finding.provenance,
      status: finding.status,
    })).filter((finding) => finding.summary),
    uncertainty: bounded(input.uncertainty, 6, 180),
    confirmed_protective_actions: bounded(input.confirmed_protective_actions, 4, 180),
    user_reported_actions: bounded(input.user_reported_actions, 6, 180),
    available_actions: (input.available_actions ?? []).map((action) => ({
      label: redactUserSecrets(action.label).trim().slice(0, 80),
      instruction: redactUserSecrets(action.instruction).trim().slice(0, 240),
    })).filter((action) => action.label && action.instruction).slice(0, 4),
  };
}

export function parseHigginsIssueContext(raw: string): HigginsIssueContext | null {
  try {
    const value = JSON.parse(raw) as Partial<HigginsIssueContext>;
    const gates: HigginsGate[] = ["site", "link", "text", "call", "network", "account", "email", "app", "file", "device", "incident"];
    const states = ["sniffing", "resting", "ears_up", "growling", "barking", "biting", "unknown"];
    if (!value || !gates.includes(value.gate as HigginsGate) || !states.includes(String(value.assessment_state)) || typeof value.issue_summary !== "string" || !Array.isArray(value.findings) || !Array.isArray(value.uncertainty) || !Array.isArray(value.confirmed_protective_actions) || !Array.isArray(value.user_reported_actions)) return null;
    if (value.findings.some((finding) => !finding || typeof finding.summary !== "string" || !["observed", "inferred", "user_reported"].includes(finding.provenance) || !["confirmed", "warning", "uncertain"].includes(finding.status))) return null;
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
      ...event.why.slice(0, 5).map((reason) => ({ summary: reason, provenance: "inferred" as const, status: "uncertain" as const })),
    ],
    uncertainty: event.verified_block ? [] : ["No protective block was confirmed for this issue."],
    confirmed_protective_actions: event.verified_block ? ["Apollo confirmed an on-device protective block."] : [],
    user_reported_actions: event.recovery_kinds ?? [],
    available_actions: [{ label: "Use the next action on this result", instruction: event.what_to_do }],
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
  const cleanQuestion = redactUserSecrets(question).trim().slice(0, 500);
  if (!safe.issue_summary || !cleanQuestion) return null;
  const fingerprint = handoffFingerprint(safe.gate, safe.issue_summary, safe.findings, cleanQuestion);
  const now = Date.now();
  if (!reserveHandoff(recent, fingerprint, now)) return null;
  const handoffId = Crypto.randomUUID();
  storeHandoff(handoffId, safe, cleanQuestion);
  router.push({ pathname: "/(tabs)/ask", params: { handoffId } } as never);
  return handoffId;
}