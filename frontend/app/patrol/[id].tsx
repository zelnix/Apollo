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
import CircleAlert from "lucide-react-native/icons/circle-alert";
import CircleCheck from "lucide-react-native/icons/circle-check";
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
import React, { useEffect, useState } from "react";
import { Image, Linking, Pressable, ScrollView, Share, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGet } from "@/src/api/client";
import { EventActions } from "@/src/components/EventActions";
import * as Clipboard from "expo-clipboard";
import { Body, Button, Card, Pill } from "@/src/components/ui";
import { scrubMessage } from "@/src/domain/messageVoice";
import {
  threatCaseId,
  threatCaseStatus,
  STATUS_LABELS,
  STATUS_COLORS,
  riskLevel,
  categoryLabel,
  sourceLabel,
  buildTimeline,
  formatDateTime,
  type ThreatCaseStatus,
  type TimelineEntry,
} from "@/src/domain/threatCase";
import type { PatrolEvent, PatrolRecord, SourceMetadata, HigginsBriefing } from "@/src/domain/types";
import { projectPatrolOutcomes } from "@/src/domain/patrolOutcomes";
import { hasLocalEvidence } from "@/src/domain/higginsNarration";
import { subjectLabel } from "@/src/domain/threatSubject";
import { buildCaseSources, type CaseSource } from "@/src/domain/caseSources";
import { subjectDescriptor, threatSubject } from "@/src/domain/threatSubject";
import { buildEvidencePack } from "@/src/domain/evidencePack";
import { recheckPlan } from "@/src/domain/recheckPlan";
import { ImageEvidenceCompare } from "@/src/components/ImageEvidenceCompare";
import { OriginalSourceView } from "@/src/components/OriginalSourceView";
import { TriageSummary } from "@/src/components/TriageSummary";
import { looksLikeInternalCode } from "@/src/domain/messageVoice";
import { redactInvestigationSecrets, purposeLimitedUrl } from "@/src/domain/privacy";
import { getInvestigation, type DeviceInvestigation } from "@/src/investigation/deviceStore";
import { getOriginalSource, type OriginalSource } from "@/src/store/originalSource";
import { listImageEvidence, type ImageEvidenceRecord } from "@/src/store/imageEvidence";
import { goBackOrHome } from "@/src/utils/navigation";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const higginsAvatar = require("@/assets/images/higgins-avatar.png");

type TabKey = "overview" | "evidence" | "history";
const TAB_LABELS: { id: TabKey; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "evidence", label: "Evidence" },
  { id: "history", label: "History" },
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

function sourceTitle(event: PatrolEvent): string {
  const meta = event.source_metadata;
  if (meta?.subject) return meta.subject;
  if (meta?.preview) return meta.preview.length > 60 ? meta.preview.slice(0, 60) + "…" : meta.preview;
  if (meta?.url) return meta.url;
  if (event.headline && !looksLikeInternalCode(event.headline)) return event.headline;
  if (event.indicator_host) return event.indicator_host;
  if (event.category === "call" && event.local_indicator) return `Call from ${event.local_indicator}`;
  return categoryLabel(event.category) + " threat detected";
}

