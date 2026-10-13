// Threats Screen — Redesigned to match approved mock-up.
// Shows: header with status indicator, two summary cards, filter chips,
// Apollo's patrol summary, and flat investigation cards.
//
// Reuses existing investigation records, case lifecycle, and navigation.

import ChevronRight from "lucide-react-native/icons/chevron-right";
import CircleCheck from "lucide-react-native/icons/circle-check";
import Dog from "lucide-react-native/icons/dog";
import Globe from "lucide-react-native/icons/globe";
import Grid2x2 from "lucide-react-native/icons/grid-2x2";
import Mail from "lucide-react-native/icons/mail";
import MessageSquare from "lucide-react-native/icons/message-square";
import Phone from "lucide-react-native/icons/phone";
import Shield from "lucide-react-native/icons/shield";
import SlidersHorizontal from "lucide-react-native/icons/sliders-horizontal";
import Smartphone from "lucide-react-native/icons/smartphone";
import Wifi from "lucide-react-native/icons/wifi";
import FileText from "lucide-react-native/icons/file-text";
import User from "lucide-react-native/icons/user";
import Link2 from "lucide-react-native/icons/link-2";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Pill } from "@/src/components/ui";
import {
  matchesPatrolFilter,
  projectPatrolOutcomes,
  type PatrolCategory,
  type PatrolOutcome,
} from "@/src/domain/patrolOutcomes";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

// ── Gate → friendly protection source label ─────────────────────────────────
const SOURCE_LABEL: Record<PatrolCategory, string> = {
  site: "Web protection",
  link: "Link protection",
  text: "Message protection",
  call: "Call protection",
  file: "File protection",
  app: "App protection",
  network: "Internet protection",
  account: "Account protection",
  email: "Email protection",
  device: "Device protection",
  investigation: "Higgins investigation",
  family: "Family protection",
};

// ── Category → icon mapping for investigation cards ─────────────────────────
const CATEGORY_ICON: Record<
  PatrolCategory,
  React.ComponentType<{ size?: number; color?: string }>
> = {
  site: Globe,
  link: Link2,
  text: MessageSquare,
  call: Phone,
  file: FileText,
  app: Grid2x2,
  network: Wifi,
  account: User,
  email: Mail,
  device: Smartphone,
  investigation: Shield,
  family: User,
};

// ── Filter chip definitions ─────────────────────────────────────────────────
type ChipId = "all" | "needs_action" | "handled" | "messages" | "apps";
const FILTER_CHIPS: { id: ChipId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs_action", label: "Needs action" },
  { id: "handled", label: "Handled" },
  { id: "messages", label: "Messages" },
  { id: "apps", label: "Apps" },
];

