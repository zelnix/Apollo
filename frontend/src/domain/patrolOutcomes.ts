import { STATE_RANK } from "./stateMachine";
import type { ApolloState, PatrolEvent } from "./types";

export type PatrolOutcomeKind = "website_protected" | "suspicious_message" | "risky_file_checked" | "unsafe_app_setting" | "network_danger" | "account_recovery" | "family_update" | "investigation_outcome" | "check_outcome";
export type PatrolOutcomeStatus = "needs_you" | "handled";
export interface PatrolOutcome {
  id: string; kind: PatrolOutcomeKind; status: PatrolOutcomeStatus; state: ApolloState; headline: string; summary: string; nextAction: string;
  repeatCount: number; firstOccurredAt: string; latestOccurredAt: string; event: PatrolEvent;
}

const WINDOW_MS = 4 * 60 * 60 * 1000;
const COMMAND_TEXT = /\b(requested|request submitted|queue|worker|retry|heartbeat|diagnostic|command)\b/i;
const safeKey = (value: string | null | undefined) => (value ?? "").toLowerCase().replace(/[^a-z0-9.-]/g, "").slice(0, 160);

export function isConsumerPatrolEvent(event: PatrolEvent): boolean {
  if (event.category === "system") return false;
  if (event.category === "protection" && (COMMAND_TEXT.test(event.headline) || COMMAND_TEXT.test(event.what_happened))) return false;
  if (COMMAND_TEXT.test(event.headline) && !event.verified_block) return false;
  return !!event.headline.trim() && !!event.what_happened.trim();
}

function kindFor(event: PatrolEvent): PatrolOutcomeKind {
  if (event.scenario === "shared_investigation" || event.investigation_case_id) return "investigation_outcome";
  if ((event.category === "website" || event.category === "known_threat") && event.verified_block) return "website_protected";
  if (event.category === "message" || event.category === "email" || event.category === "call") return "suspicious_message";
  if (event.category === "connection") return "network_danger";
  if (event.category === "account") return "account_recovery";
  if (event.category === "app" || event.category === "device") return "unsafe_app_setting";
  if (event.category === "family") return "family_update";
  if (event.category === "file") return "risky_file_checked";
  return "check_outcome";
}

function headlineFor(kind: PatrolOutcomeKind, event: PatrolEvent): string {
  if (kind === "website_protected") return "A website threat was blocked";
  if (kind === "suspicious_message") return event.category === "call" ? "A suspicious call was noticed" : event.category === "email" ? "A suspicious email was noticed" : "A suspicious message was noticed";
  if (kind === "risky_file_checked") return "A risky file was checked";
  if (kind === "unsafe_app_setting") return event.category === "app" ? "An unsafe app setting was found" : "A device setting needs a look";
  if (kind === "network_danger") return "A network danger was noticed";
  if (kind === "account_recovery") return "An account recovery step was recommended";
  if (kind === "family_update") return "A family safety update arrived";
  if (kind === "investigation_outcome") return "Higgins completed an investigation update";
  return event.state === "resting" ? "A check found no known concern" : event.headline;
}

function statusFor(event: PatrolEvent): PatrolOutcomeStatus {
  if (event.status === "resolved" || event.status === "trusted" || (event.status === "blocked" && !!event.resolved_at)) return "handled";
  return event.state === "resting" ? "handled" : "needs_you";
}

function incidentKey(event: PatrolEvent, kind: PatrolOutcomeKind): string {
  const identity = event.scent_id || event.investigation_case_id || event.indicator_digest || event.indicator_host || event.claimed_brand || event.scenario;
  return identity ? `${kind}:${safeKey(identity)}:${statusFor(event)}` : `${kind}:event:${event.event_id}`;
}

export function projectPatrolOutcomes(events: PatrolEvent[]): PatrolOutcome[] {
  const sorted = events.filter(isConsumerPatrolEvent).sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
  const outcomes: PatrolOutcome[] = [];
  for (const event of sorted) {
    const kind = kindFor(event); const key = incidentKey(event, kind); const time = Date.parse(event.occurred_at);
    const existing = outcomes.find((outcome) => outcome.id === key && Math.abs(Date.parse(outcome.latestOccurredAt) - time) <= WINDOW_MS);
    if (!existing) {
      outcomes.push({ id: key, kind, status: statusFor(event), state: event.state, headline: headlineFor(kind, event), summary: event.what_happened, nextAction: event.what_to_do,
        repeatCount: 1, firstOccurredAt: event.occurred_at, latestOccurredAt: event.occurred_at, event });
      continue;
    }
    existing.repeatCount += 1;
    if (time < Date.parse(existing.firstOccurredAt)) existing.firstOccurredAt = event.occurred_at;
    if (STATE_RANK[event.state] > STATE_RANK[existing.state]) existing.state = event.state;
  }
  return outcomes.sort((a, b) => Date.parse(b.latestOccurredAt) - Date.parse(a.latestOccurredAt));
}