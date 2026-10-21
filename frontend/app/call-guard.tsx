// Check a Number — Approved screen implementation.
// Matches the approved mock-up exactly: header, description, phone card,
// gold Check number CTA, "or" divider, recent calls section.
//
// One number → one reputation check → at most ONE Magnum DI investigation. Apollo's own Triage
// decides whether to open one (see checkNumberRisk); this screen FOLLOWS that case through the
// shared InvestigationFlow instead of starting a second investigation of its own.
import { useRouter } from "expo-router";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import CircleAlert from "lucide-react-native/icons/circle-alert";
import CircleX from "lucide-react-native/icons/circle-x";
import Clock from "lucide-react-native/icons/clock";
import PhoneIcon from "lucide-react-native/icons/phone";
import Search from "lucide-react-native/icons/search";
import User from "lucide-react-native/icons/user";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { InvestigationCheckScreen } from "@/src/components/InvestigationCheckScreen";
import { CallScreenerCard } from "@/src/components/CallScreenerCard";
import { CheckToolHeader } from "@/src/components/CheckToolHeader";
import { CheckingModal } from "@/src/components/CheckingModal";
import { PhonePickerSheet } from "@/src/components/PhonePickerSheet";
import { PhonePickers } from "@/src/security/phonePickers";
import { Body, Button } from "@/src/components/ui";
import { buildCallRiskCheckResult } from "@/src/domain/callRiskCheckResultAdapter";
import { issueContext, type HigginsIssueContext } from "@/src/domain/higginsHandoff";
import { SourceHero } from "@/src/components/SourceHero";
import { SourcePickerSheet } from "@/src/components/SourcePickerSheet";
import { PREVIEW_SIMULATION } from "@/src/components/SimulatedPicker";
import { SIMULATED_CALLS } from "@/src/preview/samples";
import { type CallRiskResult, useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { recordCheck } from "@/src/store/checkHistoryStore";
import { saveCheck } from "@/src/store/savedCheckStore";

// ── Magnum DI investigation ──────────────────────────────────────────────────
// The investigation itself is owned by `InvestigationFlow`, which attaches to the case Apollo's
// Triage opened for this number. This screen only needs to know whether such a case exists.

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

  // ── Scroll content ──
  scrollContent: { paddingHorizontal: spacing.lg, gap: spacing.lg },

  // ── Description ──
  description: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurfaceSecondary },

  // ── Phone number card ──
  phoneCard: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, borderWidth: 0.25, borderColor: c.border },
  phoneCardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  phoneIconWell: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#DBEAFE", alignItems: "center", justifyContent: "center" },
  phoneCardLabel: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface },
  phoneInput: { minHeight: 48, backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, fontFamily: fonts.text, fontSize: 16, color: c.onSurface },
  clearBtn: { position: "absolute" as const, right: spacing.md, top: 0, bottom: 0, justifyContent: "center", width: 36 },

  // ── Gold CTA ──
  goldBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: c.gold, borderRadius: radius.lg, paddingVertical: 16, paddingHorizontal: spacing.xl, gap: spacing.md, minHeight: 56 },
  goldBtnDisabled: { opacity: 0.45 },
  goldBtnText: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface },

  // ── Or divider (removed) ──

  // ── Recent calls dropdown ──
  recentDropdown: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, borderWidth: 0.25, borderColor: c.border, overflow: "hidden" as const },
  recentDropdownToggle: { flexDirection: "row" as const, alignItems: "center" as const, gap: spacing.md, padding: spacing.lg },
  recentDropdownIconWell: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.surfaceTertiary, alignItems: "center" as const, justifyContent: "center" as const },
  recentDropdownTitle: { fontFamily: fonts.displayBold, fontSize: 15, color: c.onSurface, flex: 1 },
  recentDropdownSub: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceSecondary, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },

  // ── Recent calls section ──
  recentSection: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, borderWidth: 0.25, borderColor: c.border, overflow: "hidden" },
  recentHeader: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md, gap: 4 },
  recentHeaderTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  recentTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  recentClockWell: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  recentTitle: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface },
  seeAllRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  seeAllText: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.brand },
  recentSub: { fontFamily: fonts.text, fontSize: 14, color: c.onSurfaceSecondary, marginLeft: 48 },

  // ── Call row ──
  callRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.md, paddingHorizontal: spacing.lg, gap: spacing.md, borderTopWidth: 1, borderTopColor: c.border },
  callIconWell: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  callAlertWell: { backgroundColor: "rgba(217,83,79,0.12)" },
  callContactWell: { backgroundColor: "rgba(76,175,80,0.12)" },
  callUnknownWell: { backgroundColor: c.surfaceTertiary },
  callInfo: { flex: 1, gap: 2 },
  callNumber: { fontFamily: fonts.displayBold, fontSize: 16, color: c.onSurface },
  callDesc: { fontFamily: fonts.text, fontSize: 14, color: c.onSurfaceSecondary },
  callDateCol: { alignItems: "flex-end", gap: 2, flexShrink: 0 },
  callDate: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  callTime: { fontFamily: fonts.text, fontSize: 13, color: c.muted },

  // ── Empty recent ──
  recentEmpty: { padding: spacing.xl, alignItems: "center", gap: spacing.sm },

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
  const { checkNumberRisk, showToast } = useApollo();
  const inputRef = useRef<TextInput>(null);

  // ── State ──
  const [numberState, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CallRiskResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Phone picker
  const [callerPickerOpen, setCallerPickerOpen] = useState(false);
  const [callSourcePicker, setCallSourcePicker] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
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

  // ── Open the full recent-calls picker ──
  const handleSeeAll = () => {
    if (canPickPhone) {
      setCallerPickerOpen(true);
    } else {
      showToast(Platform.OS === "ios"
        ? "Recent call access is not available on iOS. Enter the number manually or paste it."
        : "Recent call access requires a native build with call-log permission.", "neutral");
    }
  };

  // ── Primary investigation action ──
  // `pickedNumber` lets a simulated selection be checked immediately. Everything below is the same
  // real flow a typed number runs: real reputation check, then the real Magnum DI investigation only
  // where that escalates.
  const runInvestigation = async (pickedNumber?: string) => {
    const number = pickedNumber ?? numberState;
    if (pickedNumber) setNumber(pickedNumber);
    if (!number.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // The reputation check. `deliberate` marks it as a check the person asked for, so Triage can
      // escalate a number Apollo cannot settle from its own sources to a Magnum DI investigation.
      // Where it does, the case id comes back on the result and the shared InvestigationFlow below
      // FOLLOWS that case — this screen never opens a second investigation of the same number.
      const riskResult = await checkNumberRisk(number.trim(), undefined, { deliberate: true });
      setResult(riskResult);
      void recordCheck("call", {
        at: new Date().toISOString(),
        state: riskResult.decision === "avoid" ? "barking" : riskResult.decision === "review" ? "growling" : "resting",
        summary: riskResult.higgins?.headline ?? riskResult.number,
      });
      setBusy(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not check this number. Please try again.");
      setBusy(false);
    }
  };

  const resetCheck = () => {
    setResult(null);
    setNumber("");
    setSaved(false);
    setError(null);
  };


  // ── RESULT VIEW ──
  if (result) {
    const allReportLinks = [...REPORT_LINKS.AU, ...REPORT_LINKS.UK, ...REPORT_LINKS.US];
    const model = buildCallRiskCheckResult({ result });
    const enhancedModel = {
      ...model,
      whatToDoLinks: (result.decision === "avoid" || result.decision === "review") ? allReportLinks : model.whatToDoLinks,
    };

    const askPrompt = `About the number I just checked: ${result.number}. ${enhancedModel.headline} Can you walk me through what Apollo found and what I should do?`;
    const callActions: { label: string; onPress: () => void; testID: string; variant?: "primary" | "secondary" | "ghost" }[] = [];

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
      <InvestigationCheckScreen
        result={enhancedModel}
        investigationContext={callInvContext}
        investigationQuestion={askPrompt}
        submissionId={`callguard-${result.number.replace(/[^A-Za-z0-9._:-]/g, "")}-${Date.now().toString(36)}`}
        eventId={null}
        caseId={result.investigation_case_id ?? null}
        actions={callActions}
      />
    );
  }

  // ── Investigating progress view → now handled by CheckingModal ──
  // (removed full-screen view in favour of modal popup)

  // ── MAIN INPUT VIEW ──
  const hasValidNumber = numberState.replace(/[\s\-()]/g, "").length >= 7;

  // Helper: format date for recent call rows
  const formatCallDate = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();
    const datePart = isToday ? "Today" : isYesterday ? "Yesterday" : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
    const timePart = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", hour12: true });
    return { datePart, timePart };
  };

  // Helper: determine icon style for a call entry
  const callIcon = (call: { name: string | null; type: string }) => {
    const isMissed = call.type === "missed" || call.type === "MISSED";
    const isSpam = call.type === "blocked" || call.type === "BLOCKED";
    if (isMissed || isSpam) return "alert" as const;
    if (call.name) return "contact" as const;
    return "unknown" as const;
  };

  // Helper: description text for a call entry
  const callDescription = (call: { name: string | null; type: string }) => {
    const isMissed = call.type === "missed" || call.type === "MISSED";
    const isSpam = call.type === "blocked" || call.type === "BLOCKED";
    if (isSpam) return "Possible spam";
    if (call.name) return "Saved contact";
    if (isMissed) return "Missed call";
    return "Unknown number";
  };

  return (
    <View style={s.root}>
      {/* ── Header ── */}
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
        contentContainerStyle={[s.scrollContent, { paddingTop: spacing.md, paddingBottom: insets.bottom + 100 }]}
        bottomOffset={24}
      >
        <SourceHero
          testID="callguard-hero"
          title="Pick a number from your recent calls"
          caption="Apollo checks the number's reputation, line type and fraud history — without you having to call back."
          actions={[{
            testID: "callguard-pick-caller",
            label: busy ? "Checking…" : "Choose a recent caller",
            disabled: busy,
            icon: <Clock size={20} color={colors.onBrandPrimary} />,
            onPress: () => { if (canPickPhone) { setCallerPickerOpen(true); return; } setCallSourcePicker(true); },
          }]}
        />

        {/* ── Recent Calls Dropdown (above phone input) ── */}
        <View style={s.recentDropdown} testID="callguard-recent-section">
          <Pressable
            accessibilityRole="button"
            onPress={() => setRecentOpen((v) => !v)}
            style={s.recentDropdownToggle}
            testID="callguard-recent-toggle"
          >
            <View style={s.recentDropdownIconWell}>
              <Clock size={18} color={colors.onSurface} />
            </View>
            <Text style={s.recentDropdownTitle}>Select from recent calls</Text>
            {recentOpen ? <ChevronUp size={18} color={colors.muted} /> : <ChevronDown size={18} color={colors.muted} />}
          </Pressable>

          {recentOpen ? <>
            <Text style={s.recentDropdownSub}>Tap a number to check it with Apollo.</Text>

            {recentCalls.length > 0 ? (
              recentCalls.slice(0, 5).map((call) => {
                const icon = callIcon(call);
                const desc = callDescription(call);
                const { datePart, timePart } = call.date ? formatCallDate(call.date) : { datePart: "", timePart: "" };
                return (
                  <Pressable
                    key={`${call.number}-${call.date}`}
                    testID={`callguard-recent-${call.number}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Check ${call.name || call.number}`}
                    onPress={() => { setNumber(call.number); setRecentOpen(false); }}
                    style={({ pressed }) => [s.callRow, { opacity: pressed ? 0.7 : 1 }]}
                  >
                    <View style={[s.callIconWell, icon === "alert" ? s.callAlertWell : icon === "contact" ? s.callContactWell : s.callUnknownWell]}>
                      {icon === "alert" ? <CircleAlert size={22} color={colors.error} /> : icon === "contact" ? <PhoneIcon size={20} color="#4CAF50" /> : <User size={22} color={colors.muted} />}
                    </View>
                    <View style={s.callInfo}>
                      <Text style={s.callNumber}>{call.number}</Text>
                      <Text style={s.callDesc}>{call.name || desc}</Text>
                    </View>
                    <View style={s.callDateCol}>
                      <Text style={s.callDate}>{datePart}</Text>
                      <Text style={s.callTime}>{timePart}</Text>
                    </View>
                    <ChevronRight size={18} color={colors.muted} />
                  </Pressable>
                );
              })
            ) : (
              <View style={s.recentEmpty}>
                <PhoneIcon size={28} color={colors.muted} />
                <Body>
                  {Platform.OS === "android"
                    ? "Recent calls will appear here when call-log permission is granted."
                    : "Recent calls are not available on this platform. Enter or paste the number below."}
                </Body>
              </View>
            )}

            {recentCalls.length > 5 ? (
              <Pressable accessibilityRole="button" onPress={handleSeeAll} style={[s.callRow, { justifyContent: "center" }]} hitSlop={8}>
                <Text style={s.seeAllText}>See all</Text>
                <ChevronRight size={16} color={colors.brand} />
              </Pressable>
            ) : null}
          </> : null}
        </View>

        {/* ── Phone Number Card ── */}
        <View style={s.phoneCard} testID="callguard-number-card">
          <View style={s.phoneCardHeader}>
            <View style={s.phoneIconWell}>
              <PhoneIcon size={22} color="#1D4ED8" />
            </View>
            <Text style={s.phoneCardLabel}>Phone number</Text>
          </View>
          <View>
            <TextInput
              ref={inputRef}
              testID="callguard-number"
              style={s.phoneInput}
              value={numberState}
              onChangeText={setNumber}
              placeholder="Enter or paste a phone number"
              placeholderTextColor={colors.muted}
              keyboardType="phone-pad"
              returnKeyType="done"
              accessibilityLabel="Phone number"
            />
            {numberState.length > 0 ? (
              <Pressable testID="callguard-clear" accessibilityRole="button" accessibilityLabel="Clear number" onPress={() => setNumber("")} style={s.clearBtn}>
                <CircleX size={20} color={colors.muted} />
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* ── Gold CTA: Check number ── */}
        <Pressable
          testID="callguard-investigate"
          accessibilityRole="button"
          accessibilityLabel="Check number"
          disabled={!hasValidNumber}
          onPress={() => void runInvestigation()}
          style={({ pressed }) => [s.goldBtn, !hasValidNumber && s.goldBtnDisabled, { opacity: pressed && hasValidNumber ? 0.85 : 1 }]}
        >
          <Search size={22} color={colors.onSurface} />
          <Text style={s.goldBtnText}>Check number</Text>
        </Pressable>

        {/* ── Error ── */}
        {error ? (
          <View style={s.errorCard} testID="callguard-error">
            <Text style={s.errorText}>{error}</Text>
            <Button testID="callguard-retry" variant="secondary" label="Try again" onPress={() => void runInvestigation()} />
          </View>
        ) : null}

        {/* Checking a number is the deliberate act; screening every incoming call is the
            standing protection. This is where a person comes to turn that on. */}
        <CallScreenerCard testID="callguard-screener" />
      </KeyboardAwareScrollView>

      <PhonePickerSheet visible={callerPickerOpen} mode="calls" onClose={() => setCallerPickerOpen(false)} onPickCall={(c) => { setNumber(c.number); setCallerPickerOpen(false); }} />
      <SourcePickerSheet
        visible={callSourcePicker}
        title="Recent callers"
        note="Apollo runs the real number check on whichever you pick."
        preview={PREVIEW_SIMULATION}
        error={PREVIEW_SIMULATION ? null : "Apollo can't read the call log on this build. Enter or paste the number below instead."}
        items={SIMULATED_CALLS.map((c) => ({ id: c.id, primary: c.number, secondary: c.name ?? undefined, meta: c.probes }))}
        emptyText="There are no recent callers to choose from here."
        onSelect={(id) => { setCallSourcePicker(false); const c = SIMULATED_CALLS.find((x) => x.id === id); if (c) void runInvestigation(c.number); }}
        onClose={() => setCallSourcePicker(false)}
        testID="callguard-source-picker"
      />

      {/* ── Checking overlay modal ── */}
      <CheckingModal
        visible={busy}
        title="Checking number"
        subject={numberState.trim() || undefined}
        description={"Looking up reputation data and running\nMagnum DI analysis. This usually takes\na few seconds."}
      />
    </View>
  );
}
