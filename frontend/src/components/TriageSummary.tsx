// Triage Investigation summary — what Apollo checked, what it couldn't check, and what that means.
// Reads the stored deterministic record only. Renders nothing that requires a model call.

import React from "react";
import { Text, View } from "react-native";

import { Body, Button, Card, Pill } from "@/src/components/ui";
import { OUTCOME_LABEL, gapPlainEnglish, recheckCanHelp, type TriageInvestigationRecord } from "@/src/domain/triage/contract";
import { spacing, useTheme } from "@/src/theme";

const TONE: Record<string, "resting" | "growling" | "barking" | "neutral"> = {
  NO_THREAT_IDENTIFIED: "resting",
  POSSIBLE_THREAT_IDENTIFIED: "barking",
  LIMITED_UNABLE_TO_DETERMINE: "growling",
};

const MEANING: Record<string, string> = {
  NO_THREAT_IDENTIFIED: "Apollo found nothing threatening in the checks it completed.",
  POSSIBLE_THREAT_IDENTIFIED: "Apollo's deterministic rules matched a known threat pattern, so it investigated further.",
  LIMITED_UNABLE_TO_DETERMINE: "Apollo can't currently say either that this is safe or that it is a possible threat.",
};

export function TriageSummary({ record, onRecheck }: { record: TriageInvestigationRecord; onRecheck?: () => void }) {
  const { colors } = useTheme();
  const met = record.rules.filter((rule) => rule.result === "met");
  const canRecheck = recheckCanHelp(record);

  return (
    <Card style={{ gap: spacing.sm }} testID="triage-summary">
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" }}>
        <Text style={{ color: colors.onSurface, fontSize: 16, fontWeight: "700" }}>Triage investigation</Text>
        <Pill label={OUTCOME_LABEL[record.outcome]} tone={TONE[record.outcome] ?? "neutral"} testID="triage-outcome" />
      </View>

      <Body>{MEANING[record.outcome]}</Body>

      <View style={{ gap: spacing.xs }}>
        <Text style={{ color: colors.onSurface, fontWeight: "600" }}>What Apollo checked</Text>
        <Body testID="triage-rules-checked">
          {`${record.rulesChecked.length} of ${record.rulesApplicable.length} applicable rules completed.`}
        </Body>
        {met.map((rule) => (
          <Body key={rule.ruleId} testID={`triage-rule-${rule.ruleId}`}>{`• ${rule.title} (${rule.ruleId})`}</Body>
        ))}
      </View>

      {record.coverageGaps.length > 0 && (
        <View style={{ gap: spacing.xs }} testID="triage-coverage-gaps">
          <Text style={{ color: colors.onSurface, fontWeight: "600" }}>What couldn&apos;t be checked</Text>
          {record.coverageGaps.map((gap) => (
            <Body key={gap.code}>{`• ${gapPlainEnglish(gap.code)}`}</Body>
          ))}
        </View>
      )}

      {record.retries.some((retry) => retry.attempts > 1) && (
        <Body testID="triage-retries">
          {`Apollo retried ${record.retries.filter((r) => r.attempts > 1).length} check(s) before recording this result.`}
        </Body>
      )}

      {canRecheck && onRecheck ? (
        <Button label="Check again" onPress={onRecheck} variant="secondary" testID="triage-recheck" />
      ) : record.coverageGaps.length > 0 ? (
        <Body testID="triage-no-recheck">
          Re-checking won&apos;t help: this information isn&apos;t available to Apollo on this device.
        </Body>
      ) : null}
    </Card>
  );
}
