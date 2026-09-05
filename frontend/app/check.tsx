import * as Clipboard from "expo-clipboard";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import ClipboardPaste from "lucide-react-native/icons/clipboard-paste";
import X from "lucide-react-native/icons/x";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiPost } from "@/src/api/client";
import { EventActions } from "@/src/components/EventActions";
import { RecoveryFlow } from "@/src/components/RecoveryFlow";
import { Sheet } from "@/src/components/Sheet";
import { Body, Button, Card, Pill, toneColor } from "@/src/components/ui";
import { verifyWebsite } from "@/src/domain/brand";
import { STATE_LABEL } from "@/src/domain/types";
import { useApollo, type CheckOutcome } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

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
  const { checkLink, events, isMock, ready, setupDone, deviceId, showToast, upsertEvent } = useApollo();
  const [verify, setVerify] = useState(false);
  const [report, setReport] = useState(false);
  const [tech, setTech] = useState(false);
  const sendFeedback = async (kind: "false_positive" | "override", ev: { event_id: string; state: string; indicator_host: string | null }, sources: string[]) => {
    try { await apiPost("/feedback", "feedback", { device_id: deviceId, event_id: ev.event_id, kind, state: ev.state, host: ev.indicator_host, sources, note: "" }); } catch { /* best effort */ }
  };
  const params = useLocalSearchParams<{ url?: string; source?: string }>();
  const [input, setInput] = useState(params.url ? String(params.url) : "");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<CheckOutcome | null>(null);
  const autoRan = useRef(false);

  const liveEvent = outcome?.event ? events.find((e) => e.event_id === outcome.event!.event_id) ?? outcome.event : null;
  const state = liveEvent?.state ?? outcome?.decision.state;

  const run = useCallback(async (value: string) => {
    if (!value.trim()) return;
    setBusy(true); setOutcome(null);
    try { setOutcome(await checkLink(value)); } finally { setBusy(false); }
  }, [checkLink]);

  // Shared / deep-linked / clipboard links run automatically once setup is complete.
  useEffect(() => {
    if (params.url && ready && setupDone && !autoRan.current) { autoRan.current = true; void run(String(params.url)); }
  }, [params.url, ready, setupDone, run]);

  if (ready && !setupDone) return <Redirect href="/onboarding" />;
  const paste = async () => { const t = await Clipboard.getStringAsync(); if (t) setInput(t.trim()); };
  const sourceLabel = params.source === "share" ? "Shared into Apollo" : params.source === "clipboard" ? "From your clipboard" : params.source === "link" ? "Opened via link" : null;

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Check a link</Text>
        <Pressable testID="check-close" accessibilityRole="button" accessibilityLabel="Close" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
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
              onSubmitEditing={() => run(input)}
            />
            <Pressable testID="check-paste-button" accessibilityLabel="Paste" onPress={paste} style={s.paste}><ClipboardPaste size={20} color={colors.onSurfaceSecondary} /></Pressable>
          </View>
          {sourceLabel ? <Pill tone="neutral" label={sourceLabel} testID="check-source-pill" /> : null}
          <Button testID="check-submit-button" label={busy ? "Checking…" : "Check with Apollo"} onPress={() => run(input)} disabled={busy || !input.trim()} icon={busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : undefined} />
          <Text style={s.hint}>Checked on your device first. Only the link itself (no page content) is sent for a reputation check.</Text>

          {outcome && state ? (
            <Animated.View entering={FadeInDown.duration(350)}>
              <Card testID="check-result-card" style={{ borderColor: toneColor(colors, liveEvent?.state === "biting" && liveEvent.resolved_at ? "resting" : state), gap: spacing.sm }}>
                <Pill tone={state} label={STATE_LABEL[state]} testID="check-result-state" />
                {liveEvent?.state === "biting" && liveEvent.resolved_at ? <Pill tone="resting" label="Threat contained" testID="check-result-contained" /> : null}
                {liveEvent?.state === "biting" ? (
                  <>
                    <Text style={s.headline} testID="check-result-headline">Apollo is guarding — I blocked a dangerous website.</Text>
                    <Body>{outcome.decision.claimed_brand ? `It was pretending to be ${outcome.decision.claimed_brand}. ` : ""}No action is needed unless you already entered information.</Body>
                  </>
                ) : (
                  <>
                    <Text style={s.headline} testID="check-result-headline">{liveEvent?.headline ?? outcome.decision.headline}</Text>
                    <Body>{liveEvent?.what_happened ?? outcome.decision.what_happened}</Body>
                  </>
                )}
                {outcome.intel?.redirect_chain?.length ? <Pill tone="unknown" label={`Redirected: ${outcome.intel.redirect_chain.join(" → ")}`} testID="check-result-redirects" /> : null}
                {outcome.decision.claimed_brand ? <Pill tone={state === "resting" ? "resting" : "barking"} label={`Claims to be ${outcome.decision.claimed_brand}`} testID="check-result-brand" /> : null}
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
              {liveEvent ? (
                <Card style={{ marginTop: spacing.md, gap: spacing.sm }} testID="check-gate3-actions">
                  <Button testID="check-verify-website" variant="secondary" label="Verify website" onPress={() => setVerify(true)} />
                  <Button testID="check-tech-details" variant="ghost" label={liveEvent.state === "biting" ? "What happened? / Technical details" : "Technical details"} onPress={() => setTech(true)} />
                  {liveEvent.state !== "resting" ? <RecoveryFlow event={liveEvent} kinds={["clicked", "password", "card", "code", "download", "app", "called"]} testID="check-recovery" /> : null}
                  {(liveEvent.state === "growling" || liveEvent.state === "ears_up") && liveEvent.status === "active" ? (
                    <Button testID="check-continue-anyway" variant="ghost" label="Continue anyway (Apollo still recommends leaving)" onPress={() => { void upsertEvent({ ...liveEvent, why: [...liveEvent.why, "You chose to continue anyway. Apollo still recommends leaving this site."] }); void sendFeedback("override", liveEvent, outcome.intel?.sources.map((x) => x.name) ?? []); showToast("Recorded. Apollo still recommends leaving this site.", "growling"); }} />
                  ) : null}
                  {liveEvent.state !== "resting" ? <Button testID="check-report-mistake" variant="ghost" label="Report mistake" onPress={() => setReport(true)} /> : null}
                </Card>
              ) : null}
            </Animated.View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <Sheet visible={verify} onClose={() => setVerify(false)} title="Verify website" testID="verify-website-sheet">
        {(() => { const v = outcome?.local.host ? verifyWebsite(outcome.local.host, outcome.decision.claimed_brand) : null; return v ? (
          <>
            <Pill tone={v.matches === true ? "resting" : v.matches === false ? "barking" : "unknown"} label={v.title} testID="verify-website-title" />
            {v.lines.map((l, i) => <Body key={i} testID={`verify-website-line-${i}`}>{l}</Body>)}
            <Body>Apollo compares against an independently maintained list of official domains — never information from the page itself.</Body>
          </>
        ) : null; })()}
        <Button testID="verify-website-close" variant="ghost" label="Done" onPress={() => setVerify(false)} />
      </Sheet>

      <Sheet visible={tech} onClose={() => setTech(false)} title="Technical details" testID="tech-details-sheet">
        {outcome ? (
          <>
            <Body>Checked: {outcome.local.normalizedUrl ?? outcome.local.input}</Body>
            {outcome.intel?.final_url ? <Body>Final destination: {outcome.intel.final_url}</Body> : null}
            <Body>On-device score: {outcome.local.score}/100 ({outcome.local.level}). Signals: {outcome.local.signals.map((x) => x.code).join(", ") || "none"}.</Body>
            <Body>Intelligence: {outcome.intel ? outcome.intel.sources.map((x) => `${x.name} = ${x.status}`).join("; ") : "unavailable"}. Verdict: {outcome.intel?.verdict ?? "n/a"}. Coverage: {outcome.intel?.coverage ?? "none"}.</Body>
            <Body>Adapter: {liveEvent?.adapter_label}. Verified block: {liveEvent?.verified_block ? "yes" : "no"}. Event: {liveEvent?.event_id.slice(0, 8)}…</Body>
          </>
        ) : null}
        <Button testID="tech-details-close" variant="ghost" label="Done" onPress={() => setTech(false)} />
      </Sheet>

      <Sheet visible={report} onClose={() => setReport(false)} title="Report a mistake" testID="report-sheet">
        <Body>Think Apollo got this wrong? Your report includes the event, Apollo&apos;s decision, the domain and which intelligence sources responded — nothing else. A human reviews it; one report never whitelists a site for everyone.</Body>
        <Button testID="report-send" label="Send report" onPress={() => { if (liveEvent) void sendFeedback("false_positive", liveEvent, outcome?.intel?.sources.map((x) => x.name) ?? []); setReport(false); showToast("Thanks — report sent for review.", "resting"); }} />
        <Button testID="report-cancel" variant="ghost" label="Cancel" onPress={() => setReport(false)} />
      </Sheet>
    </View>
  );
}
