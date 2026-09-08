// Android blocking-proof harness. Drives the frozen public SDK surface only
// (requestPermission("vpn") + startProtection()) and reports each acceptance step honestly.
//
// A step is PASS only when it actually happened. Steps that cannot run in the current
// environment (no native module, placeholder endpoint) are BLOCKED, never faked.
// THREAT_BLOCKED is only ever observed from the SDK event stream - the harness cannot create it.
import { Platform } from "react-native";

import { isGenuineBlockedEvent, type SecurityEvent } from "@/src/contracts/securityEventSchemas";
import { describeFreshProbe, isRecoveredSnapshot, type NativeFreshProbe, probeControlledEndpointFresh, readRecoveryStatus } from "@/src/harness/recoveryDiagnostics";
import { fetchLatestBundle, fetchM1Config, type M1Config, tamperedCopy, toProtectionConfig, unknownKeyCopy } from "@/src/harness/ruleBundleFixtures";
import { GuardDogSecuritySDK } from "@/src/sdk/GuardDogSecuritySDK";

export type StepStatus = "PASS" | "FAIL" | "BLOCKED" | "SKIPPED";

export interface HarnessStep {
  id: string;
  title: string;
  status: StepStatus;
  detail: string;
}

export interface RecoveryEvidence {
  stopRequestedAt: string;
  stateAfterStop: string;
  stateReason: string | null;
  tunOpen: boolean | null;
  selectiveRouteActive: boolean | null;
  vpnTransportPresent: boolean | null;
  httpsStatusAfterStop: number | null;
  recoveredAt: string | null;
}

export interface RevocationEvidence {
  /** How the tester was told to revoke (from outside the app). */
  revokeInstruction: string;
  activeAt: string;
  /** From the bridged PROTECTION_STATE_CHANGED(REVOKED) event; null if the state was only seen by polling. */
  revokeEventId: string | null;
  revokedAt: string | null;
  waitedMs: number;
  stateAfterRevoke: string;
  stateReason: string | null;
  consentGrantedAfterRevoke: boolean | null;
  /** OS-level: VpnService.prepare() returns an intent again (consent must be re-granted). */
  osConsentRequiredAfterRevoke: boolean | null;
  tunOpen: boolean | null;
  selectiveRouteActive: boolean | null;
  dropReporterAttached: boolean | null;
  /** Supporting only: another VPN app may legitimately own the transport after a takeover-revoke. */
  vpnTransportPresent: boolean | null;
  /** startProtection() without fresh consent must be rejected and leave no TUN. */
  restartWithoutConsent: "rejected" | "started" | "not-attempted";
  restartError: string | null;
  httpsStatusAfterRevoke: number | null;
  recoveredAt: string | null;
}

export type ProofMode = "block" | "revoke";

export interface HarnessResult {
  mode: ProofMode;
  steps: HarnessStep[];
  blockedEvent: SecurityEvent | null;
  recovery: RecoveryEvidence | null;
  revocation: RevocationEvidence | null;
  /** Native drop-reporter counters captured before recovery cleared them. */
  enforcementStats: Record<string, number> | null;
  /** Fresh-socket probes of the controlled endpoint (native): before protection, under protection, after stop/revoke. */
  freshProbes: { before: NativeFreshProbe | null; after: NativeFreshProbe | null; afterStop: NativeFreshProbe | null };
  /** Genuine end-to-end block proof reached (block mode only; always false in revoke mode). */
  proofComplete: boolean;
  /** Block proof AND recovery proof both passed (block mode only). */
  recoveryComplete: boolean;
  /** Revoke mode only: system revocation observed, cleanup verified, consent cleared, no silent restart, endpoint reachable again. */
  revokeComplete: boolean;
}

export const PROBE_TIMEOUT_MS = 6000;
export const RECOVERY_TIMEOUT_MS = 20_000;
export const POLL_MS = 1000;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ProbeOutcome {
  reachable: boolean;
  status: number | null;
  detail: string;
  /** Present only when the native fresh-socket probe ran. */
  fresh: NativeFreshProbe | null;
}

