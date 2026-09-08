// Android revoke-proof harness (M1 lifecycle acceptance: VpnService.onRevoke()).
//
// The harness cannot revoke a VPN itself — revocation is an OS action taken by the user from OUTSIDE the app (Settings → VPN →
// Disconnect, or consenting to another VPN app). The harness brings protection to a verified enforcing state, then WAITS and only
// records what the native layer reports afterwards. Nothing is simulated: a STOPPED/FAILED ending is a FAIL, not a revoke.
import type { SecurityEvent } from "@/src/contracts/securityEventSchemas";
import {
  type HarnessResult,
  makeStepSink,
  POLL_MS,
  probeControlled,
  probeUnderProtection,
  RECOVERY_TIMEOUT_MS,
  type RevocationEvidence,
  runProtectionPrelude,
  sleep,
  type StepSink,
} from "@/src/harness/androidBlockingProofHarness";
import { readRecoveryStatus, readVpnConsentRequired } from "@/src/harness/recoveryDiagnostics";
import { GuardDogSecuritySDK } from "@/src/sdk/GuardDogSecuritySDK";

export const REVOKE_WAIT_MS = 180_000;
export const REVOKE_INSTRUCTION =
  "Protection is ACTIVE and enforcing. Now revoke it from OUTSIDE this app: Android Settings → Network & internet → VPN → Apollo Native Gates → Disconnect " +
  "(or connect another VPN app). Do NOT use the in-app Stop button — that would be a stop, not a revoke. Waiting up to 3 minutes.";

const TERMINAL = new Set(["REVOKED", "STOPPED", "FAILED", "INACTIVE"]);

/** Waits for the authoritative native state to leave ACTIVE; also captures the bridged PROTECTION_STATE_CHANGED(REVOKED) event if it arrives. */
async function waitForRevocation(timeoutMs: number): Promise<{ state: string; reason: string | null; event: SecurityEvent | null; waitedMs: number }> {
  const started = Date.now();
  let event: SecurityEvent | null = null;
  const unsubscribe = GuardDogSecuritySDK.onSecurityEvent((e) => {
    if (e.type === "PROTECTION_STATE_CHANGED" && e.protectionState === "REVOKED" && !event) event = e;
  });
  try {
    let status = GuardDogSecuritySDK.getProtectionState();
    while (!TERMINAL.has(status.state) && Date.now() - started < timeoutMs) {
      await sleep(500);
      status = GuardDogSecuritySDK.getProtectionState();
    }
    if (status.state === "REVOKED") await sleep(500); // let the bridged event land
    return { state: status.state, reason: status.reason ?? null, event, waitedMs: Date.now() - started };
  } finally {
    unsubscribe();
  }
}

