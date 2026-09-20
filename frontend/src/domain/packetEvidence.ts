// Consumer policy, deliberately separate from the frozen public SDK contract.
import type { EnforcementEvidence } from '../security/PlatformCapabilityProfile';
import type { PatrolEnforcementEvidence, PatrolEvent } from './types';

export const evidenceToken = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,63}$/.test(v);
export const domainOnly = (v: unknown): v is string => typeof v === 'string' && v.length <= 253 &&
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}$/i.test(v);

export function packetFields(e: PatrolEnforcementEvidence | null | undefined): boolean {
  if (!e || !evidenceToken(e.evidence_id) || !Number.isFinite(Date.parse(e.observed_at))) return false;
  if (Date.parse(e.observed_at) > Date.now() + 60_000) return false;
  if (!['android', 'ios', 'windows', 'macos'].includes(e.platform)) return false;
  if (!['dns_filter', 'vpn_service', 'packet_filter'].includes(e.mechanism)) return false;
  if (e.requested_action !== 'block' || e.enforced_action !== 'blocked' || e.result !== 'verified') return false;
  if (!['inbound', 'outbound'].includes(e.direction) || !['dns', 'tcp', 'udp'].includes(e.protocol)) return false;
  if (!e.matched_rule_id || !/^[a-zA-Z0-9_.:-]{1,253}$/.test(e.matched_rule_id)) return false;
  if (!domainOnly(e.destination_domain)) return false;
  if (!Number.isInteger(e.destination_port) || e.destination_port! < 1 || e.destination_port! > 65535) return false;
  return e.mechanism !== 'dns_filter' || (e.platform === 'android' && e.protocol === 'dns' && e.direction === 'outbound' && e.destination_port === 53);
}

export function isPacketEvidence(e: EnforcementEvidence | null | undefined): boolean {
  if (!e?.destination) return false;
  return packetFields({ evidence_id: e.evidenceId, observed_at: e.observedAt, platform: e.platform,
    mechanism: e.mechanism, requested_action: e.requestedAction, enforced_action: e.enforcedAction,
    result: e.result, direction: e.direction, protocol: e.protocol, matched_rule_id: e.matchedRuleId,
    destination_domain: e.destination.domain, destination_port: e.destination.port } as PatrolEnforcementEvidence);
}

export function eventHasPacketProof(event: PatrolEvent): boolean {
  const e = event.enforcement_evidence;
  return event.category !== 'call' && packetFields(e) && (!e!.event_id || e!.event_id === event.event_id) &&
    (!e!.device_id || e!.device_id === event.device_id) && Date.parse(e!.observed_at) === Date.parse(event.occurred_at);
}

export function normalizeHistoricalEvent(e: PatrolEvent): PatrolEvent {
  if ((e.state === 'biting' || e.verified_block) && !eventHasPacketProof(e)) return {
    ...e, state: 'barking', verified_block: false, status: e.resolved_at ? 'resolved' : 'active', enforcement_evidence: null,
    headline: e.category === 'call' ? 'Call rejection requested' : 'Earlier block claim is not packet-verified',
    what_happened: 'This record does not establish an observed packet drop.',
    why: ['Historical evidence cannot establish current protection.'],
    what_to_do: 'Review the event. Check Gates for current protection.',
  };
  return e;
}