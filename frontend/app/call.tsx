// Gate 4 — Check This Call. Designed for use under pressure during a live call: big buttons, short
// answers, "Hang Up & Verify" first. No audio is recorded; analysis is from what the user selects
// (plus an optional voicemail/transcript they paste).
import { GateInvestigation } from "@/src/components/GateInvestigation";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import PhoneOff from "lucide-react-native/icons/phone-off";
import X from "lucide-react-native/icons/x";
import React, { useEffect, useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RecoveryFlow } from "@/src/components/RecoveryFlow";
import { Sheet } from "@/src/components/Sheet";
import { GateAbout } from "@/src/components/GateAbout";
import { PhonePickerSheet } from "@/src/components/PhonePickerSheet";
import { PhonePickers } from "@/src/security/phonePickers";
import { getTrustedCallers, normalizeNumber, trustCaller, untrustCaller } from "@/src/domain/trustedCallers";
import { Body, Button, Card, Pill, SectionTitle, toneColor } from "@/src/components/ui";
import { CALL_ASKS, CALL_CLAIMS, type CallAnalysis, type CallAsk, type CallClaim } from "@/src/domain/callAnalysis";
import { STATE_LABEL, STATE_NAME, type PatrolEvent } from "@/src/domain/types";
import { issueContext } from "@/src/domain/higginsHandoff";
import { useApollo } from "@/src/store/ApolloContext";
import { CheckHistoryCard } from "@/src/components/CheckHistoryCard";
import { recordCheck } from "@/src/store/checkHistoryStore";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  q: { fontFamily: fonts.displayBold, fontSize: 18, color: c.onSurface },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  big: { minHeight: 56, minWidth: "47%", flexGrow: 1, paddingHorizontal: spacing.md, justifyContent: "center", borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceTertiary },
  bigOn: { borderColor: c.brandPrimary, backgroundColor: c.restingTint },
  bigText: { fontFamily: fonts.textSemibold, fontSize: 16, color: c.onSurface },
  chip: { paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border },
  chipOn: { borderColor: c.brandPrimary, backgroundColor: c.restingTint },
  chipText: { fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurface },
  input: { minHeight: 48, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  verdict: { fontFamily: fonts.displayBold, fontSize: 24, lineHeight: 30, color: c.onSurface },
  why: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  small: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
}));

