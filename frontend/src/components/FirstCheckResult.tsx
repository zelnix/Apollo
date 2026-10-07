// Shared Higgins First Check / Re-check result UI. Used by onboarding (app/first-check.tsx) and the
// Check tab Re-check (app/recheck.tsx). Reports exactly what Higgins checked, found, and couldn't
// check (spec §13), and offers an AI/Higgins plain-English pass over the findings via GateInvestigation.
import React, { useMemo } from "react";
import { View } from "react-native";

import { GateInvestigation } from "@/src/components/GateInvestigation";
import { Body, Card, Pill, SectionTitle, toneColor, type Tone } from "@/src/components/ui";
import { issueContext } from "@/src/domain/higginsHandoff";
import { FIRST_CHECK_COPY, type FirstCheckCapabilityResult, type FirstCheckChange, type FirstCheckReport, type FirstCheckResultState } from "@/src/domain/firstCheck";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const STATE_PILL: Record<FirstCheckResultState, { tone: Tone; label: string }> = {
  PASS: { tone: "resting", label: "Clear" },
  INFORMATION: { tone: "unknown", label: "Good to know" },
  CAUTION: { tone: "ears_up", label: "Worth a look" },
  SUSPICIOUS: { tone: "barking", label: "Suspicious" },
  CONFIRMED_THREAT: { tone: "barking", label: "Confirmed threat" },
  NOT_AVAILABLE: { tone: "neutral", label: "Not available here" },
  ERROR: { tone: "growling", label: "Couldn't check" },
};

const useStyles = makeStyles((c) => ({
  statusTitle: { fontFamily: fonts.displayBold, fontSize: 24, color: c.onSurface },
  headline: { fontFamily: fonts.text, fontSize: 16, lineHeight: 24, color: c.onSurface },
  label: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  limitation: { fontFamily: fonts.text, fontSize: 13, lineHeight: 19, color: c.muted },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
}));

export function FirstCheckResult({ report, changes, headlineOverride, kind, autoStartAsk = false, testID = "first-check-result" }: {
  report: FirstCheckReport; changes?: FirstCheckChange[]; headlineOverride?: string; kind: "first_check" | "re_check"; autoStartAsk?: boolean; testID?: string;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const copy = FIRST_CHECK_COPY[report.overall];
  const executed = report.checks.filter((c) => c.executed);
  const unavailable = report.checks.filter((c) => !c.executed);

  const context = useMemo(() => issueContext({
    gate: "device",
    issue_summary: `Higgins ${kind === "re_check" ? "Re-check" : "First Check"}: ${copy.title}`,
    assessment_state: copy.dogState,
    findings: report.checks.map((c) => ({
      summary: `${c.title} — ${c.explanation}`,
      provenance: c.executed ? ("observed" as const) : ("inferred" as const),
      status: c.result === "CONFIRMED_THREAT" || c.result === "SUSPICIOUS" ? ("warning" as const) : c.result === "CAUTION" ? ("uncertain" as const) : ("uncertain" as const),
    })),
    uncertainty: report.unavailable,
    confirmed_protective_actions: [],
    user_reported_actions: [],
    available_actions: [{ label: "Open Device Gate", instruction: "Open Device Gate to review settings, permissions and Apollo's protection health in detail." }],
    original_evidence: [{ kind: "text", value: `${copy.headline}\n\n${report.checks.map((c) => `[${c.result}] ${c.title}: ${c.explanation}`).join("\n")}`, label: "Higgins First Check findings (no raw app or certificate data)" }],
  }), [report, copy, kind]);

  const submission = useMemo(() => ({ submissionId: `firstcheck:${report.checkedAt}` }), [report.checkedAt]);

  return (
    <View style={{ gap: spacing.lg }} testID={testID}>
      <Card testID={`${testID}-overall`} style={{ borderColor: toneColor(colors, copy.dogState), gap: spacing.sm }}>
        <Pill tone={copy.dogState} label={copy.title} testID={`${testID}-overall-pill`} />
        <Body testID={`${testID}-overall-state`} style={{ fontFamily: fonts.textMedium, color: colors.muted }}>{report.overall.replace("_", " ")}</Body>
        <Body style={s.headline} testID={`${testID}-headline`}>{headlineOverride ?? copy.headline}</Body>
      </Card>

      {changes && changes.length ? (
        <Card testID={`${testID}-changes`} style={{ gap: spacing.sm, borderColor: colors.growling }}>
          <SectionTitle>What&apos;s changed since the last check</SectionTitle>
          {changes.map((change, i) => (
            <View key={i} style={{ gap: 2 }} testID={`${testID}-change-${i}`}>
              <View style={s.row}><Body style={[s.label, { flex: 1 }]}>{change.title}</Body><Pill tone={change.direction === "better" ? "resting" : change.direction === "worse" ? "barking" : "ears_up"} label={change.direction === "better" ? "Resolved" : change.direction === "worse" ? "New concern" : "Changed"} /></View>
              <Body>{change.detail}</Body>
            </View>
          ))}
        </Card>
      ) : null}

      <Card testID={`${testID}-checks`} style={{ gap: spacing.md }}>
        <SectionTitle>What Higgins checked</SectionTitle>
        {executed.map((c) => <CheckRow key={c.id} c={c} testID={`${testID}-check-${c.id}`} />)}
        {executed.length === 0 ? <Body>Higgins couldn&apos;t complete any checks this time.</Body> : null}
      </Card>

      {unavailable.length ? (
        <Card testID={`${testID}-unavailable`} style={{ gap: spacing.sm }}>
          <SectionTitle>What Higgins couldn&apos;t check here</SectionTitle>
          {unavailable.map((c) => (
            <View key={c.id} style={{ gap: 2 }} testID={`${testID}-unavailable-${c.id}`}>
              <View style={s.row}><Body style={[s.label, { flex: 1 }]}>{c.title}</Body><Pill tone={STATE_PILL[c.result].tone} label={STATE_PILL[c.result].label} /></View>
              <Body style={s.limitation}>{c.platformLimitation ?? c.explanation}</Body>
            </View>
          ))}
          <Body style={s.limitation}>An area Apollo couldn&apos;t inspect is reported honestly — it is never counted as clean.</Body>
        </Card>
      ) : null}

      <Card testID={`${testID}-higgins`} style={{ gap: spacing.sm, borderColor: colors.navyBorder }}>
        <SectionTitle>Ask Higgins about this check</SectionTitle>
        <Body>Higgins can explain any finding in plain language and tell you the one thing to do next.</Body>
        <GateInvestigation submission={submission} continuityKey="first-check" context={context} testID={`${testID}-ask`} label="Explain this with Higgins" question="What did you find, and what should I do next?" autoStart={autoStartAsk} />
      </Card>
    </View>
  );
}

function CheckRow({ c, testID }: { c: FirstCheckCapabilityResult; testID: string }) {
  const s = useStyles();
  const pill = STATE_PILL[c.result];
  return (
    <View style={{ gap: 2 }} testID={testID}>
      <View style={s.row}><Body style={[s.label, { flex: 1 }]}>{c.title}</Body><Pill tone={pill.tone} label={pill.label} testID={`${testID}-pill`} /></View>
      <Body testID={`${testID}-explanation`}>{c.explanation}</Body>
      {c.platformLimitation ? <Body style={s.limitation}>{c.platformLimitation}</Body> : null}
    </View>
  );
}
