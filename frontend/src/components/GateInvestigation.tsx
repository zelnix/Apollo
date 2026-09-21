// Gate-embedded investigation: the initial Gate check runs through the shared case engine (originals + Apollo findings),
// and "Ask Higgins" continues the SAME case on the Ask tab instead of opening a second context.
import { useRouter } from "expo-router";
import React, { useEffect, useRef } from "react";
import { View } from "react-native";

import { InvestigationView } from "@/src/components/InvestigationView";
import { Button } from "@/src/components/ui";
import { openHigginsHandoff, type HigginsIssueContext } from "@/src/domain/higginsHandoff";
import { useInvestigation } from "@/src/investigation/caseStore";
import { createCaseInput } from "@/src/investigation/fromContext";
import { spacing } from "@/src/theme";

export function GateInvestigation({ context, question, label, testID }: { context: HigginsIssueContext; question: string; label: string; testID: string }) {
  const router = useRouter();
  const { state, start, ask, retry, cancel, remove } = useInvestigation();
  const key = JSON.stringify([context.gate, context.original_evidence ?? [], context.issue_summary]);
  const started = useRef<string | null>(null);
  useEffect(() => {
    if (started.current === key) return;
    started.current = key;
    const { input, files } = createCaseInput(context, question);
    void (state.caseData ? remove().then(() => start(input, files)) : start(input, files));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const busy = state.phase === "creating" || state.phase === "working" || state.phase === "reconnecting" || state.phase === "waiting_device";
  return <View style={{ gap: spacing.sm }} testID={testID}>
    <InvestigationView state={state} onAnswer={(a) => void ask(a)} onRetry={() => void retry()} onCancel={() => void cancel()} testID={`${testID}-view`} />
    <Button testID={`${testID}-ask`} variant="secondary" label={label} disabled={busy && !state.caseData}
      onPress={() => openHigginsHandoff(router, { ...context, case_id: state.caseData?.id }, state.caseData ? "" : question)} />
  </View>;
}
