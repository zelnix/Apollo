import * as Linking from "expo-linking";
import { router, useSegments } from "expo-router";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import ExternalLink from "lucide-react-native/icons/external-link";
import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChildScreenHeader } from "@/src/components/ChildScreenHeader";
import { RootScreenHeader } from "@/src/components/RootScreenHeader";
import { Body, Button, Card, Pill, type Tone } from "@/src/components/ui";
import { governmentScams, type GovernmentAlert, type GovernmentFeedState } from "@/src/higgins/hubClient";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

type FilterId = "all" | "AU" | "GLOBAL" | "US" | "UK" | "EU" | "HIGH" | "EXTREME";
const FILTERS: { id: FilterId; label: string }[] = [
  { id: "all", label: "All" }, { id: "AU", label: "Australia" }, { id: "GLOBAL", label: "Global" },
  { id: "US", label: "USA" }, { id: "UK", label: "United Kingdom" }, { id: "EU", label: "Europe" },
  { id: "HIGH", label: "High" }, { id: "EXTREME", label: "Extreme" },
];

const SEVERITY_TONE: Record<GovernmentAlert["severity"], Tone> = { EXTREME: "barking", HIGH: "growling", MODERATE: "ears_up", LOW: "neutral" };
const RELEVANCE_LABEL: Record<GovernmentAlert["australianRelevance"], string> = { confirmed: "Confirmed in Australia", potential: "Could reach Australia", overseas_only: "Overseas only", unknown: "Relevance unknown" };

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  list: { paddingHorizontal: spacing.xl, gap: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 17, lineHeight: 23, color: c.onSurface },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  spread: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  link: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.brand },
  filterChip: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary },
  filterChipOn: { backgroundColor: c.brand, borderColor: c.brand },
  filterText: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.onSurface },
  filterTextOn: { color: "#FFFFFF" },
  meta: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceSecondary },
  higTitle: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.onSurface, marginTop: spacing.xs },
  higBody: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary },
}));

function HigginsBlock({ alert }: { alert: GovernmentAlert }) {
  const s = useStyles();
  const [open, setOpen] = useState(alert.growling);
  const { colors } = useTheme();
  const h = alert.higgins;
  return (
    <View style={{ gap: spacing.xs }}>
      <Pressable accessibilityRole="button" onPress={() => setOpen((v) => !v)} style={s.spread} testID="scam-higgins-toggle">
        <Text style={s.link}>{open ? "Hide Higgins' explanation" : alert.growling ? "Why is Apollo growling?" : "What Higgins says"}</Text>
        {open ? <ChevronUp size={18} color={colors.brand} /> : <ChevronDown size={18} color={colors.brand} />}
      </Pressable>
      {open ? (
        <View style={{ gap: 2 }}>
          <Text style={s.higTitle}>What happened</Text><Text style={s.higBody}>{h.whatHappened}</Text>
          {alert.growling ? <><Text style={s.higTitle}>Why Apollo is growling</Text><Text style={s.higBody}>{h.whyGrowling}</Text></> : null}
          <Text style={s.higTitle}>Where it&apos;s happening</Text><Text style={s.higBody}>{h.whereHappening}</Text>
          <Text style={s.higTitle}>What it means for Australia</Text><Text style={s.higBody}>{h.whatItMeansForAustralia}</Text>
          <Text style={s.higTitle}>What to watch for</Text><Text style={s.higBody}>{h.whatToWatch}</Text>
          <Text style={s.higTitle}>What to do</Text><Text style={s.higBody}>{h.whatToDo}</Text>
          <Button testID="scam-ask-higgins" variant="ghost" label="Ask Higgins about this" onPress={() => router.push({ pathname: "/(tabs)/ask", params: { scamTitle: alert.title, scamSource: alert.source } })} />
        </View>
      ) : null}
    </View>
  );
}

