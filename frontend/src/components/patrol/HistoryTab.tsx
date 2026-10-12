import React from "react";
import { Pressable, Text, View } from "react-native";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import CircleCheck from "lucide-react-native/icons/circle-check";
import Clock from "lucide-react-native/icons/clock";
import FileText from "lucide-react-native/icons/file-text";
import Info from "lucide-react-native/icons/info";
import MessageSquare from "lucide-react-native/icons/message-square";
import Search from "lucide-react-native/icons/search";
import User from "lucide-react-native/icons/user";

import { Body, Card, toneText } from "@/src/components/ui";
import { eventHistory, sourceLabel } from "@/src/domain/messageVoice";
import type { PatrolEvent, PatrolRecord } from "@/src/domain/types";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  content: { gap: spacing.lg },
  tabHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  tabTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 17,
    color: c.onSurface,
  },
  tabSubtitle: {
    fontFamily: fonts.text,
    fontSize: 13,
    color: c.onSurfaceSecondary,
  },
  // Timeline
  timelineCard: { gap: spacing.md },
  timelineItem: {
    flexDirection: "row",
    gap: spacing.md,
  },
  timelineTrack: {
    alignItems: "center",
    width: 32,
  },
  timelineDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    marginTop: -2,
    marginBottom: -2,
  },
  timelineContent: {
    flex: 1,
    paddingBottom: spacing.lg,
  },
  timelineContentLast: {
    flex: 1,
    paddingBottom: spacing.sm,
  },
  timelineRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  timelineTitle: {
    fontFamily: fonts.textSemibold,
    fontSize: 14,
    color: c.onSurface,
    lineHeight: 20,
    flex: 1,
  },
  timelineTime: {
    fontFamily: fonts.text,
    fontSize: 11,
    color: c.muted,
  },
  timelineBody: {
    fontFamily: fonts.text,
    fontSize: 13,
    lineHeight: 19,
    color: c.onSurfaceSecondary,
    marginTop: 4,
  },
  // Status badge
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    alignSelf: "flex-start",
    marginTop: spacing.sm,
  },
  badgeText: {
    fontFamily: fonts.textSemibold,
    fontSize: 11,
  },
  // Info card
  infoCard: {
    borderRadius: radius.md,
    padding: spacing.lg,
    flexDirection: "row",
    gap: spacing.md,
    alignItems: "flex-start",
  },
  infoTitle: {
    fontFamily: fonts.textSemibold,
    fontSize: 14,
    color: c.onSurface,
    lineHeight: 20,
  },
  infoBody: {
    fontFamily: fonts.text,
    fontSize: 13,
    lineHeight: 19,
    color: c.onSurfaceSecondary,
  },
  bullet: {
    fontFamily: fonts.text,
    fontSize: 13,
    lineHeight: 19,
    color: c.onSurfaceSecondary,
    paddingLeft: spacing.sm,
  },
  // Ask Higgins button
  askRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
  },
  askIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  askText: {
    fontFamily: fonts.textSemibold,
    fontSize: 14,
    color: c.onSurface,
    flex: 1,
  },
}));

interface TimelineEntry {
  title: string;
  body: string;
  at: string;
  icon: "alert" | "search" | "document" | "user" | "resolved";
  badge?: { label: string; tone: "barking" | "resting" | "ears_up" };
}

/** Builds a rich timeline from event + revision data. */
function buildTimeline(event: PatrolEvent, revisions: { occurredAt: string; effectiveState: string; summary: string; revision: number }[]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  // 1. Finding recorded
  entries.push({
    title: "Finding recorded",
    body: event.what_happened ?? "Apollo recorded a finding.",
    at: event.occurred_at,
    icon: "alert",
    badge: event.resolved_at ? undefined : { label: "Needs your attention", tone: "barking" },
  });

  // 2. Investigation started (if there are revisions or a patrol record)
  if (event.patrol_record?.recordId) {
    const investigationStart = revisions.length > 0 ? revisions[0].occurredAt : event.occurred_at;
    entries.push({
      title: "Investigation started",
      body: "Magnum DI began reviewing the finding and related context.",
      at: investigationStart,
      icon: "search",
    });
  }

  // 3. Investigation completed (if patrol record has summary)
  if (event.patrol_record?.summary) {
    const completedAt = event.patrol_record.updatedAt ?? event.patrol_record.occurredAt ?? event.occurred_at;
    entries.push({
      title: "Investigation completed",
      body: "The investigation report was added to this record.",
      at: completedAt,
      icon: "document",
    });
  }

  // 4. Resolved
  if (event.resolved_at) {
    entries.push({
      title: "Marked resolved",
      body: "This event was marked resolved.",
      at: event.resolved_at,
      icon: "resolved",
      badge: { label: "Resolved", tone: "resting" },
    });
  }

  // Sort chronologically
  entries.sort((a, b) => a.at.localeCompare(b.at));
  return entries;
}

