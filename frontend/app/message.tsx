// Gate 2 — Check a message. Paste (or share / screenshot) a suspicious text, get a plain-language
// verdict, verify the sender safely, hand links to the link check, and enter recovery if needed.
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Image as ExpoImage } from "expo-image";
import ImageIcon from "lucide-react-native/icons/image";
import X from "lucide-react-native/icons/x";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CheckResultScreen } from "@/src/components/CheckResultScreen";
import { RecoveryFlow } from "@/src/components/RecoveryFlow";
import { ScreenshotPermissionSheet } from "@/src/components/ScreenshotPermissionSheet";
import { Sheet } from "@/src/components/Sheet";
import { GateAbout } from "@/src/components/GateAbout";
import { Body, Button, Card } from "@/src/components/ui";
import { STATE_LABEL, STATE_MEANING, STATE_NAME } from "@/src/domain/types";
import { buildMessageCheckResult } from "@/src/domain/messageCheckResultAdapter";
import { contextFromEvent, gateForCategory } from "@/src/domain/higginsHandoff";
import { type MessageOutcome, useApollo } from "@/src/store/ApolloContext";
import { CheckHistoryCard } from "@/src/components/CheckHistoryCard";
import { recordCheck } from "@/src/store/checkHistoryStore";
import { saveCheck } from "@/src/store/savedCheckStore";
import { apiUpload } from "@/src/api/client";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";
import { useScreenshotAccess } from "@/src/hooks/useScreenshotAccess";
import { redactUserSecrets } from "@/src/domain/privacy";
import { getShareIntake } from "@/src/share/shareIntake";
import { PhonePickers } from "@/src/security/phonePickers";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  input: { minHeight: 48, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  multi: { minHeight: 132, textAlignVertical: "top" },
  verdict: { fontFamily: fonts.displayBold, fontSize: 20, lineHeight: 26, color: c.onSurface },
  stateLabel: { fontFamily: fonts.display, fontSize: 15, color: c.onSurface },
  why: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  small: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  step: { flexDirection: "row", gap: spacing.sm },
  stepNum: { fontFamily: fonts.displayBold, fontSize: 15, color: c.brandPrimary, width: 20 },
  preview: { width: "100%", height: 180, borderRadius: radius.md, backgroundColor: c.surfaceTertiary },
  progressRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
}));

