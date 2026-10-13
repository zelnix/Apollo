// Check Email — Phase 1 redesign.
// Matches the approved mockup exactly: paste area, side-by-side buttons,
// privacy card, rich recent checks with mail icons.
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import Check from "lucide-react-native/icons/check";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Clock from "lucide-react-native/icons/clock";
import Image from "lucide-react-native/icons/image";
import Inbox from "lucide-react-native/icons/inbox";
import Mail from "lucide-react-native/icons/mail";
import Plus from "lucide-react-native/icons/plus";
import Search from "lucide-react-native/icons/search";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import Trash from "lucide-react-native/icons/trash";
import User from "lucide-react-native/icons/user";
import X from "lucide-react-native/icons/x";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiDelete, apiGet, apiPost } from "@/src/api/client";
import { CheckResultScreen } from "@/src/components/CheckResultScreen";
import { RecoveryFlow } from "@/src/components/RecoveryFlow";
import { Sheet } from "@/src/components/Sheet";
import { Body, Button } from "@/src/components/ui";
import { analyseEmail, type EmailAnalysis } from "@/src/domain/emailAnalysis";
import { evaluateLinkGuardFindings, extractAnchorsFromPlainText } from "@/src/domain/linkGuard";
import { type PatrolEvent } from "@/src/domain/types";
import { STATE_RANK } from "@/src/domain/stateMachine";
import { patrolSafeSummary, type InvestigationResult } from "@/src/domain/investigation";
import { redactUserSecrets } from "@/src/domain/privacy";
import { connectGmailOAuth } from "@/src/domain/gmailConnect";
import { buildEmailCheckResult } from "@/src/domain/emailCheckResultAdapter";
import { contextFromEvent, gateForCategory } from "@/src/domain/higginsHandoff";
import { runProtectionHealthCheck } from "@/src/protection/healthCoordinator";
import { type MessageExplanation, type MessageUrlResult, useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";
import { InfoButton } from "@/src/components/InfoButton";
import { getShareIntake } from "@/src/share/shareIntake";
import { recordCheck } from "@/src/store/checkHistoryStore";
import {
  listEmailAccounts,
  addEmailAccount,
  removeEmailAccount,
  providerLabel,
  type EmailAccount,
} from "@/src/store/emailAccountStore";
import {
  listEmailChecks,
  recordEmailCheck,
  type EmailCheckEntry,
} from "@/src/store/emailCheckHistoryStore";

// ── Constants ──────────────────────────────────────────────────────────────────
const GMAIL_STATUS_UI_TIMEOUT_MS = 8000;

function statusLabel(state: string): string {
  switch (state) {
    case "resting": return "No concern found";
    case "ears_up": return "Worth reviewing";
    case "growling": return "Potential concern";
    case "barking": case "biting": return "Action required";
    case "sniffing": return "Checking";
    default: return "Unable to determine";
  }
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    });
  } catch { return ""; }
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },

  // Header
  header: {
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  mailIconWell: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#DBEAFE",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTextWrap: { flex: 1 },
  headerTitle: { fontFamily: fonts.displayBold, fontSize: 24, color: c.onSurface },
  headerSub: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary, marginTop: 2 },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },

  // Scroll
  scrollContent: { paddingHorizontal: spacing.lg, gap: spacing.lg },

  // Paste area (dashed border zone)
  pasteArea: {
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: "#B0C4DE",
    borderRadius: radius.lg,
    backgroundColor: "#F0F5FA",
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.lg,
  },
  pasteIconWell: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: "#DBEAFE",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  pasteTextWrap: { flex: 1, gap: 4 },
  pasteTitle: { fontFamily: fonts.displayBold, fontSize: 16, color: c.onSurface },
  pasteSub: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary },

  // Editing card (when paste area tapped)
  editCard: {
    borderWidth: 1.5,
    borderColor: "#B0C4DE",
    borderRadius: radius.lg,
    backgroundColor: "#F0F5FA",
    padding: spacing.lg,
    gap: spacing.md,
  },
  editLabel: { fontFamily: fonts.textSemibold, fontSize: 12, letterSpacing: 1, color: c.muted, textTransform: "uppercase" },
  editField: {
    minHeight: 44,
    backgroundColor: c.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    fontFamily: fonts.text,
    fontSize: 15,
    color: c.onSurface,
  },
  editBody: { minHeight: 140, textAlignVertical: "top" as const },

  // Button row
  buttonRow: { flexDirection: "row", gap: spacing.md },
  checkBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.brandPrimary,
    borderRadius: radius.lg,
    paddingVertical: 16,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
    minHeight: 56,
  },
  checkBtnDisabled: { opacity: 0.5 },
  checkBtnText: { fontFamily: fonts.displayBold, fontSize: 16, color: c.onBrandPrimary },
  screenshotBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: c.onSurface,
    paddingVertical: 16,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    minHeight: 56,
  },
  screenshotBtnText: { fontFamily: fonts.displayBold, fontSize: 16, color: c.onSurface },

  // Privacy card
  privacyCard: {
    flexDirection: "row",
    backgroundColor: "#F0F5FA",
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
    alignItems: "flex-start",
  },
  privacyIconWell: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#D6E5FC",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  privacyText: { flex: 1, fontFamily: fonts.text, fontSize: 14, lineHeight: 22, color: c.onSurfaceSecondary },

  // Recent checks section
  recentSection: {
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: c.border,
    overflow: "hidden",
  },
  recentHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  recentHeaderLeft: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  recentTitle: { fontFamily: fonts.displayBold, fontSize: 14, letterSpacing: 0.8, color: c.onSurface, textTransform: "uppercase" },
  seeAll: { flexDirection: "row", alignItems: "center", gap: 4 },
  seeAllText: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.brand },

  // Recent check row
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  recentMailIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#DBEAFE",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  recentInfo: { flex: 1, gap: 2 },
  recentSubject: { fontFamily: fonts.displayBold, fontSize: 15, color: c.onSurface },
  recentSender: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceSecondary },
  recentDate: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  recentStatusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#E8F5E9",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    flexShrink: 0,
  },
  recentStatusDot: { width: 8, height: 8, borderRadius: 4 },
  recentStatusText: { fontFamily: fonts.textSemibold, fontSize: 12, color: "#2E7D32" },
  recentEmpty: { padding: spacing.xl, alignItems: "center", gap: spacing.sm },

  // Account selector (inside recent checks / manage)
  accountSelector: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: c.surfaceSecondary,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: c.border,
    gap: spacing.sm,
  },
  accountLeft: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 },
  accountText: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface, flex: 1 },
  accountManage: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.brand },
  accountDivider: { width: 1, height: 20, backgroundColor: c.border, marginHorizontal: spacing.xs },

  // Sheet rows
  sheetRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  sheetIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  sheetInfo: { flex: 1, gap: 2 },
  sheetEmail: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  sheetProvider: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  sheetCheck: { width: 24, height: 24, borderRadius: 12, backgroundColor: c.brand, alignItems: "center", justifyContent: "center" },
  addInput: { minHeight: 48, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },

  // Inbox picker (preserved)
  pickerOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  pickerSheet: { backgroundColor: c.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, maxHeight: "85%" },
  pickerHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: c.borderStrong, alignSelf: "center", marginTop: spacing.md },
  pickerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  pickerTitle: { fontFamily: fonts.displayBold, fontSize: 20, color: c.onSurface },
  pickerAccountTabs: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, gap: spacing.sm },
  pickerTab: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, minHeight: 40, alignItems: "center", justifyContent: "center" },
  pickerTabText: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.onSurfaceSecondary },
  pickerCenter: { alignItems: "center", justifyContent: "center", paddingVertical: spacing["2xl"], gap: spacing.sm },
  pickerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: c.border },
  pickerIconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  pickerMsgContent: { flex: 1, gap: 2 },
  pickerSender: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface },
  pickerSubject: { fontFamily: fonts.text, fontSize: 14, color: c.onSurface },
  pickerSnippet: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.muted },
  pickerAccountLabel: { fontFamily: fonts.text, fontSize: 11, color: c.muted, marginTop: 2 },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
}));

