/**
 * Threat Case detail screen — shared view for all threats recorded by Apollo/Patrol.
 * Matches the approved Threat Case mock-up. No separate Patrol UI.
 *
 * Tabs: Overview | Evidence | History
 *
 * Data: PatrolEvent is the primary source. CaseState (Magnum DI) is optional.
 * Only shows states/actions supported by real data.
 */
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import Camera from "lucide-react-native/icons/camera";
import Check from "lucide-react-native/icons/check";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import Clock from "lucide-react-native/icons/clock";
import FileText from "lucide-react-native/icons/file-text";
import Globe from "lucide-react-native/icons/globe";
import Info from "lucide-react-native/icons/info";
import Link2 from "lucide-react-native/icons/link-2";
import Mail from "lucide-react-native/icons/mail";
import MessageSquare from "lucide-react-native/icons/message-square";
import Paperclip from "lucide-react-native/icons/paperclip";
import Phone from "lucide-react-native/icons/phone";
import Search from "lucide-react-native/icons/search";
import Shield from "lucide-react-native/icons/shield";
import Smartphone from "lucide-react-native/icons/smartphone";
import React, { useEffect, useMemo, useState } from "react";
import { Image, Linking, Pressable, ScrollView, Share, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGet } from "@/src/api/client";
import { EventActions } from "@/src/components/EventActions";
import * as Clipboard from "expo-clipboard";
import { Body, Button, Card, toneText, toneTint } from "@/src/components/ui";
import { scrubMessage } from "@/src/domain/messageVoice";
import {
  threatCaseId,
  threatCaseStatus,
  caseGroupKey,
  STATUS_LABELS,
  STATUS_COLORS,
  riskLevel,
  categoryLabel,
  buildTimeline,
  formatDateTime,
  formatTime,
  isSimulated,
  type ThreatCaseStatus,
  type TimelineEntry,
} from "@/src/domain/threatCase";
import type { PatrolEvent, PatrolRecord, SourceMetadata, HigginsBriefing } from "@/src/domain/types";
import { projectPatrolOutcomes } from "@/src/domain/patrolOutcomes";
import { caseOrigin, completenessLabel, evidenceSourceLabel, hasRecordedFindings, privacyNote, processingLabels } from "@/src/domain/caseFacts";
import { subjectLabel } from "@/src/domain/threatSubject";
import { buildCaseSources, sourceHeading, type CaseSource } from "@/src/domain/caseSources";
import { buildEvidencePack } from "@/src/domain/evidencePack";
import { DiReport, SimulatedAnswerNotice } from "@/src/components/DiReport";
import { recheckPlan } from "@/src/domain/recheckPlan";
import { EvidenceArtefactCard } from "@/src/components/evidence/EvidenceArtefactCard";
import { CaseEvidenceProfile } from "@/src/components/CaseEvidenceProfile";
import { TriageSummary } from "@/src/components/TriageSummary";
import { LIMITED_CAUTION, LIMITED_TODO, plainTriageText } from "@/src/domain/triage/contract";
import { investigatorName, looksLikeInternalCode, outcomeLabel, outcomeTone } from "@/src/domain/messageVoice";
import { ReportBody } from "@/src/components/report/ReportBody";
import { ReportHeader } from "@/src/components/report/ReportHeader";
import { checkKind } from "@/src/components/report/checkKind";
import { buildReport, plainReport, shownPlainEnglish, stepText } from "@/src/domain/reportSections";
import { involvedIn, shortText, type FamilySummary } from "@/src/domain/familySummary";
import { ShareWithFamily } from "@/src/components/ShareWithFamily";
import { FamilyNotes } from "@/src/components/FamilyNotes";
import { SettledByBadge } from "@/src/components/SettledByBadge";
import { comparableChecks, compareDeviceChecks, type DeviceCheckProgress } from "@/src/domain/deviceCheckProgress";
import { redactInvestigationSecrets, purposeLimitedUrl } from "@/src/domain/privacy";
import { getInvestigation, type DeviceInvestigation } from "@/src/investigation/deviceStore";
import { getOriginalSource, type OriginalSource } from "@/src/store/originalSource";
import { listImageEvidence, type ImageEvidenceRecord } from "@/src/store/imageEvidence";
import { goBackOrHome } from "@/src/utils/navigation";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

type TabKey = "overview" | "evidence" | "history" | "di";
const TAB_LABELS: { id: TabKey; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "evidence", label: "Evidence" },
  { id: "history", label: "History" },
  { id: "di", label: "DI" },
];

// ── Source icon/label by type ────────────────────────────────────────────────

function sourceIcon(cat: string, meta?: SourceMetadata | null) {
  const t = meta?.type ?? cat;
  switch (t) {
    case "email": return { Icon: Mail, bg: "#DBEAFE", fg: "#1E3A5F", label: "Email" };
    case "text": case "message": return { Icon: MessageSquare, bg: "#D1FAE5", fg: "#065F46", label: "Message" };
    case "screenshot": return { Icon: Camera, bg: "#EDE9FE", fg: "#5B21B6", label: "Screenshot" };
    case "link": case "website": return { Icon: Globe, bg: "#DBEAFE", fg: "#1E3A5F", label: "Website" };
    case "call": return { Icon: Phone, bg: "#FEF3C7", fg: "#92400E", label: "Call" };
    case "file": return { Icon: FileText, bg: "#DBEAFE", fg: "#1E3A5F", label: "File" };
    case "app": return { Icon: Smartphone, bg: "#D1FAE5", fg: "#065F46", label: "App" };
    case "device": case "network": return { Icon: Shield, bg: "#FEE2E2", fg: "#991B1B", label: "Device" };
    default: return { Icon: Shield, bg: "#F3F4F6", fg: "#374151", label: "Security" };
  }
}

function sourceSubtitle(event: PatrolEvent, original?: OriginalSource | null): string {
  const meta = event.source_metadata;
  const parts: string[] = [];
  const localSender = original?.fields?.find((f) => /from|sender|number/i.test(f.label))?.value;
  if (meta?.sender) parts.push(`From: ${meta.sender}`);
  else if (localSender) parts.push(`From: ${localSender}`);
  else if (event.category === "call" && event.local_indicator) parts.push(event.local_indicator);
  else if (event.indicator_host) parts.push(event.indicator_host);
  else if (event.claimed_brand) parts.push(event.claimed_brand);
  return parts.join(" · ");
}

