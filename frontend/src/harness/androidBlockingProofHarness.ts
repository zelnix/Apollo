// Android blocking-proof harness. Drives the frozen public SDK surface only
// (requestPermission("vpn") + startProtection()) and reports each acceptance step honestly.
//
// A step is PASS only when it actually happened. Steps that cannot run in the current
// environment (no native module, placeholder endpoint) are BLOCKED, never faked.
// THREAT_BLOCKED is only ever observed from the SDK event stream - the harness cannot create it.
import { Platform } from "react-native";

import { isGenuineBlockedEvent, type SecurityEvent } from "@/src/contracts/securityEventSchemas";
import { isRecoveredSnapshot, readRecoveryStatus } from "@/src/harness/recoveryDiagnostics";
import { fetchLatestBundle, fetchM1Config, tamperedCopy, toProtectionConfig, unknownKeyCopy } from "@/src/harness/ruleBundleFixtures";
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

export interface HarnessResult {
  steps: HarnessStep[];
  blockedEvent: SecurityEvent | null;
  recovery: RecoveryEvidence | null;
  /** Native drop-reporter counters captured before recovery cleared them. */
  enforcementStats: Record<string, number> | null;
  /** Genuine end-to-end proof reached (only possible on a real Android build against the real endpoint). */
  proofComplete: boolean;
  /** Block proof AND recovery proof both passed. */
  recoveryComplete: boolean;
}

const PROBE_TIMEOUT_MS = 6000;
const RECOVERY_TIMEOUT_MS = 20_000;
const POLL_MS = 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Real HTTPS probe. On native only an actual HTTP 200 counts as reachable (DNS + TCP + TLS + HTTP all recovered). */
async function probe(url: string): Promise<{ reachable: boolean; status: number | null; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    // On web a cross-origin probe must be opaque (no-cors): a CORS failure is not evidence of unreachability.
    const res = await fetch(url, { method: "GET", signal: controller.signal, cache: "no-store", mode: Platform.OS === "web" ? "no-cors" : undefined });
    if (res.type === "opaque") return { reachable: true, status: null, detail: "reachable (opaque cross-origin response)" };
    return { reachable: res.status === 200, status: res.status, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { reachable: false, status: null, detail: e instanceof Error ? e.message : "request failed" };
  } finally {
    clearTimeout(timer);
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

export async function runAndroidBlockingProof(onStep?: (step: HarnessStep) => void): Promise<HarnessResult> {
  const steps: HarnessStep[] = [];
  const push = (step: HarnessStep) => {
    steps.push(step);
    onStep?.(step);
  };
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

  // 4. reachable before protection
  const before = await probe(config.controlledEndpoint.url);
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

  if (permission !== "granted" || accepted.accepted !== true || !before.reachable) {
    push({ id: "start", title: "startProtection() selective /32", status: "SKIPPED", detail: "prerequisites not met; nothing started, nothing claimed" });
    return { steps, blockedEvent: null, recovery: null, enforcementStats: null, proofComplete: false, recoveryComplete: false };
  }

  // 6. start protection (DNS/IP binding re-check + /32 route happen natively)
  const blockedPromise = waitForBlockedEvent(20_000);
  let status;
  try {
    status = await GuardDogSecuritySDK.startProtection();
  } catch (e) {
    push({ id: "start", title: "startProtection() selective /32", status: "FAIL", detail: e instanceof Error ? e.message : "start failed" });
    return { steps, blockedEvent: null, recovery: null, enforcementStats: null, proofComplete: false, recoveryComplete: false };
  }
  push({ id: "start", title: "startProtection() selective /32", status: status.state === "ACTIVE" || status.state === "STARTING" ? "PASS" : "FAIL", detail: `${status.state}${status.reason ? `: ${status.reason}` : ""}` });

  // 7. endpoint must now fail; 8. genuine THREAT_BLOCKED with evidence must arrive
  await sleep(1500);
  const after = await probe(config.controlledEndpoint.url);
  push({ id: "after", title: "Controlled endpoint request fails under protection", status: after.reachable || after.status !== null ? "FAIL" : "PASS", detail: after.detail });
  const blockedEvent = await blockedPromise;
  const stats = GuardDogSecuritySDK.getEnforcementStats();
  push({
    id: "blocked",
    title: "THREAT_BLOCKED received with enforcementEvidenceId",
    status: blockedEvent ? "PASS" : "FAIL",
    detail: blockedEvent ? `evidence=${blockedEvent.enforcementEvidenceId} dst=${blockedEvent.destinationIp} rule=${blockedEvent.ruleId}` : `no genuine blocked event${stats ? ` (observed=${stats.observedMatching}, dropped=${stats.droppedMatching})` : ""}`,
  });

  // 9. unrelated traffic unaffected
  const unrelated = await probe(`${process.env.EXPO_PUBLIC_BACKEND_URL}/api/health`);
  push({ id: "unrelated", title: "Unrelated destination still reachable", status: unrelated.reachable ? "PASS" : "FAIL", detail: unrelated.detail });
  const blockSteps = steps.length;
  const proofComplete = steps.every((s) => s.status === "PASS") && !!blockedEvent;

  // 10-13. RECOVERY (always run once protection was started, so the device is left clean)
  const recovery = await runRecovery(config.controlledEndpoint.url, push);
  const recoveryComplete = proofComplete && steps.slice(blockSteps).every((s) => s.status === "PASS");
  return { steps, blockedEvent, recovery, enforcementStats: stats, proofComplete, recoveryComplete };
}

/**
 * Recovery checklist (AC-06): stopProtection() -> TUN descriptor closed -> state INACTIVE/STOPPED
 * -> no Guard Dog selective route -> real HTTPS GET to the controlled endpoint returns 200 again.
 * The OS TRANSPORT_VPN observation is recorded as supporting evidence only; it is never the sole proof.
 * Every value is read from the native runtime, the OS or a real HTTPS response; nothing is inferred.
 */
async function runRecovery(controlledUrl: string, push: (step: HarnessStep) => void): Promise<RecoveryEvidence> {
  const stopRequestedAt = new Date().toISOString();
  let stopStatus;
  try {
    stopStatus = await GuardDogSecuritySDK.stopProtection();
  } catch (e) {
    push({ id: "stop", title: "stopProtection() -> INACTIVE / STOPPED", status: "FAIL", detail: e instanceof Error ? e.message : "stop failed" });
    return { stopRequestedAt, stateAfterStop: "UNKNOWN", stateReason: null, tunOpen: null, selectiveRouteActive: null, vpnTransportPresent: null, httpsStatusAfterStop: null, recoveredAt: null };
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

  // Real HTTPS GET must return 200 again (DNS + TCP + TLS + HTTP), retried while routing settles.
  let again = await probe(controlledUrl);
  while (again.status !== 200 && Date.now() < deadline) {
    await sleep(POLL_MS);
    again = await probe(controlledUrl);
  }
  const recoveredAt = again.status === 200 ? new Date().toISOString() : null;
  push({ id: "recovered", title: "Controlled endpoint answers HTTPS 200 again", status: again.status === 200 ? "PASS" : "FAIL", detail: again.detail });

  return {
    stopRequestedAt,
    stateAfterStop: stopStatus.state,
    stateReason: stopStatus.reason ?? null,
    tunOpen: rec?.tunOpen ?? null,
    selectiveRouteActive: rec?.selectiveRouteActive ?? null,
    vpnTransportPresent: rec?.vpnTransportPresent ?? null,
    httpsStatusAfterStop: again.status,
    recoveredAt,
  };
}
