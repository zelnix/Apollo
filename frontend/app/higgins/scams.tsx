import * as Linking from "expo-linking";
import { router, useSegments } from "expo-router";
import ExternalLink from "lucide-react-native/icons/external-link";
import Share2 from "lucide-react-native/icons/share-2";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Share, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChildScreenHeader } from "@/src/components/ChildScreenHeader";
import { RootScreenHeader } from "@/src/components/RootScreenHeader";
import { MultiSelectFilter } from "@/src/components/MultiSelectFilter";
import { Body, Button, Card, Pill, type Tone } from "@/src/components/ui";
import { governmentScams, type GovernmentAlert } from "@/src/higgins/hubClient";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

type FilterId = "AU" | "GLOBAL" | "US" | "UK" | "EU" | "HIGH" | "EXTREME";
// Multi-select options (OR semantics). An empty selection shows every alert.
const FILTER_OPTIONS: { id: FilterId; label: string }[] = [
  { id: "AU", label: "Australia" }, { id: "US", label: "USA" }, { id: "UK", label: "United Kingdom" },
  { id: "EU", label: "Europe" }, { id: "GLOBAL", label: "Global" }, { id: "HIGH", label: "High severity" }, { id: "EXTREME", label: "Extreme severity" },
];
const singleMatch = (it: GovernmentAlert, f: FilterId): boolean =>
  f === "AU" ? (it.region === "AU" || it.australianRelevance === "confirmed")
    : f === "HIGH" ? it.severity === "HIGH"
      : f === "EXTREME" ? it.severity === "EXTREME"
        : it.region === f;

const SEVERITY_TONE: Record<GovernmentAlert["severity"], Tone> = { EXTREME: "barking", HIGH: "growling", MODERATE: "ears_up", LOW: "neutral" };
const RELEVANCE_LABEL: Record<GovernmentAlert["australianRelevance"], string> = { confirmed: "Confirmed in Australia", potential: "Could reach Australia", overseas_only: "Overseas only", unknown: "Relevance unknown" };

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  list: { paddingHorizontal: spacing.xl, gap: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 17, lineHeight: 23, color: c.onSurface },
  sectionHeading: { fontFamily: fonts.displayBold, fontSize: 15, color: c.onSurface, marginTop: spacing.md },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  spread: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  link: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.brand },
  filterChip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary },
  filterChipOn: { backgroundColor: c.brand, borderColor: c.brand },
  filterText: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.onSurface },
  filterTextOn: { color: "#FFFFFF" },
  source: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.onSurface },
  meta: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceSecondary },
  shareChip: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary, minHeight: 40 },
  shareChipText: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.onSurface },
}));

/** Compose a plain-text share message with the alert and its official source, and open the native
 *  share sheet (SMS, WhatsApp, Email, etc.). Uses React Native's built-in Share API — nothing is
 *  sent to Apollo's servers; the OS picks who the message is forwarded to. */
export async function shareScamAlert(alert: GovernmentAlert): Promise<void> {
  const relevance = RELEVANCE_LABEL[alert.australianRelevance];
  const headline = (alert.higgins.whatHappened || alert.summary || "").trim();
  const lines = [
    `⚠️ Scam alert: ${alert.title}`,
    `Source: ${alert.source} · ${alert.dateLabel}`,
    `Severity: ${alert.severity === "LOW" ? "Info" : alert.severity[0] + alert.severity.slice(1).toLowerCase()} · ${relevance}`,
    headline ? `\n${headline}` : "",
    `\nOfficial source: ${alert.url}`,
    `\nShared from Apollo Cyber Security.`,
  ].filter(Boolean);
  const message = lines.join("\n");
  try {
    await Share.share({ title: alert.title, message, url: alert.url }, { subject: `Scam alert: ${alert.title}`, dialogTitle: "Share this scam alert" });
  } catch {
    // The person dismissed the sheet or the OS rejected it — no further action needed.
  }
}

function AlertCard({ item, index }: { item: GovernmentAlert; index: number }) {
  const s = useStyles(); const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Open official source: ${item.title}`}
      onPress={() => void Linking.openURL(item.url)}
      testID={`higgins-scam-${index}`}
      style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
    >
      <Card style={{ gap: spacing.sm, borderColor: item.growling ? colors.growling : undefined }}>
        <View style={s.row}>
          <Pill testID={`higgins-scam-${index}-severity`} tone={SEVERITY_TONE[item.severity]} label={item.severity === "LOW" ? "Info" : `${item.severity[0]}${item.severity.slice(1).toLowerCase()}`} />
          <Pill tone="neutral" label={item.regionLabel} />
          <Pill tone={item.australianRelevance === "confirmed" ? "growling" : "neutral"} label={RELEVANCE_LABEL[item.australianRelevance]} />
        </View>
        <Text style={s.title}>{item.title}</Text>
        <Text style={s.source} testID={`higgins-scam-${index}-source-name`}>{item.source}<Text style={s.meta}>{`  ·  ${item.dateLabel}`}</Text></Text>
        {item.higgins.whatHappened ? <Body>{item.higgins.whatHappened}</Body> : item.summary ? <Body>{item.summary}</Body> : null}
        <View style={s.row}>
          <Button testID={`higgins-scam-${index}-ask`} variant="secondary" label="Ask Higgins about this" onPress={() => router.push({ pathname: "/(tabs)/ask", params: { scamTitle: item.title, scamSource: item.source, scamUrl: item.url, scamSummary: (item.higgins.whatHappened || item.summary || "").slice(0, 600) } })} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Share this scam alert: ${item.title}`}
            onPress={() => void shareScamAlert(item)}
            testID={`higgins-scam-${index}-share`}
            style={({ pressed }) => [s.shareChip, { opacity: pressed ? 0.7 : 1 }]}
            hitSlop={8}
          >
            <Share2 size={14} color={colors.onSurface} />
            <Text style={s.shareChipText}>Share alert</Text>
          </Pressable>
        </View>
        <View style={s.spread} testID={`higgins-scam-${index}-source`}>
          <Text style={s.link}>Open official source</Text><ExternalLink size={18} color={colors.brand} />
        </View>
      </Card>
    </Pressable>
  );
}

