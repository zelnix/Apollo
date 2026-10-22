/**
 * Apollo Alerts — a clean, user-facing list of notifications and patrol findings.
 * Reached via the bell icon on every screen. Shows:
 * 1. Device posture (security-relevant device settings)
 * 2. Patrol events (threats Apollo detected)
 * 3. Notification history (alerts Apollo sent)
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ShieldAlert, Bell, ChevronRight, ShieldCheck, ShieldX, AlertTriangle } from "lucide-react-native";

import { useApollo } from "@/src/store/ApolloContext";
import { ChildScreenHeader } from "@/src/components/ChildScreenHeader";
import { Body, Card, Pill, SectionTitle } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { alertHistory, type AlertHistoryRow } from "@/src/domain/alertHistory";
import { getAlertHistory } from "@/src/push/notifications";
import { readAlertLog } from "@/src/push/alertLog";
import { STATE_NAME, type ApolloState } from "@/src/domain/types";
import type { PostureSnapshot, PostureCheckResult } from "@/src/security/devicePosture";
import { runPostureCheck, getLastPostureSnapshot } from "@/src/security/postureMonitor";

const TONE_MAP: Record<ApolloState, "resting" | "growling" | "barking" | "unknown"> = {
  sniffing: "unknown", resting: "resting", ears_up: "unknown", growling: "growling", barking: "barking", biting: "barking",
};

function relativeTime(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  if (diff < 0 || !Number.isFinite(diff)) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export default function AlertsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors } = useTheme();
  const s = useStyles();
  const { events } = useApollo();

  const [history, setHistory] = useState<AlertHistoryRow[]>([]);
  const [posture, setPosture] = useState<PostureSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [server, device] = await Promise.all([
        getAlertHistory().catch(() => []),
        readAlertLog().catch(() => []),
      ]);
      setHistory(alertHistory(server, device));
      // Always try to load or generate a posture snapshot
      let snap = await getLastPostureSnapshot().catch(() => null);
      if (!snap) {
        try {
          const result = await runPostureCheck();
          snap = result.snapshot;
        } catch { /* posture check failed, ok */ }
      }
      setPosture(snap);
    } catch {
      // keep whatever we had
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshPosture = useCallback(async () => {
    setLoading(true);
    try {
      const result = await runPostureCheck();
      setPosture(result.snapshot);
      const [server, device] = await Promise.all([
        getAlertHistory().catch(() => []),
        readAlertLog().catch(() => []),
      ]);
      setHistory(alertHistory(server, device));
    } catch {
      // keep whatever we had
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Posture checks grouped by severity
  const postureIssues = useMemo(() => {
    if (!posture) return { critical: [] as PostureCheckResult[], warning: [] as PostureCheckResult[], ok: [] as PostureCheckResult[] };
    const critical = posture.checks.filter((c) => c.observable && c.severity === "critical");
    const warning = posture.checks.filter((c) => c.observable && c.severity === "warning");
    const ok = posture.checks.filter((c) => c.observable && c.severity === "ok");
    return { critical, warning, ok };
  }, [posture]);

  const hasPostureIssues = postureIssues.critical.length > 0 || postureIssues.warning.length > 0;

  // Patrol events — active threats and recent findings
  const activeEvents = useMemo(() =>
    events
      .slice()
      .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))
      .slice(0, 50),
    [events],
  );

  const hasContent = activeEvents.length > 0 || history.length > 0 || posture !== null;

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <ChildScreenHeader title="Alerts" testID="alerts" />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refreshPosture} tintColor={colors.gold} />}
      >

        {/* Device Posture */}
        {posture ? (
          <View>
            <SectionTitle>Device posture</SectionTitle>
            {/* Summary card */}
            <Card style={[s.postureCard, hasPostureIssues ? s.postureCardWarn : s.postureCardOk]}>
              <View style={s.postureHeader}>
                {hasPostureIssues
                  ? <ShieldX size={22} color={postureIssues.critical.length > 0 ? colors.barking : colors.growling} />
                  : <ShieldCheck size={22} color={colors.resting} />}
                <View style={{ flex: 1 }}>
                  <Text style={[s.postureTitle, { color: hasPostureIssues ? (postureIssues.critical.length > 0 ? colors.barking : colors.growling) : colors.resting }]}>
                    {hasPostureIssues
                      ? `${postureIssues.critical.length + postureIssues.warning.length} setting${(postureIssues.critical.length + postureIssues.warning.length) > 1 ? "s" : ""} need${(postureIssues.critical.length + postureIssues.warning.length) === 1 ? "s" : ""} attention`
                      : "Device settings look good"}
                  </Text>
                  <Text style={s.postureSubtitle}>
                    {posture.checks.filter((c) => c.observable).length} checks · Last scanned {relativeTime(posture.capturedAt)}
                  </Text>
                </View>
              </View>
            </Card>

            {/* Critical issues */}
            {postureIssues.critical.map((c) => (
              <View key={c.id} style={s.postureRow} testID={`posture-${c.id}`}>
                <View style={[s.iconWrap, { backgroundColor: colors.barkingTint }]}>
                  <ShieldX size={14} color={colors.barking} />
                </View>
                <View style={s.eventContent}>
                  <View style={s.eventHeader}>
                    <Pill tone="barking" label="Critical" testID={`posture-pill-${c.id}`} />
                  </View>
                  <Text style={s.eventTitle} numberOfLines={1}>{c.label}: {c.value}</Text>
                  <Text style={s.eventSub} numberOfLines={2}>{c.detail}</Text>
                </View>
              </View>
            ))}

            {/* Warnings */}
            {postureIssues.warning.map((c) => (
              <View key={c.id} style={s.postureRow} testID={`posture-${c.id}`}>
                <View style={[s.iconWrap, { backgroundColor: colors.growlingTint }]}>
                  <AlertTriangle size={14} color={colors.growling} />
                </View>
                <View style={s.eventContent}>
                  <View style={s.eventHeader}>
                    <Pill tone="growling" label="Warning" testID={`posture-pill-${c.id}`} />
                  </View>
                  <Text style={s.eventTitle} numberOfLines={1}>{c.label}: {c.value}</Text>
                  <Text style={s.eventSub} numberOfLines={2}>{c.detail}</Text>
                </View>
              </View>
            ))}

            {/* OK checks (collapsed) */}
            {postureIssues.ok.length > 0 && !hasPostureIssues ? (
              <Text style={s.postureOkSummary}>
                All {postureIssues.ok.length} observable checks passed.
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Patrol findings */}
        {activeEvents.length > 0 ? (
          <View>
            <SectionTitle>Threat findings</SectionTitle>
            {activeEvents.map((e) => (
              <Pressable
                key={e.event_id}
                testID={`alert-event-${e.event_id}`}
                accessibilityRole="button"
                accessibilityLabel={`${STATE_NAME[e.state]}: ${e.headline}`}
                onPress={() => router.push({ pathname: "/patrol/[id]", params: { id: e.event_id } })}
                style={({ pressed }) => [s.eventRow, { opacity: pressed ? 0.7 : 1 }]}
              >
                <View style={[s.iconWrap, { backgroundColor: e.state === "barking" || e.state === "biting" ? colors.barkingTint : e.state === "growling" ? colors.growlingTint : colors.surfaceTertiary }]}>
                  <ShieldAlert size={16} color={e.state === "barking" || e.state === "biting" ? colors.barking : e.state === "growling" ? colors.growling : colors.onSurfaceSecondary} />
                </View>
                <View style={s.eventContent}>
                  <View style={s.eventHeader}>
                    <Pill tone={TONE_MAP[e.state]} label={STATE_NAME[e.state]} testID={`alert-event-pill-${e.event_id}`} />
                    <Text style={s.time}>{relativeTime(e.occurred_at)}</Text>
                  </View>
                  <Text style={s.eventTitle} numberOfLines={2}>{e.headline}</Text>
                  <Text style={s.eventSub} numberOfLines={2}>{e.what_happened}</Text>
                </View>
                <ChevronRight size={14} color={colors.onSurfaceSecondary} />
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* Notification history */}
        {history.length > 0 ? (
          <View>
            <SectionTitle>Notification history</SectionTitle>
            {history.map((row) => (
              <View key={row.id} style={s.notifRow} testID={`alert-notif-${row.id}`}>
                <View style={[s.iconWrap, { backgroundColor: colors.surfaceTertiary }]}>
                  <Bell size={14} color={colors.onSurfaceSecondary} />
                </View>
                <View style={s.eventContent}>
                  <View style={s.eventHeader}>
                    <Text style={s.time}>{relativeTime(row.at)}</Text>
                    {row.opened ? <Text style={[s.time, { color: colors.resting }]}>Opened</Text> : null}
                  </View>
                  <Text style={s.eventTitle} numberOfLines={2}>{row.title}</Text>
                  <Text style={s.eventSub} numberOfLines={1}>{row.status}</Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        {/* Empty state */}
        {!loading && !hasContent ? (
          <Card style={s.emptyCard}>
            <Body testID="alerts-empty">
              Apollo hasn&apos;t raised any alerts yet. When Apollo detects a threat or sends a notification, it will appear here.
            </Body>
          </Card>
        ) : null}

        {/* Loading state */}
        {loading && !hasContent ? (
          <View style={s.loadingWrap}>
            <ActivityIndicator color={colors.gold} />
          </View>
        ) : null}

      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  scroll: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg },
  postureCard: {
    borderWidth: 1, borderRadius: radius.md, padding: spacing.md,
  },
  postureCardOk: { borderColor: c.resting, backgroundColor: c.restingTint ?? c.surfaceTertiary },
  postureCardWarn: { borderColor: c.growling, backgroundColor: c.growlingTint ?? c.surfaceTertiary },
  postureHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  postureTitle: { fontFamily: fonts.textSemibold, fontSize: 15, lineHeight: 20 },
  postureSubtitle: { fontFamily: fonts.text, fontSize: 12, color: c.onSurfaceSecondary, lineHeight: 17 },
  postureRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.border,
  },
  postureOkSummary: {
    fontFamily: fonts.text, fontSize: 13, color: c.resting, textAlign: "center",
    paddingVertical: spacing.sm,
  },
  eventRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: c.border,
  },
  notifRow: {
    flexDirection: "row", alignItems: "flex-start", gap: spacing.sm,
    paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.border,
  },
  iconWrap: {
    width: 32, height: 32, borderRadius: radius.sm, alignItems: "center", justifyContent: "center",
  },
  eventContent: { flex: 1, gap: 2 },
  eventHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  eventTitle: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface, lineHeight: 19 },
  eventSub: { fontFamily: fonts.text, fontSize: 12, color: c.onSurfaceSecondary, lineHeight: 17 },
  time: { fontFamily: fonts.text, fontSize: 11, color: c.onSurfaceSecondary },
  emptyCard: { marginTop: spacing.xl },
  loadingWrap: { paddingVertical: spacing.xl, alignItems: "center" },
}));
