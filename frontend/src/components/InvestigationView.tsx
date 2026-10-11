// Investigation report: three browser-style tabs — Higgins | Magnum DI | Source Evidence.
// Default to Higgins. All tabs share the same case, evidence and state.
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { Body, Button, Card, Pill, type Tone } from "@/src/components/ui";
import { API_BASE } from "@/src/api/client";
import { getDeviceToken } from "@/src/auth/deviceIdentity";
import { EvidencePopup } from "@/src/components/EvidencePopup";
import { assessmentLabel, attentionLabel, investigationHistory, scrubMessage } from "@/src/domain/messageVoice";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import type { CaseState } from "@/src/investigation/caseStore";
import * as investigationApi from "@/src/investigation/client";
import type { ActionProposal, Attention, EvidenceItem, SourceReference } from "@/src/investigation/types";
import { isExecutable, runAction, type ActionOutcome } from "@/src/settings/actions";
import { onRecheck, retryFailedAttempt } from "@/src/settings/recheck";

// ── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles((c) => ({
  // Tab bar
  tabBar: { flexDirection: "row", backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: 3 },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: radius.md },
  tabActive: { backgroundColor: c.surface, shadowColor: "#000", shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  tabText: { fontFamily: fonts.textMedium, fontSize: 13, color: c.muted },
  tabTextActive: { color: c.onSurface, fontFamily: fonts.textSemibold },
  // Content
  card: { gap: spacing.sm, borderColor: c.navyBorder },
  higgins: { borderLeftWidth: 3, borderLeftColor: c.gold },
  magnumDi: { borderLeftWidth: 3, borderLeftColor: c.brandPrimary },
  evidence: { borderLeftWidth: 3, borderLeftColor: c.muted },
  text: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  muted: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.muted },
  heading: { fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurfaceSecondary, marginTop: spacing.xs },
  sectionTitle: { fontFamily: fonts.textSemibold, fontSize: 11, letterSpacing: 0.4, color: c.muted, textTransform: "uppercase" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" },
  source: { paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: c.border },
  link: { fontFamily: fonts.textMedium, fontSize: 14, color: c.brandPrimary },
  question: { backgroundColor: c.surfaceTertiary, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  turn: { gap: spacing.xs, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: c.border },
  user: { alignSelf: "flex-end", backgroundColor: c.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: c.border, maxWidth: "88%" },
  divider: { height: 1, backgroundColor: c.border, marginVertical: spacing.xs },
  evidenceCard: { gap: spacing.xs, borderColor: c.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  evidenceLabel: { fontFamily: fonts.textMedium, fontSize: 12, color: c.muted, textTransform: "uppercase", letterSpacing: 0.3 },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Attention projection → Apollo tone. */
export function attentionTone(attention: Attention): Tone { return attention === "urgent" || attention === "action_needed" ? "barking" : attention === "review" ? "growling" : "resting"; }

function plain(markdown: string) {
  return scrubMessage(markdown.replace(/^#{1,6}\s*/gm, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/`(.+?)`/g, "$1").replace(/^\s*[-*]\s+/gm, "• ").replace(/\[(.+?)\]\((https?:[^)]+)\)/g, "$1 ($2)"));
}

function SourceRow({ source, s }: { source: SourceReference; s: ReturnType<typeof useStyles> }) {
  return <Pressable style={s.source} onPress={() => void WebBrowser.openBrowserAsync(source.url)} accessibilityRole="link" testID={`inv-source-${source.id}`}>
    <Text style={s.link}>{source.title || source.url}</Text>
    <Text style={s.muted}>{source.authority === "official" ? "Official platform/vendor source" : source.authority === "self_claimed" ? "Fetched from the destination itself — not independent" : "Search result — publisher not independently verified"} · {scrubMessage(source.retrieval)}</Text>
  </Pressable>;
}

type TabId = "higgins" | "magnum" | "evidence";
const TAB_LABELS: { id: TabId; label: string }[] = [
  { id: "higgins", label: "Higgins" },
  { id: "magnum", label: "Magnum DI" },
  { id: "evidence", label: "Source Evidence" },
];

// ── Tab Bar ─────────────────────────────────────────────────────────────────

function TabBar({ active, onChange, s }: { active: TabId; onChange: (id: TabId) => void; s: ReturnType<typeof useStyles> }) {
  return (
    <View style={s.tabBar} testID="inv-tab-bar">
      {TAB_LABELS.map(({ id, label }) => (
        <Pressable
          key={id}
          style={[s.tab, active === id && s.tabActive]}
          onPress={() => onChange(id)}
          accessibilityRole="tab"
          accessibilityState={{ selected: active === id }}
          testID={`inv-tab-${id}`}
        >
          <Text style={[s.tabText, active === id && s.tabTextActive]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export function InvestigationView({ state, onAnswer, onRetry, onCancel, onAction, testID = "investigation" }: {
  state: CaseState; onAnswer?: (text: string) => void; onRetry: () => void; onCancel: () => void; onAction?: (action: ActionProposal, outcome: ActionOutcome) => void; testID?: string;
}) {
  const s = useStyles(); const { colors } = useTheme();
  const [activeTab, setActiveTab] = useState<TabId>("higgins");
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [confirmablePlanId, setConfirmablePlanId] = useState<string | null>(null);
  const [reports, setReports] = useState<investigationApi.SavedReport[]>([]);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [reportNext, setReportNext] = useState<string | null>(null);
  const [reportNote, setReportNote] = useState<string | null>(null);
  const [failedRecheck, setFailedRecheck] = useState(false);
  const [evidencePopupVisible, setEvidencePopupVisible] = useState(false);
  const [focusEvidenceId, setFocusEvidenceId] = useState<string | null>(null);
  const [evidenceItems, setEvidenceItems] = useState<EvidenceItem[]>([]);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [pdfNote, setPdfNote] = useState<string | null>(null);

  // ── Recheck observer ──
  useEffect(() => onRecheck((o) => {
    if (!state.caseData || o.attempt.caseId !== state.caseData.id) return;
    const fresh = o.observation ? `fresh observation: ${scrubMessage(o.observation.status)}${o.observation.unavailableReason ? ` (${scrubMessage(o.observation.unavailableReason)})` : ""}` : "no observation possible on this device";
    const verdict = o.plan ? ({ correct: "The setting now matches what Apollo asked for.", not_yet_correct: "The setting is not yet at the expected value.", cannot_observe: "Apollo cannot read this setting here — only you can confirm it.", failed: "The re-check failed." } as const)[o.plan.outcome] : "";
    setActionNote(`Back from Settings — ${fresh}. ${verdict} ${o.plan?.explanation ?? ""}`.trim());
    setFailedRecheck(o.attempt.status === "failed" && o.plan?.outcome === "failed");
    setConfirmablePlanId(o.plan?.outcome === "cannot_observe" ? o.attempt.planId : null);
  }), [state.caseData]);

  // ── PDF export ──
  const exportPdf = useCallback(async () => {
    const currentCase = state.caseData;
    if (!currentCase) return;
    setPdfExporting(true); setPdfNote(null);
    try {
      const token = await getDeviceToken();
      if (!token) { setPdfNote("Device not registered. Please restart Apollo."); return; }
      const url = `${API_BASE}/investigations/${currentCase.id}/export/pdf`;
      const filename = `Apollo_Report_${currentCase.id.slice(0, 8)}.pdf`;
      const destination = new FileSystem.File(FileSystem.Paths.cache, filename);
      const task = new FileSystem.DownloadTask(url, destination, { headers: { Authorization: `Bearer ${token}` } });
      const file = await task.downloadAsync();
      if (!file) { setPdfNote("Could not generate the PDF. Please try again."); return; }
      const sharingAvailable = await Sharing.isAvailableAsync();
      if (sharingAvailable) {
        await Sharing.shareAsync(file.uri, { mimeType: "application/pdf", dialogTitle: "Export Apollo Investigation Report", UTI: "com.adobe.pdf" });
        setPdfNote("PDF exported successfully.");
      } else if (Platform.OS === "web") { setPdfNote("PDF download is not available in the web preview. Use the Expo Go app on a device."); }
      else { setPdfNote("Sharing is not available on this device."); }
    } catch (e: unknown) { setPdfNote(e instanceof Error ? e.message : "PDF export failed."); }
    finally { setPdfExporting(false); }
  }, [state.caseData]);

  // ── Load reports + evidence ──
  useEffect(() => {
    if (!state.caseData) { setReports([]); setReportNext(null); return; }
    void investigationApi.listReports().then((result) => { setReports(result.items); setReportNext(result.nextCursor); }).catch(() => setReportNote("Saved reports could not be loaded."));
    void investigationApi.listEvidence(state.caseData.id).then((result) => setEvidenceItems(result.items)).catch(() => {});
  }, [state.caseData]);

  const { phase, response, sources, turns, caseData, progress, failure, error, question } = state;
  const working = phase === "creating" || phase === "working" || phase === "reconnecting" || phase === "waiting_device";
  const usedSources = sources.filter((src) => response?.sourceIds.includes(src.id));
  const inventory = caseData?.inventory;

  // ── Categorised evidence items ──
  const originalEvidence = useMemo(() => evidenceItems.filter((e) => e.origin === "user_submission" || e.origin === "device_observation"), [evidenceItems]);
  const derivedEvidence = useMemo(() => evidenceItems.filter((e) => e.origin !== "user_submission" && e.origin !== "device_observation"), [evidenceItems]);

  return <View style={{ gap: spacing.md }} testID={testID}>

    {/* ── Conversation history (all turns) ── */}
    {turns.slice(0, -1).map((turn) => <View key={turn.turnId} style={s.turn} testID={`inv-turn-${turn.turnId}`}>
      <View style={s.user}><Text style={s.text}>{turn.question}</Text></View>
      <Text style={s.text}>{scrubMessage(turn.response.overview)}</Text>
    </View>)}
    {turns.length ? <View style={s.user} testID="inv-current-question"><Text style={s.text}>{turns[turns.length - 1].question}</Text></View> : null}

    {/* ── Working / progress state ── */}
    {working ? <Card style={s.card} testID="inv-progress"><View style={s.row}><ActivityIndicator color={colors.gold} /><Body>{phase === "reconnecting" ? "Connection interrupted — reconnecting to the same investigation…" : phase === "waiting_device" ? "Checking this device for a fresh observation…" : "Higgins is investigating…"}</Body></View>
      {progress.slice(-3).map((line, i) => <Text key={`${i}-${line}`} style={s.muted}>{line}</Text>)}
      {caseData?.activeJobId ? <Button testID="inv-cancel" variant="ghost" label="Cancel this investigation" onPress={onCancel} /> : null}</Card> : null}

    {/* ── Response: browser-style tabs ── */}
    {response ? <>
      <TabBar active={activeTab} onChange={setActiveTab} s={s} />

      {/* ━━━━ TAB 1: HIGGINS ━━━━ */}
      {activeTab === "higgins" ? (
        <Card style={[s.card, s.higgins]} testID="inv-tab-higgins-content">
          {/* Conversational briefing — no generic report headings */}
          <Text style={s.text} testID="inv-overview">{scrubMessage(response.overview)}</Text>

          {response.attentionReason ? <>
            <View style={s.divider} />
            <Text style={s.text}>{scrubMessage(response.attentionReason)}</Text>
          </> : null}

          {/* Actions — one clear action at a time */}
          {response.actions.length ? <>
            <View style={s.divider} />
            {response.actions.map((action) => <View key={action.id} style={{ gap: spacing.xs }} testID={`inv-action-${action.id}`}>
              {isExecutable(action) ? <Button testID={`inv-action-button-${action.id}`} variant={action.id === response.recommendedActionId ? "primary" : "ghost"} label={action.label}
                onPress={() => {
                  if (action.kind === "open_verified_source") { const src = sources.find((x) => action.sourceIds.includes(x.id)); if (src) void WebBrowser.openBrowserAsync(src.url); onAction?.(action, { kind: "opened_source" }); return; }
                  if (!caseData) return;
                  void runAction(action, caseData).then((outcome) => {
                    setActionNote(outcome.kind === "observed" ? "Apollo took a fresh reading. Ask Higgins to re-check so it folds the new result in."
                      : outcome.kind === "opened" ? `${outcome.descriptor.label} — opened${outcome.iosPath ? `. In Settings go to: ${outcome.iosPath}` : ""}. When you come back, Apollo checks automatically.`
                      : outcome.kind === "requested" ? "Apollo asked the system for that permission. A fresh check runs when you return."
                      : outcome.kind === "opened_source" ? "Opened the source." : outcome.reason);
                    onAction?.(action, outcome);
                  });
                }} /> : <Text style={[s.text, { fontFamily: fonts.textMedium }]} testID={`inv-action-label-${action.id}`}>{action.id === response.recommendedActionId ? "Recommended: " : ""}{action.label}</Text>}
              <Text style={s.muted}>{action.instruction}</Text>
            </View>)}
          </> : null}

          {actionNote ? <Text style={s.muted} testID="inv-action-note">{actionNote}</Text> : null}
          {confirmablePlanId && caseData ? <Button testID="inv-settings-user-confirm" variant="ghost" label="I checked this setting myself" onPress={() => {
            void investigationApi.confirmSettingsPlan(caseData.id, confirmablePlanId, true).then((result) => {
              setConfirmablePlanId(null); setActionNote(result.explanation);
            }).catch(() => setActionNote("Apollo could not record your confirmation. Try again."));
          }} /> : null}
          {failedRecheck ? <Button testID="inv-recheck-retry" variant="ghost" label="Retry the fresh check" onPress={() => { setFailedRecheck(false); void retryFailedAttempt(); }} /> : null}
        </Card>
      ) : null}

      {/* ━━━━ TAB 2: MAGNUM DI ━━━━ */}
      {activeTab === "magnum" ? (
        <Card style={[s.card, s.magnumDi]} testID="inv-tab-magnum-content">
          <Text style={s.sectionTitle}>INVESTIGATION REPORT</Text>

          {/* Status pills */}
          <View style={s.row}>
            <Pill tone={attentionTone(response.attention)} label={attentionLabel(response.attention)} testID="inv-attention" />
            <Pill tone="neutral" label={response.completion === "complete" ? "Complete within scope" : response.completion === "partial" ? "Partial — more to examine" : "Question pending"} testID="inv-completion" />
            <Pill tone="neutral" label={assessmentLabel(response.assessment)} testID="inv-assessment" />
          </View>

          {/* Full investigation explanation */}
          <Text style={s.sectionTitle}>ANALYSIS</Text>
          <Text style={s.text} testID="inv-explanation">{plain(response.explanationMarkdown)}</Text>

          {/* Findings */}
          {response.findings.length ? <>
            <Text style={s.sectionTitle}>FINDINGS</Text>
            {response.findings.map((f) => <View key={f.id} style={{ gap: 2 }}>
              <Text style={s.text} testID={`inv-finding-${f.id}`}>{f.basis === "observation" ? "Observed" : f.basis === "user_report" ? "Reported" : "Inferred"} ({f.confidence}): {scrubMessage(f.text)}</Text>
              {f.evidenceIds && f.evidenceIds.length > 0 ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
                  {f.evidenceIds.map((evId) => {
                    const evItem = evidenceItems.find((e) => e.id === evId);
                    const displayLabel = evItem?.displayId || evId.slice(0, 8);
                    return <Pressable key={evId} onPress={() => { setFocusEvidenceId(evId); setEvidencePopupVisible(true); }} testID={`inv-finding-evidence-${evId}`}>
                      <Text style={[s.link, { fontSize: 12 }]}>Evidence · {displayLabel}</Text>
                    </Pressable>;
                  })}
                </View>
              ) : null}
            </View>)}
          </> : null}

          {/* Uncertainties */}
          {response.uncertainties.length ? <>
            <Text style={s.sectionTitle}>LIMITATIONS</Text>
            {response.uncertainties.map((u, i) => <Text key={i} style={s.muted}>• {scrubMessage(u)}</Text>)}
          </> : null}

          {/* Scope and evidence inventory */}
          {response.scope ? <>
            <Text style={s.sectionTitle}>SCOPE</Text>
            <Text style={s.muted}>{scrubMessage(response.scope)}</Text>
          </> : null}
          {inventory ? <Text style={s.muted} testID="inv-coverage">Evidence: {inventory.examined} of {inventory.total} items fully examined{inventory.partial ? `, ${inventory.partial} partially` : ""}{inventory.unavailable ? `, ${inventory.unavailable} unavailable` : ""}{response.remainingEvidenceIds.length ? ` — ${response.remainingEvidenceIds.length} still to examine` : ""}.</Text> : null}

          {/* Sources */}
          {usedSources.length ? <>
            <Text style={s.sectionTitle}>SOURCES ({usedSources.length})</Text>
            {usedSources.map((src) => <SourceRow key={src.id} source={src} s={s} />)}
          </> : <Text style={s.muted}>No external sources were retrieved for this investigation.</Text>}

          {/* Investigation history */}
          <Text style={s.sectionTitle}>INVESTIGATION HISTORY</Text>
          {investigationHistory({ turns: turns.map((t) => ({ question: t.question, overview: t.response.overview })), phase, completion: response.completion }).map((h, i) => <Text key={i} style={s.muted} testID={`inv-history-${i}`}>• {h.text}</Text>)}

          {/* Report controls */}
          {caseData ? <View style={{ gap: spacing.xs, marginTop: spacing.sm }} testID="inv-report-controls">
            <Button testID="inv-export-pdf" variant="secondary" disabled={pdfExporting}
              label={pdfExporting ? "Generating PDF…" : "Export Report as PDF"}
              icon={pdfExporting ? <ActivityIndicator size="small" color={colors.brand} /> : undefined}
              onPress={exportPdf} />
            {pdfNote ? <Text style={s.muted} testID="inv-pdf-note">{pdfNote}</Text> : null}
            <Button testID="inv-report-save" variant="ghost" label="Save a redacted report" onPress={() => {
              void investigationApi.saveReport(caseData.id, response.revision).then(({ reportId }) => investigationApi.listReports().then((result) => {
                setReports(result.items); setReportNext(result.nextCursor); setReportNote(`Saved report ${reportId.slice(0, 8)}. Temporary evidence is not copied.`);
              })).catch(() => setReportNote("The report could not be saved."));
            }} />
            <Button testID="inv-reports-toggle" variant="ghost" label={`${reportsOpen ? "Hide" : "Manage"} saved reports (${reports.length}${reportNext !== null ? "+" : ""})`} onPress={() => setReportsOpen((v) => !v)} />
            {reportsOpen ? <View style={{ gap: spacing.sm }} testID="inv-reports-list">{reports.map((report) => <View key={report.reportId} style={s.source} testID={`inv-report-${report.reportId}`}>
              <Text style={s.text}>{scrubMessage(report.overview)}</Text><Text style={s.muted}>Saved {new Date(report.savedAt).toLocaleDateString()} · historical snapshot</Text>
              <Button testID={`inv-report-delete-${report.reportId}`} variant="ghost" label="Delete saved report" onPress={() => {
                void investigationApi.deleteReport(report.reportId).then(() => { setReports((items) => items.filter((item) => item.reportId !== report.reportId)); setReportNote("Saved report deleted."); })
                  .catch(() => setReportNote("That report could not be deleted."));
              }} />
            </View>)}
            {reportNext !== null ? <Button testID="inv-reports-load-more" variant="ghost" label="Load more reports" onPress={() => {
              void investigationApi.listReports(reportNext).then((result) => { setReports((items) => [...items, ...result.items]); setReportNext(result.nextCursor); });
            }} /> : null}</View> : null}
            {reportNote ? <Text style={s.muted} testID="inv-report-note">{reportNote}</Text> : null}
          </View> : null}
        </Card>
      ) : null}

      {/* ━━━━ TAB 3: SOURCE EVIDENCE ━━━━ */}
      {activeTab === "evidence" ? (
        <Card style={[s.card, s.evidence]} testID="inv-tab-evidence-content">
          <Text style={s.sectionTitle}>ORIGINAL MATERIAL</Text>
          {originalEvidence.length ? originalEvidence.map((ev) => (
            <Pressable key={ev.id} style={s.evidenceCard} onPress={() => { setFocusEvidenceId(ev.id); setEvidencePopupVisible(true); }} testID={`inv-evidence-original-${ev.id}`}>
              <Text style={s.evidenceLabel}>{ev.origin === "user_submission" ? "Submitted" : "Observed"} · {ev.kind}</Text>
              <Text style={s.text}>{ev.displayId || ev.id.slice(0, 8)}</Text>
              {ev.label ? <Text style={s.muted}>{scrubMessage(ev.label)}</Text> : null}
              {ev.collectedAt ? <Text style={s.muted}>Captured: {new Date(ev.collectedAt).toLocaleString()}</Text> : null}
            </Pressable>
          )) : <Text style={s.muted}>No original material was retained for this investigation.</Text>}

          {derivedEvidence.length ? <>
            <Text style={[s.sectionTitle, { marginTop: spacing.sm }]}>ANALYSIS & EXTRACTED CONTENT</Text>
            <Text style={s.muted}>The following items were produced during the investigation — they are not original submissions.</Text>
            {derivedEvidence.map((ev) => (
              <Pressable key={ev.id} style={s.evidenceCard} onPress={() => { setFocusEvidenceId(ev.id); setEvidencePopupVisible(true); }} testID={`inv-evidence-derived-${ev.id}`}>
                <Text style={s.evidenceLabel}>{ev.origin || "Derived"} · {ev.kind}</Text>
                <Text style={s.text}>{ev.displayId || ev.id.slice(0, 8)}</Text>
                {ev.label ? <Text style={s.muted}>{scrubMessage(ev.label)}</Text> : null}
              </Pressable>
            ))}
          </> : null}

          {!originalEvidence.length && !derivedEvidence.length ? <Text style={s.muted}>No evidence items are available for this investigation.</Text> : null}

          {caseData ? <Button testID="inv-view-evidence-popup" variant="ghost" label={`Open evidence viewer (${evidenceItems.length})`} onPress={() => { setFocusEvidenceId(null); setEvidencePopupVisible(true); }} /> : null}
        </Card>
      ) : null}
    </> : null}

    {/* ── Question from Higgins (outside tabs — transient) ── */}
    {question && phase === "waiting_user" ? <View style={s.question} testID="inv-question"><Text style={s.text}>{scrubMessage(question.text)}</Text><Text style={s.muted}>Why Higgins asks: {scrubMessage(question.reasonNeeded)}</Text>
      {question.answerType === "yes_no" ? <View style={s.row}><Button testID="inv-answer-yes" label="Yes" onPress={() => onAnswer?.("Yes")} /><Button testID="inv-answer-no" variant="ghost" label="No" onPress={() => onAnswer?.("No")} /></View> : null}
      {question.answerType === "choice" ? <View style={s.row}>{question.choices.map((c) => <Button key={c} testID={`inv-answer-${c}`} variant="ghost" label={c} onPress={() => onAnswer?.(c)} />)}</View> : null}</View> : null}

    {/* ── Errors and notices (outside tabs — transient) ── */}
    {failure && phase !== "failed" ? <Text style={s.muted} testID="inv-partial-reason">Incomplete: {failure.message}</Text> : null}
    {state.notice ? <Card style={s.card} testID="inv-lifecycle-notice"><Body>{state.notice}</Body></Card> : null}
    {error && (phase === "failed" || phase === "expired") ? <Card style={s.card} testID="inv-error"><Text style={[s.text, { color: colors.barkingText }]}>{error}</Text>
      {phase === "failed" && caseData ? <Button testID="inv-retry" label="Retry this turn" onPress={onRetry} /> : null}</Card> : null}

    {/* ── Evidence popup (shared across all tabs) ── */}
    {caseData ? <EvidencePopup visible={evidencePopupVisible} onClose={() => setEvidencePopupVisible(false)}
      caseId={caseData.id} focusEvidenceId={focusEvidenceId} items={evidenceItems} /> : null}
  </View>;
}
