// Protection Details — the dedicated screen reached from the Home card's one primary action.
// Lists every Gate that is affected right now, showing "What Apollo found", "What it means" and
// "What to do" from REAL gate + capability + patrol-event data. No new scanning or data layer.
//
// Design principle: Apollo protects. Higgins explains. Home gives the message. This screen gives
// the details and actions. Manual checks are clearly distinguished from automatic protection.

import { useRouter } from "expo-router";
import ArrowRight from "lucide-react-native/icons/arrow-right";
import React, { useMemo } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChildScreenHeader } from "@/src/components/ChildScreenHeader";
import { Body, Card, Pill, type Tone } from "@/src/components/ui";
import { buildHomeAttention } from "@/src/domain/homeAttention";
import { buildHomeVoice } from "@/src/domain/higginsHomeVoice";
import { buildProtectionFindings, type ProtectionFinding } from "@/src/domain/protectionDetails";
import { useApollo } from "@/src/store/ApolloContext";
import { useProtectionHealth } from "@/src/protection/healthStore";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg, paddingBottom: spacing["3xl"] },
  intro: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  gateTitle: { fontFamily: fonts.displayBold, fontSize: 17, lineHeight: 23, color: c.onSurface },
  sectionLabel: { fontFamily: fonts.textSemibold, fontSize: 11, letterSpacing: 0.4, color: c.muted, textTransform: "uppercase" },
  sectionText: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurface },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  actionRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingTop: spacing.sm },
  actionText: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.brand },
  emptyTitle: { fontFamily: fonts.displayBold, fontSize: 18, color: c.onSurface, textAlign: "center" },
}));

const TONE_TO_PILL: Record<ProtectionFinding["tone"], Tone> = {
  good: "resting",
  action: "barking",
  limited: "ears_up",
  unverified: "ears_up",
  neutral: "neutral",
  off: "unknown",
  unavailable: "unknown",
};

export default function ProtectionDetailsScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { capabilities, resolution, events } = useApollo();
  const health = useProtectionHealth();

  const attention = useMemo(
    () => (health.checking ? [] : buildHomeAttention({ gates: health.gates, events })),
    [health.checking, health.gates, events],
  );
  const voice = useMemo(
    () => buildHomeVoice({ resolution, attention, gates: health.gates, capabilities }),
    [resolution, attention, health.gates, capabilities],
  );
  const findings = useMemo(
    () => buildProtectionFindings({ capabilities, gates: health.gates, attention, events }),
    [capabilities, health.gates, attention, events],
  );

  const info = {
    title: "About Protection Details",
    body: [
      "This screen lists every Apollo Gate that is affected right now — nothing more, nothing less.",
      "Apollo does the security work. Higgins is the one voice explaining what Apollo found, what it means and what to do.",
      "Manual checks (like Link Gate) are called out separately — they are tools you can use, not continuous background protection.",
    ],
  };

  return (
    <View style={s.root} testID="protection-details-screen">
      <ChildScreenHeader title="Protection Details" testID="protection-details-header" info={info} />
      <ScrollView
        testID="protection-details-scroll"
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing["3xl"] }]}
      >
        {/* Higgins' short interpretation — the same voice shown on Home, repeated here for context. */}
        <Card style={{ gap: spacing.sm }} testID="protection-details-voice">
          <Text style={s.sectionLabel}>HIGGINS SAYS</Text>
          <Text style={s.intro}>{voice.text}</Text>
        </Card>

        {findings.length === 0 ? (
          <Card testID="protection-details-empty" style={{ gap: spacing.sm }}>
            <Text style={s.emptyTitle}>Nothing to flag right now</Text>
            <Body>Apollo isn&apos;t reporting any affected Gates at the moment. Your automatic protection is running, and manual checks are available on the Check tab whenever you need them.</Body>
          </Card>
        ) : (
          findings.map((f) => (
            <Card key={f.id} style={{ gap: spacing.sm }} testID={`protection-finding-${f.id}`}>
              <View style={s.headerRow}>
                <Text style={s.gateTitle}>{f.gate}</Text>
                <Pill tone={TONE_TO_PILL[f.tone]} label={f.statusLabel} testID={`protection-finding-${f.id}-status`} />
                <Pill tone="neutral" label={f.kindLabel} testID={`protection-finding-${f.id}-kind`} />
              </View>
              <View style={{ gap: 4 }}>
                <Text style={s.sectionLabel}>WHAT APOLLO FOUND</Text>
                <Text style={s.sectionText} testID={`protection-finding-${f.id}-found`}>{f.whatFound}</Text>
              </View>
              <View style={{ gap: 4 }}>
                <Text style={s.sectionLabel}>WHAT IT MEANS</Text>
                <Text style={s.sectionText} testID={`protection-finding-${f.id}-means`}>{f.whatItMeans}</Text>
              </View>
              <View style={{ gap: 4 }}>
                <Text style={s.sectionLabel}>WHAT TO DO</Text>
                <Text style={s.sectionText} testID={`protection-finding-${f.id}-do`}>{f.whatToDo}</Text>
              </View>
              {f.route && f.actionLabel ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={f.actionLabel}
                  testID={`protection-finding-${f.id}-action`}
                  onPress={() => router.push(f.route as never)}
                  style={({ pressed }) => [s.actionRow, { opacity: pressed ? 0.7 : 1 }]}
                  hitSlop={8}
                >
                  <Text style={s.actionText}>{f.actionLabel}</Text>
                  <ArrowRight size={16} color={colors.brand} />
                </Pressable>
              ) : null}
            </Card>
          ))
        )}
      </ScrollView>
    </View>
  );
}
