import type { PatrolEvent } from './types';
import { domainOnly, eventHasPacketProof } from './packetEvidence.ts';

// No arbitrary local narratives, phone numbers, filenames, sender names or quoted content.
export function patrolPayload(e: PatrolEvent, deviceId: string): Record<string, unknown> {
  const proof = eventHasPacketProof(e);
  const state = e.state === 'biting' && !proof ? 'barking' : e.state;
  return {
    event_id: e.event_id, device_id: deviceId, category: e.category, state, status: e.status,
    headline: proof ? 'Apollo observed a blocked connection' : `Apollo recorded a ${e.category} check`,
    what_happened: proof ? 'An observed packet was intentionally blocked by the on-device filter.' : `The on-device assessment reported ${state}. Details stay on the device.`,
    why: [proof ? 'Packet-backed enforcement evidence is attached.' : 'Only a minimal security summary is shared.'],
    what_to_do: state === 'barking' ? 'Avoid the suspicious interaction. Review the original alert on your phone.' : 'Review the original alert on your phone. A past check does not establish current safety.',
    indicator_host: e.category !== 'call' && domainOnly(e.indicator_host) ? e.indicator_host : null,
    indicator_digest: e.indicator_digest && /^[a-f0-9]{64}$/i.test(e.indicator_digest) ? e.indicator_digest : null,
    verified_block: proof, adapter_label: 'Apollo on-device assessment', occurred_at: e.occurred_at,
    resolved_at: e.resolved_at, background: !!e.background, claimed_brand: null,
    scenario: e.scenario && /^[A-Z]{1,3}\d{1,3}[a-z]?$/.test(e.scenario) ? e.scenario : null,
    scent_id: e.scent_id ?? null, enforcement_evidence: proof ? e.enforcement_evidence : null,
    supporting_references: (e.supporting_references ?? []).filter((ref) => ref.url.startsWith('https://') && !/[?#@]/.test(ref.url)).slice(0, 6),
  };
}