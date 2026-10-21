/**
 * Threats Screen — Approved mock-up implementation.
 *
 * Shows the user's list of Apollo Threat Cases populated from real Patrol data.
 * Patrol is the underlying data source; there is no separate Patrol UI.
 * Magnum DI investigation data is attached when applicable.
 *
 * Features:
 * - Threat cards with source icon, title, identity, date, type, status, chevron
 * - Status filters: All | Investigating | Blocked | Resolved | No threat
 * - Sort control: Latest first / Oldest first
 * - Tapping a card opens the shared Threat Case detail screen
 * - Deduplication by Threat Case ID
 */
import Camera from "lucide-react-native/icons/camera";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Clock from "lucide-react-native/icons/clock";
import Ellipsis from "lucide-react-native/icons/ellipsis";
import FileText from "lucide-react-native/icons/file-text";
import Globe from "lucide-react-native/icons/globe";
import Link2 from "lucide-react-native/icons/link-2";
import Mail from "lucide-react-native/icons/mail";
import MessageSquare from "lucide-react-native/icons/message-square";
import Phone from "lucide-react-native/icons/phone";
import Search from "lucide-react-native/icons/search";
import Shield from "lucide-react-native/icons/shield";
import Smartphone from "lucide-react-native/icons/smartphone";
import React, { useMemo, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  threatCaseStatus,
  STATUS_LABELS,
  STATUS_COLORS,
  caseGroupKey,
  categoryLabel,
  formatDateTime,
  threatCaseId,
  type ThreatCaseStatus,
} from "@/src/domain/threatCase";
import { looksLikeInternalCode } from "@/src/domain/messageVoice";
import type { PatrolEvent, SourceMetadata } from "@/src/domain/types";
import { InfoButton, type ScreenInfo } from "@/src/components/InfoButton";
import { subjectRowLabel } from "@/src/domain/threatSubject";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const THREATS_INFO: ScreenInfo = { title: "About Threats", body: [
  "Threats lists everything Apollo has detected or investigated for you: blocked links, suspicious messages, calls and Magnum DI cases.",
  "Use the filter to see threats by status, and tap any threat to see its overview, the original evidence and its history.",
  "The line under the title shows when Apollo last ran a check or discovered a threat.",
] };

// ── Source icon mapping ──────────────────────────────────────────────────────

function sourceIcon(cat: string, meta?: SourceMetadata | null) {
  const t = meta?.type ?? cat;
  switch (t) {
    case "email": return { Icon: Mail, bg: "rgba(220,38,38,0.1)", fg: "#DC2626", label: "Email" };
    case "text": case "message": return { Icon: MessageSquare, bg: "rgba(16,185,129,0.1)", fg: "#10B981", label: "SMS" };
    case "screenshot": return { Icon: Camera, bg: "rgba(139,92,246,0.1)", fg: "#8B5CF6", label: "Screenshot" };
    case "link": return { Icon: Link2, bg: "rgba(107,114,128,0.1)", fg: "#6B7280", label: "Link Check" };
    case "website": return { Icon: Globe, bg: "rgba(220,38,38,0.1)", fg: "#DC2626", label: "Website" };
    case "call": return { Icon: Phone, bg: "rgba(217,119,6,0.1)", fg: "#D97706", label: "Call" };
    case "file": return { Icon: FileText, bg: "rgba(220,38,38,0.1)", fg: "#DC2626", label: "File" };
    case "app": return { Icon: Smartphone, bg: "rgba(16,185,129,0.1)", fg: "#065F46", label: "App" };
    case "device": case "network": return { Icon: Shield, bg: "rgba(220,38,38,0.1)", fg: "#991B1B", label: "Device" };
    case "account": return { Icon: Shield, bg: "rgba(217,119,6,0.1)", fg: "#92400E", label: "Account" };
    default: return { Icon: Shield, bg: "rgba(107,114,128,0.1)", fg: "#374151", label: "Security" };
  }
}

