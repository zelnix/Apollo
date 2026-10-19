import { useRouter } from "expo-router";
import X from "lucide-react-native/icons/x";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Body, Button, Card, Pill } from "@/src/components/ui";
import * as reportsApi from "@/src/investigation/client";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

const useStyles = makeStyles((c) => ({ root: { flex: 1, backgroundColor: c.surface }, header: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.lg }, title: { fontFamily: fonts.displayBold, fontSize: 28, color: c.onSurface }, close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary }, list: { paddingHorizontal: spacing.xl, gap: spacing.md }, reportTitle: { fontFamily: fonts.textSemibold, fontSize: 16, color: c.onSurface }, row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm } }));

export default function SavedReportsScreen() {
  const s = useStyles(); const { colors } = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter();
  const [items, setItems] = useState<reportsApi.SavedReport[]>([]); const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null); const [retryCursor, setRetryCursor] = useState<string | null>(null);
  const load = async (next?: string | null) => { setLoading(true); setError(null); try { const result = await reportsApi.listReports(next); setItems((old) => next ? [...old, ...result.items] : result.items); setCursor(result.nextCursor); setRetryCursor(null); } catch { setError("Saved reports could not be loaded."); setRetryCursor(next ?? null); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  return <View style={s.root} testID="saved-reports-screen">
    <View style={[s.header, { paddingTop: insets.top + spacing.md }]}><Text style={s.title} testID="saved-reports-title">Saved reports</Text><Pressable testID="saved-reports-close" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable></View>
    <FlatList testID="saved-reports-list" data={items} keyExtractor={(item) => item.reportId} contentContainerStyle={[s.list, { paddingBottom: insets.bottom + spacing.xl }]}
      renderItem={({ item }) => <Pressable testID={`saved-report-open-${item.reportId}`} onPress={() => router.push({ pathname: "/saved-report/[id]", params: { id: item.reportId } })}><Card>
        <View style={s.row}><Text testID={`saved-report-title-${item.reportId}`} style={s.reportTitle}>{item.overview}</Text><Pill testID={`saved-report-historical-${item.reportId}`} tone="neutral" label="Historical" /></View>
        <Body>{new Date(item.savedAt).toLocaleString()} · {item.gates.join(", ")}</Body>
      </Card></Pressable>}
      ListEmptyComponent={loading ? <ActivityIndicator testID="saved-reports-loading" color={colors.brand} /> : !error ? <Card testID="saved-reports-empty"><Body>No reports have been saved yet.</Body></Card> : null}
      ListFooterComponent={<View style={{ gap: spacing.md }}>{error ? <Card testID="saved-reports-error"><Body>{error}</Body><Button testID="saved-reports-retry" label="Retry" onPress={() => void load(retryCursor)} /></Card> : null}{cursor && !error ? <Button testID="saved-reports-load-more" variant="secondary" label={loading ? "Loading…" : "Load more"} disabled={loading} onPress={() => void load(cursor)} /> : null}</View>} />
  </View>;
}