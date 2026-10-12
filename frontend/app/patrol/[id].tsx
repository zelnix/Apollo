import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import X from "lucide-react-native/icons/x";
import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { looksLikeInternalCode, sourceLabel } from "@/src/domain/messageVoice";
import { hasLocalEvidence } from "@/src/domain/higginsNarration";
import { Body } from "@/src/components/ui";
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
  top: {
    paddingHorizontal: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: spacing.md,
  },
  title: {
    fontFamily: fonts.displayBold,
    fontSize: 22,
    color: c.onSurface,
    flex: 1,
    marginRight: spacing.md,
  },
  close: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    backgroundColor: c.surfaceTertiary,
  },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
}));

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
  const shownTitle =
    !isIncomplete &&
    outcome?.title &&
    !looksLikeInternalCode(outcome.title)
      ? outcome.title
      : !isIncomplete &&
        event?.headline &&
        !looksLikeInternalCode(event.headline)
      ? event.headline
      : "Patrol outcome";
  const shownWhatHappened = isIncomplete
    ? "The full evidence for this check is only available on the device where it happened."
    : event?.what_happened;
  const shownWhatToDo =
    !isIncomplete &&
    event?.what_to_do &&
    !looksLikeInternalCode(event.what_to_do)
      ? event.what_to_do
      : "Open this on the device where it happened for the recommended action.";

  if (ready && !setupDone) return <Redirect href="/onboarding" />;

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title} numberOfLines={2} testID="event-title">
          {shownTitle}
        </Text>
        <Pressable
          testID="event-close"
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => goBackOrHome(router)}
          style={s.close}
        >
          <X size={20} color={colors.onSurface} />
        </Pressable>
      </View>

      {!event ? (
        <View style={s.content}>
          <Body>This event is no longer available.</Body>
        </View>
      ) : (
        <>
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
