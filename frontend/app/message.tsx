// Gate 2 — Check a message. Paste (or share / screenshot) a suspicious text, get a plain-language
// verdict, verify the sender safely, hand links to the link check, and enter recovery if needed.
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import ImageIcon from "lucide-react-native/icons/image";
import X from "lucide-react-native/icons/x";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiPost } from "@/src/api/client";
import { RecoveryFlow } from "@/src/components/RecoveryFlow";
import { Sheet } from "@/src/components/Sheet";
import { Body, Button, Card, Pill, SectionTitle, toneColor } from "@/src/components/ui";
import { STATE_LABEL, STATE_MEANING, STATE_NAME } from "@/src/domain/types";
import { type MessageOutcome, useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

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
}));

export default function CheckMessage() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ text?: string; sender?: string; source?: string }>();
  const { ready, setupDone, deviceId, checkMessage, resolveEvent, showToast } = useApollo();
  const [sender, setSender] = useState(params.sender ? String(params.sender) : "");
  const [text, setText] = useState(params.text ? String(params.text) : "");
  const [busy, setBusy] = useState<"idle" | "reading" | "checking">("idle");
  const [result, setResult] = useState<MessageOutcome | null>(null);
  const [verify, setVerify] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoRan = useRef(false);

  const run = async (t = text, snd = sender) => {
    if (!t.trim()) return;
    setBusy("checking"); setError(null); setResult(null);
    try { setResult(await checkMessage(snd, t)); } catch (e) { setError(e instanceof Error ? e.message : "Could not check this message."); } finally { setBusy("idle"); }
  };
  useEffect(() => { if (params.text && ready && setupDone && !autoRan.current) { autoRan.current = true; void run(String(params.text), params.sender ? String(params.sender) : ""); } }, [params.text, params.sender, ready, setupDone]); // eslint-disable-line react-hooks/exhaustive-deps

  const pickScreenshot = async () => {
    const perm = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (perm.status !== "granted") {
      if (!perm.canAskAgain) { showToast("Photo access is off. Allow it in Settings to use screenshots.", "growling"); void Linking.openSettings(); return; }
      const asked = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (asked.status !== "granted") { showToast("Apollo only needs the screenshot you pick — nothing else.", "neutral"); return; }
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.6, base64: true, allowsEditing: false });
    if (res.canceled || !res.assets[0]?.base64) return;
    setBusy("reading"); setError(null);
    try {
      const r = await apiPost<{ sender: string; text: string; urls: string[] }>("/message/extract", "message_extract", { device_id: deviceId ?? undefined, image_base64: res.assets[0].base64 });
      if (r.sender && !sender) setSender(r.sender);
      const extra = r.urls.filter((u) => !r.text.includes(u));
      setText([r.text, ...extra].filter(Boolean).join("\n"));
      showToast("Screenshot read. Check it when you're ready.", "resting");
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't read that screenshot."); } finally { setBusy("idle"); }
  };

  if (ready && !setupDone) return <Redirect href="/" />;
  const a = result?.analysis;
  const tone = a?.state ?? "neutral";

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Check a message</Text>
        <Pressable testID="message-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <KeyboardAwareScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} bottomOffset={24} testID="message-scroll">
        <Body>Paste a suspicious text, chat or email. Apollo reads it on your device first, then checks any links. Nothing is monitored automatically.</Body>
        <TextInput testID="message-sender" style={s.input} value={sender} onChangeText={setSender} placeholder="Sender (number, name or handle) — optional" placeholderTextColor={colors.muted} autoCorrect={false} />
        <TextInput testID="message-text" style={[s.input, s.multi]} value={text} onChangeText={setText} placeholder="Paste the message here" placeholderTextColor={colors.muted} multiline autoCorrect={false} />
        <View style={s.actions}>
          <Button testID="message-check" label={busy === "checking" ? "Sniffing…" : "Check message"} onPress={() => void run()} disabled={!text.trim() || busy !== "idle"} style={{ flex: 1 }} />
          {Platform.OS !== "web" ? <Button testID="message-screenshot" variant="secondary" label={busy === "reading" ? "Reading…" : "Screenshot"} icon={<ImageIcon size={18} color={colors.onSurface} />} onPress={() => void pickScreenshot()} disabled={busy !== "idle"} /> : null}
        </View>
        <Text style={s.small}>Tapping Check shares the message text with Apollo for analysis. It isn&apos;t stored.</Text>
        {error ? <Card testID="message-error"><Body>{error}</Body></Card> : null}
        {busy === "checking" ? (
          <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }} testID="message-sniffing">
            <ActivityIndicator color={colors.sniffing} /><View style={{ flex: 1 }}><Text style={s.stateLabel}>{STATE_LABEL.sniffing}</Text><Body>{STATE_MEANING.sniffing}</Body></View>
          </Card>
        ) : null}

        {result && a ? (
          <>
            <Card testID="message-result" style={{ borderColor: toneColor(colors, tone), gap: spacing.sm }}>
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
              {result.remoteError ? <Text style={s.small}>Second opinion unavailable — showing Apollo&apos;s on-device reading.</Text> : null}
            </Card>

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
                <Button testID="message-verify-sender" variant="secondary" label="Verify sender safely" onPress={() => setVerify(true)} />
                {a.signals.loginRequest || a.signals.codeRequest || /password|sign[- ]?in|login|account/i.test(text) ? <Button testID="message-check-account" variant="secondary" label="It's about my account — check with Account Guard" onPress={() => router.push({ pathname: "/account", params: { text, scent: result.event?.scent_id ?? result.event?.event_id ?? "" } })} /> : null}
                <Button testID="message-tell-more" variant="secondary" label="Tell me more (Ask Apollo)" onPress={() => router.push({ pathname: "/(tabs)/ask", params: { context: `Message check: ${a.scenarioTitle}. State: ${STATE_NAME[a.state]}. Signals: ${a.signalLabels.join(", ") || "none"}. Website: ${result.urls[0]?.host ?? "none"}.`, prompt: "Explain this message check in plain language and what I should do." } })} />
                {result.event ? <RecoveryFlow event={result.event} kinds={["clicked", "password", "code", "money", "info", "app"]} linkToCheck={a.signals.urls[0] ?? null} testID="message-recovery" /> : null}
                {result.event ? <Button testID="message-mark-safe" variant="ghost" label="Mark as safe — I know this sender" onPress={() => { void resolveEvent(result.event!); showToast("Marked as safe. Apollo will stop flagging it.", "resting"); goBackOrHome(router); }} /> : null}
              </Card>
            </View>
          </>
        ) : null}
      </KeyboardAwareScrollView>

      <Sheet visible={verify} onClose={() => setVerify(false)} title="Verify the sender" testID="verify-sender-sheet">
        <Body>{a?.verifySender}</Body>
        <Body>Never verify using a number, link or email that only appears in the suspicious message.</Body>
        <Button testID="verify-sender-close" variant="ghost" label="Got it" onPress={() => setVerify(false)} />
      </Sheet>

    </View>
  );
}