function TimelineIcon({ type, colors }: { type: string; colors: Record<string, string> }) {
  switch (type) {
    case "alert": return <CircleAlert size={16} color="#FFFFFF" />;
    case "search": return <Search size={16} color="#FFFFFF" />;
    case "document": return <FileText size={16} color="#FFFFFF" />;
    case "user": return <User size={16} color="#FFFFFF" />;
    case "resolved": return <CircleCheck size={16} color="#FFFFFF" />;
    default: return <Info size={16} color="#FFFFFF" />;
  }
}

function dotColor(type: string, colors: Record<string, string>): string {
  switch (type) {
    case "alert": return colors.barking;
    case "search": return colors.info;
    case "document": return colors.info;
    case "user": return colors.info;
    case "resolved": return colors.resting;
    default: return colors.onSurfaceSecondary;
  }
}

export function HistoryTab({
  event,
  timeline,
  outcomeSource,
}: {
  event: PatrolEvent;
  timeline: PatrolRecord[];
  outcomeSource: string;
}) {
  const s = useStyles();
  const { colors } = useTheme();

  const revisions = timeline.map((r) => ({
    occurredAt: r.occurredAt,
    effectiveState: r.effectiveState,
    summary: r.summary,
    revision: r.revision,
  }));
  const entries = buildTimeline(event, revisions);

  return (
    <View style={s.content}>
      {/* History tab card with header */}
      <Card style={{ gap: spacing.md }} testID="history-header-card">
        <View style={s.tabHeader}>
          <View style={[s.iconCircle, { backgroundColor: colors.navyDeep }]}>
            <Clock size={22} color="#FFFFFF" />
          </View>
          <View>
            <Text style={s.tabTitle}>History</Text>
            <Text style={s.tabSubtitle}>The timeline of this finding</Text>
          </View>
        </View>

        <Body>
          This tab shows the key recorded stages of this incident from detection
          to resolution.
        </Body>
      </Card>

      {/* Timeline card */}
      <Card style={s.timelineCard} testID="history-timeline">
        {entries.map((entry, i) => {
          const isLast = i === entries.length - 1;
          const bg = dotColor(entry.icon, colors);

          return (
            <View key={i} style={s.timelineItem} testID={`history-entry-${i}`}>
              {/* Track */}
              <View style={s.timelineTrack}>
                <View style={[s.timelineDot, { backgroundColor: bg }]}>
                  <TimelineIcon type={entry.icon} colors={colors} />
                </View>
                {!isLast ? (
                  <View
                    style={[
                      s.timelineLine,
                      { backgroundColor: colors.divider },
                    ]}
                  />
                ) : null}
              </View>

              {/* Content */}
              <View style={isLast ? s.timelineContentLast : s.timelineContent}>
                <View style={s.timelineRow}>
                  <Text style={s.timelineTitle}>{entry.title}</Text>
                  <Text style={s.timelineTime}>
                    {new Date(entry.at).toLocaleString([], {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </Text>
                </View>
                <Text style={s.timelineBody}>{entry.body}</Text>
                {entry.badge ? (
                  <View
                    style={[
                      s.badge,
                      {
                        backgroundColor:
                          entry.badge.tone === "resting"
                            ? colors.restingTint
                            : colors.barkingTint,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        s.badgeText,
                        {
                          color: toneText(
                            colors,
                            entry.badge.tone
                          ),
                        },
                      ]}
                    >
                      {entry.badge.label}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          );
        })}
      </Card>

      {/* What this history includes */}
      <View
        style={[
          s.infoCard,
          { backgroundColor: "rgba(22,34,53,0.06)" },
        ]}
        testID="history-info"
      >
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.info, alignItems: "center", justifyContent: "center", marginTop: 2 }}>
          <Info size={16} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1, gap: spacing.sm }}>
          <Text style={s.infoTitle}>What this history includes</Text>
          <Text style={s.bullet}>{"\u2022"} Shows only the significant stages of this incident.</Text>
          <Text style={s.bullet}>{"\u2022"} Removes duplicate or low-value narrative updates.</Text>
          <Text style={s.bullet}>{"\u2022"} Sensitive technical details may remain on the originating device and are not always included here.</Text>
        </View>
      </View>

      {/* Ask Higgins to explain */}
      <Card style={{ padding: 0 }} testID="history-ask-higgins">
        <View style={s.askRow}>
          <View style={[s.askIcon, { backgroundColor: colors.surfaceTertiary }]}>
            <MessageSquare size={18} color={colors.navyDeep} />
          </View>
          <Text style={s.askText}>Ask Higgins to explain</Text>
          <ChevronRight size={20} color={colors.onSurfaceSecondary} />
        </View>
      </Card>
    </View>
  );
}
