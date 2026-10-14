// Check a Number — Approved screen implementation.
// Number-first, standalone phone investigation.
// Matches the approved mock-up exactly: header, phone card, three quick-entry
// controls, Investigate Number button, Higgins guidance panel, optional caller
// details, Recent Calls section.
import { useRouter } from "expo-router";
import ArrowLeft from "lucide-react-native/icons/arrow-left";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import ClipboardPaste from "lucide-react-native/icons/clipboard-paste";
import PenLine from "lucide-react-native/icons/pen-line";
import PhoneIcon from "lucide-react-native/icons/phone";
import PhoneMissed from "lucide-react-native/icons/phone-missed";
import Search from "lucide-react-native/icons/search";
import UserRound from "lucide-react-native/icons/user-round";
import CircleX from "lucide-react-native/icons/circle-x";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Image,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiPost } from "@/src/api/client";
import { CheckResultScreen } from "@/src/components/CheckResultScreen";
import { InfoButton } from "@/src/components/InfoButton";
import { CheckToolHeader } from "@/src/components/CheckToolHeader";
import { PhonePickerSheet } from "@/src/components/PhonePickerSheet";
import { PhonePickers } from "@/src/security/phonePickers";
import { Body, Button, Card } from "@/src/components/ui";
import { buildCallRiskCheckResult } from "@/src/domain/callRiskCheckResultAdapter";
import { issueContext, type HigginsIssueContext } from "@/src/domain/higginsHandoff";
import { CALL_ASKS, CALL_CLAIMS, type CallAsk, type CallClaim } from "@/src/domain/callAnalysis";
import { type CallRiskResult, useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";
import { recordCheck } from "@/src/store/checkHistoryStore";
import { saveCheck } from "@/src/store/savedCheckStore";

const higginsAvatar = require("@/assets/images/higgins-avatar.png");

// Reporting links for all jurisdictions
const REPORT_LINKS = {
  AU: [
    { label: "Report to Scamwatch (AU)", url: "https://www.scamwatch.gov.au/report-a-scam" },
    { label: "Report to ACMA (AU)", url: "https://www.donotcall.gov.au/consumers/consumer-complaint/" },
  ],
  UK: [
    { label: "Report to Action Fraud (UK)", url: "https://www.actionfraud.police.uk/reporting-fraud-and-cyber-crime" },
    { label: "Report to Ofcom (UK)", url: "https://www.ofcom.org.uk/phones-telecoms-and-internet/advice-for-consumers/scam-calls" },
  ],
  US: [
    { label: "Report fraud to FTC (US)", url: "https://reportfraud.ftc.gov" },
    { label: "File complaint with FCC (US)", url: "https://consumercomplaints.fcc.gov/hc/en-us" },
    { label: "Do Not Call Registry (US)", url: "https://www.donotcall.gov" },
  ],
};

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  // ── Header ──
  header: { paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.md },
  backBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTextWrap: { flex: 1 },
  headerTitle: { fontFamily: fonts.displayBold, fontSize: 24, color: c.onSurface },
  headerSub: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary, marginTop: 2 },
  infoBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  // ── Scroll content ──
  scrollContent: { paddingHorizontal: spacing.lg, gap: spacing.lg },
  // ── Phone number card ──
  phoneCard: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, borderWidth: 1, borderColor: c.border },
  phoneLabel: { fontFamily: fonts.textSemibold, fontSize: 12, letterSpacing: 1, color: c.muted, textTransform: "uppercase" },
  phoneInputRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  phoneIconWell: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  phoneInput: { flex: 1, fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface, padding: 0, minHeight: 44 },
  clearBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  // ── Device-first primary picker ──
  devicePickerBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: c.brandPrimary, borderRadius: radius.lg, paddingVertical: 18, paddingHorizontal: spacing.xl, gap: spacing.md, minHeight: 60 },
  devicePickerText: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onBrandPrimary, flex: 1, textAlign: "center" },
  devicePickerChevron: { position: "absolute" as const, right: spacing.lg },
  orDivider: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  orLine: { flex: 1, height: 1, backgroundColor: c.border },
  orText: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.muted },
  // ── Quick entry controls ──
  quickRow: { flexDirection: "row", gap: spacing.sm },
  quickBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: c.surfaceTertiary, minHeight: 40 },
  quickText: { fontFamily: fonts.textMedium, fontSize: 13, color: c.onSurface },
  // ── Primary CTA ──
  ctaBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: c.brandPrimary, borderRadius: radius.lg, paddingVertical: 16, paddingHorizontal: spacing.xl, gap: spacing.sm, minHeight: 56 },
  ctaBtnDisabled: { opacity: 0.5 },
  ctaText: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onBrandPrimary, flex: 1, textAlign: "center" },
  ctaChevron: { position: "absolute", right: spacing.lg },
  guidanceText: { fontFamily: fonts.text, fontSize: 14, color: c.muted, textAlign: "center" },
  // ── Higgins panel ──
  higginsCard: { flexDirection: "row", backgroundColor: c.surfaceTertiary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, alignItems: "flex-start" },
  higginsAvatarWrap: { width: 64, height: 64, borderRadius: 32, overflow: "hidden", flexShrink: 0 },
  higginsImg: { width: 64, height: 64 },
  higginsBubble: { flex: 1, gap: 4 },
  higginsLabel: { fontFamily: fonts.displayBold, fontSize: 15, color: c.brand },
  higginsText: { fontFamily: fonts.text, fontSize: 14, lineHeight: 21, color: c.onSurface },
  // ── Optional details ──
  spokeToggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, borderWidth: 1, borderColor: c.border },
  spokeToggleLeft: { flex: 1, gap: 2 },
  spokeTitle: { fontFamily: fonts.displayBold, fontSize: 16, color: c.onSurface },
  spokeSub: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  detailsCard: { gap: spacing.md },
  q: { fontFamily: fonts.displayBold, fontSize: 15, color: c.onSurface },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, minHeight: 40, backgroundColor: c.surfaceSecondary },
  chipOn: { borderColor: c.brandPrimary, backgroundColor: c.restingTint },
  chipText: { fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurface },
  descInput: { minHeight: 80, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontFamily: fonts.text, fontSize: 15, color: c.onSurface, textAlignVertical: "top" },
  // ── Recent Calls ──
  recentHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  recentTitle: { fontFamily: fonts.textSemibold, fontSize: 12, letterSpacing: 1, color: c.muted, textTransform: "uppercase" },
  seeAll: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.brand },
  recentCard: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, overflow: "hidden", borderWidth: 1, borderColor: c.border },
  callRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.md, paddingHorizontal: spacing.lg, gap: spacing.md, borderBottomWidth: 1, borderBottomColor: c.border },
  callRowLast: { borderBottomWidth: 0 },
  callIconWell: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  callMissedWell: { backgroundColor: "rgba(217,83,79,0.12)" },
  callNormalWell: { backgroundColor: c.surfaceTertiary },
  callInfo: { flex: 1, gap: 2 },
  callNumber: { fontFamily: fonts.displayBold, fontSize: 15, color: c.onSurface },
  callMeta: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  callMissed: { fontFamily: fonts.textSemibold, fontSize: 12, color: c.error },
  checkBtn: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: c.surfaceTertiary, minHeight: 36 },
  checkBtnText: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.onSurface },
  // ── Error card ──
  errorCard: { backgroundColor: "rgba(217,83,79,0.08)", borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: "rgba(217,83,79,0.2)" },
  errorText: { fontFamily: fonts.text, fontSize: 14, color: c.onSurface },
  // ── Progress ──
  progressWrap: { alignItems: "center", gap: spacing.md, paddingVertical: spacing.xl },
  progressLabel: { fontFamily: fonts.textSemibold, fontSize: 16, color: c.onSurface },
  progressSub: { fontFamily: fonts.text, fontSize: 13, color: c.muted, textAlign: "center" },
}));

