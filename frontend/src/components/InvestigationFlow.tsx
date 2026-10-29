// InvestigationFlow — Manages a Magnum DI investigation lifecycle and renders InvestigationView.
// Replaces the old Gate-oriented orchestration. Used standalone (e.g. FirstCheckResult "Ask Higgins")
// or inside InvestigationCheckScreen for full-screen investigation results.
import React, { useEffect, useRef } from "react";
import { View } from "react-native";

import { InvestigationView } from "@/src/components/InvestigationView";
import type { HigginsIssueContext } from "@/src/domain/higginsHandoff";
import { rememberCaseForEvent } from "@/src/investigation/caseIndex";
import { useInvestigation } from "@/src/investigation/caseStore";
import { createCaseInput } from "@/src/investigation/fromContext";
import { saveOriginalSource, type OriginalSourceInput } from "@/src/store/originalSource";
import { spacing } from "@/src/theme";
import { dlog } from "@/src/utils/dlog";

export interface InvestigationFlowProps {
  submissionId: string;
  context: HigginsIssueContext;
  question: string;
  testID: string;
  autoStart?: boolean;
  eventId?: string | null;
  /** An investigation Apollo has ALREADY opened for this exact material (e.g. the case a Gate's
   *  Triage escalation opened on the server). When set, this flow follows that case instead of
   *  starting a second one — one check, one case, one Magnum DI investigation. */
  caseId?: string | null;
  continuityKey?: string;
  onResolved?: (resolved: boolean) => void;
  /** Show the question that opened the case (false when a check opened it — the top card shows the material). */
  openingQuestion?: boolean;
  /** The material exactly as checked (e.g. the number), kept on this device with the case so its top card shows it. */
  original?: OriginalSourceInput | null;
}

export function InvestigationFlow({
  submissionId,
  context,
  question,
  testID,
  autoStart = true,
  eventId,
  caseId,
  continuityKey,
  onResolved,
  openingQuestion,
  original,
}: InvestigationFlowProps) {
  // When a caseId is provided, use it as the stable identity — a re-render with the same caseId
  // must never restart or reattach. Without a caseId, fall back to submissionId.
  const stableIdentity = caseId ?? submissionId;
  const operationId = continuityKey
    ? `${continuityKey}:${submissionId}`
    : submissionId;
  const { state, start, ask, continueWith, retry, cancel, remove, attach } =
    useInvestigation(operationId);
  // Tracks which identity (caseId or submissionId) was already started. A re-render with the
  // same identity is a no-op — attach/start is never called twice for the same case.
  const started = useRef<string | null>(null);
  const renderCount = useRef(0);
  renderCount.current += 1;
  const busy =
    state.phase === "creating" ||
    state.phase === "working" ||
    state.phase === "reconnecting" ||
    state.phase === "waiting_device";

  // ── Diagnostic: log every render with key identifiers ──
  dlog('InvFlow', 'render', { n: renderCount.current, submissionId, caseId, stableIdentity, phase: state.phase, startedRef: started.current, caseDataId: state.caseData?.id });

  // ── Diagnostic: detect remount (started ref is null on mount) ──
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      dlog('InvFlow', 'MOUNT', { submissionId, caseId, stableIdentity });
    }
    return () => { dlog('InvFlow', 'UNMOUNT', { submissionId, caseId, stableIdentity }); };
  }, []);

  // ── Diagnostic: log phase transitions ──
  const prevPhase = useRef(state.phase);
  useEffect(() => {
    if (prevPhase.current !== state.phase) {
      dlog('InvFlow', 'phase', { from: prevPhase.current, to: state.phase, caseDataId: state.caseData?.id });
      prevPhase.current = state.phase;
    }
  });

  useEffect(() => {
    onResolved?.(!!state.response);
  }, [state.response, onResolved]);

  useEffect(() => {
    if (eventId && state.caseData?.id)
      void rememberCaseForEvent(eventId, state.caseData.id);
  }, [eventId, state.caseData?.id]);

  // Kept once per case (saveOriginalSource never overwrites); read through a ref so a re-render's new object
  // never re-runs this.
  const originalRef = useRef(original);
  originalRef.current = original;
  useEffect(() => {
    if (state.caseData?.id && originalRef.current)
      void saveOriginalSource([state.caseData.id], originalRef.current);
  }, [state.caseData?.id]);

  useEffect(() => {
    // Guard: if this identity was already started, a re-render must not restart it.
    if (started.current === stableIdentity) {
      dlog('InvFlow', 'effect SKIP (already started)', { stableIdentity, started: started.current });
      return;
    }
    if (!autoStart) {
      dlog('InvFlow', 'effect SKIP (autoStart=false)');
      return;
    }
    const boundEventId = eventId ?? null;
    if (caseId) {
      dlog('InvFlow', 'ATTACH', { caseId, stableIdentity, submissionId });
      started.current = stableIdentity;
      void attach(caseId).then((opened) => {
        dlog('InvFlow', 'attach resolved', { caseId, opened: !!opened, openedId: opened?.id });
        if (opened && boundEventId) void rememberCaseForEvent(boundEventId, opened.id);
      });
      return;
    }
    const { input, files } = createCaseInput(context, question);
    if (continuityKey && state.caseData) {
      if (busy) {
        dlog('InvFlow', 'effect SKIP (continuity busy)', { phase: state.phase });
        return;
      }
      dlog('InvFlow', 'CONTINUE', { operationId, stableIdentity });
      started.current = stableIdentity;
      void continueWith(input, operationId);
      return;
    }
    dlog('InvFlow', 'START', { operationId, stableIdentity, hasExistingCase: !!state.caseData });
    started.current = stableIdentity;
    const begin =
      state.caseData && state.operationId !== operationId
        ? remove().then(() => start(input, files, operationId))
        : start(input, files, operationId);
    void begin.then((c) => {
      if (c && boundEventId) void rememberCaseForEvent(boundEventId, c.id);
    });
  }, [submissionId, caseId]); // eslint-disable-line

  return (
    <View style={{ gap: spacing.sm }} testID={testID}>
      <InvestigationView
        state={state}
        onAnswer={(a) => void ask(a)}
        onRetry={() => void retry()}
        onCancel={() => void cancel()}
        testID={`${testID}-view`}
        eventId={eventId}
        openingQuestion={openingQuestion}
        onAction={(action, outcome) => {
          if (outcome.kind === "observed")
            void ask(
              `I did "${action.label}". Please re-check using the fresh observation Apollo just recorded.`,
            );
        }}
      />
    </View>
  );
}
