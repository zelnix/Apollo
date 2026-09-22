// Text Guard — SMS-focused guard. Android: optional automatic scanning of new text-message
// notifications via Apollo's opt-in Notification Listener access (no READ_SMS, ever — see
// ApolloSmsListenerService.kt). iOS: Apple gives third-party apps no way to read Messages
// automatically, so the honest path is pasting a message here, or Share → Apollo from Messages.
// Both platforms run the SAME on-device Text & Message engine + Email/Text Guard link assessment as
// a pasted check (src/store/ApolloContext.checkMessage) — nothing here invents a separate verdict path.
import { useRouter } from "expo-router";
import MessageSquareWarning from "lucide-react-native/icons/message-square-warning";
import X from "lucide-react-native/icons/x";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, AppState, Platform, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PatrolItem } from "@/src/components/PatrolItem";
import { projectPatrolOutcomes } from "@/src/domain/patrolOutcomes";
import { RecoveryFlow } from "@/src/components/RecoveryFlow";
import { MessageAssessmentResult } from "@/src/components/MessageAssessmentResult";
import { Sheet } from "@/src/components/Sheet";
import { Body, Button, Card, Pill, SectionTitle, toneColor } from "@/src/components/ui";
import { STATE_LABEL, STATE_MEANING, STATE_NAME } from "@/src/domain/types";
import { MessagingSdk, type MessagingCapabilities } from "@/src/security/messagingSdk";
import { type MessageOutcome, useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";
import { dispatchInvestigationAction } from "@/src/domain/investigationActions";
import { GateInvestigation } from "@/src/components/GateInvestigation";
import { issueContext } from "@/src/domain/higginsHandoff";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  iconWell: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.navyTint, alignItems: "center", justifyContent: "center" },
  rowTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardTitle: { fontFamily: fonts.displayBold, fontSize: 16, color: c.brand },
  input: { minHeight: 48, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  multi: { minHeight: 132, textAlignVertical: "top" },
  verdict: { fontFamily: fonts.displayBold, fontSize: 20, lineHeight: 26, color: c.onSurface },
  stateLabel: { fontFamily: fonts.display, fontSize: 15, color: c.onSurface },
  why: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  small: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
}));

