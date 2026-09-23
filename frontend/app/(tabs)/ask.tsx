import * as Crypto from "expo-crypto";
import { useLocalSearchParams, useRouter } from "expo-router";
import SendHorizontal from "lucide-react-native/icons/send-horizontal";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { InvestigationView } from "@/src/components/InvestigationView";
import { RootScreenHeader } from "@/src/components/RootScreenHeader";
import { Body, Button, Card, Pill } from "@/src/components/ui";
import { clearHandoffTransfers, takeHandoff } from "@/src/domain/handoffTransfer";
import { parseHigginsIssueContext, type HigginsIssueContext } from "@/src/domain/higginsHandoff";
import { redactInvestigationSecrets as redactUserSecrets } from "@/src/domain/privacy";
import { askHiggins, clearHigginsHistory, higginsHistory, rememberHigginsContext, type HigginsChatAction, type HigginsChatMessage } from "@/src/higgins/chatClient";
import { clearLocalChat, loadLocalChat, saveLocalChat } from "@/src/higgins/chatMemory";
import { higginsHubHistory, type HigginsHistoryItem } from "@/src/higgins/hubClient";
import { useInvestigation } from "@/src/investigation/caseStore";
import { createCaseInput } from "@/src/investigation/fromContext";
import { rememberCaseForEvent } from "@/src/investigation/caseIndex";
import { useProtectionHealth } from "@/src/protection/healthStore";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { stopHiggins } from "@/src/voice/higgins";

const SUGGESTIONS = ["What does it mean when Apollo growls?", "Why can't Apollo see my whole phone?", "How do I spot a scam text link?", "What should I do after Apollo barks?"];
const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface }, list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.md },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, backgroundColor: c.glass, borderTopWidth: 1, borderTopColor: c.border },
  input: { flex: 1, minHeight: 48, maxHeight: 120, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontFamily: fonts.text, fontSize: 16, color: c.onSurface },
  send: { width: 48, height: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: c.brandPrimary }, chipRow: { minHeight: 56, paddingHorizontal: spacing.xl, gap: spacing.sm, alignItems: "center" },
  chip: { minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary, justifyContent: "center", flexShrink: 0 }, chipText: { fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurfaceSecondary },
  disclaimer: { fontFamily: fonts.text, fontSize: 13, lineHeight: 18, color: c.muted, paddingHorizontal: spacing.xl, paddingBottom: spacing.sm }, context: { marginHorizontal: spacing.xl, marginBottom: spacing.sm, gap: spacing.xs, borderColor: c.navyBorder },
  user: { alignSelf: "flex-end", maxWidth: "88%", backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: c.border },
  higgins: { alignSelf: "flex-start", maxWidth: "94%", backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, borderLeftWidth: 3, borderLeftColor: c.gold }, message: { fontFamily: fonts.text, fontSize: 16, lineHeight: 24, color: c.onSurface },
  hubTitle: { fontFamily: fonts.displayBold, fontSize: 20, color: c.onSurface }, hubGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md }, hubCard: { minWidth: 150, flex: 1, gap: spacing.sm }, historyTitle: { fontFamily: fonts.textSemibold, fontSize: 16, color: c.onSurface },
}));

