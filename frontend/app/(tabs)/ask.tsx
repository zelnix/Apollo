import { useLocalSearchParams, useRouter } from "expo-router";
import SendHorizontal from "lucide-react-native/icons/send-horizontal";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { InvestigationView } from "@/src/components/InvestigationView";
import { Body, Button, Card, Pill, ScreenHeader } from "@/src/components/ui";
import { clearHandoffTransfers, takeHandoff } from "@/src/domain/handoffTransfer";
import { parseHigginsIssueContext, type HigginsIssueContext } from "@/src/domain/higginsHandoff";
import { redactInvestigationSecrets as redactUserSecrets } from "@/src/domain/privacy";
import { useInvestigation } from "@/src/investigation/caseStore";
import { createCaseInput } from "@/src/investigation/fromContext";
import { useApollo } from "@/src/store/ApolloContext";
import { stopHiggins } from "@/src/voice/higgins";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const SUGGESTIONS = ["What does it mean when Apollo growls?", "Why can't Apollo see my whole phone?", "How do I spot a scam text link?", "What should I do after Apollo barks?"];

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface }, list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.md },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, backgroundColor: c.glass, borderTopWidth: 1, borderTopColor: c.border },
  input: { flex: 1, minHeight: 48, maxHeight: 120, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  send: { width: 48, height: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: c.brandPrimary }, chipRow: { height: 56, paddingHorizontal: spacing.xl, gap: spacing.sm, alignItems: "center" },
  chip: { height: 36, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary, justifyContent: "center", flexShrink: 0 }, chipText: { fontFamily: fonts.textMedium, fontSize: 13, color: c.onSurfaceSecondary },
  disclaimer: { fontFamily: fonts.text, fontSize: 12, color: c.muted, paddingHorizontal: spacing.xl, paddingBottom: spacing.sm }, context: { marginHorizontal: spacing.xl, marginBottom: spacing.sm, gap: spacing.xs, borderColor: c.navyBorder },
}));