export default function TextGuard() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { checkMessage, resolveEvent, showToast, events } = useApollo();

  // Automatic scanning status (Android: NotificationListenerService grant; iOS: honestly unsupported).
  const [caps, setCaps] = useState<MessagingCapabilities | null>(null);
  const [openingSettings, setOpeningSettings] = useState(false);
  const refreshCaps = useCallback(() => { void MessagingSdk.getMessagingCapabilities().then(setCaps); }, []);
  useEffect(() => { refreshCaps(); }, [refreshCaps]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") refreshCaps(); });
    return () => sub.remove();
  }, [refreshCaps]);
  const smsOn = caps?.smsFiltering === "supported";
  const smsSupported = caps?.smsFiltering !== "unsupported";

  const turnOn = async () => {
    setOpeningSettings(true);
    try {
      const r = await MessagingSdk.openSmsListenerSettings();
      if (r.opened) showToast("Settings opened. Turn on Apollo under notification access, then come back.", "neutral");
    } finally { setOpeningSettings(false); }
  };

  // Manual paste fallback — the primary path on iOS, and the backup everywhere else.
  const [sender, setSender] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MessageOutcome | null>(null);
  const [verify, setVerify] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [higginsResolved, setHigginsResolved] = useState(false);

  const run = async () => {
    if (!text.trim()) return;
    setBusy(true); setError(null); setResult(null); setHigginsResolved(false);
    try { setResult(await checkMessage(sender, text)); } catch (e) { setError(e instanceof Error ? e.message : "Could not check this message."); } finally { setBusy(false); }
  };

  const recent = events.filter((e) => e.category === "message" && e.state !== "resting").slice(0, 5);
  const a = result?.analysis;
  const tone = a?.state ?? "neutral";

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Text Gate</Text>
        <Pressable testID="textguard-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <KeyboardAwareScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} bottomOffset={24} testID="textguard-scroll">
        <Body testID="textguard-intro">Apollo investigates pasted texts and chosen screenshots using local scam detection, link and public evidence checks, and Higgins&apos;s Gemini explanation. Raw content is not retained by Apollo.</Body>

        <Card style={{ gap: spacing.sm }} testID="textguard-auto-card">
          <View style={s.rowTop}>
            <View style={s.iconWell}><MessageSquareWarning size={18} color={colors.brand} /></View>
            <Text style={[s.cardTitle, { flex: 1 }]}>Automatic scanning</Text>
            <Pill tone={smsOn ? "resting" : smsSupported ? "growling" : "unknown"} label={smsOn ? "On" : smsSupported ? "Off" : "Not available"} testID="textguard-auto-status" />
          </View>
          {Platform.OS === "android" ? (
            smsOn ? (
              <Body testID="textguard-auto-detail">Apollo checks new text-message notifications from your chosen messaging app as they arrive. Notification text is sent for the same purpose-limited assessment as a manual check, then discarded. Apollo never reads your SMS inbox or message history.</Body>
            ) : (
              <>
                <Body testID="textguard-auto-detail">Turning this on authorises ongoing assessment of new notifications from your chosen messaging app. Apollo reads only each notification as it arrives, never your SMS inbox or history, and does not retain the raw notification text.</Body>
                <Button testID="textguard-turn-on" variant="secondary" label={openingSettings ? "Opening…" : "Turn on notification access"} onPress={() => void turnOn()} disabled={openingSettings} />
              </>
            )
          ) : (
            <Body testID="textguard-auto-detail">Apple doesn&apos;t let apps read your Messages automatically — there&apos;s no setting Apollo can turn on for this. Paste a suspicious text below, or share it to Apollo from the Messages app.</Body>
          )}
        </Card>

        {recent.length ? (
          <View>
            <SectionTitle>Recently flagged from your messages</SectionTitle>
            <View testID="textguard-recent">
              {projectPatrolOutcomes(recent).map((outcome, i, list) => <PatrolItem key={outcome.id} outcome={outcome} isLast={i === list.length - 1} />)}
            </View>
          </View>
        ) : null}

        <View>
          <SectionTitle>Paste a message</SectionTitle>
          <Card style={{ gap: spacing.md }} testID="textguard-paste-card">
            <TextInput testID="textguard-sender" style={s.input} value={sender} onChangeText={setSender} placeholder="Sender (number, name or handle) — optional" placeholderTextColor={colors.muted} autoCorrect={false} />
            <TextInput testID="textguard-text" style={[s.input, s.multi]} value={text} onChangeText={setText} placeholder="Paste the text message here" placeholderTextColor={colors.muted} multiline autoCorrect={false} />
            <Button testID="textguard-check" label={busy ? "Sniffing…" : "Check message"} onPress={() => void run()} disabled={!text.trim() || busy} />
            <Button testID="textguard-check-screenshot" variant="secondary" label="Investigate a message screenshot" onPress={() => router.push({ pathname: "/message", params: { openScreenshot: "1", source: "text-guard" } })} />
            <Text style={s.small} testID="textguard-privacy">Submitting content authorises one purpose-limited investigation. Request copies close immediately and never later than 15 minutes. Ongoing notification checks require the separate opt-in above.</Text>
          </Card>
        </View>

        {error ? <Card testID="textguard-error"><Body>{error}</Body></Card> : null}
        {busy ? (
          <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }} testID="textguard-sniffing">
            <ActivityIndicator color={colors.sniffing} /><View style={{ flex: 1 }}><Text style={s.stateLabel}>{STATE_LABEL.sniffing}</Text><Body>{STATE_MEANING.sniffing}</Body></View>
          </Card>
        ) : null}

        {result && a ? (
          <>
            {!higginsResolved && result.assessment ? <MessageAssessmentResult assessment={result.assessment} state={a.state}
              submittedLabel="Text investigated" submittedTitle={sender || "Sender not supplied"} submittedText={text}
              onPrimaryAction={() => dispatchInvestigationAction(result.assessment!.higgins.action_kind, {
                showVerification: () => setVerify(true), openAccount: () => router.push({ pathname: "/account", params: { text, scent: result.event?.scent_id ?? result.event?.event_id ?? "" } }),
                clearSubmittedCopy: () => { setText(""); setSender(""); showToast("The copy submitted to Apollo was cleared from this screen. The original message was not deleted.", "neutral"); },
                showReview: () => setVerify(true),
              })} /> : !higginsResolved ? <Card testID="textguard-result" style={{ borderColor: toneColor(colors, tone), gap: spacing.sm }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" }}>
                <Pill tone={tone} label={STATE_NAME[a.state]} testID="textguard-state" />
                <Pill tone="neutral" label={a.scenarioTitle} />
              </View>
              <Text style={s.stateLabel}>{STATE_LABEL[a.state]}</Text>
              <Text style={s.verdict} testID="textguard-verdict">{result.explanation?.summary ?? a.verdict}</Text>
              <SectionTitle>Why?</SectionTitle>
              {(result.explanation?.why?.length ? result.explanation.why : a.why).map((w, i) => <Text key={i} style={s.why}>• {w}</Text>)}
              <SectionTitle>Recommendation</SectionTitle>
              <Text style={s.why} testID="textguard-recommendation">{result.explanation?.recommendation ?? a.recommendation}</Text>
              {a.signalLabels.length ? <View style={s.chips}>{a.signalLabels.map((l) => <Pill key={l} tone="unknown" label={l} />)}</View> : null}
            </Card> : null}

            {a.signals.urls.length ? (
              <View>
                <SectionTitle>Links in this message</SectionTitle>
                <Card style={{ gap: spacing.sm }}>
                  {a.signals.urls.map((u) => (
                    <View key={u} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                      <Text style={[s.why, { flex: 1 }]} numberOfLines={1}>{u}</Text>
                      <Button testID={`textguard-check-link-${a.signals.urls.indexOf(u)}`} variant="secondary" label="Check link" onPress={() => router.push({ pathname: "/check", params: { url: u.startsWith("http") ? u : `https://${u}`, source: "message" } })} />
                    </View>
                  ))}
                </Card>
              </View>
            ) : null}

            <Card style={{ gap: spacing.sm }}>
              <GateInvestigation submission={result} eventId={result.event?.event_id} onResolved={setHigginsResolved} testID="textguard-higgins" label="Continue this investigation" context={issueContext({
                gate: "text", issue_summary: a.scenarioTitle, assessment_state: a.state,
                findings: a.signalLabels.map((summary) => ({ summary, provenance: "observed", status: "uncertain" })),
                uncertainty: ["The sender was not independently authenticated."], confirmed_protective_actions: [], user_reported_actions: [],
                event_id: result.event?.event_id,
                original_evidence: [{ kind: "text", value: `From: ${sender}\n${text}`, label: "submitted text message" }],
              })} question="Investigate this text message and tell me what to do." />
              <Button testID="textguard-verify-sender" variant="secondary" label="Show me how to check the sender" onPress={() => setVerify(true)} />
              {result.event ? <RecoveryFlow event={result.event} kinds={["clicked", "password", "code", "money", "info", "app"]} linkToCheck={a.signals.urls[0] ?? null} testID="textguard-recovery" /> : null}
              {result.event ? <Button testID="textguard-mark-safe" variant="ghost" label="Mark as handled" onPress={() => { void (async () => { await resolveEvent(result.event!); showToast("Marked as handled. This does not verify the sender or suppress future alerts.", "neutral"); })(); }} /> : null}
            </Card>
          </>
        ) : null}
      </KeyboardAwareScrollView>

      <Sheet visible={verify} onClose={() => setVerify(false)} title="Verify the sender" testID="textguard-verify-sheet">
        <Body>{a?.verifySender}</Body>
        <Body>Never verify using a number, link or email that only appears in the suspicious message.</Body>
        <Button testID="textguard-verify-close" variant="ghost" label="Got it" onPress={() => setVerify(false)} />
      </Sheet>
    </View>
  );
}
