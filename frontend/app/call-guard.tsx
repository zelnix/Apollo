// Check a Number — Number-first, standalone phone investigation.
// Works without answering the call. Requires only a valid phone number.
// Optional caller details in a collapsed section.
// Uses the full Magnum DI investigation pipeline.
import { useRouter } from "expo-router";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import Phone from "lucide-react-native/icons/phone";
import PhoneOff from "lucide-react-native/icons/phone-off";
import Search from "lucide-react-native/icons/search";
import ShieldAlert from "lucide-react-native/icons/shield-alert";
import X from "lucide-react-native/icons/x";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, AppState, Platform, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiPost } from "@/src/api/client";
import { CheckResultScreen } from "@/src/components/CheckResultScreen";
import { CheckHistoryCard } from "@/src/components/CheckHistoryCard";
import { PatrolItem } from "@/src/components/PatrolItem";
import { projectPatrolOutcomes } from "@/src/domain/patrolOutcomes";
import { InfoButton } from "@/src/components/InfoButton";
import { PhonePickerSheet } from "@/src/components/PhonePickerSheet";
import { PhonePickers } from "@/src/security/phonePickers";
import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import { buildCallRiskCheckResult } from "@/src/domain/callRiskCheckResultAdapter";
import { issueContext, type HigginsIssueContext } from "@/src/domain/higginsHandoff";
import { CALL_ASKS, CALL_CLAIMS, type CallAsk, type CallClaim } from "@/src/domain/callAnalysis";
import { CallSdk, type CallProtectionCapabilities } from "@/src/security/callSdk";
import { type CallRiskResult, useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";
import { recordCheck } from "@/src/store/checkHistoryStore";
import { saveCheck } from "@/src/store/savedCheckStore";

// Reporting links for multiple jurisdictions
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
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  subtitle: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary },
  // Number input area
  numberCard: { gap: spacing.md, borderWidth: 2, borderColor: c.brand },
  inputRow: { flexDirection: "row", gap: spacing.sm },
  input: { minHeight: 52, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontFamily: fonts.text, fontSize: 16, color: c.onSurface },
  countryInput: { minHeight: 52, width: 72, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.md, fontFamily: fonts.text, fontSize: 16, color: c.onSurface, textAlign: "center" },
  // Optional details section
  detailsToggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.sm },
  detailsToggleText: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.brand },
  q: { fontFamily: fonts.displayBold, fontSize: 16, color: c.onSurface },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, minHeight: 40 },
  chipOn: { borderColor: c.brandPrimary, backgroundColor: c.restingTint },
  chipText: { fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurface },
  descInput: { minHeight: 80, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontFamily: fonts.text, fontSize: 15, color: c.onSurface, textAlignVertical: "top" },
  // Progress
  progressCard: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  progressText: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  progressSub: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceSecondary, marginTop: 2 },
  // Auto screening & lists
  iconWell: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.navyTint, alignItems: "center", justifyContent: "center" },
  rowTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardTitle: { fontFamily: fonts.displayBold, fontSize: 16, color: c.brand },
  listRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.border },
  listNumber: { fontFamily: fonts.textMedium, fontSize: 15, color: c.onSurface },
  why: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  small: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  divider: { height: 1, backgroundColor: c.border, marginVertical: spacing.sm },
}));

