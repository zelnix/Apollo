// Check Email — Approved screen implementation.
// Matches the approved mock-up: header, description, email card,
// gold Check email CTA, "or" divider, two action cards, recent emails section.
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import Check from "lucide-react-native/icons/check";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import Clock from "lucide-react-native/icons/clock";
import ImageIcon from "lucide-react-native/icons/image";
import Inbox from "lucide-react-native/icons/inbox";
import Mail from "lucide-react-native/icons/mail";
import Plus from "lucide-react-native/icons/plus";
import Search from "lucide-react-native/icons/search";
import Trash from "lucide-react-native/icons/trash";
import User from "lucide-react-native/icons/user";
import X from "lucide-react-native/icons/x";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
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
import { InvestigationCheckScreen } from "@/src/components/InvestigationCheckScreen";
import { RecoveryFlow } from "@/src/components/RecoveryFlow";
import { Sheet } from "@/src/components/Sheet";
import { Body, Button } from "@/src/components/ui";
import { analyseEmail, type EmailAnalysis } from "@/src/domain/emailAnalysis";
import { evaluateLinkGuardFindings, extractAnchorsFromPlainText } from "@/src/domain/linkGuard";
import { type PatrolEvent } from "@/src/domain/types";
import { STATE_RANK } from "@/src/domain/stateMachine";
import { patrolSafeSummary } from "@/src/domain/investigation";
import { redactUserSecrets } from "@/src/domain/privacy";
import { connectGmailOAuth } from "@/src/domain/gmailConnect";
import { buildEmailCheckResult } from "@/src/domain/emailCheckResultAdapter";
import { contextFromEvent, gateForCategory } from "@/src/domain/higginsHandoff";
import { runProtectionHealthCheck } from "@/src/protection/healthCoordinator";
import { type MessageUrlResult, useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { CheckToolHeader } from "@/src/components/CheckToolHeader";
import { CheckingModal } from "@/src/components/CheckingModal";
import { getShareIntake } from "@/src/share/shareIntake";
import { SIMULATED_EMAILS, PREVIEW_SAMPLES_ENABLED } from "@/src/preview/samples";
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

// ── Styles ─────────────────────────────────────────────────────────────────────
const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },

  // Header
  header: { paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md },

  // Scroll
  scrollContent: { paddingHorizontal: spacing.lg, gap: spacing.lg },

  // Description
  description: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurfaceSecondary },

  // Email card
  emailCard: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, borderWidth: 0.25, borderColor: c.border },
  emailCardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  emailIconWell: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#DBEAFE", alignItems: "center", justifyContent: "center" },
  emailCardLabel: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface },
  emailInput: { minHeight: 100, backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontFamily: fonts.text, fontSize: 16, color: c.onSurface, textAlignVertical: "top" },

  // Gold CTA
  goldBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: c.gold, borderRadius: radius.lg, paddingVertical: 16, paddingHorizontal: spacing.xl, gap: spacing.md, minHeight: 56 },
  goldBtnDisabled: { opacity: 0.45 },
  goldBtnText: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface },

  // Or divider
  orDivider: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs },
  orLine: { flex: 1, height: 1, backgroundColor: c.border },
  orText: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.muted },

  // Action cards row
  actionCardsRow: { gap: spacing.md },
  actionCard: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 0.25, borderColor: c.border },
  actionCardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  actionCardIconWell: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  actionCardTitle: { fontFamily: fonts.displayBold, fontSize: 15, color: c.onSurface, flex: 1 },
  actionCardSub: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.onSurfaceSecondary },
  actionCardChevron: { marginLeft: "auto" },

  // ── Expandable enter text link ──
  expandLink: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
  expandLinkText: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.brandPrimary, flex: 1 },

  // ── Recent emails dropdown ──
  recentDropdown: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, borderWidth: 0.25, borderColor: c.border, overflow: "hidden" as const },
  recentDropdownToggle: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md, padding: spacing.lg },
  recentDropdownIconWell: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.surfaceTertiary, alignItems: "center" as const, justifyContent: "center" as const },
  recentDropdownTitle: { fontFamily: fonts.displayBold, fontSize: 15, color: c.onSurface, flex: 1 },
  recentDropdownSub: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceSecondary, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  // Gmail M icon for action card
  gmailIconM: { fontFamily: fonts.displayBold, fontSize: 20, color: "#EA4335" },

  // Recent emails section
  recentSection: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, borderWidth: 0.25, borderColor: c.border, overflow: "hidden" },
  recentHeader: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md, gap: 4 },
  recentHeaderTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  recentTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  recentClockWell: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  recentTitle: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface },
  seeAllRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  seeAllText: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.brand },
  recentSub: { fontFamily: fonts.text, fontSize: 14, color: c.onSurfaceSecondary, marginLeft: 48 },

  // Email row
  emailRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.md, paddingHorizontal: spacing.lg, gap: spacing.md, borderTopWidth: 1, borderTopColor: c.border },
  // Simulated inbox (preview only) — deliberately marked so it can never read as a real mailbox.
  simInbox: { marginHorizontal: spacing.lg, marginBottom: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderStyle: "dashed", borderColor: c.gold, backgroundColor: c.surfaceSecondary, paddingVertical: spacing.md },
  simInboxHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg },
  simInboxTitle: { fontFamily: fonts.displayBold, fontSize: 16, color: c.onSurface, flex: 1 },
  simInboxTag: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: c.gold },
  simInboxTagText: { fontFamily: fonts.textSemibold, fontSize: 10, letterSpacing: 0.5, color: "#1B2437" },
  simInboxSub: { fontFamily: fonts.text, fontSize: 12, lineHeight: 17, color: c.onSurfaceSecondary, paddingHorizontal: spacing.lg, marginTop: spacing.xs },
  simRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderTopWidth: 1, borderTopColor: c.border, marginTop: spacing.xs },
  simRowProbe: { fontFamily: fonts.text, fontSize: 12, lineHeight: 17, color: c.onSurfaceSecondary, marginTop: 2 },
  emailRowIconWell: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  emailRowUnknownWell: { backgroundColor: c.surfaceTertiary },
  emailRowContactWell: {},
  emailRowInitial: { fontFamily: fonts.displayBold, fontSize: 18, color: "#FFFFFF" },
  emailRowInfo: { flex: 1, gap: 2 },
  emailRowSender: { fontFamily: fonts.displayBold, fontSize: 16, color: c.onSurface },
  emailRowSubject: { fontFamily: fonts.text, fontSize: 14, color: c.onSurfaceSecondary },
  emailRowDate: { fontFamily: fonts.text, fontSize: 13, color: c.muted, flexShrink: 0 },

  // Account filter pill (inside recent section header)
  accountFilterRow: { flexDirection: "row", alignItems: "center", marginLeft: 48, gap: spacing.sm, marginTop: spacing.xs },
  accountPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface },
  accountPillText: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.onSurface },
  accountPillManage: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.brand },

  // Empty recent
  recentEmpty: { padding: spacing.xl, alignItems: "center", gap: spacing.sm },

  // Sheet rows (for account management)
  sheetRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  sheetIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  sheetInfo: { flex: 1, gap: 2 },
  sheetEmail: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  sheetProvider: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  sheetCheck: { width: 24, height: 24, borderRadius: 12, backgroundColor: c.brand, alignItems: "center", justifyContent: "center" },
  editLabel: { fontFamily: fonts.textSemibold, fontSize: 12, letterSpacing: 1, color: c.muted, textTransform: "uppercase" },
  addInput: { minHeight: 48, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },

  // Inbox picker modal (preserved)
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
  const { ready, setupDone, upsertEvent, deviceId, adapterLabel, showToast, scanGmailInbox, isMock } = useApollo();

  // ── Input state ──
  const [fromState, setFrom] = useState("");
  const [subject, setSubject] = useState("");
  const [raw, setRaw] = useState(shared?.text || shared?.webUrl || params.text || "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    submissionId: string;
    a: EmailAnalysis;
    event: PatrolEvent | null;
    urls: MessageUrlResult[];
    explanation: null;
    assessment: null;
  } | null>(null);
  const [verify, setVerify] = useState(false);

  // ── Account state ──
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [accountSheetOpen, setAccountSheetOpen] = useState(false);
  const [manageSheetOpen, setManageSheetOpen] = useState(false);
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [newAccountEmail, setNewAccountEmail] = useState("");

  // ── Recent checks ──
  const [, setRecentChecks] = useState<EmailCheckEntry[]>([]);

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

  // ── Recent inbox emails (shown in the main screen) ──
  type InboxPreviewItem = { id: string; account: string; from: string; subject: string; date: string; snippet: string };
  const [recentInbox, setRecentInbox] = useState<InboxPreviewItem[]>([]);
  const [recentInboxLoading, setRecentInboxLoading] = useState(false);
  const [emailTextOpen, setEmailTextOpen] = useState(false);
  const [recentEmailsOpen, setRecentEmailsOpen] = useState(false);

  const loadRecentInbox = useCallback(async () => {
    if (!deviceId || !gmailConnected) return;
    setRecentInboxLoading(true);
    try {
      const data = await apiGet<{ messages: InboxPreviewItem[] }>(`/gmail/messages?device_id=${deviceId}&limit=5`);
      setRecentInbox(data.messages ?? []);
    } catch { /* unavailable */ }
    finally { setRecentInboxLoading(false); }
  }, [deviceId, gmailConnected]);

  useEffect(() => { if (gmailConnected) void loadRecentInbox(); }, [gmailConnected, loadRecentInbox]);

  // Auto-run if shared content arrives
  useEffect(() => {
    if (raw.trim() && deviceId) { /* content was shared into this screen */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The simulated inbox exists only where the preview cannot reach a real mailbox, and never
  // alongside a connected one.
  // Preview only: never in a production build, and never when a real mailbox is connected.
  const showSimulatedInbox = PREVIEW_SAMPLES_ENABLED && (Platform.OS === "web" || isMock) && gmailConnected !== true;

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
      setPickerVisible(false);
      // Auto-investigate the selected email
      const body = detail.body || msg.snippet;
      const sender = detail.from || msg.from;
      const subj = detail.subject || msg.subject;
      showToast("Email loaded \u2014 investigating\u2026", "neutral");
      // Trigger investigation with the loaded content
      setTimeout(() => {
        setRaw(body);
        setFrom(sender);
        setSubject(subj);
      }, 100);
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
  // `source` lets a selected email (e.g. one from the preview's simulated inbox) be checked straight
  // away without waiting for state to settle. The flow below is the ONE real email check: same
  // on-device analysis, same /message/analyse call (real Triage, and real Magnum DI where Triage
  // escalates), same event. There is no separate path for simulated input.
  const run = async (source?: { from: string; subject: string; raw: string }) => {
    setBusy(true);
    try {
      const rawInput = source?.raw ?? raw;
      const subjectInput = source?.subject ?? subject;
      const from = source?.from ?? fromState;
      const safeRaw = redactUserSecrets(rawInput);
      const safeSubject = redactUserSecrets(subjectInput);
      if (safeRaw !== rawInput) setRaw(safeRaw); else if (source) setRaw(rawInput);
      if (safeSubject !== subjectInput) setSubject(safeSubject); else if (source) setSubject(subjectInput);
      if (source) setFrom(source.from);
      let a = analyseEmail(safeRaw, { from, subject: safeSubject });
      let urls: MessageUrlResult[] = [];
      let investigationCaseId: string | null = null;
      try {
        const r = await apiPost<{
          urls: MessageUrlResult[];
          investigation_case_id?: string | null;
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
        investigationCaseId = typeof r.investigation_case_id === "string" ? r.investigation_case_id : null;
        // URL guard: deterministic link protection still drives state
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
          headline: `Email: ${a.title}`,
          what_happened: patrolSafeSummary(a.verdict),
          why: a.why,
          what_to_do: a.recommendation,
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
          investigation_case_id: investigationCaseId,
        }, { kind: "email", fields: [...(from.trim() ? [{ label: "From", value: from }] : []), ...(subjectInput.trim() ? [{ label: "Subject", value: subjectInput }] : [])], text: rawInput });
        if (event.state !== a.state) a = { ...a, state: event.state, why: event.why };
      }
      const submissionId = event?.event_id ?? Crypto.randomUUID();
      setResult({ submissionId, a, event, urls, explanation: null, assessment: null });
      void recordEmailCheck({
        id: submissionId,
        at: new Date().toISOString(),
        state: a.state,
        summary: a.title,
        subject: safeSubject.trim() || a.parsed.subject || undefined,
        sender: from.trim() || a.parsed.fromAddress || undefined,
        account: source ? "Simulated inbox (preview)" : selectedAccount || undefined,
        eventId: event?.event_id || undefined,
        scenario: a.scenario,
      });
      void recordCheck("email", { at: new Date().toISOString(), state: a.state, summary: a.title });
      void refreshRecentChecks();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn\u2019t read that email.", "barking");
    } finally { setBusy(false); }
  };

  // ── Navigation ──
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
      from: fromState,
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
        void refreshRecentChecks();
      },
    });

    return (
      <>
        {result.event ? (
          <InvestigationCheckScreen
            result={model}
            investigationContext={contextFromEvent(result.event, gateForCategory(result.event.category))}
            investigationQuestion={askPrompt}
            submissionId={result.event.event_id}
            eventId={result.event.event_id}
            actions={emailActions}
          />
        ) : (
          <CheckResultScreen result={model} actions={emailActions} />
        )}
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
  const hasContent = !!(raw.trim());

  // ── Helper: contact initial color ──
  const INITIAL_COLORS = ["#F97316", "#EF4444", "#6366F1", "#3B82F6", "#8B5CF6", "#EC4899", "#14B8A6", "#10B981"];
  const initialColor = (name: string) => INITIAL_COLORS[name.charCodeAt(0) % INITIAL_COLORS.length];

  // ── Helper: extract sender display name ──
  const senderDisplayName = (fromStr: string) => fromStr.replace(/<.*>/, "").trim() || fromStr;

  // ── Helper: is email address (no display name) ──
  const isEmailOnly = (fromStr: string) => /^[^<]*@[^>]*$/.test(fromStr.trim());

  // ── Helper: format date for inbox rows ──
  const formatEmailDate = (iso: string) => {
    try {
      const d = new Date(iso);
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const isYesterday = d.toDateString() === yesterday.toDateString();
      if (isToday) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
      if (isYesterday) return "Yesterday";
      return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    } catch { return ""; }
  };

  // ── Select a recent inbox email → auto-investigate ──
  const selectRecentInboxEmail = (msg: InboxPreviewItem) => {
    void selectInboxEmail(msg);
  };

  // ── Handle Gmail action card press ──

  return (
    <View style={s.root}>
      {/* ── Header ── */}
      <View style={[s.header, { paddingTop: insets.top + spacing.md }]}>
        <CheckToolHeader
          title="Check email"
          info={{
            title: "About email checking",
            body: [
              "Paste a forwarded email or fill in the sender, subject and body. Apollo analyses the email for scam indicators, phishing patterns and suspicious links.",
              "Apollo checks sender reputation, authentication headers, embedded links and content patterns. Raw content is discarded after the assessment.",
              "A manual check works without connecting any email account. Account selection is for organising your checks across multiple email addresses.",
            ],
          }}
          testID="email"
        />
      </View>

      <KeyboardAwareScrollView
        testID="email-scroll"
        contentContainerStyle={[s.scrollContent, { paddingTop: spacing.md, paddingBottom: insets.bottom + 100 }]}
        bottomOffset={24}
      >
        {/* ── Description ── */}
        <Text style={s.description}>
          Choose an email from your inbox, take a screenshot, or enter the text.{"\n"}Magnum DI will investigate it for possible scams.
        </Text>

        {/* ── Simulated inbox — PREVIEW ONLY ──
            Sample emails that exist purely to feed Apollo's real email check when the preview has
            no connected mailbox. Selecting one runs the same run() flow a real email runs: real
            on-device analysis, real Triage, and real Magnum DI only where Triage escalates. */}
        {showSimulatedInbox ? (
          <View style={s.simInbox} testID="email-simulated-inbox">
            <View style={s.simInboxHeader}>
              <Inbox size={18} color={colors.onSurface} />
              <Text style={s.simInboxTitle}>Simulated inbox</Text>
              <View style={s.simInboxTag}><Text style={s.simInboxTagText}>PREVIEW ONLY</Text></View>
            </View>
            <Text style={s.simInboxSub}>
              This is NOT a connected mailbox and no real email is read. These are sample emails built into the
              preview so the real email check can be exercised. Apollo runs his own checks on whichever one you
              pick and decides the outcome himself — nothing here is pre-judged.
            </Text>
            {SIMULATED_EMAILS.map((sim, i) => (
              <Pressable
                key={sim.id}
                testID={`email-simulated-${i}`}
                accessibilityRole="button"
                accessibilityLabel={`Check the simulated email from ${sim.from}`}
                disabled={busy}
                onPress={() => void run({ from: sim.from, subject: sim.subject, raw: sim.body })}
                style={({ pressed }) => [s.simRow, { opacity: pressed || busy ? 0.7 : 1 }]}
              >
                <View style={s.emailRowInfo}>
                  <Text style={s.emailRowSender} numberOfLines={1}>{sim.from}</Text>
                  <Text style={s.emailRowSubject} numberOfLines={2}>{sim.subject}</Text>
                  <Text style={s.simRowProbe} numberOfLines={2}>{sim.probes}</Text>
                </View>
                <ChevronRight size={16} color={colors.muted} />
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* ── Recent Emails Dropdown (above action cards) ── */}
        <View style={s.recentDropdown} testID="email-recent-section">
          <Pressable
            accessibilityRole="button"
            onPress={() => setRecentEmailsOpen((v) => !v)}
            style={s.recentDropdownToggle}
            testID="email-recent-toggle"
          >
            <View style={s.recentDropdownIconWell}>
              <Clock size={18} color={colors.onSurface} />
            </View>
            <Text style={s.recentDropdownTitle}>Select recent emails</Text>
            {recentEmailsOpen ? <ChevronUp size={18} color={colors.muted} /> : <ChevronDown size={18} color={colors.muted} />}
          </Pressable>

          {recentEmailsOpen ? <>
            <Text style={s.recentDropdownSub}>Tap an email to check it with Apollo.</Text>
            {/* Account filter pills */}
            {allAccounts.length > 1 ? (
              <View style={[s.accountFilterRow, { paddingHorizontal: spacing.lg }]}>
                <Pressable accessibilityRole="button" onPress={() => setAccountSheetOpen(true)} style={s.accountPill}>
                  <Text style={s.accountPillText} numberOfLines={1}>{selectedAccount ?? "All accounts"}</Text>
                  <ChevronDown size={14} color={colors.muted} />
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => setManageSheetOpen(true)} hitSlop={8}>
                  <Text style={s.accountPillManage}>Manage</Text>
                </Pressable>
              </View>
            ) : null}

            {/* Email rows */}
            {gmailConnected && recentInbox.length > 0 ? (
              recentInbox.slice(0, 5).map((msg, i) => {
                const name = senderDisplayName(msg.from);
                const emailOnly = isEmailOnly(msg.from);
                return (
                  <Pressable
                    key={`${msg.account}-${msg.id}`}
                    testID={`email-recent-${i}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Check email from ${name}`}
                    onPress={() => selectRecentInboxEmail(msg)}
                    disabled={!!pickerFetchBusy}
                    style={({ pressed }) => [s.emailRow, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    {pickerFetchBusy === msg.id ? (
                      <View style={[s.emailRowIconWell, s.emailRowUnknownWell]}>
                        <ActivityIndicator size="small" color={colors.brand} />
                      </View>
                    ) : emailOnly ? (
                      <View style={[s.emailRowIconWell, s.emailRowUnknownWell]}>
                        <User size={22} color={colors.muted} />
                      </View>
                    ) : (
                      <View style={[s.emailRowIconWell, s.emailRowContactWell, { backgroundColor: initialColor(name) }]}>
                        <Text style={s.emailRowInitial}>{name.charAt(0).toUpperCase()}</Text>
                      </View>
                    )}
                    <View style={s.emailRowInfo}>
                      <Text style={s.emailRowSender} numberOfLines={1}>{name}</Text>
                      <Text style={s.emailRowSubject} numberOfLines={1}>{msg.subject || "(no subject)"}</Text>
                    </View>
                    <Text style={s.emailRowDate}>{formatEmailDate(msg.date)}</Text>
                    <ChevronRight size={18} color={colors.muted} />
                  </Pressable>
                );
              })
            ) : recentInboxLoading ? (
              <View style={s.recentEmpty}>
                <ActivityIndicator size="small" color={colors.brand} />
                <Body>Loading recent emails\u2026</Body>
              </View>
            ) : gmailConnected ? (
              <View style={s.recentEmpty}>
                <Inbox size={28} color={colors.muted} />
                <Body>No recent emails found.</Body>
              </View>
            ) : (
              <View style={s.recentEmpty}>
                <Mail size={28} color={colors.muted} />
                <Body>{gmailConfigured ? "Connect Gmail to see your recent emails here." : "Paste or forward an email below to check it."}</Body>
                {gmailConfigured && !gmailConnected ? (
                  <Button testID="email-connect-inline" variant="ghost" label={gmailBusy ? "Opening Google\u2026" : "Connect Gmail"} onPress={() => void connectGmail()} disabled={gmailBusy || !deviceId} />
                ) : null}
              </View>
            )}

            {gmailConnected && recentInbox.length > 5 ? (
              <Pressable accessibilityRole="button" onPress={() => void openInboxPicker()} style={[s.emailRow, { justifyContent: "center" }]} hitSlop={8}>
                <Text style={s.seeAllText}>See all</Text>
                <ChevronRight size={16} color={colors.brand} />
              </Pressable>
            ) : null}
          </> : null}
        </View>

        {/* ── Action card ── */}
        <View style={s.actionCardsRow}>
          {/* Take a screenshot */}
          <Pressable
            testID="email-check-screenshot"
            accessibilityRole="button"
            accessibilityLabel="Take a screenshot"
            onPress={() => router.push({ pathname: "/message", params: { openScreenshot: "1", source: "email" } })}
            style={({ pressed }) => [s.actionCard, { opacity: pressed ? 0.85 : 1 }]}
          >
            <View style={s.actionCardHeader}>
              <View style={s.actionCardIconWell}><ImageIcon size={20} color={colors.onSurface} /></View>
              <Text style={s.actionCardTitle}>Take a screenshot</Text>
              <ChevronRight size={18} color={colors.muted} />
            </View>
            <Text style={s.actionCardSub}>Select an image from your device or take a new screenshot.</Text>
          </Pressable>
        </View>

        {/* ── Enter email text (expandable) ── */}
        <Pressable
          accessibilityRole="button"
          onPress={() => setEmailTextOpen((v) => !v)}
          style={s.expandLink}
          testID="email-expand-text"
        >
          <View style={s.emailIconWell}>
            <Mail size={22} color="#1D4ED8" />
          </View>
          <Text style={s.expandLinkText}>Enter email text</Text>
          {emailTextOpen ? <ChevronUp size={18} color={colors.muted} /> : <ChevronDown size={18} color={colors.muted} />}
        </Pressable>
        {emailTextOpen ? (
          <View style={s.emailCard} testID="email-card">
            <TextInput
              testID="email-body"
              style={s.emailInput}
              value={raw}
              onChangeText={setRaw}
              placeholder="Paste email content here (sender, subject, message)"
              placeholderTextColor={colors.muted}
              multiline
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
        ) : null}

        {/* ── Gold CTA: Check email ── */}
        <Pressable
          testID="email-run"
          accessibilityRole="button"
          accessibilityLabel="Check email"
          disabled={busy || !hasContent}
          onPress={() => void run()}
          style={({ pressed }) => [s.goldBtn, (busy || !hasContent) && s.goldBtnDisabled, { opacity: pressed && hasContent ? 0.85 : 1 }]}
        >
          <Search size={22} color={colors.onSurface} />
          <Text style={s.goldBtnText}>{"Check email"}</Text>
        </Pressable>
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

      {/* ── Checking overlay modal ── */}
      <CheckingModal
        visible={busy}
        title="Checking email"
        subject={subject.trim() ? subject.trim() : fromState.trim() ? `From: ${fromState.trim()}` : undefined}
        description={"Magnum DI is reviewing headers, sender\nreputation and content for phishing patterns."}
      />
    </View>
  );
}
