// Gate 4 — Check This Call. Designed for use under pressure during a live call: big buttons, short
// answers, "Hang Up & Verify" first. No audio is recorded; analysis is from what the user selects
// (plus an optional voicemail/transcript they paste).
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import PhoneOff from "lucide-react-native/icons/phone-off";
import X from "lucide-react-native/icons/x";
import React, { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RecoveryFlow } from "@/src/components/RecoveryFlow";
import { Sheet } from "@/src/components/Sheet";
import { Body, Button, Card, Pill, SectionTitle, toneColor } from "@/src/components/ui";
import { CALL_ASKS, CALL_CLAIMS, type CallAnalysis, type CallAsk, type CallClaim } from "@/src/domain/callAnalysis";
import { STATE_LABEL, STATE_NAME, type PatrolEvent } from "@/src/domain/types";
import { useApollo } from "@/src/store/ApolloContext";
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
  const { ready, setupDone, checkCall, resolveEvent, showToast } = useApollo();
  const [asks, setAsks] = useState<CallAsk[]>([]);
  const [claim, setClaim] = useState<CallClaim>("unknown");
  const params = useLocalSearchParams<{ number?: string }>();
  const [number, setNumber] = useState(params.number ? String(params.number) : "");
  const [transcript, setTranscript] = useState("");
  const [more, setMore] = useState(!!params.number);
  const [result, setResult] = useState<{ analysis: CallAnalysis; event: PatrolEvent | null } | null>(null);
  const [why, setWhy] = useState(false);
  const [verify, setVerify] = useState(false);

  const toggle = (id: CallAsk) => setAsks((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : id === "nothing" ? ["nothing"] : [...cur.filter((x) => x !== "nothing"), id]));
  const run = async () => setResult(await checkCall({ asks, claim, number: number.trim() || undefined, transcript: transcript.trim() || undefined }));
  const reset = () => { setResult(null); setAsks([]); setWhy(false); };

  if (ready && !setupDone) return <Redirect href="/" />;
  const a = result?.analysis;

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Check this call</Text>
        <Pressable testID="call-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <KeyboardAwareScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} bottomOffset={24} testID="call-scroll">
        {!result ? (
          <>
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
              {a.state === "barking" || a.state === "growling" ? <Button testID="call-hangup-verify" label="Hang up & verify" icon={<PhoneOff size={18} color={colors.onBrandPrimary} />} onPress={() => setVerify(true)} /> : <Button testID="call-verify" variant="secondary" label="Verify caller" onPress={() => setVerify(true)} />}
              <Button testID="call-why" variant="secondary" label="Tell me why" onPress={() => setWhy((w) => !w)} />
              {why ? <View style={{ gap: spacing.xs }}>{a.why.map((w, i) => <Text key={i} style={s.why} testID={`call-why-${i}`}>• {w}</Text>)}<Text style={s.small}>Based on: {a.basis.join(" · ")}</Text></View> : null}
            </Card>
            <View>
              <SectionTitle>Already did something?</SectionTitle>
              <Card style={{ gap: spacing.sm }}>
                {result.event ? <RecoveryFlow event={result.event} kinds={["password", "code", "money", "card", "app", "remote", "called", "info"]} testID="call-recovery" /> : <Body>Nothing to recover from — this looked like an ordinary call.</Body>}
                {result.event && (a.requestedActions.includes("install") || a.requestedActions.includes("remote") || a.requestedActions.includes("screen")) ? <Button testID="call-check-app" variant="warning" label="They asked me to install an app — check it" onPress={() => router.push({ pathname: "/app-check", params: { scent: result.event?.scent_id ?? result.event?.event_id ?? "" } })} /> : null}
                {result.event && (a.requestedActions.includes("code") || a.requestedActions.includes("password")) ? <Button testID="call-check-account" variant="warning" label="They asked for a code or password — Account Guard" onPress={() => router.push({ pathname: "/account", params: { scent: result.event?.scent_id ?? result.event?.event_id ?? "" } })} /> : null}
                <Button testID="call-tell-more" variant="ghost" label="Ask Higgins about this call" onPress={() => router.push({ pathname: "/(tabs)/ask", params: { context: `Phone call check: ${a.title}. State: ${STATE_NAME[a.state]}. Caller claimed: ${a.claimedBrand ?? claim}. Asked for: ${a.requestedActions.join(", ")}.`, prompt: "What should I do about this phone call?" } })} />
                {result.event ? <Button testID="call-mark-safe" variant="ghost" label="It was genuine — mark as safe" onPress={() => { void resolveEvent(result.event!); showToast("Marked as safe.", "resting"); goBackOrHome(router); }} /> : null}
                <Button testID="call-again" variant="ghost" label="Check another call" onPress={reset} />
              </Card>
            </View>
          </>
        ) : null}
      </KeyboardAwareScrollView>

      <Sheet visible={verify} onClose={() => setVerify(false)} title="Verify the caller independently" testID="verify-caller-sheet">
        <Body testID="verify-caller-text">{a?.verifyCaller}</Body>
        <Body>Never verify using a number, link or website the caller gave you.</Body>
        <Button testID="verify-caller-close" variant="ghost" label="Got it" onPress={() => setVerify(false)} />
      </Sheet>
    </View>
  );
}