// ── Styles ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  // Header
  headerRow: { paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingBottom: spacing.xs },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontFamily: fonts.displayBold, fontSize: 16, color: c.onSurface, flex: 1 },
  statusPill: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill },
  diNotice: { borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: c.gold, backgroundColor: c.surfaceSecondary, padding: spacing.md },
  diNoticeText: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.onSurface },
  sourceBadgeRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  statusPillText: { fontFamily: fonts.textSemibold, fontSize: 12 },
  // Source identity card
  sourceCard: { marginHorizontal: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md, backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, flexDirection: "row", gap: spacing.md, alignItems: "center", marginBottom: spacing.xs },
  sourceIconWrap: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  sourceInfo: { flex: 1, gap: 2 },
  sourceBadge: { alignSelf: "flex-start", paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: "rgba(107,114,128,0.12)", marginBottom: 2 },
  sourceBadgeText: { fontFamily: fonts.textSemibold, fontSize: 11, color: c.muted, letterSpacing: 0.5 },
  sourceTitle: { fontFamily: fonts.displayBold, fontSize: 15, color: c.onSurface, lineHeight: 21 },
  sourceSub: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceSecondary },
  sourceTime: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  // Tab bar
  tabBar: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: c.divider, paddingHorizontal: spacing.md },
  tab: { flex: 1, paddingVertical: spacing.md, alignItems: "center", justifyContent: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: c.brandPrimary },
  tabText: { fontFamily: fonts.textMedium, fontSize: 14, color: c.muted },
  tabTextActive: { fontFamily: fonts.textSemibold, color: c.onSurface },
  // Content
  content: { paddingHorizontal: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  // Higgins header
  higginsRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  higginsName: { fontFamily: fonts.displayBold, fontSize: 16, color: c.onSurface },
  higginsSub: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceSecondary },
  // Alert banner
  alertBanner: { borderRadius: radius.md, padding: spacing.md, flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  // Higgins report — no severity colour; the status pill already carries that.
  report: { borderRadius: radius.md, padding: spacing.md, backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border, gap: spacing.xs },
  reportSubject: { fontFamily: fonts.textSemibold, fontSize: 15, lineHeight: 21, color: c.onSurface },
  reportLabel: { fontFamily: fonts.textSemibold, fontSize: 12, letterSpacing: 0.5, color: c.onSurfaceSecondary, textTransform: "uppercase", marginTop: spacing.xs },
  reportBody: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurface },
  alertIcon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 2 },
  alertContent: { flex: 1, gap: 2 },
  alertTitle: { fontFamily: fonts.textSemibold, fontSize: 15, lineHeight: 21 },
  alertBody: { fontFamily: fonts.text, fontSize: 13, lineHeight: 19, color: c.onSurfaceSecondary },
  // Status section
  sectionTitle: { fontFamily: fonts.displayBold, fontSize: 15, color: c.onSurface, marginTop: spacing.sm },
  // Report sections and steps — the same look as Ask Higgins
  reportSectionHeader: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface, marginTop: spacing.md },
  actionCard: { backgroundColor: c.surfaceSecondary, borderRadius: radius.md, borderWidth: 0.25, borderColor: c.border, padding: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md },
  actionIconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  actionTitle: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.brandPrimary },
  actionDescription: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  // Investigation progress
  progressRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  progressDot: { width: 10, height: 10, borderRadius: 5 },
  progressText: { fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurface, flex: 1 },
  progressSub: { fontFamily: fonts.text, fontSize: 12, color: c.onSurfaceSecondary },
  // Fact rows
  factRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  factIcon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(107,114,128,0.08)" },
  factLabel: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.onSurfaceSecondary, width: 80 },
  factValue: { fontFamily: fonts.text, fontSize: 13, color: c.onSurface, flex: 1, lineHeight: 19 },
  // Evidence
  evidenceSection: { borderWidth: 1, borderColor: c.border, borderRadius: radius.lg, overflow: "hidden" },
  evidenceHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, backgroundColor: c.surfaceSecondary },
  evidenceHeaderIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  evidenceHeaderText: { flex: 1 },
  evidenceHeaderTitle: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  evidenceHeaderSub: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  evidenceBody: { padding: spacing.md, gap: spacing.sm },
  evidenceFieldRow: { flexDirection: "row", gap: spacing.sm },
  evidenceFieldLabel: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.onSurfaceSecondary, width: 72 },
  evidenceFieldValue: { fontFamily: fonts.text, fontSize: 13, color: c.onSurface, flex: 1, lineHeight: 19 },
  evidenceOriginalContent: { backgroundColor: c.surfaceTertiary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: c.border },
  evidenceOriginalText: { fontFamily: fonts.text, fontSize: 14, lineHeight: 22, color: c.onSurface },
  evidenceLink: { fontFamily: fonts.textMedium, fontSize: 14, color: c.brandPrimary },
  // Collapsible section
  collapseHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderTopWidth: 1, borderTopColor: c.divider },
  collapseIcon: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  collapseTitle: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface, flex: 1 },
  collapseSub: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  collapseBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  // Timeline
  timelineRow: { flexDirection: "row", gap: spacing.md, minHeight: 60 },
  timelineDotCol: { width: 20, alignItems: "center" },
  timelineDot: { width: 12, height: 12, borderRadius: 6, marginTop: 4 },
  timelineLine: { width: 2, flex: 1, backgroundColor: "rgba(107,114,128,0.2)", marginTop: 4 },
  timelineContent: { flex: 1, paddingBottom: spacing.md },
  timelineTime: { fontFamily: fonts.text, fontSize: 11, color: c.muted, marginBottom: 2 },
  timelineTitle: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface },
  timelineDesc: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceSecondary, lineHeight: 19 },
  timelineInProgress: { fontFamily: fonts.textMedium, fontSize: 12, color: c.muted, fontStyle: "italic" },
  // Related items
  relatedRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, borderTopWidth: 1, borderTopColor: c.divider },
  relatedTitle: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface, flex: 1 },
  relatedSub: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  // Provenance note
  provenanceNote: { fontFamily: fonts.text, fontSize: 11, color: c.muted, fontStyle: "italic", marginTop: spacing.xs },
}));

// ── Collapsible evidence section ─────────────────────────────────────────────

