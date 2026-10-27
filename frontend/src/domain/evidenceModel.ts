// Threat Case evidence model — five facts kept apart, none inferred from another (Apollo's origin rule).
//   origin          — `device_id`: the device that detected the case (caseFacts.caseOrigin). Nothing below moves it.
//   evidence source — `evidence_provenance`: what supplied the evidence. Never a server: processing is not a source.
//   processing      — `processing_source`: where Apollo's checks on this record ran.
//   completeness    — `evidence_completeness` + `evidence_gaps`: what is missing, each gap with its recorded reason.
//   representation  — `evidence_representation`: the privacy state of what the record holds.
// Records stored before this model carried `evidence_provenance: "server_projected"` (server processing written as if
// it were the evidence source) or "incomplete" (completeness written as the source). `evidenceModel` reads them into
// the separated model; `withEvidenceModel` rewrites such a stored record once. New records never carry either value.
// Mirror: backend core/evidence_model.py. Pure, no Expo imports.

import type { IncompleteCheck } from "./triage/completeness.ts";
import type { EvidenceCompleteness, EvidenceRepresentation, EvidenceSource, PatrolEvent, ProcessingSource } from "./types";

export const EVIDENCE_SOURCES: ReadonlySet<string> = new Set<EvidenceSource>(
  ["local_device", "dns_observation", "native_protection", "device_submission", "connected_mailbox"]);
/** The sources a device records for itself — the only ones it ever syncs. */
export const DEVICE_EVIDENCE_SOURCES: ReadonlySet<string> = new Set<EvidenceSource>(["local_device", "dns_observation", "native_protection"]);
const PROCESSING: ReadonlySet<string> = new Set<ProcessingSource>(["this_device", "apollosg_servers"]);
const COMPLETENESS: ReadonlySet<string> = new Set<EvidenceCompleteness>(["complete", "partial"]);
const REPRESENTATIONS: ReadonlySet<string> = new Set<EvidenceRepresentation>(["full_record", "privacy_protected_copy", "privacy_summary"]);

/** Adapter labels the server writes: a device's privacy summary, server Triage, a server investigation. */
const SUMMARY_ADAPTER = "ApolloSG on-device assessment";
const TRIAGE_ADAPTER = "Higgins Triage (deterministic)";
const INVESTIGATION_ADAPTER = "Magnum DI investigation";
/** What the packet truth gate wrote when it downgraded a block claim (packetEvidence.normalizeHistoricalEvent). */
const NO_PACKET_DROP = "This record does not establish an observed packet drop.";

export interface EvidenceModel {
  source: EvidenceSource | null;
  processing: ProcessingSource | null;
  completeness: EvidenceCompleteness | null;
  representation: EvidenceRepresentation | null;
  gaps: IncompleteCheck[];
}

/** A stored record, which may still carry a value from before the separated model. */
export type StoredEvent = Omit<PatrolEvent, "evidence_provenance"> & { evidence_provenance?: string | null };

/** The recorded gap when the packet truth gate can't verify a block claim. */
export function blockProofGap(at: string | null): IncompleteCheck {
  return { check: "block_proof", status: "unresolved", failure: "no_packet_evidence", detail: "", source: null, at };
}

/** Whether a server record carries Apollo's findings beyond the privacy summary: a Triage record, an investigation,
 *  a briefing, intake metadata or an evidence profile. Decided by what the record holds, never by where a copy is. */
export function hasServerFindings(e: Pick<PatrolEvent, "triage_investigation" | "investigation_case_id" | "patrol_record" | "case_briefing" | "source_metadata" | "evidence_profile">): boolean {
  return !!(e.triage_investigation || e.investigation_case_id || e.patrol_record?.investigationCaseId
    || e.case_briefing || e.source_metadata || e.evidence_profile);
}

const serverMade = (e: StoredEvent) => e.adapter_label === TRIAGE_ADAPTER || e.adapter_label === INVESTIGATION_ADAPTER;

/** The real evidence source of a record that stored server processing in its place: the mailbox it came from, else
 *  what this device sent (server Triage reads email only from a connected mailbox). A device's own privacy summary
 *  never recorded which of its sources supplied it, so that stays not recorded. */
function legacyServerSource(e: StoredEvent): EvidenceSource | null {
  if (e.adapter_label === SUMMARY_ADAPTER) return null;
  if ((e.source_metadata?.provider ?? "").trim()) return "connected_mailbox";
  if (e.adapter_label === TRIAGE_ADAPTER) return e.category === "email" ? "connected_mailbox" : "device_submission";
  if (serverMade(e) || e.triage_investigation || e.investigation_case_id) return "device_submission";
  return null;
}

export function evidenceModel(e: StoredEvent): EvidenceModel {
  const stored = e.evidence_provenance ?? null;
  const legacyServer = stored === "server_projected";
  const legacyIncomplete = stored === "incomplete";
  const deviceRecorded = !!stored && !legacyServer;  // a source this device recorded, or its legacy "incomplete"
  const source = stored && EVIDENCE_SOURCES.has(stored) ? stored as EvidenceSource : legacyServer ? legacyServerSource(e) : null;
  const processing = e.processing_source && PROCESSING.has(e.processing_source) ? e.processing_source
    : legacyServer ? (e.adapter_label === SUMMARY_ADAPTER ? "this_device" : "apollosg_servers")
      : deviceRecorded ? "this_device" : null;
  const representation = e.evidence_representation && REPRESENTATIONS.has(e.evidence_representation) ? e.evidence_representation
    : legacyServer ? (serverMade(e) || hasServerFindings(e) ? "privacy_protected_copy" : "privacy_summary")
      : deviceRecorded ? "full_record" : null;
  const completeness = e.evidence_completeness && COMPLETENESS.has(e.evidence_completeness) ? e.evidence_completeness
    : legacyIncomplete ? "partial" : null;
  const gaps = e.evidence_gaps ?? (legacyIncomplete && e.what_happened === NO_PACKET_DROP ? [blockProofGap(e.occurred_at)] : []);
  return { source, processing, completeness, representation, gaps };
}

/** A record stored with a pre-model value, rewritten into the separated model once. Anything else is returned as is. */
export function withEvidenceModel(e: StoredEvent): PatrolEvent {
  if (e.evidence_provenance !== "server_projected" && e.evidence_provenance !== "incomplete") return e as PatrolEvent;
  const m = evidenceModel(e);
  return {
    ...e,
    evidence_provenance: m.source ?? undefined,
    processing_source: m.processing ?? undefined,
    evidence_representation: m.representation ?? undefined,
    evidence_completeness: m.completeness ?? undefined,
    evidence_gaps: m.gaps.length ? m.gaps : e.evidence_gaps,
  };
}