/** Fallback HTTPS probe through fetch() for runtimes without the native module (web / Expo Go). */
export async function fetchProbe(url: string): Promise<ProbeOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    // On web a cross-origin probe must be opaque (no-cors): a CORS failure is not evidence of unreachability.
    const res = await fetch(url, { method: "GET", signal: controller.signal, cache: "no-store", headers: { Connection: "close" }, mode: Platform.OS === "web" ? "no-cors" : undefined });
    if (res.type === "opaque") return { reachable: true, status: null, detail: "reachable (opaque cross-origin response)", fresh: null };
    return { reachable: res.status === 200, status: res.status, detail: `HTTP ${res.status}`, fresh: null };
  } catch (e) {
    return { reachable: false, status: null, detail: e instanceof Error ? e.message : "request failed", fresh: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probe of the controlled endpoint. Native: a brand-new TCP socket + TLS + one GET each call (FreshConnectionProbe.kt), so no probe can
 * ever reuse a connection opened before protection became ACTIVE. Only an actual HTTP 200 counts as reachable (DNS + TCP + TLS + HTTP).
 */
export async function probeControlled(config: M1Config): Promise<ProbeOutcome> {
  if (!GuardDogSecuritySDK.nativeAvailable) return fetchProbe(config.controlledEndpoint.url);
  try {
    const p = await probeControlledEndpointFresh(PROBE_TIMEOUT_MS);
    if (!p) return fetchProbe(config.controlledEndpoint.url);
    return { reachable: p.outcome === "ok" && p.httpStatus === 200, status: p.httpStatus, detail: describeFreshProbe(p), fresh: p };
  } catch (e) {
    return { reachable: false, status: null, detail: `fresh probe failed: ${e instanceof Error ? e.message : String(e)}`, fresh: null };
  }
}

function waitForBlockedEvent(timeoutMs: number): Promise<SecurityEvent | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      unsubscribe();
      resolve(null);
    }, timeoutMs);
    const unsubscribe = GuardDogSecuritySDK.onSecurityEvent((event) => {
      if (isGenuineBlockedEvent(event)) {
        clearTimeout(timer);
        unsubscribe();
        resolve(event);
      }
    });
  });
}

export type StepSink = (step: HarnessStep) => void;

export function makeStepSink(onStep?: StepSink): { steps: HarnessStep[]; push: StepSink } {
  const steps: HarnessStep[] = [];
  return {
    steps,
    push: (step) => {
      steps.push(step);
      onStep?.(step);
    },
  };
}

export interface PreludeOutcome {
  config: M1Config;
  before: ProbeOutcome;
  /** All prerequisites met AND protection reached ACTIVE with the /32 route live. */
  ready: boolean;
  activeAt: string | null;
  routeActive: HarnessStep | null;
}

/**
 * Shared opening of every device proof (block + revoke): config → signed bundle → on-device verification (+ negatives) → fresh-socket
 * baseline → consent → startProtection() → settled ACTIVE → live route snapshot. Every step reported honestly; nothing faked.
 */