function CollapseSection({ icon, iconBg, iconFg, title, subtitle, badge, badgeColor, children, testID }: {
  icon: React.ComponentType<{ size: number; color: string }>; iconBg: string; iconFg: string;
  title: string; subtitle?: string; badge?: string; badgeColor?: string;
  children: React.ReactNode; testID?: string;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const IconEl = icon;
  return (
    <View testID={testID}>
      <Pressable style={s.collapseHeader} onPress={() => setOpen(!open)} accessibilityRole="button">
        <View style={[s.collapseIcon, { backgroundColor: iconBg }]}><IconEl size={18} color={iconFg} /></View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Text style={s.collapseTitle}>{title}</Text>
            {badge ? <View style={{ paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: badgeColor ?? colors.barkingTint }}>
              <Text style={{ fontFamily: fonts.textSemibold, fontSize: 11, color: badgeColor ? "#FFFFFF" : colors.barkingText }}>{badge}</Text>
            </View> : null}
          </View>
          {subtitle ? <Text style={s.collapseSub}>{subtitle}</Text> : null}
        </View>
        {open ? <ChevronUp size={18} color={colors.muted} /> : <ChevronDown size={18} color={colors.muted} />}
      </Pressable>
      {open ? <View style={s.collapseBody}>{children}</View> : null}
    </View>
  );
}

// ── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewContent({ event, status, shownWhatToDo, original, investigation }: { event: PatrolEvent; status: ThreatCaseStatus; shownWhatToDo: string; original: OriginalSource | null; investigation: DeviceInvestigation | null }) {
  const s = useStyles();
  const { colors } = useTheme();
  const record = event.patrol_record;
  const briefing = record?.higginsBriefing;
  const response = investigation?.response ?? null;
  const limited = !response && event.triage_investigation?.outcome === "LIMITED_UNABLE_TO_DETERMINE";

  // Higgins' report, built exactly as Ask Higgins builds it: each fact once. A threat Apollo recorded on its
  // own (no investigation) uses what it recorded instead.
  const report = useMemo(() => {
    if (response) {
      // Higgins' plain English when it passed its Fidelity Check; otherwise Apollo's own wording.
      const plain = shownPlainEnglish(response);
      if (plain) return plainReport(plain, investigation?.sources, response.sourceIds);
      return buildReport({
        overview: scrubMessage(response.overview), explanationMarkdown: scrubMessage(response.explanationMarkdown), attentionReason: response.attentionReason,
        findings: response.findings, uncertainties: response.uncertainties, scope: response.scope,
        sources: investigation?.sources, sourceIds: response.sourceIds, alreadySaid: [investigation?.settledReason?.sentence],
      });
    }
    const headline = (event.headline || "").trim();
    const established = plainTriageText((briefing?.established ?? event.what_happened ?? "").trim());
    return buildReport({
      overview: established || (headline && !looksLikeInternalCode(headline) ? plainTriageText(headline) : ""),
      fallbackFound: [...(event.why ?? []), ...(briefing?.evidence_points ?? [])].map(plainTriageText).filter((line) => !!line && !looksLikeInternalCode(line)),
      // A Limited Triage result is never shown as safe or as nothing to worry about.
      fallbackMeans: limited ? LIMITED_CAUTION : briefing?.meaning ?? null,
    });
  }, [response, investigation, event, briefing, limited]);

  // What to do — the investigation's own steps, or an explicit statement that nothing needs doing.
  const action = (shownWhatToDo || "").trim();
  const noAction = !action || /^no action required\.?$/i.test(action) || (limited && /^(nothing to (do|worry)|no action)/i.test(action));
  const note = event.resolved_at
    ? "Nothing to do — this case is closed."
    : status === "investigating"
      ? "Nothing to do right now. I'll tell you as soon as the investigation finishes."
      : null;
  const steps = !note && response?.actions.length
    ? response.actions.map((a, i) => ({ id: a.id, title: a.label, body: stepText(response, i) }))
    : [{ id: "todo", title: null, body: note ?? (noAction ? (limited ? LIMITED_TODO : "Nothing to do.") : plainTriageText(action)) }];
  const hasOutcome = !!outcomeLabel(response?.outcome);
  const risk = limited ? { label: "Not determined", color: "#D97706" } : riskLevel(event.state);
  // "Send to family": the result, what happened, what to do and the website or number — nothing else.
  const summary: FamilySummary = {
    eventId: event.event_id, state: event.state, result: outcomeLabel(response?.outcome) ?? STATUS_LABELS[status],
    headline: event.headline && !looksLikeInternalCode(event.headline) ? scrubMessage(event.headline) : (report.answer[0] ?? "A threat Apollo found"),
    whatHappened: shortText(report.answer.join(" "), 400),
    whatToDo: shortText(scrubMessage(note ?? (noAction ? "Nothing to do." : action)), 300),
    involved: involvedIn(event), caseRef: threatCaseId(event), occurredAt: event.occurred_at,
  };

  return (
    <View style={s.content}>
      {/* Higgins' report — the same template and sections as Ask Higgins. */}
      <Card style={{ gap: spacing.md }} testID="tc-overview-briefing">
        <ReportBody report={report} time={investigation ? formatTime(investigation.completedAt || investigation.createdAt) : null} ids="tc-overview" />
        <Text style={s.reportSectionHeader}>What you can do</Text>
        <View style={{ gap: spacing.sm }} testID="tc-overview-todo">
          {steps.map((step) => (
            <View key={step.id} style={s.actionCard} testID={`tc-overview-action-${step.id}`}>
              <View style={[s.actionIconWrap, { backgroundColor: "#DBEAFE" }]}><Shield size={20} color={colors.brandPrimary} /></View>
              <View style={{ flex: 1, gap: 2 }}>
                {step.title ? <Text style={s.actionTitle}>{scrubMessage(step.title)}</Text> : null}
                <Text style={step.title ? s.actionDescription : s.reportBody}>{scrubMessage(step.body)}</Text>
              </View>
            </View>
          ))}
        </View>
      </Card>

      <FamilyNotes eventId={event.event_id} />

      <ShareWithFamily summary={summary} when={formatDateTime(event.occurred_at)} />

      {/* Actions */}
      {event.resolved_at ? <ReopenCase event={event} /> : <EventActions event={event} hideAsk />}
      {!event.resolved_at && event.reopened_at ? <RecheckCase event={event} /> : null}

      {/* Patrol facts — only what the top card doesn't already say. */}
      <Card style={{ gap: 0 }} testID="tc-overview-facts">
        <FactRow icon={MessageSquare} label="Source" value={evidenceSourceLabel(event)} isLast={!(event.category === "call" && event.local_indicator) && hasOutcome} />
        {event.category === "call" && event.local_indicator ? (
          <FactRow icon={Phone} label="Number" value={event.local_indicator} isLast={hasOutcome} />
        ) : null}
        {!hasOutcome ? <FactRow icon={Search} label="Risk level" value={risk.label} valueColor={risk.color} isLast /> : null}
      </Card>

      {/* Repeat checks of this device: one case, every check listed. */}
      {event.case_key ? <CaseCheckRuns event={event} original={original} /> : null}

      {/* Triage investigation — the stored deterministic record. No model call. */}
      {event.triage_investigation ? <TriageSummary record={event.triage_investigation} /> : null}

      {/* Connected incidents */}
      {event.scent_id ? <ScentSection event={event} /> : null}
    </View>
  );
}

const CHANGE_PREFIX: Record<string, string> = { fixed: "Fixed", new_problem: "New", still_open: "Still open", not_confirmed: "Not confirmed" };

/** Repeat checks on the same subject are ONE case. This restates how many checks have been filed
 *  against it, what changed since the previous check, and lets the person open any earlier check.
 *  Nothing is re-analysed here — every line comes from what each check recorded at the time. */
