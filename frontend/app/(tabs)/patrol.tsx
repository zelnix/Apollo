import FileDown from "lucide-react-native/icons/file-down";
import Library from "lucide-react-native/icons/library";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { FlatList, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PatrolItem } from "@/src/components/PatrolItem";
import { RootScreenHeader } from "@/src/components/RootScreenHeader";
import { Body, Card, Pill } from "@/src/components/ui";
import { matchesPatrolFilter, patrolConsumerSummary, projectPatrolOutcomes, type PatrolFilter, type PatrolOutcome } from "@/src/domain/patrolOutcomes";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { exportPatrolPdf } from "@/src/utils/exportPatrol";

const FILTERS: { key: PatrolFilter; label: string }[] = [
  { key: "all_activity", label: "All activity" }, { key: "needs_you", label: "Needs you" }, { key: "warnings", label: "Warnings" }, { key: "threats_stopped", label: "Threats stopped" }, { key: "resolved", label: "Resolved" },
];

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  chipRow: { height: 56, paddingHorizontal: spacing.xl, gap: spacing.sm, alignItems: "center" },
  chip: { height: 36, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary, justifyContent: "center", flexShrink: 0 },
  chipText: { fontFamily: fonts.textMedium, fontSize: 13, color: c.onSurfaceSecondary },
  list: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  day: { fontFamily: fonts.display, fontSize: 13, color: c.onSurfaceSecondary, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: spacing.md, marginTop: spacing.sm },
  summaryCard: { marginBottom: spacing.md, gap: 2 },
  summaryText: { fontFamily: fonts.displayBold, fontSize: 18, lineHeight: 24, color: c.onSurface },
  emptyTitle: { fontFamily: fonts.display, fontSize: 16, color: c.onSurface },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
}));

function dayLabel(iso: string) {
  const d = new Date(iso); const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
}

type PatrolRow = { type: "day"; label: string; key: string } | { type: "outcome"; outcome: PatrolOutcome; isLast: boolean; key: string };

function buildRows(outcomes: PatrolOutcome[], filter: PatrolFilter): PatrolRow[] {
  const filtered = outcomes.filter((outcome) => matchesPatrolFilter(outcome, filter));
  const rows: PatrolRow[] = [];
  let lastDay = "";
  filtered.forEach((outcome, index) => {
    const day = dayLabel(outcome.occurredAt);
    if (day !== lastDay) { rows.push({ type: "day", label: day, key: `day-${day}` }); lastDay = day; }
    const next = filtered[index + 1];
    rows.push({ type: "outcome", outcome, isLast: !next || dayLabel(next.occurredAt) !== day, key: outcome.outcomeId });
  });
  return rows;
}

export default function Patrol() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { events, deviceId, showToast } = useApollo();
  const router = useRouter();
  const [filter, setFilter] = useState<PatrolFilter>("all_activity");
  const onExport = async () => {
    if (outcomes.length === 0) { showToast("Nothing to export yet.", "neutral"); return; }
    try { const r = await exportPatrolPdf(outcomes.map((outcome) => outcome.event), deviceId); showToast(r === "shared" ? "Patrol PDF ready to share" : "Print dialog opened", "resting"); }
    catch { showToast("Could not create the PDF on this device.", "growling"); }
  };

  const outcomes = projectPatrolOutcomes(events);
  const rows = buildRows(outcomes, filter);

  return (
    <View style={s.root}>
      <View style={{ paddingTop: insets.top + spacing.md }}>
        <RootScreenHeader title="Apollo's Patrol" testID="patrol-header" info={{ title: "About Apollo's Patrol", body: ["Patrol is a plain-English record of what Apollo noticed while it was watching — checks that completed and anything that needed attention.", "It holds no browsing history or message content. Clear it anytime in Settings → Privacy & data."] }} rightAccessory={
          <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
            <Pill tone="neutral" label={`${outcomes.length} outcomes`} testID="patrol-count" />
            <Pressable testID="patrol-saved-reports-button" accessibilityRole="button" accessibilityLabel="Open saved reports" onPress={() => router.push("/saved-reports")} style={s.iconBtn}><Library size={20} color={colors.onSurface} /></Pressable>
            <Pressable testID="patrol-export-button" accessibilityRole="button" accessibilityLabel="Export Patrol as PDF" onPress={onExport} style={s.iconBtn}><FileDown size={20} color={colors.onSurface} /></Pressable>
          </View>
        } />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow} testID="patrol-filter-row">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            return (
              <Pressable key={f.key} testID={`patrol-filter-${f.key}`} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => setFilter(f.key)} style={[s.chip, active && { borderColor: colors.gold, backgroundColor: colors.goldTint }]}> 
                <Text style={[s.chipText, active && { color: colors.onSurface, fontFamily: fonts.textSemibold }]}>{f.label}</Text>
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
        ListHeaderComponent={
          <Card testID="patrol-summary" style={s.summaryCard}>
            <Text style={s.summaryText} testID="patrol-summary-text">{patrolConsumerSummary(outcomes)}</Text>
          </Card>
        }
        renderItem={({ item }) => item.type === "day" ? <Text style={s.day}>{item.label}</Text> : <PatrolItem outcome={item.outcome} isLast={item.isLast} />}
        ListEmptyComponent={
          <Card testID="patrol-empty" style={{ gap: spacing.sm }}>
            <Text style={s.emptyTitle}>{filter === "all_activity" ? "No Patrol activity yet." : "Nothing here currently needs your attention."}</Text>
            {filter === "all_activity" ? <Body>Apollo adds items here as things happen.</Body> : null}
          </Card>
        }
      />
    </View>
  );
}
