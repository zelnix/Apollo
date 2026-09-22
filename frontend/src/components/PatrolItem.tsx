import { useRouter } from "expo-router";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import React from "react";
import { Pressable, Text, View } from "react-native";

import type { PatrolOutcome } from "@/src/domain/patrolOutcomes";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { Pill, toneColor } from "./ui";

const useStyles = makeStyles((c) => ({
  row: { flexDirection: "row", gap: spacing.md }, rail: { width: 20, alignItems: "center" }, line: { flex: 1, width: 2, backgroundColor: c.divider }, dot: { width: 12, height: 12, borderRadius: 6, marginTop: 18, borderWidth: 2, borderColor: c.surface },
  card: { flex: 1, backgroundColor: c.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.lg, marginBottom: spacing.md, gap: spacing.sm }, headline: { fontFamily: fonts.displayBold, fontSize: 17, lineHeight: 22, color: c.onSurface }, summary: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurfaceSecondary }, meta: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceSecondary }, top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
}));

export function PatrolItem({ outcome, isLast }: { outcome: PatrolOutcome; isLast?: boolean }) {
  const s = useStyles(); const { colors } = useTheme(); const router = useRouter(); const time = new Date(outcome.latestOccurredAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return <View style={s.row}><View style={s.rail}><View style={[s.dot, { backgroundColor: toneColor(colors, outcome.state) }]} />{!isLast ? <View style={s.line} /> : null}</View>
    <Pressable testID={`patrol-outcome-${outcome.event.event_id}`} accessibilityRole="button" accessibilityLabel={outcome.headline} accessibilityHint="Opens the full Patrol outcome" onPress={() => router.push({ pathname: "/patrol/[id]", params: { id: outcome.event.event_id } })} style={({ pressed }) => [s.card, { opacity: pressed ? 0.82 : 1 }]}>
      <View style={s.top}><Pill tone={outcome.status === "handled" ? "resting" : outcome.state} label={outcome.status === "handled" ? "Handled" : "Needs you"} testID={`patrol-outcome-${outcome.event.event_id}-status`} /><Text style={s.meta}>{time}</Text></View>
      <Text style={s.headline} testID={`patrol-outcome-${outcome.event.event_id}-headline`}>{outcome.headline}</Text><Text style={s.summary} numberOfLines={3}>{outcome.summary}</Text>
      <View style={s.top}>{outcome.repeatCount > 1 ? <Text style={s.meta} testID={`patrol-outcome-${outcome.event.event_id}-repeat`}>Seen {outcome.repeatCount} times in this incident</Text> : <Text style={s.meta}>Recorded outcome</Text>}<ChevronRight size={18} color={colors.brand} /></View>
    </Pressable></View>;
}