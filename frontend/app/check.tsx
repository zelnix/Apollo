import * as Clipboard from "expo-clipboard";
import { Redirect, useRouter } from "expo-router";
import ClipboardPaste from "lucide-react-native/icons/clipboard-paste";
import X from "lucide-react-native/icons/x";
import React, { useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EventActions } from "@/src/components/EventActions";
import { Body, Button, Card, Pill, toneColor } from "@/src/components/ui";
import { STATE_LABEL } from "@/src/domain/types";
import { useApollo, type CheckOutcome } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 26, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xl },
  inputWrap: { backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, flexDirection: "row", alignItems: "center", paddingLeft: spacing.lg, paddingRight: spacing.sm },
  input: { flex: 1, minHeight: 52, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  paste: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headline: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface, letterSpacing: -0.3 },
  sub: { fontFamily: fonts.display, fontSize: 13, color: c.onSurfaceSecondary, letterSpacing: 1, textTransform: "uppercase", marginTop: spacing.sm },
  bullet: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 8 },
  hint: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  sourceRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md, paddingVertical: 4 },
}));

export default function CheckLink() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { checkLink, events, isMock, ready, setupDone } = useApollo();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<CheckOutcome | null>(null);
  if (ready && !setupDone) return <Redirect href="/onboarding" />;

  const liveEvent = outcome?.event ? events.find((e) => e.event_id === outcome.event!.event_id) ?? outcome.event : null;
  const state = liveEvent?.state ?? outcome?.decision.state;

  const run = async () => {
    if (!input.trim()) return;
    setBusy(true); setOutcome(null);
    try { setOutcome(await checkLink(input)); } finally { setBusy(false); }
  };
  const paste = async () => { const t = await Clipboard.getStringAsync(); if (t) setInput(t.trim()); };

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Check a link</Text>
        <Pressable testID="check-close" accessibilityRole="button" accessibilityLabel="Close" onPress={() => router.back()} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={16}>
        <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} keyboardShouldPersistTaps="handled" testID="check-scroll">
          <View style={s.inputWrap}>
            <TextInput
              testID="check-url-input"
              style={s.input}
              value={input}
              onChangeText={setInput}
              placeholder="Paste a link, e.g. https://example.com"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={run}
            />
            <Pressable testID="check-paste-button" accessibilityLabel="Paste" onPress={paste} style={s.paste}><ClipboardPaste size={20} color={colors.onSurfaceSecondary} /></Pressable>
          </View>
          <Button testID="check-submit-button" label={busy ? "Checking…" : "Check with Apollo"} onPress={run} disabled={busy || !input.trim()} icon={busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : undefined} />
          <Text style={s.hint}>Checked on your device first. Only the link itself (no page content) is sent for a reputation check.</Text>

          {outcome && state ? (
            <Animated.View entering={FadeInDown.duration(350)}>
              <Card testID="check-result-card" style={{ borderColor: toneColor(colors, state), gap: spacing.sm }}>
                <Pill tone={state} label={STATE_LABEL[state]} testID="check-result-state" />
                <Text style={s.headline} testID="check-result-headline">{liveEvent?.headline ?? outcome.decision.headline}</Text>
                <Body>{liveEvent?.what_happened ?? outcome.decision.what_happened}</Body>
                <Text style={s.sub}>Why Apollo reacted</Text>
                {(liveEvent?.why ?? outcome.decision.why).map((w, i) => (
                  <View key={i} style={s.bullet}><View style={[s.dot, { backgroundColor: toneColor(colors, state) }]} /><Body style={{ flex: 1 }}>{w}</Body></View>
                ))}
                <Text style={s.sub}>What to do</Text>
                <Body testID="check-result-todo">{liveEvent?.what_to_do ?? outcome.decision.what_to_do}</Body>
                <Text style={s.sub}>Confidence: {outcome.decision.confidence}</Text>
                {outcome.intel ? outcome.intel.sources.map((src) => (
                  <View key={src.name} style={s.sourceRow}>
                    <Body style={{ flex: 1 }}>{src.name === "google_safe_browsing" ? "Google Safe Browsing" : "Apollo threat list"}</Body>
                    <Pill tone={src.status === "match" ? "barking" : src.status === "clear" ? "resting" : "unknown"} label={src.status === "match" ? "Listed" : src.status === "clear" ? "Clear" : src.status === "not_configured" ? "Not configured" : "Unavailable"} />
                  </View>
                )) : outcome.intelError ? <Body>Reputation check unavailable: {outcome.intelError}</Body> : null}
                {isMock && liveEvent?.verified_block ? <Pill tone="unknown" label="Simulated block (mock adapter)" /> : null}
              </Card>
              {liveEvent ? <View style={{ marginTop: spacing.md }}><EventActions event={liveEvent} /></View> : null}
            </Animated.View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
