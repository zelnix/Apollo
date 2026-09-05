import React, { useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PatrolItem } from "@/src/components/PatrolItem";
import { Body, Card, Pill, ScreenHeader } from "@/src/components/ui";
import type { ApolloState, PatrolEvent } from "@/src/domain/types";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Filter = "all" | ApolloState | "active";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" }, { key: "active", label: "Needs attention" }, { key: "biting", label: "Biting" }, { key: "barking", label: "Barking" }, { key: "growling", label: "Growling" }, { key: "resting", label: "Resting" },
];

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  chipRow: { height: 56, paddingHorizontal: spacing.xl, gap: spacing.sm, alignItems: "center" },
  chip: { height: 36, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary, justifyContent: "center", flexShrink: 0 },
  chipText: { fontFamily: fonts.textMedium, fontSize: 13, color: c.onSurfaceSecondary },
  list: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  day: { fontFamily: fonts.display, fontSize: 13, color: c.onSurfaceSecondary, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: spacing.md, marginTop: spacing.sm },
  emptyTitle: { fontFamily: fonts.display, fontSize: 16, color: c.onSurface },
}));

function dayLabel(iso: string) {
  const d = new Date(iso); const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

export default function Patrol() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { events } = useApollo();
  const [filter, setFilter] = useState<Filter>("all");

  const rows = useMemo(() => {
    const filtered = events.filter((e) => filter === "all" ? true : filter === "active" ? e.status === "active" || (e.status === "blocked" && !e.resolved_at) : e.state === filter);
    const out: ({ type: "day"; label: string; key: string } | { type: "event"; event: PatrolEvent; isLast: boolean; key: string })[] = [];
    let lastDay = "";
    filtered.forEach((e, i) => {
      const day = dayLabel(e.occurred_at);
      if (day !== lastDay) { out.push({ type: "day", label: day, key: `day-${day}` }); lastDay = day; }
      const next = filtered[i + 1];
      out.push({ type: "event", event: e, isLast: !next || dayLabel(next.occurred_at) !== day, key: e.event_id });
    });
    return out;
  }, [events, filter]);

  return (
    <View style={s.root}>
      <View style={{ paddingTop: insets.top + spacing.md }}>
        <ScreenHeader title="Patrol" testID="patrol-header" right={<Pill tone="neutral" label={`${events.length} events`} testID="patrol-count" />} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow} testID="patrol-filter-row">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <Pressable key={f.key} testID={`patrol-filter-${f.key}`} onPress={() => setFilter(f.key)} style={[s.chip, active && { borderColor: colors.resting, backgroundColor: colors.restingTint }]}>
                <Text style={[s.chipText, active && { color: colors.onSurface }]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={s.list}
        testID="patrol-list"
        renderItem={({ item }) => item.type === "day" ? <Text style={s.day}>{item.label}</Text> : <PatrolItem event={item.event} isLast={item.isLast} />}
        ListEmptyComponent={
          <Card testID="patrol-empty" style={{ gap: spacing.sm }}>
            <Text style={s.emptyTitle}>No security events{filter !== "all" ? " for this filter" : ""}</Text>
            <Body>Apollo is watching within its supported checks. Everything Apollo does shows up here in plain language.</Body>
          </Card>
        }
      />
    </View>
  );
}
