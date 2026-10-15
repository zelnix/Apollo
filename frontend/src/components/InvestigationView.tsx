// Unified Investigation Report: four-tab structure — Overview | Probe | Evidence | History.
// Default to Overview. Matches the approved Threat Case reporting experience.
// Apollo detects. Magnum DI investigates. Higgins explains findings and guides users.
import * as FileSystem from "expo-file-system";
import * as Clipboard from "expo-clipboard";
import * as Sharing from "expo-sharing";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, Text, View } from "react-native";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import CircleCheck from "lucide-react-native/icons/circle-check";
import Clock from "lucide-react-native/icons/clock";
import Copy from "lucide-react-native/icons/copy";
import FileText from "lucide-react-native/icons/file-text";
import Globe from "lucide-react-native/icons/globe";
import Info from "lucide-react-native/icons/info";
import Mail from "lucide-react-native/icons/mail";
import MessageSquare from "lucide-react-native/icons/message-square";
import Phone from "lucide-react-native/icons/phone";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import Search from "lucide-react-native/icons/search";
import Shield from "lucide-react-native/icons/shield";
import { Body, Button, Card, Pill, type Tone } from "@/src/components/ui";
import { API_BASE } from "@/src/api/client";
import { getDeviceToken } from "@/src/auth/deviceIdentity";
import { EvidencePopup } from "@/src/components/EvidencePopup";
import { assessmentLabel, attentionLabel, investigationHistory, scrubMessage } from "@/src/domain/messageVoice";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import type { CaseState } from "@/src/investigation/caseStore";
import * as investigationApi from "@/src/investigation/client";
import type { ActionProposal, Attention, EvidenceItem, Gate, SourceReference } from "@/src/investigation/types";
import { isExecutable, runAction, type ActionOutcome } from "@/src/settings/actions";
import { onRecheck, retryFailedAttempt } from "@/src/settings/recheck";

const higginsAvatar = require("@/assets/images/higgins-avatar.png");

// ── Types ────────────────────────────────────────────────────────────────────

type TabId = "overview" | "probe" | "evidence" | "history";
const TAB_LABELS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "probe", label: "Probe" },
  { id: "evidence", label: "Evidence" },
  { id: "history", label: "History" },
];

// ── Styles ───────────────────────────────────────────────────────────────────

const useStyles = makeStyles((c) => ({
  // ── Status Card ──
  statusCard: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, borderWidth: 0.25, borderColor: c.border, padding: spacing.lg, gap: spacing.sm },
  statusRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm },
  statusIconWrap: { width: 28, height: 28, borderRadius: 14, alignItems: "center" as const, justifyContent: "center" as const },
  statusInfo: { flex: 1, gap: 2 },
  statusTitle: { fontFamily: fonts.textSemibold, fontSize: 16, color: c.onSurface },
  statusTimestamp: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  statusBadge: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4, paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill, alignSelf: "flex-start" as const },
  statusBadgeText: { fontFamily: fonts.textSemibold, fontSize: 12 },
  confidenceText: { fontFamily: fonts.text, fontSize: 12, color: c.muted },

  // ── Tab bar ──
  tabBar: { flexDirection: "row" as const, borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.surfaceSecondary },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" as const, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: c.brandPrimary },
  tabText: { fontFamily: fonts.textMedium, fontSize: 14, color: c.muted },
  tabTextActive: { color: c.onSurface, fontFamily: fonts.textSemibold },

  // ── Overview tab ──
  higginsHeader: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md, marginBottom: spacing.md },
  higginsAvatarWrap: { width: 48, height: 48, borderRadius: 24, overflow: "hidden" as const, backgroundColor: c.surfaceTertiary },
  higginsAvatarImg: { width: 48, height: 48 },
  higginsName: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface },
  higginsTime: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  briefingText: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurfaceSecondary },
  sectionHeader: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface, marginTop: spacing.md },

  // ── Action cards ──
  actionCard: { backgroundColor: c.surfaceSecondary, borderRadius: radius.md, borderWidth: 0.25, borderColor: c.border, padding: spacing.lg, flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md },
  actionIconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: "center" as const, justifyContent: "center" as const },
  actionContent: { flex: 1, gap: 2 },
  actionTitle: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.brandPrimary },
  actionDescription: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  infoCard: { borderRadius: radius.md, padding: spacing.lg, flexDirection: "row" as const, gap: spacing.md, alignItems: "flex-start" as const },
  infoIconWrap: { width: 28, height: 28, borderRadius: 14, alignItems: "center" as const, justifyContent: "center" as const, marginTop: 2 },
  infoContent: { flex: 1, gap: 4 },
  infoTitle: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface, lineHeight: 20 },
  infoBody: { fontFamily: fonts.text, fontSize: 13, lineHeight: 19, color: c.onSurfaceSecondary },

  // ── Shared content ──
  text: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  muted: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.muted },
  heading: { fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurfaceSecondary, marginTop: spacing.xs },
  sectionTitle: { fontFamily: fonts.textSemibold, fontSize: 11, letterSpacing: 0.4, color: c.muted, textTransform: "uppercase" },
  row: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: spacing.sm, alignItems: "center" as const },
  source: { paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: c.border },
  link: { fontFamily: fonts.textMedium, fontSize: 14, color: c.brandPrimary },
  question: { backgroundColor: c.surfaceTertiary, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  turn: { gap: spacing.xs, paddingVertical: spacing.sm, borderTopWidth: 1, borderTopColor: c.border },
  user: { alignSelf: "flex-end" as const, backgroundColor: c.surfaceSecondary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: c.border, maxWidth: "88%" as const },
  divider: { height: 1, backgroundColor: c.border, marginVertical: spacing.xs },

  // ── Evidence tab ──
  evidenceCard: { gap: spacing.xs, borderColor: c.border, borderWidth: 1, borderRadius: radius.md, padding: spacing.md },
  evidenceLabel: { fontFamily: fonts.textMedium, fontSize: 12, color: c.muted, textTransform: "uppercase", letterSpacing: 0.3 },

  // ── History tab ──
  timelineItem: { flexDirection: "row" as const, gap: spacing.md },
  timelineTrack: { alignItems: "center" as const, width: 32 },
  timelineDot: { width: 32, height: 32, borderRadius: 16, alignItems: "center" as const, justifyContent: "center" as const, zIndex: 1 },
  timelineLine: { width: 2, flex: 1, marginTop: -2, marginBottom: -2 },
  timelineContent: { flex: 1, paddingBottom: spacing.lg },
  timelineContentLast: { flex: 1, paddingBottom: spacing.sm },
  timelineRow: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "flex-start" as const, gap: spacing.sm },
  timelineTitle: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface, lineHeight: 20, flex: 1 },
  timelineTime: { fontFamily: fonts.text, fontSize: 11, color: c.muted },
  timelineBody: { fontFamily: fonts.text, fontSize: 13, lineHeight: 19, color: c.onSurfaceSecondary, marginTop: 4 },

  // ── Technical Error Details ──
  diagSection: { gap: spacing.sm },
  diagToggle: { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, paddingVertical: spacing.sm },
  diagToggleText: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface },
  diagCard: { backgroundColor: c.surfaceTertiary, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs, borderWidth: 1, borderColor: c.border },
  diagRow: { flexDirection: "row" as const, gap: spacing.sm },
  diagLabel: { fontFamily: fonts.textSemibold, fontSize: 12, color: c.muted, minWidth: 100 },
  diagValue: { fontFamily: fonts.text, fontSize: 12, color: c.onSurface, flex: 1, flexShrink: 1 },
  diagDivider: { height: 1, backgroundColor: c.border, marginVertical: spacing.xs },
  retryEntry: { flexDirection: "row" as const, gap: spacing.xs, paddingVertical: 2 },
  retryBadge: { fontFamily: fonts.textMedium, fontSize: 11, color: c.muted },
  retryText: { fontFamily: fonts.text, fontSize: 12, color: c.onSurface, flex: 1, flexShrink: 1 },
  copyBtn: { marginTop: spacing.xs },

  // ── Raw provider response ──
  rawBlock: { backgroundColor: c.surfaceTertiary, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: c.border },
  rawHeader: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const, marginBottom: spacing.sm },
  rawTitle: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.onSurface },
  rawCopyBtn: { flexDirection: "row" as const, alignItems: "center" as const, gap: 4 },
  rawCopyText: { fontFamily: fonts.textMedium, fontSize: 12, color: c.brandPrimary },
  rawCode: { fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }), fontSize: 12, color: c.onSurface, lineHeight: 18 },
  sensitiveRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
  sensitiveText: { fontFamily: fonts.text, fontSize: 12, color: c.muted, flex: 1 },

  // ── Preserved legacy ──
  card: { gap: spacing.sm, borderColor: c.navyBorder },
  higginsExplanation: { backgroundColor: c.surfaceTertiary, borderRadius: radius.md, padding: spacing.md, borderLeftWidth: 3, borderLeftColor: c.gold, gap: spacing.xs },
  higginsExplainText: { fontFamily: fonts.text, fontSize: 14, lineHeight: 22, color: c.onSurface },
  higginsExplainLabel: { fontFamily: fonts.textSemibold, fontSize: 11, letterSpacing: 0.3, color: c.gold, textTransform: "uppercase" },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Attention projection → Apollo tone. */
