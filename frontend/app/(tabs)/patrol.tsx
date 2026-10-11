import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import FileDown from "lucide-react-native/icons/file-down";
import Library from "lucide-react-native/icons/library";
import { useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PatrolItem } from "@/src/components/PatrolItem";
import { RootScreenHeader } from "@/src/components/RootScreenHeader";
import { MultiSelectFilter } from "@/src/components/MultiSelectFilter";
import { DailyActivityCard } from "@/src/components/DailyActivityCard";
import { Body, Card, Pill } from "@/src/components/ui";
import { matchesPatrolFilter, patrolConsumerSummary, projectPatrolOutcomes, type PatrolCategory, type PatrolFilter, type PatrolOutcome } from "@/src/domain/patrolOutcomes";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { exportPatrolPdf } from "@/src/utils/exportPatrol";

// Multi-select options (OR semantics). An empty selection shows all activity.
const FILTER_OPTIONS: { id: PatrolFilter; label: string }[] = [
  { id: "needs_you", label: "Needs you" }, { id: "warnings", label: "Warnings" }, { id: "threats_stopped", label: "Threats stopped" }, { id: "resolved", label: "Resolved" },
];

// Short labels for each patrol category — used in collapsed day/month summaries.
const CATEGORY_SHORT: Record<PatrolCategory, string> = {
  site: "Site", link: "Link", text: "Text", call: "Call", file: "File", app: "App",
  network: "Net", account: "Acct", email: "Email", device: "Device",
  investigation: "Higgins", family: "Family",
};

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  filterBar: { height: 56, paddingHorizontal: spacing.xl, justifyContent: "center" },
  list: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.xl },
  // Expanded day label (today)
  day: { fontFamily: fonts.display, fontSize: 13, color: c.onSurfaceSecondary, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: spacing.md, marginTop: spacing.sm },
  summaryCard: { marginBottom: spacing.md, gap: 2 },
  summaryText: { fontFamily: fonts.displayBold, fontSize: 18, lineHeight: 24, color: c.onSurface },
  emptyTitle: { fontFamily: fonts.display, fontSize: 16, color: c.onSurface },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  // Collapsed group header (day or month)
  groupHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: c.surfaceSecondary, borderRadius: radius.md, borderWidth: 1,
    borderColor: c.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    marginTop: spacing.sm, marginBottom: spacing.sm, minHeight: 52,
  },
  groupHeaderExpanded: { borderColor: c.navyBorder, marginBottom: spacing.xs },
  groupLeft: { flex: 1, gap: 2 },
  groupLabel: { fontFamily: fonts.displayBold, fontSize: 14, color: c.onSurface },
  groupCounts: { fontFamily: fonts.text, fontSize: 12, color: c.muted, lineHeight: 16 },
  groupRight: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  groupTotal: { fontFamily: fonts.displayBold, fontSize: 14, color: c.onSurfaceSecondary },
  // Month header — slightly more prominent
  monthHeader: { borderLeftWidth: 3, borderLeftColor: c.gold },
}));

// ── Date helpers ─────────────────────────────────────────────────────────────

