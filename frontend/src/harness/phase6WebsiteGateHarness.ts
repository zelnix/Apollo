// Gate Guard M2.1 Phase 6: guided Website Gate test-runner primitives for the physical-device
// acceptance harness screen (docs/M2_PHASE6_ACCEPTANCE_TEMPLATE.md). Drives ONLY the frozen public
// GuardDogSecuritySDK surface -- this file cannot create, fabricate, or infer a THREAT_BLOCKED; it
// can only observe whatever the SDK's own event stream actually emits, exactly like
// androidBlockingProofHarness.ts does for M1.
import { isGenuineBlockedEvent, type SecurityEvent } from "@/src/contracts/securityEventSchemas";
import { GuardDogSecuritySDK } from "@/src/sdk/GuardDogSecuritySDK";

export const nowIso = () => new Date().toISOString();

/** Subscribes BEFORE `action` runs and resolves with the first genuine THREAT_BLOCKED event seen
 * within `windowMs` of subscribing, or `null` if none arrived. Used for BOTH the positive case
 * (expect an event) and every negative case (expect none) -- the caller decides what a given
 * outcome means; this function only ever reports what the SDK stream actually produced. */
export function observeBlockedEventWindow(
  action: () => Promise<void> | void,
  windowMs: number,
): Promise<{ event: SecurityEvent | null; actionRanAt: string; windowClosedAt: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve({ event: null, actionRanAt, windowClosedAt: nowIso() });
    }, windowMs);
    const unsubscribe = GuardDogSecuritySDK.onSecurityEvent((event) => {
      if (settled) return;
      if (isGenuineBlockedEvent(event)) {
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve({ event, actionRanAt, windowClosedAt: nowIso() });
      }
    });
    const actionRanAt = nowIso();
    void action();
  });
}

export interface FetchTriggerOutcome {
  attemptedUrl: string;
  outcome: "resolved" | "network-error" | "timeout";
  httpStatus: number | null;
  errorMessage: string | null;
}

/** Triggers a real OS-level DNS resolution + connection attempt the same way any ordinary app
 * traffic would -- NOT a synthetic/native-side simulation. If the Website Gate's DNS-triggered
 * sinkhole is genuinely active for this host, this attempt is expected to fail (timeout/network
 * error to the sinkhole address), which is itself part of the evidence, not a bug in this harness. */
export async function triggerDnsViaFetch(host: string, timeoutMs: number): Promise<FetchTriggerOutcome> {
  const url = `https://${host}/`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    return { attemptedUrl: url, outcome: "resolved", httpStatus: res.status, errorMessage: null };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return { attemptedUrl: url, outcome: aborted ? "timeout" : "network-error", httpStatus: null, errorMessage: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

export interface PositiveEnforcementEvidence {
  testDomain: string;
  startedAt: string;
  statusBefore: ReturnType<typeof GuardDogSecuritySDK.getWebsiteGateStatus>;
  dnsQueryTriggeredVia: string;
  fetchOutcome: FetchTriggerOutcome;
  blockedEvent: SecurityEvent | null;
  statusAfter: ReturnType<typeof GuardDogSecuritySDK.getWebsiteGateStatus>;
  enforcementStatsAfter: Record<string, number> | null;
  completedAt: string;
}

/** Group 1 (positive enforcement): triggers a real fetch to `testDomain` (must match a rule in the
 * currently-accepted bundle) and observes whatever the SDK event stream actually produces. Does NOT
 * assert or assume success -- `blockedEvent` is null if nothing arrived within `timeoutMs`, which
 * the caller/tester must then honestly record as FAIL, not silently upgrade to PASS. */
export async function runPositiveEnforcementTest(testDomain: string, timeoutMs: number): Promise<PositiveEnforcementEvidence> {
  const startedAt = nowIso();
  const statusBefore = GuardDogSecuritySDK.getWebsiteGateStatus();
  let fetchOutcome: FetchTriggerOutcome | null = null;
  const { event } = await observeBlockedEventWindow(async () => {
    fetchOutcome = await triggerDnsViaFetch(testDomain, Math.min(timeoutMs, 8000));
  }, timeoutMs);
  return {
    testDomain,
    startedAt,
    statusBefore,
    dnsQueryTriggeredVia: `fetch(https://${testDomain}/) -- ordinary app traffic, not a simulation`,
    fetchOutcome: fetchOutcome ?? { attemptedUrl: `https://${testDomain}/`, outcome: "network-error", httpStatus: null, errorMessage: "fetch did not complete" },
    blockedEvent: event,
    statusAfter: GuardDogSecuritySDK.getWebsiteGateStatus(),
    enforcementStatsAfter: GuardDogSecuritySDK.getEnforcementStats(),
    completedAt: nowIso(),
  };
}

export type NegativeTestKind =
  | "rule-match-alone"
  | "manual-override"
  | "local-analysis-only"
  | "gate-start-alone"
  | "failed-dns-forward";

export interface NegativeTestEvidence {
  kind: NegativeTestKind;
  ranAt: string;
  observedEvent: SecurityEvent | null;
  /** true = correct/expected (no fabricated THREAT_BLOCKED observed). */
  noFabricatedBlock: boolean;
  windowClosedAt: string;
}

/** Group 2 (negative false-Biting): runs `action` (a non-enforcement action that must NEVER by
 * itself produce THREAT_BLOCKED) and reports whether the SDK stream stayed silent. `windowMs`
 * should be generous (>= 5s) so a real but merely SLOW enforcement path isn't mistaken for silence --
 * but a genuine PASS here always means "nothing arrived," never "something arrived and we ignored
 * it." */
export async function runNegativeTest(kind: NegativeTestKind, action: () => Promise<void> | void, windowMs: number): Promise<NegativeTestEvidence> {
  const { event, actionRanAt, windowClosedAt } = await observeBlockedEventWindow(action, windowMs);
  return { kind, ranAt: actionRanAt, observedEvent: event, noFabricatedBlock: event === null, windowClosedAt };
}