function cardTitle(event: PatrolEvent): string {
  const meta = event.source_metadata;
  if (meta?.subject) return meta.subject;
  if (event.headline && !looksLikeInternalCode(event.headline)) return event.headline;
  if (meta?.preview) return meta.preview.length > 50 ? meta.preview.slice(0, 50) + "…" : meta.preview;
  if (event.indicator_host) return event.indicator_host;
  return categoryLabel(event.category) + " threat detected";
}

function cardSubtitle(event: PatrolEvent): string {
  // Name the actual website, caller, sender, app or file on every row. Recorded identifiers only.
  const named = subjectRowLabel(event);
  if (named) return named;
  const preview = event.source_metadata?.preview;
  return preview ? preview.slice(0, 40) : "";
}

// ── Status accent color (left bar on card) ───────────────────────────────────

function accentColor(status: ThreatCaseStatus): string {
  switch (status) {
    case "investigating": return "#DC2626";
    case "blocked": return "#DC2626";
    case "attention": return "#DC2626";
    case "resolved": return "#10B981";
    case "no_threat": return "#6B7280";
    case "monitoring": return "#D97706";
  }
}

// ── Filter types ─────────────────────────────────────────────────────────────

type FilterKey = "all" | "investigating" | "blocked" | "resolved" | "no_threat";
const FILTERS: { key: FilterKey; label: string; matchStatuses: ThreatCaseStatus[] }[] = [
  { key: "all", label: "All", matchStatuses: [] },
  { key: "investigating", label: "Investigating", matchStatuses: ["investigating"] },
  { key: "blocked", label: "Blocked", matchStatuses: ["blocked"] },
  { key: "resolved", label: "Resolved", matchStatuses: ["resolved"] },
  { key: "no_threat", label: "No threat", matchStatuses: ["no_threat"] },
];

type SortOrder = "latest" | "oldest";

// ── Styles ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  // Dark header
  headerBg: { backgroundColor: c.navyDeep, paddingBottom: spacing.md },
  headerTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg },
  headerBrand: { fontFamily: fonts.displayBold, fontSize: 22, color: "#FFFFFF" },
  headerTagline: { fontFamily: fonts.text, fontSize: 13, color: "rgba(255,255,255,0.6)" },
  headerIcons: { flexDirection: "row", gap: spacing.md },
  headerIconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.1)" },
  // Title section
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.xs },
  titleText: { fontFamily: fonts.displayBold, fontSize: 28, color: c.onSurface },
  subtitleText: { fontFamily: fonts.text, fontSize: 15, color: c.onSurfaceSecondary, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  // Controls row (filter dropdown + sort)
  controlsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm },
  filterBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary, flex: 1 },
  filterBtnText: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface, flex: 1 },
  // Sort control
  sortBtn: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary },
  sortText: { fontFamily: fonts.textMedium, fontSize: 13, color: c.onSurface },
  // Filter dropdown
  filterDropdown: { marginHorizontal: spacing.lg, marginBottom: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary, overflow: "hidden" },
  filterOption: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.divider },
  filterOptionActive: { backgroundColor: c.brandPrimary },
  filterOptionText: { fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurface },
  filterOptionTextActive: { color: "#FFFFFF", fontFamily: fonts.textSemibold },
  filterOptionCount: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  // Threat card
  card: { marginHorizontal: spacing.lg, marginBottom: spacing.md, borderRadius: radius.lg, backgroundColor: c.surfaceSecondary, flexDirection: "row", overflow: "hidden", borderWidth: 1, borderColor: c.border },
  cardAccent: { width: 4 },
  historyLink: { flexDirection: "row", alignItems: "center", gap: spacing.xs, alignSelf: "flex-start", minHeight: 44, paddingHorizontal: spacing.xl, paddingVertical: spacing.sm },
  historyLinkText: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.brandPrimary },
  cardBody: { flex: 1, flexDirection: "row", alignItems: "center", padding: spacing.md, gap: spacing.md },
  cardIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  cardContent: { flex: 1, gap: 4 },
  cardTitle: { fontFamily: fonts.displayBold, fontSize: 15, color: c.onSurface, lineHeight: 21 },
  cardSubtitle: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceSecondary },
  cardMetaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.xs, marginTop: 2 },
  cardMeta: { fontFamily: fonts.text, fontSize: 12, color: c.onSurfaceSecondary },
  cardCaseId: { fontFamily: fonts.text, fontSize: 11, color: c.muted },
  // Status pill
  statusPill: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  statusPillText: { fontFamily: fonts.textSemibold, fontSize: 11 },
  // Empty state
  emptyText: { fontFamily: fonts.text, fontSize: 15, color: c.muted, textAlign: "center", paddingVertical: spacing.xl * 2, paddingHorizontal: spacing.xl },
}));

