// Gate 4 — Check This Call. Designed for use under pressure during a live call: big buttons, short
// answers, "Hang Up & Verify" first. No audio is recorded; analysis is from what the user selects
// (plus an optional voicemail/transcript they paste).
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import X from "lucide-react-native/icons/x";
import React, { useEffect, useState } from "react";
import { Pressable, Switch, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CheckResultScreen } from "@/src/components/CheckResultScreen";
import { RecoveryFlow } from "@/src/components/RecoveryFlow";
import { Sheet } from "@/src/components/Sheet";
import { GateAbout } from "@/src/components/GateAbout";
import { PhonePickerSheet } from "@/src/components/PhonePickerSheet";
import { PhonePickers } from "@/src/security/phonePickers";
import { getTrustedCallers, normalizeNumber, trustCaller, untrustCaller } from "@/src/domain/trustedCallers";
import { Body, Button, Card, SectionTitle } from "@/src/components/ui";
import { buildCallCheckResult } from "@/src/domain/callCheckResultAdapter";
import { CALL_ASKS, CALL_CLAIMS, type CallAnalysis, type CallAsk, type CallClaim } from "@/src/domain/callAnalysis";
import { contextFromEvent, gateForCategory } from "@/src/domain/higginsHandoff";
import { type PatrolEvent } from "@/src/domain/types";
import { useApollo } from "@/src/store/ApolloContext";
import { CheckHistoryCard } from "@/src/components/CheckHistoryCard";
import { recordCheck } from "@/src/store/checkHistoryStore";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";
import { InfoButton } from "@/src/components/InfoButton";

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
  const reset = () => { setResult(null); setAsks([]); };

  if (ready && !setupDone) return <Redirect href="/" />;
  const a = result?.analysis;

  // UNIVERSAL CHECK RESULT — when the manual check has produced an outcome, the entire screen
  // becomes the shared Check Result. ONE Higgins paragraph, ONE items list, ONE actions row.
  if (result && a) {
    const model = buildCallCheckResult({ analysis: a, event: result.event, number, transcript });
    const askPrompt = `About the phone call I just checked. ${model.headline} Can you walk me through what Apollo found and what I should do?`;
    const actions: { label: string; onPress: () => void; testID: string; variant?: "primary" | "secondary" | "ghost" }[] = [];
    if (a.state === "barking" || a.state === "growling") {
      actions.push({ testID: "call-hangup-verify", variant: "secondary", label: "Show me how to verify safely", onPress: () => setVerify(true) });
    } else {
      actions.push({ testID: "call-verify", variant: "ghost", label: "Show me how to check the caller", onPress: () => setVerify(true) });
    }
    if (number.trim()) {
      if (trustedList.includes(normalizeNumber(number))) {
        actions.push({ testID: "call-untrust-result", variant: "ghost", label: "Trusted — tap to remove", onPress: () => { void untrustCaller(number).then(reloadTrusted); showToast("Removed from trusted numbers.", "neutral"); } });
      } else {
        actions.push({ testID: "call-trust-result", variant: "ghost", label: "Trust this number", onPress: () => { void trustCaller(number).then(reloadTrusted); showToast("Added to trusted numbers — Apollo will stay quiet for it and won't auto-check it.", "resting"); } });
      }
    }
    if (result.event && (a.requestedActions.includes("install") || a.requestedActions.includes("remote") || a.requestedActions.includes("screen"))) {
      actions.push({ testID: "call-check-app", variant: "ghost", label: "They asked me to install an app — check it", onPress: () => router.push({ pathname: "/app-check", params: { scent: result.event?.scent_id ?? result.event?.event_id ?? "" } }) });
    }
    if (result.event && (a.requestedActions.includes("code") || a.requestedActions.includes("password"))) {
      actions.push({ testID: "call-check-account", variant: "ghost", label: "They asked for a code or password — Account Gate", onPress: () => router.push({ pathname: "/account", params: { scent: result.event?.scent_id ?? result.event?.event_id ?? "" } }) });
    }
    if (result.event) {
      actions.push({ testID: "call-mark-safe", variant: "ghost", label: "Mark as handled", onPress: () => { void resolveEvent(result.event!); showToast("Marked as handled. This does not verify the caller.", "neutral"); goBackOrHome(router); } });
    }
    actions.push({ testID: "call-again", variant: "ghost", label: "Check another call", onPress: reset });

    return (
      <>
        <CheckResultScreen
          result={model}
          onAskHiggins={() => router.push({
            pathname: "/(tabs)/ask",
            params: {
              context: result.event ? JSON.stringify(contextFromEvent(result.event, gateForCategory(result.event.category))) : "",
              prompt: askPrompt,
            },
          })}
          actions={actions}
        />
        {result.event ? (
          <RecoveryFlow event={result.event} kinds={["password", "code", "money", "card", "app", "remote", "called", "info"]} testID="call-recovery" />
        ) : null}
        <Sheet visible={verify} onClose={() => setVerify(false)} title="Verify the caller independently" testID="verify-caller-sheet">
          <Body testID="verify-caller-text">{a.verifyCaller}</Body>
          <Body>Never verify using a number, link or website the caller gave you.</Body>
          <Button testID="verify-caller-close" variant="ghost" label="Got it" onPress={() => setVerify(false)} />
        </Sheet>
        <PhonePickerSheet visible={callerPickerOpen} mode="calls" onClose={() => { setCallerPickerOpen(false); reloadTrusted(); }} onPickCall={(c) => { setNumber(c.number); setMore(true); }} />
      </>
    );
  }

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Call Gate</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <InfoButton info={{ title: "About Call Gate", body: ["This screen is designed for use during a live call. Big buttons and short answers help you make decisions under pressure.", "Tell Apollo what the caller is asking you to do and it will assess the risk. No audio is recorded — Apollo analyses only what you select or type."] }} testID="call-info" />
          <Pressable testID="call-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
        </View>
      </View>
      <KeyboardAwareScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} bottomOffset={24} testID="call-scroll">
        <GateAbout title="Automatically check incoming numbers" sheetTitle="Automatic call checking" testID="call-guard-auto"
          tip="An unknown number claiming to be your bank, a delivery firm or 'tech support' that pressures you to act fast — asking you to move money, read out a code, or install an app."
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
        <CheckHistoryCard gate="call" refreshKey={historyKey} testID="call-history" />
      </KeyboardAwareScrollView>
      <PhonePickerSheet visible={callerPickerOpen} mode="calls" onClose={() => { setCallerPickerOpen(false); reloadTrusted(); }} onPickCall={(c) => { setNumber(c.number); setMore(true); }} />
    </View>
  );
}
