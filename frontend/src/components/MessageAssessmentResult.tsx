import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import ExternalLink from "lucide-react-native/icons/external-link";
import ShieldAlert from "lucide-react-native/icons/shield-alert";
import { useState } from "react";
import { LayoutAnimation, Linking, Pressable, Text, View } from "react-native";

import { Body, Button, Card, Pill, SectionTitle, toneColor, toneTint } from "@/src/components/ui";
import type { InvestigationFinding, InvestigationResult } from "@/src/domain/investigation";
import type { ApolloState } from "@/src/domain/types";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  card: { gap: spacing.lg },
  hero: { borderRadius: radius.md, padding: spacing.lg, gap: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { fontFamily: fonts.displayBold, fontSize: 22, lineHeight: 28, color: c.onSurface, flex: 1 },
  higgins: { fontFamily: fonts.text, fontSize: 16, lineHeight: 24, color: c.onSurface },
  next: { fontFamily: fonts.textSemibold, fontSize: 17, lineHeight: 24, color: c.onSurface },
  finding: { borderLeftWidth: 3, paddingLeft: spacing.md, gap: spacing.xs },
  findingTitle: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  detailButton: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderColor: c.border, paddingTop: spacing.md },
  detailLabel: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.brand },
  source: { minHeight: 44, gap: spacing.xs, paddingVertical: spacing.sm },
  sourceLabel: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.brand },
  small: { fontFamily: fonts.text, fontSize: 12, lineHeight: 18, color: c.onSurfaceSecondary },
}));

function Finding({ finding }: { finding: InvestigationFinding }) {
  const s = useStyles(); const { colors } = useTheme();
  const tone = finding.status === "suspicious" ? colors.barking : finding.status === "corroborated" ? colors.resting : colors.unknown;
  return <View testID={`assessment-finding-${finding.status}`} style={[s.finding, { borderLeftColor: tone }]}>
    <Text style={s.findingTitle}>{finding.title}</Text><Body>{finding.detail}</Body>
  </View>;
}

export function MessageAssessmentResult({ assessment, state, onPrimaryAction }: { assessment: InvestigationResult; state: ApolloState; onPrimaryAction: () => void }) {
  const s = useStyles(); const { colors } = useTheme(); const [details, setDetails] = useState(false);
  const warning = state !== "biting";
  return <Card testID="message-assessment" style={[s.card, { borderColor: toneColor(colors, state) }]}>
    <View style={[s.hero, { backgroundColor: toneTint(colors, state) }]}>
      <View style={s.row}><ShieldAlert size={22} color={toneColor(colors, state)} />
        <Pill testID="message-assessment-truth" tone={state} label={warning ? "Warning — nothing was blocked" : "Observed packet blocked"} />
      </View>
      <Text testID="message-assessment-headline" style={s.title}>{assessment.higgins.headline}</Text>
      <Text testID="message-assessment-next-action" style={s.next}>{assessment.higgins.next_action}</Text>
      <Button testID="message-primary-action" label={assessment.higgins.action_label} onPress={onPrimaryAction} />
    </View>
    <View testID="higgins-core-result" style={{ gap: spacing.sm }}><SectionTitle>Higgins says</SectionTitle>
      <Text testID="higgins-exact-response" style={s.higgins}>{assessment.higgins.exact_response}</Text>
    </View>
    <View style={{ gap: spacing.md }}><SectionTitle>What Apollo found</SectionTitle>
      {assessment.findings.slice(0, 4).map((finding, index) => <Finding key={`${finding.title}-${index}`} finding={finding} />)}
    </View>
    <Pressable testID="message-more-details" accessibilityRole="button" accessibilityState={{ expanded: details }} style={s.detailButton}
      onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setDetails((value) => !value); }}>
      <Text style={s.detailLabel}>More details</Text>{details ? <ChevronUp size={20} color={colors.brand} /> : <ChevronDown size={20} color={colors.brand} />}
    </Pressable>
    {details ? <View testID="message-assessment-details" style={{ gap: spacing.lg }}>
      <View><SectionTitle>Why it matters</SectionTitle>{assessment.higgins.why_it_matters.map((item, i) => <Body key={i} testID={`assessment-why-${i}`}>• {item}</Body>)}</View>
      <View><SectionTitle>Could not establish</SectionTitle>{assessment.higgins.could_not_establish.map((item, i) => <Body key={i} testID={`assessment-unresolved-${i}`}>• {item}</Body>)}</View>
      <View><SectionTitle>Sources</SectionTitle>{assessment.sources.map((source) => <Pressable key={source.source_id} testID={`assessment-source-${source.source_id}`}
        disabled={!source.url} onPress={() => source.url ? void Linking.openURL(source.url) : undefined} style={s.source}>
        <View style={s.row}><Text style={s.sourceLabel}>{source.label}</Text>{source.url ? <ExternalLink size={15} color={colors.brand} /> : null}</View>
        <Body>{source.detail}</Body>
      </Pressable>)}</View>
      <Text testID="assessment-processing-scope" style={s.small}>Apollo did not retain the submitted content. {assessment.processing.provider_note}</Text>
    </View> : null}
  </Card>;
}