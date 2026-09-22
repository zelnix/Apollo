// Gate-embedded investigation: the initial Gate check runs through the shared case engine (originals + Apollo findings),
// and "Ask Higgins" continues the SAME case on the Ask tab instead of opening a second context.
// Investigation creation is bound to an explicit immutable submission (the Gate's result object for one check), never to
// editable screen state: typing into the form after a result cannot start a billed investigation or delete the last case.
import { useRouter } from "expo-router";
import React, { useEffect, useRef } from "react";
import { View } from "react-native";

import { InvestigationView } from "@/src/components/InvestigationView";
import { Button } from "@/src/components/ui";
import { openHigginsHandoff, type HigginsIssueContext } from "@/src/domain/higginsHandoff";
import { rememberCaseForEvent } from "@/src/investigation/caseIndex";
import { useInvestigation } from "@/src/investigation/caseStore";
import { createCaseInput } from "@/src/investigation/fromContext";
import { spacing } from "@/src/theme";

const submissionIds = new WeakMap<object, string>();
let counter = 0;
/** Stable id per submission object identity (a new Gate result = a new submission). */
function submissionIdFor(submission: object): string {
  let id = submissionIds.get(submission);
  if (!id) { id = `submission-${++counter}-${Date.now()}`; submissionIds.set(submission, id); }
  return id;
}

export function GateInvestigation({ submission, context, question, label, testID, autoStart = true, eventId, continuityKey, onResolved }: { submission: object; context: HigginsIssueContext; question: string; label: string; testID: string; autoStart?: boolean; eventId?: string | null; continuityKey?: string; onResolved?: (resolved: boolean) => void }) {
  const router = useRouter();
  const { state, start, ask, continueWith, retry, cancel, remove } = useInvestigation();
  const submissionId = submissionIdFor(submission);
  const started = useRef<string | null>(null);
  const busy = state.phase === "creating" || state.phase === "working" || state.phase === "reconnecting" || state.phase === "waiting_device";
  useEffect(() => { onResolved?.(!!state.response); }, [state.response, onResolved]);
  useEffect(() => { if (eventId && state.caseData?.id) void rememberCaseForEvent(eventId, state.caseData.id); }, [eventId, state.caseData?.id]);
  useEffect(() => {
    if (started.current === submissionId) return;
    // `autoStart=false` is reserved for explicitly local-only checks (notably File Gate): the shared case starts
    // only when the person asks Higgins and authorises publication of the original bytes.
    if (!autoStart) return;
    const { input, files } = createCaseInput(context, question); // context snapshot taken once per submission
    const boundEventId = eventId ?? (submission as { event?: { event_id?: string } | null }).event?.event_id ?? null;
    if (continuityKey && state.caseData) {
      if (busy) return;
      started.current = submissionId;
      void continueWith(input, `${continuityKey}:${submissionId}`);
      return;
    }
    started.current = submissionId;
    void (state.caseData ? remove().then(() => start(input, files)) : start(input, files)).then((c) => { if (c && boundEventId) void rememberCaseForEvent(boundEventId, c.id); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissionId, state.caseData?.id, state.phase]);
  return <View style={{ gap: spacing.sm }} testID={testID}>
    <InvestigationView state={state} onAnswer={(a) => void ask(a)} onRetry={() => void retry()} onCancel={() => void cancel()} testID={`${testID}-view`}
      onAction={(action, outcome) => { if (outcome.kind === "observed") void ask(`I did "${action.label}". Please re-check using the fresh observation Apollo just recorded.`); }} />
    <Button testID={`${testID}-ask`} variant="secondary" label={label} disabled={busy && !state.caseData}
      onPress={() => openHigginsHandoff(router, { ...context, case_id: state.caseData?.id }, state.caseData ? "" : question)} />
  </View>;
}
