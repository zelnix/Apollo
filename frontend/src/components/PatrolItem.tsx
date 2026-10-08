import { useRouter } from "expo-router";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import React from "react";
import { Pressable, Text, View } from "react-native";

import type { PatrolCategory, PatrolOutcome } from "@/src/domain/patrolOutcomes";
import { matchesPatrolFilter } from "@/src/domain/patrolOutcomes";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { Pill, toneColor } from "./ui";

// Short gate/app label so each entry names where the finding came from.
const GATE_LABEL: Record<PatrolCategory, string> = {
  site: "Site", link: "Link", text: "Text", call: "Call", file: "File", app: "App",
  network: "Internet", account: "Account", email: "Email", device: "Device",
  investigation: "Higgins", family: "Family",
};

const useStyles = makeStyles((c) => ({
  row: { flexDirection: "row", gap: spacing.md },
  rail: { width: 20, alignItems: "center" },
  line: { flex: 1, width: 2, backgroundColor: c.divider },
  dot: { width: 12, height: 12, borderRadius: 6, marginTop: 18, borderWidth: 2, borderColor: c.surface },
  card: { flex: 1, backgroundColor: c.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.lg, marginBottom: spacing.md, gap: spacing.sm },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.sm },
  chips: { flexDirection: "row", gap: spacing.xs, alignItems: "center", flexShrink: 1, flexWrap: "wrap" },
  time: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceSecondary, flexShrink: 0 },
  headline: { fontFamily: fonts.displayBold, fontSize: 16, lineHeight: 21, color: c.onSurface },
  summary: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary },
  adviceLabel: { fontFamily: fonts.textSemibold, color: c.onSurface },
  bottom: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md, marginTop: spacing.xs },
  action: { flexDirection: "row", alignItems: "center", gap: 2, flexShrink: 1 },
  actionText: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.brand },
  dismiss: { minHeight: 44, justifyContent: "center" },
  dismissText: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.muted },
}));

export function PatrolItem({ outcome, isLast }: { outcome: PatrolOutcome; isLast?: boolean }) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { resolveEvent } = useApollo();
  const time = new Date(outcome.occurredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const needsYou = matchesPatrolFilter(outcome, "needs_you");
  const gate = GATE_LABEL[outcome.category];
  const advice = (outcome.event.what_to_do ?? "").trim();
  const open = () => router.push({ pathname: "/patrol/[id]", params: { id: outcome.event.event_id } });

  return (
    <View style={s.row}>
      <View style={s.rail}>
        <View style={[s.dot, { backgroundColor: toneColor(colors, outcome.state) }]} />
        {!isLast ? <View style={s.line} /> : null}
      </View>
      <Pressable
        testID={`patrol-outcome-${outcome.event.event_id}`}
        accessibilityRole="button"
        accessibilityLabel={outcome.title}
        accessibilityHint="Opens the full Patrol investigation"
        onPress={open}
        style={({ pressed }) => [s.card, { opacity: pressed ? 0.82 : 1 }]}
      >
        <View style={s.top}>
          <View style={s.chips}>
            {gate ? <Pill tone="neutral" label={gate} /> : null}
            <Pill tone={outcome.state} label={outcome.result} testID={`patrol-outcome-${outcome.event.event_id}-status`} />
            {needsYou ? <Pill tone="barking" label="Needs you" testID={`patrol-outcome-${outcome.event.event_id}-needsyou`} /> : null}
          </View>
          <Text style={s.time}>{time}</Text>
        </View>

        <Text style={s.headline} testID={`patrol-outcome-${outcome.event.event_id}-headline`} numberOfLines={2}>{outcome.title}</Text>
        <Text style={s.summary} numberOfLines={3}>{outcome.summary}</Text>
        {advice ? (
          <Text style={s.summary} numberOfLines={3} testID={`patrol-outcome-${outcome.event.event_id}-advice`}>
            <Text style={s.adviceLabel}>Higgins recommends: </Text>{advice}
          </Text>
        ) : null}

        <View style={s.bottom}>
          <View style={s.action}>
            <Text style={s.actionText} testID={`patrol-outcome-${outcome.event.event_id}-action`}>{outcome.primaryAction?.label ?? "Open investigation"}</Text>
            <ChevronRight size={16} color={colors.brand} />
          </View>
          {needsYou ? (
            <Pressable
              testID={`patrol-outcome-${outcome.event.event_id}-dismiss`}
              accessibilityRole="button"
              accessibilityLabel="Dismiss this item"
              hitSlop={8}
              onPress={() => void resolveEvent(outcome.event)}
              style={s.dismiss}
            >
              <Text style={s.dismissText}>Dismiss</Text>
            </Pressable>
          ) : outcome.repeatCount > 1 ? (
            <Text style={s.time} testID={`patrol-outcome-${outcome.event.event_id}-repeat`}>Seen {outcome.repeatCount}×</Text>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}