// ── Styles ──────────────────────────────────────────────────────────────────
const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },

  // Header
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
  },
  headerTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 28,
    lineHeight: 34,
    color: c.onSurface,
  },
  headerSubtitle: {
    fontFamily: fonts.text,
    fontSize: 14,
    lineHeight: 20,
    color: c.onSurfaceSecondary,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontFamily: fonts.textSemibold,
    fontSize: 13,
  },

  // Summary cards
  summaryRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  summaryCard: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 0,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: 2,
  },
  summaryIconRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  summaryIconWell: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  summaryLabel: {
    fontFamily: fonts.textSemibold,
    fontSize: 13,
    lineHeight: 16,
    color: c.onSurface,
  },
  summaryCount: {
    fontFamily: fonts.displayBold,
    fontSize: 22,
    lineHeight: 26,
    color: c.onSurface,
  },
  summaryCountRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
  },
  summarySubtext: {
    fontFamily: fonts.text,
    fontSize: 12,
    lineHeight: 16,
    color: c.onSurfaceSecondary,
  },

  // Filter chips
  filterBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    marginRight: spacing.sm,
    minHeight: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  filterChipLabel: {
    fontFamily: fonts.textSemibold,
    fontSize: 13,
  },
  filterIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  // Patrol summary card
  patrolCard: {
    marginHorizontal: spacing.lg,
    borderRadius: radius.md,
    padding: spacing.sm,
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  patrolHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  patrolIconWell: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  patrolTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 15,
    lineHeight: 20,
    color: c.onSurface,
  },
  patrolBody: {
    fontFamily: fonts.text,
    fontSize: 14,
    lineHeight: 20,
    color: c.onSurfaceSecondary,
  },
  patrolTime: {
    fontFamily: fonts.text,
    fontSize: 12,
    lineHeight: 16,
    color: c.muted,
  },

  // Section heading
  sectionHeading: {
    fontFamily: fonts.displayBold,
    fontSize: 20,
    lineHeight: 26,
    color: c.onSurface,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },

  // Investigation cards
  caseCard: {
    marginHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surfaceSecondary,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  caseRow: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
  },
  caseIconWell: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 2,
  },
  caseContent: {
    flex: 1,
    gap: 2,
  },
  caseTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  caseTitle: {
    flex: 1,
    fontFamily: fonts.displayBold,
    fontSize: 15,
    lineHeight: 20,
    color: c.onSurface,
  },
  caseSource: {
    fontFamily: fonts.text,
    fontSize: 12,
    lineHeight: 17,
    color: c.onSurfaceSecondary,
  },
  caseDate: {
    fontFamily: fonts.text,
    fontSize: 12,
    lineHeight: 17,
    color: c.muted,
  },
  caseSummary: {
    fontFamily: fonts.text,
    fontSize: 13,
    lineHeight: 18,
    color: c.onSurfaceSecondary,
    marginTop: 4,
  },
  caseChevron: {
    alignSelf: "center",
    flexShrink: 0,
    marginLeft: spacing.xs,
  },

  // Empty state
  emptyContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing["2xl"],
    gap: spacing.sm,
  },
  emptyTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 16,
    color: c.onSurface,
    textAlign: "center",
  },
  emptyBody: {
    fontFamily: fonts.text,
    fontSize: 14,
    lineHeight: 20,
    color: c.onSurfaceSecondary,
    textAlign: "center",
  },
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Format a date into "Wed 7 Oct 2026 • 21:10" style. */
function formatCaseDate(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${day} • ${time}`;
}

/** Check if a date falls within the current local calendar week (Mon–Sun). */
function isThisWeek(iso: string): boolean {
  const d = new Date(iso);
  const now = new Date();
  const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1; // Mon=0 .. Sun=6
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - dayOfWeek);
  weekStart.setHours(0, 0, 0, 0);
  return d >= weekStart;
}

/** Determine which tone/color to use for the case icon circle. */
function caseIconTone(outcome: PatrolOutcome): string {
  if (outcome.state === "resting" || outcome.state === "biting") return "good";
  if (outcome.state === "barking") return "attention";
  if (outcome.state === "growling" || outcome.state === "ears_up") return "caution";
  return "neutral";
}

// ── Filter Logic ────────────────────────────────────────────────────────────

function applyChipFilter(outcomes: PatrolOutcome[], chip: ChipId): PatrolOutcome[] {
  switch (chip) {
    case "all":
      return outcomes;
    case "needs_action":
      return outcomes.filter((o) => matchesPatrolFilter(o, "needs_you"));
    case "handled":
      return outcomes.filter(
        (o) => o.state === "resting" || o.event.status === "resolved" || o.event.status === "trusted",
      );
    case "messages":
      return outcomes.filter((o) => o.category === "text" || o.category === "call");
    case "apps":
      return outcomes.filter((o) => o.category === "app" || o.category === "file");
    default:
      return outcomes;
  }
}

// ── Investigation Card ──────────────────────────────────────────────────────

function InvestigationCard({ outcome }: { outcome: PatrolOutcome }) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const Icon = CATEGORY_ICON[outcome.category] ?? Shield;
  const tone = caseIconTone(outcome);

  const iconBg =
    tone === "good"
      ? "rgba(79,175,131,0.12)"
      : tone === "attention"
        ? "rgba(229,162,26,0.12)"
        : tone === "caution"
          ? "rgba(229,162,26,0.08)"
          : colors.surfaceTertiary;

  const iconColor =
    tone === "good"
      ? colors.resting
      : tone === "attention"
        ? colors.barking
        : tone === "caution"
          ? colors.growling
          : colors.onSurfaceSecondary;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={outcome.title}
      testID={`threat-case-${outcome.event.event_id}`}
      onPress={() =>
        router.push({
          pathname: "/patrol/[id]",
          params: { id: outcome.event.event_id },
        })
      }
      style={({ pressed }) => [{ opacity: pressed ? 0.82 : 1 }]}
    >
      <View style={s.caseCard}>
        <View style={s.caseRow}>
          <View style={[s.caseIconWell, { backgroundColor: iconBg }]}>
            <Icon size={20} color={iconColor} />
          </View>
          <View style={s.caseContent}>
            <View style={s.caseTitleRow}>
              <Text style={s.caseTitle} numberOfLines={2}>
                {outcome.title}
              </Text>
              <Pill tone={outcome.state} label={outcome.result} />
            </View>
            <Text style={s.caseSource}>
              Detected through: {SOURCE_LABEL[outcome.category]}
            </Text>
            <Text style={s.caseDate}>{formatCaseDate(outcome.occurredAt)}</Text>
            <Text style={s.caseSummary} numberOfLines={3}>
              {outcome.summary}
            </Text>
          </View>
          <View style={s.caseChevron}>
            <ChevronRight size={18} color={colors.onSurfaceSecondary} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function Patrol() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { events } = useApollo();
  const params = useLocalSearchParams<{ filter?: string; category?: string }>();

  const [activeChip, setActiveChip] = useState<ChipId>("all");

  // Apply initial filter from URL params
  useEffect(() => {
    if (params.filter === "needs_you") setActiveChip("needs_action");
    else if (params.filter === "resolved") setActiveChip("handled");
  }, [params.filter]);

  // Build outcomes
  const allOutcomes = useMemo(() => projectPatrolOutcomes(events), [events]);

  // Apply category filter from Protection → View related threats
  const categoryFiltered = useMemo(() => {
    if (params.category) {
      const cats = params.category.split(",").filter(Boolean);
      return allOutcomes.filter((o) => cats.includes(o.category));
    }
    return allOutcomes;
  }, [allOutcomes, params.category]);

  // Apply chip filter
  const filteredOutcomes = useMemo(
    () => applyChipFilter(categoryFiltered, activeChip),
    [categoryFiltered, activeChip],
  );

  // Counts
  const openCases = useMemo(
    () => allOutcomes.filter((o) => matchesPatrolFilter(o, "needs_you")).length,
    [allOutcomes],
  );
  const handledThisWeek = useMemo(
    () =>
      allOutcomes.filter(
        (o) =>
          (o.state === "resting" || o.event.status === "resolved" || o.event.status === "trusted") &&
          isThisWeek(o.occurredAt),
      ).length,
    [allOutcomes],
  );

  // Status indicator
  const hasUnresolved = openCases > 0;
  const statusLabel = hasUnresolved ? "Needs attention" : "All clear today";
  const statusColor = hasUnresolved ? colors.growling : colors.resting;
  const statusBorder = hasUnresolved ? "rgba(229,162,26,0.25)" : "rgba(79,175,131,0.25)";

  // Patrol summary
  const patrolSummary = useMemo(() => {
    if (openCases > 0) {
      return `Apollo has ${openCases} open ${openCases === 1 ? "case" : "cases"} that ${openCases === 1 ? "needs" : "need"} your attention. Tap a case below to review it.`;
    }
    return "Apollo has been watching quietly today. No unresolved threats need your attention right now.";
  }, [openCases]);

  const lastUpdated = useMemo(() => {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }, []);

  // Empty state messages
  const emptyTitle = activeChip === "all"
    ? "No threat investigations yet"
    : activeChip === "needs_action"
      ? "No investigations need action"
      : activeChip === "handled"
        ? "No handled investigations"
        : `No ${activeChip} investigations`;
  const emptyBody = activeChip === "all"
    ? "Apollo has no threat investigations to show here."
    : "No investigations match this filter.";

  const renderCard = useCallback(
    ({ item }: { item: PatrolOutcome }) => <InvestigationCard outcome={item} />,
    [],
  );

  return (
    <View style={s.root} testID="threats-screen">
      {/* ── Fixed header area ── */}
      <View style={{ paddingTop: insets.top + spacing.sm, backgroundColor: colors.surface }}>
        {/* Title + Status */}
        <View style={s.headerRow}>
          <Text style={s.headerTitle}>Threats</Text>
          <View
            style={[
              s.statusPill,
              { borderColor: statusBorder },
            ]}
            testID="threats-status-pill"
          >
            <View style={[s.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[s.statusText, { color: statusColor }]}>
              {statusLabel}
            </Text>
          </View>
        </View>

        {/* Subtitle */}
        <Text style={s.headerSubtitle}>
          Higgins keeps your recent threat investigations, alerts, and handled
          incidents in one place.
        </Text>

        {/* Summary cards */}
        <View style={s.summaryRow}>
          {/* Open cases */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open cases: ${openCases}`}
            testID="threats-open-cases"
            onPress={() => setActiveChip("needs_action")}
            style={({ pressed }) => [s.summaryCard, { backgroundColor: openCases > 0 ? "#FFF3E0" : "#E8F5E9", opacity: pressed ? 0.82 : 1 }]}
          >
            <View style={s.summaryIconRow}>
              <View
                style={[
                  s.summaryIconWell,
                  { backgroundColor: openCases > 0 ? "#FFE0B2" : "#C8E6C9" },
                ]}
              >
                <Shield size={16} color={openCases > 0 ? "#E65100" : "#2E7D32"} />
              </View>
              <Text style={s.summaryLabel}>Open cases</Text>
            </View>
            <View style={s.summaryCountRow}>
              <Text style={s.summaryCount}>{openCases}</Text>
              <Text style={s.summarySubtext}>
                {openCases === 0 ? "No action needed" : `${openCases === 1 ? "needs" : "need"} action`}
              </Text>
            </View>
          </Pressable>

          {/* Handled this week */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Handled this week: ${handledThisWeek}`}
            testID="threats-handled-week"
            onPress={() => setActiveChip("handled")}
            style={({ pressed }) => [s.summaryCard, { backgroundColor: "#E3F2FD", opacity: pressed ? 0.82 : 1 }]}
          >
            <View style={s.summaryIconRow}>
              <View
                style={[
                  s.summaryIconWell,
                  { backgroundColor: "#BBDEFB" },
                ]}
              >
                <CircleCheck size={16} color="#1565C0" />
              </View>
              <Text style={s.summaryLabel}>Handled this week</Text>
            </View>
            <View style={s.summaryCountRow}>
              <Text style={s.summaryCount}>{handledThisWeek}</Text>
              <Text style={s.summarySubtext}>
                {handledThisWeek === 0 ? "None this week" : "Resolved"}
              </Text>
            </View>
          </Pressable>
        </View>

        {/* Filter chips */}
        <View style={s.filterBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ alignItems: "center" }}
          >
            {FILTER_CHIPS.map((chip) => {
              const active = chip.id === activeChip;
              return (
                <Pressable
                  key={chip.id}
                  accessibilityRole="button"
                  accessibilityLabel={chip.label}
                  accessibilityState={{ selected: active }}
                  testID={`threats-filter-${chip.id}`}
                  onPress={() => setActiveChip(chip.id)}
                  style={[
                    s.filterChip,
                    {
                      backgroundColor: active ? colors.brand : "transparent",
                      borderColor: active ? colors.brand : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      s.filterChipLabel,
                      {
                        color: active ? colors.onBrand : colors.onSurfaceSecondary,
                      },
                    ]}
                  >
                    {chip.label}
                  </Text>
                </Pressable>
              );
            })}
            {/* Filter/settings icon */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="More filters"
              testID="threats-filter-more"
              onPress={() => {}}
              style={[
                s.filterIconBtn,
                { borderColor: colors.border },
              ]}
            >
              <SlidersHorizontal size={16} color={colors.onSurfaceSecondary} />
            </Pressable>
          </ScrollView>
        </View>
      </View>

      {/* ── Scrollable content ── */}
      <FlatList
        data={filteredOutcomes}
        keyExtractor={(item) => item.outcomeId}
        testID="threats-list"
        contentContainerStyle={{ paddingBottom: insets.bottom + 90 }}
        ListHeaderComponent={
          <View>
            {/* Apollo's patrol summary */}
            <View
              style={[
                s.patrolCard,
                { backgroundColor: "rgba(79,175,131,0.08)" },
              ]}
              testID="threats-patrol-summary"
            >
              <View style={s.patrolHeader}>
                <View
                  style={[
                    s.patrolIconWell,
                    { backgroundColor: "rgba(79,175,131,0.15)" },
                  ]}
                >
                  <Dog size={22} color={colors.resting} />
                </View>
                <Text style={s.patrolTitle}>Apollo&apos;s patrol summary</Text>
              </View>
              <Text style={s.patrolBody}>{patrolSummary}</Text>
              <Text style={s.patrolTime}>Last updated {lastUpdated}</Text>
            </View>

            {/* Section heading */}
            <Text style={s.sectionHeading}>Recent Threat Investigations</Text>
          </View>
        }
        renderItem={renderCard}
        ListEmptyComponent={
          <View style={s.emptyContainer} testID="threats-empty">
            <Text style={s.emptyTitle}>{emptyTitle}</Text>
            <Text style={s.emptyBody}>{emptyBody}</Text>
          </View>
        }
      />
    </View>
  );
}