function sourceSubtitle(event: PatrolEvent): string {
  const meta = event.source_metadata;
  const parts: string[] = [];
  if (meta?.sender) parts.push(`From: ${meta.sender}`);
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
  higginsAvatar: { width: 44, height: 44, borderRadius: 22 },
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

function OverviewContent({ event, status, shownWhatToDo }: { event: PatrolEvent; status: ThreatCaseStatus; shownWhatToDo: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const record = event.patrol_record;
  const briefing = record?.higginsBriefing;
  const risk = riskLevel(event.state);
  const hasInvestigation = !!(event.investigation_case_id ?? record?.investigationCaseId);

  // The actual thing this case is about — the recorded identifier when there is one, else the
  // finding statement itself. Never a category name.
  const subject = threatSubject(event);
  const headline = (event.headline || "").trim();
  const subjectLine = subject
    ? subjectDescriptor(subject)
    : headline && !looksLikeInternalCode(headline) ? headline : categoryLabel(event.category, record?.recordClass);

  // Higgins' summary of the evidence — what Apollo established, and what it means where that was
  // separately recorded. Never duplicated.
  const established = (briefing?.established ?? event.what_happened ?? "").trim();
  const meaning = (briefing?.meaning ?? "").trim();
  const evidenceSummary = [established, meaning !== established ? meaning : ""].filter(Boolean);

  // What to do — or an explicit statement that nothing needs doing.
  const action = (shownWhatToDo || "").trim();
  const noAction = !action || /^no action required\.?$/i.test(action);
  const todo = event.resolved_at
    ? "Nothing to do — this case is closed."
    : status === "investigating"
      ? "Nothing to do right now. I'll tell you as soon as the investigation finishes."
      : noAction ? "Nothing to do." : action;

  return (
    <View style={s.content}>
      {/* Higgins report — names the actual thing, summarises the evidence, and states what to do
          (or that there's nothing to do). Deliberately uncoloured: the status pill carries severity. */}
      <Card style={{ gap: spacing.sm }} testID="tc-overview-briefing">
        <View style={s.higginsRow}>
          <Image source={higginsAvatar} style={s.higginsAvatar} />
          <View>
            <Text style={s.higginsName}>Higgins</Text>
            <Text style={s.higginsSub}>Here&apos;s what we know so far...</Text>
          </View>
        </View>
        <View style={s.report} testID="tc-overview-alert">
          <Text style={s.reportSubject} testID="tc-overview-subject">{subjectLine}</Text>
          {evidenceSummary.map((para, i) => (
            <Text key={i} style={s.reportBody} testID={`tc-overview-summary-${i}`}>{para}</Text>
          ))}
          <Text style={s.reportLabel}>What to do</Text>
          <Text style={s.reportBody} testID="tc-overview-todo">{todo}</Text>
        </View>
      </Card>

      {/* Current status / investigation progress */}
      {hasInvestigation || status === "investigating" ? (
        <Card style={{ gap: spacing.xs }} testID="tc-overview-status">
          <Text style={s.sectionTitle}>Current status</Text>
          <View style={s.progressRow}>
            <View style={[s.progressDot, { backgroundColor: "#2563EB" }]} />
            <View style={{ flex: 1 }}>
              <Text style={s.progressText}>Investigating with Magnum DI</Text>
              <Text style={s.progressSub}>Analysing sender, links and content…</Text>
            </View>
          </View>
        </Card>
      ) : null}

      {/* Actions */}
      {event.resolved_at ? <ReopenCase event={event} /> : <EventActions event={event} hideAsk />}
      {!event.resolved_at && event.reopened_at ? <RecheckCase event={event} /> : null}

      {/* Patrol facts */}
      <Card style={{ gap: 0 }} testID="tc-overview-facts">
        <FactRow icon={Shield} label="Detected" value={formatDateTime(event.occurred_at)} />
        <FactRow icon={MessageSquare} label="Source" value={sourceLabel(event)} />
        {event.category === "call" && event.local_indicator ? (
          <FactRow icon={Phone} label="Number" value={event.local_indicator} />
        ) : null}
        <FactRow icon={CircleAlert} label="Category" value={categoryLabel(event.category, record?.recordClass)} />
        <FactRow icon={Search} label="Risk level" value={risk.label} valueColor={risk.color} isLast />
      </Card>

      {/* Triage investigation — the stored deterministic record. No model call. */}
      {event.triage_investigation ? <TriageSummary record={event.triage_investigation} /> : null}

      {/* Connected incidents */}
      {event.scent_id ? <ScentSection event={event} /> : null}
    </View>
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
        const outcome = await checkLink(plan.url, event.scent_id ?? undefined);
        openResult(outcome.event, "Apollo re-checked the website and found nothing to flag this time.");
      } else if (plan.kind === "message") {
        const original = await getOriginalSource(event.event_id).catch(() => null);
        const text = (original?.text ?? "").trim();
        if (!text) {
          showToast("Apollo can't re-check this one here — the original message isn't stored with this case. Open the Text or Email check and submit it again.", "growling");
          return;
        }
        const from = original?.fields?.find((f) => /from|sender/i.test(f.label))?.value ?? event.source_metadata?.sender ?? "";
        const outcome = await checkMessage(from, text);
        openResult(outcome.event, "Apollo re-checked the message and found nothing to flag this time.");
      } else if (plan.kind === "number") {
        const risk = await checkNumberRisk(plan.number);
        showToast(`Re-check complete: ${risk.higgins.headline}`, "neutral");
      }
    } catch (error) {
      showToast(`Apollo couldn't finish the re-check (${error instanceof Error ? error.message : "reason not recorded"}).`, "growling");
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
          Apollo connected {related.length} related {related.length === 1 ? "event" : "events"} to this threat.
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
function useCaseInvestigation(event: PatrolEvent): DeviceInvestigation | null {
  const caseId = event.investigation_case_id ?? event.patrol_record?.investigationCaseId ?? null;
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
      showToast("Apollo couldn't copy to the clipboard on this device.", "growling");
    }
  };
  const share = async () => {
    try {
      await Share.share({ message: pack(), title: `Apollo Threat Case ${threatCaseId(event)}` });
    } catch {
      showToast("Apollo couldn't open the share sheet on this device.", "growling");
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
          <Text style={s.evidenceHeaderTitle}>Sources Apollo used</Text>
          <Text style={s.evidenceHeaderSub}>What each source returned</Text>
        </View>
      </View>
      <View style={s.evidenceBody}>
        {sources.map((src, i) => (
          <View key={src.id} style={s.evidenceOriginalContent} testID={`tc-evidence-source-${i}`}>
            <Text style={[s.evidenceFieldLabel, { width: "auto", marginBottom: 4 }]}>
              {src.name}{src.answered ? "" : " — didn't answer"}
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
  const localEvidence = hasLocalEvidence(event);
  // The recorded facts of the finding — what Apollo found, never why it matters. Sources: the
  // finding statement itself, Apollo's recorded signals, and evidence the deterministic Triage
  // investigation actually captured. Deduplicated, no interpretation added.
  const observedFacts = Array.from(new Set([
    (event.headline || "").trim(),
    ...(event.why ?? []).map((w) => w.trim()),
    ...(event.triage_investigation?.rules ?? [])
      .filter((r) => r.result === "met")
      .flatMap((r) => r.evidence)
      .map((e) => e.trim()),
  ].filter((line) => !!line && !looksLikeInternalCode(line))));

  // Load device investigation data for investigation-sourced cases
  const [inv, setInv] = useState<DeviceInvestigation | null>(null);
  const [origSrc, setOrigSrc] = useState<OriginalSource | null>(null);
  const [imgEvidence, setImgEvidence] = useState<ImageEvidenceRecord | null>(null);
  const [loaded, setLoaded] = useState(false);

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
        {/* Primary: Evidence investigated by Magnum DI */}
        <View style={s.evidenceSection} testID="tc-evidence-investigated">
          <View style={s.evidenceHeader}>
            <View style={[s.evidenceHeaderIcon, { backgroundColor: si.bg }]}>
              <si.Icon size={18} color={si.fg} />
            </View>
            <View style={s.evidenceHeaderText}>
              <Text style={s.evidenceHeaderTitle}>Evidence investigated by Magnum DI</Text>
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
                This evidence was submitted for investigation after Apollo&apos;s privacy protection step.
              </Text>
            )}
          </View>
        </View>

        <SourcesSection sources={buildCaseSources({ event, investigation: inv })} />
        <EvidencePackButton event={event} facts={observedFacts} sources={buildCaseSources({ event, investigation: inv })} />

        {/* Image evidence — show the copy Apollo sent (not the original) */}
        <ImageEvidenceCompare caseKey={event.event_id} title={event.headline} date={event.occurred_at} summary={{
          overview: briefing?.meaning || event.what_happened || null,
          findings: [...new Set([...(event.why ?? []), ...(briefing?.evidence_points ?? [])])],
          steps: [...new Set([event.what_to_do, briefing?.action].filter((v): v is string => !!v && v !== "No action required."))],
          uncertainties: [],
        }} />

        {/* Analysis signals (from Magnum DI findings — NOT presented as evidence) */}
        {briefing?.evidence_points && briefing.evidence_points.length > 0 ? (
          <View style={s.evidenceSection}>
            <CollapseSection
              icon={Search} iconBg="#DBEAFE" iconFg="#1E3A5F"
              title={`${si.label} analysis`}
              subtitle="Findings from Magnum DI investigation"
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
          <OriginalSourceView caseKeys={[event.event_id]} fallback={<>
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
          </>} />

          {/* What Apollo found — the recorded facts of the finding only. No analysis and no
              explanation: those belong on Overview. For cases with no sender/URL (device, app,
              network) these facts ARE the evidence. */}
          {localEvidence && observedFacts.length > 0 ? (
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
          {!localEvidence ? (
            <Text style={s.provenanceNote} testID="tc-evidence-not-local">
              The full evidence for this finding is only available on the device where it happened.
            </Text>
          ) : null}

          {event.evidence_provenance ? (
            <Text style={s.provenanceNote}>
              Source: {event.evidence_provenance === "local_device" ? "captured on this device"
                : event.evidence_provenance === "server_projected" ? "from server analysis"
                : event.evidence_provenance === "dns_observation" ? "DNS monitoring"
                : "incomplete data"}
            </Text>
          ) : null}
        </View>
      </View>

      <SourcesSection sources={buildCaseSources({ event, investigation: inv })} />
      <EvidencePackButton event={event} facts={observedFacts} sources={buildCaseSources({ event, investigation: inv })} />

      <ImageEvidenceCompare caseKey={event.event_id} title={event.headline} date={event.occurred_at} summary={{
        overview: briefing?.meaning || event.what_happened || null,
        findings: [...new Set([...(event.why ?? []), ...(briefing?.evidence_points ?? [])])],
        steps: [...new Set([event.what_to_do, briefing?.action].filter((v): v is string => !!v && v !== "No action required."))],
        uncertainties: [],
      }} />

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
          Investigation evidence unavailable — the investigation data for this case was not saved on this device.
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
      label: "Screenshot/image sent to Magnum DI",
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
  const timeline = buildTimeline(event, buildCaseSources({ event, investigation: inv }));
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
  const [activeTab, setActiveTab] = useState<TabKey>("overview");

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
  const si = sourceIcon(event.category, event.source_metadata);
  const title = sourceTitle(event);
  const subtitle = sourceSubtitle(event);

  const hasInvestigation = !!(event.investigation_case_id ?? event.patrol_record?.investigationCaseId);
  const hasSubstantiveData = !!(event.what_happened && event.what_happened.length > 30);
  const hasBriefing = !!event.patrol_record?.higginsBriefing;
  const isIncomplete = !hasLocalEvidence(event) && !hasInvestigation && !hasSubstantiveData && !hasBriefing;
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
        <Text style={s.headerTitle} numberOfLines={1} testID="tc-case-id">
          Threat Case #{caseId}
        </Text>
      </View>

      {/* Source identity card */}
      <View style={s.sourceCard} testID="tc-source-card">
        <View style={[s.sourceIconWrap, { backgroundColor: si.bg }]}>
          <si.Icon size={22} color={si.fg} />
        </View>
        <View style={s.sourceInfo}>
          <View style={s.sourceBadgeRow}>
            <View style={s.sourceBadge}><Text style={s.sourceBadgeText}>{si.label}</Text></View>
            <View style={[s.statusPill, { backgroundColor: statusColor.bg }]} testID="tc-status-pill">
              <Text style={[s.statusPillText, { color: statusColor.text }]}>{STATUS_LABELS[status]}</Text>
            </View>
          </View>
          <Text style={s.sourceTitle} numberOfLines={2}>{title}</Text>
          {subtitle ? <Text style={s.sourceSub} numberOfLines={1}>{subtitle}</Text> : null}
          <Text style={s.sourceTime}>{formatDateTime(event.occurred_at)}</Text>
        </View>
      </View>

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
          <OverviewContent event={event} status={status} shownWhatToDo={shownWhatToDo} />
        ) : activeTab === "evidence" ? (
          <EvidenceContent event={event} />
        ) : (
          <HistoryContent event={event} />
        )}
      </ScrollView>
    </View>
  );
}
