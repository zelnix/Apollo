import type { PatrolEvent } from './types';
import { domainOnly, eventHasPacketProof } from './packetEvidence.ts';
import { projectedEventVoice } from './messageVoice.ts';
import { DEVICE_EVIDENCE_SOURCES } from './evidenceModel.ts';

// No arbitrary local narratives, phone numbers, filenames, sender names or quoted content.
export function patrolPayload(e: PatrolEvent, deviceId: string): Record<string, unknown> {
  const proof = eventHasPacketProof(e);
  const state = e.state === 'biting' && !proof ? 'barking' : e.state;
  const voice = projectedEventVoice(e.category, state, proof);
  return {
    event_id: e.event_id, device_id: deviceId, category: e.category, state, status: e.status,
    headline: voice.headline,
    what_happened: voice.whatHappened,
    why: [voice.why],
    what_to_do: voice.whatToDo,
    indicator_host: e.category !== 'call' && domainOnly(e.indicator_host) ? e.indicator_host : null,
    indicator_digest: e.indicator_digest && /^[a-f0-9]{64}$/i.test(e.indicator_digest) ? e.indicator_digest : null,
    verified_block: proof, adapter_label: 'ApolloSG on-device assessment', occurred_at: e.occurred_at,
    resolved_at: e.resolved_at, background: !!e.background, claimed_brand: null,
    scenario: e.scenario && /^[A-Z]{1,3}\d{1,3}[a-z]?$/.test(e.scenario) ? e.scenario : null,
    scent_id: e.scent_id ?? null, enforcement_evidence: proof ? e.enforcement_evidence : null,
    supporting_references: (e.supporting_references ?? []).filter((ref) => ref.url.startsWith('https://') && !/[?#@]/.test(ref.url)).slice(0, 6),
    // Which of this device's own sources supplied the evidence (a fixed label, never content), so the server's copy
    // keeps it exactly. Anything else is left out: the server never records itself as a source.
    evidence_provenance: e.evidence_provenance && DEVICE_EVIDENCE_SOURCES.has(e.evidence_provenance) ? e.evidence_provenance : null,
  };
}