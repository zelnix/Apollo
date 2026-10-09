// Protection Details — the dedicated screen reached from the Home card's one primary action.
// Lists every Gate that is affected right now, showing "What Apollo found", "What it means" and
// "What to do" from REAL gate + capability + patrol-event data. No new scanning or data layer.
//
// Design principle: Apollo protects. Higgins explains. Home gives the message. This screen gives
// the details and actions. Manual checks are clearly distinguished from automatic protection.

import { useRouter } from "expo-router";
import ArrowRight from "lucide-react-native/icons/arrow-right";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import Dot from "lucide-react-native/icons/circle";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChildScreenHeader } from "@/src/components/ChildScreenHeader";
import { Body, Card, Pill, toneColor, type Tone } from "@/src/components/ui";
import { buildHomeAttention } from "@/src/domain/homeAttention";
import { buildHomeVoice } from "@/src/domain/higginsHomeVoice";
import { buildProtectionFindings, countDistinctFindings, type ProtectionFinding } from "@/src/domain/protectionDetails";
import { buildTodayTimeline, quietDayLine, type TimelineEntry, type TimelineTone } from "@/src/domain/protectionTimeline";
import { useApollo } from "@/src/store/ApolloContext";
import { useProtectionHealth } from "@/src/protection/healthStore";
import { getGateHealthLog, type GateHealthLog } from "@/src/store/gateHealthLog";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg, paddingBottom: spacing["3xl"] },
  intro: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  gateTitle: { fontFamily: fonts.displayBold, fontSize: 17, lineHeight: 23, color: c.onSurface },
  sectionLabel: { fontFamily: fonts.textSemibold, fontSize: 11, letterSpacing: 0.4, color: c.muted, textTransform: "uppercase" },
  sectionTitle: { fontFamily: fonts.displayBold, fontSize: 15, color: c.onSurface },
  sectionText: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurface },
  headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" },
  actionRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingTop: spacing.sm },
  actionText: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.brand },
  emptyTitle: { fontFamily: fonts.displayBold, fontSize: 18, color: c.onSurface, textAlign: "center" },
  // Timeline.
  tlRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  tlDotCol: { width: 20, alignItems: "center", paddingTop: 4 },
  tlBody: { flex: 1, gap: 2 },
  tlTitle: { fontFamily: fonts.textSemibold, fontSize: 14, lineHeight: 19, color: c.onSurface },
  tlSummary: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.onSurfaceSecondary },
  tlTime: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  tlDivider: { height: 1, backgroundColor: c.divider, marginVertical: spacing.sm, marginLeft: 28 },
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