function CaseCheckRuns({ event, original }: { event: PatrolEvent; original: OriginalSource | null }) {
  const s = useStyles();
  const router = useRouter();
  const { events } = useApollo();
  const runs = events
    .filter((e) => caseGroupKey(e) === caseGroupKey(event))
    .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
  const index = runs.findIndex((e) => e.event_id === event.event_id);
  const previousRun = index >= 0 ? runs[index + 1] ?? null : null;

  // What changed since the check immediately before this one — compared from what each check
  // actually recorded. Nothing is compared when the earlier check kept no comparable results.
  const [progress, setProgress] = useState<DeviceCheckProgress | null>(null);
  useEffect(() => {
    let live = true;
    const current = comparableChecks(original?.data);
    if (!previousRun || !current) { setProgress(null); return; }
    void getOriginalSource(previousRun.event_id)
      .then((prior) => {
        const before = comparableChecks(prior?.data);
        if (live) setProgress(before ? compareDeviceChecks(before, current) : null);
      })
      .catch(() => { if (live) setProgress(null); });
    return () => { live = false; };
  }, [previousRun, original]);

  if (runs.length < 2) return null;
  const earlier = runs.filter((e) => e.event_id !== event.event_id).slice(0, 5);

  return (
    <Card style={{ gap: spacing.xs }} testID="tc-overview-runs">
      <Text style={s.sectionTitle}>Checks on this case</Text>
      <Text style={s.reportBody} testID="tc-overview-runs-count">
        Checked {runs.length} times · last checked {formatDateTime(runs[0].occurred_at)}
      </Text>
      {progress ? (
        <View style={{ gap: spacing.xs, marginTop: spacing.xs }} testID="tc-overview-runs-progress">
          <Text style={s.reportLabel}>Since the check before this one</Text>
          <Text style={s.reportBody} testID="tc-overview-runs-progress-summary">{progress.summary}</Text>
          {progress.changes.map((change) => (
            <Text key={change.id} style={s.relatedSub} testID={`tc-overview-runs-change-${change.id}`}>
              {CHANGE_PREFIX[change.kind]} — {change.title}: {change.detail}
            </Text>
          ))}
        </View>
      ) : null}
      {earlier.map((run) => (
        <Pressable
          key={run.event_id}
          testID={`tc-overview-run-${run.event_id}`}
          accessibilityRole="button"
          accessibilityLabel={`Open the check from ${formatDateTime(run.occurred_at)}`}
          onPress={() => router.push(`/patrol/${encodeURIComponent(run.event_id)}`)}
          style={({ pressed }) => [{ paddingVertical: spacing.xs, opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={s.relatedSub}>{formatDateTime(run.occurred_at)} — {run.headline}</Text>
        </Pressable>
      ))}
    </Card>
  );
}

/** After a reopen, Apollo can look again. This re-runs the same pipeline — detection → Triage →
 *  Magnum DI if Triage escalates — and opens the fresh result, or sends the person to the Gate that
 *  performs the live read. It never pretends to re-check something it can no longer see. */
function RecheckCase({ event }: { event: PatrolEvent }) {
  const s = useStyles();
  const router = useRouter();
  const { checkLink, checkMessage, checkNumberRisk, showToast } = useApollo();
  const [busy, setBusy] = useState(false);
  const plan = recheckPlan(event);

  const openResult = (fresh: PatrolEvent | null, nothingFound: string) => {
    if (fresh) router.replace(`/patrol/${encodeURIComponent(fresh.event_id)}`);
    else showToast(nothingFound, "neutral");
  };

  const run = async () => {
    setBusy(true);
    try {
      if (plan.kind === "link") {
        // The same link is re-triaged in THIS case: its evidence level, history and earlier results stay with it.
        const outcome = await checkLink(plan.url, event.scent_id ?? undefined, { via: "recheck", upgradeEventId: event.event_id });
        if (outcome.notice) showToast(outcome.notice, "neutral");
        openResult(outcome.event, "ApolloSG re-checked the website and found nothing to flag this time.");
      } else if (plan.kind === "message") {
        const original = await getOriginalSource(event.event_id).catch(() => null);
        const text = (original?.text ?? "").trim();
        if (!text) {
          showToast("ApolloSG can't re-check this one here — the original message isn't stored with this case. Open the Text or Email check and submit it again.", "growling");
          return;
        }
        const from = original?.fields?.find((f) => /from|sender/i.test(f.label))?.value ?? event.source_metadata?.sender ?? "";
        const outcome = await checkMessage(from, text, { via: "recheck", upgradeEventId: event.event_id });
        openResult(outcome.event, "ApolloSG re-checked the message and found nothing to flag this time.");
      } else if (plan.kind === "number") {
        const risk = await checkNumberRisk(plan.number, undefined, { deliberate: true, via: "recheck" });
        showToast(`Re-check complete: ${risk.higgins.headline}`, "neutral");
      }
    } catch (error) {
      showToast(`ApolloSG couldn't finish the re-check (${error instanceof Error ? error.message : "reason not recorded"}).`, "growling");
    } finally {
      setBusy(false);
    }
  };

  if (plan.kind === "none") {
    return <Text style={s.provenanceNote} testID="tc-recheck-unavailable">{plan.reason}</Text>;
  }

  if (plan.kind === "gate") {
    return (
      <View style={{ gap: spacing.xs }}>
        <Button testID="tc-recheck" variant="secondary" label={plan.label} onPress={() => router.push(plan.route as never)} />
        <Text style={s.provenanceNote}>{plan.note}</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.xs }}>
      <Button testID="tc-recheck" variant="secondary" label={busy ? "Re-checking…" : plan.label} disabled={busy} onPress={() => void run()} />
      <Text style={s.provenanceNote}>
        Apollo runs the whole check again — his own checks first, and a Magnum DI investigation only if those find a possible threat. The result opens as a fresh case.
      </Text>
    </View>
  );
}

function ReopenCase({ event }: { event: PatrolEvent }) {
  const s = useStyles();
  const { reopenEvent } = useApollo();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!confirm) return <Button testID="tc-reopen-button" variant="secondary" label="Reopen case" onPress={() => setConfirm(true)} />;
  return (
    <Card style={{ gap: spacing.sm }} testID="tc-reopen-confirm">
      <Text style={s.provenanceNote}>Reopen this case? It will show as active again so you can act on it.</Text>
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <View style={{ flex: 1 }}><Button testID="tc-reopen-cancel" variant="secondary" label="Cancel" onPress={() => setConfirm(false)} disabled={busy} /></View>
        <View style={{ flex: 1 }}><Button testID="tc-reopen-yes" label={busy ? "Reopening…" : "Reopen"} disabled={busy}
          onPress={async () => { setBusy(true); try { await reopenEvent(event); } finally { setBusy(false); setConfirm(false); } }} /></View>
      </View>
    </Card>
  );
}

function FactRow({ icon, label, value, valueColor, isLast }: {
  icon: React.ComponentType<{ size: number; color: string }>; label: string; value: string; valueColor?: string; isLast?: boolean;
}) {
  const s = useStyles();
  const IconEl = icon;
  return (
    <View style={[s.factRow, isLast && { borderBottomWidth: 0 }]}>
      <View style={s.factIcon}><IconEl size={14} color="#6B7280" /></View>
      <Text style={s.factLabel}>{label}</Text>
      <Text style={[s.factValue, valueColor ? { color: valueColor, fontFamily: fonts.textSemibold } : undefined]}>{value}</Text>
    </View>
  );
}

function ScentSection({ event }: { event: PatrolEvent }) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { events } = useApollo();
  const related = events.filter((e) => e.scent_id === event.scent_id && e.event_id !== event.event_id);
  if (!related.length) return null;
  return (
    <Card style={{ gap: spacing.sm }} testID="tc-related-items">
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        <View style={s.factIcon}><Link2 size={14} color="#6B7280" /></View>
        <Text style={{ fontFamily: fonts.textSemibold, fontSize: 14, color: colors.onSurface }}>
          ApolloSG connected {related.length} related {related.length === 1 ? "event" : "events"} to this threat.
        </Text>
      </View>
      {related.slice(0, 3).map((r) => (
        <Pressable key={r.event_id} onPress={() => router.push(`/patrol/${r.event_id}`)} style={s.relatedRow}>
          <Text style={s.relatedTitle} numberOfLines={1}>
            {r.headline && !looksLikeInternalCode(r.headline) ? r.headline : categoryLabel(r.category) + " event"}
          </Text>
          <Text style={s.relatedSub}>{formatDateTime(r.occurred_at)}</Text>
          <ChevronRight size={16} color={colors.muted} />
        </Pressable>
      ))}
    </Card>
  );
}

// ── Sources used ─────────────────────────────────────────────────────────────

/** Loads the saved Magnum DI investigation for this case, when there is one. */
function useCaseInvestigation(event: PatrolEvent | undefined): DeviceInvestigation | null {
  const caseId = event?.investigation_case_id ?? event?.patrol_record?.investigationCaseId ?? null;
  const [inv, setInv] = useState<DeviceInvestigation | null>(null);
  useEffect(() => {
    if (!caseId) { setInv(null); return; }
    getInvestigation(caseId).then(setInv).catch(() => setInv(null));
  }, [caseId]);
  return inv;
}