function toDateKey(iso: string) { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function toMonthKey(iso: string) { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; }

const todayKey = () => toDateKey(new Date().toISOString());
const currentMonthKey = () => toMonthKey(new Date().toISOString());

function dayLabel(iso: string) {
  const d = new Date(iso); const today = new Date();
  const y = new Date(); y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function monthLabel(monthKey: string) {
  const [year, month] = monthKey.split("-");
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleDateString([], { month: "long", year: "numeric" });
}

/** Compact "3 Site · 2 Call · 1 Device" summary. */
function categorySummary(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .map(([cat, n]) => `${n} ${CATEGORY_SHORT[cat as PatrolCategory] ?? cat}`)
    .join(" · ");
}

// ── Grouping ─────────────────────────────────────────────────────────────────

interface DayGroup { dayKey: string; label: string; outcomes: PatrolOutcome[]; categoryCounts: Record<string, number>; }
interface MonthGroup { monthKey: string; label: string; isCurrent: boolean; days: DayGroup[]; total: number; categoryCounts: Record<string, number>; }

function groupOutcomes(outcomes: PatrolOutcome[], filters: PatrolFilter[]): MonthGroup[] {
  const filtered = filters.length === 0
    ? outcomes
    : outcomes.filter((o) => filters.some((f) => matchesPatrolFilter(o, f)));

  // Group by day
  const dayMap = new Map<string, PatrolOutcome[]>();
  for (const o of filtered) {
    const dk = toDateKey(o.occurredAt);
    if (!dayMap.has(dk)) dayMap.set(dk, []);
    dayMap.get(dk)!.push(o);
  }

  // Group days by month
  const monthMap = new Map<string, DayGroup[]>();
  const curMonth = currentMonthKey();
  for (const [dk, items] of dayMap) {
    const mk = dk.slice(0, 7); // "YYYY-MM"
    if (!monthMap.has(mk)) monthMap.set(mk, []);
    const catCounts: Record<string, number> = {};
    for (const o of items) catCounts[o.category] = (catCounts[o.category] ?? 0) + 1;
    monthMap.get(mk)!.push({ dayKey: dk, label: dayLabel(items[0].occurredAt), outcomes: items, categoryCounts: catCounts });
  }

  // Sort months descending, days within month descending
  const months: MonthGroup[] = [];
  for (const [mk, days] of monthMap) {
    days.sort((a, b) => b.dayKey.localeCompare(a.dayKey));
    const total = days.reduce((sum, d) => sum + d.outcomes.length, 0);
    const catCounts: Record<string, number> = {};
    for (const d of days) for (const [c, n] of Object.entries(d.categoryCounts)) catCounts[c] = (catCounts[c] ?? 0) + n;
    months.push({ monthKey: mk, label: monthLabel(mk), isCurrent: mk === curMonth, days, total, categoryCounts: catCounts });
  }
  months.sort((a, b) => b.monthKey.localeCompare(a.monthKey));
  return months;
}

// ── Row types for FlatList ──────────────────────────────────────────────────

type PatrolRow =
  | { type: "month"; monthKey: string; label: string; total: number; categoryCounts: Record<string, number>; expanded: boolean; key: string }
  | { type: "day"; dayKey: string; label: string; total: number; categoryCounts: Record<string, number>; isToday: boolean; expanded: boolean; key: string }
  | { type: "outcome"; outcome: PatrolOutcome; isLast: boolean; key: string };

function buildRows(
  months: MonthGroup[],
  expandedMonths: Set<string>,
  expandedDays: Set<string>,
): PatrolRow[] {
  const rows: PatrolRow[] = [];
  const tdk = todayKey();

  for (const month of months) {
    if (month.isCurrent) {
      // Current month: show day headers directly (no month wrapper)
      for (const day of month.days) {
        const isToday = day.dayKey === tdk;
        const dayExpanded = isToday || expandedDays.has(day.dayKey);
        rows.push({ type: "day", dayKey: day.dayKey, label: day.label, total: day.outcomes.length, categoryCounts: day.categoryCounts, isToday, expanded: dayExpanded, key: `day-${day.dayKey}` });
        if (dayExpanded) {
          day.outcomes.forEach((outcome, i) => {
            rows.push({ type: "outcome", outcome, isLast: i === day.outcomes.length - 1, key: outcome.outcomeId });
          });
        }
      }
    } else {
      // Past month: show month header
      const monthExpanded = expandedMonths.has(month.monthKey);
      rows.push({ type: "month", monthKey: month.monthKey, label: month.label, total: month.total, categoryCounts: month.categoryCounts, expanded: monthExpanded, key: `month-${month.monthKey}` });
      if (monthExpanded) {
        for (const day of month.days) {
          const dayExpanded = expandedDays.has(day.dayKey);
          rows.push({ type: "day", dayKey: day.dayKey, label: day.label, total: day.outcomes.length, categoryCounts: day.categoryCounts, isToday: false, expanded: dayExpanded, key: `day-${day.dayKey}` });
          if (dayExpanded) {
            day.outcomes.forEach((outcome, i) => {
              rows.push({ type: "outcome", outcome, isLast: i === day.outcomes.length - 1, key: outcome.outcomeId });
            });
          }
        }
      }
    }
  }
  return rows;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function Patrol() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { events, deviceId, showToast } = useApollo();
  const router = useRouter();
  const [filters, setFilters] = useState<string[]>([]);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  const onExport = async () => {
    if (outcomes.length === 0) { showToast("Nothing to export yet.", "neutral"); return; }
    try { const r = await exportPatrolPdf(outcomes.map((outcome) => outcome.event), deviceId); showToast(r === "shared" ? "Patrol PDF ready to share" : "Print dialog opened", "resting"); }
    catch { showToast("Could not create the PDF on this device.", "growling"); }
  };

  const outcomes = projectPatrolOutcomes(events);
  const months = useMemo(() => groupOutcomes(outcomes, filters as PatrolFilter[]), [outcomes, filters]);
  const rows = useMemo(() => buildRows(months, expandedMonths, expandedDays), [months, expandedMonths, expandedDays]);

  const toggleMonth = useCallback((mk: string) => {
    setExpandedMonths((prev) => { const next = new Set(prev); if (next.has(mk)) next.delete(mk); else next.add(mk); return next; });
  }, []);

  const toggleDay = useCallback((dk: string) => {
    setExpandedDays((prev) => { const next = new Set(prev); if (next.has(dk)) next.delete(dk); else next.add(dk); return next; });
  }, []);

  const renderItem = useCallback(({ item }: { item: PatrolRow }) => {
    if (item.type === "month") {
      const Chevron = item.expanded ? ChevronDown : ChevronRight;
      return (
        <Pressable
          testID={`patrol-month-${item.monthKey}`}
          accessibilityRole="button"
          accessibilityLabel={`${item.label}, ${item.total} outcomes`}
          accessibilityState={{ expanded: item.expanded }}
          onPress={() => toggleMonth(item.monthKey)}
          style={[s.groupHeader, s.monthHeader, item.expanded && s.groupHeaderExpanded]}
        >
          <View style={s.groupLeft}>
            <Text style={s.groupLabel}>{item.label}</Text>
            <Text style={s.groupCounts} numberOfLines={2}>{categorySummary(item.categoryCounts)}</Text>
          </View>
          <View style={s.groupRight}>
            <Text style={s.groupTotal}>{item.total}</Text>
            <Chevron size={18} color={colors.onSurfaceSecondary} />
          </View>
        </Pressable>
      );
    }

    if (item.type === "day") {
      // Today: expanded plain header (original style)
      if (item.isToday) {
        return <Text style={s.day}>Today</Text>;
      }
      // Previous days: collapsible header with category counts
      const Chevron = item.expanded ? ChevronDown : ChevronRight;
      return (
        <Pressable
          testID={`patrol-day-${item.dayKey}`}
          accessibilityRole="button"
          accessibilityLabel={`${item.label}, ${item.total} outcomes`}
          accessibilityState={{ expanded: item.expanded }}
          onPress={() => toggleDay(item.dayKey)}
          style={[s.groupHeader, item.expanded && s.groupHeaderExpanded]}
        >
          <View style={s.groupLeft}>
            <Text style={s.groupLabel}>{item.label}</Text>
            <Text style={s.groupCounts} numberOfLines={2}>{categorySummary(item.categoryCounts)}</Text>
          </View>
          <View style={s.groupRight}>
            <Text style={s.groupTotal}>{item.total}</Text>
            <Chevron size={18} color={colors.onSurfaceSecondary} />
          </View>
        </Pressable>
      );
    }

    // outcome
    return <PatrolItem outcome={item.outcome} isLast={item.isLast} />;
  }, [s, colors, toggleMonth, toggleDay]);

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
        <View style={s.filterBar}>
          <MultiSelectFilter options={FILTER_OPTIONS} selected={filters} onChange={setFilters} title="Filter activity" testID="patrol-filter" />
        </View>
      </View>
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={s.list}
        testID="patrol-list"
        ListHeaderComponent={
          <View style={{ gap: spacing.md }}>
            {/* Daily activity summary — evidence of Apollo's work today */}
            <DailyActivityCard events={events} testID="patrol-daily-activity" />
            <Card testID="patrol-summary" style={s.summaryCard}>
              <Text style={s.summaryText} testID="patrol-summary-text">{patrolConsumerSummary(outcomes)}</Text>
            </Card>
          </View>
        }
        renderItem={renderItem}
        ListEmptyComponent={
          <Card testID="patrol-empty" style={{ gap: spacing.sm }}>
            <Text style={s.emptyTitle}>{filters.length === 0 ? "No Patrol activity yet." : "Nothing matches the filters you chose."}</Text>
            {filters.length === 0 ? <Body>Apollo adds items here as things happen.</Body> : null}
          </Card>
        }
      />
    </View>
  );
}
