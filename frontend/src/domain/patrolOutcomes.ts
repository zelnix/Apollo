import { STATE_RANK } from "./stateMachine.ts";
import type { UserAction } from "./userActions.ts";
import type { ApolloState, PatrolEvent } from "./types.ts";

export type PatrolCategory = "site" | "link" | "text" | "call" | "file" | "app" | "network" | "account" | "email" | "device" | "investigation" | "family";
export type PatrolSource = "background" | "user_started" | "higgins" | "family";
export type PatrolFilter = "all_activity" | "needs_you" | "warnings" | "threats_stopped" | "resolved";
export type PatrolState = Exclude<ApolloState, "sniffing">;
export interface PatrolOutcome {
  outcomeId: string; category: PatrolCategory; state: PatrolState; title: string; summary: string; occurredAt: string; source: PatrolSource;
  repeatCount: number; result: string; resultBasis: string; whyThisRating: string[]; primaryAction?: UserAction; secondaryActions: UserAction[]; event: PatrolEvent;
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
const category = (event: PatrolEvent): PatrolCategory => event.investigation_case_id ? "investigation" : event.category === "website" || event.category === "known_threat" || event.category === "protection" ? "site" : event.category === "message" ? "text" : event.category === "connection" ? "network" : event.category === "system" ? "device" : event.category;
const source = (event: PatrolEvent): PatrolSource => event.category === "family" ? "family" : event.investigation_case_id ? "higgins" : event.background ? "background" : "user_started";
const result = (state: PatrolState): string => ({ resting: "Resolved or no concern found", ears_up: "Something changed", growling: "Worth checking", barking: "Action recommended", biting: "Threat stopped" }[state]);
const title = (event: PatrolEvent, state: PatrolState) => state === "biting" ? "Apollo stopped a threat" : event.investigation_case_id ? "Higgins completed an investigation update" : event.headline;
const incidentKey = (event: PatrolEvent, state: PatrolState) => `${category(event)}:${safeKey(event.scent_id || event.investigation_case_id || event.indicator_digest || event.indicator_host || event.claimed_brand || event.scenario || event.event_id)}:${state}`;
const actionFor = (event: PatrolEvent, state: PatrolState): UserAction | undefined => event.investigation_case_id ? { id: "continue_case", label: "Open investigation" } : state === "growling" || state === "barking" ? { id: "start_investigation", label: "Ask Higgins to investigate" } : state === "biting" ? { id: "open_check_it", label: "Review what was stopped" } : undefined;

export function projectPatrolOutcomes(events: PatrolEvent[]): PatrolOutcome[] {
  const sorted = events.filter(isConsumerPatrolEvent).sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
  const outcomes: PatrolOutcome[] = [];
  for (const event of sorted) {
    const state: PatrolState = event.state === "sniffing" ? "ears_up" : event.state === "biting" && !event.verified_block ? "barking" : event.state;
    const key = incidentKey(event, state); const time = Date.parse(event.occurred_at);
    const existing = outcomes.find((outcome) => outcome.outcomeId === key && Math.abs(Date.parse(outcome.occurredAt) - time) <= WINDOW_MS);
    if (!existing) {
      outcomes.push({ outcomeId: key, category: category(event), state, title: title(event, state), summary: event.what_happened, occurredAt: event.occurred_at, source: source(event), repeatCount: 1,
        result: result(state), resultBasis: state === "biting" ? "A verified enforcement record confirms that supported traffic was blocked." : state === "resting" ? "The recorded check was resolved or found no known concern within its scope." : "Apollo recorded a meaningful outcome that may help you decide what to do next.",
        whyThisRating: event.why.slice(0, 4), primaryAction: actionFor(event, state), secondaryActions: [], event });
      continue;
    }
    existing.repeatCount += 1;
    if (STATE_RANK[state] > STATE_RANK[existing.state]) existing.state = state;
  }
  return outcomes;
}

export function matchesPatrolFilter(outcome: PatrolOutcome, filter: PatrolFilter): boolean {
  if (filter === "all_activity") return true;
  if (filter === "needs_you") return !!outcome.primaryAction && (outcome.state === "growling" || outcome.state === "barking");
  if (filter === "warnings") return ["ears_up", "growling", "barking"].includes(outcome.state);
  if (filter === "threats_stopped") return outcome.state === "biting" && outcome.event.verified_block;
  return outcome.state === "resting" || outcome.event.status === "resolved" || outcome.event.status === "trusted";
}