/**
 * Text Guard Pipeline — owns the automatic local-findings consumer.
 *
 * Converts ApolloLocalMessageAnalyzer detections into Patrol events.
 *
 * Extracted from ApolloContext so that the context coordinates application state
 * rather than containing the detailed operational implementation of every Gate.
 *
 * Rules:
 * - Native local findings remain genuine device observations.
 * - Local placeholders are NOT synced to backend (persistEvents, not upsertEvent).
 * - Reconciliation: if a Higgins-projected event already covers this submission, acknowledge.
 *
 * All native module access is injected via deps — this module does not import
 * platform-specific modules directly.
 */
import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import type { PatrolEvent } from "@/src/domain/types";
import { NativeCallFailed } from "@/src/security/nativeDiagnostics";

interface TextGuardLocalFindingsDeps {
  deviceId: string | null;
  eventsRef: React.MutableRefObject<PatrolEvent[]>;
  persistEvents: (events: PatrolEvent[]) => Promise<void>;
  getTextGuardLocalFindings: () => Promise<Array<{
    findingId: string;
    submissionId: string;
    state: string;
    detectedAt: string;
    analyzer: string;
    findings: Array<{ ruleId: string; title: string }>;
  }>>;
  acknowledgeTextGuardLocalFindings: (ids: string[]) => Promise<unknown>;
  /** Called when the device read itself failed, so the gap can be reported rather than hidden. */
  onReadFailure?: (message: string) => void;
}

export function useTextGuardLocalFindings(deps: TextGuardLocalFindingsDeps) {
  const { deviceId, eventsRef, persistEvents, getTextGuardLocalFindings, acknowledgeTextGuardLocalFindings, onReadFailure } = deps;

  useEffect(() => {
    if (Platform.OS !== "android") return;
    let cancelled = false;
    const consumeLocalFindings = async () => {
      try {
        const findings = await getTextGuardLocalFindings();
        if (!findings.length || cancelled) return;
        const acknowledged: string[] = [];
        for (const finding of findings) {
          if (cancelled || !finding?.findingId) continue;
          const eventId = finding.findingId;
          const current = eventsRef.current;
          // Reconciliation: if a Higgins-projected event already covers this submission, acknowledge.
          const higginsAlreadyProjected = current.some((ev) =>
            ev.category === "message" && ev.client_submission_id === finding.submissionId && ev.event_id !== eventId
          );
          if (higginsAlreadyProjected) { acknowledged.push(finding.findingId); continue; }
          if (current.some((ev) => ev.event_id === eventId)) { acknowledged.push(finding.findingId); continue; }
          const ruleReasons = finding.findings.map((f) => `${f.ruleId}: ${f.title}`).slice(0, 6);
          const ev: PatrolEvent = {
            event_id: eventId, device_id: deviceId ?? "local", category: "message" as const,
            status: "active" as const, state: (finding.state as PatrolEvent["state"]) ?? "ears_up",
            indicator_host: null, indicator_digest: null, local_indicator: null,
            verified_block: false, adapter_label: "Text Guard local detection",
            occurred_at: finding.detectedAt ?? new Date().toISOString(), resolved_at: null,
            trust_allowed: false, client_submission_id: finding.submissionId,
            why: ruleReasons.length ? ruleReasons : ["Local analysis detected suspicious patterns."],
            headline: finding.state === "growling" ? "Suspicious message detected" : "Message worth checking",
            what_happened: `Apollo's on-device analyzer (${finding.analyzer}) flagged a message based on pattern rules.`,
            what_to_do: finding.state === "growling" ? "Do not respond to or act on this message until you verify the sender independently." : "Review this message carefully. Verify the sender before responding to any requests.",
          };
          const next = [ev, ...eventsRef.current.filter((x) => x.event_id !== eventId)];
          await persistEvents(next);
          acknowledged.push(finding.findingId);
        }
        if (acknowledged.length > 0) {
          await acknowledgeTextGuardLocalFindings(acknowledged);
        }
      } catch (error) {
        // A failed read of the local findings queue is not "no findings" — say so instead of going quiet.
        if (error instanceof NativeCallFailed) {
          onReadFailure?.("Apollo couldn't read its on-device message findings, so recent texts may not have been assessed. Open Support before relying on automatic text checks.");
        }
      }
    };
    void consumeLocalFindings();
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") void consumeLocalFindings(); });
    return () => { cancelled = true; sub.remove(); };
  }, [deviceId, persistEvents, getTextGuardLocalFindings, acknowledgeTextGuardLocalFindings, onReadFailure]);
}
