// Gate 2 — Check a message. Approved screen implementation.
// Matches the approved mock-up: header, description, message card,
// gold Check message CTA, "or" divider, two action cards, recent messages.
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Image as ExpoImage } from "expo-image";
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import Clock from "lucide-react-native/icons/clock";
import ImageIcon from "lucide-react-native/icons/image";
import MessageSquare from "lucide-react-native/icons/message-square";
import Search from "lucide-react-native/icons/search";
import User from "lucide-react-native/icons/user";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CheckResultScreen } from "@/src/components/CheckResultScreen";
import { RecoveryFlow } from "@/src/components/RecoveryFlow";
import { ScreenshotPermissionSheet } from "@/src/components/ScreenshotPermissionSheet";
import { ImagePrivacyGate, type GateResult } from "@/src/components/ImagePrivacyGate";
import { Sheet } from "@/src/components/Sheet";
import { Body, Button } from "@/src/components/ui";
import { STATE_NAME } from "@/src/domain/types";
import { buildMessageCheckResult } from "@/src/domain/messageCheckResultAdapter";
import { contextFromEvent, gateForCategory } from "@/src/domain/higginsHandoff";
import { screenImage, type ScreeningResult } from "@/src/domain/imagePrivacy";
import { type MessageOutcome, useApollo } from "@/src/store/ApolloContext";
import { CheckHistoryCard } from "@/src/components/CheckHistoryCard";
import { recordCheck } from "@/src/store/checkHistoryStore";
import { saveCheck } from "@/src/store/savedCheckStore";
import { apiUpload } from "@/src/api/client";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";
import { CheckToolHeader } from "@/src/components/CheckToolHeader";
import { CheckingModal } from "@/src/components/CheckingModal";
import { useScreenshotAccess } from "@/src/hooks/useScreenshotAccess";
import { redactUserSecrets } from "@/src/domain/privacy";
import { getShareIntake } from "@/src/share/shareIntake";
import { PhonePickers, type RecentSms } from "@/src/security/phonePickers";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },

  // ── Scroll content ──
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },

  // ── Description ──
  description: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurfaceSecondary },

  // ── Message card ──
  messageCard: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, borderWidth: 1, borderColor: c.border },
  messageCardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  messageIconWell: { width: 44, height: 44, borderRadius: 22, backgroundColor: "#DBEAFE", alignItems: "center", justifyContent: "center" },
  messageCardLabel: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface },
  messageInput: { minHeight: 100, backgroundColor: c.surface, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontFamily: fonts.text, fontSize: 16, color: c.onSurface, textAlignVertical: "top" },

  // ── Gold CTA ──
  goldBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", backgroundColor: c.gold, borderRadius: radius.lg, paddingVertical: 16, paddingHorizontal: spacing.xl, gap: spacing.md, minHeight: 56 },
  goldBtnDisabled: { opacity: 0.45 },
  goldBtnText: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface },

  // ── Or divider ──
  orDivider: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.xs },
  orLine: { flex: 1, height: 1, backgroundColor: c.border },
  orText: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.muted },

  // ── Action cards row ──
  actionCardsRow: { gap: spacing.md },
  actionCard: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: c.border },
  actionCardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  actionCardIconWell: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  actionCardTitle: { fontFamily: fonts.displayBold, fontSize: 15, color: c.onSurface, flex: 1 },
  actionCardSub: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.onSurfaceSecondary },
  actionCardChevron: { marginLeft: "auto" },

  // ── Expandable enter text link ──
  expandLink: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs },
  expandLinkText: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.brandPrimary, flex: 1 },

  // ── Recent messages section ──
  recentSection: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, overflow: "hidden" },
  recentHeader: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md, gap: 4 },
  recentHeaderTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  recentTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  recentClockWell: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  recentTitle: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface },
  seeAllRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  seeAllText: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.brand },
  recentSub: { fontFamily: fonts.text, fontSize: 14, color: c.onSurfaceSecondary, marginLeft: 48 },

  // ── Message row ──
  msgRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.md, paddingHorizontal: spacing.lg, gap: spacing.md, borderTopWidth: 1, borderTopColor: c.border },
  msgIconWell: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  msgAlertWell: { backgroundColor: "rgba(217,83,79,0.12)" },
  msgContactWell: { alignItems: "center", justifyContent: "center" },
  msgUnknownWell: { backgroundColor: c.surfaceTertiary },
  msgInitial: { fontFamily: fonts.displayBold, fontSize: 18, color: "#FFFFFF" },
  msgInfo: { flex: 1, gap: 2 },
  msgSender: { fontFamily: fonts.displayBold, fontSize: 16, color: c.onSurface },
  msgPreview: { fontFamily: fonts.text, fontSize: 14, color: c.onSurfaceSecondary, numberOfLines: 1 },
  msgDateCol: { alignItems: "flex-end", gap: 2, flexShrink: 0 },
  msgDate: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  msgTime: { fontFamily: fonts.text, fontSize: 13, color: c.muted },

  // ── Empty recent ──
  recentEmpty: { padding: spacing.xl, alignItems: "center", gap: spacing.sm },

  // ── Screenshot preview ──
  preview: { width: "100%", height: 180, borderRadius: radius.md, backgroundColor: c.surfaceTertiary },

  // ── Error card ──
  errorCard: { backgroundColor: "rgba(217,83,79,0.08)", borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm, borderWidth: 1, borderColor: "rgba(217,83,79,0.2)" },
  errorText: { fontFamily: fonts.text, fontSize: 14, color: c.onSurface },

  // ── Progress ──
  progressWrap: { gap: spacing.md, padding: spacing.lg },
  progressRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  stateLabel: { fontFamily: fonts.display, fontSize: 15, color: c.onSurface },
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
  const [manualOpen, setManualOpen] = useState(false);
  const isEmail = params.source === "email";
  const canPickSms = !isEmail && PhonePickers.isSupported();
  const autoRan = useRef(false);
  const autoImage = useRef(false);
  const autoPicker = useRef(false);

  // ── Recent SMS messages ──
  const [recentSms, setRecentSms] = useState<RecentSms[]>([]);
  const loadRecentSms = useCallback(async () => {
    if (!canPickSms) return;
    try {
      const hasPerm = await PhonePickers.hasPermission("sms");
      if (!hasPerm.granted) return;
      const msgs = await PhonePickers.listRecentSms();
      setRecentSms(msgs);
    } catch { /* not available */ }
  }, [canPickSms]);
  useEffect(() => { void loadRecentSms(); }, [loadRecentSms]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") void loadRecentSms(); });
    return () => sub.remove();
  }, [loadRecentSms]);

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
      // ── On-device privacy screening before any transmission ──
      const screening = await screenImage(uri, "message_screenshot");
      // All screening outcomes must pass through the privacy gate for user review
      // — even text_only results, so the user sees and approves what will be sent
      setGateScreening(screening);
      setPendingScreenshot({ uri, name, type });
      setBusy("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not screen that screenshot.");
      setBusy("idle");
    }
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
  // ── Privacy Gate state ──
  const [gateScreening, setGateScreening] = useState<ScreeningResult | null>(null);
  const [pendingScreenshot, setPendingScreenshot] = useState<{ uri: string; name: string; type: string } | null>(null);

  const handleGateComplete = async (result: GateResult) => {
    setGateScreening(null);
    const file = pendingScreenshot;
    setPendingScreenshot(null);
    if (result.decision === "withheld") {
      setScreenshotUri(null);
      return;
    }
    if (result.decision === "text_only" && result.text) {
      // Text-only: image stays on device, only approved sanitised text is used
      setText(result.text);
      await run(result.text, sender);
      return;
    }
    // Image approved — only the sanitised image is permitted; original never leaves device
    if (!deviceId || !file) return;
    if (!result.imageUri) {
      // PRIVACY FAIL-CLOSED: no sanitised image available — block transmission entirely
      setError("Privacy screening did not produce a sanitised image. The original cannot be sent.");
      setScreenshotUri(null);
      setBusy("idle");
      return;
    }
    setBusy("reading"); setError(null);
    try {
      const extracted = await apiUpload<{ sender: string; text: string; urls: string[] }>("/message/extract", "message_extract",
        { device_id: deviceId, sanitization_status: "approved", sanitization_receipt_id: result.receipt?.receiptId ?? "", sanitization_digest: result.receipt?.imageDigest ?? "" },
        { uri: result.imageUri, name: file.name, type: file.type });
      const combined = [extracted.text, ...extracted.urls.filter((url) => !extracted.text.includes(url))].filter(Boolean).join("\n");
      setSender(extracted.sender); setText(combined);
      await run(combined, extracted.sender);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that screenshot.");
    } finally { setBusy("idle"); }
  };

  const handleGateCancel = () => {
    setGateScreening(null);
    setPendingScreenshot(null);
    setScreenshotUri(null);
  };

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
      msgActions.push({ testID: "message-check-account", variant: "secondary", label: "It's about my account \u2014 check account alert", onPress: () => router.push({ pathname: "/account", params: { text, scent: result.event?.scent_id ?? result.event?.event_id ?? "" } }) });
    }
    a.signals.urls.forEach((u, i) => {
      const r = result.urls.find((x) => x.url.replace(/\/$/, "").includes(u.replace(/^https?:\/\//i, "").replace(/\/$/, "")));
      const label = r?.verdict === "malicious" ? `\u26a0 ${u.length > 35 ? u.slice(0, 35) + "\u2026" : u}` : `Check: ${u.length > 35 ? u.slice(0, 35) + "\u2026" : u}`;
      msgActions.push({ testID: `message-check-link-${i}`, variant: r?.verdict === "malicious" ? "secondary" : "ghost", label, onPress: () => router.push({ pathname: "/check", params: { url: u.startsWith("http") ? u : `https://${u}`, source: "message", scent: result.event?.scent_id ?? result.event?.event_id ?? "" } }) });
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
          investigationContext={result.event ? contextFromEvent(result.event, gateForCategory(result.event.category)) : undefined}
          investigationQuestion={askPrompt}
          submissionId={result.event?.event_id ?? `msg-${Date.now().toString(36)}`}
          eventId={result.event?.event_id ?? null}
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

  // ── Helper: contact initial color ──
  const INITIAL_COLORS = ["#6366F1", "#8B5CF6", "#EC4899", "#F97316", "#14B8A6", "#3B82F6", "#10B981", "#EF4444"];
  const initialColor = (name: string) => INITIAL_COLORS[name.charCodeAt(0) % INITIAL_COLORS.length];

  // ── Helper: format date for recent message rows ──
  const formatMsgDate = (ts: number) => {
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

  // ── Helper: determine if address is a phone number ──
  const isPhoneNumber = (addr: string) => /^\+?\d[\d\s\-()]{5,}$/.test(addr.trim());

  // ── Tap recent message → auto-investigate ──
  const checkRecentMessage = (msg: RecentSms) => {
    setSender(msg.address);
    setText(msg.body);
    void run(msg.body, msg.address);
  };

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <CheckToolHeader
          title={params.source === "email" ? "Email monitoring" : "Check a message"}
          info={{ title: params.source === "email" ? "About email monitoring" : "About message screening", body: ["Paste any message and Magnum DI will investigate it using local scam detection, link and public evidence checks, and Higgins's explanation.", "Apollo checks claimed identity, pressure tactics, embedded links and sender reputation. Raw content is discarded after the assessment."] }}
          testID="message"
        />
      </View>

      <KeyboardAwareScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + 100 }]} bottomOffset={24} testID="message-scroll">
        {/* ── Description ── */}
        <Text style={s.description}>
          Choose a message from your device, take a screenshot, or enter the text.{"\n"}Magnum DI will investigate it for possible scams.
        </Text>

        {/* ── Two action cards ── */}
        <View style={s.actionCardsRow}>
          {/* Select from messages */}
          <Pressable
            testID="message-pick-sms"
            accessibilityRole="button"
            accessibilityLabel="Select from messages"
            onPress={() => canPickSms ? router.push("/message-picker") : showToast(Platform.OS === "ios" ? "Direct message access is not available on iOS. Use the share or screenshot options instead." : "Message access requires a native build with SMS permission.", "neutral")}
            style={({ pressed }) => [s.actionCard, { opacity: pressed ? 0.85 : 1 }]}
          >
            <View style={s.actionCardHeader}>
              <View style={s.actionCardIconWell}><MessageSquare size={20} color={colors.onSurface} /></View>
              <Text style={s.actionCardTitle}>Select from messages</Text>
              <ChevronRight size={18} color={colors.muted} />
            </View>
            <Text style={s.actionCardSub}>Choose a message from your messaging app.</Text>
          </Pressable>

          {/* Take a screenshot */}
          <Pressable
            testID="message-screenshot"
            accessibilityRole="button"
            accessibilityLabel="Take a screenshot"
            onPress={() => void photoAccess.start()}
            disabled={busy !== "idle"}
            style={({ pressed }) => [s.actionCard, busy !== "idle" && { opacity: 0.5 }, { opacity: pressed && busy === "idle" ? 0.85 : 1 }]}
          >
            <View style={s.actionCardHeader}>
              <View style={s.actionCardIconWell}><ImageIcon size={20} color={colors.onSurface} /></View>
              <Text style={s.actionCardTitle}>Take a screenshot</Text>
              <ChevronRight size={18} color={colors.muted} />
            </View>
            <Text style={s.actionCardSub}>Select an image from your device or take a new screenshot.</Text>
          </Pressable>
        </View>

        {/* ── Enter message text (expandable) ── */}
        <Pressable
          accessibilityRole="button"
          onPress={() => setManualOpen((v) => !v)}
          style={s.expandLink}
          testID="message-expand-text"
        >
          <View style={s.messageIconWell}>
            <MessageSquare size={22} color="#1D4ED8" />
          </View>
          <Text style={s.expandLinkText}>Enter message text</Text>
          {manualOpen ? <ChevronUp size={18} color={colors.muted} /> : <ChevronDown size={18} color={colors.muted} />}
        </Pressable>
        {manualOpen ? (
          <View style={s.messageCard} testID="message-card">
            <TextInput
              testID="message-text"
              style={s.messageInput}
              value={text}
              onChangeText={setText}
              placeholder="Enter or paste message text here"
              placeholderTextColor={colors.muted}
              multiline
              autoCorrect={false}
            />
          </View>
        ) : null}

        {/* ── Screenshot preview ── */}
        {screenshotUri ? <ExpoImage testID="message-screenshot-preview" source={{ uri: screenshotUri }} style={s.preview} contentFit="contain" accessibilityLabel="Screenshot selected for investigation" /> : null}

        {/* ── Gold CTA: Check message ── */}
        <Pressable
          testID="message-check"
          accessibilityRole="button"
          accessibilityLabel="Check message"
          disabled={!text.trim() || busy !== "idle"}
          onPress={() => void run()}
          style={({ pressed }) => [s.goldBtn, (!text.trim() || busy !== "idle") && s.goldBtnDisabled, { opacity: pressed && text.trim() && busy === "idle" ? 0.85 : 1 }]}
        >
          <Search size={22} color={colors.onSurface} />
          <Text style={s.goldBtnText}>{"Check message"}</Text>
        </Pressable>

        {/* ── Error ── */}
        {error ? (
          <View style={s.errorCard} testID="message-error">
            <Text style={s.errorText}>{error}</Text>
            <Button testID="message-retry" variant="secondary" label="Try again" onPress={() => void run()} />
          </View>
        ) : null}

        {/* ── Progress handled by CheckingModal ── */}

        {/* ── Recent Messages Section ── */}
        <View style={s.recentSection} testID="message-recent-section">
          {/* Header */}
          <View style={s.recentHeader}>
            <View style={s.recentHeaderTop}>
              <View style={s.recentTitleRow}>
                <View style={s.recentClockWell}>
                  <Clock size={18} color={colors.onSurface} />
                </View>
                <Text style={s.recentTitle}>Recent messages</Text>
              </View>
              {recentSms.length > 0 ? (
                <Pressable accessibilityRole="button" onPress={() => canPickSms ? router.push("/message-picker") : undefined} style={s.seeAllRow} hitSlop={8}>
                  <Text style={s.seeAllText}>See all</Text>
                  <ChevronRight size={16} color={colors.brand} />
                </Pressable>
              ) : null}
            </View>
            <Text style={s.recentSub}>Tap a message to check it with Apollo.</Text>
          </View>

          {/* Message rows */}
          {recentSms.length > 0 ? (
            recentSms.slice(0, 5).map((msg, i) => {
              const isNumber = isPhoneNumber(msg.address);
              const { datePart, timePart } = formatMsgDate(msg.date);
              return (
                <Pressable
                  key={`${msg.address}-${msg.date}-${i}`}
                  testID={`message-recent-${i}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Check message from ${msg.address}`}
                  onPress={() => checkRecentMessage(msg)}
                  style={({ pressed }) => [s.msgRow, { opacity: pressed ? 0.7 : 1 }]}
                >
                  {isNumber ? (
                    <View style={[s.msgIconWell, s.msgUnknownWell]}>
                      <User size={22} color={colors.muted} />
                    </View>
                  ) : (
                    <View style={[s.msgIconWell, s.msgContactWell, { backgroundColor: initialColor(msg.address) }]}>
                      <Text style={s.msgInitial}>{msg.address.charAt(0).toUpperCase()}</Text>
                    </View>
                  )}
                  <View style={s.msgInfo}>
                    <Text style={s.msgSender} numberOfLines={1}>{msg.address}</Text>
                    <Text style={s.msgPreview} numberOfLines={1}>{msg.body}</Text>
                  </View>
                  <View style={s.msgDateCol}>
                    <Text style={s.msgDate}>{datePart}</Text>
                    <Text style={s.msgTime}>{timePart}</Text>
                  </View>
                  <ChevronRight size={18} color={colors.muted} />
                </Pressable>
              );
            })
          ) : (
            <View style={s.recentEmpty}>
              <MessageSquare size={28} color={colors.muted} />
              <Body>
                {Platform.OS === "android"
                  ? "Recent messages will appear here when SMS permission is granted."
                  : "Recent messages are not available on this platform. Use the options above instead."}
              </Body>
            </View>
          )}
        </View>

        <CheckHistoryCard gate="message" refreshKey={historyKey} testID="message-history" />
      </KeyboardAwareScrollView>

      <ScreenshotPermissionSheet prefix="message" visible={!!photoAccess.permission} canAskAgain={photoAccess.permission?.canAskAgain ?? true}
        checking={photoAccess.checking} onContinue={() => void photoAccess.continueAccess()} onClose={photoAccess.close} />

      {/* ── Image Privacy Gate — screens every screenshot before transmission ── */}
      {gateScreening && (
        <ImagePrivacyGate
          visible={!!gateScreening}
          screening={gateScreening}
          onComplete={(r) => void handleGateComplete(r)}
          onCancel={handleGateCancel}
        />
      )}

      {/* ── Checking overlay modal ── */}
      <CheckingModal
        visible={busy !== "idle"}
        title={busy === "reading" ? "Reading message" : "Checking message"}
        subject={sender.trim() ? `From: ${sender.trim()}` : undefined}
        description={busy === "reading" ? "Reading the visible text and links…" : "Magnum DI is reviewing wording, scam patterns\nand reputation signals."}
      />
    </View>
  );
}
