import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChildScreenHeader } from "@/src/components/ChildScreenHeader";
import { Body, Button, Card, Pill } from "@/src/components/ui";
import { higginsHubHistory, type HigginsHistoryItem } from "@/src/higgins/hubClient";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({ root: { flex: 1, backgroundColor: c.surface }, list: { paddingHorizontal: spacing.xl, gap: spacing.md }, title: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface }, row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md } }));
export default function HigginsHistoryScreen() {
  const s = useStyles(); const { colors } = useTheme(); const router = useRouter(); const insets = useSafeAreaInsets(); const [items, setItems] = useState<HigginsHistoryItem[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState(false);
  const load = () => { setLoading(true); setError(false); void higginsHubHistory().then((result) => setItems(result.items)).catch(() => setError(true)).finally(() => setLoading(false)); };
  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps
  const open = (item: HigginsHistoryItem) => { if (item.reportId) router.push({ pathname: "/saved-report/[id]", params: { id: item.reportId } }); else if (item.caseId) router.push({ pathname: "/(tabs)/ask", params: { resumeCaseId: item.caseId } }); };
  return <View style={s.root} testID="higgins-history-screen"><ChildScreenHeader title="Higgins history" testID="higgins-history-header" /><FlatList testID="higgins-history-list" data={items} keyExtractor={(item) => `${item.kind}-${item.id}`} contentContainerStyle={[s.list, { paddingBottom: insets.bottom + spacing.xl }]} renderItem={({ item }) => <Pressable testID={`higgins-history-${item.id}`} accessibilityRole="button" disabled={!item.caseId && !item.reportId} onPress={() => open(item)}><Card style={{ gap: spacing.sm }}><View style={s.row}><Text style={s.title}>{item.title}</Text><Pill tone={item.status === "active" ? "growling" : "resting"} label={item.status === "active" ? "Current" : "History"} testID={`higgins-history-${item.id}-status`} /></View><Body>{item.summary}</Body><Body>{new Date(item.occurredAt).toLocaleString()}</Body></Card></Pressable>} ListHeaderComponent={<Card testID="higgins-history-redaction"><Body>This timeline excludes passwords, verification codes, raw files and raw investigation evidence. Saved reports remain available until you delete them.</Body></Card>} ListEmptyComponent={loading ? <ActivityIndicator testID="higgins-history-loading" color={colors.brand} /> : error ? <Card testID="higgins-history-error"><Body>History could not be loaded.</Body><Button testID="higgins-history-retry" label="Try again" onPress={load} /></Card> : <Card testID="higgins-history-empty"><Body>No Higgins history is available yet.</Body></Card>} /></View>;
}