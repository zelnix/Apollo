// Shared investigation view: faithful Higgins overview, expandable full explanation, findings, sources, coverage, question, actions, Retry/Cancel.
import * as WebBrowser from "expo-web-browser";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { HigginsSpeakButton } from "@/src/components/HigginsSpeakButton";
import { Body, Button, Card, Pill, type Tone } from "@/src/components/ui";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import type { CaseState } from "@/src/investigation/caseStore";
import * as investigationApi from "@/src/investigation/client";
import type { ActionProposal, Attention, SourceReference } from "@/src/investigation/types";
import { isExecutable, runAction, type ActionOutcome } from "@/src/settings/actions";
import { onRecheck, retryFailedAttempt } from "@/src/settings/recheck";

const useStyles = makeStyles((c) => ({
  card: { gap: spacing.sm, borderColor: c.navyBorder }, higgins: { borderLeftWidth: 3, borderLeftColor: c.gold },
  text: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface }, muted: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.muted },
  heading: { fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurfaceSecondary, marginTop: spacing.xs }, row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" },
  source: { paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: c.border }, link: { fontFamily: fonts.textMedium, fontSize: 14, color: c.brandPrimary },
  question: { backgroundColor: c.surfaceTertiary, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs }, turn: { gap: spacing.xs, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: c.border },
  user: { alignSelf: "flex-end", backgroundColor: c.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: c.border, maxWidth: "88%" },
}));

/** Attention projection → Apollo tone. Biting is never derivable here (enforcement pipeline only). */
export function attentionTone(attention: Attention): Tone { return attention === "urgent" || attention === "action_needed" ? "barking" : attention === "review" ? "growling" : "resting"; }