/** One-tap copy or share of the recorded facts + sources, for a bank, the police or family. */
function EvidencePackButton({ event, facts, sources }: { event: PatrolEvent; facts: string[]; sources: CaseSource[] }) {
  const { showToast } = useApollo();
  const [copied, setCopied] = useState(false);
  const pack = () => buildEvidencePack({ event, facts, sources });
  const copy = async () => {
    try {
      await Clipboard.setStringAsync(pack());
      setCopied(true);
      showToast("Facts and sources copied. Paste them into an email, message or report.", "neutral");
    } catch {
      showToast("ApolloSG couldn't copy to the clipboard on this device.", "growling");
    }
  };
  const share = async () => {
    try {
      await Share.share({ message: pack(), title: `Apollo Threat Case ${threatCaseId(event)}` });
    } catch {
      showToast("ApolloSG couldn't open the share sheet on this device.", "growling");
    }
  };
  return (
    <View style={{ flexDirection: "row", gap: spacing.sm }}>
      <View style={{ flex: 1 }}>
        <Button
          testID="tc-evidence-pack"
          variant="secondary"
          label={copied ? "Copied — facts & sources" : "Copy facts & sources"}
          onPress={() => void copy()}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Button
          testID="tc-evidence-share"
          variant="secondary"
          label="Share"
          onPress={() => void share()}
        />
      </View>
    </View>
  );
}