const TIMELINE_TONE_TO_PILL: Record<TimelineTone, Tone> = {
  resting: "resting",
  ears_up: "ears_up",
  growling: "growling",
  barking: "barking",
  biting: "biting",
  neutral: "neutral",
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
  const findings = useMemo(
    () => buildProtectionFindings({ capabilities, gates: health.gates, attention, events }),
    [capabilities, health.gates, attention, events],
  );
  const findingCount = useMemo(() => countDistinctFindings(events), [events]);
  const voice = useMemo(
    () => buildHomeVoice({ resolution, attention, gates: health.gates, capabilities, findingCount }),
    [resolution, attention, health.gates, capabilities, findingCount],
  );

  // "What Apollo has done today" — loaded from the on-device Gate Health Log + today's patrol events.
  // Honest: a quiet day shows a reassurance line, not fake activity.
  const [healthLog, setHealthLog] = useState<GateHealthLog>({});
  useEffect(() => {
    let mounted = true;
    void getGateHealthLog().then((log) => { if (mounted) setHealthLog(log); }).catch(() => undefined);
    return () => { mounted = false; };
  }, [health.gates]);
  const timeline = useMemo(
    () => buildTodayTimeline({ events, gateHealthLog: healthLog, limit: 12 }),
    [events, healthLog],
  );

  const actionFindings = findings.filter((f) => f.findingType === "threat");
  const protectionActivity = findings.filter((f) => f.findingType === "protection_activity");
  const infraFindings = findings.filter((f) => f.findingType === "infrastructure");

  const info = {
    title: "About Protection Details",
    body: [
      "This screen shows findings that need your attention first, then protection activity (verified blocks), then gate infrastructure.",
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
          <Text style={s.intro}>{voice.text}</Text>
          {findingCount > 0 ? (
            <Text style={[s.intro, { fontFamily: fonts.textSemibold }]} testID="protection-finding-count">
              {findingCount === 1 ? "1 finding" : `${findingCount} findings`} requiring attention
            </Text>
          ) : null}
        </Card>

        {/* ── FINDINGS: Active concerns requiring attention ── */}
        {actionFindings.length > 0 ? (
          <View style={{ gap: spacing.lg }}>
            <Text style={s.sectionLabel}>FINDINGS</Text>
            {actionFindings.map((f) => (
              <Card key={f.id} style={{ gap: spacing.sm }} testID={`protection-finding-${f.id}`}>
                <View style={s.headerRow}>
                  <Text style={s.gateTitle}>{f.threatTitle ?? f.gate}</Text>
                  <Pill tone={TONE_TO_PILL[f.tone]} label={f.statusLabel} testID={`protection-finding-${f.id}-status`} />
                </View>
                {f.eventCount && f.eventCount > 1 ? (
                  <Text style={s.sectionText}>{f.eventCount} connected events via {f.gate}</Text>
                ) : (
                  <Text style={[s.sectionText, { color: colors.muted }]}>{f.gate}</Text>
                )}
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
                {/* Threat dates: first detected + latest activity */}
                {f.firstDetected ? (
                  <View style={{ flexDirection: "row", gap: spacing.md, flexWrap: "wrap" }}>
                    <Text style={s.tlTime}>First detected: {f.firstDetected}</Text>
                    {f.latestActivity && f.latestActivity !== f.firstDetected ? (
                      <Text style={s.tlTime}>Latest: {f.latestActivity}</Text>
                    ) : null}
                  </View>
                ) : null}
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
            ))}
          </View>
        ) : null}

        {/* ── PROTECTION ACTIVITY: Verified blocks — evidence of Apollo working ── */}
        {protectionActivity.length > 0 ? (
          <View style={{ gap: spacing.lg }}>
            <Text style={s.sectionLabel}>PROTECTION ACTIVITY</Text>
            {protectionActivity.map((f) => (
              <Card key={f.id} style={{ gap: spacing.sm }} testID={`protection-finding-${f.id}`}>
                <View style={s.headerRow}>
                  <Text style={s.gateTitle}>{f.threatTitle ?? f.gate}</Text>
                  <Pill tone="resting" label={f.statusLabel} testID={`protection-finding-${f.id}-status`} />
                </View>
                <View style={{ gap: 4 }}>
                  <Text style={s.sectionLabel}>WHAT APOLLO DID</Text>
                  <Text style={s.sectionText} testID={`protection-finding-${f.id}-found`}>{f.whatFound}</Text>
                </View>
                <View style={{ gap: 4 }}>
                  <Text style={s.sectionLabel}>WHAT TO DO</Text>
                  <Text style={s.sectionText} testID={`protection-finding-${f.id}-do`}>{f.whatToDo}</Text>
                </View>
                {f.firstDetected ? (
                  <Text style={s.tlTime}>Blocked: {f.firstDetected}</Text>
                ) : null}
                {f.route && f.actionLabel ? (
                  <Pressable accessibilityRole="button" accessibilityLabel={f.actionLabel} testID={`protection-finding-${f.id}-action`} onPress={() => router.push(f.route as never)} style={({ pressed }) => [s.actionRow, { opacity: pressed ? 0.7 : 1 }]} hitSlop={8}>
                    <Text style={s.actionText}>{f.actionLabel}</Text>
                    <ArrowRight size={16} color={colors.brand} />
                  </Pressable>
                ) : null}
              </Card>
            ))}
          </View>
        ) : null}

        {/* ── INFRASTRUCTURE: Gate status and capability issues ── */}
        {infraFindings.length > 0 ? (
          <View style={{ gap: spacing.lg }}>
            <Text style={s.sectionLabel}>GATE STATUS</Text>
            {infraFindings.map((f) => (
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
            ))}
          </View>
        ) : null}

        {/* No findings at all */}
        {findings.length === 0 ? (
          <Card testID="protection-details-empty" style={{ gap: spacing.sm }}>
            <Text style={s.emptyTitle}>Nothing to flag right now</Text>
            <Body>Apollo isn&apos;t reporting any active threats or affected Gates at the moment. Your automatic protection is running, and manual checks are available on the Check tab whenever you need them.</Body>
          </Card>
        ) : null}

        {/* What Apollo has done today — split into actionable and rest. */}
        <TimelineSection timeline={timeline} />
      </ScrollView>
    </View>
  );
}

/** Timeline section — shows actionable items first, rest collapsed under "Show more". */
function TimelineSection({ timeline }: { timeline: TimelineEntry[] }) {
  const s = useStyles();
  const { colors } = useTheme();
  const [showAll, setShowAll] = useState(false);

  const actionable = timeline.filter((e) => e.kind !== "resolved" && e.kind !== "confirmed_watching");
  const rest = timeline.filter((e) => e.kind === "resolved" || e.kind === "confirmed_watching");

  return (
    <Card style={{ gap: spacing.sm }} testID="protection-today">
      <View style={s.headerRow}>
        <Text style={s.sectionTitle}>What Apollo has done today</Text>
      </View>
      {timeline.length === 0 ? (
        <Body testID="protection-today-empty">{quietDayLine()}</Body>
      ) : (
        <View>
          {actionable.map((entry, i) => (
            <TimelineRow key={entry.id} entry={entry} showDivider={i > 0} />
          ))}
          {rest.length > 0 ? (
            <View>
              {actionable.length > 0 ? <View style={s.tlDivider} /> : null}
              {showAll ? (
                rest.map((entry, i) => (
                  <TimelineRow key={entry.id} entry={entry} showDivider={i > 0} />
                ))
              ) : null}
              <Pressable
                accessibilityRole="button"
                onPress={() => setShowAll((v) => !v)}
                style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingVertical: spacing.sm, opacity: pressed ? 0.7 : 1 }]}
                testID="protection-today-show-more"
              >
                {showAll
                  ? <ChevronUp size={16} color={colors.muted} />
                  : <ChevronDown size={16} color={colors.muted} />}
                <Text style={{ fontFamily: fonts.textSemibold, fontSize: 13, color: colors.muted }}>
                  {showAll ? "Show less" : `Show ${rest.length} more`}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      )}
    </Card>
  );
}