export default function CheckCall() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { ready, setupDone, checkCall, resolveEvent, showToast, storage } = useApollo();
  const [asks, setAsks] = useState<CallAsk[]>([]);
  const [claim, setClaim] = useState<CallClaim>("unknown");
  const params = useLocalSearchParams<{ number?: string }>();
  const [number, setNumber] = useState(params.number ? String(params.number) : "");
  const [transcript, setTranscript] = useState("");
  const [more, setMore] = useState(!!params.number);
  const [result, setResult] = useState<{ analysis: CallAnalysis; event: PatrolEvent | null } | null>(null);
  const [why, setWhy] = useState(false);
  const [verify, setVerify] = useState(false);
  const [callerPickerOpen, setCallerPickerOpen] = useState(false);
  const canPickPhone = PhonePickers.isSupported();
  const [autoCheck, setAutoCheck] = useState(false);
  const [trustedList, setTrustedList] = useState<string[]>([]);
  const reloadTrusted = React.useCallback(() => { void getTrustedCallers().then(setTrustedList); }, []);
  useEffect(() => { void storage.getItem("apollo.call.auto_check", null).then((v: string | null) => setAutoCheck(v === "true")); reloadTrusted(); }, [storage, reloadTrusted]);

  const toggle = (id: CallAsk) => setAsks((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : id === "nothing" ? ["nothing"] : [...cur.filter((x) => x !== "nothing"), id]));
  const [historyKey, setHistoryKey] = useState(0);
  const run = async () => { const r = await checkCall({ asks, claim, number: number.trim() || undefined, transcript: transcript.trim() || undefined }); setResult(r); void recordCheck("call", { at: new Date().toISOString(), state: r.analysis.state, summary: r.analysis.title }); setHistoryKey((k) => k + 1); };
  const reset = () => { setResult(null); setAsks([]); setWhy(false); };

  if (ready && !setupDone) return <Redirect href="/" />;
  const a = result?.analysis;

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Call Gate</Text>
        <Pressable testID="call-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <KeyboardAwareScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} bottomOffset={24} testID="call-scroll">
        {!result ? (
          <>
            <GateAbout title="Automatically check incoming numbers" sheetTitle="Automatic call checking" testID="call-guard-auto"
              control={<Switch testID="call-auto-switch" value={autoCheck} onValueChange={(value) => { setAutoCheck(value); void storage.setItem("apollo.call.auto_check", value ? "true" : "false"); showToast(value ? "Call Guard on — Apollo will check incoming numbers." : "Call Guard off — you can still check numbers manually.", value ? "resting" : "neutral"); }} trackColor={{ true: colors.resting, false: colors.borderStrong }} thumbColor={colors.onSurface} />}>
              <Body>When on, Apollo checks incoming caller numbers against its reputation service after each call, so scam and fraud callers are flagged without opening Apollo.</Body>
              <Body style={{ fontStyle: "italic" }}>Disclosure: this sends numbers that call you to Apollo&apos;s backend for a reputation check (via IPQualityScore). Numbers are cached briefly for repeat-call detection and are not shared with other users. You can turn it off anytime.</Body>
            </GateAbout>
            {trustedList.length ? (
              <Card style={{ gap: spacing.sm }} testID="call-trusted-list">
                <SectionTitle>Trusted numbers</SectionTitle>
                <Body>Apollo stays quiet for these numbers and won&apos;t auto-check them.</Body>
                {trustedList.map((num) => (
                  <View key={num} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <Text style={[s.why, { flex: 1 }]} testID={`call-trusted-${num}`}>{num}</Text>
                    <Button testID={`call-untrust-${num}`} variant="ghost" label="Remove" onPress={() => { void untrustCaller(num).then(reloadTrusted); }} />
                  </View>
                ))}
              </Card>
            ) : null}
            {canPickPhone ? (
              <Card style={{ gap: spacing.sm }} testID="call-number-picker">
                <SectionTitle>Who called?</SectionTitle>
                {number.trim() ? <Text style={s.chipText} testID="call-picked-number">Checking: {number}</Text> : <Body>Pick the caller from your recent calls, or add the number lower down.</Body>}
                <Button testID="call-pick-recent" variant="secondary" label={number.trim() ? "Pick a different caller" : "Pick a recent caller"} onPress={() => setCallerPickerOpen(true)} />
              </Card>
            ) : null}
            <Text style={s.q}>What are they asking you to do?</Text>
            <View style={s.grid}>
              {CALL_ASKS.map((o) => (
                <Pressable key={o.id} testID={`call-ask-${o.id}`} accessibilityRole="button" accessibilityState={{ selected: asks.includes(o.id) }} onPress={() => toggle(o.id)} style={[s.big, asks.includes(o.id) && s.bigOn]}>
                  <Text style={s.bigText}>{o.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={s.q}>Who do they say they are?</Text>
            <View style={s.grid}>
              {CALL_CLAIMS.map((o) => (
                <Pressable key={o.id} testID={`call-claim-${o.id}`} accessibilityRole="button" accessibilityState={{ selected: claim === o.id }} onPress={() => setClaim(o.id)} style={[s.chip, claim === o.id && s.chipOn]}>
                  <Text style={s.chipText}>{o.label}</Text>
                </Pressable>
              ))}
            </View>
            <Button testID="call-check" label="Check with Apollo" onPress={() => void run()} disabled={asks.length === 0} />
            <Button testID="call-more-toggle" variant="ghost" label={more ? "Hide extra details" : "Add caller number or voicemail text (optional)"} onPress={() => setMore((m) => !m)} />
            {more ? (
              <>
                <TextInput testID="call-number" style={s.input} value={number} onChangeText={setNumber} placeholder="Caller number (optional)" placeholderTextColor={colors.muted} keyboardType="phone-pad" />
                <TextInput testID="call-transcript" style={[s.input, { minHeight: 100, textAlignVertical: "top" }]} value={transcript} onChangeText={setTranscript} placeholder="Paste a voicemail transcript or what the caller said (optional)" placeholderTextColor={colors.muted} multiline />
              </>
            ) : null}
            <Text style={s.small}>Apollo does not listen to or record calls. It works from what you select here, any text you paste, and your recent Apollo events.</Text>
          </>
        ) : a ? (
          <>
            <Card testID="call-result" style={{ borderColor: toneColor(colors, a.state), gap: spacing.md }}>
              <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}><Pill tone={a.state} label={STATE_NAME[a.state]} testID="call-state" /><Pill tone="neutral" label={a.title} testID="call-scenario" /></View>
              <Text style={s.why}>{STATE_LABEL[a.state]}</Text>
              <Text style={s.verdict} testID="call-verdict">{a.verdict}</Text>
              <Text style={s.why} testID="call-recommendation">{a.recommendation}</Text>
              {a.state === "barking" || a.state === "growling" ? <Button testID="call-hangup-verify" label="Show me how to verify safely" icon={<PhoneOff size={18} color={colors.onBrandPrimary} />} onPress={() => setVerify(true)} /> : <Button testID="call-verify" variant="secondary" label="Show me how to check the caller" onPress={() => setVerify(true)} />}
              <Button testID="call-why" variant="secondary" label="Tell me why" onPress={() => setWhy((w) => !w)} />
              {why ? <View style={{ gap: spacing.xs }}>{a.why.map((w, i) => <Text key={i} style={s.why} testID={`call-why-${i}`}>• {w}</Text>)}<Text style={s.small}>Based on: {a.basis.join(" · ")}</Text></View> : null}
              {number.trim() ? (trustedList.includes(normalizeNumber(number)) ? (
                <Button testID="call-untrust-result" variant="ghost" label="Trusted — tap to remove" onPress={() => { void untrustCaller(number).then(reloadTrusted); showToast("Removed from trusted numbers.", "neutral"); }} />
              ) : (
                <Button testID="call-trust-result" variant="secondary" label="Trust this number" onPress={() => { void trustCaller(number).then(reloadTrusted); showToast("Added to trusted numbers — Apollo will stay quiet for it and won't auto-check it.", "resting"); }} />
              )) : null}
            </Card>
            <View>
              <SectionTitle>Already did something?</SectionTitle>
              <Card style={{ gap: spacing.sm }}>
                {result.event ? <RecoveryFlow event={result.event} kinds={["password", "code", "money", "card", "app", "remote", "called", "info"]} testID="call-recovery" /> : <Body>Nothing to recover from — this looked like an ordinary call.</Body>}
                {result.event && (a.requestedActions.includes("install") || a.requestedActions.includes("remote") || a.requestedActions.includes("screen")) ? <Button testID="call-check-app" variant="warning" label="They asked me to install an app — check it" onPress={() => router.push({ pathname: "/app-check", params: { scent: result.event?.scent_id ?? result.event?.event_id ?? "" } })} /> : null}
                {result.event && (a.requestedActions.includes("code") || a.requestedActions.includes("password")) ? <Button testID="call-check-account" variant="warning" label="They asked for a code or password — Account Gate" onPress={() => router.push({ pathname: "/account", params: { scent: result.event?.scent_id ?? result.event?.event_id ?? "" } })} /> : null}
                <GateInvestigation submission={result} testID="call-tell-more" label="Ask Higgins about this call" context={issueContext({ gate: "call", issue_summary: a.title, assessment_state: a.state, findings: a.why.slice(0, 6).map((summary) => ({ summary, provenance: "inferred", status: "uncertain" })), uncertainty: ["The caller's identity was not independently authenticated."], confirmed_protective_actions: [], user_reported_actions: a.requestedActions, original_evidence: [{ kind: "text", value: `Caller number: ${number}\nWhat was said: ${transcript}`, label: "reported call" }] })} question="What should I do about this phone call?" />
                {result.event ? <Button testID="call-mark-safe" variant="ghost" label="Mark as handled" onPress={() => { void resolveEvent(result.event!); showToast("Marked as handled. This does not verify the caller.", "neutral"); goBackOrHome(router); }} /> : null}
                <Button testID="call-again" variant="ghost" label="Check another call" onPress={reset} />
              </Card>
            </View>
          </>
        ) : null}
        <CheckHistoryCard gate="call" refreshKey={historyKey} testID="call-history" />
      </KeyboardAwareScrollView>

      <Sheet visible={verify} onClose={() => setVerify(false)} title="Verify the caller independently" testID="verify-caller-sheet">
        <Body testID="verify-caller-text">{a?.verifyCaller}</Body>
        <Body>Never verify using a number, link or website the caller gave you.</Body>
        <Button testID="verify-caller-close" variant="ghost" label="Got it" onPress={() => setVerify(false)} />
      </Sheet>
      <PhonePickerSheet visible={callerPickerOpen} mode="calls" onClose={() => { setCallerPickerOpen(false); reloadTrusted(); }} onPickCall={(c) => { setNumber(c.number); setMore(true); }} />
    </View>
  );
}