export default function CheckMessage() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ text?: string; sender?: string; source?: string; imageUri?: string; openScreenshot?: string; sharedIntakeId?: string }>();
  const shared = getShareIntake(params.sharedIntakeId);
  const sharedText = shared?.text || shared?.webUrl || params.text || "";
  const sharedImage = shared?.files?.find((file) => (file.mimeType ?? "").startsWith("image/"))?.path || params.imageUri || "";
  const { ready, setupDone, deviceId, checkMessage, resolveEvent, showToast } = useApollo();
  const [sender, setSender] = useState(params.sender ? String(params.sender) : "");
  const [text, setText] = useState(String(sharedText));
  const [busy, setBusy] = useState<"idle" | "reading" | "checking">("idle");
  const [result, setResult] = useState<MessageOutcome | null>(null);
  const [verify, setVerify] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [screenshotUri, setScreenshotUri] = useState<string | null>(sharedImage ? String(sharedImage) : null);
  const isEmail = params.source === "email";
  const canPickSms = !isEmail && PhonePickers.isSupported();
  const autoRan = useRef(false);
  const autoImage = useRef(false);
  const autoPicker = useRef(false);

  const run = async (t = text, snd = sender) => {
    const safeText = redactUserSecrets(t);
    if (!safeText.trim()) return;
    if (safeText !== t) setText(safeText);
    setBusy("checking"); setError(null); setResult(null);
    try { setResult(await checkMessage(snd, safeText)); } catch (e) { setError(e instanceof Error ? e.message : "Could not check this message."); } finally { setBusy("idle"); }
  };
  useEffect(() => { if (sharedText && ready && setupDone && !autoRan.current) { autoRan.current = true; void run(String(sharedText), params.sender ? String(params.sender) : ""); } }, [sharedText, params.sender, ready, setupDone]); // eslint-disable-line react-hooks/exhaustive-deps

  const readScreenshot = async (uri: string, name: string, type: string) => {
    if (!deviceId) throw new Error("Apollo is still preparing this device.");
    setBusy("reading"); setError(null); setResult(null); setScreenshotUri(uri);
    try {
      const extracted = await apiUpload<{ sender: string; text: string; urls: string[] }>("/message/extract", "message_extract",
        { device_id: deviceId }, { uri, name, type });
      const combined = [extracted.text, ...extracted.urls.filter((url) => !extracted.text.includes(url))].filter(Boolean).join("\n");
      setSender(extracted.sender); setText(combined);
      await run(combined, extracted.sender);
    } finally { setBusy("idle"); }
  };
  const launchScreenshotPicker = async () => {
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 0.9 });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      await readScreenshot(asset.uri, asset.fileName ?? "message-screenshot.jpg", asset.mimeType ?? "image/jpeg");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not read that screenshot."); setBusy("idle"); }
  };
  const photoAccess = useScreenshotAccess(launchScreenshotPicker);
  useEffect(() => {
    if (params.openScreenshot !== "1" || !ready || !setupDone || autoPicker.current) return;
    autoPicker.current = true; void photoAccess.start();
  }, [params.openScreenshot, ready, setupDone, photoAccess]);
  // Screenshot shared from another app (Share → Apollo): read it as soon as the screen opens.
  useEffect(() => {
    if (!sharedImage || !deviceId || autoImage.current) return;
    autoImage.current = true;
    const uri = String(sharedImage);
    const ext = uri.split("?")[0].split(".").pop()?.toLowerCase();
    const type = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    void readScreenshot(uri, `shared-message.${ext || "jpg"}`, type).catch((e) => { setError(e instanceof Error ? e.message : "Could not read that screenshot."); setBusy("idle"); });
  }, [sharedImage, deviceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const [historyKey, setHistoryKey] = useState(0);
  useEffect(() => { if (result?.analysis) { void recordCheck("message", { at: new Date().toISOString(), state: result.analysis.state, summary: result.analysis.scenarioTitle }); setHistoryKey((k) => k + 1); } }, [result]);

  if (ready && !setupDone) return <Redirect href="/" />;
  const a = result?.analysis;

  // UNIVERSAL CHECK RESULT — when the message check has produced an outcome, the entire screen
  // becomes the shared Check Result. ONE Higgins paragraph, ONE items list, ONE actions row.
  if (result && a) {
    const model = buildMessageCheckResult({ analysis: a, event: result.event, sender, explanation: result.explanation, urlResults: result.urls });
    const askPrompt = `About the message I just checked (from ${model.subject}). ${model.headline} Can you walk me through what Apollo found and what I should do?`;
    const msgActions: { label: string; onPress: () => void; testID: string; variant?: "primary" | "secondary" | "ghost" }[] = [];
    msgActions.push({ testID: "message-verify-sender", variant: "secondary", label: "Show me how to check the sender", onPress: () => setVerify(true) });
    if (a.signals.loginRequest || a.signals.codeRequest || /password|sign[- ]?in|login|account/i.test(text)) {
      msgActions.push({ testID: "message-check-account", variant: "secondary", label: "It's about my account \u2014 open Account Gate", onPress: () => router.push({ pathname: "/account", params: { text, scent: result.event?.scent_id ?? result.event?.event_id ?? "" } }) });
    }
    a.signals.urls.forEach((u, i) => {
      const r = result.urls.find((x) => x.url.replace(/\/$/, "").includes(u.replace(/^https?:\/\//i, "").replace(/\/$/, "")));
      const label = r?.verdict === "malicious" ? `\u26a0 ${u.length > 35 ? u.slice(0, 35) + "\u2026" : u}` : `Check: ${u.length > 35 ? u.slice(0, 35) + "\u2026" : u}`;
      msgActions.push({ testID: `message-check-link-${i}`, variant: r?.verdict === "malicious" ? "secondary" : "ghost", label, onPress: () => router.push({ pathname: "/check", params: { url: u.startsWith("http") ? u : `https://${u}`, source: "message" } }) });
    });
    if (result.event) {
      msgActions.push({ testID: "message-mark-safe", variant: "ghost", label: "Mark as handled", onPress: () => { void resolveEvent(result.event!); showToast("Marked as handled.", "neutral"); goBackOrHome(router); } });
    }
    msgActions.push({ testID: "message-save", variant: "ghost", label: saved ? "Saved \u2713 \u2014 View saved checks" : "Save this check", onPress: () => { if (saved) { router.push("/saved-checks"); return; } void saveCheck({ id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, gate: "message", title: a.scenarioTitle, subject: sender || "Sender not supplied", state: a.state, stateName: STATE_NAME[a.state], summary: result.explanation?.summary ?? a.verdict, recommendation: result.explanation?.recommendation ?? a.recommendation, sections: [{ title: "Why", lines: result.explanation?.why?.length ? result.explanation.why : a.why }, { title: "Signals Apollo saw", lines: a.signalLabels }, { title: "Links in this message", lines: a.signals.urls }] }).then(() => { setSaved(true); showToast("Saved. Find it under Saved checks.", "neutral"); }); } });
    msgActions.push({ testID: "message-again", variant: "ghost", label: "Check another message", onPress: () => { setResult(null); setText(""); setSender(""); setScreenshotUri(null); } });

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
          actions={msgActions}
        />
        {result.event ? (
          <RecoveryFlow event={result.event} kinds={["called", "clicked", "password", "code", "money", "info", "app"]} linkToCheck={a.signals.urls[0] ?? null} testID="message-recovery" />
        ) : null}
        <Sheet visible={verify} onClose={() => setVerify(false)} title={a.signals.callbackRequest ? (a.signals.claimedBrand?.toLowerCase() === "paypal" ? "Check PayPal independently" : "Check the account independently") : "Verify the sender"} testID="verify-sender-sheet">
          <Body>{a.verifySender}</Body>
          <Body>Never verify using a number, link or email that only appears in the suspicious message.</Body>
          <Button testID="verify-sender-close" variant="ghost" label="Got it" onPress={() => setVerify(false)} />
        </Sheet>
        <ScreenshotPermissionSheet prefix="message" visible={!!photoAccess.permission} canAskAgain={photoAccess.permission?.canAskAgain ?? true}
          checking={photoAccess.checking} onContinue={() => void photoAccess.continueAccess()} onClose={photoAccess.close} />
      </>
    );
  }

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>{params.source === "email" ? "Email Gate" : "Text Gate"}</Text>
        <Pressable testID="message-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <KeyboardAwareScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} bottomOffset={24} testID="message-scroll">
        <GateAbout title={isEmail ? "How Apollo handles your emails" : "How Apollo handles your messages"} testID="message-privacy"
          tip={isEmail ? "A sender name that doesn't match the real address, a link or attachment you didn't expect, or an urgent 'account locked' or 'payment failed' message pushing you to click." : "A link you didn't expect, a 'your parcel is held' or 'account locked' text, odd spelling, or a request to tap a link or share a one-time code urgently."}>
          <Body>{isEmail ? "Apollo reads only incoming emails you choose, assesses each once, then discards the raw content. An email is kept only if it's flagged, and stays until you dismiss it. Background access remains off unless you enable it separately." : "Apollo reads only incoming messages you choose, assesses each once, then discards the raw content. A message is kept only if it's flagged, and stays until you dismiss it. You can also share a text from your Messages app, or pick one below. Background access remains off unless you enable it separately."}</Body>
        </GateAbout>
        <TextInput testID="message-sender" style={s.input} value={sender} onChangeText={setSender} placeholder="Sender (number, name or handle) — optional" placeholderTextColor={colors.muted} autoCorrect={false} />
        {canPickSms ? <Button testID="message-pick-sms" variant="secondary" label="Pick a text from your inbox" onPress={() => router.push("/message-picker")} /> : null}
        <TextInput testID="message-text" style={[s.input, s.multi]} value={text} onChangeText={setText} placeholder="Paste the message here" placeholderTextColor={colors.muted} multiline autoCorrect={false} />
        {screenshotUri ? <ExpoImage testID="message-screenshot-preview" source={{ uri: screenshotUri }} style={s.preview} contentFit="contain" accessibilityLabel="Screenshot selected for investigation" /> : null}
        <View style={s.actions}>
          <Button testID="message-check" label={busy === "checking" ? "Sniffing…" : "Check message"} onPress={() => void run()} disabled={!text.trim() || busy !== "idle"} style={{ flex: 1 }} />
          <Button testID="message-screenshot" variant="secondary" label={busy === "reading" ? "Reading…" : "Choose screenshot"} icon={<ImageIcon size={18} color={colors.onSurface} />} onPress={() => void photoAccess.start()} disabled={busy !== "idle"} />
        </View>
        <Text style={s.small} testID="message-processing-scope">Apollo combines local detection, Higgins context, caller reputation and bounded webpage checks. Raw content is discarded after the assessment; provider-side retention follows the configured Higgins policy.</Text>
        {error ? <Card testID="message-error"><Body>{error}</Body></Card> : null}
        {busy !== "idle" ? (
          <Card style={{ gap: spacing.md }} testID="message-sniffing">
            <View style={s.progressRow}><ActivityIndicator color={colors.sniffing} /><Text style={s.stateLabel}>{STATE_LABEL.sniffing}</Text></View>
            <Body testID="message-progress-extract">{busy === "reading" ? "Reading the visible text and links in your chosen screenshot…" : "Reviewing the submitted wording and scam patterns…"}</Body>
            <Body testID="message-progress-evidence">Checking links, public evidence and available reputation signals…</Body>
            <Body testID="message-progress-higgins">Higgins is preparing a clear explanation, uncertainty and one next action.</Body>
            <Body testID="message-progress-truth">{STATE_MEANING.sniffing}</Body>
          </Card>
        ) : null}
        <CheckHistoryCard gate="message" refreshKey={historyKey} testID="message-history" />
      </KeyboardAwareScrollView>


      <ScreenshotPermissionSheet prefix="message" visible={!!photoAccess.permission} canAskAgain={photoAccess.permission?.canAskAgain ?? true}
        checking={photoAccess.checking} onContinue={() => void photoAccess.continueAccess()} onClose={photoAccess.close} />

    </View>
  );
}