// ── Component ──────────────────────────────────────────────────────────────────
export default function CheckEmail() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ text?: string; sharedIntakeId?: string }>();
  const shared = getShareIntake(params.sharedIntakeId);
  const { ready, setupDone, upsertEvent, deviceId, adapterLabel, showToast, scanGmailInbox } = useApollo();

  // ── Input state ──
  const [editing, setEditing] = useState(false);
  const [from, setFrom] = useState("");
  const [subject, setSubject] = useState("");
  const [raw, setRaw] = useState(shared?.text || shared?.webUrl || params.text || "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    submissionId: string;
    a: EmailAnalysis;
    event: PatrolEvent | null;
    urls: MessageUrlResult[];
    explanation: MessageExplanation | null;
    assessment: InvestigationResult | null;
  } | null>(null);
  const [verify, setVerify] = useState(false);

  // ── Account state ──
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [accountSheetOpen, setAccountSheetOpen] = useState(false);
  const [manageSheetOpen, setManageSheetOpen] = useState(false);
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [newAccountEmail, setNewAccountEmail] = useState("");

  // ── Recent checks ──
  const [recentChecks, setRecentChecks] = useState<EmailCheckEntry[]>([]);

  // ── Gmail state (preserved) ──
  const [gmailConnected, setGmailConnected] = useState<boolean | null>(null);
  const [gmailConfigured, setGmailConfigured] = useState(true);
  const [gmailMonitoring, setGmailMonitoring] = useState(false);
  const [gmailAccounts, setGmailAccounts] = useState<{
    email: string;
    monitoring_enabled?: boolean;
    monitor_state?: string;
    monitor_last_success_at?: string | null;
  }[]>([]);
  const [gmailBusy, setGmailBusy] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);

  // ── Inbox picker state (preserved) ──
  type InboxPreview = { id: string; account: string; from: string; subject: string; date: string; snippet: string };
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerMessages, setPickerMessages] = useState<InboxPreview[]>([]);
  const [pickerAccount, setPickerAccount] = useState<string | null>(null);
  const [pickerFetchBusy, setPickerFetchBusy] = useState<string | null>(null);

  // Auto-open editing if shared content arrives
  useEffect(() => {
    if (raw.trim()) setEditing(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Derived ──
  const allAccounts = useMemo((): EmailAccount[] => {
    const manual = accounts;
    const gmailMapped: EmailAccount[] = gmailAccounts
      .filter((ga) => !manual.some((m) => m.email.toLowerCase() === ga.email.toLowerCase()))
      .map((ga) => ({
        id: `gmail-${ga.email}`,
        email: ga.email,
        provider: "gmail" as const,
        connected: true,
        addedAt: "",
      }));
    return [...manual, ...gmailMapped];
  }, [accounts, gmailAccounts]);

  const filteredRecentChecks = useMemo(() => {
    if (!selectedAccount) return recentChecks;
    return recentChecks.filter((c) => c.account?.toLowerCase() === selectedAccount.toLowerCase());
  }, [recentChecks, selectedAccount]);

  const filteredPickerMessages = pickerAccount
    ? pickerMessages.filter((m) => m.account === pickerAccount)
    : pickerMessages;
  const uniquePickerAccounts = [...new Set(pickerMessages.map((m) => m.account).filter(Boolean))];

  // ── Data loading ──
  const refreshAccounts = useCallback(async () => {
    const accts = await listEmailAccounts();
    setAccounts(accts);
  }, []);

  const refreshRecentChecks = useCallback(async () => {
    const checks = await listEmailChecks();
    setRecentChecks(checks);
  }, []);

  useEffect(() => { void refreshAccounts(); void refreshRecentChecks(); }, [refreshAccounts, refreshRecentChecks]);

  // ── Gmail status (preserved) ──
  const refreshGmailStatus = useCallback(async () => {
    if (!deviceId) return;
    setGmailConnected(null);
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Gmail status took too long.")), GMAIL_STATUS_UI_TIMEOUT_MS);
      });
      const response = await Promise.race([
        apiGet<{
          connected: boolean;
          configured: boolean;
          monitoring_enabled: boolean;
          accounts?: { email: string; monitoring_enabled: boolean; monitor_state?: string; monitor_last_success_at?: string | null }[];
        }>(`/gmail/status?device_id=${deviceId}`),
        timeout,
      ]);
      setGmailConnected(response.connected);
      setGmailConfigured(response.configured);
      setGmailMonitoring(response.monitoring_enabled);
      setGmailAccounts(response.accounts ?? []);
      if (response.accounts) {
        for (const ga of response.accounts) void addEmailAccount(ga.email, true);
        void refreshAccounts();
      }
    } catch {
      setGmailConnected(false);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }, [deviceId, refreshAccounts]);

  useEffect(() => { void refreshGmailStatus(); }, [refreshGmailStatus]);

  // ── Gmail handlers (preserved) ──
  const connectGmail = async () => {
    if (!deviceId) return;
    setGmailBusy(true);
    try {
      const res = await connectGmailOAuth(deviceId);
      if (res === "connected") {
        await refreshGmailStatus();
        void runProtectionHealthCheck("protection_change");
        showToast("Gmail account connected \u2014 read-only.", "resting");
      } else if (res === "denied") showToast("Gmail connection was cancelled.", "neutral");
      else if (res === "error") showToast("Couldn\u2019t connect Gmail right now.", "growling");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn\u2019t connect Gmail right now.", "growling");
    } finally { setGmailBusy(false); }
  };

  const disconnectGmail = async (email?: string) => {
    if (!deviceId) return;
    const qs = email ? `?device_id=${deviceId}&email=${encodeURIComponent(email)}` : `?device_id=${deviceId}`;
    try { await apiDelete(`/gmail/connection${qs}`); } catch { /* already gone */ }
    void runProtectionHealthCheck("protection_change");
    showToast(email ? `${email} disconnected.` : "Gmail disconnected.", "neutral");
    await refreshGmailStatus();
    void refreshAccounts();
  };

  const toggleGmailMonitoring = async () => {
    if (!deviceId) return;
    const enabled = !gmailMonitoring;
    await apiPost("/gmail/monitoring", "gmail_monitor", { device_id: deviceId, enabled });
    setGmailMonitoring(enabled);
    void runProtectionHealthCheck("protection_change");
    showToast(enabled ? "Ongoing Gmail assessment enabled." : "Ongoing Gmail assessment stopped.", enabled ? "resting" : "neutral");
  };

  const scanInbox = async () => {
    setScanBusy(true);
    try {
      const result = await scanGmailInbox();
      const accepted = result.accepted;
      void runProtectionHealthCheck("protection_change");
      showToast(accepted ? `${accepted} email${accepted === 1 ? "" : "s"} accepted for investigation` : "No new Gmail messages needed investigation", "neutral");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn\u2019t scan your inbox right now.", "growling");
    } finally { setScanBusy(false); }
  };

  // ── Inbox picker (preserved) ──
  const openInboxPicker = useCallback(async () => {
    if (!deviceId) return;
    setPickerVisible(true);
    setPickerLoading(true);
    setPickerMessages([]);
    try {
      const data = await apiGet<{ messages: InboxPreview[]; next_page_token?: string }>(`/gmail/messages?device_id=${deviceId}&limit=30`);
      setPickerMessages(data.messages ?? []);
    } catch {
      showToast("Couldn\u2019t load inbox messages.", "growling");
    } finally { setPickerLoading(false); }
  }, [deviceId, showToast]);

  const selectInboxEmail = useCallback(async (msg: InboxPreview) => {
    if (!deviceId) return;
    setPickerFetchBusy(msg.id);
    try {
      const detail = await apiGet<{ id: string; account: string; from: string; subject: string; date: string; body: string }>(
        `/gmail/message/${msg.id}?device_id=${deviceId}${msg.account ? `&email=${encodeURIComponent(msg.account)}` : ""}`
      );
      setFrom(detail.from || msg.from);
      setSubject(detail.subject || msg.subject);
      setRaw(detail.body || msg.snippet);
      setEditing(true);
      setPickerVisible(false);
      showToast("Email loaded \u2014 tap Check email to analyse.", "neutral");
    } catch {
      showToast("Couldn\u2019t fetch that email.", "growling");
    } finally { setPickerFetchBusy(null); }
  }, [deviceId, showToast]);

  // ── Account management ──
  const handleAddAccount = async () => {
    const email = newAccountEmail.trim();
    if (!email || !email.includes("@") || !email.includes(".")) {
      showToast("Enter a valid email address.", "neutral");
      return;
    }
    await addEmailAccount(email, false);
    setNewAccountEmail("");
    await refreshAccounts();
    showToast(`${email} added.`, "neutral");
  };

  const handleRemoveAccount = async (acct: EmailAccount) => {
    if (acct.connected && acct.provider === "gmail") {
      await disconnectGmail(acct.email);
    } else {
      await removeEmailAccount(acct.id);
      await refreshAccounts();
      showToast(`${acct.email} removed.`, "neutral");
    }
    if (selectedAccount?.toLowerCase() === acct.email.toLowerCase()) setSelectedAccount(null);
  };

  // ── Email check (core logic preserved) ──
  const run = async () => {
    setBusy(true);
    try {
      const safeRaw = redactUserSecrets(raw);
      const safeSubject = redactUserSecrets(subject);
      if (safeRaw !== raw) setRaw(safeRaw);
      if (safeSubject !== subject) setSubject(safeSubject);
      let a = analyseEmail(safeRaw, { from, subject: safeSubject });
      let urls: MessageUrlResult[] = [];
      let explanation: MessageExplanation | null = null;
      let assessment: InvestigationResult | null = null;
      try {
        const r = await apiPost<{
          urls: MessageUrlResult[];
          explanation: MessageExplanation | null;
          assessment: InvestigationResult;
        }>("/message/analyse", "message_check", {
          device_id: deviceId ?? "local-device",
          sender: from.trim(),
          text: `${safeSubject}\n${safeRaw}`,
          urls: a.urls,
          local_state: a.state,
          scenario: a.scenario,
          signals: a.signalLabels.slice(0, 20),
          claimed_brand: a.claimedBrand,
          second_opinion: false,
        });
        urls = r.urls;
        explanation = r.explanation;
        assessment = r.assessment;
        if (assessment.risk === "warning" && a.state === "resting")
          a = { ...a, state: "growling", why: [...a.why, "The contextual investigation found unresolved or suspicious details that need verification."] };
        const guard = evaluateLinkGuardFindings(urls, extractAnchorsFromPlainText(safeRaw));
        if (STATE_RANK[guard.state] > STATE_RANK[a.state])
          a = { ...a, state: guard.state, why: [...a.why, ...guard.why] };
        else if (guard.why.length) a = { ...a, why: [...a.why, ...guard.why] };
      } catch { /* offline: on-device result stands */ }
      let event: PatrolEvent | null = null;
      if (a.state !== "resting") {
        event = await upsertEvent({
          event_id: Math.random().toString(36).slice(2) + Date.now().toString(36),
          device_id: deviceId ?? "local",
          category: "email",
          state: a.state,
          status: "active",
          headline: `Email: ${assessment?.higgins.headline ?? a.title}`,
          what_happened: patrolSafeSummary(assessment?.higgins.what_was_found[0] ?? a.verdict),
          why: assessment?.findings.map((f) => f.title).slice(0, 6) ?? a.why,
          what_to_do: assessment?.higgins.next_action ?? a.recommendation,
          indicator_host: a.lookalikeUrls[0] ? a.lookalikeUrls[0].replace(/^https?:\/\//i, "").split("/")[0] : a.senderDomain,
          indicator_digest: null,
          local_indicator: null,
          verified_block: false,
          adapter_label: adapterLabel,
          occurred_at: new Date().toISOString(),
          resolved_at: null,
          trust_allowed: false,
          claimed_brand: a.claimedBrand,
          scenario: a.scenario,
          supporting_references: assessment?.sources
            .filter((source) => source.url)
            .map((source) => ({ label: source.label, url: source.url! }))
            .slice(0, 6),
        });
        if (event.state !== a.state) a = { ...a, state: event.state, why: event.why };
      }
      const submissionId = event?.event_id ?? Crypto.randomUUID();
      setResult({ submissionId, a, event, urls, explanation, assessment });
      void recordEmailCheck({
        id: submissionId,
        at: new Date().toISOString(),
        state: a.state,
        summary: assessment?.higgins?.headline ?? a.title,
        subject: safeSubject.trim() || a.parsed.subject || undefined,
        sender: from.trim() || a.parsed.fromAddress || undefined,
        account: selectedAccount || undefined,
        eventId: event?.event_id || undefined,
        scenario: a.scenario,
      });
      void recordCheck("email", { at: new Date().toISOString(), state: a.state, summary: assessment?.higgins?.headline ?? a.title });
      void refreshRecentChecks();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn\u2019t read that email.", "barking");
    } finally { setBusy(false); }
  };

  // ── Navigation ──
  const openRecentCheck = (check: EmailCheckEntry) => {
    if (check.eventId) router.push("/(tabs)/patrol");
  };

  // ── Guards ──
  if (ready && !setupDone) return <Redirect href="/" />;
  const a = result?.a;
  const scent = result?.event?.scent_id ?? result?.event?.event_id ?? "";

  // ════════════════════════════════════════════════════════════════════════════
  // RESULT VIEW
  // ════════════════════════════════════════════════════════════════════════════
  if (result && a) {
    const model = buildEmailCheckResult({
      analysis: a,
      event: result.event,
      from,
      subject,
      submissionId: result.submissionId,
      urlResults: result.urls,
      explanation: result.explanation,
    });
    const askPrompt = `About the email I just checked (from ${model.subject}). ${model.headline} Can you walk me through what Apollo found and what I should do?`;
    const emailActions: { label: string; onPress: () => void; testID: string; variant?: "primary" | "secondary" | "ghost" }[] = [];
    if (a.handoff.account) {
      emailActions.push({
        testID: "email-check-account",
        variant: "secondary",
        label: "It\u2019s about my account \u2014 check account alert",
        onPress: () =>
          router.push({ pathname: "/account", params: { text: `${a.parsed.subject ?? ""}\n${a.parsed.body}`.trim().slice(0, 3000), scent } }),
      });
    }
    emailActions.push({
      testID: "email-verify-sender",
      variant: "secondary",
      label: "Show me how to check the sender",
      onPress: () => setVerify(true),
    });
    a.urls.forEach((u, i) => {
      const r = result.urls.find((x) => x.url === u || x.host === u.replace(/^https?:\/\//i, "").split("/")[0]);
      const off = a.lookalikeUrls.includes(u);
      const label =
        r?.verdict === "malicious"
          ? `\u26a0 ${u.length > 35 ? u.slice(0, 35) + "\u2026" : u}`
          : off
            ? `Off-domain: ${u.length > 30 ? u.slice(0, 30) + "\u2026" : u}`
            : `Check: ${u.length > 35 ? u.slice(0, 35) + "\u2026" : u}`;
      emailActions.push({
        testID: `email-check-link-${i}`,
        variant: r?.verdict === "malicious" || off ? "secondary" : "ghost",
        label,
        onPress: () =>
          router.push({ pathname: "/check", params: { url: u.startsWith("http") ? u : `https://${u}`, source: "email" } }),
      });
    });
    if (a.handoff.file) {
      emailActions.push({ testID: "email-check-file", variant: "secondary", label: "Check the attachment with Apollo", onPress: () => router.push({ pathname: "/file", params: { source: "email" } }) });
      emailActions.push({ testID: "email-attachment-limitation", variant: "ghost", label: "Note: the file itself was not transferred \u2014 only metadata is checked here", onPress: () => {} });
    }
    emailActions.push({
      testID: "email-again",
      variant: "ghost",
      label: "Check another email",
      onPress: () => {
        setResult(null);
        setRaw("");
        setFrom("");
        setSubject("");
        setEditing(false);
        void refreshRecentChecks();
      },
    });

    return (
      <>
        <CheckResultScreen
          result={model}
          investigationContext={result.event ? contextFromEvent(result.event, gateForCategory(result.event.category)) : undefined}
          investigationQuestion={askPrompt}
          submissionId={result.event?.event_id ?? `email-${Date.now().toString(36)}`}
          eventId={result.event?.event_id ?? null}
          actions={emailActions}
        />
        {result.event ? (
          <RecoveryFlow
            event={result.event}
            kinds={["clicked", "password", "code", "money", "card", "info", "download"]}
            linkToCheck={a.urls[0] ?? null}
            testID="email-recovery"
          />
        ) : null}
        <Sheet visible={verify} onClose={() => setVerify(false)} title="Verify the sender safely" testID="email-verify-sheet">
          <Body testID="email-verify-text">{a.verifySender}</Body>
          <Button testID="email-verify-close" variant="ghost" label="Done" onPress={() => setVerify(false)} />
        </Sheet>
      </>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // INPUT VIEW — matches approved mockup
  // ════════════════════════════════════════════════════════════════════════════
  const hasContent = !!(raw.trim() || from.trim() || subject.trim());

  // Status pill colors by state
  const statusPillBg = (state: string) => {
    switch (state) {
      case "resting": return "#E8F5E9";
      case "ears_up": return "#FFF8E1";
      case "growling": return "#FFF3E0";
      case "barking": case "biting": return "#FFEBEE";
      default: return "#F5F5F5";
    }
  };
  const statusPillColor = (state: string) => {
    switch (state) {
      case "resting": return "#2E7D32";
      case "ears_up": return "#F57F17";
      case "growling": return "#E65100";
      case "barking": case "biting": return "#C62828";
      default: return "#616161";
    }
  };

  return (
    <View style={s.root}>
      {/* ── Header ── */}
      <View style={[s.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={s.mailIconWell}>
          <Mail size={22} color="#1D4ED8" />
        </View>
        <View style={s.headerTextWrap}>
          <Text style={s.headerTitle}>Check email</Text>
          <Text style={s.headerSub}>See if an email looks safe or suspicious.</Text>
        </View>
        <InfoButton
          info={{
            title: "About email checking",
            body: [
              "Paste a forwarded email or fill in the sender, subject and body. Apollo analyses the email for scam indicators, phishing patterns and suspicious links.",
              "Apollo checks sender reputation, authentication headers, embedded links and content patterns. Raw content is discarded after the assessment.",
              "A manual check works without connecting any email account. Account selection is for organising your checks across multiple email addresses.",
            ],
          }}
          testID="email-info"
        />
        <Pressable
          testID="email-close"
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={() => goBackOrHome(router)}
          style={s.closeBtn}
        >
          <X size={22} color={colors.onSurface} />
        </Pressable>
      </View>

      <KeyboardAwareScrollView
        testID="email-scroll"
        contentContainerStyle={[s.scrollContent, { paddingTop: spacing.lg, paddingBottom: insets.bottom + 100 }]}
        bottomOffset={24}
      >
        {/* ── Paste Area / Edit Area ── */}
        {!editing ? (
          <Pressable
            testID="email-paste-area"
            accessibilityRole="button"
            accessibilityLabel="Paste an email or forward it here"
            onPress={() => setEditing(true)}
            style={({ pressed }) => [s.pasteArea, { opacity: pressed ? 0.85 : 1 }]}
          >
            <View style={s.pasteIconWell}>
              <Mail size={24} color="#1D4ED8" />
            </View>
            <View style={s.pasteTextWrap}>
              <Text style={s.pasteTitle}>Paste an email or forward it here</Text>
              <Text style={s.pasteSub}>Include the sender, subject and message, or forward the email to this screen.</Text>
            </View>
          </Pressable>
        ) : (
          <View style={s.editCard} testID="email-edit-card">
            <Text style={s.editLabel}>Email content</Text>
            <TextInput
              testID="email-from"
              style={s.editField}
              value={from}
              onChangeText={setFrom}
              placeholder="From (optional, e.g. alerts@cb-secure.top)"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextInput
              testID="email-subject"
              style={s.editField}
              value={subject}
              onChangeText={setSubject}
              placeholder="Subject (optional)"
              placeholderTextColor={colors.muted}
              autoCorrect={false}
            />
            <TextInput
              testID="email-body"
              style={[s.editField, s.editBody]}
              value={raw}
              onChangeText={setRaw}
              placeholder="Paste the email content here \u2014 headers, body and links. If forwarding, include the entire message."
              placeholderTextColor={colors.muted}
              multiline
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        )}

        {/* ── Button Row: Check email + Choose screenshot ── */}
        <View style={s.buttonRow}>
          <Pressable
            testID="email-run"
            accessibilityRole="button"
            accessibilityLabel="Check email"
            disabled={busy || !hasContent}
            onPress={() => void run()}
            style={({ pressed }) => [s.checkBtn, (busy || !hasContent) && s.checkBtnDisabled, { opacity: pressed && hasContent ? 0.85 : 1 }]}
          >
            {busy ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Search size={20} color={colors.onBrandPrimary} />}
            <Text style={s.checkBtnText}>{busy ? "Checking\u2026" : "Check email"}</Text>
          </Pressable>

          <Pressable
            testID="email-check-screenshot"
            accessibilityRole="button"
            accessibilityLabel="Choose screenshot"
            onPress={() => router.push({ pathname: "/message", params: { openScreenshot: "1", source: "email" } })}
            style={({ pressed }) => [s.screenshotBtn, { opacity: pressed ? 0.85 : 1 }]}
          >
            <Image size={20} color={colors.onSurface} />
            <Text style={s.screenshotBtnText}>Choose screenshot</Text>
          </Pressable>
        </View>

        {/* ── Pick from inbox (Gmail connected only) ── */}
        {gmailConnected ? (
          <Button
            testID="email-pick-inbox"
            variant="secondary"
            icon={<Inbox size={18} color={colors.onSurface} />}
            label="Pick an email from your inbox"
            onPress={() => void openInboxPicker()}
            disabled={gmailBusy || scanBusy}
          />
        ) : null}

        {/* ── Privacy Card ── */}
        <View style={s.privacyCard} testID="email-privacy-card">
          <View style={s.privacyIconWell}>
            <ShieldCheck size={20} color={colors.brand} />
          </View>
          <Text style={s.privacyText}>
            Apollo combines local detection, Higgins context, sender reputation and safe webpage checks. Raw content is discarded after the assessment; provider-side retention follows the configured Higgins policy.
          </Text>
        </View>

        {/* ── Account Selector (compact, above recent checks) ── */}
        {allAccounts.length > 0 ? (
          <Pressable
            testID="email-account-selector"
            accessibilityRole="button"
            accessibilityLabel={selectedAccount ? `Filtered to ${selectedAccount}` : "All email accounts"}
            onPress={() => setAccountSheetOpen(true)}
            style={({ pressed }) => [s.accountSelector, { opacity: pressed ? 0.85 : 1 }]}
          >
            <View style={s.accountLeft}>
              <Mail size={18} color={colors.onSurface} />
              <Text style={s.accountText} numberOfLines={1}>
                {selectedAccount ?? "All email accounts"}
              </Text>
            </View>
            <Pressable
              testID="email-manage-accounts"
              accessibilityRole="button"
              accessibilityLabel="Manage accounts"
              onPress={(e) => { e.stopPropagation?.(); setManageSheetOpen(true); }}
              hitSlop={8}
            >
              <Text style={s.accountManage}>Manage</Text>
            </Pressable>
            <View style={s.accountDivider} />
            <ChevronDown size={18} color={colors.muted} />
          </Pressable>
        ) : null}

        {/* ── Your Recent Checks ── */}
        <View style={s.recentSection} testID="email-recent-section">
          <View style={s.recentHeader}>
            <View style={s.recentHeaderLeft}>
              <Clock size={20} color={colors.brand} />
              <Text style={s.recentTitle}>Your recent checks</Text>
            </View>
            {filteredRecentChecks.length > 3 ? (
              <Pressable accessibilityRole="button" style={s.seeAll}>
                <Text style={s.seeAllText}>See all</Text>
                <ChevronRight size={16} color={colors.brand} />
              </Pressable>
            ) : null}
          </View>

          {filteredRecentChecks.length > 0 ? (
            filteredRecentChecks.slice(0, 5).map((check, i) => (
              <Pressable
                key={check.id}
                testID={`email-recent-${i}`}
                accessibilityRole={check.eventId ? "button" : undefined}
                onPress={check.eventId ? () => openRecentCheck(check) : undefined}
                style={({ pressed }) => [s.recentRow, pressed && check.eventId ? { opacity: 0.7 } : undefined]}
              >
                <View style={s.recentMailIcon}>
                  <Mail size={20} color="#1D4ED8" />
                </View>
                <View style={s.recentInfo}>
                  <Text style={s.recentSubject} numberOfLines={1}>
                    {check.subject || check.summary}
                  </Text>
                  {check.sender ? (
                    <Text style={s.recentSender} numberOfLines={1}>{check.sender}</Text>
                  ) : null}
                  <Text style={s.recentDate}>{formatTimestamp(check.at)}</Text>
                </View>
                <View style={[s.recentStatusPill, { backgroundColor: statusPillBg(check.state) }]}>
                  <View style={[s.recentStatusDot, { backgroundColor: statusPillColor(check.state) }]} />
                  <Text style={[s.recentStatusText, { color: statusPillColor(check.state) }]} numberOfLines={1}>
                    {statusLabel(check.state)}
                  </Text>
                </View>
                <ChevronRight size={18} color={colors.muted} />
              </Pressable>
            ))
          ) : (
            <View style={s.recentEmpty}>
              <Mail size={32} color={colors.muted} />
              <Body>No recent checks yet</Body>
              <Body style={{ textAlign: "center" }}>Your email checks will appear here with summaries and status.</Body>
            </View>
          )}
        </View>
      </KeyboardAwareScrollView>

      {/* ══════════════════════════════════════════════════════════════════════
       *  SHEETS & MODALS
       * ══════════════════════════════════════════════════════════════════════ */}

      {/* ── Account Selector Sheet ── */}
      <Sheet visible={accountSheetOpen} onClose={() => setAccountSheetOpen(false)} title="Select email account" testID="email-account-sheet">
        <Pressable
          testID="email-account-all"
          accessibilityRole="button"
          onPress={() => { setSelectedAccount(null); setAccountSheetOpen(false); }}
          style={s.sheetRow}
        >
          <View style={s.sheetIcon}><Mail size={20} color={colors.brand} /></View>
          <View style={s.sheetInfo}>
            <Text style={s.sheetEmail}>All email accounts</Text>
            <Text style={s.sheetProvider}>Show checks from all accounts</Text>
          </View>
          {!selectedAccount ? (
            <View style={s.sheetCheck}><Check size={14} color={colors.onBrand} /></View>
          ) : null}
        </Pressable>
        {allAccounts.map((acct) => (
          <Pressable
            key={acct.id}
            testID={`email-account-${acct.email}`}
            accessibilityRole="button"
            onPress={() => { setSelectedAccount(acct.email); setAccountSheetOpen(false); }}
            style={s.sheetRow}
          >
            <View style={s.sheetIcon}><User size={20} color={colors.muted} /></View>
            <View style={s.sheetInfo}>
              <Text style={s.sheetEmail} numberOfLines={1}>{acct.email}</Text>
              <Text style={s.sheetProvider}>{providerLabel(acct.provider)}{acct.connected ? " \u00b7 Connected" : ""}</Text>
            </View>
            {selectedAccount?.toLowerCase() === acct.email.toLowerCase() ? (
              <View style={s.sheetCheck}><Check size={14} color={colors.onBrand} /></View>
            ) : null}
          </Pressable>
        ))}
        {allAccounts.length === 0 ? (
          <Body style={{ paddingVertical: spacing.md, textAlign: "center" }}>No accounts added yet. Tap Manage to add your email addresses.</Body>
        ) : null}
      </Sheet>

      {/* ── Manage Accounts Sheet ── */}
      <Sheet visible={manageSheetOpen} onClose={() => setManageSheetOpen(false)} title="Manage email accounts" testID="email-manage-sheet">
        <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
          {allAccounts.map((acct) => (
            <View key={acct.id} style={s.sheetRow}>
              <View style={s.sheetIcon}><User size={20} color={colors.muted} /></View>
              <View style={s.sheetInfo}>
                <Text style={s.sheetEmail} numberOfLines={1}>{acct.email}</Text>
                <Text style={s.sheetProvider}>{providerLabel(acct.provider)}{acct.connected ? " \u00b7 Connected" : " \u00b7 Manual"}</Text>
              </View>
              <Pressable testID={`email-remove-${acct.email}`} accessibilityRole="button" accessibilityLabel={`Remove ${acct.email}`} onPress={() => void handleRemoveAccount(acct)} hitSlop={8}>
                <Trash size={18} color={colors.error} />
              </Pressable>
            </View>
          ))}
          {allAccounts.length === 0 ? (
            <Body style={{ paddingVertical: spacing.md }}>No email accounts added. Add your email addresses below to organise and filter your checks.</Body>
          ) : null}
          <View style={{ gap: spacing.sm, paddingTop: spacing.lg }}>
            <Text style={s.editLabel}>Add email account</Text>
            <TextInput
              testID="email-add-input"
              style={s.addInput}
              value={newAccountEmail}
              onChangeText={setNewAccountEmail}
              placeholder="your@email.com"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              returnKeyType="done"
              onSubmitEditing={() => void handleAddAccount()}
            />
            <Button testID="email-add-account" variant="secondary" icon={<Plus size={18} color={colors.brand} />} label="Add email account" onPress={() => void handleAddAccount()} disabled={!newAccountEmail.trim()} />
          </View>
          {gmailConfigured ? (
            <View style={{ gap: spacing.sm, paddingTop: spacing.lg }}>
              <Text style={s.editLabel}>Gmail integration</Text>
              {gmailConnected ? (
                <>
                  <Body>{gmailAccounts.length} Gmail {gmailAccounts.length === 1 ? "account" : "accounts"} connected (read-only).</Body>
                  <Button testID="email-gmail-scan" variant="secondary" label={scanBusy ? "Scanning\u2026" : "Scan recent Gmail"} icon={scanBusy ? <ActivityIndicator size="small" color={colors.brand} /> : undefined} onPress={() => void scanInbox()} disabled={scanBusy || gmailBusy} />
                  <Button testID="email-gmail-monitoring" variant="ghost" label={gmailMonitoring ? "Stop ongoing monitoring" : "Enable ongoing monitoring"} onPress={() => void toggleGmailMonitoring()} disabled={scanBusy || gmailBusy} />
                  <Button testID="email-gmail-connect-another" variant="ghost" icon={gmailBusy ? <ActivityIndicator size="small" color={colors.brand} /> : <Mail size={16} color={colors.brand} />} label={gmailBusy ? "Opening Google\u2026" : "Connect another Gmail"} onPress={() => void connectGmail()} disabled={gmailBusy} />
                </>
              ) : (
                <>
                  <Body style={{ fontSize: 13 }}>Connect Gmail for read-only access. Apollo never asks for or stores your Gmail password.</Body>
                  <Button testID="email-gmail-connect" variant="secondary" icon={gmailBusy ? <ActivityIndicator size="small" color={colors.brand} /> : <Mail size={18} color={colors.brand} />} label={gmailBusy ? "Opening Google\u2026" : "Connect Gmail (read-only)"} onPress={() => void connectGmail()} disabled={gmailBusy || !deviceId} />
                </>
              )}
            </View>
          ) : null}
        </ScrollView>
      </Sheet>

      {/* ── Inbox Picker Modal (preserved) ── */}
      <Modal visible={pickerVisible} transparent animationType="slide" onRequestClose={() => setPickerVisible(false)}>
        <View style={s.pickerOverlay}>
          <Pressable style={{ flex: 1 }} onPress={() => setPickerVisible(false)} accessibilityLabel="Close" />
          <View style={[s.pickerSheet, { paddingBottom: insets.bottom + spacing.md }]}>
            <View style={s.pickerHandle} />
            <View style={s.pickerHeader}>
              <Text style={s.pickerTitle}>Pick an email</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setPickerVisible(false)} style={s.close}>
                <X size={20} color={colors.onSurface} />
              </Pressable>
            </View>
            {uniquePickerAccounts.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.pickerAccountTabs}>
                <Pressable accessibilityRole="button" onPress={() => setPickerAccount(null)} style={[s.pickerTab, !pickerAccount && { backgroundColor: colors.brand }]}>
                  <Text style={[s.pickerTabText, !pickerAccount && { color: colors.onBrand }]}>All accounts</Text>
                </Pressable>
                {uniquePickerAccounts.map((acct) => (
                  <Pressable key={acct} accessibilityRole="button" onPress={() => setPickerAccount(acct)} style={[s.pickerTab, pickerAccount === acct && { backgroundColor: colors.brand }]}>
                    <Text style={[s.pickerTabText, pickerAccount === acct && { color: colors.onBrand }]} numberOfLines={1}>{acct}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}
            {pickerLoading ? (
              <View style={s.pickerCenter}>
                <ActivityIndicator color={colors.brand} />
                <Body>Loading inbox\u2026</Body>
              </View>
            ) : filteredPickerMessages.length === 0 ? (
              <View style={s.pickerCenter}>
                <Inbox size={32} color={colors.muted} />
                <Body>No recent emails found.</Body>
              </View>
            ) : (
              <FlatList
                data={filteredPickerMessages}
                keyExtractor={(item) => `${item.account}-${item.id}`}
                contentContainerStyle={{ paddingHorizontal: spacing.lg }}
                renderItem={({ item }) => {
                  const isFetching = pickerFetchBusy === item.id;
                  const senderName = item.from.replace(/<.*>/, "").trim() || item.from;
                  return (
                    <Pressable accessibilityRole="button" testID={`inbox-msg-${item.id}`} onPress={() => void selectInboxEmail(item)} disabled={!!pickerFetchBusy} style={({ pressed }) => [s.pickerRow, { opacity: pressed ? 0.7 : 1 }]}>
                      <View style={s.pickerIconWrap}>
                        {isFetching ? <ActivityIndicator size="small" color={colors.brand} /> : <User size={20} color={colors.muted} />}
                      </View>
                      <View style={s.pickerMsgContent}>
                        <Text style={s.pickerSender} numberOfLines={1}>{senderName}</Text>
                        <Text style={s.pickerSubject} numberOfLines={1}>{item.subject || "(no subject)"}</Text>
                        <Text style={s.pickerSnippet} numberOfLines={2}>{item.snippet}</Text>
                        {uniquePickerAccounts.length > 1 && item.account ? (
                          <Text style={s.pickerAccountLabel}>{item.account}</Text>
                        ) : null}
                      </View>
                      <ChevronRight size={16} color={colors.muted} />
                    </Pressable>
                  );
                }}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}