export default function CheckNumber() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { checkNumberRisk, events, showToast, deviceId } = useApollo();

  // Core state — number input
  const [number, setNumber] = useState("");
  const [country, setCountry] = useState("");
  const [busy, setBusy] = useState(false);
  const [investigationBusy, setInvestigationBusy] = useState(false);
  const [result, setResult] = useState<CallRiskResult | null>(null);
  const [investigationResult, setInvestigationResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  // Optional details state (collapsed by default)
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [asks, setAsks] = useState<CallAsk[]>([]);
  const [claim, setClaim] = useState<CallClaim>("unknown");
  const [transcript, setTranscript] = useState("");

  // Phone picker
  const [callerPickerOpen, setCallerPickerOpen] = useState(false);
  const canPickPhone = PhonePickers.isSupported();

  // Auto-screening state
  const [caps, setCaps] = useState<CallProtectionCapabilities | null>(null);
  const [lists, setLists] = useState<{ block: string[]; allow: string[]; autoRisky: string[] }>({ block: [], allow: [], autoRisky: [] });
  const [openingSettings, setOpeningSettings] = useState(false);
  const [showScreening, setShowScreening] = useState(false);

  const refresh = useCallback(() => {
    void CallSdk.getCallProtectionCapabilities().then(setCaps);
    void CallSdk.getCallBlockAllowList().then(setLists);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") refresh(); });
    return () => sub.remove();
  }, [refresh]);
  const screeningOn = caps?.callScreening === "supported";

  const turnOn = async () => {
    setOpeningSettings(true);
    try {
      const r = await CallSdk.requestCallScreeningRole();
      if (r.held) showToast("Call screening is on.", "resting");
      else if (r.opened) showToast(Platform.OS === "android" ? "Select Apollo as your call-screening app, then come back." : "Settings opened. Turn on Apollo under Phone > Call Blocking & Identification.", "neutral");
      refresh();
    } finally { setOpeningSettings(false); }
  };

  const addEntry = async (num: string, kind: "block" | "allow") => {
    await CallSdk.addCallListEntry(num, kind);
    showToast(kind === "block" ? "Added to block list." : "Added to allow list.", "neutral");
    refresh();
  };
  const removeEntry = async (num: string, kind: "block" | "allow") => {
    await CallSdk.removeCallListEntry(num, kind);
    refresh();
  };

  const toggleAsk = (id: CallAsk) => setAsks((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : id === "nothing" ? ["nothing"] : [...cur.filter((x) => x !== "nothing"), id]));

  // Primary action: investigate the number
  const runInvestigation = async () => {
    if (!number.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setInvestigationResult(null);
    try {
      // Step 1: Quick reputation check (fast — IPQS)
      const riskResult = await checkNumberRisk(number.trim(), country.trim() ? country.trim().toUpperCase() : undefined);
      setResult(riskResult);
      void recordCheck("call", { at: new Date().toISOString(), state: riskResult.decision === "avoid" ? "barking" : riskResult.decision === "review" ? "growling" : "resting", summary: riskResult.higgins?.headline ?? riskResult.number });
      setHistoryKey((k) => k + 1);

      // Step 2: Full Higgins investigation (slower — Gemini)
      setInvestigationBusy(true);
      try {
        const body: Record<string, unknown> = { device_id: deviceId ?? "local", number: number.trim() };
        if (country.trim()) body.country = country.trim().toUpperCase();
        if (asks.length > 0 && !asks.includes("nothing")) body.caller_asks = asks;
        if (claim !== "unknown") body.caller_claim = claim;
        if (transcript.trim()) body.transcript = transcript.trim();
        const inv = await apiPost<Record<string, unknown>>("/call/investigate", "call_investigate", body);
        setInvestigationResult(inv);
      } catch {
        // Investigation failed but reputation result is still available
        console.warn("Investigation enhancement unavailable — showing reputation result");
      } finally {
        setInvestigationBusy(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not check this number.");
    } finally {
      setBusy(false);
    }
  };

  const retryInvestigation = async () => {
    if (!number.trim() || !deviceId) return;
    setInvestigationBusy(true);
    try {
      const body: Record<string, unknown> = { device_id: deviceId, number: number.trim() };
      if (country.trim()) body.country = country.trim().toUpperCase();
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
    setCountry("");
    setSaved(false);
    setError(null);
    setAsks([]);
    setClaim("unknown");
    setTranscript("");
    setDetailsOpen(false);
  };

  const recentCalls = events.filter((e) => e.category === "call" && e.state !== "resting").slice(0, 5);

  // ── RESULT VIEW ──
  if (result) {
    const model = buildCallRiskCheckResult({ result });

    // Build comprehensive reporting links for all jurisdictions
    const allReportLinks = [
      ...REPORT_LINKS.AU,
      ...REPORT_LINKS.UK,
      ...REPORT_LINKS.US,
    ];

    // Enhance model with investigation data if available
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

    // Retry investigation if it failed or is still running
    if (investigationBusy) {
      callActions.push({ testID: "callguard-investigating", variant: "ghost", label: "Higgins is investigating…", onPress: () => {} });
    } else if (!investigationResult || !(higginsData?.exact_response)) {
      callActions.push({ testID: "callguard-retry-investigation", variant: "secondary", label: "Retry Higgins investigation", onPress: () => void retryInvestigation() });
    }

    callActions.push({ testID: "callguard-result-block", variant: "secondary", label: "Add to block list", onPress: () => void addEntry(result.number, "block") });
    callActions.push({ testID: "callguard-result-allow", variant: "ghost", label: "Always allow", onPress: () => void addEntry(result.number, "allow") });
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
        ? ["No strong risk signal does not confirm the caller is safe. Reputation is supporting evidence only."]
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

  // ── INPUT VIEW ──
  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Check a number</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <InfoButton info={{ title: "About number checking", body: [
            "Enter any phone number and Apollo will investigate it using reputation data, fraud databases and Higgins analysis.",
            "This works without answering the call — check before you call back.",
            "Reputation data can indicate risk but cannot authenticate who is calling. Always verify callers independently.",
          ] }} testID="callguard-info" />
          <Pressable testID="callguard-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
        </View>
      </View>

      <KeyboardAwareScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing["2xl"] }]} bottomOffset={24} testID="callguard-scroll">
        <Text style={s.subtitle}>Received an unknown call? Enter the number and Apollo will investigate.</Text>

        {/* ── Primary: Number input ── */}
        <Card style={s.numberCard} testID="callguard-number-card">
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Phone size={20} color={colors.brand} />
            <Text style={{ fontFamily: fonts.displayBold, fontSize: 16, color: colors.onSurface }}>Phone number</Text>
          </View>
          <View style={s.inputRow}>
            <TextInput
              testID="callguard-number"
              style={[s.input, { flex: 1 }]}
              value={number}
              onChangeText={setNumber}
              placeholder="+1 555 010 1234"
              placeholderTextColor={colors.muted}
              keyboardType="phone-pad"
              autoFocus
            />
            <TextInput
              testID="callguard-country"
              style={s.countryInput}
              value={country}
              onChangeText={setCountry}
              placeholder="US"
              placeholderTextColor={colors.muted}
              autoCapitalize="characters"
              maxLength={2}
            />
          </View>
          {canPickPhone ? (
            <Button testID="callguard-pick-recent" variant="secondary" label="Pick from recent calls" icon={<Phone size={16} color={colors.onSurface} />} onPress={() => setCallerPickerOpen(true)} />
          ) : null}
        </Card>

        {/* ── Primary CTA ── */}
        <Button
          testID="callguard-investigate"
          label={busy ? "Checking…" : "Investigate number"}
          onPress={() => void runInvestigation()}
          disabled={busy || !number.trim()}
          icon={busy ? <ActivityIndicator size="small" color={colors.onBrandPrimary} /> : <Search size={18} color={colors.onBrandPrimary} />}
        />

        {error ? <Card testID="callguard-error"><Body>{error}</Body></Card> : null}

        {/* ── Optional caller details (collapsed) ── */}
        <Pressable testID="callguard-details-toggle" accessibilityRole="button" onPress={() => setDetailsOpen(!detailsOpen)} style={s.detailsToggle}>
          <Text style={s.detailsToggleText}>Add details about the call (optional)</Text>
          {detailsOpen ? <ChevronUp size={20} color={colors.brand} /> : <ChevronDown size={20} color={colors.brand} />}
        </Pressable>

        {detailsOpen ? (
          <Card style={{ gap: spacing.md }} testID="callguard-details-card">
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

        <View style={s.divider} />

        {/* ── Recently flagged calls ── */}
        {recentCalls.length ? (
          <View>
            <SectionTitle>Recently flagged calls</SectionTitle>
            <View testID="callguard-recent">
              {projectPatrolOutcomes(recentCalls).map((outcome, i, list) => <PatrolItem key={outcome.outcomeId} outcome={outcome} isLast={i === list.length - 1} />)}
            </View>
          </View>
        ) : null}

        {/* ── Automatic screening (collapsible) ── */}
        <Pressable testID="callguard-screening-toggle" accessibilityRole="button" onPress={() => setShowScreening(!showScreening)} style={s.detailsToggle}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <ShieldAlert size={18} color={colors.brand} />
            <Text style={s.detailsToggleText}>Automatic call screening</Text>
            <Pill tone={screeningOn ? "resting" : "neutral"} label={screeningOn ? "On" : "Off"} testID="callguard-status" />
          </View>
          {showScreening ? <ChevronUp size={20} color={colors.brand} /> : <ChevronDown size={20} color={colors.brand} />}
        </Pressable>

        {showScreening ? (
          <Card style={{ gap: spacing.md }} testID="callguard-screening-card">
            {screeningOn ? (
              <Body testID="callguard-screening-detail">
                {Platform.OS === "android"
                  ? "Apollo is screening incoming calls. It rejects calls from your block list and numbers it found high-risk."
                  : "Apollo's call-blocking extension is active. Your block list is shared with the system Phone app."}
              </Body>
            ) : (
              <>
                <Body testID="callguard-screening-detail">
                  {Platform.OS === "android"
                    ? "Enable automatic screening to reject blocked and high-risk numbers before they ring."
                    : Platform.OS === "ios"
                      ? "Enable call blocking under Settings > Phone > Call Blocking & Identification."
                      : "Automatic call screening requires a native build."}
                </Body>
                {Platform.OS === "android" || Platform.OS === "ios" ? (
                  <Button testID="callguard-turn-on" variant="secondary" label={openingSettings ? "Opening…" : "Turn on call screening"} onPress={() => void turnOn()} disabled={openingSettings} />
                ) : null}
              </>
            )}

            {/* Block list */}
            <SectionTitle>Block list</SectionTitle>
            {lists.block.length ? lists.block.map((n) => (
              <View key={n} style={s.listRow}>
                <Text style={s.listNumber}>{n}</Text>
                <Button testID={`callguard-remove-block-${lists.block.indexOf(n)}`} variant="ghost" label="Remove" onPress={() => void removeEntry(n, "block")} />
              </View>
            )) : <Body>No numbers blocked.</Body>}

            {/* Allow list */}
            <SectionTitle>Allow list</SectionTitle>
            {lists.allow.length ? lists.allow.map((n) => (
              <View key={n} style={s.listRow}>
                <Text style={s.listNumber}>{n}</Text>
                <Button testID={`callguard-remove-allow-${lists.allow.indexOf(n)}`} variant="ghost" label="Remove" onPress={() => void removeEntry(n, "allow")} />
              </View>
            )) : <Body>No numbers on allow list.</Body>}
          </Card>
        ) : null}

        <View style={s.divider} />

        {/* ── Link to Live Call Screening ── */}
        <Button testID="callguard-live-call" variant="ghost" label="On a call right now? Use Live Call Screening" icon={<PhoneOff size={16} color={colors.brand} />} onPress={() => router.push("/call")} />

        <Text style={s.small}>Apollo does not listen to or record calls. Reputation is supporting evidence only — it does not authenticate the caller.</Text>

        <CheckHistoryCard gate="call" refreshKey={historyKey} testID="callguard-history" />
      </KeyboardAwareScrollView>

      <PhonePickerSheet visible={callerPickerOpen} mode="calls" onClose={() => setCallerPickerOpen(false)} onPickCall={(c) => { setNumber(c.number); setCallerPickerOpen(false); }} />
    </View>
  );
}
