// Home: Latest meaningful security activity with timestamp.
// Improvement 1: "Make Apollo's Presence Reassuring" — users should see when Apollo
// last completed important work, and what the outcome was.
// Only shows actual completed activity with real timestamps. Never fabricates activity.

import Clock from "lucide-react-native/icons/clock";
import React, { useMemo } from "react";
import { Text, View } from "react-native";

import type { PatrolEvent } from "@/src/domain/types";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs },
  icon: { width: 28, height: 28, borderRadius: 14, backgroundColor: c.navyTint, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.onSurfaceSecondary },
  time: { fontFamily: fonts.textMedium, fontSize: 12, color: c.muted },
}));

function formatRelativeTime(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return "just now";

  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;

  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;

  return new Date(isoDate).toLocaleDateString([], { day: "numeric", month: "short" });
}

/** Returns the most recent meaningful patrol event (not routine heartbeats). */
function latestMeaningfulEvent(events: PatrolEvent[]): PatrolEvent | null {
  // Look for the most recent event that represents completed work
  for (const ev of events) {
    // Skip routine protection heartbeats and stale items without timestamps
    if (!ev.occurred_at) continue;
    // Any event with a headline is meaningful
    if (ev.headline) return ev;
  }
  return null;
}

export function LatestActivityRow({ events, testID }: { events: PatrolEvent[]; testID?: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const latest = useMemo(() => latestMeaningfulEvent(events), [events]);

  if (!latest) return null;

  const timeLabel = formatRelativeTime(latest.occurred_at);
  const headline = latest.headline || latest.what_happened || "Security check completed";

  // Truncate long headlines for the compact row
  const displayText = headline.length > 80 ? headline.slice(0, 77) + "\u2026" : headline;

  return (
    <View style={s.row} testID={testID ?? "latest-activity-row"}>
      <View style={s.icon}>
        <Clock size={14} color={colors.brand} />
      </View>
      <Text style={s.text} numberOfLines={2}>{displayText}</Text>
      <Text style={s.time}>{timeLabel}</Text>
    </View>
  );
}
