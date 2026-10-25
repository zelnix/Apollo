// Check a Number — Approved screen implementation.
// Header, description, phone card, gold Check number CTA, then "Calls Apollo screened": the incoming
// numbers Android handed to Apollo's CallScreeningService (never the call log), each tappable to check.
//
// One number → one reputation check → at most ONE Magnum DI investigation. Apollo's own Triage
// decides whether to open one (see checkNumberRisk); this screen FOLLOWS that case through the
// shared InvestigationFlow instead of starting a second investigation of its own.
import { useRouter } from "expo-router";
import CircleX from "lucide-react-native/icons/circle-x";
import PhoneIcon from "lucide-react-native/icons/phone";
import Search from "lucide-react-native/icons/search";
import React, { useRef, useState } from "react";
import {
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
import { ScreenedCallsList } from "@/src/components/ScreenedCallsList";
import { PhonePickers } from "@/src/security/phonePickers";
import { Body, Button } from "@/src/components/ui";
import { buildCallRiskCheckResult } from "@/src/domain/callRiskCheckResultAdapter";
import { issueContext, type HigginsIssueContext } from "@/src/domain/higginsHandoff";
import { SourcePickerSheet } from "@/src/components/SourcePickerSheet";
import { simulation } from "@/src/simulation";
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

  // Restricted call-log picker: retained, but only present when this build declares READ_CALL_LOG
  // (off by default — see plugins/withRestrictedPhonePermissions.js).
  const [callerPickerOpen, setCallerPickerOpen] = useState(false);
  const [callSourcePicker, setCallSourcePicker] = useState(false);
  const canPickCallLog = PhonePickers.isSupported("call_log");

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
            "On Android, Calls Apollo screened lists the incoming numbers Android passed to Apollo's call screening — Apollo doesn't read your call log. On iOS, enter or paste the number.",
          ] }}
          testID="callguard"
        />
      </View>

      <KeyboardAwareScrollView
        testID="callguard-scroll"
        contentContainerStyle={[s.scrollContent, { paddingTop: spacing.md, paddingBottom: insets.bottom + 100 }]}
        bottomOffset={24}
      >
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

        {/* Every incoming number Android handed to Apollo's call screening — tap one to check it. */}
        <ScreenedCallsList testID="callguard-screened" onSelect={(n) => void runInvestigation(n)} disabled={busy} />
        {canPickCallLog ? <Button testID="callguard-pick-caller" variant="secondary" label="Choose from your call log" onPress={() => setCallerPickerOpen(true)} /> : null}
        {simulation.included ? <Button testID="callguard-sample-caller" variant="ghost" label="Try a sample caller (preview)" onPress={() => setCallSourcePicker(true)} /> : null}

        {/* Checking a number is the deliberate act; screening every incoming call is the
            standing protection. This is where a person comes to turn that on. */}
        <CallScreenerCard testID="callguard-screener" />
      </KeyboardAwareScrollView>

      {canPickCallLog ? <PhonePickerSheet visible={callerPickerOpen} mode="calls" onClose={() => setCallerPickerOpen(false)} onPickCall={(c) => { setNumber(c.number); setCallerPickerOpen(false); }} /> : null}
      <SourcePickerSheet
        visible={callSourcePicker}
        title="Sample callers"
        note="Apollo runs the real number check on whichever you pick."
        preview={simulation.included}
        error={simulation.included ? null : "There are no sample callers in this build. Enter or paste the number above instead."}
        items={simulation.calls.map((c) => ({ id: c.id, primary: c.number, secondary: c.name ?? undefined, meta: c.probes }))}
        emptyText="There are no recent callers to choose from here."
        onSelect={(id: string) => { setCallSourcePicker(false); const c = simulation.calls.find((x) => x.id === id); if (c) void runInvestigation(c.number); }}
        onClose={() => setCallSourcePicker(false)}
        testID="callguard-source-picker"
      />

      {/* ── Checking overlay modal ── */}
      <CheckingModal
        visible={busy}
        title="Checking number"
        subject={numberState.trim() || undefined}
        description={"Higgins Triage and TC FlyBy are checking\nreputation data and scam patterns.\nThis usually takes a few seconds."}
      />
    </View>
  );
}
