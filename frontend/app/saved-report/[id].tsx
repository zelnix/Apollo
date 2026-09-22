import { useLocalSearchParams, useRouter } from "expo-router";
import X from "lucide-react-native/icons/x";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HigginsSpeakButton } from "@/src/components/HigginsSpeakButton";
import { Sheet } from "@/src/components/Sheet";
import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import * as reportsApi from "@/src/investigation/client";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

const useStyles = makeStyles((c) => ({ root: { flex: 1, backgroundColor: c.surface }, header: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.lg }, title: { fontFamily: fonts.displayBold, fontSize: 25, color: c.onSurface }, close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary }, content: { paddingHorizontal: spacing.xl, gap: spacing.xl }, row: { flexDirection: "row", alignItems: "center", gap: spacing.sm }, body: { fontFamily: fonts.text, fontSize: 16, lineHeight: 25, color: c.onSurface } }));

export default function SavedReportDetail() {
  const s = useStyles(); const { colors } = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter(); const { id } = useLocalSearchParams<{ id: string }>();
  const [report, setReport] = useState<reportsApi.SavedReport | null>(null); const [error, setError] = useState<string | null>(null); const [confirmDelete, setConfirmDelete] = useState(false); const [deleting, setDeleting] = useState(false);
  const load = () => { if (!id) return; setError(null); void reportsApi.getReport(id).then((result) => setReport(result.report)).catch(() => setError("This saved report is unavailable.")); };
  useEffect(load, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const remove = async () => { if (!id) return; setDeleting(true); try { await reportsApi.deleteReport(id); setConfirmDelete(false); goBackOrHome(router); } catch { setError("The saved report could not be deleted."); } finally { setDeleting(false); } };
  return <View style={s.root} testID="saved-report-detail-screen"><View style={[s.header, { paddingTop: insets.top + spacing.md }]}><Text style={s.title} testID="saved-report-detail-title">Saved report</Text><Pressable testID="saved-report-detail-close" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable></View>
    {!report ? <View style={{ padding: spacing.xl, gap: spacing.md }}>{error ? <><Body testID="saved-report-detail-error">{error}</Body><Button testID="saved-report-detail-retry" label="Retry" onPress={load} /></> : <ActivityIndicator testID="saved-report-detail-loading" color={colors.brand} />}</View> : <ScrollView testID="saved-report-detail-scroll" contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]}>
      <View style={s.row}><Pill testID="saved-report-historical-badge" tone="neutral" label="Historical · not live status" /><HigginsSpeakButton testID="saved-report-hear" compact text={`${report.overview}. ${report.explanationMarkdown}`} scopeId={report.reportId} /></View>
      <Card testID="saved-report-overview"><SectionTitle>Overview</SectionTitle><Text style={s.body}>{report.overview}</Text><Body>{new Date(report.savedAt).toLocaleString()} · {report.gates.join(", ")}</Body></Card>
      <Card testID="saved-report-explanation"><SectionTitle>Explanation</SectionTitle><Text style={s.body}>{report.explanationMarkdown.replace(/[#*_`>-]/g, "")}</Text></Card>
      <Card testID="saved-report-scope"><SectionTitle>Scope at save time</SectionTitle><Body>{report.scope}</Body><Body>{report.retentionNotice}</Body></Card>
      <Card testID="saved-report-findings"><SectionTitle>Findings</SectionTitle>{report.findings.map((finding, index) => <Body key={`${index}-${finding}`}>• {finding}</Body>)}</Card>
      {report.uncertainties.length ? <Card testID="saved-report-uncertainties"><SectionTitle>Uncertainties</SectionTitle>{report.uncertainties.map((item, index) => <Body key={`${index}-${item}`}>• {item}</Body>)}</Card> : null}
      {report.actions.length ? <Card testID="saved-report-actions"><SectionTitle>Actions at save time</SectionTitle>{report.actions.map((action) => <View key={action.id}><Text style={s.body}>{action.label}</Text><Body>{action.instruction}</Body></View>)}</Card> : null}
      {report.sources.length ? <Card testID="saved-report-sources"><SectionTitle>Sources</SectionTitle>{report.sources.map((source, index) => <Button key={`${index}-${source.url}`} testID={`saved-report-source-${index}`} variant="ghost" label={source.title || source.url} onPress={() => void Linking.openURL(source.url)} />)}</Card> : null}
      {error ? <Body testID="saved-report-action-error">{error}</Body> : null}<Button testID="saved-report-delete" variant="danger" label="Delete saved report" onPress={() => setConfirmDelete(true)} />
    </ScrollView>}
    <Sheet visible={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete saved report" testID="saved-report-delete-sheet"><Body>This removes this historical copy and any speech cached for it. The temporary investigation follows its own retention deadline.</Body><Button testID="saved-report-confirm-delete" variant="danger" label={deleting ? "Deleting…" : "Delete report"} disabled={deleting} onPress={() => void remove()} /><Button testID="saved-report-cancel-delete" variant="ghost" label="Keep report" onPress={() => setConfirmDelete(false)} /></Sheet>
  </View>;
}