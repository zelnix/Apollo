import React from "react";
import { Text, View } from "react-native";

import { Body, Card, toneColor } from "@/src/components/ui";
import { eventHistory, sourceLabel } from "@/src/domain/messageVoice";
import type { PatrolEvent, PatrolRecord } from "@/src/domain/types";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  content: { gap: spacing.lg },
  sub: {
    fontFamily: fonts.display,
    fontSize: 13,
    color: c.onSurfaceSecondary,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  meta: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  // Timeline styles
  timelineItem: {
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 48,
  },
  timelineTrack: {
    alignItems: "center",
    width: 20,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    marginTop: 4,
  },
  timelineContent: {
    flex: 1,
    paddingBottom: spacing.lg,
  },
  timelineText: {
    fontFamily: fonts.textMedium,
    fontSize: 14,
    lineHeight: 20,
    color: c.onSurface,
  },
  timelineTime: {
    fontFamily: fonts.text,
    fontSize: 12,
    color: c.muted,
    marginTop: 2,
  },
}));

/** Deduplicate history entries — removes adjacent entries with identical text (ignoring timestamps). */
function deduplicateHistory(
  entries: { at: string; text: string }[]
): { at: string; text: string }[] {
  if (entries.length <= 1) return entries;
  const result: { at: string; text: string }[] = [entries[0]];
  for (let i = 1; i < entries.length; i++) {
    if (entries[i].text !== entries[i - 1].text) {
      result.push(entries[i]);
    }
  }
  return result;
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

  const rawHistory = eventHistory(
    event,
    timeline.map((r) => ({
      occurredAt: r.occurredAt,
      effectiveState: r.effectiveState,
      summary: r.summary,
      revision: r.revision,
    }))
  );
  const history = deduplicateHistory(rawHistory);

  return (
    <View style={s.content}>
      {/* Timeline */}
      <Card style={{ gap: spacing.md }} testID="history-timeline">
        <Text style={s.sub}>Event timeline</Text>
        {history.map((entry, i) => {
          const isLast = i === history.length - 1;
          const isFirst = i === 0;
          const isResolution =
            entry.text.toLowerCase().includes("resolved") ||
            entry.text.toLowerCase().includes("contained");
          const dotColor = isResolution
            ? colors.resting
            : isFirst
            ? toneColor(colors, event.state)
            : colors.onSurfaceSecondary;

          return (
            <View key={i} style={s.timelineItem} testID={`history-entry-${i}`}>
              {/* Track (dot + line) */}
              <View style={s.timelineTrack}>
                <View
                  style={[s.timelineDot, { backgroundColor: dotColor }]}
                />
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
              <View style={s.timelineContent}>
                <Text style={s.timelineText}>{entry.text}</Text>
                {entry.at ? (
                  <Text style={s.timelineTime}>
                    {new Date(entry.at).toLocaleString()}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })}
      </Card>

      {/* Source & metadata footer */}
      <Card style={{ gap: spacing.sm }} testID="history-metadata">
        <Text style={s.sub}>Details</Text>
        <View style={{ gap: spacing.xs }}>
          <Text style={s.meta}>
            {sourceLabel(outcomeSource)}
          </Text>
          <Text style={s.meta}>
            Occurred {new Date(event.occurred_at).toLocaleString()}
          </Text>
          {event.resolved_at ? (
            <Text style={s.meta}>
              Resolved {new Date(event.resolved_at).toLocaleString()}
            </Text>
          ) : null}
          {event.patrol_record?.recordId ? (
            <Text style={s.meta} selectable>
              Record: {event.patrol_record.recordId}
            </Text>
          ) : null}
          {event.patrol_record?.revision != null ? (
            <Text style={s.meta}>
              Revision: {event.patrol_record.revision}
            </Text>
          ) : null}
        </View>
      </Card>
    </View>
  );
}
