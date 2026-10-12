import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import X from "lucide-react-native/icons/x";
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { looksLikeInternalCode } from "@/src/domain/messageVoice";
import { hasLocalEvidence } from "@/src/domain/higginsNarration";
import { Body, Pill, toneColor } from "@/src/components/ui";
import { ClassBadge } from "@/src/components/ClassBadge";
import type { PatrolRecord } from "@/src/domain/types";
import { apiGet } from "@/src/api/client";
import { projectPatrolOutcomes } from "@/src/domain/patrolOutcomes";
import { goBackOrHome } from "@/src/utils/navigation";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

import { InvestigationTabBar, type TabKey } from "@/src/components/patrol/InvestigationTabBar";
import { OverviewTab } from "@/src/components/patrol/OverviewTab";
import { InvestigationTab } from "@/src/components/patrol/InvestigationTab";
import { EvidenceTab } from "@/src/components/patrol/EvidenceTab";
import { HistoryTab } from "@/src/components/patrol/HistoryTab";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  // Header row: back + title + close
  headerRow: {
    paddingHorizontal: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: 22,
    color: c.onSurface,
    flex: 1,
  },
  closeBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: c.surfaceTertiary,
  },
  // Status row
  statusRow: {
    paddingHorizontal: spacing.xl,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  idText: {
    fontFamily: fonts.text,
    fontSize: 12,
    color: c.onSurfaceSecondary,
    marginLeft: "auto",
  },
  // Date row
  dateRow: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  dateText: {
    fontFamily: fonts.text,
    fontSize: 13,
    color: c.onSurfaceSecondary,
    lineHeight: 18,
  },
  // Content
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
}));

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function categoryLabel(cat: string): string {
  switch (cat) {
    case "website": return "Website security";
    case "call": return "Call security";
    case "message": return "Message security";
    case "device": return "Device security";
    case "image": return "Image privacy";
    case "account": return "Account security";
    default: return "Security finding";
  }
}

export default function EventDetail() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, focus } = useLocalSearchParams<{ id: string; focus?: string }>();
  const { events, isMock, ready, setupDone } = useApollo();
  const event = events.find((e) => e.event_id === id);

  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [timeline, setTimeline] = useState<PatrolRecord[]>([]);

  useEffect(() => {
    const recordId = event?.patrol_record?.recordId;
    if (!recordId) {
      setTimeline([]);
      return;
    }
    void apiGet<{ items: PatrolRecord[] }>(
      `/patrol/records/${encodeURIComponent(recordId)}/timeline`
    )
      .then((value) => setTimeline(value.items))
      .catch(() => setTimeline([]));
  }, [event?.patrol_record?.recordId]);

  const outcome = event ? projectPatrolOutcomes([event])[0] : null;
  const isIncomplete = event && !hasLocalEvidence(event);
  const shownWhatHappened = isIncomplete
    ? "The full evidence for this check is only available on the device where it happened."
    : event?.what_happened;
  const shownWhatToDo =
    !isIncomplete &&
    event?.what_to_do &&
    !looksLikeInternalCode(event.what_to_do)
      ? event.what_to_do
      : "Open this on the device where it happened for the recommended action.";

  // Investigation reference ID
  const refId = event?.patrol_record?.recordId
    ? `ID #${event.patrol_record.recordId.slice(-10).toUpperCase()}`
    : undefined;

  if (ready && !setupDone) return <Redirect href="/onboarding" />;

  return (
    <View style={s.root}>
      {/* Header: back + Threat Investigation + close */}
      <View style={[s.headerRow, { paddingTop: insets.top + spacing.md }]}>
        <Pressable
          testID="event-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => goBackOrHome(router)}
          style={s.backBtn}
        >
          <ChevronLeft size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={s.title} numberOfLines={1} testID="event-title">
          Threat Investigation
        </Text>
        <Pressable
          testID="event-close"
          accessibilityRole="button"
          accessibilityLabel="Close investigation"
          onPress={() => goBackOrHome(router)}
          style={s.closeBtn}
        >
          <X size={20} color={colors.onSurface} />
        </Pressable>
      </View>

      {!event ? (
        <View style={s.content}>
          <Body>This investigation is no longer available.</Body>
        </View>
      ) : (
        <>
          {/* Status pills row */}
          <View style={s.statusRow}>
            <Pill
              tone={outcome?.state ?? event.state}
              label={outcome?.result ?? (event.resolved_at ? "Resolved" : "Active")}
              testID="event-state-pill"
            />
            {event.patrol_record?.recordClass ? (
              <ClassBadge
                recordClass={event.patrol_record.recordClass}
                testID="event-class-badge"
              />
            ) : (
              <Pill tone="neutral" label={categoryLabel(event.category)} testID="event-category-badge" />
            )}
            {refId ? (
              <Text style={s.idText} testID="event-ref-id">{refId}</Text>
            ) : null}
          </View>

          {/* Date row */}
          <View style={s.dateRow}>
            <Text style={s.dateText} testID="event-dates">
              Occurred {formatDate(event.occurred_at)}
              {event.resolved_at
                ? `  \u2022  Resolved ${formatDate(event.resolved_at)}`
                : ""}
            </Text>
          </View>

          {/* Tab bar */}
          <InvestigationTabBar
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />

          {/* Tab content */}
          <ScrollView
            contentContainerStyle={[
              s.content,
              { paddingTop: spacing.lg, paddingBottom: insets.bottom + spacing.xl },
            ]}
            testID="event-scroll"
          >
            {activeTab === "overview" ? (
              <OverviewTab
                event={event}
                outcome={outcome ?? null}
                isMock={isMock}
                shownWhatToDo={shownWhatToDo}
                focusFromAlert={!!focus}
              />
            ) : activeTab === "investigation" ? (
              <InvestigationTab
                event={event}
                outcome={outcome ?? null}
                shownWhatHappened={shownWhatHappened ?? ""}
              />
            ) : activeTab === "evidence" ? (
              <EvidenceTab event={event} />
            ) : (
              <HistoryTab
                event={event}
                timeline={timeline}
                outcomeSource={outcome?.source ?? ""}
              />
            )}
          </ScrollView>
        </>
      )}
    </View>
  );
}
