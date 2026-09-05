import { useRouter } from "expo-router";
import React from "react";
import { Pressable, Text, View } from "react-native";

import type { PatrolEvent } from "@/src/domain/types";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { Pill, toneColor } from "./ui";

const useStyles = makeStyles((c) => ({
  row: { flexDirection: "row", gap: spacing.md },
  rail: { width: 20, alignItems: "center" },
  line: { flex: 1, width: 2, backgroundColor: c.divider },
  dot: { width: 12, height: 12, borderRadius: 6, marginTop: 18, borderWidth: 2, borderColor: c.surface },
  card: { flex: 1, backgroundColor: c.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.lg, marginBottom: spacing.md, gap: spacing.sm },
  headline: { fontFamily: fonts.display, fontSize: 16, color: c.onSurface },
  meta: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceSecondary },
  top: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
}));

const STATUS_LABEL: Record<PatrolEvent["status"], string> = { active: "Needs attention", trusted: "Trusted", blocked: "Blocked", resolved: "Handled" };

export function PatrolItem({ event, isLast }: { event: PatrolEvent; isLast?: boolean }) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const color = toneColor(colors, event.state);
  const time = new Date(event.occurred_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <View style={s.row}>
      <View style={s.rail}>
        <View style={[s.dot, { backgroundColor: color }]} />
        {!isLast ? <View style={s.line} /> : null}
      </View>
      <Pressable
        testID={`patrol-item-${event.event_id}`}
        accessibilityRole="button"
        onPress={() => router.push({ pathname: "/patrol/[id]", params: { id: event.event_id } })}
        style={({ pressed }) => [s.card, { opacity: pressed ? 0.85 : 1 }]}
      >
        <View style={s.top}>
          <Pill tone={event.state} label={event.state.charAt(0).toUpperCase() + event.state.slice(1)} />
          <Text style={s.meta}>{time}</Text>
        </View>
        <Text style={s.headline} numberOfLines={2}>{event.headline}</Text>
        <Text style={s.meta}>{STATUS_LABEL[event.status]}{event.indicator_host ? ` · ${event.indicator_host}` : ""}</Text>
      </Pressable>
    </View>
  );
}
