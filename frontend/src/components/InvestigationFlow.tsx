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
import { spacing } from "@/src/theme";

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
}: InvestigationFlowProps) {
  const operationId = continuityKey
    ? `${continuityKey}:${submissionId}`
    : submissionId;
  const { state, start, ask, continueWith, retry, cancel, remove, attach } =
    useInvestigation(operationId);
  const started = useRef<string | null>(null);
  const busy =
    state.phase === "creating" ||
    state.phase === "working" ||
    state.phase === "reconnecting" ||
    state.phase === "waiting_device";

  useEffect(() => {
    onResolved?.(!!state.response);
  }, [state.response, onResolved]);

  useEffect(() => {
    if (eventId && state.caseData?.id)
      void rememberCaseForEvent(eventId, state.caseData.id);
  }, [eventId, state.caseData?.id]);

  useEffect(() => {
    if (started.current === submissionId) return;
    if (!autoStart) return;
    const boundEventId = eventId ?? null;
    // Apollo already opened a case for this material: follow it. Starting another would file a
    // second case for one check (and spend a second Magnum DI call on the same evidence).
    if (caseId) {
      started.current = submissionId;
      void attach(caseId).then((opened) => {
        if (opened && boundEventId) void rememberCaseForEvent(boundEventId, opened.id);
      });
      return;
    }
    const { input, files } = createCaseInput(context, question);
    if (continuityKey && state.caseData) {
      if (busy) return;
      started.current = submissionId;
      void continueWith(input, operationId);
      return;
    }
    started.current = submissionId;
    const begin =
      state.caseData && state.operationId !== operationId
        ? remove().then(() => start(input, files, operationId))
        : start(input, files, operationId);
    void begin.then((c) => {
      if (c && boundEventId) void rememberCaseForEvent(boundEventId, c.id);
    });
  }, [submissionId, state.caseData?.id, state.phase]); // eslint-disable-line react-hooks/exhaustive-deps

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