export default function GovernmentScamsScreen() {
  const s = useStyles(); const { colors } = useTheme(); const insets = useSafeAreaInsets();
  const [items, setItems] = useState<GovernmentAlert[]>([]); const [feeds, setFeeds] = useState<Record<string, GovernmentFeedState>>({});
  const [coverage, setCoverage] = useState(""); const [loading, setLoading] = useState(true); const [error, setError] = useState(false);
  const [filter, setFilter] = useState<FilterId>("all");
  const segments = useSegments();
  const isTab = (segments as string[]).includes("(tabs)");
  const load = () => { setLoading(true); setError(false); void governmentScams().then((result) => { setItems(result.items); setFeeds(result.feeds); setCoverage(result.coverage); }).catch(() => setError(true)).finally(() => setLoading(false)); };
  useEffect(load, []);
  const overall = useMemo(() => { const states = Object.values(feeds).map((feed) => feed.status); return states.length > 0 && states.every((state) => state === "fresh") ? "fresh" : states.some((state) => state === "fresh" || state === "stale") ? "stale" : "unavailable"; }, [feeds]);
  const shown = useMemo(() => items.filter((it) => (filter === "all" || filter === "GLOBAL") ? true : filter === "AU" ? (it.region === "AU" || it.australianRelevance === "confirmed") : filter === "HIGH" ? it.severity === "HIGH" : filter === "EXTREME" ? it.severity === "EXTREME" : it.region === filter), [items, filter]);
  return (
    <View style={s.root} testID="higgins-scams-screen">
      {isTab
        ? <View style={{ paddingTop: insets.top + spacing.md }}><RootScreenHeader title="Scam Alerts" testID="higgins-scams-header" /></View>
        : <ChildScreenHeader title="Scam Alerts" testID="higgins-scams-header" />}
      <FlatList
        testID="higgins-scams-list" data={shown} keyExtractor={(item) => item.url}
        contentContainerStyle={[s.list, { paddingBottom: insets.bottom + spacing.xl }]}
        ListHeaderComponent={
          <View style={{ gap: spacing.md }}>
            <Card testID="higgins-scams-coverage" style={{ gap: spacing.sm }}>
              <View style={s.spread}><Text style={s.title}>Official scam alerts</Text><Pill testID="higgins-scams-feed-state" tone={overall === "fresh" ? "resting" : overall === "stale" ? "growling" : "unknown"} label={overall === "fresh" ? "Sources current" : overall === "stale" ? "Some sources stale" : "Sources unavailable"} /></View>
              <Body>{coverage || "Recognised government and official cyber-authority sources (Australia, USA, UK, EU). Newest first."}</Body>
            </Card>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: 2 }}>
              {FILTERS.map((f) => (
                <Pressable key={f.id} testID={`scam-filter-${f.id}`} accessibilityRole="button" onPress={() => setFilter(f.id)} style={[s.filterChip, filter === f.id && s.filterChipOn]}>
                  <Text style={[s.filterText, filter === f.id && s.filterTextOn]}>{f.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        }
        renderItem={({ item, index }) => (
          <Card style={{ gap: spacing.sm, borderColor: item.growling ? colors.growling : undefined }} testID={`higgins-scam-${index}`}>
            <View style={s.row}>
              <Pill testID={`higgins-scam-${index}-severity`} tone={SEVERITY_TONE[item.severity]} label={item.severity === "LOW" ? "Info" : `${item.severity[0]}${item.severity.slice(1).toLowerCase()}`} />
              <Pill tone="neutral" label={item.regionLabel} />
              <Pill tone={item.australianRelevance === "confirmed" ? "growling" : "neutral"} label={RELEVANCE_LABEL[item.australianRelevance]} />
              <Text style={s.meta}>{item.ageLabel}</Text>
            </View>
            <Text style={s.title}>{item.title}</Text>
            <Body>{item.summary || "Open the official source for details."}</Body>
            <Text style={s.meta}>{item.source} · {item.sourceType === "live_alert" ? "Official alert" : "Official advice"}</Text>
            <HigginsBlock alert={item} />
            <Pressable accessibilityRole="link" accessibilityLabel={`Open official source: ${item.title}`} onPress={() => void Linking.openURL(item.url)} style={s.spread} testID={`higgins-scam-${index}-source`}>
              <Text style={s.link}>Open official source</Text><ExternalLink size={18} color={colors.brand} />
            </Pressable>
          </Card>
        )}
        ListEmptyComponent={loading ? <ActivityIndicator testID="higgins-scams-loading" color={colors.brand} /> : error ? (
          <Card testID="higgins-scams-error"><Body>Official guidance could not be loaded. Apollo will not substitute unrecognised sources.</Body><Button testID="higgins-scams-retry" label="Try again" onPress={load} /></Card>
        ) : (
          <Card testID="higgins-scams-empty"><Body>{filter === "all" ? "No current items are available from the configured official sources. This does not mean there are no new scams." : "No alerts match this filter right now."}</Body></Card>
        )}
      />
    </View>
  );
}
