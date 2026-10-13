// Check Email — Phase 1 redesign.
// Manual email checks with multiple-account awareness and rich recent checks.
// Connected accounts (Gmail) available via Manage Accounts. Manual checks work
// without connecting any account. See PRD "Check Email Screen Redesign".
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import Camera from "lucide-react-native/icons/camera";
import Check from "lucide-react-native/icons/check";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronRight from "lucide-react-native/icons/chevron-right";
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
import { Body, Button, toneColor } from "@/src/components/ui";
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
    return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch { return ""; }
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },

  // Header
  header: { paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md },
  backBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  mailIconWell: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  headerTextWrap: { flex: 1 },
  headerTitle: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  headerSub: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary, marginTop: 2 },

  // Scroll
  scrollContent: { paddingHorizontal: spacing.lg, gap: spacing.lg },

  // Account selector
  accountSelector: { flexDirection: "row", alignItems: "center", backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, borderWidth: 1, borderColor: c.border, gap: spacing.sm },
  accountLeft: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flex: 1 },
  accountText: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface, flex: 1 },
  accountManage: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.brand },
  accountDivider: { width: 1, height: 20, backgroundColor: c.border, marginHorizontal: spacing.xs },

  // Input card
  inputCard: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: spacing.lg, gap: spacing.md },
  inputLabel: { fontFamily: fonts.textSemibold, fontSize: 12, letterSpacing: 1, color: c.muted, textTransform: "uppercase" },
  inputField: { minHeight: 44, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  inputBody: { minHeight: 140, textAlignVertical: "top" as const },

  // CTA
  ctaBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: c.brandPrimary, borderRadius: radius.lg, paddingVertical: 16, paddingHorizontal: spacing.xl, gap: spacing.sm, minHeight: 56 },
  ctaBtnDisabled: { opacity: 0.5 },
  ctaText: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onBrandPrimary },

  // Action card (screenshot)
  actionCard: { flexDirection: "row", backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, alignItems: "center", borderWidth: 1, borderColor: c.border },
  actionIconWell: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#E6F4EA", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  actionContent: { flex: 1, gap: 4 },
  actionTitle: { fontFamily: fonts.displayBold, fontSize: 16, color: c.onSurface },
  actionDesc: { fontFamily: fonts.text, fontSize: 13, lineHeight: 19, color: c.onSurfaceSecondary },

  // Privacy card
  privacyCard: { flexDirection: "row", backgroundColor: "#EBF3FF", borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, alignItems: "flex-start" },
  privacyIconWell: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#D6E5FC", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  privacyTextWrap: { flex: 1, gap: 4 },
  privacyTitle: { fontFamily: fonts.displayBold, fontSize: 15, color: c.brand },
  privacyDesc: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary },
  learnMore: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.brand, marginTop: 4 },

  // Recent checks
  recentHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  recentTitle: { fontFamily: fonts.textSemibold, fontSize: 12, letterSpacing: 1, color: c.muted, textTransform: "uppercase" },
  recentCard: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, overflow: "hidden", borderWidth: 1, borderColor: c.border },
  recentRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.md, paddingHorizontal: spacing.lg, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: c.border },
  recentRowLast: { borderBottomWidth: 0 },
  recentDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  recentInfo: { flex: 1, gap: 2 },
  recentSummary: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.onSurface },
  recentSender: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceSecondary },
  recentMeta: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  recentEmpty: { padding: spacing.xl, alignItems: "center", gap: spacing.sm },

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

  // ── Sheets ──
  const [privacySheetOpen, setPrivacySheetOpen] = useState(false);

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
      // Auto-register connected Gmail accounts in the local store
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
      const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
      void runProtectionHealthCheck("protection_change");
      showToast(accepted ? `${plural(accepted, "email")} accepted for investigation` : "No new Gmail messages needed investigation", "neutral");
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
    if (selectedAccount?.toLowerCase() === acct.email.toLowerCase()) {
      setSelectedAccount(null);
    }
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

      // Record in enhanced email history
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
      // Legacy check history
      void recordCheck("email", { at: new Date().toISOString(), state: a.state, summary: assessment?.higgins?.headline ?? a.title });
      void refreshRecentChecks();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Couldn\u2019t read that email.", "barking");
    } finally { setBusy(false); }
  };

  // ── Navigation ──
  const openRecentCheck = (check: EmailCheckEntry) => {
    if (check.eventId) {
      router.push("/(tabs)/patrol");
    }
  };

  // ── Guards ──
  if (ready && !setupDone) return <Redirect href="/" />;
  const a = result?.a;
  const scent = result?.event?.scent_id ?? result?.event?.event_id ?? "";

  // ════════════════════════════════════════════════════════════════════════════
  // RESULT VIEW — preserved from original, using CheckResultScreen.
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
  // INPUT VIEW — redesigned per PRD.
  // ════════════════════════════════════════════════════════════════════════════
  const hasContent = !!(raw.trim() || from.trim() || subject.trim());

  return (
    <View style={s.root}>
      {/* ── Header ── */}
      <View style={[s.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="email-back" accessibilityRole="button" accessibilityLabel="Go back" onPress={() => goBackOrHome(router)} style={s.backBtn}>
          <ArrowLeft size={22} color={colors.onSurface} />
        </Pressable>
        <View style={s.mailIconWell}>
          <Mail size={20} color={colors.brand} />
        </View>
        <View style={s.headerTextWrap}>
          <Text style={s.headerTitle}>Check email</Text>
          <Text style={s.headerSub}>See if an email looks safe or suspicious.</Text>
        </View>
        <InfoButton
          info={{
            title: "About email checking",
            body: [
              "Paste a forwarded email (headers included if possible) or fill in the sender, subject and body. Apollo analyses the email for scam indicators, phishing patterns and suspicious links.",
              "Apollo checks sender reputation, authentication headers (SPF/DKIM/DMARC), embedded links and content patterns. Raw content is discarded after the assessment.",
              "A manual check works without connecting any email account. Account selection is for organising your checks when you have multiple email addresses.",
            ],
          }}
          testID="email-info"
        />
      </View>

      <KeyboardAwareScrollView
        testID="email-scroll"
        contentContainerStyle={[s.scrollContent, { paddingTop: spacing.lg, paddingBottom: insets.bottom + 100 }]}
        bottomOffset={24}
      >
        {/* ── Account Selector ── */}
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
            onPress={(e) => {
              e.stopPropagation?.();
              setManageSheetOpen(true);
            }}
            hitSlop={8}
          >
            <Text style={s.accountManage}>Manage</Text>
          </Pressable>
          <View style={s.accountDivider} />
          <ChevronDown size={18} color={colors.muted} />
        </Pressable>

        {/* ── Email Input Card ── */}
        <View style={s.inputCard} testID="email-input-card">
          <Text style={s.inputLabel}>Email content</Text>
          <TextInput
            testID="email-from"
            style={s.inputField}
            value={from}
            onChangeText={setFrom}
            placeholder="From (optional, e.g. alerts@cb-secure.top)"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            testID="email-subject"
            style={s.inputField}
            value={subject}
            onChangeText={setSubject}
            placeholder="Subject (optional)"
            placeholderTextColor={colors.muted}
            autoCorrect={false}
          />
          <TextInput
            testID="email-body"
            style={[s.inputField, s.inputBody]}
            value={raw}
            onChangeText={setRaw}
            placeholder="Paste the email content here — headers, body and links. If forwarding, include the entire message."
            placeholderTextColor={colors.muted}
            multiline
            textAlignVertical="top"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {/* ── Check Email CTA ── */}
        <Pressable
          testID="email-run"
          accessibilityRole="button"
          accessibilityLabel="Check email"
          disabled={busy || !hasContent}
          onPress={() => void run()}
          style={({ pressed }) => [s.ctaBtn, (busy || !hasContent) && s.ctaBtnDisabled, { opacity: pressed && hasContent ? 0.85 : 1 }]}
        >
          {busy ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Search size={20} color={colors.onBrandPrimary} />}
          <Text style={s.ctaText}>{busy ? "Checking\u2026" : "Check email"}</Text>
        </Pressable>

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

        {/* ── Choose Screenshot ── */}
        <Pressable
          testID="email-check-screenshot"
          accessibilityRole="button"
          onPress={() => router.push({ pathname: "/message", params: { openScreenshot: "1", source: "email" } })}
          style={({ pressed }) => [s.actionCard, { opacity: pressed ? 0.85 : 1 }]}
        >
          <View style={s.actionIconWell}>
            <Camera size={22} color="#2E7D32" />
          </View>
          <View style={s.actionContent}>
            <Text style={s.actionTitle}>Choose screenshot</Text>
            <Text style={s.actionDesc}>
              Pick a screenshot of a suspicious email for Apollo to analyse. Personal details are screened on-device before processing.
            </Text>
          </View>
          <ChevronRight size={20} color={colors.muted} />
        </Pressable>

        {/* ── Privacy Card ── */}
        <View style={s.privacyCard} testID="email-privacy-card">
          <View style={s.privacyIconWell}>
            <ShieldCheck size={20} color={colors.brand} />
          </View>
          <View style={s.privacyTextWrap}>
            <Text style={s.privacyTitle}>How Apollo processes your email</Text>
            <Text style={s.privacyDesc}>
              Apollo analyses the text you provide to identify phishing, scam patterns and suspicious links. Content is processed for this check and discarded afterward. Link reputation checks use independent threat databases that do not receive your email content.
            </Text>
            <Pressable accessibilityRole="button" onPress={() => setPrivacySheetOpen(true)}>
              <Text style={s.learnMore}>Learn more</Text>
            </Pressable>
          </View>
        </View>

        {/* ── Your Recent Checks ── */}
        <View style={s.recentHeader}>
          <Text style={s.recentTitle}>Your recent checks</Text>
        </View>

        {filteredRecentChecks.length > 0 ? (
          <View style={s.recentCard} testID="email-recent-checks">
            {filteredRecentChecks.slice(0, 10).map((check, i, arr) => (
              <Pressable
                key={check.id}
                testID={`email-recent-${i}`}
                accessibilityRole={check.eventId ? "button" : undefined}
                onPress={check.eventId ? () => openRecentCheck(check) : undefined}
                style={({ pressed }) => [s.recentRow, i === arr.length - 1 && s.recentRowLast, pressed && check.eventId ? { opacity: 0.7 } : undefined]}
              >
                <View style={[s.recentDot, { backgroundColor: toneColor(colors, check.state as any) }]} />
                <View style={s.recentInfo}>
                  <Text style={s.recentSummary} numberOfLines={1}>
                    {check.subject ?? check.summary}
                  </Text>
                  {check.sender ? (
                    <Text style={s.recentSender} numberOfLines={1}>
                      {check.sender}
                    </Text>
                  ) : null}
                  <Text style={s.recentMeta} numberOfLines={1}>
                    {check.account ? `${check.account} \u00b7 ` : ""}
                    {formatTimestamp(check.at)}
                    {" \u00b7 "}
                    {statusLabel(check.state)}
                  </Text>
                </View>
                {check.eventId ? <ChevronRight size={16} color={colors.muted} /> : null}
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={[s.recentCard, s.recentEmpty]} testID="email-recent-empty">
            <Mail size={32} color={colors.muted} />
            <Body>No recent checks yet</Body>
            <Body style={{ textAlign: "center" }}>Your email checks will appear here with meaningful summaries and status.</Body>
          </View>
        )}
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
          <View style={s.sheetIcon}>
            <Mail size={20} color={colors.brand} />
          </View>
          <View style={s.sheetInfo}>
            <Text style={s.sheetEmail}>All email accounts</Text>
            <Text style={s.sheetProvider}>Show checks from all accounts</Text>
          </View>
          {!selectedAccount ? (
            <View style={s.sheetCheck}>
              <Check size={14} color={colors.onBrand} />
            </View>
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
            <View style={s.sheetIcon}>
              <User size={20} color={colors.muted} />
            </View>
            <View style={s.sheetInfo}>
              <Text style={s.sheetEmail} numberOfLines={1}>{acct.email}</Text>
              <Text style={s.sheetProvider}>
                {providerLabel(acct.provider)}{acct.connected ? " \u00b7 Connected" : ""}
              </Text>
            </View>
            {selectedAccount?.toLowerCase() === acct.email.toLowerCase() ? (
              <View style={s.sheetCheck}>
                <Check size={14} color={colors.onBrand} />
              </View>
            ) : null}
          </Pressable>
        ))}
        {allAccounts.length === 0 ? (
          <Body style={{ paddingVertical: spacing.md, textAlign: "center" }}>
            No accounts added yet. Tap Manage to add your email addresses.
          </Body>
        ) : null}
      </Sheet>

      {/* ── Manage Accounts Sheet ── */}
      <Sheet visible={manageSheetOpen} onClose={() => setManageSheetOpen(false)} title="Manage email accounts" testID="email-manage-sheet">
        <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
          {/* Existing accounts */}
          {allAccounts.map((acct) => (
            <View key={acct.id} style={s.sheetRow}>
              <View style={s.sheetIcon}>
                <User size={20} color={colors.muted} />
              </View>
              <View style={s.sheetInfo}>
                <Text style={s.sheetEmail} numberOfLines={1}>{acct.email}</Text>
                <Text style={s.sheetProvider}>
                  {providerLabel(acct.provider)}{acct.connected ? " \u00b7 Connected" : " \u00b7 Manual"}
                </Text>
              </View>
              <Pressable
                testID={`email-remove-${acct.email}`}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${acct.email}`}
                onPress={() => void handleRemoveAccount(acct)}
                hitSlop={8}
              >
                <Trash size={18} color={colors.error} />
              </Pressable>
            </View>
          ))}

          {allAccounts.length === 0 ? (
            <Body style={{ paddingVertical: spacing.md }}>
              No email accounts added. Add your email addresses below to organise and filter your checks.
            </Body>
          ) : null}

          {/* Add manual account */}
          <View style={{ gap: spacing.sm, paddingTop: spacing.lg }}>
            <Text style={s.inputLabel}>Add email account</Text>
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
            <Button
              testID="email-add-account"
              variant="secondary"
              icon={<Plus size={18} color={colors.brand} />}
              label="Add email account"
              onPress={() => void handleAddAccount()}
              disabled={!newAccountEmail.trim()}
            />
          </View>

          {/* Gmail connection controls */}
          {gmailConfigured ? (
            <View style={{ gap: spacing.sm, paddingTop: spacing.lg }}>
              <Text style={s.inputLabel}>Gmail integration</Text>
              {gmailConnected ? (
                <>
                  <Body>
                    {gmailAccounts.length} Gmail {gmailAccounts.length === 1 ? "account" : "accounts"} connected (read-only).
                  </Body>
                  <Button
                    testID="email-gmail-scan"
                    variant="secondary"
                    label={scanBusy ? "Scanning\u2026" : "Scan recent Gmail"}
                    icon={scanBusy ? <ActivityIndicator size="small" color={colors.brand} /> : undefined}
                    onPress={() => void scanInbox()}
                    disabled={scanBusy || gmailBusy}
                  />
                  <Button
                    testID="email-gmail-monitoring"
                    variant="ghost"
                    label={gmailMonitoring ? "Stop ongoing monitoring" : "Enable ongoing monitoring"}
                    onPress={() => void toggleGmailMonitoring()}
                    disabled={scanBusy || gmailBusy}
                  />
                  <Body style={{ fontSize: 13 }}>
                    {gmailMonitoring
                      ? "Ongoing monitoring is active. This checks for new emails periodically."
                      : "Ongoing monitoring is off. Use Scan to check manually."}
                  </Body>
                  <Button
                    testID="email-gmail-connect-another"
                    variant="ghost"
                    icon={gmailBusy ? <ActivityIndicator size="small" color={colors.brand} /> : <Mail size={16} color={colors.brand} />}
                    label={gmailBusy ? "Opening Google\u2026" : "Connect another Gmail"}
                    onPress={() => void connectGmail()}
                    disabled={gmailBusy}
                  />
                </>
              ) : (
                <>
                  <Body style={{ fontSize: 13 }}>
                    Connect Gmail for read-only access. Apollo never asks for or stores your Gmail password.
                  </Body>
                  <Button
                    testID="email-gmail-connect"
                    variant="secondary"
                    icon={gmailBusy ? <ActivityIndicator size="small" color={colors.brand} /> : <Mail size={18} color={colors.brand} />}
                    label={gmailBusy ? "Opening Google\u2026" : "Connect Gmail (read-only)"}
                    onPress={() => void connectGmail()}
                    disabled={gmailBusy || !deviceId}
                  />
                </>
              )}
            </View>
          ) : null}
        </ScrollView>
      </Sheet>

      {/* ── Privacy Sheet ── */}
      <Sheet visible={privacySheetOpen} onClose={() => setPrivacySheetOpen(false)} title="How Apollo processes your email" testID="email-privacy-sheet">
        <Body>When you check an email, Apollo analyses the text, sender details and embedded links you provide. The content is processed for this assessment only.</Body>
        <Body>Link reputation is checked against independent threat databases. These services receive only the URL, not your email content or personal details.</Body>
        <Body>When you share a screenshot, Apollo applies on-device privacy screening before any content is sent for analysis. Personal information identified during screening is redacted before external processing.</Body>
        <Body>Connected Gmail accounts use Google{"\u2019"}s read-only OAuth consent. Apollo reads incoming messages, assesses each once, then discards the raw content. Flagged emails remain in your Patrol history until you dismiss them.</Body>
        <Body>Apollo does not collect or store your email passwords. Credential handling uses platform-supported secure mechanisms only.</Body>
        <Button testID="email-privacy-close" variant="ghost" label="Done" onPress={() => setPrivacySheetOpen(false)} />
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
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setPickerAccount(null)}
                  style={[s.pickerTab, !pickerAccount && { backgroundColor: colors.brand }]}
                >
                  <Text style={[s.pickerTabText, !pickerAccount && { color: colors.onBrand }]}>All accounts</Text>
                </Pressable>
                {uniquePickerAccounts.map((acct) => (
                  <Pressable
                    key={acct}
                    accessibilityRole="button"
                    onPress={() => setPickerAccount(acct)}
                    style={[s.pickerTab, pickerAccount === acct && { backgroundColor: colors.brand }]}
                  >
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
                    <Pressable
                      accessibilityRole="button"
                      testID={`inbox-msg-${item.id}`}
                      onPress={() => void selectInboxEmail(item)}
                      disabled={!!pickerFetchBusy}
                      style={({ pressed }) => [s.pickerRow, { opacity: pressed ? 0.7 : 1 }]}
                    >
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