export default function Ask() {
  const s = useStyles(); const { colors } = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter(); const { deviceId } = useApollo(); const health = useProtectionHealth();
  const params = useLocalSearchParams<{ context?: string; prompt?: string; handoffId?: string; operationId?: string; resumeCaseId?: string }>();
  const { state, start, ask, retry, cancel, remove, attach, retryDelete } = useInvestigation(params.operationId ? String(params.operationId) : null);
  const [text, setText] = useState(""); const [activeContext, setActiveContext] = useState<HigginsIssueContext | null>(null); const [investigationMode, setInvestigationMode] = useState(false);
  const [chatMessages, setChatMessages] = useState<HigginsChatMessage[]>([]); const [chatBusy, setChatBusy] = useState(false); const [chatError, setChatError] = useState<string | null>(null); const [lastAction, setLastAction] = useState<HigginsChatAction | null>(null);
  const [hubItems, setHubItems] = useState<HigginsHistoryItem[]>([]); const [hubLoading, setHubLoading] = useState(false); const [hubError, setHubError] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null); const conversationId = useRef(Crypto.randomUUID()); const seenRoute = useRef<string | null>(null); const scrollRef = useRef<ScrollView>(null); const inputRef = useRef<TextInput>(null); const contextRecorded = useRef<string | null>(null);
  const caseBusy = state.phase === "creating" || state.phase === "working" || state.phase === "reconnecting" || state.phase === "waiting_device";
  const busy = caseBusy || chatBusy;
  const latestUserMessage = useMemo(() => [...chatMessages].reverse().find((message) => message.role === "user")?.content ?? "", [chatMessages]);

  useEffect(() => {
    if (!deviceId) return;
    void loadLocalChat().then(setChatMessages).catch(() => undefined);
    void higginsHistory(deviceId).catch(() => undefined); // server keeps only five-minute content and non-content receipts
    setHubLoading(true); setHubError(false);
    void higginsHubHistory(12).then((hub) => setHubItems(hub.items)).catch(() => setHubError(true)).finally(() => setHubLoading(false));
  }, [deviceId]);
  useEffect(() => { const caseId = params.resumeCaseId ? String(params.resumeCaseId) : ""; if (!caseId || caseId === seenRoute.current) return; seenRoute.current = caseId; setInvestigationMode(true); router.setParams({ resumeCaseId: "" }); void attach(caseId); }, [params.resumeCaseId, attach, router]);
  useEffect(() => { if (!params.handoffId && params.prompt && !investigationMode) { setText(redactUserSecrets(String(params.prompt))); router.setParams({ prompt: "" }); } }, [params.prompt, params.handoffId, investigationMode, router]);
  useEffect(() => {
    if (!deviceId || health.checking || !health.checkedAt || contextRecorded.current === health.checkedAt) return;
    contextRecorded.current = health.checkedAt;
    const on = health.gates.filter((gate) => gate.capability.automatic?.state === "running").length; const attention = health.gates.filter((gate) => gate.tone === "attention").map((gate) => gate.title);
    void rememberHigginsContext({ category: "protection_state", provenance: "device_observation", observedAt: health.checkedAt, summary: `${on} automatic protections are on.${attention.length ? ` Needs attention: ${attention.join(", ")}.` : ""}` }).catch(() => undefined);
  }, [deviceId, health]);

  const startInvestigation = (message: string, context?: HigginsIssueContext | null) => {
    const clean = redactUserSecrets(message).trim(); if (!clean || busy || !deviceId) return;
    setInvestigationMode(true); setText(""); setRouteError(null); setChatError(null); setLastAction(null);
    const { input, files } = createCaseInput(context ?? activeContext, clean); const operationId = Crypto.randomUUID(); router.setParams({ operationId });
    void start(input, files, operationId).then((created) => { if (created && (context ?? activeContext)?.event_id) void rememberCaseForEvent((context ?? activeContext)!.event_id!, created.id); });
  };
  const submit = (message: string) => {
    const clean = redactUserSecrets(message).trim(); if (!clean || busy || !deviceId) return;
    if (investigationMode || activeContext || state.caseData) { setText(""); if (state.caseData) void ask(clean); else startInvestigation(clean, activeContext); return; }
    setText(""); setChatBusy(true); setChatError(null); setLastAction(null);
    const turnId = Crypto.randomUUID();
    const optimistic: HigginsChatMessage = { id: Crypto.randomUUID(), turnId, role: "user", content: clean, createdAt: new Date().toISOString(), conversationId: conversationId.current };
    const previousTurnIds = [...new Set(chatMessages.map((item) => item.turnId))].slice(-8);
    setChatMessages((current) => { const next = [...current, optimistic]; void saveLocalChat(next); return next; });
    void askHiggins(clean, conversationId.current, turnId, previousTurnIds).then((reply) => {
      setChatMessages((current) => { const next = [...current, { id: Crypto.randomUUID(), turnId: reply.turnId, role: "higgins" as const, content: `${reply.answer}${reply.clarification ? `\n\n${reply.clarification}` : ""}`, createdAt: new Date().toISOString(), conversationId: reply.conversationId }]; void saveLocalChat(next); return next; });
      setLastAction(reply.suggestedActions[0] ?? null);
    }).catch(() => setChatError("Higgins could not answer ordinary chat right now. No investigation was started.")).finally(() => setChatBusy(false));
  };

  useEffect(() => {
    const id = params.handoffId ? String(params.handoffId) : ""; if (!id || id === seenRoute.current || !deviceId) return; seenRoute.current = id;
    const transfer = takeHandoff(id); const context = transfer?.context ?? (params.context ? parseHigginsIssueContext(String(params.context)) : null); router.setParams({ handoffId: "", context: "", prompt: "" });
    if (!context) { setRouteError("Apollo could not prepare this issue for Higgins. Return to the result and try again."); return; }
    const question = transfer?.question ?? redactUserSecrets(String(params.prompt ?? "")).trim(); setActiveContext(context); setInvestigationMode(true); stopHiggins();
    if (context.case_id) { void attach(context.case_id).then((opened) => { if (opened && question) void ask(question); }); return; }
    startInvestigation(question, context);
  }, [params.handoffId, params.context, params.prompt, deviceId, router, attach, ask]);

  const deleteInvestigation = async () => { stopHiggins(); clearHandoffTransfers(); setActiveContext(null); setRouteError(null); setInvestigationMode(false); await remove(); };
  const clearChat = async () => { if (!deviceId || chatBusy) return; await Promise.all([clearHigginsHistory(deviceId), clearLocalChat()]); setChatMessages([]); setLastAction(null); setChatError(null); conversationId.current = Crypto.randomUUID(); };
  const newQuestion = () => { if (busy) return; stopHiggins(); setActiveContext(null); setInvestigationMode(false); void remove(); };
  const openCase = (caseId: string) => { if (busy) return; setInvestigationMode(true); setActiveContext(null); void attach(caseId); };
  const activeHub = hubItems.filter((item) => item.kind === "investigation" && item.status === "active");
  const recentHub = hubItems.filter((item) => item.status !== "active").slice(0, 2);
  const caseStatus = state.phase === "answered" ? "Investigation answer complete within its stated scope" : state.phase === "waiting_user" ? "Higgins needs one answer from you" : state.phase === "failed" ? "Investigation incomplete — Retry available" : state.phase === "expired" ? "Temporary investigation content expired" : caseBusy ? "Higgins is investigating…" : "Investigation content expires within 15 minutes";

  return <View style={s.root} testID="higgins-screen"><View style={{ paddingTop: insets.top + spacing.md }}><RootScreenHeader title="Higgins" testID="ask-header" rightAccessory={<Pill tone={investigationMode ? "growling" : "neutral"} label={investigationMode ? "Investigation" : "Ordinary chat"} testID="ask-scope-pill" />} /></View>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={0}>
      {activeContext ? <Card style={s.context} testID="ask-active-issue"><Pill tone={activeContext.assessment_state} label={`${activeContext.gate.toUpperCase()} GATE`} testID="ask-active-gate" /><Body testID="ask-active-summary">{activeContext.issue_summary}</Body>{state.caseData ? <Body testID="ask-handoff-reference">Case reference: {state.caseData.id.slice(0, 8)}</Body> : null}<Button testID="ask-new-conversation" variant="ghost" label="Return to ordinary chat" onPress={newQuestion} disabled={busy} /></Card> : null}
      <ScrollView ref={scrollRef} contentContainerStyle={s.list} testID="ask-messages" onContentSizeChange={() => { if (chatMessages.length || investigationMode) scrollRef.current?.scrollToEnd({ animated: true }); }}>
        {!investigationMode ? <View testID="higgins-hub" style={{ gap: spacing.lg }}><Text style={s.hubTitle} testID="higgins-hub-title">How Higgins can help</Text><View style={s.hubGrid}>
          <Card style={s.hubCard} testID="higgins-hub-chat"><Text style={s.historyTitle}>Ordinary chat</Text><Body>Get a plain-language explanation without starting investigative work.</Body><Button testID="higgins-hub-chat-button" label="Chat with Higgins" onPress={() => inputRef.current?.focus()} /></Card>
          <Card style={s.hubCard} testID="higgins-hub-learning"><Text style={s.historyTitle}>Learning</Text><Body>Build simple habits for spotting and recovering from scams.</Body><Button testID="higgins-hub-learning-button" variant="secondary" label="Learn with Higgins" onPress={() => router.push("/higgins/learning")} /></Card>
          <Card style={s.hubCard} testID="higgins-hub-scams"><Text style={s.historyTitle}>New scams</Text><Body>Read alerts from configured Australian government feeds.</Body><Button testID="higgins-hub-scams-button" variant="secondary" label="View government alerts" onPress={() => router.push("/higgins/scams")} /></Card>
          <Card style={s.hubCard} testID="higgins-hub-reports"><Text style={s.historyTitle}>Saved reports</Text><Body>Return to investigation reports you deliberately kept.</Body><Button testID="higgins-hub-reports-button" variant="secondary" label="Open saved reports" onPress={() => router.push("/saved-reports")} /></Card>
        </View>
        <Card testID="higgins-hub-current" style={{ gap: spacing.md }}><View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}><Text style={s.historyTitle}>Current investigations</Text><Pill testID="higgins-hub-current-count" tone={activeHub.length ? "growling" : "neutral"} label={hubLoading ? "Checking" : hubError ? "Unavailable" : `${activeHub.length} current`} /></View>{hubError ? <><Body>Current work could not be loaded. Other Higgins sections are still available.</Body><Button testID="higgins-hub-retry" variant="secondary" label="Try current work again" onPress={() => { setHubLoading(true); setHubError(false); void higginsHubHistory(12).then((hub) => setHubItems(hub.items)).catch(() => setHubError(true)).finally(() => setHubLoading(false)); }} /></> : activeHub.length ? activeHub.slice(0, 2).map((item) => <View key={item.id} style={{ gap: spacing.sm }}><Body>{item.summary}</Body><Button testID={`higgins-hub-resume-${item.id}`} variant="secondary" label="Continue investigation" onPress={() => openCase(item.caseId!)} /></View>) : <Body>No investigation is currently running.</Body>}</Card>
        {recentHub.length ? <Card testID="higgins-hub-recent" style={{ gap: spacing.md }}><Text style={s.historyTitle}>Recent Higgins activity</Text>{recentHub.map((item) => <View key={item.id}><Text style={s.historyTitle}>{item.title}</Text><Body>{item.summary}</Body></View>)}</Card> : null}
        <Button testID="higgins-hub-history-button" variant="ghost" label="View Higgins history" onPress={() => router.push("/higgins/history")} />
        </View> : null}
        {!investigationMode && chatMessages.length === 0 ? <Card testID="ask-empty"><Body>Ask Higgins to explain a warning, term or safe next step. Ordinary chat does not inspect links, files or your device and does not start an investigation.</Body></Card> : null}
        {!investigationMode ? chatMessages.map((message) => <View key={message.id} testID={`ask-chat-${message.id}`} style={message.role === "user" ? s.user : s.higgins}><Text style={s.message}>{message.content}</Text></View>) : null}
        {chatBusy ? <Card testID="ask-chat-progress"><ActivityIndicator color={colors.gold} /><Body>Higgins is preparing a general answer. No investigation has started.</Body></Card> : null}
        {chatError ? <Card testID="ask-chat-error"><Text style={[s.message, { color: colors.barkingText }]}>{chatError}</Text></Card> : null}
        {!investigationMode && lastAction?.destination === "higgins_case" && latestUserMessage ? <Card testID="ask-investigation-offer"><Body>{lastAction.purpose}</Body><Button testID="ask-start-investigation" label={lastAction.label} onPress={() => startInvestigation(latestUserMessage)} /></Card> : null}
        {!investigationMode && lastAction?.destination === "check_it" ? <Card testID="ask-check-it-offer"><Body>{lastAction.purpose}</Body><Button testID="ask-open-check-it" label={lastAction.label} onPress={() => router.push("/(tabs)/check-it")} /></Card> : null}
        {investigationMode ? <InvestigationView state={state} onAnswer={(answer) => void ask(answer)} onRetry={() => void retry()} onCancel={() => void cancel()} testID="ask-investigation" onAction={(action, outcome) => { if (outcome.kind === "observed") void ask(`I did "${action.label}". Please re-check using the fresh observation Apollo just recorded.`); }} /> : null}
        {routeError ? <Card style={s.context} testID="ask-error-card"><Text style={{ color: colors.barkingText, fontFamily: fonts.text }} testID="ask-error">{routeError}</Text></Card> : null}
      </ScrollView>
      {investigationMode && state.phase === "failed" ? <Button testID="ask-retry-button" label="Retry" onPress={() => void retry()} style={{ marginHorizontal: spacing.xl }} /> : null}
      {investigationMode && state.undeleted ? <Button testID="ask-retry-delete" variant="ghost" label="Retry server deletion" onPress={() => void retryDelete()} /> : null}
      <Button testID={investigationMode ? "ask-clear-temporary-history" : "ask-clear-chat-history"} label={investigationMode ? "Clear this investigation" : "Clear chat history"} variant="ghost" onPress={() => investigationMode ? void deleteInvestigation() : void clearChat()} />
      <Text testID="ask-processing-state" style={s.disclaimer}>{investigationMode ? caseStatus : "Ordinary chat uses redacted, recent Apollo context. It cannot inspect evidence or start work by itself."}</Text>
      {!investigationMode && chatMessages.length === 0 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow} testID="ask-suggestions">{SUGGESTIONS.map((question, index) => <Pressable key={question} testID={`ask-suggestion-${index}`} style={s.chip} onPress={() => submit(question)} disabled={busy}><Text style={s.chipText}>{question}</Text></Pressable>)}</ScrollView> : null}
      <View style={[s.inputBar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}><TextInput ref={inputRef} testID="ask-input" style={s.input} value={text} onChangeText={setText} placeholder={investigationMode ? state.phase === "waiting_user" ? "Answer Higgins' investigation question…" : "Ask about this investigation…" : "Ask Higgins a general cyber-safety question…"} placeholderTextColor={colors.muted} multiline returnKeyType="send" blurOnSubmit onSubmitEditing={() => submit(text)} />
        <Pressable testID="ask-send-button" accessibilityRole="button" accessibilityLabel="Send question to Higgins" onPress={() => submit(text)} disabled={busy || !text.trim()} style={[s.send, { opacity: busy || !text.trim() ? 0.5 : 1 }]}>{busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <SendHorizontal size={20} color={colors.onBrandPrimary} />}</Pressable></View>
    </KeyboardAvoidingView>
  </View>;
}