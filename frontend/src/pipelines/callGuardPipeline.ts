/**
 * Call Guard Pipeline — owns the automatic call-screening polling loop.
 *
 * Observe → assess (reputation) → act (mark risky if warranted) → record factual result.
 * When a number is flagged, a Magnum DI investigation is started and linked to the Threat Case
 * (see checkNumberRisk in ApolloContext) so the Case has both reputation AND investigation data.
 *
 * Extracted from ApolloContext so that the context coordinates application state
 * rather than containing the detailed operational implementation of every Gate.
 *
 * Rules:
 * - Unknown reputation is NOT a threat (no Patrol event).
 * - Operational queue failures are protection-health issues, NOT security findings.
 * - Only "avoid" (high-risk) auto-blocks the number natively.
 *
 * All native module access is injected via deps — this module does not import
 * platform-specific modules directly.
 */
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

interface CallGuardDeps {
  deviceId: string | null;
  lowPower: boolean;
  checkNumberRisk: (number: string, country?: string, options?: { via?: "screened"; screenedAt?: string | null }) => Promise<{ decision: string; number: string }>;
  getPendingCallLookups: () => Promise<{ status: string; items: Array<{ number: string; seenAtMs: number }>; detail?: string }>;
  acknowledgeCallLookups: (numbers: string[]) => Promise<unknown>;
  retryCallLookups: (numbers: string[]) => Promise<unknown>;
  isTrustedCaller: (number: string) => Promise<boolean>;
  storage: { getItem: (key: string, fallback: string | null) => Promise<string | null> };
}

export function useCallGuardPipeline(deps: CallGuardDeps) {
  const { deviceId, lowPower, checkNumberRisk, getPendingCallLookups, acknowledgeCallLookups, retryCallLookups, isTrustedCaller, storage } = deps;
  const callPollBusy = useRef(false);
  const callPollFailureCount = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (callPollBusy.current) return;
      callPollBusy.current = true;
      try {
        const consent = await storage.getItem("apollo.call.auto_check", null);
        if (consent !== "true") return;

        const lookupResult = await getPendingCallLookups();

        if (lookupResult.status === "unavailable") {
          if (callPollFailureCount.current === 0) {
            console.info("[Call Guard] Native call module unavailable — call monitoring inactive.", lookupResult.detail);
          }
          callPollFailureCount.current = 1;
          return;
        }

        if (lookupResult.status === "error") {
          callPollFailureCount.current += 1;
          console.warn(`[Call Guard] Native queue read failed (attempt ${callPollFailureCount.current}):`, lookupResult.detail);
          // Operational failures are protection-health issues, NOT security findings.
          return;
        }

        callPollFailureCount.current = 0;
        const items = lookupResult.items;
        const acknowledged: string[] = [];
        const failed: string[] = [];

        for (const item of items) {
          if (cancelled || !item?.number) continue;
          const callerTrusted = await isTrustedCaller(item.number);

          // ApolloSG's call screening saw this call arrive — that is the evidence level of the number's case.
          const screened = { via: "screened" as const, screenedAt: item.seenAtMs ? new Date(item.seenAtMs).toISOString() : null };
          try {
            const riskResult = await checkNumberRisk(item.number, undefined, screened);
            acknowledged.push(item.number);
            if (callerTrusted && riskResult && (riskResult.decision === "allow" || riskResult.decision === "unknown")) {
              continue;
            }
            // Unknown reputation = incomplete observation, not a finding. No Patrol event.
            if (riskResult.decision === "unknown") {
              // Acknowledged — number leaves the queue. No event created.
            }
          } catch {
            try {
              await new Promise((r) => setTimeout(r, 2000));
              const retryResult = await checkNumberRisk(item.number, undefined, screened);
              acknowledged.push(item.number);
              if (callerTrusted && retryResult && (retryResult.decision === "allow" || retryResult.decision === "unknown")) continue;
            } catch {
              if (callerTrusted) { acknowledged.push(item.number); continue; }
              failed.push(item.number);
              // Reputation service unavailable is an incomplete observation, not a finding.
            }
          }
        }

        if (acknowledged.length > 0) await acknowledgeCallLookups(acknowledged);
        if (failed.length > 0) await retryCallLookups(failed);
      } finally {
        callPollBusy.current = false;
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), lowPower ? 120000 : 45000);
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") void poll(); });
    return () => { cancelled = true; clearInterval(timer); sub.remove(); };
  }, [checkNumberRisk, lowPower, deviceId, getPendingCallLookups, acknowledgeCallLookups, retryCallLookups, isTrustedCaller, storage]);
}
