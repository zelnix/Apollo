// Harness-only diagnostic adapter (NOT part of the frozen public GuardDogSecuritySDK surface).
// Reads the native recovery snapshot directly from the bridge for the M1 acceptance proof.
// Production app code must not import this file.
import { GuardDogNative, type NativeFreshProbe, type NativeRecoveryStatus } from "@/src/sdk/nativeModule";

export type { NativeFreshProbe, NativeRecoveryStatus };

export function readRecoveryStatus(): NativeRecoveryStatus | null {
  return GuardDogNative?.getRecoveryStatus() ?? null;
}

/**
 * Fresh-socket probe of the configured controlled endpoint (native only; null when the bridge is absent). Every call opens a brand-new
 * TCP socket in the native layer, so a probe issued after protection became ACTIVE cannot reuse any earlier connection.
 */
export async function probeControlledEndpointFresh(timeoutMs: number): Promise<NativeFreshProbe | null> {
  if (!GuardDogNative) return null;
  return GuardDogNative.probeControlledEndpointFresh(timeoutMs);
}

export function describeFreshProbe(p: NativeFreshProbe): string {
  return `fresh socket: phase=${p.phase} outcome=${p.outcome}${p.httpStatus !== null ? ` HTTP ${p.httpStatus}` : ""} resolved=${p.resolvedIpv4 ?? "-"} (${p.elapsedMs} ms) — ${p.detail}`;
}

/**
 * Required recovery evidence: TUN descriptor closed, no selective route active, drop reporter detached.
 * The OS TRANSPORT_VPN observation is supporting evidence only (another VPN app could be present) and
 * the real HTTPS 200 re-check is performed by the harness itself.
 */
export function isRecoveredSnapshot(s: NativeRecoveryStatus): boolean {
  return !s.tunOpen && !s.selectiveRouteActive && !s.dropReporterAttached;
}