export default function Ask() {
  const s = useStyles(); const { colors } = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter();
  const { deviceId } = useApollo();
  const params = useLocalSearchParams<{ context?: string; prompt?: string; handoffId?: string }>();
  const { state, start, ask, retry, cancel, remove, attach } = useInvestigation();
  const [text, setText] = useState(""); const [activeContext, setActiveContext] = useState<HigginsIssueContext | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const seenRoute = useRef<string | null>(null); const scrollRef = useRef<ScrollView>(null);
  const busy = state.phase === "creating" || state.phase === "working" || state.phase === "reconnecting" || state.phase === "waiting_device";

  const submit = (message: string, context?: HigginsIssueContext | null) => {
    const clean = redactUserSecrets(message).trim();
    if (!clean || busy || !deviceId) return;
    setText(""); setRouteError(null);
    if (state.caseData && state.phase !== "expired" && state.phase !== "idle") { void ask(clean); return; }
    const { input, files } = createCaseInput(context ?? activeContext, clean);
    void start(input, files);
  };

  useEffect(() => {
    const id = params.handoffId ? String(params.handoffId) : "";
    if (!id || id === seenRoute.current || !deviceId) return;
    seenRoute.current = id;
    const transfer = takeHandoff(id);
    const context = transfer?.context ?? (params.context ? parseHigginsIssueContext(String(params.context)) : null);
    router.setParams({ handoffId: "", context: "", prompt: "" });
    if (!context) { setRouteError("Apollo could not prepare this issue for Higgins. Return to the result and try again."); return; }
    const question = transfer?.question ?? redactUserSecrets(String(params.prompt ?? "")).trim();
    setActiveContext(context);
    stopHiggins();
    if (context.case_id) { void attach(context.case_id).then((c) => { if (c && question) void ask(question); }); return; }
    const { input, files } = createCaseInput(context, question);
    void start(input, files);
  }, [params.handoffId, params.context, params.prompt, deviceId, router, start, attach, ask]);

  const deleteAll = async () => { stopHiggins(); clearHandoffTransfers(); setActiveContext(null); setRouteError(null); await remove(); };
  const newQuestion = () => { if (busy) return; stopHiggins(); setActiveContext(null); void remove(); };
  const status = state.phase === "answered" ? "Answer complete" : state.phase === "waiting_user" ? "Higgins needs one answer from you" : state.phase === "failed" ? "Answer incomplete — Retry available" : state.phase === "expired" ? "Temporary content expired" : busy ? "Higgins is investigating…" : "Temporary content expires within 15 minutes";
  const completedTurns = state.turns.length;
  return <View style={s.root}>
    <View style={{ paddingTop: insets.top + spacing.md }}><ScreenHeader title="Ask Higgins" testID="ask-header" right={<Pill tone="neutral" label="Investigates with research" testID="ask-scope-pill" />} /></View>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={0}>
      {activeContext ? <Card style={s.context} testID="ask-active-issue"><Pill tone={activeContext.assessment_state} label={`${activeContext.gate.toUpperCase()} GATE`} testID="ask-active-gate" /><Body testID="ask-active-summary">{activeContext.issue_summary}</Body>
        {state.caseData ? <Body testID="ask-handoff-reference">Case reference: {state.caseData.id.slice(0, 8)}</Body> : null}
        <Body testID="ask-conversation-counts">{completedTurns} completed answer{completedTurns === 1 ? "" : "s"} in this case</Body>
        <Button testID="ask-new-conversation" variant="ghost" label="Start an unrelated question" onPress={newQuestion} disabled={busy} /></Card> : null}
      <ScrollView ref={scrollRef} contentContainerStyle={s.list} testID="ask-messages" onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
        {state.phase === "idle" && !routeError ? <Body testID="ask-empty">Ask about a warning, a message, a link, a call or a setting. Higgins investigates with Apollo's evidence and real research, then explains plainly.</Body> : null}
        <InvestigationView state={state} onAnswer={(answer) => void ask(answer)} onRetry={() => void retry()} onCancel={() => void cancel()} testID="ask-investigation" />
        {routeError ? <Card style={s.context} testID="ask-error-card"><Text style={{ color: colors.barkingText, fontFamily: fonts.text }} testID="ask-error">{routeError}</Text></Card> : null}
      </ScrollView>
      {state.phase === "failed" ? <Button testID="ask-retry-button" label="Retry" onPress={() => void retry()} style={{ marginHorizontal: spacing.xl }} /> : null}
      <Button testID="ask-clear-temporary-history" label="Clear temporary history" variant="ghost" onPress={() => void deleteAll()} />
      <Text testID="ask-processing-state" style={s.disclaimer}>{status}</Text>
      {!activeContext && !state.caseData ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow} testID="ask-suggestions">{SUGGESTIONS.map((question, index) => <Pressable key={question} testID={`ask-suggestion-${index}`} style={s.chip} onPress={() => submit(question)} disabled={busy}><Text style={s.chipText}>{question}</Text></Pressable>)}</ScrollView> : null}
      <View style={[s.inputBar, { paddingBottom: spacing.sm }]}><TextInput testID="ask-input" style={s.input} value={text} onChangeText={setText} placeholder={state.phase === "waiting_user" ? "Answer Higgins' question…" : state.caseData ? "Ask a follow-up about this investigation…" : "Ask Higgins about a warning, message or term…"} placeholderTextColor={colors.muted} multiline returnKeyType="send" blurOnSubmit onSubmitEditing={() => submit(text)} />
        <Pressable testID="ask-send-button" accessibilityRole="button" accessibilityLabel="Send question to Higgins" onPress={() => submit(text)} disabled={busy || !text.trim()} style={[s.send, { opacity: busy || !text.trim() ? 0.5 : 1 }]}>{busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <SendHorizontal size={20} color={colors.onBrandPrimary} />}</Pressable></View>
      <Text style={s.disclaimer}>Guidance only. Higgins investigates, interprets and guides; Apollo performs supported checks and protective actions.</Text>
    </KeyboardAvoidingView>
  </View>;
}