/** One entry in the "What Apollo has done today" timeline. Keeps a small coloured dot per tone,
 *  a title + plain-English summary + the local time label. Tappable when the entry links to an
 *  investigation. */
function TimelineRow({ entry, showDivider }: { entry: TimelineEntry; showDivider: boolean }) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const tone = TIMELINE_TONE_TO_PILL[entry.tone];
  const dotColor = toneColor(colors, tone);
  const content = (
    <View style={s.tlRow}>
      <View style={s.tlDotCol}><Dot size={10} color={dotColor} fill={dotColor} /></View>
      <View style={s.tlBody}>
        <Text style={s.tlTitle} testID={`protection-today-${entry.id}-title`}>{entry.title}</Text>
        <Text style={s.tlSummary} numberOfLines={2}>{entry.summary}</Text>
        <Text style={s.tlTime}>{entry.timeLabel}</Text>
      </View>
    </View>
  );
  return (
    <View>
      {showDivider ? <View style={s.tlDivider} /> : null}
      {entry.route ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${entry.title}`}
          testID={`protection-today-${entry.id}`}
          onPress={() => router.push(entry.route as never)}
          style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
        >
          {content}
        </Pressable>
      ) : (
        <View testID={`protection-today-${entry.id}`}>{content}</View>
      )}
    </View>
  );
}
