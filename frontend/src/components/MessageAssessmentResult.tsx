import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import ExternalLink from "lucide-react-native/icons/external-link";
import LockKeyhole from "lucide-react-native/icons/lock-keyhole";
import ShieldAlert from "lucide-react-native/icons/shield-alert";
import { useState } from "react";
import { LayoutAnimation, Linking, Pressable, Text, View } from "react-native";

import { Body, Button, Card, Pill, SectionTitle, toneColor, toneTint } from "@/src/components/ui";
import { HigginsSpeakButton } from "@/src/components/HigginsSpeakButton";
import type { InvestigationFinding, InvestigationResult } from "@/src/domain/investigation";
import type { ApolloState } from "@/src/domain/types";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  card: { gap: spacing.lg },
  hero: { borderRadius: radius.md, padding: spacing.lg, gap: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { fontFamily: fonts.displayBold, fontSize: 22, lineHeight: 28, color: c.onSurface, flex: 1 },
  higgins: { fontFamily: fonts.text, fontSize: 16, lineHeight: 24, color: c.onSurface },
  overline: { fontFamily: fonts.textSemibold, fontSize: 12, letterSpacing: 0.8, textTransform: "uppercase", color: c.onSurfaceSecondary },
  submitted: { borderWidth: 1, borderColor: c.border, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs, backgroundColor: c.surfaceTertiary },
  submittedTitle: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface },
  submittedText: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  next: { fontFamily: fonts.textSemibold, fontSize: 17, lineHeight: 24, color: c.onSurface },
  finding: { borderLeftWidth: 3, paddingLeft: spacing.md, gap: spacing.xs },
  findingTitle: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  detailButton: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderColor: c.border, paddingTop: spacing.md },
  detailLabel: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.brand },
  source: { minHeight: 44, gap: spacing.xs, paddingVertical: spacing.sm },
  sourceLabel: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.brand },
  small: { fontFamily: fonts.text, fontSize: 12, lineHeight: 18, color: c.onSurfaceSecondary },
  evidenceKind: { fontFamily: fonts.textSemibold, fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase", color: c.onSurfaceSecondary },
  privacy: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", paddingTop: spacing.sm, borderTopWidth: 1, borderColor: c.border },
}));

function Finding({ finding, index, prefix }: { finding: InvestigationFinding; index: number; prefix: string }) {
  const s = useStyles(); const { colors } = useTheme();
  const tone = finding.status === "suspicious" ? colors.barking : finding.status === "corroborated" ? colors.resting : colors.unknown;
  return <View testID={`${prefix}-finding-${index}`} style={[s.finding, { borderLeftColor: tone }]}>
    <Text testID={`${prefix}-finding-${index}-kind`} style={s.evidenceKind}>{finding.evidence_kind === "external_verification" ? "External verification" : finding.evidence_kind === "submitted_content" ? "Message evidence" : "Inference"}</Text>
    <Text testID={`${prefix}-finding-${index}-title`} style={s.findingTitle}>{finding.title}</Text>
    <Body testID={`${prefix}-finding-${index}-detail`}>{finding.detail}</Body>
  </View>;
}

interface Props {
  assessment: InvestigationResult;
  state: ApolloState;
  onPrimaryAction: () => void;
  submittedLabel?: string;
  submittedTitle?: string;
  submittedText?: string;
  testIDPrefix?: "message" | "link" | "call" | "app" | "email" | "account";
}

