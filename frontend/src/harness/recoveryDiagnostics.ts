// Harness-only diagnostic adapter (NOT part of the frozen public GuardDogSecuritySDK surface).
// Reads the native recovery snapshot directly from the bridge for the M1 acceptance proof.
// Production app code must not import this file.
import { GuardDogNative, type NativeRecoveryStatus } from "@/src/sdk/nativeModule";

export type { NativeRecoveryStatus };

export function readRecoveryStatus(): NativeRecoveryStatus | null {
  return GuardDogNative?.getRecoveryStatus() ?? null;
}

/**
 * Required recovery evidence: TUN descriptor closed, no selective route active, drop reporter detached.
 * The OS TRANSPORT_VPN observation is supporting evidence only (another VPN app could be present) and
 * the real HTTPS 200 re-check is performed by the harness itself.
 */
export function isRecoveredSnapshot(s: NativeRecoveryStatus): boolean {
  return !s.tunOpen && !s.selectiveRouteActive && !s.dropReporterAttached;
}