export async function runAndroidRevokeProof(onStep?: StepSink, onPrompt?: (message: string | null) => void): Promise<HarnessResult> {
  const { steps, push } = makeStepSink(onStep);
  const prelude = await runProtectionPrelude(push);
  const { config } = prelude;
  const base = (revocation: RevocationEvidence | null, after: HarnessResult["freshProbes"]["after"], afterStop: HarnessResult["freshProbes"]["afterStop"]): HarnessResult => ({
    mode: "revoke",
    steps,
    blockedEvent: null,
    recovery: null,
    revocation,
    enforcementStats: null,
    freshProbes: { before: prelude.before.fresh, after, afterStop },
    proofComplete: false,
    recoveryComplete: false,
    revokeComplete: revocation !== null && steps.every((s) => s.status === "PASS"),
  });
  if (prelude.activeAt === null) return base(null, null, null);

  // 7. protection must be genuinely enforcing at the moment of revocation (same SYN-drop shape as the block proof).
  await sleep(1500);
  const enforcing = await probeUnderProtection(config, push, "enforcing", "Enforcing before revoke: fresh TCP connect to configured IPv4 times out");
  const stats = GuardDogSecuritySDK.getEnforcementStats();

  // 8. wait for the OS to revoke. The harness never triggers it and never advances the state itself.
  onPrompt?.(REVOKE_INSTRUCTION);
  const revoked = await waitForRevocation(REVOKE_WAIT_MS);
  onPrompt?.(null);
  const isRevoke = revoked.state === "REVOKED";
  push({
    id: "revoked",
    title: "onRevoke(): system revocation observed (not a stop)",
    status: isRevoke ? "PASS" : "FAIL",
    detail: isRevoke
      ? `state=REVOKED reason="${revoked.reason ?? "-"}" after ${Math.round(revoked.waitedMs / 1000)} s; bridged event=${revoked.event?.id ?? "not received"}${revoked.event ? ` at ${revoked.event.occurredAt}` : ""}`
      : revoked.state === "ACTIVE"
        ? `no revocation observed within ${REVOKE_WAIT_MS / 1000} s (still ACTIVE)`
        : `protection ended as ${revoked.state}${revoked.reason ? ` ("${revoked.reason}")` : ""} — that is not a system revocation`,
  });

  // 9. native cleanup after revoke: TUN closed, reader/reporter detached, no selective route. OS transport is supporting only
  //    (another VPN app may legitimately own it after a takeover-revoke).
  const rec = readRecoveryStatus();
  const cleaned = !!rec && !rec.tunOpen && !rec.dropReporterAttached && !rec.selectiveRouteActive;
  push({
    id: "revoke-cleanup",
    title: "TUN closed and selective route gone after revoke",
    status: cleaned ? "PASS" : "FAIL",
    detail: rec ? `lifecycle=${rec.lifecycle} tunOpen=${rec.tunOpen} dropReporterAttached=${rec.dropReporterAttached} selectiveRouteActive=${rec.selectiveRouteActive}; supporting: osVpnTransportPresent=${rec.vpnTransportPresent}` : "no runtime snapshot",
  });

  // 10. consent cleared at the SDK layer (AC-06: "revoke → REVOKED, consent cleared"). The OS prepared-state (VpnService.prepare() would
  //     return an intent) is recorded as an OBSERVATION only: Android is not documented to clear its consent record on a Settings-side
  //     disconnect, and run 18 showed it keeps it. Apollo's own layer is what refuses to restart (step 11), regardless of the OS record.
  const state = GuardDogSecuritySDK.getProtectionState();
  const osConsentRequired = readVpnConsentRequired();
  const consentCleared = state.consentGranted === false;
  push({
    id: "consent-cleared",
    title: "SDK consent cleared on revoke (consentGranted=false)",
    status: consentCleared ? "PASS" : "FAIL",
    detail: `sdk.consentGranted=${state.consentGranted}; OS prepared-state observation (diagnostic only, not a gate): prepare()!=null=${osConsentRequired ?? "unavailable"}`,
  });

  // 11. no silent restart: startProtection() without fresh consent must be rejected and must not open a TUN.
  let restart: RevocationEvidence["restartWithoutConsent"] = "not-attempted";
  let restartError: string | null = null;
  if (isRevoke) {
    try {
      await GuardDogSecuritySDK.startProtection();
      restart = "started";
    } catch (e) {
      restart = "rejected";
      restartError = e instanceof Error ? e.message : String(e);
    }
    await sleep(1000);
  }
  const afterRestart = GuardDogSecuritySDK.getProtectionState();
  const afterRestartRec = readRecoveryStatus();
  const noSilentRestart = restart === "rejected" && afterRestart.state !== "ACTIVE" && !!afterRestartRec && !afterRestartRec.tunOpen;
  push({
    id: "no-silent-restart",
    title: "startProtection() without fresh consent is rejected (no TUN)",
    status: noSilentRestart ? "PASS" : "FAIL",
    detail: `${restart}${restartError ? `: ${restartError}` : ""}; state=${afterRestart.state} tunOpen=${afterRestartRec?.tunOpen ?? "unknown"}`,
  });

  // 12. endpoint reachable again over a fresh socket.
  const deadline = Date.now() + RECOVERY_TIMEOUT_MS;
  let again = await probeControlled(config);
  while (again.status !== 200 && Date.now() < deadline) {
    await sleep(POLL_MS);
    again = await probeControlled(config);
  }
  const recoveredAt = again.status === 200 ? new Date().toISOString() : null;
  push({ id: "recovered", title: "Controlled endpoint answers HTTPS 200 again", status: again.status === 200 ? "PASS" : "FAIL", detail: again.detail });

  const revocation: RevocationEvidence = {
    revokeInstruction: REVOKE_INSTRUCTION,
    activeAt: prelude.activeAt,
    revokeEventId: revoked.event?.id ?? null,
    revokedAt: revoked.event?.occurredAt ?? null,
    waitedMs: revoked.waitedMs,
    stateAfterRevoke: revoked.state,
    stateReason: revoked.reason,
    consentGrantedAfterRevoke: state.consentGranted,
    osConsentRequiredAfterRevoke: osConsentRequired,
    tunOpen: rec?.tunOpen ?? null,
    selectiveRouteActive: rec?.selectiveRouteActive ?? null,
    dropReporterAttached: rec?.dropReporterAttached ?? null,
    vpnTransportPresent: rec?.vpnTransportPresent ?? null,
    restartWithoutConsent: restart,
    restartError,
    httpsStatusAfterRevoke: again.status,
    recoveredAt,
  };
  const result = base(revocation, enforcing.fresh, again.fresh);
  result.enforcementStats = stats;
  return result;
}