export default function GovernmentScamsScreen() {
  const s = useStyles(); const { colors } = useTheme(); const insets = useSafeAreaInsets();
  const [alerts, setAlerts] = useState<GovernmentAlert[]>([]); const [emerging, setEmerging] = useState<GovernmentAlert[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [coverage, setCoverage] = useState(""); const [lastSourced, setLastSourced] = useState<string | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(false);
  const [filters, setFilters] = useState<string[]>([]);
  const segments = useSegments();
  const isTab = (segments as string[]).includes("(tabs)");
  const load = () => {
    setLoading(true); setError(false);
    void governmentScams().then((result) => {
      setAlerts(result.alerts); setEmerging(result.emerging); setPendingCount(result.pendingCount);
      setCoverage(result.coverage); setLastSourced(result.lastSourcedAt);
    }).catch(() => setError(true)).finally(() => setLoading(false));
  };
  useEffect(load, []);
  const sourcedLabel = useMemo(() => {
    if (!lastSourced) return "Checking official sources…";
    const d = new Date(lastSourced);
    return `Last sourced ${d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
  }, [lastSourced]);
  const info = { title: "About Scam Alerts", body: [coverage || "Specific scam campaigns reported by recognised government and official cyber-authority sources (Australia, USA, UK, EU), each read and explained from the source itself.", "General scam education lives in Learn with Higgins. Emerging patterns are techniques appearing across several reports with no single named campaign yet."] };
  const matchFilter = useCallback((it: GovernmentAlert) => filters.length === 0 ? true : filters.some((f) => singleMatch(it, f as FilterId)), [filters]);
  const shown = useMemo(() => alerts.filter(matchFilter), [alerts, matchFilter]);
  const shownEmerging = useMemo(() => emerging.filter(matchFilter), [emerging, matchFilter]);
  return (
    <View style={s.root} testID="higgins-scams-screen">
      {isTab
        ? <View style={{ paddingTop: insets.top + spacing.md }}><RootScreenHeader title="Scam Alerts" testID="higgins-scams-header" info={info} /></View>
        : <ChildScreenHeader title="Scam Alerts" testID="higgins-scams-header" info={info} />}
      <FlatList
        testID="higgins-scams-list" data={shown} keyExtractor={(item) => item.url}
        contentContainerStyle={[s.list, { paddingBottom: insets.bottom + spacing.xl }]}
        ListHeaderComponent={
          <View style={{ gap: spacing.md }}>
            <View style={s.spread}>
              <Text style={s.meta} testID="higgins-scams-sourced">{sourcedLabel}</Text>
              {pendingCount > 0 ? <Text style={s.meta} testID="higgins-scams-pending">Reading {pendingCount} new…</Text> : null}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: 2 }}>
              <MultiSelectFilter options={FILTER_OPTIONS} selected={filters} onChange={setFilters} title="Filter alerts" testID="scam-filter" />
            </ScrollView>
          </View>
        }
        renderItem={({ item, index }) => <AlertCard item={item} index={index} />}
        ListEmptyComponent={loading ? <ActivityIndicator testID="higgins-scams-loading" color={colors.brand} /> : error ? (
          <Card testID="higgins-scams-error"><Body>Official guidance could not be loaded. Apollo will not substitute unrecognised sources.</Body><Button testID="higgins-scams-retry" label="Try again" onPress={load} /></Card>
        ) : (
          <Card testID="higgins-scams-empty"><Body>{pendingCount > 0 ? "Apollo is still reading the latest official reports. Specific alerts will appear here once their facts are verified." : filters.length === 0 ? "No specific scam campaigns are being reported by the configured official sources right now. This does not mean there are no new scams." : "No alerts match the filters you chose right now."}</Body></Card>
        )}
        ListFooterComponent={
          <View style={{ gap: spacing.sm }}>
            {shownEmerging.length > 0 ? (
              <>
                <Text style={s.sectionHeading} testID="higgins-scams-emerging-heading">Emerging patterns</Text>
                <Body>Techniques showing up across several reports. No single named campaign yet — stay aware.</Body>
                {shownEmerging.map((item, i) => <AlertCard key={item.url} item={item} index={1000 + i} />)}
              </>
            ) : null}
            <Card testID="higgins-scams-learn" style={{ gap: spacing.xs, marginTop: spacing.md }}>
              <Text style={s.title}>Want the background?</Text>
              <Body>General scam education — how common scams work and how to stay safe — lives in Learn with Higgins.</Body>
              <Button testID="higgins-scams-learn-link" variant="secondary" label="Open Learn with Higgins" onPress={() => router.push("/higgins/learning")} />
            </Card>
          </View>
        }
      />
    </View>
  );
}
