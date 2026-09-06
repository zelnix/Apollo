// Android blocking-proof harness. Drives the frozen public SDK surface only
// (requestPermission("vpn") + startProtection()) and reports each acceptance step honestly.
//
// A step is PASS only when it actually happened. Steps that cannot run in the current
// environment (no native module, placeholder endpoint) are BLOCKED, never faked.
// THREAT_BLOCKED is only ever observed from the SDK event stream - the harness cannot create it.
import { isGenuineBlockedEvent, type SecurityEvent } from "@/src/contracts/securityEventSchemas";
import { fetchLatestBundle, fetchM1Config, tamperedCopy, toProtectionConfig, unknownKeyCopy } from "@/src/harness/ruleBundleFixtures";
import { GuardDogSecuritySDK } from "@/src/sdk/GuardDogSecuritySDK";

export type StepStatus = "PASS" | "FAIL" | "BLOCKED" | "SKIPPED";

export interface HarnessStep {
  id: string;
  title: string;
  status: StepStatus;
  detail: string;
}

export interface HarnessResult {
  steps: HarnessStep[];
  blockedEvent: SecurityEvent | null;
  /** Genuine end-to-end proof reached (only possible on a real Android build against the real endpoint). */
  proofComplete: boolean;
}

const PROBE_TIMEOUT_MS = 6000;

async function probe(url: string): Promise<{ reachable: boolean; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "GET", signal: controller.signal, cache: "no-store" });
    return { reachable: true, detail: `HTTP ${res.status}` };
  } catch (e) {
    return { reachable: false, detail: e instanceof Error ? e.message : "request failed" };
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
  const isPlaceholderEndpoint = config.controlledEndpoint.host.endsWith(".example");
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
    return { steps, blockedEvent: null, proofComplete: false };
  }

  // 6. start protection (DNS/IP binding re-check + /32 route happen natively)
  const blockedPromise = waitForBlockedEvent(20_000);
  let status;
  try {
    status = await GuardDogSecuritySDK.startProtection();
  } catch (e) {
    push({ id: "start", title: "startProtection() selective /32", status: "FAIL", detail: e instanceof Error ? e.message : "start failed" });
    return { steps, blockedEvent: null, proofComplete: false };
  }
  push({ id: "start", title: "startProtection() selective /32", status: status.state === "ACTIVE" || status.state === "STARTING" ? "PASS" : "FAIL", detail: `${status.state}${status.reason ? `: ${status.reason}` : ""}` });

  // 7. endpoint must now fail; 8. genuine THREAT_BLOCKED with evidence must arrive
  await new Promise((r) => setTimeout(r, 1500));
  const after = await probe(config.controlledEndpoint.url);
  push({ id: "after", title: "Controlled endpoint request fails under protection", status: after.reachable ? "FAIL" : "PASS", detail: after.detail });
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

  return { steps, blockedEvent, proofComplete: steps.every((s) => s.status === "PASS") && !!blockedEvent };
}
