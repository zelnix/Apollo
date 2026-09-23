import type { ApolloState, PatrolEvent, PatrolRecord } from "./types";

const APOLLO_STATE: Record<PatrolRecord["effectiveState"], ApolloState> = {
  safe: "resting", resolved: "resting", monitoring: "ears_up", warning: "growling", danger: "barking", blocked: "biting", unknown: "ears_up",
};

export function patrolRecordToEvent(record: PatrolRecord): PatrolEvent {
  const source = record.event;
  return {
    ...source,
    event_id: record.sourceEventId,
    state: APOLLO_STATE[record.effectiveState],
    headline: record.headline,
    what_happened: record.summary,
    verified_block: record.effectiveState === "blocked" && !!record.observedBlockReference,
    occurred_at: record.occurredAt,
    investigation_case_id: record.investigationCaseId,
    patrol_record: record,
  };
}