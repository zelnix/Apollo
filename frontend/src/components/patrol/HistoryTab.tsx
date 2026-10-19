import React from "react";
import { Text, View } from "react-native";
import CircleCheck from "lucide-react-native/icons/circle-check";
import CircleDot from "lucide-react-native/icons/circle-dot";
import Clock from "lucide-react-native/icons/clock";

import { Card } from "@/src/components/ui";
import { scrubMessage, eventHistory, displayStateLabel } from "@/src/domain/messageVoice";
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
  timelineWrap: {
    paddingLeft: spacing.md,
    gap: 0,
  },
  row: {
    flexDirection: "row",
    gap: spacing.md,
  },
  line: {
    width: 2,
    backgroundColor: c.divider,
    alignSelf: "stretch",
    marginLeft: 9,
    marginTop: -4,
    marginBottom: -4,
  },
  lineCompleted: {
    backgroundColor: c.resting,
  },
  dot: {
    alignItems: "center",
    justifyContent: "center",
    width: 22,
    height: 22,
    borderRadius: 11,
    marginTop: 2,
    zIndex: 1,
  },
  eventContent: {
    flex: 1,
    paddingBottom: spacing.lg,
    gap: 2,
  },
  eventTitle: {
    fontFamily: fonts.textSemibold,
    fontSize: 14,
    color: c.onSurface,
    lineHeight: 20,
  },
  eventTime: {
    fontFamily: fonts.text,
    fontSize: 12,
    color: c.onSurfaceSecondary,
    lineHeight: 18,
  },
}));

/** Build a complete investigation timeline from event metadata + patrol record. */
function buildInvestigationTimeline(event: PatrolEvent): { title: string; time: string; completed: boolean; isFinal: boolean }[] {
  const entries: { title: string; time: string; completed: boolean; isFinal: boolean }[] = [];
  const record = event.patrol_record;
  const isResolved = !!event.resolved_at;

  // 1. Detection/screening
  const detectedAt = event.occurred_at;
  if (detectedAt) {
    entries.push({
      title: getDetectionLabel(event.category),
      time: formatTimelineDate(detectedAt),
      completed: true,
      isFinal: false,
    });
  }

  // 2. Escalated / investigation started (from freshness)
  const observedAt = record?.freshness?.observedAt;
  if (observedAt && observedAt !== detectedAt) {
    entries.push({
      title: "Investigation started",
      time: formatTimelineDate(observedAt),
      completed: true,
      isFinal: false,
    });
  }

  // 3. Investigation events from eventHistory (messageVoice)
  const voiceTimeline = eventHistory(event, []);
  for (const entry of voiceTimeline) {
    const title = scrubMessage(entry.text).replace(/^- /, "");
    // Avoid duplicating the detection entry we already added
    if (title && !title.toLowerCase().startsWith("apollo ran")) {
      entries.push({
        title,
        time: entry.at ? formatTimelineDate(entry.at) : "",
        completed: !!event.resolved_at,
        isFinal: false,
      });
    }
  }

  // 4. Outcome/resolution
  if (isResolved) {
    entries.push({
      title: `Investigation completed — ${displayStateLabel(event.state)}`,
      time: formatTimelineDate(event.resolved_at!),
      completed: true,
      isFinal: true,
    });
  } else {
    entries.push({
      title: `Active — ${displayStateLabel(event.state)}`,
      time: "",
      completed: false,
      isFinal: true,
    });
  }

  return entries;
}

function getDetectionLabel(category: string): string {
  switch (category) {
    case "email": return "Email detected and screened";
    case "message": return "Message detected and screened";
    case "call": return "Call detected and screened";
    case "website": case "link": return "Link/website submitted for check";
    case "device": return "Device observation detected";
    case "account": return "Account event detected";
    case "file": return "File submitted for check";
    case "app": return "App submitted for check";
    default: return "Item detected and screened";
  }
}

function formatTimelineDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function HistoryTab({ event }: { event: PatrolEvent }) {
  const s = useStyles();
  const { colors } = useTheme();
  const timeline = buildInvestigationTimeline(event);

  return (
    <View style={s.content}>
      {/* History header */}
      <Card style={{ gap: spacing.md }} testID="history-header-card">
        <View style={s.tabHeader}>
          <View style={[s.iconCircle, { backgroundColor: "#DBEAFE" }]}>
            <Clock size={22} color="#1E3A5F" />
          </View>
          <View>
            <Text style={s.tabTitle}>History</Text>
            <Text style={s.tabSubtitle}>Investigation timeline</Text>
          </View>
        </View>
      </Card>

      {/* Timeline */}
      <Card style={{ gap: 0 }} testID="history-timeline">
        <View style={s.timelineWrap}>
          {timeline.map((entry, i) => (
            <View key={i}>
              {/* Connecting line (between dots) */}
              {i > 0 ? (
                <View style={[s.line, entry.completed ? s.lineCompleted : null, { height: spacing.sm }]} />
              ) : null}
              <View style={s.row}>
                {/* Dot */}
                <View style={[s.dot]}>
                  {entry.isFinal && entry.completed ? (
                    <CircleCheck size={20} color={colors.resting} />
                  ) : entry.isFinal && !entry.completed ? (
                    <CircleDot size={20} color={colors.barking} />
                  ) : entry.completed ? (
                    <CircleCheck size={18} color={colors.resting} />
                  ) : (
                    <CircleDot size={18} color={colors.onSurfaceTertiary} />
                  )}
                </View>
                {/* Content */}
                <View style={s.eventContent}>
                  <Text style={s.eventTitle}>{entry.title}</Text>
                  {entry.time ? <Text style={s.eventTime}>{entry.time}</Text> : null}
                </View>
              </View>
            </View>
          ))}
        </View>
      </Card>
    </View>
  );
}