export function MessageAssessmentResult({ assessment, state, onPrimaryAction, submittedLabel = "You submitted",
  submittedTitle, submittedText, testIDPrefix = "message" }: Props) {
  const s = useStyles(); const { colors } = useTheme(); const [details, setDetails] = useState(false);
  const prefix = testIDPrefix === "message" ? "message-assessment" : `${testIDPrefix}-assessment`;
  const riskLabel = assessment.risk === "warning" ? "Scam warning" : assessment.risk === "clear" ? "No strong scam signs" : "Needs verification";
  const truthLabel = state === "biting" ? "Observed packet blocked" : assessment.risk === "warning" ? "Warning — nothing was blocked" : "Assessment only — nothing was blocked";
  return <Card testID={testIDPrefix === "message" ? "message-assessment" : `${testIDPrefix}-assessment`} style={[s.card, { borderColor: toneColor(colors, state) }]}>
    <View style={[s.hero, { backgroundColor: toneTint(colors, state) }]}>
      <View style={s.row}><ShieldAlert size={22} color={toneColor(colors, state)} />
        <Pill testID={`${prefix}-truth`} tone={state} label={truthLabel} />
      </View>
      <Text testID={`${prefix}-risk-label`} style={s.overline}>{riskLabel}</Text>
      <Text testID={`${prefix}-headline`} style={s.title}>{assessment.higgins.headline}</Text>
      <Text testID={`${prefix}-next-action`} style={s.next}>{assessment.higgins.next_action}</Text>
      <Button testID={testIDPrefix === "message" ? "message-primary-action" : "link-primary-action"} label={assessment.higgins.action_label} onPress={onPrimaryAction} />
    </View>
    {submittedText ? <View testID={`${prefix}-submitted`} style={s.submitted}>
      <Text testID={`${prefix}-submitted-label`} style={s.overline}>{submittedLabel}</Text>
      {submittedTitle ? <Text testID={`${prefix}-submitted-title`} style={s.submittedTitle}>{submittedTitle}</Text> : null}
      <Text testID={`${prefix}-submitted-text`} style={s.submittedText}>{submittedText}</Text>
    </View> : null}
    <View testID={testIDPrefix === "message" ? "higgins-core-result" : "link-higgins-core-result"} style={{ gap: spacing.sm }}>
      <View style={[s.row, { justifyContent: "space-between" }]}><SectionTitle>Higgins says</SectionTitle>
        <HigginsSpeakButton compact text={assessment.higgins.exact_response} testID={`${prefix}-hear-higgins`} />
      </View>
      <Text testID={testIDPrefix === "message" ? "higgins-exact-response" : "link-higgins-exact-response"} style={s.higgins}>{assessment.higgins.exact_response}</Text>
    </View>
    <View style={{ gap: spacing.md }}><SectionTitle>What Apollo found</SectionTitle>
      {assessment.findings.slice(0, 4).map((finding, index) => <Finding key={`${finding.title}-${index}`} finding={finding} index={index} prefix={prefix} />)}
    </View>
    <View testID={`${prefix}-uncertainty`} style={{ gap: spacing.sm }}><SectionTitle>What remains uncertain</SectionTitle>
      {assessment.higgins.could_not_establish.length ? assessment.higgins.could_not_establish.map((item, index) =>
        <Body key={index} testID={`${prefix}-uncertainty-${index}`}>• {item}</Body>) :
        <Body testID={`${prefix}-uncertainty-none`}>No material uncertainty was identified in the evidence available for this check.</Body>}
    </View>
    <Pressable testID={`${prefix}-more-details`} accessibilityRole="button" accessibilityState={{ expanded: details }} style={s.detailButton}
      onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setDetails((value) => !value); }}>
      <Text style={s.detailLabel}>{details ? "Hide details" : "Show details"}</Text>{details ? <ChevronUp size={20} color={colors.brand} /> : <ChevronDown size={20} color={colors.brand} />}
    </Pressable>
    {details ? <View testID={`${prefix}-details`} style={{ gap: spacing.lg }}>
      <View testID={`${prefix}-entities`}><SectionTitle>Identified in the submission</SectionTitle>
        {assessment.entities.claimed_organisations.length ? <Body testID={`${prefix}-entities-organisations`}>Claimed organisations: {assessment.entities.claimed_organisations.join(", ")}</Body> : null}
        {assessment.entities.mentioned_names?.length ? <Body testID={`${prefix}-entities-names`}>Names mentioned: {assessment.entities.mentioned_names.join(", ")}</Body> : null}
        {assessment.entities.sender_phone_numbers?.length ? <Body testID={`${prefix}-entities-sender-numbers`}>Sender numbers: {assessment.entities.sender_phone_numbers.join(", ")}</Body> : null}
        {assessment.entities.callback_details.length ? <Body testID={`${prefix}-entities-callback-numbers`}>Callback numbers: {assessment.entities.callback_details.join(", ")}</Body> : null}
        {assessment.entities.requested_actions.length ? <Body testID={`${prefix}-entities-actions`}>Requested action: {assessment.entities.requested_actions.join("; ")}</Body> : null}
        {assessment.entities.suspected_deception?.length ? <Body testID={`${prefix}-entities-deception`}>Suspected deception: {assessment.entities.suspected_deception.join("; ")}</Body> : null}
      </View>
      <View><SectionTitle>Why it matters</SectionTitle>{assessment.higgins.why_it_matters.map((item, i) => <Body key={i} testID={`${prefix}-why-${i}`}>• {item}</Body>)}</View>
      <View><SectionTitle>Sources</SectionTitle>{assessment.sources.map((source) => <Pressable key={source.source_id} testID={`${prefix}-source-${source.source_id}`}
        disabled={!source.url} onPress={() => source.url ? void Linking.openURL(source.url) : undefined} style={s.source}>
        <View style={s.row}><Text testID={`${prefix}-source-${source.source_id}-label`} style={s.sourceLabel}>{source.label}</Text>{source.url ? <ExternalLink size={15} color={colors.brand} /> : null}</View>
        <Text testID={`${prefix}-source-${source.source_id}-kind`} style={s.evidenceKind}>{source.evidence_kind === "submitted_content" ? "Submitted evidence" : "External verification"}{source.checked_at ? ` · checked ${new Date(source.checked_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</Text>
        <Body testID={`${prefix}-source-${source.source_id}-detail`}>{source.detail}</Body>
      </Pressable>)}</View>
    </View> : null}
    <View testID={`${prefix}-processing-scope`} style={s.privacy}><LockKeyhole size={16} color={colors.onSurfaceSecondary} />
      <Text style={[s.small, { flex: 1 }]}>Purpose-limited processing. Apollo closes request copies immediately and never later than 15 minutes. {assessment.processing.provider_note}</Text>
    </View>
  </Card>;
}