/** Every source Apollo consulted and exactly what it returned. Recorded data only. */
function SourcesSection({ sources }: { sources: CaseSource[] }) {
  const s = useStyles();
  if (sources.length === 0) return null;
  return (
    <View style={s.evidenceSection} testID="tc-evidence-sources">
      <View style={s.evidenceHeader}>
        <View style={[s.evidenceHeaderIcon, { backgroundColor: "#D1FAE5" }]}>
          <Globe size={18} color="#065F46" />
        </View>
        <View style={s.evidenceHeaderText}>
          <Text style={s.evidenceHeaderTitle}>Sources ApolloSG used</Text>
          <Text style={s.evidenceHeaderSub}>What each source returned</Text>
        </View>
      </View>
      <View style={s.evidenceBody}>
        {sources.map((src, i) => (
          <View key={src.id} style={s.evidenceOriginalContent} testID={`tc-evidence-source-${i}`}>
            <Text style={[s.evidenceFieldLabel, { width: "auto", marginBottom: 4 }]}>
              {sourceHeading(src)}
            </Text>
            <Text style={s.evidenceOriginalText} selectable>{src.returned}</Text>
            {src.url ? (
              <Pressable onPress={() => void Linking.openURL(src.url!)} accessibilityRole="link">
                <Text style={s.evidenceLink}>{src.url}</Text>
              </Pressable>
            ) : null}
            {src.at ? <Text style={s.provenanceNote}>{formatDateTime(src.at)}</Text> : null}
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Evidence Tab ─────────────────────────────────────────────────────────────

/** For investigation cases: show the privacy-protected evidence Magnum actually received.
 *  For deterministic cases (DNS block, etc.): show the local observation details.
 *  Never reconstruct evidence from Magnum prose, Higgins explanation, or metadata. */
function EvidenceContent({ event }: { event: PatrolEvent }) {
  const s = useStyles();
  const { colors } = useTheme();
  const meta = event.source_metadata;
  const record = event.patrol_record;
  const si = sourceIcon(event.category, meta);
  const briefing = record?.higginsBriefing;
  const isInvestigation = !!event.investigation_case_id;
  const subjectName = subjectLabel(event);
  const recorded = hasRecordedFindings(event);
  // The recorded facts of the finding — what Apollo found, never why it matters. Sources: the
  // finding statement itself, Apollo's recorded signals, and evidence the deterministic Triage
  // investigation actually captured. Deduplicated, no interpretation added. Checks that didn't finish
  // aren't findings: they're listed under Sources, each with its recorded reason.
  const observedFacts = Array.from(new Set([
    (event.headline || "").trim(),
    ...(event.why ?? []).map((w) => w.trim()),
    ...(event.triage_investigation?.rules ?? [])
      .filter((r) => r.result === "met")
      .flatMap((r) => r.evidence)
      .map((e) => plainTriageText(e.trim())),
  ].filter((line) => !!line && !looksLikeInternalCode(line) && !/^(Couldn't check|Not completed):/.test(line))));

  // Load device investigation data for investigation-sourced cases
  const [inv, setInv] = useState<DeviceInvestigation | null>(null);
  const [origSrc, setOrigSrc] = useState<OriginalSource | null>(null);
  const [imgEvidence, setImgEvidence] = useState<ImageEvidenceRecord | null>(null);
  const [loaded, setLoaded] = useState(false);
  // The artefact card reports whether the exact original is on this phone; when it is, the older
  // field-by-field views below are redundant and would show the same material twice.
  const [hasLocalOriginal, setHasLocalOriginal] = useState(false);
  const packSummary = {
    overview: briefing?.meaning || event.what_happened || null,
    findings: [...new Set([...(event.why ?? []), ...(briefing?.evidence_points ?? [])])],
    steps: [...new Set([event.what_to_do, briefing?.action].filter((v): v is string => !!v && v !== "No action required."))],
    uncertainties: [],
  };

  useEffect(() => {
    if (!isInvestigation) { setLoaded(true); return; }
    (async () => {
      const caseId = event.investigation_case_id!;
      const [investigation, original, imgRec] = await Promise.all([
        getInvestigation(caseId).catch(() => null),
        getOriginalSource(event.event_id).catch(() => null),
        listImageEvidence(event.event_id).then((recs) => recs[0] ?? null).catch(() => null),
      ]);
      setInv(investigation);
      setOrigSrc(original);
      setImgEvidence(imgRec);
      setLoaded(true);
    })();
  }, [isInvestigation, event.investigation_case_id, event.event_id]);

  if (!loaded) return null;

  // ── Investigation evidence: show what Magnum actually received ──
  if (isInvestigation) {
    return (
      <View style={s.content}>
        <CaseEvidenceProfile event={event} />
        {/* The artefact itself, as it arrived, with the copy that was sent alongside it. */}
        <EvidenceArtefactCard caseKeys={[event.event_id, event.investigation_case_id, event.patrol_record?.investigationCaseId]} onAvailable={setHasLocalOriginal}
          packTitle={event.headline} packDate={event.occurred_at} packSummary={packSummary} phones={event.evidence_phones} testID="tc-evidence-artefact" />

        {/* Primary: Evidence investigated by Magnum DI */}
        {!hasLocalOriginal ? (
        <View style={s.evidenceSection} testID="tc-evidence-investigated">
          <View style={s.evidenceHeader}>
            <View style={[s.evidenceHeaderIcon, { backgroundColor: si.bg }]}>
              <si.Icon size={18} color={si.fg} />
            </View>
            <View style={s.evidenceHeaderText}>
              <Text style={s.evidenceHeaderTitle}>{`Evidence investigated by ${investigatorName(inv?.answeredBy)}`}</Text>
            </View>
          </View>

          <View style={s.evidenceBody}>
            {/* Show the actual protected evidence submitted to Magnum */}
            <InvestigatedEvidenceView
              inv={inv}
              originalSource={origSrc}
              imageEvidence={imgEvidence}
              event={event}
              meta={meta}
            />

            {/* Privacy protection notice */}
            {inv?.evidenceItems?.some((e) => e.transformations?.length > 0) ? (
              <Text style={s.provenanceNote} testID="tc-evidence-privacy-note">
                Personal-data protection was applied before this evidence left your device. Credentials were removed; investigative indicators (scammer identifiers, URLs, sender details) were retained.
              </Text>
            ) : (
              <Text style={s.provenanceNote}>
                This evidence was submitted for investigation after ApolloSG&apos;s privacy protection step.
              </Text>
            )}
          </View>
        </View>
        ) : null}

        <View style={s.evidenceSection}>
          <View style={s.evidenceBody}><CaseFactsRows event={event} /></View>
        </View>
        <SourcesSection sources={buildCaseSources({ event, investigation: inv })} />
        <EvidencePackButton event={event} facts={observedFacts} sources={buildCaseSources({ event, investigation: inv })} />

        {/* Analysis signals (from Magnum DI findings — NOT presented as evidence) */}
        {briefing?.evidence_points && briefing.evidence_points.length > 0 ? (
          <View style={s.evidenceSection}>
            <CollapseSection
              icon={Search} iconBg="#DBEAFE" iconFg="#1E3A5F"
              title={`${si.label} analysis`}
              subtitle={`Findings from ${investigatorName(inv?.answeredBy)}'s investigation`}
              testID="tc-evidence-analysis"
            >
              {briefing.evidence_points.map((point, i) => (
                <View key={i} style={{ flexDirection: "row", gap: spacing.sm }}>
                  <Text style={{ color: "#6B7280", marginTop: 1 }}>•</Text>
                  <Text style={s.evidenceOriginalText}>{point}</Text>
                </View>
              ))}
            </CollapseSection>
          </View>
        ) : null}

        {/* Apollo detection evidence */}
        {event.enforcement_evidence ? (
          <View style={s.evidenceSection}>
            <CollapseSection
              icon={Shield} iconBg="#FEE2E2" iconFg="#991B1B"
              title="Apollo detection evidence"
              subtitle="When and how this was detected"
              testID="tc-evidence-detection"
            >
              <EvidenceField label="Mechanism:" value={event.enforcement_evidence.mechanism.replace(/_/g, " ")} />
              <EvidenceField label="Action:" value={event.enforcement_evidence.enforced_action.replace(/_/g, " ")} />
              <EvidenceField label="Result:" value={event.enforcement_evidence.result.replace(/_/g, " ")} />
              <EvidenceField label="Confidence:" value={event.enforcement_evidence.confidence} />
              {event.enforcement_evidence.destination_domain ? (
                <EvidenceField label="Destination:" value={event.enforcement_evidence.destination_domain} />
              ) : null}
              <EvidenceField label="Observed:" value={formatDateTime(event.enforcement_evidence.observed_at)} />
            </CollapseSection>
          </View>
        ) : null}

        {/* Supporting references */}
        {event.supporting_references && event.supporting_references.length > 0 ? (
          <View style={s.evidenceSection}>
            <CollapseSection
              icon={Globe} iconBg="#D1FAE5" iconFg="#065F46"
              title={`Supporting references (${event.supporting_references.length})`}
              testID="tc-evidence-refs"
            >
              {event.supporting_references.map((ref, i) => (
                <Pressable key={i} onPress={() => void Linking.openURL(ref.url)} style={{ gap: 2 }}>
                  <Text style={[s.evidenceFieldLabel, { width: "auto" }]}>{ref.label}</Text>
                  <Text style={s.evidenceLink}>{ref.url}</Text>
                </Pressable>
              ))}
            </CollapseSection>
          </View>
        ) : null}
      </View>
    );
  }

  // ── Non-investigation (deterministic): show local observation as before ──
  return (
    <View style={s.content}>
      <CaseEvidenceProfile event={event} />
      {/* The artefact itself, when the exact original is on this phone. */}
      <EvidenceArtefactCard caseKeys={[event.event_id, event.investigation_case_id, event.patrol_record?.investigationCaseId]} onAvailable={setHasLocalOriginal}
        packTitle={event.headline} packDate={event.occurred_at} packSummary={packSummary} phones={event.evidence_phones} testID="tc-evidence-artefact" />

      <View style={s.evidenceSection} testID="tc-evidence-original">
        <View style={s.evidenceHeader}>
          <View style={[s.evidenceHeaderIcon, { backgroundColor: si.bg }]}>
            <si.Icon size={18} color={si.fg} />
          </View>
          <View style={s.evidenceHeaderText}>
            <Text style={s.evidenceHeaderTitle}>{si.label} observation</Text>
            {subjectName ? (
              <Text style={s.evidenceHeaderSub} numberOfLines={1} testID="tc-evidence-subject">{subjectName}</Text>
            ) : null}
          </View>
        </View>

        <View style={s.evidenceBody}>
          {/* What Apollo recorded about the source. Skipped when the exact original is shown above. */}
          {!hasLocalOriginal ? <>
          {meta?.sender ? <EvidenceField label="From:" value={meta.sender} /> : null}
          {meta?.subject ? <EvidenceField label="Subject:" value={meta.subject} /> : null}
          {meta?.received_at ? <EvidenceField label="Date:" value={formatDateTime(meta.received_at)} /> : null}
          {meta?.preview ? (
            <View style={s.evidenceOriginalContent}>
              <Text style={s.evidenceOriginalText} selectable testID="tc-evidence-preview">{meta.preview}</Text>
            </View>
          ) : null}
          {(meta?.url ?? event.local_indicator) ? (
            <View style={s.evidenceOriginalContent}>
              <Text style={[s.evidenceFieldLabel, { width: "auto", marginBottom: 4 }]}>Observed URL</Text>
              <Text style={s.evidenceOriginalText} selectable testID="tc-evidence-url">
                {meta?.url ?? event.local_indicator}
              </Text>
            </View>
          ) : null}
          {event.indicator_host && !meta?.url && !event.local_indicator ? (
            <EvidenceField label="Domain:" value={event.indicator_host} />
          ) : null}
          </> : null}

          {/* What Apollo found — the recorded facts of the finding only. No analysis and no
              explanation: those belong on Overview. For cases with no sender/URL (device, app,
              network) these facts ARE the evidence. */}
          {recorded && observedFacts.length > 0 ? (
            <View style={s.evidenceOriginalContent} testID="tc-evidence-found">
              <Text style={[s.evidenceFieldLabel, { width: "auto", marginBottom: 4 }]}>What Apollo found</Text>
              {observedFacts.map((line, i) => (
                <View key={i} style={{ flexDirection: "row", gap: spacing.sm }}>
                  <Text style={{ color: "#6B7280", marginTop: 1 }}>•</Text>
                  <Text style={[s.evidenceOriginalText, { flex: 1 }]} selectable testID={`tc-evidence-found-${i}`}>{line}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <EvidenceField label="Observed:" value={formatDateTime(event.occurred_at)} />
          <CaseFactsRows event={event} />
        </View>
      </View>

      <SourcesSection sources={buildCaseSources({ event, investigation: inv })} />
      <EvidencePackButton event={event} facts={observedFacts} sources={buildCaseSources({ event, investigation: inv })} />

      {/* Links found */}
      {meta?.link_count !== null && meta?.link_count !== undefined ? (
        <View style={s.evidenceSection}>
          <CollapseSection
            icon={Link2} iconBg="#DBEAFE" iconFg="#1E3A5F"
            title={`Links found (${meta.link_count})`}
            subtitle={meta.link_count > 0 ? "Links extracted from content" : "No links found"}
            testID="tc-evidence-links"
          >
            {event.local_indicator ? <Text style={s.evidenceOriginalText} selectable>{event.local_indicator}</Text> : null}
            {event.indicator_host ? <EvidenceField label="Domain:" value={event.indicator_host} /> : null}
          </CollapseSection>
        </View>
      ) : null}

      {/* Apollo detection evidence */}
      {event.enforcement_evidence ? (
        <View style={s.evidenceSection}>
          <CollapseSection
            icon={Shield} iconBg="#FEE2E2" iconFg="#991B1B"
            title="Apollo detection evidence"
            subtitle="When and how this was detected"
            testID="tc-evidence-detection"
          >
            <EvidenceField label="Mechanism:" value={event.enforcement_evidence.mechanism.replace(/_/g, " ")} />
            <EvidenceField label="Action:" value={event.enforcement_evidence.enforced_action.replace(/_/g, " ")} />
            <EvidenceField label="Result:" value={event.enforcement_evidence.result.replace(/_/g, " ")} />
            <EvidenceField label="Confidence:" value={event.enforcement_evidence.confidence} />
            {event.enforcement_evidence.destination_domain ? (
              <EvidenceField label="Destination:" value={event.enforcement_evidence.destination_domain} />
            ) : null}
            <EvidenceField label="Observed:" value={formatDateTime(event.enforcement_evidence.observed_at)} />
          </CollapseSection>
        </View>
      ) : null}

      {/* Supporting references */}
      {event.supporting_references && event.supporting_references.length > 0 ? (
        <View style={s.evidenceSection}>
          <CollapseSection
            icon={Globe} iconBg="#D1FAE5" iconFg="#065F46"
            title={`Supporting references (${event.supporting_references.length})`}
            testID="tc-evidence-refs"
          >
            {event.supporting_references.map((ref, i) => (
              <Pressable key={i} onPress={() => void Linking.openURL(ref.url)} style={{ gap: 2 }}>
                <Text style={[s.evidenceFieldLabel, { width: "auto" }]}>{ref.label}</Text>
                <Text style={s.evidenceLink}>{ref.url}</Text>
              </Pressable>
            ))}
          </CollapseSection>
        </View>
      ) : null}
    </View>
  );
}

/** Shows the actual privacy-protected evidence that Magnum DI received.
 *  For text/URL: re-applies the same deterministic privacy function to the local original.
 *  For images: shows the sentUri (the copy actually uploaded after credential blackout).
 *  Never reconstructs evidence from Magnum prose, Higgins explanation, or metadata. */
function InvestigatedEvidenceView({ inv, originalSource, imageEvidence, event, meta }: {
  inv: DeviceInvestigation | null;
  originalSource: OriginalSource | null;
  imageEvidence: ImageEvidenceRecord | null;
  event: PatrolEvent;
  meta: SourceMetadata | null | undefined;
}) {
  const s = useStyles();

  // If no device investigation stored, show unavailable notice
  if (!inv) {
    return (
      <View style={s.evidenceOriginalContent}>
        <Text style={s.provenanceNote} testID="tc-evidence-unavailable">
          Investigation evidence unavailable — this case's record doesn't include the investigation data.
        </Text>
      </View>
    );
  }

  // Build the protected evidence from the local original + deterministic privacy function
  const protectedItems: { kind: string; label: string; content: string | null }[] = [];

  // Text evidence: apply the same credential redaction Magnum received
  if (originalSource?.text) {
    protectedItems.push({
      kind: "text",
      label: originalSource.kind === "email" ? "Email content" : originalSource.kind === "text" ? "Message content" : "Text content",
      content: redactInvestigationSecrets(originalSource.text),
    });
  }

  // URL evidence: apply the same URL sanitization Magnum received
  if (originalSource?.url) {
    protectedItems.push({
      kind: "url",
      label: "URL submitted",
      content: purposeLimitedUrl(originalSource.url),
    });
  }

  // Structured fields from original (sender, subject, etc.) — these are investigative evidence, not personal data
  if (originalSource?.fields?.length) {
    for (const f of originalSource.fields) {
      protectedItems.push({
        kind: "field",
        label: f.label,
        content: redactInvestigationSecrets(f.value),
      });
    }
  }

  // Image evidence: show the actual copy Apollo sent (sentUri from imageEvidence store)
  if (imageEvidence?.sentUri) {
    protectedItems.push({
      kind: "image",
      label: "Screenshot/image sent for investigation",
      content: imageEvidence.sentUri,
    });
  }

  // Fall back to evidence items metadata if no local original was saved
  if (protectedItems.length === 0 && inv.evidenceItems?.length > 0) {
    for (const item of inv.evidenceItems.filter((e) => e.origin === "user_submission")) {
      const transforms = item.transformations?.map((t) => t.description).join("; ") || null;
      protectedItems.push({
        kind: item.kind,
        label: item.label || `${item.kind} evidence`,
        content: transforms ? `[${item.kind}] — Privacy transformations applied: ${transforms}` : `[${item.kind} evidence submitted]`,
      });
    }
  }

  // If truly nothing is available
  if (protectedItems.length === 0) {
    return (
      <View style={s.evidenceOriginalContent}>
        <Text style={s.provenanceNote} testID="tc-evidence-unavailable">
          Investigation evidence unavailable
        </Text>
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.sm }}>
      {protectedItems.map((item, i) => (
        <View key={i} style={s.evidenceOriginalContent}>
          <Text style={[s.evidenceFieldLabel, { width: "auto", marginBottom: 4 }]}>{item.label}</Text>
          {item.kind === "image" && item.content ? (
            <Image source={{ uri: item.content }} style={{ width: "100%", height: 200, borderRadius: radius.sm }} resizeMode="contain" />
          ) : item.content ? (
            <Text style={s.evidenceOriginalText} selectable testID={`tc-evidence-item-${i}`}>
              {item.content}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** Origin, evidence source, what checked it, how complete the record is, and any privacy step — five facts kept
 *  apart. The origin is always the device that detected the case; nothing here says where another copy is. */
function CaseFactsRows({ event }: { event: PatrolEvent }) {
  const s = useStyles();
  const processing = processingLabels(event);
  const privacy = privacyNote(event);
  return (
    <View testID="tc-evidence-case-facts">
      <EvidenceField label="Origin:" value={caseOrigin(event).label} />
      <EvidenceField label="Evidence:" value={evidenceSourceLabel(event)} />
      {processing.length ? <EvidenceField label="Checked:" value={processing.join(", ")} /> : null}
      <EvidenceField label="Record:" value={completenessLabel(event)} />
      {privacy ? <Text style={s.provenanceNote} testID="tc-evidence-privacy">{privacy}</Text> : null}
    </View>
  );
}

function EvidenceField({ label, value }: { label: string; value: string }) {
  const s = useStyles();
  return (
    <View style={s.evidenceFieldRow}>
      <Text style={s.evidenceFieldLabel}>{label}</Text>
      <Text style={s.evidenceFieldValue} selectable>{value}</Text>
    </View>
  );
}

// ── History Tab ──────────────────────────────────────────────────────────────

function HistoryContent({ event }: { event: PatrolEvent }) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { events } = useApollo();
  const inv = useCaseInvestigation(event);
  const timeline = buildTimeline(event, buildCaseSources({ event, investigation: inv }), {
    completedAt: inv?.committedAt ?? null,
    conclusion: inv?.response?.overview ?? null,
    findingCount: inv?.response?.findings?.length,
    answeredBy: inv?.answeredBy ?? null,
  });
  const related = event.scent_id ? events.filter((e) => e.scent_id === event.scent_id && e.event_id !== event.event_id) : [];

  // Merge related events into timeline chronologically
  const relatedEntries: TimelineEntry[] = related.map((r, i) => ({
    id: `tl-related-${i}`,
    timestamp: r.occurred_at,
    title: `Related: ${r.headline && !looksLikeInternalCode(r.headline) ? r.headline : categoryLabel(r.category) + " event"}`,
    description: subjectLabel(r) ?? "Connected event recorded.",
    dotColor: "#6B7280",
    iconId: "content" as const,
  }));
  const fullTimeline = [...timeline, ...relatedEntries].sort((a, b) => {
    if (!a.timestamp) return 1;
    if (!b.timestamp) return -1;
    return Date.parse(a.timestamp) - Date.parse(b.timestamp);
  });

  return (
    <View style={s.content}>
      {/* Timeline */}
      <Card style={{ gap: 0 }} testID="tc-history-timeline">
        {fullTimeline.map((entry, i) => (
          <View key={entry.id} style={s.timelineRow}>
            <View style={s.timelineDotCol}>
              <View style={[s.timelineDot, { backgroundColor: entry.dotColor }]} />
              {i < fullTimeline.length - 1 ? <View style={s.timelineLine} /> : null}
            </View>
            <View style={s.timelineContent}>
              {entry.timestamp ? (
                <Text style={s.timelineTime}>{formatDateTime(entry.timestamp)}</Text>
              ) : (
                <Text style={s.timelineInProgress}>In progress</Text>
              )}
              <Text style={s.timelineTitle}>{entry.title}</Text>
              <Text style={s.timelineDesc}>{entry.description}</Text>
            </View>
          </View>
        ))}
      </Card>

      {/* Related items */}
      <Card style={{ gap: spacing.xs }} testID="tc-history-related">
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
          <View style={s.factIcon}><Link2 size={14} color="#6B7280" /></View>
          <Text style={s.relatedTitle}>Related items ({related.length})</Text>
        </View>
        <Text style={s.relatedSub}>
          {related.length > 0
            ? "Related emails, messages or links will appear here."
            : "No related items. Related emails, messages or links will appear here."}
        </Text>
      </Card>
    </View>
  );
}

// ── Main Screen ──────────────────────────────────────────────────────────────

export default function ThreatCaseScreen() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, focus } = useLocalSearchParams<{ id: string; focus?: string }>();
  const { events, ready, setupDone } = useApollo();
  const event = events.find((e) => e.event_id === id);
  const investigation = useCaseInvestigation(event);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  // The item itself, as held on this device. Nothing here comes from the server's minimised copy.
  const [original, setOriginal] = useState<OriginalSource | null>(null);
  useEffect(() => {
    let active = true;
    if (!id) return;
    void getOriginalSource(id).then((o) => { if (active) setOriginal(o); }).catch(() => undefined);
    return () => { active = false; };
  }, [id]);

  if (ready && !setupDone) return <Redirect href="/onboarding" />;

  if (!event) {
    return (
      <View style={s.root}>
        <View style={[s.headerRow, { paddingTop: insets.top + spacing.sm }]}>
          <Pressable onPress={() => goBackOrHome(router)} style={s.backBtn}><ChevronLeft size={24} color={colors.onSurface} /></Pressable>
          <Text style={s.headerTitle}>Threat Case</Text>
        </View>
        <View style={s.content}><Body>This threat case is no longer available.</Body></View>
      </View>
    );
  }

  const caseId = threatCaseId(event);
  const status = threatCaseStatus(event);
  const statusColor = STATUS_COLORS[status];
  const subtitle = sourceSubtitle(event, original);
  // The same top card as Ask Higgins: kind of check, result and status, when, what it means, who settled it.
  const outcome = outcomeLabel(investigation?.response?.outcome);
  const tone = outcomeTone(investigation?.response?.outcome);
  const outcomeColors = { resting: [colors.restingTint, colors.restingText], barking: [colors.barkingTint, colors.barkingText], ears_up: [colors.ears_upTint, colors.ears_upText], sniffing: [colors.sniffingTint, colors.sniffingText] }[tone] ?? [colors.sniffingTint, colors.sniffingText];
  // A file check is titled from its file evidence: its investigation runs under the Link Gate's case gate.
  const kind = checkKind(event.evidence_profile?.type === "file" ? "file" : investigation?.gates?.[0] ?? event.source_metadata?.type ?? event.category);

  const hasInvestigation = !!(event.investigation_case_id ?? event.patrol_record?.investigationCaseId);
  const hasSubstantiveData = !!(event.what_happened && event.what_happened.length > 30);
  const hasBriefing = !!event.patrol_record?.higginsBriefing;
  const isIncomplete = !hasRecordedFindings(event) && !hasInvestigation && !hasSubstantiveData && !hasBriefing;
  const shownWhatToDo = !isIncomplete && event.what_to_do && !looksLikeInternalCode(event.what_to_do)
    ? event.what_to_do
    : event.patrol_record?.higginsBriefing?.action ?? "Review the investigation details for recommended next steps.";

  return (
    <View style={s.root}>
      {/* Header: back + Threat Case ID + status pill */}
      <View style={[s.headerRow, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable testID="tc-back" onPress={() => goBackOrHome(router)} style={s.backBtn}>
          <ChevronLeft size={24} color={colors.onSurface} />
        </Pressable>
        <Text style={s.headerTitle} testID="tc-case-id">
          Threat Case #{caseId}
        </Text>
      </View>

      {/* Top card — shared with Ask Higgins */}
      <View style={{ marginHorizontal: spacing.md, marginBottom: spacing.xs, gap: spacing.xs }}>
        <ReportHeader
          kind={kind} subtitle={subtitle || null} testID="tc-source-card"
          ids={{ explainer: "tc-overview-outcome-explainer", settled: "tc-overview-settled-reason", serverCopy: "tc-overview-server-copy" }}
          badges={[
            ...(outcome ? [{ label: outcome, bg: outcomeColors[0], fg: outcomeColors[1], testID: "tc-outcome" }] : []),
            { label: STATUS_LABELS[status], bg: statusColor.bg, fg: statusColor.text, testID: "tc-status-pill" },
            // Tagged at the top of the case whenever its input or an outside source behind it was simulated.
            ...(isSimulated(event) ? [{ label: "Simulated", bg: toneTint(colors, "neutral"), fg: toneText(colors, "neutral"), testID: "tc-simulated" }] : []),
          ]}
          time={formatDateTime(event.occurred_at)}
          outcome={outcome ? investigation?.response?.outcome : null}
          settledReason={investigation?.response ? investigation.settledReason : null}
          serverCopyCaseId={investigation?.caseId} showServerCopy={!!investigation?.response}
        />
        {/* Who settled it, for results saved before the reason was recorded. */}
        {!investigation?.settledReason ? <SettledByBadge event={event} testID="tc-settled" /> : null}
      </View>

      {/* A simulated answer is labelled above every tab, in every build. */}
      {hasInvestigation ? (
        <SimulatedAnswerNotice
          caseId={event.investigation_case_id ?? event.patrol_record?.investigationCaseId ?? null}
          refreshKey={status}
          style={{ marginHorizontal: spacing.md, marginBottom: spacing.xs }}
        />
      ) : null}

      {/* Tab bar */}
      <View style={s.tabBar} testID="tc-tab-bar">
        {TAB_LABELS.map(({ id: tabId, label }) => (
          <Pressable key={tabId} style={[s.tab, activeTab === tabId && s.tabActive]} onPress={() => setActiveTab(tabId)} accessibilityRole="tab" accessibilityState={{ selected: activeTab === tabId }} testID={`tc-tab-${tabId}`}>
            <Text style={[s.tabText, activeTab === tabId && s.tabTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>

      {/* Tab content */}
      <ScrollView contentContainerStyle={{ paddingTop: spacing.sm, paddingBottom: insets.bottom + spacing.xl }} testID="tc-scroll">
        {activeTab === "overview" ? (
          <OverviewContent event={event} status={status} shownWhatToDo={shownWhatToDo} original={original} investigation={investigation} />
        ) : activeTab === "evidence" ? (
          <EvidenceContent event={event} />
        ) : activeTab === "history" ? (
          <HistoryContent event={event} />
        ) : (
          <DiReport caseId={event.investigation_case_id ?? event.patrol_record?.investigationCaseId ?? null} triage={event.triage_investigation ?? null} />
        )}
      </ScrollView>
    </View>
  );
}