export async function runProtectionPrelude(push: StepSink, beforeStart?: () => void): Promise<PreludeOutcome> {
  const native = GuardDogSecuritySDK.nativeAvailable;
  const caps = GuardDogSecuritySDK.getCapabilities();

  // 1. config + capability statement
  const config = await fetchM1Config();
  const isPlaceholderEndpoint = config.controlledEndpoint.isPlaceholder;
  GuardDogSecuritySDK.configure(toProtectionConfig(config));
  push({
    id: "config",
    title: "Injected controlled endpoint config",
    status: "PASS",
    detail: `${config.controlledEndpoint.host} -> ${config.controlledEndpoint.ipv4}${isPlaceholderEndpoint ? " (documentation placeholder, not an acceptance target)" : ""}`,
  });

  // 2. backend signed bundle
  const bundle = await fetchLatestBundle(config.rulesetId);
  push({ id: "bundle", title: "Backend served signed bundle", status: "PASS", detail: `v${bundle.bundleVersion} keyId=${bundle.keyId} rules=${bundle.payload.rules.length}` });

  // 3. independent native verification (+ negative fixtures)
  const tampered = GuardDogSecuritySDK.acceptRuleBundle(tamperedCopy(bundle));
  const unknown = GuardDogSecuritySDK.acceptRuleBundle(unknownKeyCopy(bundle));
  const accepted = GuardDogSecuritySDK.acceptRuleBundle(bundle);
  if (accepted.verifiedNatively) {
    const negativesOk = !tampered.accepted && !unknown.accepted;
    push({
      id: "verify",
      title: "Device verified signed envelope (Ed25519/JCS/rollback)",
      status: accepted.accepted && negativesOk ? "PASS" : "FAIL",
      detail: `valid=${accepted.accepted ? "accepted" : accepted.rejectReason}; tampered=${tampered.rejectReason}; unknownKey=${unknown.rejectReason}`,
    });
  } else {
    push({ id: "verify", title: "Device verified signed envelope", status: "BLOCKED", detail: "native verifier unavailable in this runtime (shape check only; nothing trusted)" });
  }

  // 4. reachable before protection (native: fresh socket → TLS → HTTP 200, the same probe used under protection)
  const before = await probeControlled(config);
  push({
    id: "before",
    title: "Controlled endpoint reachable before protection",
    status: before.reachable ? "PASS" : isPlaceholderEndpoint ? "BLOCKED" : "FAIL",
    detail: before.reachable ? before.detail : `${before.detail}${isPlaceholderEndpoint ? " (placeholder host does not exist yet)" : ""}`,
  });

  // 5. consent through the common SDK surface
  const permission = await GuardDogSecuritySDK.requestPermission("vpn");
  push({
    id: "consent",
    title: 'requestPermission("vpn")',
    status: permission === "granted" ? "PASS" : permission === "denied" ? "FAIL" : "BLOCKED",
    detail: native ? permission : `${permission}: ${caps.platform} runtime has no enforcement layer`,
  });

  const notReady = { config, before, ready: false, activeAt: null, routeActive: null };
  if (permission !== "granted" || accepted.accepted !== true || !before.reachable) {
    push({ id: "start", title: "startProtection() selective /32", status: "SKIPPED", detail: "prerequisites not met; nothing started, nothing claimed" });
    return notReady;
  }

  // 6. start protection (DNS/IP binding re-check + /32 route happen natively)
  beforeStart?.();
  let status;
  try {
    status = await GuardDogSecuritySDK.startProtection();
  } catch (e) {
    push({ id: "start", title: "startProtection() selective /32", status: "FAIL", detail: e instanceof Error ? e.message : "start failed" });
    return notReady;
  }
  // startProtection() resolves as soon as the foreground service is dispatched; the DNS/IP binding re-check and the /32 route
  // install happen asynchronously in the service (off the main thread). Wait for a settled lifecycle state instead of judging
  // the instantaneous snapshot (phone run 2537dd7 reached ACTIVE 1 s after the harness had already recorded INACTIVE).
  const startDeadline = Date.now() + 15_000;
  while (status.state !== "ACTIVE" && status.state !== "FAILED" && status.state !== "STOPPED" && status.state !== "REVOKED" && Date.now() < startDeadline) {
    await sleep(250);
    status = GuardDogSecuritySDK.getProtectionState();
  }
  const activeAt = status.state === "ACTIVE" ? new Date().toISOString() : null;
  push({ id: "start", title: "startProtection() selective /32", status: status.state === "ACTIVE" ? "PASS" : "FAIL", detail: `${status.state}${status.reason ? `: ${status.reason}` : ""}` });

  // Live runtime diagnostic while protection runs (harness-only adapter): independent route evidence for auditChain.routeActivation.
  const active = readRecoveryStatus();
  const routeActive: HarnessStep = {
    id: "route-active",
    title: "Selective /32 route active (live runtime snapshot)",
    status: active?.tunOpen && active.selectiveRouteActive ? "PASS" : "FAIL",
    detail: active ? `lifecycle=${active.lifecycle} tunOpen=${active.tunOpen} selectiveRouteActive=${active.selectiveRouteActive} routeCidr=${active.routeCidr ?? "-"}; supporting: osVpnTransportPresent=${active.vpnTransportPresent}` : "no runtime snapshot",
  };
  push(routeActive);
  return { config, before, ready: activeAt !== null && routeActive.status === "PASS", activeAt, routeActive };
}

/** Protected fresh-socket probe: PASS only on the SYN-drop shape to the configured IPv4 (see FreshConnectionProbe.kt). */
export async function probeUnderProtection(config: M1Config, push: StepSink, id: string, title: string): Promise<{ fresh: NativeFreshProbe | null; synDropped: boolean }> {
  const after = await probeControlled(config);
  const afterFresh = after.fresh;
  const synDropped = !!afterFresh && afterFresh.synDropShape && afterFresh.resolvedIpv4 === config.controlledEndpoint.ipv4 && afterFresh.expectedIpv4 === config.controlledEndpoint.ipv4;
  push({
    id,
    title,
    status: synDropped ? "PASS" : "FAIL",
    detail: afterFresh ? after.detail : `native fresh-socket probe unavailable (${after.detail}); fetch() results are not accepted as block evidence`,
  });
  return { fresh: afterFresh, synDropped };
}

