import type { ProtectionStatus } from '../security/SecurityPlatformAdapter';

export const OBSERVATION_MAX_AGE_MS = 90_000;
export function freshObservation(p: ProtectionStatus | null, now = Date.now()): boolean {
  const at = p?.lastVerified ? Date.parse(p.lastVerified) : NaN;
  return !!p?.requested && p.operational === true && p.running === true &&
    ['dns_filter', 'content_blocker', 'vpn_service', 'packet_filter', 'network_filter'].includes(p.enforcementMethod) && Number.isFinite(at) && at <= now && now - at <= OBSERVATION_MAX_AGE_MS;
}
export function unavailableObservation(p: ProtectionStatus | null): ProtectionStatus | null {
  return p ? { ...p, operational: false, running: false, lastVerified: null,
    degradedReason: 'Current protection could not be observed. Check permissions and retry.' } : null;
}
export async function boundedObservation<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([operation, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Protection observation timed out')), 8_000);
  })]); } finally { clearTimeout(timer!); }
}