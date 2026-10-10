/**
 * Pure, testable event merge — reconciles local events with server records.
 *
 * This is the SINGLE function that determines the outcome of local + remote synchronisation.
 * It is imported by ApolloContext (production) and by regression tests (verification).
 *
 * Rules:
 * 1. Local content wins on the originating device (evidence_provenance === "local_device").
 * 2. Server metadata is absorbed (patrol_record, investigation_case_id, etc.).
 * 3. Resolved/trusted events are never reopened unless the server carries genuinely new evidence
 *    (new enforcement_evidence.evidence_id not previously seen on this event).
 * 4. Events from other devices (no local version) take server data as-is.
 */
import type { PatrolEvent } from "./types";
import { STATE_RANK } from "./stateMachine";

export interface MergeResult {
  events: PatrolEvent[];
  /** Event IDs that were superseded (local placeholder replaced by projected version). */
  superseded: string[];
}

export function mergeLocalAndRemoteEvents(
  localEvents: PatrolEvent[],
  remoteEvents: PatrolEvent[],
): MergeResult {
  const remoteById = new Map(remoteEvents.map((e) => [e.event_id, e]));
  const remoteBySubmission = new Map<string, string>();
  for (const re of remoteEvents) {
    if (re.client_submission_id) remoteBySubmission.set(re.client_submission_id, re.event_id);
  }
  const localById = new Map(localEvents.map((e) => [e.event_id, e]));

  const merged: PatrolEvent[] = [];
  const mergedIds = new Set<string>();
  const superseded: string[] = [];

  // 1. Iterate remote events. For each, blend with local or take as-is.
  for (const remote of remoteEvents) {
    const local = localById.get(remote.event_id);
    if (local) {
      // Originating device: local content WINS. Absorb only server metadata.
      const localIsDetailed = local.evidence_provenance === "local_device";

      // Lifecycle guard: local resolution is preserved unless genuinely new evidence exists.
      const localResolved = local.status === "resolved" || local.status === "trusted" || !!local.resolved_at;
      // Reopening requires genuinely new evidence observed AFTER the resolution time.
      // Two pathways:
      //
      // Pathway 1 — Enforcement: Different evidence_id with observed_at > resolved_at
      // (a fresh native block was observed for this event).
      //
      // Pathway 2 — Detection: The server sets detection_updated_at > resolved_at
      // (genuinely new detection evidence — new scan, new indicator, new threat intelligence —
      // without requiring a native block).
      //
      // Without either, the local resolution is preserved.
      const localEvidenceId = local.enforcement_evidence?.evidence_id;
      const remoteEvidenceId = remote.enforcement_evidence?.evidence_id;
      const remoteObservedAt = remote.enforcement_evidence?.observed_at;
      const localResolvedAt = local.resolved_at;
      const isDifferentEvidence = !!remoteEvidenceId && remoteEvidenceId !== localEvidenceId;
      const isObservedAfterHandling = !!remoteObservedAt && !!localResolvedAt
        && Date.parse(remoteObservedAt) > Date.parse(localResolvedAt);
      const hasNewEnforcementEvidence = isDifferentEvidence && isObservedAfterHandling;

      // Pathway 2: detection-only reopening
      const detectionUpdated = remote.detection_updated_at;
      const isDetectionAfterHandling = !!detectionUpdated && !!localResolvedAt
        && Date.parse(detectionUpdated) > Date.parse(localResolvedAt);
      const hasNewDetectionEvidence = isDetectionAfterHandling;

      const hasNewEvidence = hasNewEnforcementEvidence || hasNewDetectionEvidence;
      const preserveResolution = localResolved && !hasNewEvidence;

      merged.push({
        ...local,
        // Preserve detailed local findings — never overwrite with privacy-projected server text.
        headline: localIsDetailed ? local.headline : remote.headline,
        what_happened: localIsDetailed ? local.what_happened : remote.what_happened,
        why: localIsDetailed ? local.why : remote.why,
        what_to_do: localIsDetailed ? local.what_to_do : remote.what_to_do,
        // Keep local-only fields.
        local_indicator: local.local_indicator ?? remote.local_indicator,
        claimed_brand: local.claimed_brand ?? remote.claimed_brand,
        scenario: local.scenario ?? remote.scenario,
        evidence_provenance: localIsDetailed ? "local_device" : (remote.evidence_provenance ?? "server_projected"),
        // Absorb server lifecycle metadata.
        patrol_record: remote.patrol_record ?? local.patrol_record,
        investigation_case_id: remote.investigation_case_id ?? local.investigation_case_id,
        client_submission_id: remote.client_submission_id ?? local.client_submission_id,
        // Lifecycle: preserve local resolution unless genuinely new evidence.
        status: preserveResolution ? local.status : remote.status,
        state: preserveResolution ? local.state : (STATE_RANK[remote.state] > STATE_RANK[local.state] ? remote.state : local.state),
        resolved_at: preserveResolution ? local.resolved_at : (hasNewEvidence ? null : (remote.resolved_at ?? local.resolved_at)),
        verified_block: remote.verified_block || local.verified_block,
        enforcement_evidence: remote.enforcement_evidence ?? local.enforcement_evidence,
        supporting_references: (local.supporting_references?.length ? local.supporting_references : remote.supporting_references),
      });
    } else {
      // No local version — from another device or post-reinstall. Take server as-is.
      merged.push(remote);
    }
    mergedIds.add(remote.event_id);
  }

  // 2. Add local-only events (not on server yet, or superseded placeholders).
  for (const local of localEvents) {
    if (mergedIds.has(local.event_id)) continue;
    // Drop local placeholder superseded by projected version.
    if (local.client_submission_id && remoteBySubmission.has(local.client_submission_id) && local.event_id !== remoteBySubmission.get(local.client_submission_id)) {
      superseded.push(local.event_id);
      continue;
    }
    merged.push(local);
    mergedIds.add(local.event_id);
  }

  // Sort newest first.
  merged.sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));

  return { events: merged, superseded };
}