function plain(markdown: string) {
  return markdown.replace(/^#{1,6}\s*/gm, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/`(.+?)`/g, "$1").replace(/^\s*[-*]\s+/gm, "• ").replace(/\[(.+?)\]\((https?:[^)]+)\)/g, "$1 ($2)");
}

function SourceRow({ source, s }: { source: SourceReference; s: ReturnType<typeof useStyles> }) {
  return <Pressable style={s.source} onPress={() => void WebBrowser.openBrowserAsync(source.url)} accessibilityRole="link" testID={`inv-source-${source.id}`}>
    <Text style={s.link}>{source.title || source.url}</Text>
    <Text style={s.muted}>{source.authority === "official" ? "Official platform/vendor source" : source.authority === "self_claimed" ? "Fetched from the destination itself — not independent" : "Search result — publisher not independently verified"} · {source.retrieval.replace("_", " ")}</Text>
  </Pressable>;
}

export function InvestigationView({ state, onAnswer, onRetry, onCancel, onAction, testID = "investigation" }: {
  state: CaseState; onAnswer?: (text: string) => void; onRetry: () => void; onCancel: () => void; onAction?: (action: ActionProposal, outcome: ActionOutcome) => void; testID?: string;
}) {
  const s = useStyles(); const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false); const [showSources, setShowSources] = useState(false);
  const [actionNote, setActionNote] = useState<string | null>(null);
  const [confirmablePlanId, setConfirmablePlanId] = useState<string | null>(null);
  const [reports, setReports] = useState<investigationApi.SavedReport[]>([]);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [reportNext, setReportNext] = useState<number | null>(null);
  const [reportNote, setReportNote] = useState<string | null>(null);
  // Fresh recheck after returning from a Settings destination opened for THIS case (recheck.ts completes the pending attempt).
  useEffect(() => onRecheck((o) => {
    if (!state.caseData || o.attempt.caseId !== state.caseData.id) return;
    const fresh = o.observation ? `fresh observation: ${o.observation.status}${o.observation.unavailableReason ? ` (${o.observation.unavailableReason.replace("_", " ")})` : ""}` : "no observation possible on this device";
    const verdict = o.plan ? ({ correct: "The setting now matches what Higgins asked for.", not_yet_correct: "The setting is not yet at the expected value.", cannot_observe: "Apollo cannot read this setting here — only you can confirm it.", failed: "The re-check failed." } as const)[o.plan.outcome] : "";
    setActionNote(`Back from Settings — ${fresh}. ${verdict} ${o.plan?.explanation ?? ""}`.trim());
    setFailedRecheck(o.attempt.status === "failed" && o.plan?.outcome === "failed");
    setConfirmablePlanId(o.plan?.outcome === "cannot_observe" ? o.attempt.planId : null);
  }), [state.caseData]);
  const [failedRecheck, setFailedRecheck] = useState(false);
  useEffect(() => {
    if (!state.caseData) { setReports([]); setReportNext(null); return; }
    void investigationApi.listReports().then((result) => { setReports(result.items); setReportNext(result.nextCursor); }).catch(() => setReportNote("Saved reports could not be loaded."));
  }, [state.caseData]);

  const { phase, response, sources, turns, caseData, progress, failure, error, question } = state;
  const working = phase === "creating" || phase === "working" || phase === "reconnecting" || phase === "waiting_device";
  const usedSources = sources.filter((src) => response?.sourceIds.includes(src.id));
  const inventory = caseData?.inventory;
  return <View style={{ gap: spacing.md }} testID={testID}>
    {turns.slice(0, -1).map((turn) => <View key={turn.turnId} style={s.turn} testID={`inv-turn-${turn.turnId}`}>
      <View style={s.user}><Text style={s.text}>{turn.question}</Text></View>
      <Text style={s.text}>{turn.response.overview}</Text>
    </View>)}
    {turns.length ? <View style={s.user} testID="inv-current-question"><Text style={s.text}>{turns[turns.length - 1].question}</Text></View> : null}
    {working ? <Card style={s.card} testID="inv-progress"><View style={s.row}><ActivityIndicator color={colors.gold} /><Body>{phase === "reconnecting" ? "Connection interrupted — reconnecting to the same investigation…" : phase === "waiting_device" ? "Checking this device for a fresh observation…" : "Higgins is investigating…"}</Body></View>
      {progress.slice(-3).map((line, i) => <Text key={`${i}-${line}`} style={s.muted}>{line}</Text>)}
      {caseData?.activeJobId ? <Button testID="inv-cancel" variant="ghost" label="Cancel this investigation" onPress={onCancel} /> : null}</Card> : null}
    {response ? <Card style={[s.card, s.higgins]} testID="inv-response">
      <View style={s.row}><Pill tone={attentionTone(response.attention)} label={response.attention === "none" ? "No action needed" : response.attention.replace("_", " ")} testID="inv-attention" />
        <Pill tone="neutral" label={response.completion === "complete" ? "Complete within scope" : response.completion === "partial" ? "Partial — more to examine" : "Higgins has a question"} testID="inv-completion" />
        <Pill tone="neutral" label={response.assessment.replace(/_/g, " ")} testID="inv-assessment" /></View>
      <Text style={s.text} testID="inv-overview">{response.overview}</Text>
      {response.attentionReason ? <Text style={s.muted}>Why: {response.attentionReason}</Text> : null}
      <HigginsSpeakButton text={expanded ? plain(response.explanationMarkdown) : response.overview} compact testID="inv-hear" scopeId={caseData?.id} />
      <Button testID="inv-expand" variant="ghost" label={expanded ? "Hide full explanation" : "Show full explanation"} onPress={() => setExpanded((v) => !v)} />
      {expanded ? <View style={{ gap: spacing.sm }} testID="inv-explanation">
        <Text style={s.text}>{plain(response.explanationMarkdown)}</Text>
        {response.findings.length ? <Text style={s.heading}>What this rests on</Text> : null}
        {response.findings.map((f) => <Text key={f.id} style={s.muted} testID={`inv-finding-${f.id}`}>{f.basis === "observation" ? "Observed" : f.basis === "user_report" ? "You reported" : "Higgins infers"} ({f.confidence}): {f.text}</Text>)}
        {response.uncertainties.length ? <Text style={s.heading}>Still uncertain</Text> : null}
        {response.uncertainties.map((u, i) => <Text key={i} style={s.muted}>• {u}</Text>)}
        {response.scope ? <Text style={s.muted}>Scope: {response.scope}</Text> : null}
        {inventory ? <Text style={s.muted} testID="inv-coverage">Evidence: {inventory.examined} of {inventory.total} items fully examined{inventory.partial ? `, ${inventory.partial} partially` : ""}{inventory.unavailable ? `, ${inventory.unavailable} unavailable` : ""}{response.remainingEvidenceIds.length ? ` — ${response.remainingEvidenceIds.length} still to examine` : ""}.</Text> : null}
      </View> : null}
      {usedSources.length ? <Button testID="inv-sources-toggle" variant="ghost" label={showSources ? "Hide sources" : `Sources (${usedSources.length})`} onPress={() => setShowSources((v) => !v)} /> : <Text style={s.muted}>No external sources were retrieved for this answer.</Text>}
      {showSources ? usedSources.map((src) => <SourceRow key={src.id} source={src} s={s} />) : null}
      {response.actions.length ? <Text style={s.heading}>Next step</Text> : null}
      {response.actions.map((action) => <View key={action.id} style={{ gap: spacing.xs }} testID={`inv-action-${action.id}`}>
        {isExecutable(action) ? <Button testID={`inv-action-button-${action.id}`} variant={action.id === response.recommendedActionId ? "primary" : "ghost"} label={action.label}
          onPress={() => {
            if (action.kind === "open_verified_source") { const src = sources.find((x) => action.sourceIds.includes(x.id)); if (src) void WebBrowser.openBrowserAsync(src.url); onAction?.(action, { kind: "opened_source" }); return; }
            if (!caseData) return;
            void runAction(action, caseData).then((outcome) => {
              setActionNote(outcome.kind === "observed" ? `Apollo recorded a fresh observation (${outcome.result.status}${outcome.result.unavailableReason ? `: ${outcome.result.unavailableReason.replace("_", " ")}` : ""}); ask Higgins to re-check.`
                : outcome.kind === "opened" ? `${outcome.descriptor.label} — opened${outcome.iosPath ? `. In Settings go to: ${outcome.iosPath}` : ""}. When you come back, Apollo takes a fresh check of that setting automatically.`
                : outcome.kind === "requested" ? "Apollo asked the system for that permission. When you come back, it takes a fresh check of the actual state — a request is not a grant."
                : outcome.kind === "opened_source" ? "Opened the source." : outcome.reason);
              onAction?.(action, outcome);
            });
          }} /> : <Text style={[s.text, { fontFamily: fonts.textMedium }]} testID={`inv-action-label-${action.id}`}>{action.id === response.recommendedActionId ? "Recommended: " : ""}{action.label}</Text>}
        <Text style={s.muted}>{action.instruction}</Text>
      </View>)}
      {actionNote ? <Text style={s.muted} testID="inv-action-note">{actionNote}</Text> : null}
      {confirmablePlanId && caseData ? <Button testID="inv-settings-user-confirm" variant="ghost" label="I checked this setting myself" onPress={() => {
        void investigationApi.confirmSettingsPlan(caseData.id, confirmablePlanId, true).then((result) => {
          setConfirmablePlanId(null); setActionNote(result.explanation);
        }).catch(() => setActionNote("Apollo could not record your confirmation. Try again."));
      }} /> : null}
      {failedRecheck ? <Button testID="inv-recheck-retry" variant="ghost" label="Retry the fresh check" onPress={() => { setFailedRecheck(false); void retryFailedAttempt(); }} /> : null}
      {caseData ? <View style={{ gap: spacing.xs }} testID="inv-report-controls">
        <Button testID="inv-report-save" variant="ghost" label="Save a redacted report" onPress={() => {
          void investigationApi.saveReport(caseData.id, response.revision).then(({ reportId }) => investigationApi.listReports().then((result) => {
            setReports(result.items); setReportNext(result.nextCursor); setReportNote(`Saved report ${reportId.slice(0, 8)}. Temporary evidence is not copied into it.`);
          })).catch(() => setReportNote("The report could not be saved."));
        }} />
        <Button testID="inv-reports-toggle" variant="ghost" label={`${reportsOpen ? "Hide" : "Manage"} saved reports (${reports.length}${reportNext !== null ? "+" : ""})`} onPress={() => setReportsOpen((value) => !value)} />
        {reportsOpen ? <View style={{ gap: spacing.sm }} testID="inv-reports-list">{reports.map((report) => <View key={report.reportId} style={s.source} testID={`inv-report-${report.reportId}`}>
          <Text style={s.text}>{report.overview}</Text><Text style={s.muted}>Saved {new Date(report.savedAt).toLocaleDateString()} · historical snapshot</Text>
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
    </Card> : null}
    {question && phase === "waiting_user" ? <View style={s.question} testID="inv-question"><Text style={s.text}>{question.text}</Text><Text style={s.muted}>Why Higgins asks: {question.reasonNeeded}</Text>
      {question.answerType === "yes_no" ? <View style={s.row}><Button testID="inv-answer-yes" label="Yes" onPress={() => onAnswer?.("Yes")} /><Button testID="inv-answer-no" variant="ghost" label="No" onPress={() => onAnswer?.("No")} /></View> : null}
      {question.answerType === "choice" ? <View style={s.row}>{question.choices.map((c) => <Button key={c} testID={`inv-answer-${c}`} variant="ghost" label={c} onPress={() => onAnswer?.(c)} />)}</View> : null}</View> : null}
    {failure && phase !== "failed" ? <Text style={s.muted} testID="inv-partial-reason">Incomplete: {failure.message}</Text> : null}
    {error && (phase === "failed" || phase === "expired") ? <Card style={s.card} testID="inv-error"><Text style={[s.text, { color: colors.barkingText }]}>{error}</Text>
      {phase === "failed" && caseData ? <Button testID="inv-retry" label="Retry this turn" onPress={onRetry} /> : null}</Card> : null}
  </View>;
}
