// Settings > Diagnostics > Feed health — sync status of every government feed Apollo reads.
import { useRouter } from "expo-router";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppMenuButton } from "@/src/components/AppMenu";

import { FeedHealthRow } from "@/src/components/FeedHealthRow";
import { InfoButton, type ScreenInfo } from "@/src/components/InfoButton";
import { Body, Button, Card, SectionTitle } from "@/src/components/ui";
import { relativeAge, summaryHeadline, type FeedHealthReport } from "@/src/domain/feedHealth";
import { feedHealth } from "@/src/higgins/hubClient";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

const INFO: ScreenInfo = { title: "About Feed health", body: [
  "ApolloSG reads official scam and cyber-security feeds from government sources, and free public threat lists. This screen shows whether each one is syncing.",
  "Healthy: the latest sync worked and it was in the last 24 hours. Stale: no successful sync in the last 24 hours. Failing: the latest sync attempt failed — the reason is shown under the feed.",
  "ApolloSG retries every feed on its own schedule. Pull down to refresh this screen.",
] };

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingBottom: spacing.md },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center", marginLeft: -spacing.sm },
  title: { flex: 1, fontFamily: fonts.displayBold, fontSize: 24, color: c.onSurface },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  headline: { fontFamily: fonts.displayBold, fontSize: 18, color: c.onSurface },
  counts: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  count: { flex: 1, alignItems: "center", paddingVertical: spacing.sm, borderRadius: 12 },
  countValue: { fontFamily: fonts.displayBold, fontSize: 22 },
  countLabel: { fontFamily: fonts.textMedium, fontSize: 12 },
  meta: { fontFamily: fonts.text, fontSize: 12, color: c.muted, marginTop: spacing.md },
  center: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xl },
}));

export default function FeedHealthScreen() {
  const s = useStyles(); const insets = useSafeAreaInsets(); const router = useRouter(); const { colors } = useTheme();
  // The feed report needs this device's credential; on a cold start it arrives a moment after the screen mounts.
  const { deviceId } = useApollo();
  const [report, setReport] = useState<FeedHealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      setReport(await feedHealth()); setError(null);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "ApolloSG couldn't load feed health.");
    } finally {
      setNow(Date.now()); setLoading(false); setRefreshing(false);
    }
  }, []);
  useEffect(() => { if (deviceId) void load(); }, [load, deviceId]);

  const counts = report ? [
    { key: "healthy", label: "Healthy", value: report.summary.healthy, fg: colors.restingText, bg: colors.restingTint },
    { key: "stale", label: "Stale", value: report.summary.stale, fg: colors.growlingText, bg: colors.growlingTint },
    { key: "failing", label: "Failing", value: report.summary.failing, fg: colors.barkingText, bg: colors.barkingTint },
  ] : [];

  return <View style={s.root} testID="feed-health-screen">
    <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" testID="feed-health-back" onPress={() => goBackOrHome(router)} style={s.back}>
        <ChevronLeft size={24} color={colors.onSurface} />
      </Pressable>
      <Text style={s.title} testID="feed-health-title">Feed health</Text>
      <InfoButton info={INFO} testID="feed-health-info" />
      <AppMenuButton testID="feed-health-menu" />
    </View>
    <ScrollView
      contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.brand} />}
      testID="feed-health-scroll"
    >
      {loading ? (
        <View style={s.center} testID="feed-health-loading"><ActivityIndicator color={colors.brand} /><Body>Checking each feed…</Body></View>
      ) : error && !report ? (
        <Card testID="feed-health-error">
          <Body>{error}</Body>
          <Button testID="feed-health-retry" variant="secondary" label="Try again" onPress={() => { setLoading(true); void load(); }} />
        </Card>
      ) : report ? (
        <>
          <Card testID="feed-health-summary">
            <Text style={s.headline} testID="feed-health-headline">{summaryHeadline(report)}</Text>
            <View style={s.counts}>
              {counts.map((c) => (
                <View key={c.key} style={[s.count, { backgroundColor: c.bg }]} testID={`feed-health-count-${c.key}`}>
                  <Text style={[s.countValue, { color: c.fg }]}>{c.value}</Text>
                  <Text style={[s.countLabel, { color: c.fg }]}>{c.label}</Text>
                </View>
              ))}
            </View>
            <Text style={s.meta}>{`Stale means no successful sync in ${report.staleAfterHours} hours · Checked ${relativeAge(report.generatedAt, now)}`}</Text>
          </Card>
          {error ? <Body testID="feed-health-refresh-error">{`Couldn't refresh: ${error}`}</Body> : null}
          <View>
            <SectionTitle>Government feeds and threat lists</SectionTitle>
            <Card testID="feed-health-list">
              {report.feeds.length === 0
                ? <Body testID="feed-health-empty">No government feeds are switched on.</Body>
                : report.feeds.map((feed, i) => <FeedHealthRow key={feed.feedId} feed={feed} now={now} first={i === 0} />)}
            </Card>
          </View>
        </>
      ) : null}
    </ScrollView>
  </View>;
}
