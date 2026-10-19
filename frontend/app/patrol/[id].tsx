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
import { Image, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGet } from "@/src/api/client";
import { EventActions } from "@/src/components/EventActions";
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
import { ImageEvidenceCompare } from "@/src/components/ImageEvidenceCompare";
import { ReportScamHelper } from "@/src/components/ReportScamHelper";
import { OriginalSourceView } from "@/src/components/OriginalSourceView";
import { looksLikeInternalCode } from "@/src/domain/messageVoice";
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
  return categoryLabel(event.category) + " threat detected";
}

function sourceSubtitle(event: PatrolEvent): string {
  const meta = event.source_metadata;
  const parts: string[] = [];
  if (meta?.sender) parts.push(`From: ${meta.sender}`);
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

  return (
    <View style={s.content}>
      {/* Higgins briefing */}
      <Card style={{ gap: spacing.sm }} testID="tc-overview-briefing">
        <View style={s.higginsRow}>
          <Image source={higginsAvatar} style={s.higginsAvatar} />
          <View>
            <Text style={s.higginsName}>Higgins</Text>
            <Text style={s.higginsSub}>Here&apos;s what we know so far...</Text>
          </View>
        </View>
        {/* Alert banner */}
        <View style={[s.alertBanner, { backgroundColor: event.state === "resting" ? colors.restingTint : colors.barkingTint }]} testID="tc-overview-alert">
          <View style={[s.alertIcon, { backgroundColor: event.state === "resting" ? colors.resting : colors.barking }]}>
            {event.state === "resting" ? <CircleCheck size={16} color="#FFFFFF" /> : <CircleAlert size={16} color="#FFFFFF" />}
          </View>
          <View style={s.alertContent}>
            <Text style={[s.alertTitle, { color: event.state === "resting" ? colors.restingText : colors.barkingText }]}>
              {briefing?.established ?? event.headline}
            </Text>
            {briefing?.meaning && briefing.meaning !== briefing.established ? (
              <Text style={s.alertBody}>{briefing.meaning}</Text>
            ) : null}
          </View>
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

      {/* Info card */}
      {!event.resolved_at ? (
        <View style={[s.alertBanner, { backgroundColor: "#DBEAFE" }]} testID="tc-overview-info">
          <View style={[s.alertIcon, { backgroundColor: "#2563EB" }]}>
            <Info size={16} color="#FFFFFF" />
          </View>
          <View style={s.alertContent}>
            <Text style={[s.alertTitle, { color: "#1E3A5F" }]}>
              {status === "investigating"
                ? "You don't need to do anything right now."
                : "Review the recommended actions below."}
            </Text>
            <Text style={s.alertBody}>
              {status === "investigating"
                ? "I'll notify you when the investigation is complete."
                : shownWhatToDo}
            </Text>
          </View>
        </View>
      ) : null}

      {/* Actions */}
      {event.resolved_at ? <ReopenCase event={event} /> : <EventActions event={event} hideAsk />}

      {/* Patrol facts */}
      <Card style={{ gap: 0 }} testID="tc-overview-facts">
        <FactRow icon={Shield} label="Detected" value={formatDateTime(event.occurred_at)} />
        <FactRow icon={MessageSquare} label="Source" value={sourceLabel(event)} />
        <FactRow icon={CircleAlert} label="Category" value={categoryLabel(event.category, record?.recordClass)} />
        <FactRow icon={Search} label="Risk level" value={risk.label} valueColor={risk.color} isLast />
      </Card>

      {/* Connected incidents */}
      {event.scent_id ? <ScentSection event={event} /> : null}
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

// ── Evidence Tab ─────────────────────────────────────────────────────────────

function EvidenceContent({ event }: { event: PatrolEvent }) {
  const s = useStyles();
  const { colors } = useTheme();
  const meta = event.source_metadata;
  const record = event.patrol_record;
  const si = sourceIcon(event.category, meta);
  const briefing = record?.higginsBriefing;

  return (
    <View style={s.content}>
      {/* Original source — first and unaltered */}
      <View style={s.evidenceSection} testID="tc-evidence-original">
        <View style={s.evidenceHeader}>
          <View style={[s.evidenceHeaderIcon, { backgroundColor: si.bg }]}>
            <si.Icon size={18} color={si.fg} />
          </View>
          <View style={s.evidenceHeaderText}>
            <Text style={s.evidenceHeaderTitle}>Original {si.label.toLowerCase()} (exact source)</Text>
          </View>
        </View>

        <View style={s.evidenceBody}>
          {/* The saved original source itself — exactly as Apollo investigated it. Metadata only when no original was saved. */}
          <OriginalSourceView caseKeys={[event.event_id, event.investigation_case_id]} fallback={<>
            <Text style={s.provenanceNote} testID="tc-evidence-original-missing">
              {"The original wasn't saved on this device for this case. Apollo saves originals for cases checked from v1.1.14. Server copies are deleted after 24 hours, so older cases can't be recovered."}
            </Text>

          {/* Email fields */}
          {meta?.sender ? <EvidenceField label="From:" value={meta.sender} /> : null}
          {meta?.subject ? <EvidenceField label="Subject:" value={meta.subject} /> : null}
          {meta?.received_at ? <EvidenceField label="Date:" value={formatDateTime(meta.received_at)} /> : null}
          {meta?.reply_to ? <EvidenceField label="Reply-to:" value={meta.reply_to} /> : null}
          {meta?.provider ? <EvidenceField label="Provider:" value={meta.provider} /> : null}
          {meta?.auth_passed !== null && meta?.auth_passed !== undefined ? (
            <EvidenceField label="Auth:" value={meta.auth_passed ? "Passed" : "Failed"} />
          ) : null}

          {/* SMS/message fields */}
          {meta?.preview ? (
            <View style={s.evidenceOriginalContent}>
              <Text style={s.evidenceOriginalText} selectable testID="tc-evidence-preview">{meta.preview}</Text>
            </View>
          ) : null}

          {/* Link/URL */}
          {(meta?.url ?? event.local_indicator) ? (
            <View style={s.evidenceOriginalContent}>
              <Text style={[s.evidenceFieldLabel, { width: "auto", marginBottom: 4 }]}>Original URL</Text>
              <Text style={s.evidenceOriginalText} selectable testID="tc-evidence-url">
                {meta?.url ?? event.local_indicator}
              </Text>
            </View>
          ) : null}

          {/* Domain */}
          {event.indicator_host && !meta?.url && !event.local_indicator ? (
            <EvidenceField label="Domain:" value={event.indicator_host} />
          ) : null}

          {/* Screenshot question */}
          {meta?.user_question ? <EvidenceField label="Question:" value={meta.user_question} /> : null}
          </>} />

          {/* Open original link */}
          {(meta?.url ?? event.local_indicator) ? (
            <Pressable onPress={() => void Linking.openURL((meta?.url ?? event.local_indicator)!)} testID="tc-evidence-open-link">
              <Text style={s.evidenceLink}>Open original source →</Text>
            </Pressable>
          ) : null}

          {/* Evidence provenance */}
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

      {/* Image evidence — original (device only) beside the copy Apollo sent */}
      <ImageEvidenceCompare caseKey={event.event_id} title={event.headline} date={event.occurred_at} summary={{
        overview: briefing?.meaning || event.what_happened || null,
        findings: [...new Set([...(event.why ?? []), ...(briefing?.evidence_points ?? [])])],
        steps: [...new Set([event.what_to_do, briefing?.action].filter((v): v is string => !!v && v !== "No action required."))],
        uncertainties: [],
      }} />
      {event.state !== "resting" ? <ReportScamHelper brand={event.claimed_brand ?? null} caseKey={event.event_id} /> : null}

      {/* Progressive disclosure sections */}

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

      {/* Attachments */}
      {meta?.attachment_count !== null && meta?.attachment_count !== undefined ? (
        <View style={s.evidenceSection}>
          <CollapseSection
            icon={Paperclip} iconBg="#F3F4F6" iconFg="#374151"
            title={`Attachments (${meta.attachment_count})`}
            subtitle={meta.attachment_count > 0
              ? meta.attachment_names?.join(", ") ?? `${meta.attachment_count} file(s)`
              : "No attachments"}
            testID="tc-evidence-attachments"
          >
            {meta.attachment_names?.map((name, i) => (
              <Text key={i} style={s.evidenceOriginalText}>{name}</Text>
            )) ?? <Text style={s.alertBody}>No attachments were found.</Text>}
          </CollapseSection>
        </View>
      ) : null}

      {/* Analysis signals */}
      {briefing?.evidence_points && briefing.evidence_points.length > 0 ? (
        <View style={s.evidenceSection}>
          <CollapseSection
            icon={Search} iconBg="#DBEAFE" iconFg="#1E3A5F"
            title={`${si.label} analysis`}
            subtitle="Headers, sender checks and content signals"
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
  const timeline = buildTimeline(event);
  const related = event.scent_id ? events.filter((e) => e.scent_id === event.scent_id && e.event_id !== event.event_id) : [];

  // Merge related events into timeline chronologically
  const relatedEntries: TimelineEntry[] = related.map((r, i) => ({
    id: `tl-related-${i}`,
    timestamp: r.occurred_at,
    title: `Related: ${r.headline && !looksLikeInternalCode(r.headline) ? r.headline : categoryLabel(r.category) + " event"}`,
    description: r.what_happened && !looksLikeInternalCode(r.what_happened) ? r.what_happened.slice(0, 80) : "Connected event detected.",
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
        <View style={[s.statusPill, { backgroundColor: statusColor.bg }]}>
          <Text style={[s.statusPillText, { color: statusColor.text }]}>{STATUS_LABELS[status]}</Text>
        </View>
      </View>

      {/* Source identity card */}
      <View style={s.sourceCard} testID="tc-source-card">
        <View style={[s.sourceIconWrap, { backgroundColor: si.bg }]}>
          <si.Icon size={22} color={si.fg} />
        </View>
        <View style={s.sourceInfo}>
          <View style={s.sourceBadge}><Text style={s.sourceBadgeText}>{si.label}</Text></View>
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