export function attentionTone(attention: Attention): Tone { return attention === "urgent" || attention === "action_needed" ? "barking" : attention === "review" ? "growling" : "resting"; }

function plain(markdown: string) {
  return scrubMessage(markdown.replace(/^#{1,6}\s*/gm, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1").replace(/`(.+?)`/g, "$1").replace(/^\s*[-*]\s+/gm, "• ").replace(/\[(.+?)\]\((https?:[^)]+)\)/g, "$1 ($2)"));
}

/** Build a copyable diagnostics record from failure data. */
function buildDiagnosticsCopy(failure: Record<string, unknown> | null | undefined, caseId?: string): string {
  if (!failure) return "No diagnostic information available.";
  const lines: string[] = ["── Technical Error Details ──"];
  const diag = (failure.diagnostics ?? {}) as Record<string, unknown>;
  const addLine = (label: string, value: unknown) => { if (value !== null && value !== undefined && value !== "") lines.push(`${label}: ${String(value)}`); else lines.push(`${label}: Unavailable`); };
  addLine("Failing component", diag.component);
  addLine("Service/provider", diag.service);
  addLine("Operation", diag.operation);
  addLine("Original error code", diag.originalErrorCode ?? diag.original_error_code);
  addLine("HTTP status", diag.httpStatus ?? diag.http_status);
  addLine("Original error message", diag.originalMessage ?? diag.original_message);
  addLine("Exception type", diag.exceptionType ?? diag.exception_type);
  addLine("Timestamp", diag.timestamp);
  const durMs = diag.durationMs ?? diag.duration_ms;
  addLine("Duration", durMs ? `${durMs}ms` : undefined);
  addLine("Case ID", caseId ?? diag.caseId ?? diag.case_id);
  addLine("Job ID", diag.jobId ?? diag.job_id);
  addLine("Request ID", diag.requestId ?? diag.request_id);
  addLine("Final status", diag.finalStatus ?? diag.final_status);
  addLine("Failure code", failure.code);
  addLine("Retryable", failure.retryable);
  const history = (failure.retryHistory ?? failure.retry_history ?? []) as Record<string, unknown>[];
  if (history.length) {
    lines.push("\n── Investigation Attempts ──");
    for (const rh of history) {
      const attempt = rh.attempt ?? "?";
      const kind = rh.kind ?? "unknown";
      const outcome = rh.outcome ?? "unknown";
      const code = rh.failureCode ?? rh.failure_code ?? "";
      const msg = rh.failureMessage ?? rh.failure_message ?? "";
      const ts = rh.timestamp ?? "";
      const dur = rh.durationMs ?? rh.duration_ms;
      lines.push(`  Attempt ${attempt} (${String(kind).replace(/_/g, " ")}) → ${outcome}${code ? ` [${code}]` : ""}${msg ? `: ${String(msg).slice(0, 200)}` : ""}${ts ? ` at ${ts}` : ""}${dur ? ` (${dur}ms)` : ""}`);
    }
  }
  return lines.join("\n");
}

/** Map failure to Higgins-style user-facing explanation. */
function higginsExplanation(failure: Record<string, unknown> | null | undefined, isRetrying: boolean): string {
  if (!failure) return "";
  const code = String(failure.code ?? "");
  const history = (failure.retryHistory ?? failure.retry_history ?? []) as unknown[];
  if (isRetrying) {
    if (code === "rate_limited") return "Magnum DI has temporarily reached the analysis service's request limit. It's waiting briefly before trying again.";
    if (code === "provider_unavailable") return "Magnum DI's analysis service took longer than expected to respond. It's automatically trying again, so you don't need to do anything just yet.";
    if (code === "budget_exhausted") return "Magnum DI ran out of processing time before it could finish. It's attempting to continue the investigation using the information already collected.";
    return "Magnum DI encountered a temporary issue and is automatically retrying.";
  }
  if (code === "provider_configuration") return "Magnum DI couldn't access one of its analysis services because it isn't configured correctly. This needs a technical fix rather than another immediate attempt.";
  if (history.length > 1) return "Magnum DI couldn't complete the investigation because the analysis service remained unavailable after several attempts. I'll show you any findings already collected. You can try again later.";
  if (code === "evidence_expired") return "Temporary evidence expired before the investigation could finish. A new investigation with fresh evidence may be needed.";
  return "Magnum DI couldn't complete the investigation, but I can't confirm exactly what interrupted it. I'll show you the available findings and the technical details so we can identify what needs fixing.";
}

/** Gate-specific display info for the status card. */
function gateInfo(gates: Gate[] | undefined): { title: string; IconComponent: React.ComponentType<{ size: number; color: string }>; iconBg: string; iconColor: string } {
  const primary = gates?.[0];
  switch (primary) {
    case "text": return { title: "Message check", IconComponent: MessageSquare, iconBg: "rgba(212,120,10,0.15)", iconColor: "#D4780A" };
    case "call": return { title: "Call check", IconComponent: Phone, iconBg: "#DBEAFE", iconColor: "#1E3A5F" };
    case "email": return { title: "Email check", IconComponent: Mail, iconBg: "#DBEAFE", iconColor: "#1E3A5F" };
    case "site": case "link": return { title: "Website check", IconComponent: Globe, iconBg: "#DBEAFE", iconColor: "#1E3A5F" };
    case "file": return { title: "File check", IconComponent: FileText, iconBg: "#DBEAFE", iconColor: "#1E3A5F" };
    case "app": return { title: "App check", IconComponent: Search, iconBg: "#DBEAFE", iconColor: "#1E3A5F" };
    case "device": return { title: "Device check", IconComponent: Shield, iconBg: "#DBEAFE", iconColor: "#1E3A5F" };
    case "account": return { title: "Account check", IconComponent: Shield, iconBg: "#DBEAFE", iconColor: "#1E3A5F" };
    case "network": return { title: "Network check", IconComponent: Globe, iconBg: "#DBEAFE", iconColor: "#1E3A5F" };
    default: return { title: "Investigation", IconComponent: Search, iconBg: "#DBEAFE", iconColor: "#1E3A5F" };
  }
}

/** Investigation status for the badge. */
function statusInfo(phase: string, response: { completion?: string } | null, _failure: unknown): { label: string; tone: "barking" | "resting" | "ears_up" | "sniffing" } {
  if (phase === "expired") return { label: "Expired", tone: "barking" };
  if (phase === "failed") return { label: "Incomplete", tone: "barking" };
  if (response) {
    if (response.completion === "complete") return { label: "Complete", tone: "resting" };
    if (response.completion === "partial") return { label: "Partial", tone: "ears_up" };
    if (response.completion === "waiting_user") return { label: "Question pending", tone: "ears_up" };
  }
  return { label: "In progress", tone: "sniffing" };
}

/** Build a JSON representation of raw provider response for display. */
function buildRawProviderResponse(failure: Record<string, unknown> | null | undefined): string | null {
  if (!failure) return null;
  const diag = (failure.diagnostics ?? {}) as Record<string, unknown>;
  const code = diag.originalErrorCode ?? diag.original_error_code;
  const message = diag.originalMessage ?? diag.original_message;
  const httpStatus = diag.httpStatus ?? diag.http_status;
  if (!code && !message && !httpStatus) return null;
  const error: Record<string, unknown> = {};
  if (code !== null && code !== undefined) error.code = code;
  if (message) error.message = message;
  if (httpStatus) error.status = httpStatus;
  return JSON.stringify({ error }, null, 2);
}

/** Retry kind label. */
function kindLabel(kind: string) {
  if (kind === "provider_retry") return "Provider retry";
  if (kind === "job_resume") return "Auto-resume";
  if (kind === "stream_reconnect") return "Reconnection";
  if (kind === "manual_retry") return "Manual retry";
  return kind.replace(/_/g, " ");
}

/** Timeline entry for History tab. */
interface TimelineEntry { title: string; body: string; at: string; iconType: "create" | "working" | "retry" | "complete" | "failed" | "question" }

function buildTimeline(state: CaseState): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const { caseData, turns, failure, phase, response } = state;
  if (caseData) entries.push({ title: "Investigation opened", body: "Magnum DI began the investigation.", at: caseData.createdAt, iconType: "create" });
  for (const turn of turns) entries.push({ title: "Follow-up submitted", body: `You asked: "${turn.question.slice(0, 100)}${turn.question.length > 100 ? "\u2026" : ""}"`, at: turn.committedAt, iconType: "question" });
  const history = ((failure as unknown as Record<string, unknown> | null)?.retryHistory ?? (failure as unknown as Record<string, unknown> | null)?.retry_history ?? []) as Record<string, unknown>[];
  for (const rh of history) {
    entries.push({ title: kindLabel(String(rh.kind ?? "Retry")), body: `${rh.outcome === "success" ? "Succeeded" : "Failed"}${rh.failureCode || rh.failure_code ? ` \u2014 ${rh.failureCode ?? rh.failure_code}` : ""}`, at: String(rh.timestamp ?? caseData?.createdAt ?? ""), iconType: rh.outcome === "success" ? "complete" : "retry" });
  }
  if (response && (phase === "answered" || phase === "waiting_user")) {
    entries.push({ title: response.completion === "complete" ? "Investigation complete" : "Results available", body: response.completion === "complete" ? "Magnum DI completed the investigation within scope." : response.completion === "partial" ? "Magnum DI provided partial results." : "Magnum DI is waiting for your answer.", at: caseData?.updatedAt ?? caseData?.createdAt ?? "", iconType: "complete" });
  } else if (phase === "failed") {
    entries.push({ title: "Investigation incomplete", body: failure?.message ?? "The investigation could not be completed.", at: caseData?.updatedAt ?? caseData?.createdAt ?? "", iconType: "failed" });
  } else if (phase === "expired") {
    entries.push({ title: "Investigation expired", body: "Temporary evidence expired before the investigation finished.", at: caseData?.updatedAt ?? "", iconType: "failed" });
  }
  return entries.sort((a, b) => a.at.localeCompare(b.at));
}

function timelineDotColor(type: string): string {
  switch (type) { case "create": return "#2563EB"; case "working": return "#7C3AED"; case "retry": return "#D97706"; case "complete": return "#16A34A"; case "failed": return "#DC2626"; case "question": return "#D97706"; default: return "#6B7280"; }
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SourceRow({ source, s }: { source: SourceReference; s: ReturnType<typeof useStyles> }) {
  return <Pressable style={s.source} onPress={() => void WebBrowser.openBrowserAsync(source.url)} accessibilityRole="link" testID={`inv-source-${source.id}`}>
    <Text style={s.link}>{source.title || source.url}</Text>
    <Text style={s.muted}>{source.authority === "official" ? "Official platform/vendor source" : source.authority === "self_claimed" ? "Fetched from the destination itself \u2014 not independent" : "Search result \u2014 publisher not independently verified"} \u00B7 {scrubMessage(source.retrieval)}</Text>
  </Pressable>;
}

/** Single row in the diagnostic detail display. */
function DiagRow({ label, value, s }: { label: string; value: unknown; s: ReturnType<typeof useStyles> }) {
  const display = value !== null && value !== undefined && value !== "" ? String(value) : "Unavailable";
  return <View style={s.diagRow}><Text style={s.diagLabel}>{label}</Text><Text style={s.diagValue}>{display}</Text></View>;
}

/** Tab bar matching the approved mock-up. */
function TabBar({ active, onChange, s }: { active: TabId; onChange: (id: TabId) => void; s: ReturnType<typeof useStyles> }) {
  return (
    <View style={s.tabBar} testID="inv-tab-bar">
      {TAB_LABELS.map(({ id, label }) => (
        <Pressable key={id} style={[s.tab, active === id && s.tabActive]} onPress={() => onChange(id)} accessibilityRole="tab" accessibilityState={{ selected: active === id }} testID={`inv-tab-${id}`}>
          <Text style={[s.tabText, active === id && s.tabTextActive]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Expandable Technical Error Details section. */
function TechnicalErrorDetails({ failure, caseId, s }: { failure: Record<string, unknown> | null | undefined; caseId?: string; s: ReturnType<typeof useStyles> }) {
  const [expanded, setExpanded] = useState(false);
  const [copyNote, setCopyNote] = useState("");
  const { colors } = useTheme();
  if (!failure) return null;
  const diag = (failure.diagnostics ?? {}) as Record<string, unknown>;
  const history = (failure.retryHistory ?? failure.retry_history ?? []) as Record<string, unknown>[];
  const hasDiag = Object.values(diag).some((v) => v !== null && v !== undefined && v !== "");

  return <View style={s.diagSection} testID="inv-diag-section">
    <Pressable style={s.diagToggle} onPress={() => setExpanded((v) => !v)} testID="inv-diag-toggle">
      <Text style={s.diagToggleText}>Technical error details</Text>
      {expanded ? <ChevronUp size={18} color={colors.muted} /> : <ChevronDown size={18} color={colors.muted} />}
    </Pressable>
    {expanded ? <View style={s.diagCard} testID="inv-diag-details">
      {hasDiag ? <>
        <DiagRow s={s} label="Component" value={diag.component} />
        <DiagRow s={s} label="Service" value={diag.service} />
        <DiagRow s={s} label="Operation" value={diag.operation} />
        <View style={s.diagDivider} />
        <DiagRow s={s} label="Failure" value={failure.code} />
        <DiagRow s={s} label="HTTP status" value={diag.httpStatus ?? diag.http_status} />
        <DiagRow s={s} label="Error code" value={diag.originalErrorCode ?? diag.original_error_code} />
        <DiagRow s={s} label="Error message" value={diag.originalMessage ?? diag.original_message} />
        <DiagRow s={s} label="Exception" value={diag.exceptionType ?? diag.exception_type} />
        <View style={s.diagDivider} />
        <DiagRow s={s} label="Request ID" value={diag.requestId ?? diag.request_id} />
        <DiagRow s={s} label="Timestamp" value={diag.timestamp} />
        <DiagRow s={s} label="Duration" value={(diag.durationMs ?? diag.duration_ms) ? `${diag.durationMs ?? diag.duration_ms}ms` : undefined} />
        <DiagRow s={s} label="Attempts" value={history.length ? `${history.length} (${history.length - 1} automatic retries)` : undefined} />
        <DiagRow s={s} label="Recovery" value={diag.finalStatus ?? diag.final_status} />
        <DiagRow s={s} label="Case ID" value={caseId ?? diag.caseId ?? diag.case_id} />
        <DiagRow s={s} label="Job ID" value={diag.jobId ?? diag.job_id} />
      </> : <Text style={s.diagValue}>No detailed diagnostics were recorded for this failure.</Text>}
      {history.length ? <>
        <View style={s.diagDivider} />
        <Text style={[s.diagLabel, { minWidth: 0 }]}>Investigation Attempts</Text>
        {history.map((rh, i) => <View key={i} style={s.retryEntry}>
          <Text style={s.retryBadge}>#{String(rh.attempt ?? i + 1)}</Text>
          <Text style={s.retryText}>{kindLabel(String(rh.kind ?? "unknown"))} \u2192 {String(rh.outcome ?? "unknown")}{rh.failureCode ?? rh.failure_code ? ` [${rh.failureCode ?? rh.failure_code}]` : ""}{rh.failureMessage ?? rh.failure_message ? `: ${String(rh.failureMessage ?? rh.failure_message).slice(0, 150)}` : ""}</Text>
        </View>)}
      </> : null}
      <View style={s.copyBtn}>
        <Button testID="inv-diag-copy" variant="ghost" label={copyNote || "Copy Diagnostics"} onPress={() => {
          const text = buildDiagnosticsCopy(failure, caseId);
          void Clipboard.setStringAsync(text).then(() => { setCopyNote("Copied to clipboard"); setTimeout(() => setCopyNote(""), 3000); }).catch(() => setCopyNote("Copy failed"));
        }} />
      </View>
    </View> : null}
  </View>;
}

/** Raw provider response code block with Copy. */
function RawProviderResponse({ failure, s }: { failure: Record<string, unknown> | null | undefined; s: ReturnType<typeof useStyles> }) {
  const { colors } = useTheme();
  const [copyNote, setCopyNote] = useState("");
  const rawJson = useMemo(() => buildRawProviderResponse(failure), [failure]);
  if (!rawJson) return null;
  return <View style={s.rawBlock} testID="inv-raw-response">
    <View style={s.rawHeader}>
      <Text style={s.rawTitle}>Raw provider response</Text>
      <Pressable style={s.rawCopyBtn} onPress={() => { void Clipboard.setStringAsync(rawJson).then(() => { setCopyNote("Copied"); setTimeout(() => setCopyNote(""), 3000); }).catch(() => setCopyNote("Failed")); }} testID="inv-raw-copy">
        <Copy size={14} color={colors.brandPrimary} />
        <Text style={s.rawCopyText}>{copyNote || "Copy"}</Text>
      </Pressable>
    </View>
    <Text style={s.rawCode} selectable>{rawJson}</Text>
  </View>;
}

// ── Main Component ──────────────────────────────────────────────────────────

export function InvestigationView({ state, onAnswer, onRetry, onCancel, onAction, testID = "investigation" }: {
  state: CaseState; onAnswer?: (text: string) => void; onRetry: () => void; onCancel: () => void; onAction?: (action: ActionProposal, outcome: ActionOutcome) => void; testID?: string;
}) {
  const s = useStyles(); const { colors } = useTheme();
  const [activeTab, setActiveTab] = useState<TabId>("overview");
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
    const verdict = o.plan ? ({ correct: "The setting now matches what Apollo asked for.", not_yet_correct: "The setting is not yet at the expected value.", cannot_observe: "Apollo cannot read this setting here \u2014 only you can confirm it.", failed: "The re-check failed." } as const)[o.plan.outcome] : "";
    setActionNote(`Back from Settings \u2014 ${fresh}. ${verdict} ${o.plan?.explanation ?? ""}`.trim());
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
  const showTabs = !!(response || (failure && caseData && !working));

  // ── Categorised evidence items ──
  const originalEvidence = useMemo(() => evidenceItems.filter((e) => e.origin === "user_submission" || e.origin === "device_observation"), [evidenceItems]);
  const derivedEvidence = useMemo(() => evidenceItems.filter((e) => e.origin !== "user_submission" && e.origin !== "device_observation"), [evidenceItems]);

  // ── Status info ──
  const gate = gateInfo(caseData?.gates as Gate[] | undefined);
  const status = statusInfo(phase, response, failure);
  const timeline = useMemo(() => buildTimeline(state), [state]);

  const statusBadgeBg = status.tone === "resting" ? colors.restingTint : status.tone === "barking" ? colors.barkingTint : status.tone === "ears_up" ? colors.ears_upTint : colors.sniffingTint;
  const statusBadgeColor = status.tone === "resting" ? colors.restingText : status.tone === "barking" ? colors.barkingText : status.tone === "ears_up" ? colors.ears_upText : colors.sniffingText;
  const StatusIcon = status.tone === "resting" ? CircleCheck : status.tone === "barking" ? CircleAlert : Info;

  return <View style={{ gap: spacing.md }} testID={testID}>

    {/* ── Conversation history (all turns) ── */}
    {turns.slice(0, -1).map((turn) => <View key={turn.turnId} style={s.turn} testID={`inv-turn-${turn.turnId}`}>
      <View style={s.user}><Text style={s.text}>{turn.question}</Text></View>
      <Text style={s.text}>{scrubMessage(turn.response.overview)}</Text>
    </View>)}
    {turns.length ? <View style={s.user} testID="inv-current-question"><Text style={s.text}>{turns[turns.length - 1].question}</Text></View> : null}

    {/* ── Working / progress state ── */}
    {working ? <Card style={s.card} testID="inv-progress"><View style={s.row}><ActivityIndicator color={colors.gold} /><Body>{phase === "reconnecting" ? "Connection interrupted \u2014 reconnecting to the same investigation\u2026" : phase === "waiting_device" ? "Checking this device for a fresh observation\u2026" : "Magnum DI is investigating\u2026"}</Body></View>
      {progress.slice(-3).map((line, i) => <Text key={`${i}-${line}`} style={s.muted}>{line}</Text>)}
      {caseData?.activeJobId ? <Button testID="inv-cancel" variant="ghost" label="Cancel this investigation" onPress={onCancel} /> : null}</Card> : null}

    {/* ── Retrying state — show Higgins explanation during auto-retry ── */}
    {(phase as string) === "retry_wait" ? <Card style={s.card} testID="inv-retry-progress">
      <View style={s.row}><ActivityIndicator color={colors.gold} /><Body>Investigation continuing</Body></View>
      <View style={s.higginsExplanation}>
        <Text style={s.higginsExplainLabel}>Higgins</Text>
        <Text style={s.higginsExplainText}>{higginsExplanation(failure as unknown as Record<string, unknown> | null, true)}</Text>
      </View>
    </Card> : null}

    {/* ── Status Card + Four-Tab Report ── */}
    {showTabs ? <>
      {/* ── Status Card ── */}
      <View style={s.statusCard} testID="inv-status-card">
        <View style={s.statusRow}>
          <View style={[s.statusIconWrap, { backgroundColor: gate.iconBg }]}>
            <gate.IconComponent size={16} color={gate.iconColor} />
          </View>
          <Text style={s.statusTitle}>{gate.title}</Text>
        </View>
        <View style={{ gap: 4 }}>
          <View style={[s.statusBadge, { backgroundColor: statusBadgeBg }]}>
            <StatusIcon size={12} color={statusBadgeColor} />
            <Text style={[s.statusBadgeText, { color: statusBadgeColor }]}>{status.label}</Text>
          </View>
          <View style={{ flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md }}>
            {caseData ? <Text style={s.statusTimestamp}>{new Date(caseData.createdAt).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}</Text> : null}
            <Text style={s.confidenceText}>Confidence: {response ? assessmentLabel(response.assessment) : "Unavailable"}</Text>
          </View>
        </View>
      </View>

      {/* ── Tab Navigation ── */}
      <TabBar active={activeTab} onChange={setActiveTab} s={s} />

      {/* ━━━━ TAB 1: OVERVIEW — Higgins' Briefing ━━━━ */}
      {activeTab === "overview" ? (
        <Card style={[s.card, { gap: spacing.md }]} testID="inv-tab-overview-content">
          {/* Higgins header */}
          <View style={s.higginsHeader}>
            <View style={s.higginsAvatarWrap}>
              <Image source={higginsAvatar} style={s.higginsAvatarImg} />
            </View>
            <View>
              <Text style={s.higginsName}>Higgins</Text>
              {caseData ? <Text style={s.higginsTime}>{new Date(caseData.updatedAt ?? caseData.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text> : null}
            </View>
          </View>

          {/* Conversational briefing */}
          {response ? (
            <Text style={s.briefingText} testID="inv-overview">{scrubMessage(response.overview)}</Text>
          ) : failure ? (
            <Text style={s.briefingText} testID="inv-overview">{higginsExplanation(failure as unknown as Record<string, unknown>, false)}</Text>
          ) : null}

          {response?.attentionReason ? <>
            <View style={s.divider} />
            <Text style={s.briefingText}>{scrubMessage(response.attentionReason)}</Text>
          </> : null}

          {/* What you can do */}
          <Text style={s.sectionHeader}>What you can do</Text>
          <View style={{ gap: spacing.sm }}>
            {/* Retry investigation — when failed */}
            {(phase === "failed" && caseData) ? (
              <Pressable style={s.actionCard} onPress={onRetry} testID="inv-retry">
                <View style={[s.actionIconWrap, { backgroundColor: "#DBEAFE" }]}><RefreshCw size={20} color={colors.brandPrimary} /></View>
                <View style={s.actionContent}>
                  <Text style={s.actionTitle}>Retry investigation</Text>
                  <Text style={s.actionDescription}>Magnum DI will run the checks again</Text>
                </View>
                <ChevronRight size={18} color={colors.muted} />
              </Pressable>
            ) : null}

            {/* Dynamic actions from Higgins */}
            {response?.actions.map((action) => (
              <Pressable key={action.id} style={s.actionCard} testID={`inv-action-${action.id}`}
                onPress={() => {
                  if (!isExecutable(action)) return;
                  if (action.kind === "open_verified_source") { const src = sources.find((x) => action.sourceIds.includes(x.id)); if (src) void WebBrowser.openBrowserAsync(src.url); onAction?.(action, { kind: "opened_source" }); return; }
                  if (!caseData) return;
                  void runAction(action, caseData).then((outcome) => {
                    setActionNote(outcome.kind === "observed" ? "Apollo took a fresh reading. Ask Higgins to re-check so it folds the new result in."
                      : outcome.kind === "opened" ? `${outcome.descriptor.label} \u2014 opened${outcome.iosPath ? `. In Settings go to: ${outcome.iosPath}` : ""}. When you come back, Apollo checks automatically.`
                      : outcome.kind === "requested" ? "Apollo asked the system for that permission. A fresh check runs when you return."
                      : outcome.kind === "opened_source" ? "Opened the source." : outcome.reason);
                    onAction?.(action, outcome);
                  });
                }}>
                <View style={[s.actionIconWrap, { backgroundColor: "#DBEAFE" }]}><Shield size={20} color={colors.brandPrimary} /></View>
                <View style={s.actionContent}>
                  <Text style={s.actionTitle}>{action.label}</Text>
                  <Text style={s.actionDescription} numberOfLines={2}>{action.instruction}</Text>
                </View>
                {isExecutable(action) ? <ChevronRight size={18} color={colors.muted} /> : null}
              </Pressable>
            )) ?? null}

            {/* Partial findings card — when partial findings available */}
            {failure && response ? (
              <View style={[s.infoCard, { backgroundColor: "#E6F2FF" }]} testID="inv-partial-findings">
                <View style={[s.infoIconWrap, { backgroundColor: colors.info }]}><Info size={16} color="#FFFFFF" /></View>
                <View style={s.infoContent}>
                  <Text style={s.infoTitle}>Partial findings available</Text>
                  <Text style={s.infoBody}>Some initial checks were completed. View Evidence tab for details.</Text>
                </View>
              </View>
            ) : null}
          </View>

          {actionNote ? <Text style={s.muted} testID="inv-action-note">{actionNote}</Text> : null}
          {confirmablePlanId && caseData ? <Button testID="inv-settings-user-confirm" variant="ghost" label="I checked this setting myself" onPress={() => {
            void investigationApi.confirmSettingsPlan(caseData.id, confirmablePlanId, true).then((result) => {
              setConfirmablePlanId(null); setActionNote(result.explanation);
            }).catch(() => setActionNote("Apollo could not record your confirmation. Try again."));
          }} /> : null}
          {failedRecheck ? <Button testID="inv-recheck-retry" variant="ghost" label="Retry the fresh check" onPress={() => { setFailedRecheck(false); void retryFailedAttempt(); }} /> : null}
        </Card>
      ) : null}

      {/* ━━━━ TAB 2: PROBE — Magnum DI Investigation ━━━━ */}
      {activeTab === "probe" ? (
        <Card style={[s.card, { gap: spacing.md }]} testID="inv-tab-probe-content">
          {response ? <>
            <Text style={s.sectionTitle}>INVESTIGATION REPORT</Text>

            {/* Status pills */}
            <View style={s.row}>
              <Pill tone={attentionTone(response.attention)} label={attentionLabel(response.attention)} testID="inv-attention" />
              <Pill tone="neutral" label={response.completion === "complete" ? "Complete within scope" : response.completion === "partial" ? "Partial \u2014 more to examine" : "Question pending"} testID="inv-completion" />
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
                        <Text style={[s.link, { fontSize: 12 }]}>Evidence \u00B7 {displayLabel}</Text>
                      </Pressable>;
                    })}
                  </View>
                ) : null}
              </View>)}
            </> : null}

            {/* Uncertainties */}
            {response.uncertainties.length ? <>
              <Text style={s.sectionTitle}>LIMITATIONS</Text>
              {response.uncertainties.map((u, i) => <Text key={i} style={s.muted}>\u2022 {scrubMessage(u)}</Text>)}
            </> : null}

            {/* Scope and evidence inventory */}
            {response.scope ? <>
              <Text style={s.sectionTitle}>SCOPE</Text>
              <Text style={s.muted}>{scrubMessage(response.scope)}</Text>
            </> : null}
            {inventory ? <Text style={s.muted} testID="inv-coverage">Evidence: {inventory.examined} of {inventory.total} items fully examined{inventory.partial ? `, ${inventory.partial} partially` : ""}{inventory.unavailable ? `, ${inventory.unavailable} unavailable` : ""}{response.remainingEvidenceIds.length ? ` \u2014 ${response.remainingEvidenceIds.length} still to examine` : ""}.</Text> : null}

            {/* Sources */}
            {usedSources.length ? <>
              <Text style={s.sectionTitle}>SOURCES ({usedSources.length})</Text>
              {usedSources.map((src) => <SourceRow key={src.id} source={src} s={s} />)}
            </> : <Text style={s.muted}>No external sources were retrieved for this investigation.</Text>}

            {/* Report controls */}
            {caseData ? <View style={{ gap: spacing.xs, marginTop: spacing.sm }} testID="inv-report-controls">
              <Button testID="inv-export-pdf" variant="secondary" disabled={pdfExporting}
                label={pdfExporting ? "Generating PDF\u2026" : "Export Report as PDF"}
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
                <Text style={s.text}>{scrubMessage(report.overview)}</Text><Text style={s.muted}>Saved {new Date(report.savedAt).toLocaleDateString()} \u00B7 historical snapshot</Text>
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
          </> : <>
            {/* Failed — no response */}
            <View style={[s.infoCard, { backgroundColor: colors.barkingTint }]} testID="inv-probe-incomplete">
              <View style={[s.infoIconWrap, { backgroundColor: colors.barking }]}><CircleAlert size={16} color="#FFFFFF" /></View>
              <View style={s.infoContent}>
                <Text style={[s.infoTitle, { color: colors.barkingText }]}>Investigation incomplete</Text>
                <Text style={s.infoBody}>Magnum DI couldn&apos;t complete the investigation. Check the Evidence tab for technical details.</Text>
              </View>
            </View>
          </>}
        </Card>
      ) : null}

      {/* ━━━━ TAB 3: EVIDENCE — Consolidated Evidence & Diagnostics ━━━━ */}
      {activeTab === "evidence" ? (
        <View style={{ gap: spacing.md }} testID="inv-tab-evidence-content">
          {/* Investigation evidence card */}
          {caseData && evidenceItems.length > 0 ? (
            <Pressable style={s.actionCard} onPress={() => { setFocusEvidenceId(null); setEvidencePopupVisible(true); }} testID="inv-evidence-viewer">
              <View style={[s.actionIconWrap, { backgroundColor: "#DBEAFE" }]}><FileText size={20} color="#1E3A5F" /></View>
              <View style={s.actionContent}>
                <Text style={[s.actionTitle, { color: colors.onSurface }]}>Investigation evidence</Text>
                <Text style={s.actionDescription}>View all available findings, sources and provenance.</Text>
              </View>
              <ChevronRight size={18} color={colors.muted} />
            </Pressable>
          ) : null}

          {/* Original evidence items */}
          {originalEvidence.length ? <>
            <Card style={[s.card, { gap: spacing.sm }]}>
              <Text style={s.sectionTitle}>ORIGINAL MATERIAL</Text>
              {originalEvidence.map((ev) => (
                <Pressable key={ev.id} style={s.evidenceCard} onPress={() => { setFocusEvidenceId(ev.id); setEvidencePopupVisible(true); }} testID={`inv-evidence-original-${ev.id}`}>
                  <Text style={s.evidenceLabel}>{ev.origin === "user_submission" ? "Submitted" : "Observed"} \u00B7 {ev.kind}</Text>
                  <Text style={s.text}>{ev.displayId || ev.id.slice(0, 8)}</Text>
                  {ev.label ? <Text style={s.muted}>{scrubMessage(ev.label)}</Text> : null}
                  {ev.collectedAt ? <Text style={s.muted}>Captured: {new Date(ev.collectedAt).toLocaleString()}</Text> : null}
                </Pressable>
              ))}
            </Card>
          </> : null}

          {derivedEvidence.length ? <>
            <Card style={[s.card, { gap: spacing.sm }]}>
              <Text style={s.sectionTitle}>ANALYSIS & EXTRACTED CONTENT</Text>
              <Text style={s.muted}>The following items were produced during the investigation \u2014 they are not original submissions.</Text>
              {derivedEvidence.map((ev) => (
                <Pressable key={ev.id} style={s.evidenceCard} onPress={() => { setFocusEvidenceId(ev.id); setEvidencePopupVisible(true); }} testID={`inv-evidence-derived-${ev.id}`}>
                  <Text style={s.evidenceLabel}>{ev.origin || "Derived"} \u00B7 {ev.kind}</Text>
                  <Text style={s.text}>{ev.displayId || ev.id.slice(0, 8)}</Text>
                  {ev.label ? <Text style={s.muted}>{scrubMessage(ev.label)}</Text> : null}
                </Pressable>
              ))}
            </Card>
          </> : null}

          {!originalEvidence.length && !derivedEvidence.length && !failure ? <Card style={s.card}><Text style={s.muted}>No evidence items are available for this investigation.</Text></Card> : null}

          {/* Investigation incomplete alert */}
          {failure ? (
            <Card style={[s.card, { gap: spacing.sm }]}>
              <View style={[s.infoCard, { backgroundColor: colors.barkingTint, padding: spacing.md }]}>
                <View style={[s.infoIconWrap, { backgroundColor: colors.barking }]}><CircleAlert size={16} color="#FFFFFF" /></View>
                <View style={s.infoContent}>
                  <Text style={[s.infoTitle, { color: colors.barkingText }]}>Investigation incomplete</Text>
                  <Text style={s.infoBody}>Magnum DI couldn&apos;t complete all checks.</Text>
                </View>
              </View>

              {/* Technical error details */}
              <TechnicalErrorDetails failure={failure as unknown as Record<string, unknown>} caseId={caseData?.id} s={s} />

              {/* Raw provider response */}
              <RawProviderResponse failure={failure as unknown as Record<string, unknown>} s={s} />

              {/* Sensitive information warning */}
              <View style={s.sensitiveRow}>
                <Info size={14} color={colors.brandPrimary} />
                <Text style={s.sensitiveText}>Sensitive information such as API keys and user content has been redacted.</Text>
              </View>
            </Card>
          ) : null}

          {/* Link to History tab */}
          <Pressable style={s.actionCard} onPress={() => setActiveTab("history")} testID="inv-evidence-history-link">
            <View style={[s.actionIconWrap, { backgroundColor: "#DBEAFE" }]}><Clock size={20} color="#1E3A5F" /></View>
            <View style={s.actionContent}>
              <Text style={[s.actionTitle, { color: colors.onSurface }]}>Investigation history</Text>
              <Text style={s.actionDescription}>See the full timeline, attempts and events.</Text>
            </View>
            <ChevronRight size={18} color={colors.muted} />
          </Pressable>
        </View>
      ) : null}

      {/* ━━━━ TAB 4: HISTORY — Investigation Timeline ━━━━ */}
      {activeTab === "history" ? (
        <View style={{ gap: spacing.md }} testID="inv-tab-history-content">

          {/* Timeline */}
          <Card style={[s.card, { gap: spacing.md }]} testID="inv-history-timeline">
            {timeline.map((entry, i) => {
              const isLast = i === timeline.length - 1;
              const dotBg = timelineDotColor(entry.iconType);
              const IconEl = entry.iconType === "create" ? Search : entry.iconType === "complete" ? CircleCheck : entry.iconType === "failed" ? CircleAlert : entry.iconType === "retry" ? RefreshCw : entry.iconType === "question" ? MessageSquare : Clock;
              return (
                <View key={i} style={s.timelineItem} testID={`inv-history-${i}`}>
                  <View style={s.timelineTrack}>
                    <View style={[s.timelineDot, { backgroundColor: dotBg }]}><IconEl size={16} color="#FFFFFF" /></View>
                    {!isLast ? <View style={[s.timelineLine, { backgroundColor: colors.divider }]} /> : null}
                  </View>
                  <View style={isLast ? s.timelineContentLast : s.timelineContent}>
                    <View style={s.timelineRow}>
                      <Text style={s.timelineTitle}>{entry.title}</Text>
                      {entry.at ? <Text style={s.timelineTime}>{new Date(entry.at).toLocaleString([], { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })}</Text> : null}
                    </View>
                    <Text style={s.timelineBody}>{entry.body}</Text>
                  </View>
                </View>
              );
            })}
          </Card>

          {/* Investigation history from domain (phase-based) */}
          {response ? <Card style={[s.card, { gap: spacing.xs }]}>
            <Text style={s.sectionTitle}>INVESTIGATION PROGRESS</Text>
            {investigationHistory({ turns: turns.map((t) => ({ question: t.question, overview: t.response.overview })), phase, completion: response.completion }).map((h, i) => <Text key={i} style={s.muted} testID={`inv-progress-history-${i}`}>{"\u2022"} {h.text}</Text>)}
          </Card> : null}
        </View>
      ) : null}
    </> : null}

    {/* ── Question from Higgins (outside tabs — transient) ── */}
    {question && phase === "waiting_user" ? <View style={s.question} testID="inv-question"><Text style={s.text}>{scrubMessage(question.text)}</Text><Text style={s.muted}>Why Magnum DI asks: {scrubMessage(question.reasonNeeded)}</Text>
      {question.answerType === "yes_no" ? <View style={s.row}><Button testID="inv-answer-yes" label="Yes" onPress={() => onAnswer?.("Yes")} /><Button testID="inv-answer-no" variant="ghost" label="No" onPress={() => onAnswer?.("No")} /></View> : null}
      {question.answerType === "choice" ? <View style={s.row}>{question.choices.map((c) => <Button key={c} testID={`inv-answer-${c}`} variant="ghost" label={c} onPress={() => onAnswer?.(c)} />)}</View> : null}</View> : null}

    {/* ── Lifecycle notice ── */}
    {state.notice ? <Card style={s.card} testID="inv-lifecycle-notice"><Body>{state.notice}</Body></Card> : null}

    {/* ── Error without tabs (edge case: failed before case created) ── */}
    {error && !showTabs && (phase === "failed" || phase === "expired") ? <Card style={s.card} testID="inv-error">
      <View style={s.higginsExplanation}>
        <Text style={s.higginsExplainLabel}>Higgins</Text>
        <Text style={s.higginsExplainText}>{higginsExplanation(failure as unknown as Record<string, unknown> | null, false)}</Text>
      </View>
      <TechnicalErrorDetails failure={failure as unknown as Record<string, unknown> | null} caseId={caseData?.id} s={s} />
      {phase === "failed" && caseData ? <Button testID="inv-retry" label="Retry investigation" onPress={onRetry} /> : null}
    </Card> : null}

    {/* ── Partial failure indicator (outside tabs) ── */}
    {failure && phase !== "failed" && !showTabs ? <Text style={s.muted} testID="inv-partial-reason">Incomplete: {failure.message}</Text> : null}

    {/* ── Evidence popup (shared across all tabs) ── */}
    {caseData ? <EvidencePopup visible={evidencePopupVisible} onClose={() => setEvidencePopupVisible(false)}
      caseId={caseData.id} focusEvidenceId={focusEvidenceId} items={evidenceItems} /> : null}
  </View>;
}
