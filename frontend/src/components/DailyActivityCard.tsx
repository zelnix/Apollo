// Apollo's Day on Patrol — daily activity summary card.
// Improvement 2: "Show Evidence of a Job Well Done"
// Displays meaningful proof that Apollo has completed important security work.
// All data comes from real patrol events. No invented activity.

import Activity from "lucide-react-native/icons/activity";
import Check from "lucide-react-native/icons/check";
import ShieldAlert from "lucide-react-native/icons/shield-alert";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import React, { useMemo } from "react";
import { Text, View } from "react-native";

import { buildDailyActivity, type DailyActivity } from "@/src/domain/dailyActivity";
import type { PatrolEvent } from "@/src/domain/types";
import { Card } from "@/src/components/ui";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  header: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  headerIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.navyTint, alignItems: "center", justifyContent: "center" },
  title: { fontFamily: fonts.displayBold, fontSize: 16, lineHeight: 21, color: c.onSurface },
  subtitle: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  summary: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurface, marginBottom: spacing.sm },
  statsRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  statItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs, minWidth: 100 },
  statValue: { fontFamily: fonts.displayBold, fontSize: 16, color: c.onSurface },
  statLabel: { fontFamily: fonts.text, fontSize: 12, color: c.onSurfaceSecondary },
  noActivity: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary },
}));

function StatItem({ icon, value, label, testID }: {
  icon: React.ReactNode; value: number; label: string; testID?: string;
}) {
  const s = useStyles();
  if (value === 0) return null;
  return (
    <View style={s.statItem} testID={testID}>
      {icon}
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

export function DailyActivityCard({ events, testID }: { events: PatrolEvent[]; testID?: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const activity: DailyActivity = useMemo(() => buildDailyActivity(events), [events]);

  const todayLabel = new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });

  return (
    <Card testID={testID ?? "daily-activity-card"} style={{ gap: 0 }}>
      <View style={s.header}>
        <View style={s.headerIcon}>
          <Activity size={18} color={colors.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>Apollo&apos;s Day on Patrol</Text>
          <Text style={s.subtitle}>{todayLabel}</Text>
        </View>
      </View>

      {/* Higgins summary paragraph — from actual activity records */}
      <Text style={s.summary} testID="daily-activity-summary">{activity.summary}</Text>

      {/* Stat indicators — only show non-zero values */}
      {activity.eventCount > 0 ? (
        <View style={s.statsRow}>
          <StatItem
            icon={<Check size={14} color={colors.resting} />}
            value={activity.checksCompleted}
            label={activity.checksCompleted === 1 ? "check" : "checks"}
            testID="daily-stat-checks"
          />
          <StatItem
            icon={<ShieldAlert size={14} color={colors.growling} />}
            value={activity.threatsDetected}
            label="detected"
            testID="daily-stat-detected"
          />
          <StatItem
            icon={<ShieldCheck size={14} color={colors.resting} />}
            value={activity.threatsBlocked}
            label="blocked"
            testID="daily-stat-blocked"
          />
          <StatItem
            icon={<RefreshCw size={14} color={colors.brand} />}
            value={activity.updatesInstalled}
            label={activity.updatesInstalled === 1 ? "update" : "updates"}
            testID="daily-stat-updates"
          />
        </View>
      ) : null}

      {/* Action needed indicator */}
      {activity.actionNeeded ? (
        <Text style={[s.noActivity, { color: colors.growlingText, fontFamily: fonts.textSemibold, marginTop: spacing.sm }]} testID="daily-action-needed">
          Some findings need your attention.
        </Text>
      ) : null}
    </Card>
  );
}