export async function runAndroidBlockingProof(onStep?: StepSink): Promise<HarnessResult> {
  const { steps, push } = makeStepSink(onStep);
  // Subscribed before start so nothing can be missed; the window covers the ACTIVE poll (≤15 s) + settle + the 6 s fresh probe.
  let blockedPromise: Promise<SecurityEvent | null> = Promise.resolve(null);
  const prelude = await runProtectionPrelude(push, () => {
    blockedPromise = waitForBlockedEvent(30_000);
  });
  const { config } = prelude;
  const noProbes = { before: prelude.before.fresh, after: null, afterStop: null };
  const failed = (): HarnessResult => ({ mode: "block", steps, blockedEvent: null, recovery: null, revocation: null, enforcementStats: null, freshProbes: noProbes, proofComplete: false, recoveryComplete: false, revokeComplete: false });
  if (prelude.activeAt === null) return failed();

  // 7. a brand-new TCP connect to the configured IPv4 must now time out (SYN dropped in the TUN). Only that shape passes: DNS failure,
  //    another address, refused/unreachable, TLS or HTTP failures are not evidence of enforcement. 8. genuine THREAT_BLOCKED must arrive.
  await sleep(1500);
  const { fresh: afterFresh, synDropped } = await probeUnderProtection(config, push, "after", "Fresh TCP connect to configured IPv4 times out under protection");
  const blockedEvent = await blockedPromise;
  const stats = GuardDogSecuritySDK.getEnforcementStats();
  push({
    id: "blocked",
    title: "THREAT_BLOCKED received with enforcementEvidenceId",
    status: blockedEvent?.enforcementEvidenceId ? "PASS" : "FAIL",
    detail: blockedEvent ? `evidence=${blockedEvent.enforcementEvidenceId} dst=${blockedEvent.destinationIp} rule=${blockedEvent.ruleId}` : `no genuine blocked event${stats ? ` (observed=${stats.observedMatching}, dropped=${stats.droppedMatching})` : ""}`,
  });
  // Native TUN evidence (counts only): a matching packet was actually observed on the TUN and intentionally dropped there.
  const tunEvidence = !!stats && stats.observedMatching > 0 && stats.droppedMatching > 0;
  push({
    id: "tun-evidence",
    title: "Native TUN evidence: matching packet observed and intentionally dropped",
    status: tunEvidence ? "PASS" : "FAIL",
    detail: stats ? Object.entries(stats).map(([k, v]) => `${k}=${v}`).join(" ") : "no drop-reporter stats (reporter not attached)",
  });

  // 9. unrelated traffic unaffected (one retry: a request in flight while the TUN interface comes up is cancelled by the OS)
  let unrelated = await fetchProbe(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/health`);
  if (!unrelated.reachable) {
    await sleep(1000);
    unrelated = await fetchProbe(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/health`);
  }
  push({ id: "unrelated", title: "Unrelated destination still reachable", status: unrelated.reachable ? "PASS" : "FAIL", detail: unrelated.detail });
  const blockSteps = steps.length;
  // Strict: every block step PASS (incl. fresh SYN-drop shape + TUN counters) AND a genuine bridged THREAT_BLOCKED carrying enforcement evidence.
  const proofComplete = steps.every((s) => s.status === "PASS") && !!blockedEvent?.enforcementEvidenceId && synDropped && tunEvidence;

  // 10-13. RECOVERY (always run once protection was started, so the device is left clean)
  const recovery = await runRecovery(config, push);
  const recoveryComplete = proofComplete && steps.slice(blockSteps).every((s) => s.status === "PASS");
  return { mode: "block", steps, blockedEvent, recovery: recovery.evidence, revocation: null, enforcementStats: stats, freshProbes: { before: prelude.before.fresh, after: afterFresh, afterStop: recovery.afterStop }, proofComplete, recoveryComplete, revokeComplete: false };
}

