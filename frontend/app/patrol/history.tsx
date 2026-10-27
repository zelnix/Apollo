// Patrol history — the full, chronological record of everything Apollo has filed on this device:
// every check, finding, block and device check, newest first. Threats shows one row per case; this
// shows the record as it happened, including items that are closed or found nothing.
//
// Nothing is re-analysed here. Each row restates what was filed at the time.
import { Redirect, useRouter } from "expo-router";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Download from "lucide-react-native/icons/download";
import React, { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CheckToolHeader } from "@/src/components/CheckToolHeader";
import { Body, Button, Card, Pill } from "@/src/components/ui";
import { STATUS_COLORS, STATUS_LABELS, isSimulated, threatCaseStatus, threatCaseId } from "@/src/domain/threatCase";
import type { PatrolEvent } from "@/src/domain/types";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { exportPatrolPdf } from "@/src/utils/exportPatrol";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md },
  content: { paddingHorizontal: spacing.xl, gap: spacing.md },
  dayLabel: { fontFamily: fonts.displayBold, fontSize: 13, color: c.onSurfaceSecondary, marginTop: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 44, paddingVertical: spacing.sm },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface, lineHeight: 19 },
  rowMeta: { fontFamily: fonts.text, fontSize: 12, color: c.onSurfaceSecondary },
  pill: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  pillText: { fontFamily: fonts.textSemibold, fontSize: 11 },
  divider: { height: 1, backgroundColor: c.border },
}));

const dayKey = (iso: string) => {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(date, today)) return "Today";
  if (same(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });
};

export default function PatrolHistory() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { ready, setupDone, events, showToast, deviceId } = useApollo();
  const [exporting, setExporting] = useState(false);

  // Every filed event, newest first — not deduplicated, so repeat checks on the same thing are all visible.
  const days = useMemo(() => {
    const sorted = [...events].sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());
    const grouped: { label: string; rows: PatrolEvent[] }[] = [];
    for (const event of sorted) {
      const label = dayKey(event.occurred_at);
      const last = grouped[grouped.length - 1];
      if (last && last.label === label) last.rows.push(event);
      else grouped.push({ label, rows: [event] });
    }
    return grouped;
  }, [events]);

  if (ready && !setupDone) return <Redirect href="/onboarding" />;

  const share = async () => {
    setExporting(true);
    try {
      const outcome = await exportPatrolPdf(events, deviceId);
      if (outcome === "printed") showToast("Opened the history for printing or saving.", "neutral");
    } catch {
      showToast("ApolloSG couldn't produce the history file.", "growling");
    } finally { setExporting(false); }
  };

  return (
    <View style={s.root} testID="patrol-history-root">
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <CheckToolHeader
          title="Patrol history"
          info={{ title: "About patrol history", body: [
            "Everything ApolloSG has filed on this device, newest first: checks you ran, findings, blocks and device checks.",
            "Threats lists one row per case. This lists the record as it happened, including cases that are closed or found nothing.",
          ] }}
          testID="patrol-history"
        />
      </View>
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} testID="patrol-history-scroll">
        {days.length === 0 ? (
          <Card testID="patrol-history-empty">
            <Body>ApolloSG hasn&apos;t filed anything yet. Checks you run and anything Apollo finds will be recorded here.</Body>
          </Card>
        ) : (
          <>
            <Button testID="patrol-history-export" variant="ghost" label={exporting ? "Preparing…" : "Save or share this history"}
              icon={<Download size={18} color={colors.onSurface} />} onPress={() => void share()} disabled={exporting} />
            {days.map((day) => (
              <View key={day.label} style={{ gap: spacing.xs }}>
                <Text style={s.dayLabel}>{day.label}</Text>
                <Card style={{ gap: 0 }} testID={`patrol-history-day-${day.label}`}>
                  {day.rows.map((event, index) => {
                    const status = threatCaseStatus(event);
                    const colour = STATUS_COLORS[status];
                    return (
                      <React.Fragment key={event.event_id}>
                        {index > 0 ? <View style={s.divider} /> : null}
                        <Pressable
                          testID={`patrol-history-row-${event.event_id}`}
                          accessibilityRole="button"
                          accessibilityLabel={`${event.headline}. ${STATUS_LABELS[status]}. Open this case.`}
                          onPress={() => router.push(`/patrol/${event.event_id}`)}
                          style={({ pressed }) => [s.row, { opacity: pressed ? 0.7 : 1 }]}
                        >
                          <View style={s.rowBody}>
                            <Text style={s.rowTitle} numberOfLines={2}>{event.headline}</Text>
                            <Text style={s.rowMeta}>
                              {new Date(event.occurred_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {threatCaseId(event)}
                            </Text>
                          </View>
                          {isSimulated(event) ? <Pill compact label="Simulated" testID={`patrol-history-row-${event.event_id}-simulated`} /> : null}
                          <View style={[s.pill, { backgroundColor: colour.bg }]}>
                            <Text style={[s.pillText, { color: colour.text }]}>{STATUS_LABELS[status]}</Text>
                          </View>
                          <ChevronRight size={18} color={colors.muted} />
                        </Pressable>
                      </React.Fragment>
                    );
                  })}
                </Card>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}
