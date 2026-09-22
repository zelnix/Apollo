// Gate 2 — Check a message. Paste (or share / screenshot) a suspicious text, get a plain-language
// verdict, verify the sender safely, hand links to the link check, and enter recovery if needed.
import { GateInvestigation } from "@/src/components/GateInvestigation";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Image as ExpoImage } from "expo-image";
import ImageIcon from "lucide-react-native/icons/image";
import X from "lucide-react-native/icons/x";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { RecoveryFlow } from "@/src/components/RecoveryFlow";
import { MessageAssessmentResult } from "@/src/components/MessageAssessmentResult";
import { ScreenshotPermissionSheet } from "@/src/components/ScreenshotPermissionSheet";
import { Sheet } from "@/src/components/Sheet";
import { Body, Button, Card, Pill, SectionTitle, toneColor } from "@/src/components/ui";
import { STATE_LABEL, STATE_MEANING, STATE_NAME } from "@/src/domain/types";
import { type MessageOutcome, useApollo } from "@/src/store/ApolloContext";
import { apiUpload } from "@/src/api/client";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";
import { useScreenshotAccess } from "@/src/hooks/useScreenshotAccess";
import { redactUserSecrets } from "@/src/domain/privacy";
import { issueContext } from "@/src/domain/higginsHandoff";
import { dispatchInvestigationAction } from "@/src/domain/investigationActions";
import { getShareIntake } from "@/src/share/shareIntake";

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
  const [error, setError] = useState<string | null>(null);
  const [higginsResolved, setHigginsResolved] = useState(false);
  const [screenshotUri, setScreenshotUri] = useState<string | null>(sharedImage ? String(sharedImage) : null);
  const autoRan = useRef(false);
  const autoImage = useRef(false);
  const autoPicker = useRef(false);

  const run = async (t = text, snd = sender) => {
    const safeText = redactUserSecrets(t);
    if (!safeText.trim()) return;
    if (safeText !== t) setText(safeText);
    setBusy("checking"); setError(null); setResult(null); setHigginsResolved(false);
    try { setResult(await checkMessage(snd, safeText)); } catch (e) { setError(e instanceof Error ? e.message : "Could not check this message."); } finally { setBusy("idle"); }
  };
  useEffect(() => { if (sharedText && ready && setupDone && !autoRan.current) { autoRan.current = true; void run(String(sharedText), params.sender ? String(params.sender) : ""); } }, [sharedText, params.sender, ready, setupDone]); // eslint-disable-line react-hooks/exhaustive-deps

  const readScreenshot = async (uri: string, name: string, type: string) => {
    if (!deviceId) throw new Error("Apollo is still preparing this device.");
    setBusy("reading"); setError(null); setResult(null); setHigginsResolved(false); setScreenshotUri(uri);
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

  if (ready && !setupDone) return <Redirect href="/" />;
  const a = result?.analysis;
  const tone = a?.state ?? "neutral";

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>{params.source === "email" ? "Email Gate" : "Text Gate"}</Text>
        <Pressable testID="message-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <KeyboardAwareScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} bottomOffset={24} testID="message-scroll">
        <Body testID="message-privacy">Submitting this item authorises one purpose-limited assessment of its text, sender, links and chosen screenshot. Apollo does not retain the raw content. Background access remains off unless you enable it separately.</Body>
        <TextInput testID="message-sender" style={s.input} value={sender} onChangeText={setSender} placeholder="Sender (number, name or handle) — optional" placeholderTextColor={colors.muted} autoCorrect={false} />
        <TextInput testID="message-text" style={[s.input, s.multi]} value={text} onChangeText={setText} placeholder="Paste the message here" placeholderTextColor={colors.muted} multiline autoCorrect={false} />
        {screenshotUri ? <ExpoImage testID="message-screenshot-preview" source={{ uri: screenshotUri }} style={s.preview} contentFit="contain" accessibilityLabel="Screenshot selected for investigation" /> : null}
        <View style={s.actions}>
          <Button testID="message-check" label={busy === "checking" ? "Sniffing…" : "Check message"} onPress={() => void run()} disabled={!text.trim() || busy !== "idle"} style={{ flex: 1 }} />
          <Button testID="message-screenshot" variant="secondary" label={busy === "reading" ? "Reading…" : "Choose screenshot"} icon={<ImageIcon size={18} color={colors.onSurface} />} onPress={() => void photoAccess.start()} disabled={busy !== "idle"} />
        </View>
        <Text style={s.small} testID="message-processing-scope">Apollo combines local detection, Gemini context, caller reputation and bounded webpage checks. Raw content is discarded after the assessment; provider-side retention follows the configured Gemini API policy.</Text>
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

        {result && a ? (
          <>
            {!higginsResolved && result.assessment ? <MessageAssessmentResult assessment={result.assessment} state={a.state}
              submittedLabel={screenshotUri ? (params.source === "email" ? "Email screenshot investigated" : "Screenshot text investigated") : "Message investigated"}
              submittedTitle={sender || "Sender not supplied"} submittedText={text} onPrimaryAction={() => dispatchInvestigationAction(result.assessment!.higgins.action_kind, {
                showVerification: () => setVerify(true), openAccount: () => router.push({ pathname: "/account", params: { text, scent: result.event?.scent_id ?? result.event?.event_id ?? "" } }),
                clearSubmittedCopy: () => { setText(""); setSender(""); setScreenshotUri(null); showToast("The copy submitted to Apollo was cleared from this screen. The original message was not deleted.", "neutral"); },
                showReview: () => setVerify(true),
              })} /> : !higginsResolved ? <Card testID="message-result" style={{ borderColor: toneColor(colors, tone), gap: spacing.sm }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap" }}>
                <Pill tone={tone} label={STATE_NAME[a.state]} testID="message-state" />
                <Pill tone="neutral" label={a.scenarioTitle} testID="message-scenario" />
                {result.explanation ? <Pill tone="neutral" label="Shared with Apollo for analysis" /> : null}
              </View>
              <Text style={s.stateLabel}>{STATE_LABEL[a.state]}</Text>
              <Text style={s.verdict} testID="message-verdict">{result.explanation?.summary ?? a.verdict}</Text>
              <SectionTitle>Why?</SectionTitle>
              {(result.explanation?.why?.length ? [...result.explanation.why, ...a.why.filter((w) => w.includes("confirmed dangerous") || w.includes("Connected to"))] : a.why).map((w, i) => <Text key={i} style={s.why} testID={`message-why-${i}`}>• {w}</Text>)}
              <SectionTitle>Recommendation</SectionTitle>
              <Text style={s.why} testID="message-recommendation">{result.explanation?.recommendation ?? a.recommendation}</Text>
              {a.signalLabels.length ? <View style={s.chips}>{a.signalLabels.map((l) => <Pill key={l} tone="unknown" label={l} />)}</View> : null}
              {result.remoteError ? <Text style={s.small}>Second opinion unavailable — showing results from Apollo&apos;s device checks.</Text> : null}
            </Card> : null}

            {a.signals.urls.length ? (
              <View>
                <SectionTitle>Links in this message</SectionTitle>
                <Card style={{ gap: spacing.sm }} testID="message-links">
                  {a.signals.urls.map((u) => {
                    const r = result.urls.find((x) => x.url.replace(/\/$/, "").includes(u.replace(/^https?:\/\//i, "").replace(/\/$/, "")));
                    return (
                      <View key={u} style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                        <View style={{ flex: 1 }}><Text style={s.why} numberOfLines={1}>{u}</Text>{r ? <Pill tone={r.verdict === "malicious" ? "biting" : r.verdict === "clean" ? "resting" : "unknown"} label={r.verdict === "malicious" ? "Known threat" : r.verdict === "clean" ? "No known threat" : "Unknown"} /> : null}</View>
                        <Button testID={`message-check-link-${a.signals.urls.indexOf(u)}`} variant="secondary" label="Check link" onPress={() => router.push({ pathname: "/check", params: { url: u.startsWith("http") ? u : `https://${u}`, source: "message" } })} />
                      </View>
                    );
                  })}
                  <Text style={s.small}>Checking a link here hands it to Apollo&apos;s link check — the two are recorded as one connected event.</Text>
                </Card>
              </View>
            ) : null}

            <View>
              <SectionTitle>What next</SectionTitle>
              <Card style={{ gap: spacing.sm }}>
                <Button testID="message-verify-sender" variant="secondary" label="Show me how to check the sender" onPress={() => setVerify(true)} />
                {a.signals.loginRequest || a.signals.codeRequest || /password|sign[- ]?in|login|account/i.test(text) ? <Button testID="message-check-account" variant="secondary" label="It's about my account — open Account Gate" onPress={() => router.push({ pathname: "/account", params: { text, scent: result.event?.scent_id ?? result.event?.event_id ?? "" } })} /> : null}
                <GateInvestigation submission={result} eventId={result.event?.event_id} onResolved={setHigginsResolved} testID="message-tell-more" label="Continue this investigation" context={issueContext({ gate: "text", issue_summary: a.scenarioTitle, assessment_state: a.state, findings: a.signalLabels.map((summary) => ({ summary, provenance: "observed", status: "uncertain" })), uncertainty: ["The sender was not independently authenticated."], confirmed_protective_actions: [], user_reported_actions: [], event_id: result.event?.event_id, original_evidence: [{ kind: "text", value: `From: ${sender}\n${text}`, label: screenshotUri ? "text extracted from the screenshot" : "submitted message" }, ...(shared?.files?.map((file, index) => ({ kind: "file" as const, uri: file.path, name: file.fileName || `shared-attachment-${index + 1}`, mediaType: file.mimeType || "application/octet-stream", size: file.size ?? undefined })) ?? (screenshotUri ? [{ kind: "file" as const, uri: screenshotUri, name: "screenshot.jpg", mediaType: "image/jpeg" }] : []))] })} question="Explain this message check in plain language and what I should do." />
                {result.event ? <RecoveryFlow event={result.event} kinds={["called", "clicked", "password", "code", "money", "info", "app"]} linkToCheck={a.signals.urls[0] ?? null} testID="message-recovery" /> : null}
                {result.event ? <Button testID="message-mark-safe" variant="ghost" label="Mark as handled" onPress={() => { void resolveEvent(result.event!); showToast("Marked as handled. This does not verify the sender or suppress future alerts.", "neutral"); goBackOrHome(router); }} /> : null}
              </Card>
            </View>
          </>
        ) : null}
      </KeyboardAwareScrollView>

      <Sheet visible={verify} onClose={() => setVerify(false)} title={a?.signals.callbackRequest ? (a.signals.claimedBrand?.toLowerCase() === "paypal" ? "Check PayPal independently" : "Check the account independently") : "Verify the sender"} testID="verify-sender-sheet">
        <Body>{a?.verifySender}</Body>
        <Body>Never verify using a number, link or email that only appears in the suspicious message.</Body>
        <Button testID="verify-sender-close" variant="ghost" label="Got it" onPress={() => setVerify(false)} />
      </Sheet>
      <ScreenshotPermissionSheet prefix="message" visible={!!photoAccess.permission} canAskAgain={photoAccess.permission?.canAskAgain ?? true}
        checking={photoAccess.checking} onContinue={() => void photoAccess.continueAccess()} onClose={photoAccess.close} />

    </View>
  );
}