/**
 * Recovery checklist (AC-06): stopProtection() -> TUN descriptor closed -> state INACTIVE/STOPPED
 * -> no Guard Dog selective route -> real HTTPS GET to the controlled endpoint returns 200 again.
 * The OS TRANSPORT_VPN observation is recorded as supporting evidence only; it is never the sole proof.
 * Every value is read from the native runtime, the OS or a real HTTPS response; nothing is inferred.
 */
async function runRecovery(config: M1Config, push: (step: HarnessStep) => void): Promise<{ evidence: RecoveryEvidence; afterStop: NativeFreshProbe | null }> {
  const stopRequestedAt = new Date().toISOString();
  let stopStatus;
  try {
    stopStatus = await GuardDogSecuritySDK.stopProtection();
  } catch (e) {
    push({ id: "stop", title: "stopProtection() -> INACTIVE / STOPPED", status: "FAIL", detail: e instanceof Error ? e.message : "stop failed" });
    return {
      evidence: { stopRequestedAt, stateAfterStop: "UNKNOWN", stateReason: null, tunOpen: null, selectiveRouteActive: null, vpnTransportPresent: null, httpsStatusAfterStop: null, recoveredAt: null },
      afterStop: null,
    };
  }
  // The service handles ACTION_STOP asynchronously: poll the authoritative lifecycle.
  const deadline = Date.now() + RECOVERY_TIMEOUT_MS;
  while (stopStatus.state !== "INACTIVE" && stopStatus.state !== "STOPPED" && Date.now() < deadline) {
    await sleep(250);
    stopStatus = GuardDogSecuritySDK.getProtectionState();
  }
  const stopped = stopStatus.state === "INACTIVE" || stopStatus.state === "STOPPED";
  push({ id: "stop", title: "stopProtection() -> INACTIVE / STOPPED", status: stopped ? "PASS" : "FAIL", detail: `${stopStatus.state}${stopStatus.reason ? `: ${stopStatus.reason}` : ""}` });

  // TUN descriptor closed + no selective route, polled while the service tears the tunnel down.
  // (Harness-only diagnostic adapter; not part of the public SDK surface.)
  let rec = readRecoveryStatus();
  while (rec && !isRecoveredSnapshot(rec) && Date.now() < deadline) {
    await sleep(POLL_MS);
    rec = readRecoveryStatus();
  }
  push({
    id: "tun-closed",
    title: "TUN descriptor closed",
    status: rec ? (rec.tunOpen ? "FAIL" : "PASS") : "BLOCKED",
    detail: rec ? `tunOpen=${rec.tunOpen} dropReporterAttached=${rec.dropReporterAttached} lifecycle=${rec.lifecycle}` : "native recovery status unavailable",
  });
  // Required: our selective route is gone (lifecycle not Running, TUN closed). TRANSPORT_VPN is supporting evidence only.
  push({
    id: "route-cleared",
    title: "No Guard Dog selective VPN route active",
    status: rec ? (!rec.selectiveRouteActive && !rec.tunOpen ? "PASS" : "FAIL") : "BLOCKED",
    detail: rec ? `selectiveRouteActive=${rec.selectiveRouteActive}${rec.routeCidr ? ` route=${rec.routeCidr}` : ""}; supporting: osVpnTransportPresent=${rec.vpnTransportPresent}` : "native recovery status unavailable",
  });

  // Real HTTPS GET over a fresh socket must return 200 again (DNS + TCP + TLS + HTTP), retried while routing settles.
  let again = await probeControlled(config);
  while (again.status !== 200 && Date.now() < deadline) {
    await sleep(POLL_MS);
    again = await probeControlled(config);
  }
  const recoveredAt = again.status === 200 ? new Date().toISOString() : null;
  push({ id: "recovered", title: "Controlled endpoint answers HTTPS 200 again", status: again.status === 200 ? "PASS" : "FAIL", detail: again.detail });

  return {
    evidence: {
      stopRequestedAt,
      stateAfterStop: stopStatus.state,
      stateReason: stopStatus.reason ?? null,
      tunOpen: rec?.tunOpen ?? null,
      selectiveRouteActive: rec?.selectiveRouteActive ?? null,
      vpnTransportPresent: rec?.vpnTransportPresent ?? null,
      httpsStatusAfterStop: again.status,
      recoveredAt,
    },
    afterStop: again.fresh,
  };
}