// ── Threat Card ──────────────────────────────────────────────────────────────

function ThreatCard({ event, onPress }: { event: PatrolEvent; onPress: () => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const status = threatCaseStatus(event);
  const si = sourceIcon(event.category, event.source_metadata);
  const IconEl = si.Icon;
  const title = cardTitle(event);
  const subtitle = cardSubtitle(event);
  const statusColor = STATUS_COLORS[status];
  const accent = accentColor(status);

  return (
    <Pressable style={({ pressed }) => [s.card, { opacity: pressed ? 0.85 : 1 }]} onPress={onPress} accessibilityRole="button" testID={`threat-card-${event.event_id}`}>
      <View style={[s.cardAccent, { backgroundColor: accent }]} />
      <View style={s.cardBody}>
        <View style={[s.cardIcon, { backgroundColor: si.bg }]}>
          <IconEl size={22} color={si.fg} />
        </View>
        <View style={s.cardContent}>
          <Text style={s.cardTitle} numberOfLines={3}>{title}</Text>
          {subtitle ? <Text style={s.cardSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
          <View style={s.cardMetaRow}>
            <View style={[s.statusPill, { backgroundColor: statusColor.bg }]}>
              <Text style={[s.statusPillText, { color: statusColor.text }]}>{STATUS_LABELS[status]}</Text>
            </View>
            <Text style={s.cardMeta} testID={`threat-card-${event.event_id}-meta`}>
              {si.label} · {formatDateTime(event.occurred_at)}
            </Text>
          </View>
          <Text style={s.cardCaseId}>{threatCaseId(event)}</Text>
        </View>
        <ChevronRight size={18} color={colors.muted} />
      </View>
    </Pressable>
  );
}

// ── Main Screen ──────────────────────────────────────────────────────────────

export default function ThreatsScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { events, lastVerifiedAt } = useApollo();
  // Most recent moment Apollo ran any check or discovered/updated a threat.
  const lastActivityAt = useMemo(() => {
    const times = [lastVerifiedAt, ...events.flatMap((e) => [e.occurred_at, e.detection_updated_at])]
      .map((t) => (t ? Date.parse(t) : NaN)).filter((t) => !Number.isNaN(t));
    return times.length ? new Date(Math.max(...times)).toISOString() : null;
  }, [events, lastVerifiedAt]);

  const [activeFilter, setActiveFilter] = useState<FilterKey>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortOrder, setSortOrder] = useState<SortOrder>("latest");

  // Deduplicate by Threat Case ID (same case = same list entry)
  const threatCases = useMemo(() => {
    const seen = new Set<string>();
    const deduped: PatrolEvent[] = [];
    // Sort by timestamp first so we keep the latest event for each case
    const sorted = [...events].sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
    for (const event of sorted) {
      const caseKey = caseGroupKey(event);
      if (seen.has(caseKey)) continue;
      seen.add(caseKey);
      deduped.push(event);
    }
    return deduped;
  }, [events]);

  // Compute status counts for filter chips
  const statusCounts = useMemo(() => {
    const counts: Record<FilterKey, number> = { all: 0, investigating: 0, blocked: 0, resolved: 0, no_threat: 0 };
    for (const event of threatCases) {
      const status = threatCaseStatus(event);
      counts.all++;
      if (status === "investigating") counts.investigating++;
      else if (status === "blocked") counts.blocked++;
      else if (status === "resolved") counts.resolved++;
      else if (status === "no_threat") counts.no_threat++;
    }
    return counts;
  }, [threatCases]);

  // Filter + sort
  const filtered = useMemo(() => {
    const filter = FILTERS.find((f) => f.key === activeFilter)!;
    let list = threatCases;
    if (filter.matchStatuses.length > 0) {
      list = list.filter((e) => filter.matchStatuses.includes(threatCaseStatus(e)));
    }
    list = [...list].sort((a, b) => {
      const ta = new Date(a.occurred_at).getTime();
      const tb = new Date(b.occurred_at).getTime();
      return sortOrder === "latest" ? tb - ta : ta - tb;
    });
    return list;
  }, [threatCases, activeFilter, sortOrder]);

  const toggleSort = () => setSortOrder((prev) => prev === "latest" ? "oldest" : "latest");

  return (
    <View style={s.root} testID="threats-screen">
      {/* Title */}
      <View style={[s.titleRow, { paddingTop: insets.top + spacing.sm }]}>
        <Text style={s.titleText}>Threats</Text>
        <InfoButton info={THREATS_INFO} testID="threats-info" />
      </View>
      <Text style={s.subtitleText} testID="threats-last-check">
        {lastActivityAt ? `Apollo last checked ${new Date(lastActivityAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}` : "Apollo hasn't run a check yet"}
      </Text>

      {/* Threats lists one row per case; the full record as it happened lives in patrol history. */}
      <Pressable
        testID="threats-history-link"
        accessibilityRole="button"
        accessibilityLabel="Open patrol history — everything Apollo has filed, newest first"
        onPress={() => router.push("/patrol/history")}
        style={({ pressed }) => [s.historyLink, { opacity: pressed ? 0.7 : 1 }]}
      >
        <Clock size={16} color={colors.brandPrimary} />
        <Text style={s.historyLinkText}>Patrol history</Text>
        <ChevronRight size={16} color={colors.brandPrimary} />
      </Pressable>

      {/* Filter + sort row */}
      <View style={s.controlsRow}>
        <Pressable style={s.filterBtn} onPress={() => setFilterOpen(!filterOpen)} accessibilityRole="button" testID="threats-filter-btn">
          <Text style={s.filterBtnText}>
            {FILTERS.find((f) => f.key === activeFilter)!.label} ({statusCounts[activeFilter]})
          </Text>
          <ChevronDown size={16} color={colors.onSurface} />
        </Pressable>
        <Pressable style={s.sortBtn} onPress={toggleSort} accessibilityRole="button" testID="threats-sort-btn">
          <Text style={s.sortText}>{sortOrder === "latest" ? "Latest first" : "Oldest first"}</Text>
          <ChevronDown size={16} color={colors.onSurface} />
        </Pressable>
      </View>

      {/* Filter dropdown */}
      {filterOpen ? (
        <View style={s.filterDropdown} testID="threats-filter-dropdown">
          {FILTERS.map(({ key, label }) => {
            const isActive = activeFilter === key;
            const count = statusCounts[key];
            return (
              <Pressable
                key={key}
                style={[s.filterOption, isActive && s.filterOptionActive]}
                onPress={() => { setActiveFilter(key); setFilterOpen(false); }}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                testID={`threats-filter-${key}`}
              >
                <Text style={[s.filterOptionText, isActive && s.filterOptionTextActive]}>
                  {label}
                </Text>
                <Text style={[s.filterOptionCount, isActive && s.filterOptionTextActive]}>
                  {count}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* Threat list */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.event_id}
        renderItem={({ item }) => (
          <ThreatCard
            event={item}
            onPress={() => router.push(`/patrol/${item.event_id}`)}
          />
        )}
        ListEmptyComponent={
          <Text style={s.emptyText}>
            {activeFilter === "all"
              ? "No threats detected yet. Apollo is watching."
              : `No ${FILTERS.find((f) => f.key === activeFilter)?.label.toLowerCase()} threats.`}
          </Text>
        }
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
        testID="threats-list"
      />
    </View>
  );
}