export default function CheckNumber() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { checkNumberRisk, showToast, deviceId } = useApollo();
  const inputRef = useRef<TextInput>(null);

  // ── State ──
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [investigationBusy, setInvestigationBusy] = useState(false);
  const [result, setResult] = useState<CallRiskResult | null>(null);
  const [investigationResult, setInvestigationResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Optional details (collapsed by default)
  const [spokeOpen, setSpokeOpen] = useState(false);
  const [asks, setAsks] = useState<CallAsk[]>([]);
  const [claim, setClaim] = useState<CallClaim>("unknown");
  const [transcript, setTranscript] = useState("");

  // Phone picker
  const [callerPickerOpen, setCallerPickerOpen] = useState(false);
  const canPickPhone = PhonePickers.isSupported();

  // Recent calls from call log (Android native)
  const [recentCalls, setRecentCalls] = useState<{ number: string; name: string | null; date: number; type: string }[]>([]);
  const loadRecentCalls = useCallback(async () => {
    if (!PhonePickers.isSupported()) return;
    try {
      const perm = await PhonePickers.hasPermission("call_log");
      if (perm.granted) {
        const calls = await PhonePickers.listRecentCalls();
        setRecentCalls(calls.slice(0, 10));
      }
    } catch { /* silently degrade */ }
  }, []);

  useEffect(() => { void loadRecentCalls(); }, [loadRecentCalls]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") void loadRecentCalls(); });
    return () => sub.remove();
  }, [loadRecentCalls]);

  const toggleAsk = (id: CallAsk) => setAsks((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : id === "nothing" ? ["nothing"] : [...cur.filter((x) => x !== "nothing"), id]);

  // ── Quick entry actions ──
  const handleFromRecentCalls = () => {
    if (canPickPhone) {
      setCallerPickerOpen(true);
    } else {
      showToast(Platform.OS === "ios"
        ? "Recent call access is not available on iOS. Enter the number manually or paste it."
        : "Recent call access requires a native build with call-log permission.", "neutral");
    }
  };

  const handleEnterNumber = () => {
    inputRef.current?.focus();
  };

  const handlePasteNumber = async () => {
    try {
      const text = (await Clipboard.getStringAsync()).trim();
      // Extract something that looks like a phone number
      const match = text.match(/[\d\s()+\-]{7,}/);
      if (match) {
        setNumber(match[0].trim());
        showToast("Number pasted.", "neutral");
      } else if (text) {
        showToast("The clipboard doesn't contain a usable phone number.", "neutral");
      } else {
        showToast("Nothing on the clipboard.", "neutral");
      }
    } catch {
      showToast("Could not read the clipboard.", "neutral");
    }
  };

  // ── Primary investigation action ──
  const runInvestigation = async () => {
    if (!number.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setInvestigationResult(null);
    try {
      // Step 1: Quick IPQS reputation check
      const riskResult = await checkNumberRisk(number.trim());
      setResult(riskResult);
      void recordCheck("call", {
        at: new Date().toISOString(),
        state: riskResult.decision === "avoid" ? "barking" : riskResult.decision === "review" ? "growling" : "resting",
        summary: riskResult.higgins?.headline ?? riskResult.number,
      });

      // Step 2: Full Higgins investigation (Gemini-powered)
      setInvestigationBusy(true);
      try {
        const body: Record<string, unknown> = { device_id: deviceId ?? "local", number: number.trim() };
        if (asks.length > 0 && !asks.includes("nothing")) body.caller_asks = asks;
        if (claim !== "unknown") body.caller_claim = claim;
        if (transcript.trim()) body.transcript = transcript.trim();
        const inv = await apiPost<Record<string, unknown>>("/call/investigate", "call_investigate", body);
        setInvestigationResult(inv);
      } catch {
        // Investigation failed but reputation data preserved
        console.warn("Higgins investigation unavailable — reputation result preserved");
      } finally {
        setInvestigationBusy(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not check this number. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const retryInvestigation = async () => {
    if (!number.trim() || !deviceId) return;
    setInvestigationBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { device_id: deviceId, number: number.trim() };
      if (asks.length > 0 && !asks.includes("nothing")) body.caller_asks = asks;
      if (claim !== "unknown") body.caller_claim = claim;
      if (transcript.trim()) body.transcript = transcript.trim();
      const inv = await apiPost<Record<string, unknown>>("/call/investigate", "call_investigate", body);
      setInvestigationResult(inv);
    } catch {
      showToast("Investigation retry failed. Try again shortly.", "growling");
    } finally {
      setInvestigationBusy(false);
    }
  };

  const resetCheck = () => {
    setResult(null);
    setInvestigationResult(null);
    setNumber("");
    setSaved(false);
    setError(null);
    setAsks([]);
    setClaim("unknown");
    setTranscript("");
    setSpokeOpen(false);
  };

  const checkRecentNumber = (num: string) => {
    setNumber(num);
    // Auto-start investigation
    setTimeout(() => {
      setBusy(true);
      setError(null);
      setResult(null);
      setInvestigationResult(null);
      void (async () => {
        try {
          const riskResult = await checkNumberRisk(num.trim());
          setResult(riskResult);
          void recordCheck("call", { at: new Date().toISOString(), state: riskResult.decision === "avoid" ? "barking" : riskResult.decision === "review" ? "growling" : "resting", summary: riskResult.higgins?.headline ?? riskResult.number });
          setInvestigationBusy(true);
          try {
            const inv = await apiPost<Record<string, unknown>>("/call/investigate", "call_investigate", { device_id: deviceId ?? "local", number: num.trim() });
            setInvestigationResult(inv);
          } catch { /* preserved */ }
          finally { setInvestigationBusy(false); }
        } catch (e) { setError(e instanceof Error ? e.message : "Could not check this number."); }
        finally { setBusy(false); }
      })();
    }, 100);
  };

  // ── RESULT VIEW ──
  if (result) {
    const model = buildCallRiskCheckResult({ result });
    const allReportLinks = [...REPORT_LINKS.AU, ...REPORT_LINKS.UK, ...REPORT_LINKS.US];
    const inv = investigationResult as Record<string, unknown> | null;
    const higginsData = inv?.higgins as Record<string, string | string[]> | undefined;
    const enhancedModel = inv && higginsData?.exact_response ? {
      ...model,
      headline: (higginsData.headline as string) || model.headline,
      higginsSays: (higginsData.exact_response as string) || model.higginsSays,
      whatToDo: (higginsData.next_action as string) || model.whatToDo,
      whatToDoLinks: (result.decision === "avoid" || result.decision === "review") ? allReportLinks : model.whatToDoLinks,
    } : {
      ...model,
      whatToDoLinks: (result.decision === "avoid" || result.decision === "review") ? allReportLinks : model.whatToDoLinks,
    };

    const askPrompt = `About the number I just checked: ${result.number}. ${enhancedModel.headline} Can you walk me through what Apollo found and what I should do?`;
    const callActions: { label: string; onPress: () => void; testID: string; variant?: "primary" | "secondary" | "ghost" }[] = [];

    if (investigationBusy) {
      callActions.push({ testID: "callguard-investigating", variant: "ghost", label: "Higgins is investigating…", onPress: () => {} });
    } else if (!investigationResult || !(higginsData?.exact_response)) {
      callActions.push({ testID: "callguard-retry-investigation", variant: "secondary", label: "Retry Higgins investigation", onPress: () => void retryInvestigation() });
    }

    callActions.push({
      testID: "callguard-save", variant: "ghost",
      label: saved ? "Saved \u2713 \u2014 View saved checks" : "Save this check",
      onPress: () => {
        if (saved) { router.push("/saved-checks"); return; }
        void saveCheck({
          id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
          gate: "call", title: enhancedModel.headline, subject: result.number,
          state: result.decision === "avoid" ? "barking" : result.decision === "review" ? "growling" : "resting",
          stateName: result.decision === "avoid" ? "High risk" : result.decision === "review" ? "Some risk" : "No strong signal",
          summary: enhancedModel.higginsSays,
          recommendation: enhancedModel.whatToDo ?? "",
          sections: [{ title: "Details", lines: [`Fraud score: ${result.fraud_score ?? "N/A"}`, `Line type: ${result.line_type ?? "Unknown"}`, `Carrier: ${result.carrier ?? "Unknown"}`, `VOIP: ${result.voip ? "Yes" : "No"}`] }],
        }).then(() => { setSaved(true); showToast("Saved. Find it under Saved checks.", "neutral"); });
      },
    });
    callActions.push({ testID: "callguard-again", variant: "ghost", label: "Check another number", onPress: resetCheck });

    const callInvContext: HigginsIssueContext = issueContext({
      gate: "call",
      issue_summary: `Phone number check: ${result.number}. ${enhancedModel.headline}`,
      assessment_state: result.decision === "avoid" ? "barking" : result.decision === "review" ? "growling" : "resting",
      findings: [
        { summary: enhancedModel.higginsSays, provenance: "observed", status: result.decision === "avoid" ? "warning" : "uncertain" },
        ...(result.fraud_score != null ? [{ summary: `Fraud score: ${result.fraud_score}`, provenance: "observed" as const, status: "uncertain" as const }] : []),
        ...(result.line_type ? [{ summary: `Line type: ${result.line_type}`, provenance: "observed" as const, status: "confirmed" as const }] : []),
      ],
      uncertainty: result.decision === "allow"
        ? ["No strong risk signal does not confirm the caller is safe. Reputation data is supporting evidence only."]
        : result.decision === "unknown"
          ? ["Apollo could not obtain reputation information for this number. This does not mean the number is safe or dangerous."]
          : [],
      confirmed_protective_actions: [],
      user_reported_actions: [],
      original_evidence: [{ kind: "text" as const, value: `Phone number: ${result.number}`, label: "checked number" }],
    });

    return (
      <CheckResultScreen
        result={enhancedModel}
        investigationContext={callInvContext}
        investigationQuestion={askPrompt}
        submissionId={`callguard-${result.number}-${Date.now().toString(36)}`}
        eventId={null}
        actions={callActions}
      />
    );
  }

  // ── Investigating progress view ──
  if (busy) {
    return (
      <View style={s.root}>
        <View style={[s.header, { paddingTop: insets.top + spacing.md }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => { setBusy(false); setError(null); }} style={s.backBtn}><ArrowLeft size={22} color={colors.onSurface} /></Pressable>
          <View style={s.headerTextWrap}><Text style={s.headerTitle}>Investigating…</Text></View>
        </View>
        <View style={s.progressWrap}>
          <ActivityIndicator size="large" color={colors.brand} />
          <Text style={s.progressLabel}>Checking {number}</Text>
          <Text style={s.progressSub}>Looking up reputation data and running Higgins analysis. This usually takes a few seconds.</Text>
        </View>
      </View>
    );
  }

  // ── MAIN INPUT VIEW ──
  const hasValidNumber = number.replace(/[\s\-()]/g, "").length >= 7;

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + spacing.md }]}>
        <CheckToolHeader
          title="Check a number"
          info={{ title: "About number checking", body: [
            "Apollo investigates phone numbers using reputation data, fraud databases, line-type intelligence and Higgins analysis.",
            "This works without answering the call — check before you call back.",
            "Reputation data indicates risk but cannot authenticate who is actually calling. Caller ID can be spoofed.",
            "On Android, Apollo can access recent calls with your permission. On iOS, call-log access is not available — enter or paste the number instead.",
          ] }}
          testID="callguard"
        />
      </View>

      <KeyboardAwareScrollView
        testID="callguard-scroll"
        contentContainerStyle={[s.scrollContent, { paddingTop: spacing.lg, paddingBottom: insets.bottom + 100 }]}
        bottomOffset={24}
      >
        {/* ── Device-First: Select from recent calls ── */}
        <Pressable
          testID="callguard-from-recent"
          accessibilityRole="button"
          accessibilityLabel="Select from recent calls"
          onPress={handleFromRecentCalls}
          style={({ pressed }) => [s.devicePickerBtn, { opacity: pressed ? 0.85 : 1 }]}
        >
          <UserRound size={22} color={colors.onBrandPrimary} />
          <Text style={s.devicePickerText}>Select from recent calls</Text>
          <View style={s.devicePickerChevron}><ChevronRight size={20} color={colors.onBrandPrimary} /></View>
        </Pressable>

        {/* ── Or divider ── */}
        <View style={s.orDivider}>
          <View style={s.orLine} />
          <Text style={s.orText}>or enter manually</Text>
          <View style={s.orLine} />
        </View>

        {/* ── Phone Number Card ── */}
        <View style={s.phoneCard} testID="callguard-number-card">
          <Text style={s.phoneLabel}>Phone Number</Text>
          <View style={s.phoneInputRow}>
            <View style={s.phoneIconWell}>
              <PhoneIcon size={18} color={colors.brand} />
            </View>
            <TextInput
              ref={inputRef}
              testID="callguard-number"
              style={s.phoneInput}
              value={number}
              onChangeText={setNumber}
              placeholder="0468 133 426"
              placeholderTextColor={colors.muted}
              keyboardType="phone-pad"
              returnKeyType="done"
              accessibilityLabel="Phone number"
            />
            {number.length > 0 ? (
              <Pressable testID="callguard-clear" accessibilityRole="button" accessibilityLabel="Clear number" onPress={() => setNumber("")} style={s.clearBtn}>
                <CircleX size={20} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* ── Quick entry controls ── */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.quickRow}>
          <Pressable testID="callguard-enter" accessibilityRole="button" onPress={handleEnterNumber} style={({ pressed }) => [s.quickBtn, { opacity: pressed ? 0.7 : 1 }]}>
            <PenLine size={16} color={colors.onSurface} />
            <Text style={s.quickText}>Enter number</Text>
          </Pressable>
          <Pressable testID="callguard-paste" accessibilityRole="button" onPress={() => void handlePasteNumber()} style={({ pressed }) => [s.quickBtn, { opacity: pressed ? 0.7 : 1 }]}>
            <ClipboardPaste size={16} color={colors.onSurface} />
            <Text style={s.quickText}>Paste number</Text>
          </Pressable>
        </ScrollView>

        {/* ── Primary CTA: Investigate Number ── */}
        <Pressable
          testID="callguard-investigate"
          accessibilityRole="button"
          accessibilityLabel="Investigate Number"
          disabled={!hasValidNumber}
          onPress={() => void runInvestigation()}
          style={({ pressed }) => [s.ctaBtn, !hasValidNumber && s.ctaBtnDisabled, { opacity: pressed && hasValidNumber ? 0.85 : 1 }]}
        >
          <Search size={20} color={colors.onBrandPrimary} />
          <Text style={s.ctaText}>Investigate Number</Text>
          <View style={s.ctaChevron}><ChevronRight size={20} color={colors.onBrandPrimary} /></View>
        </Pressable>

        <Text style={s.guidanceText}>No need to answer the call or describe the conversation.</Text>

        {/* ── Error ── */}
        {error ? (
          <View style={s.errorCard} testID="callguard-error">
            <Text style={s.errorText}>{error}</Text>
            <Button testID="callguard-retry" variant="secondary" label="Try again" onPress={() => void runInvestigation()} />
          </View>
        ) : null}

        {/* ── Higgins guidance panel ── */}
        <View style={s.higginsCard} testID="callguard-higgins">
          <View style={s.higginsAvatarWrap}>
            <Image source={higginsAvatar} style={s.higginsImg} resizeMode="cover" />
          </View>
          <View style={s.higginsBubble}>
            <Text style={s.higginsLabel}>Higgins says:</Text>
            <Text style={s.higginsText}>
              I&apos;ll check what I can find about this number using trusted sources. This usually takes a few seconds.
            </Text>
          </View>
        </View>

        {/* ── Spoke to the caller? (optional, collapsed) ── */}
        <Pressable testID="callguard-spoke-toggle" accessibilityRole="button" onPress={() => setSpokeOpen(!spokeOpen)} style={s.spokeToggle}>
          <View style={s.spokeToggleLeft}>
            <Text style={s.spokeTitle}>Spoke to the caller?</Text>
            <Text style={s.spokeSub}>Optional details may help Apollo investigate further.</Text>
          </View>
          {spokeOpen ? <ChevronUp size={22} color={colors.muted} /> : <ChevronDown size={22} color={colors.muted} />}
        </Pressable>

        {spokeOpen ? (
          <Card style={s.detailsCard} testID="callguard-details-card">
            <Text style={s.q}>What did they ask you to do?</Text>
            <View style={s.grid}>
              {CALL_ASKS.map((o) => (
                <Pressable key={o.id} testID={`callguard-ask-${o.id}`} accessibilityRole="button" accessibilityState={{ selected: asks.includes(o.id) }} onPress={() => toggleAsk(o.id)} style={[s.chip, asks.includes(o.id) && s.chipOn]}>
                  <Text style={s.chipText}>{o.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={s.q}>Who did they claim to be?</Text>
            <View style={s.grid}>
              {CALL_CLAIMS.map((o) => (
                <Pressable key={o.id} testID={`callguard-claim-${o.id}`} accessibilityRole="button" accessibilityState={{ selected: claim === o.id }} onPress={() => setClaim(o.id)} style={[s.chip, claim === o.id && s.chipOn]}>
                  <Text style={s.chipText}>{o.label}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput testID="callguard-transcript" style={s.descInput} value={transcript} onChangeText={setTranscript} placeholder="Describe what the caller said (optional)" placeholderTextColor={colors.muted} multiline />
          </Card>
        ) : null}

        {/* ── Recent Calls ── */}
        <View style={s.recentHeader}>
          <Text style={s.recentTitle}>Recent Calls</Text>
          {recentCalls.length > 3 ? (
            <Pressable accessibilityRole="button" onPress={handleFromRecentCalls}>
              <Text style={s.seeAll}>See all  ›</Text>
            </Pressable>
          ) : null}
        </View>

        {recentCalls.length > 0 ? (
          <View style={s.recentCard} testID="callguard-recent-calls">
            {recentCalls.slice(0, 5).map((call, i) => {
              const isMissed = call.type === "missed" || call.type === "MISSED";
              const dateStr = call.date ? new Date(call.date).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
              return (
                <View key={`${call.number}-${call.date}`} style={[s.callRow, i === Math.min(4, recentCalls.length - 1) ? s.callRowLast : undefined]}>
                  <View style={[s.callIconWell, isMissed ? s.callMissedWell : s.callNormalWell]}>
                    {isMissed ? <PhoneMissed size={20} color={colors.error} /> : <PhoneIcon size={20} color={colors.muted} />}
                  </View>
                  <View style={s.callInfo}>
                    <Text style={s.callNumber}>{call.name || call.number}</Text>
                    <Text style={s.callMeta}>{dateStr}</Text>
                    {isMissed ? <Text style={s.callMissed}>Missed call</Text> : null}
                  </View>
                  <Pressable accessibilityRole="button" testID={`callguard-check-${i}`} onPress={() => checkRecentNumber(call.number)} style={({ pressed }) => [s.checkBtn, { opacity: pressed ? 0.7 : 1 }]}>
                    <Text style={s.checkBtnText}>Check with Apollo</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        ) : (
          <View style={[s.recentCard, { padding: spacing.lg, alignItems: "center", gap: spacing.sm }]} testID="callguard-recent-empty">
            <PhoneIcon size={24} color={colors.muted} />
            <Body>
              {Platform.OS === "android"
                ? "Recent calls will appear here when call-log permission is granted."
                : "Recent calls are not available on this platform. Enter or paste the number above."}
            </Body>
          </View>
        )}
      </KeyboardAwareScrollView>

      <PhonePickerSheet visible={callerPickerOpen} mode="calls" onClose={() => setCallerPickerOpen(false)} onPickCall={(c) => { setNumber(c.number); setCallerPickerOpen(false); }} />
    </View>
  );
}
