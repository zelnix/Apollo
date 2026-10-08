import * as Crypto from "expo-crypto";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import Trash2 from "lucide-react-native/icons/trash-2";
import Info from "lucide-react-native/icons/info";
import SendHorizontal from "lucide-react-native/icons/send-horizontal";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { InvestigationView } from "@/src/components/InvestigationView";
import { Sheet } from "@/src/components/Sheet";
import { TypingDots } from "@/src/components/TypingDots";
import { Body, Button, Card, DevTag, Pill } from "@/src/components/ui";
import { clearHandoffTransfers, takeHandoff } from "@/src/domain/handoffTransfer";
import { parseHigginsIssueContext, type HigginsIssueContext } from "@/src/domain/higginsHandoff";
import { redactInvestigationSecrets as redactUserSecrets } from "@/src/domain/privacy";
import { askHiggins, clearHigginsHistory, higginsHistory, rememberHigginsContext, type HigginsChatAction, type HigginsChatMessage } from "@/src/higgins/chatClient";
import { clearLocalChat, loadLocalChat, saveLocalChat } from "@/src/higgins/chatMemory";
import { clearStarterMemory, loadStarterMemory, recordStarter, topStarters } from "@/src/higgins/starterMemory";
import { useInvestigation } from "@/src/investigation/caseStore";
import { createCaseInput } from "@/src/investigation/fromContext";
import { rememberCaseForEvent } from "@/src/investigation/caseIndex";
import { useProtectionHealth } from "@/src/protection/healthStore";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { stopHiggins } from "@/src/voice/higgins";

const WELCOME = "Hello! I'm Higgins.\n\nI'm here to help you understand Apollo, explain security alerts, and answer your cyber-safety questions.\n\nWhat can I help you with today?";
const STARTERS = ["Why is Apollo barking?", "Is my device protected?", "Explain a scam warning."];
const ABOUT = "Higgins is Apollo’s trusted handler. He can explain Apollo's protection statuses and warnings, answer general cyber-safety questions, interpret recent Apollo information when it's actually available, explain what you should do next, and point you to the right Check, Gates or app screen.\n\nHiggins can't inspect links, files or your device, run a scan, verify protection, or start an investigation on his own — Apollo does that. Apollo acts; Higgins interprets.\n\nChatting uses redacted, recent Apollo context and never includes secrets.";

const formatTime = (iso: string) => { try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  header: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.xl, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: c.border },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: c.navyTint, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarImg: { width: 42, height: 42 },
  aboutAvatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: c.navyTint, alignItems: "center", justifyContent: "center", overflow: "hidden", alignSelf: "center" },
  aboutAvatarImg: { width: "100%", height: 200, borderRadius: 16, marginBottom: spacing.sm },
  headerText: { flex: 1 },
  name: { fontFamily: fonts.displayBold, fontSize: 18, color: c.onSurface },
  subtitle: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceSecondary },
  menuBtn: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },

  list: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm },

  rowHiggins: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, maxWidth: "92%", alignSelf: "flex-start" },
  rowUser: { alignSelf: "flex-end", maxWidth: "88%", alignItems: "flex-end" },
  miniAvatar: { width: 26, height: 26, borderRadius: 13, overflow: "hidden", backgroundColor: c.navyTint, marginBottom: 16 },
  bubbleHiggins: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, borderTopLeftRadius: 4, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderWidth: 1, borderColor: c.border, flexShrink: 1 },
  bubbleUser: { backgroundColor: c.brandPrimary, borderRadius: radius.lg, borderTopRightRadius: 4, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  msgHiggins: { fontFamily: fonts.text, fontSize: 16, lineHeight: 24, color: c.onSurface },
  msgUser: { fontFamily: fonts.text, fontSize: 16, lineHeight: 24, color: c.onBrandPrimary },
  time: { fontFamily: fonts.text, fontSize: 11, color: c.muted, marginTop: 3, marginHorizontal: 6 },

  starters: { gap: spacing.sm, alignSelf: "flex-start", maxWidth: "92%", marginLeft: 34, marginTop: spacing.xs },
  starter: { minHeight: 44, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1, borderColor: c.brandPrimary, backgroundColor: c.surface, justifyContent: "center", alignSelf: "flex-start" },
  starterText: { fontFamily: fonts.textMedium, fontSize: 14, color: c.brandPrimary },

  composer: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, backgroundColor: c.glass, borderTopWidth: 1, borderTopColor: c.border },
  repeatRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.sm, alignItems: "center" },
  repeatChip: { maxWidth: 240, minHeight: 36, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary, justifyContent: "center" },
  repeatText: { fontFamily: fonts.textMedium, fontSize: 13, color: c.onSurfaceSecondary },
  input: { flex: 1, minHeight: 48, maxHeight: 120, backgroundColor: c.surfaceTertiary, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontFamily: fonts.text, fontSize: 16, color: c.onSurface },
  send: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: c.brandPrimary },

  context: { marginHorizontal: spacing.xl, marginTop: spacing.md, gap: spacing.xs, borderColor: c.navyBorder },

  sheetBody: { fontFamily: fonts.text, fontSize: 15, lineHeight: 23, color: c.onSurfaceSecondary },
  welcomePrompt: { fontFamily: fonts.textMedium, fontSize: 15, lineHeight: 22, color: c.onSurfaceSecondary, paddingHorizontal: spacing.xs },
  errorText: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.barkingText },
}));

export default function Ask() {
  const s = useStyles(); const { colors } = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter(); const { deviceId, isMock } = useApollo(); const health = useProtectionHealth();
  const params = useLocalSearchParams<{ context?: string; prompt?: string; handoffId?: string; operationId?: string; resumeCaseId?: string }>();
  const { state, start, ask, retry, cancel, remove, attach, retryDelete } = useInvestigation(params.operationId ? String(params.operationId) : null);
  const [text, setText] = useState(""); const [activeContext, setActiveContext] = useState<HigginsIssueContext | null>(null); const [investigationMode, setInvestigationMode] = useState(false);
  const [chatMessages, setChatMessages] = useState<HigginsChatMessage[]>([]); const [chatBusy, setChatBusy] = useState(false); const [chatError, setChatError] = useState<string | null>(null); const [lastAction, setLastAction] = useState<HigginsChatAction | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null); const [aboutOpen, setAboutOpen] = useState(false); const [confirmClear, setConfirmClear] = useState(false);
  const [starters, setStarters] = useState<string[]>([]);
  const conversationId = useRef(Crypto.randomUUID()); const seenRoute = useRef<string | null>(null); const scrollRef = useRef<ScrollView>(null); const inputRef = useRef<TextInput>(null); const contextRecorded = useRef<string | null>(null); const stick = useRef(true);
  const caseBusy = state.phase === "creating" || state.phase === "working" || state.phase === "reconnecting" || state.phase === "waiting_device";
  const busy = caseBusy || chatBusy;
  const latestUserMessage = useMemo(() => [...chatMessages].reverse().find((message) => message.role === "user")?.content ?? "", [chatMessages]);

  useEffect(() => {
    if (!deviceId) return;
    void loadLocalChat().then(setChatMessages).catch(() => undefined);
    void loadStarterMemory().then((entries) => setStarters(topStarters(entries))).catch(() => undefined);
    void higginsHistory(deviceId).catch(() => undefined); // server keeps only five-minute content and non-content receipts
  }, [deviceId]);
  useEffect(() => { const caseId = params.resumeCaseId ? String(params.resumeCaseId) : ""; if (!caseId || caseId === seenRoute.current) return; seenRoute.current = caseId; setInvestigationMode(true); router.setParams({ resumeCaseId: "" }); void attach(caseId); }, [params.resumeCaseId, attach, router]);
  useEffect(() => { if (!params.handoffId && params.prompt && !investigationMode) { setText(redactUserSecrets(String(params.prompt))); router.setParams({ prompt: "" }); } }, [params.prompt, params.handoffId, investigationMode, router]);
  useEffect(() => {
    if (!deviceId || health.checking || !health.checkedAt || contextRecorded.current === health.checkedAt) return;
    contextRecorded.current = health.checkedAt;
    const on = health.gates.filter((gate) => gate.capability.automatic?.state === "running" && !gate.capability.automatic?.manualOnly).length; const attention = health.gates.filter((gate) => gate.tone === "action").map((gate) => gate.title);
    void rememberHigginsContext({ category: "protection_state", provenance: "device_observation", observedAt: health.checkedAt, summary: `${on} automatic protections are on.${attention.length ? ` Needs attention: ${attention.join(", ")}.` : ""}` }).catch(() => undefined);
  }, [deviceId, health]);

  const scrollToEnd = useCallback((force = false) => { if (force || stick.current) requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true })); }, []);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => { const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent; stick.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 140; };

  const startInvestigation = useCallback((message: string, context?: HigginsIssueContext | null) => {
    const clean = redactUserSecrets(message).trim(); if (!clean || busy || !deviceId) return;
    setInvestigationMode(true); setText(""); setRouteError(null); setChatError(null); setLastAction(null);
    const { input, files } = createCaseInput(context ?? activeContext, clean); const operationId = Crypto.randomUUID(); router.setParams({ operationId });
    void start(input, files, operationId).then((created) => { if (created && (context ?? activeContext)?.event_id) void rememberCaseForEvent((context ?? activeContext)!.event_id!, created.id); });
  }, [activeContext, busy, deviceId, router, start]);

  const sendToHiggins = useCallback((message: string, appendUser: boolean) => {
    setChatBusy(true); setChatError(null); setLastAction(null); stick.current = true;
    const turnId = Crypto.randomUUID();
    const previousTurnIds = [...new Set(chatMessages.map((item) => item.turnId))].slice(-8);
    if (appendUser) {
      const optimistic: HigginsChatMessage = { id: Crypto.randomUUID(), turnId, role: "user", content: message, createdAt: new Date().toISOString(), conversationId: conversationId.current };
      setChatMessages((current) => { const next = [...current, optimistic]; void saveLocalChat(next); return next; });
    }
    void askHiggins(message, conversationId.current, turnId, previousTurnIds).then((reply) => {
      setChatMessages((current) => { const next = [...current, { id: Crypto.randomUUID(), turnId: reply.turnId, role: "higgins" as const, content: `${reply.answer}${reply.clarification ? `\n\n${reply.clarification}` : ""}`, createdAt: new Date().toISOString(), conversationId: reply.conversationId }]; void saveLocalChat(next); return next; });
      setLastAction(reply.suggestedActions[0] ?? null);
    }).catch(() => setChatError("Higgins could not answer right now. No investigation was started.")).finally(() => setChatBusy(false));
  }, [chatMessages]);

  const submit = (message: string) => {
    const clean = redactUserSecrets(message).trim(); if (!clean || busy || !deviceId) return;
    if (investigationMode || activeContext || state.caseData) { setText(""); if (state.caseData) void ask(clean); else startInvestigation(clean, activeContext); return; }
    setText(""); sendToHiggins(clean, true);
    void recordStarter(clean).then((entries) => setStarters(topStarters(entries))).catch(() => undefined);
  };
  const retryLast = () => { if (!deviceId || chatBusy || !latestUserMessage) return; sendToHiggins(latestUserMessage, false); };

  useEffect(() => {
    const id = params.handoffId ? String(params.handoffId) : ""; if (!id || id === seenRoute.current || !deviceId) return; seenRoute.current = id;
    const transfer = takeHandoff(id); const context = transfer?.context ?? (params.context ? parseHigginsIssueContext(String(params.context)) : null); router.setParams({ handoffId: "", context: "", prompt: "" });
    if (!context) { setRouteError("Apollo could not prepare this issue for Higgins. Return to the result and try again."); return; }
    const question = transfer?.question ?? redactUserSecrets(String(params.prompt ?? "")).trim(); setActiveContext(context); setInvestigationMode(true); stopHiggins();
    if (context.case_id) { void attach(context.case_id).then((opened) => { if (opened && question) void ask(question); }); return; }
    startInvestigation(question, context);
  }, [params.handoffId, params.context, params.prompt, deviceId, router, attach, ask, startInvestigation]);

  const deleteInvestigation = async () => { stopHiggins(); clearHandoffTransfers(); setActiveContext(null); setRouteError(null); setInvestigationMode(false); await remove(); };
  const clearChat = async () => { if (!deviceId || chatBusy) return; await Promise.all([clearHigginsHistory(deviceId), clearLocalChat(), clearStarterMemory()]); setChatMessages([]); setStarters([]); setLastAction(null); setChatError(null); conversationId.current = Crypto.randomUUID(); };
  const newQuestion = () => { if (busy) return; stopHiggins(); setActiveContext(null); setInvestigationMode(false); void remove(); };
  const caseStatus = state.phase === "answered" ? "Higgins has finished this investigation." : state.phase === "waiting_user" ? "Higgins needs one answer from you" : state.phase === "failed" ? "Investigation incomplete — Retry available" : state.phase === "expired" ? "Temporary investigation content expired" : caseBusy ? "Higgins is investigating…" : "Investigation content expires within 15 minutes";
  const showWelcome = !investigationMode && chatMessages.length === 0;
  const welcomeStarters = useMemo(() => [...new Set([...starters, ...STARTERS])].slice(0, 4), [starters]);
  const showRepeatRow = !investigationMode && chatMessages.length > 0 && !text.trim() && starters.length > 0;

  return <View style={s.root} testID="higgins-screen">
    <View style={{ paddingTop: insets.top + spacing.md }}>
      <View style={s.header} testID="higgins-header">
        <View style={s.avatar}><Image source={require("../../assets/images/higgins-avatar.png")} style={s.avatarImg} contentFit="cover" accessibilityLabel="Higgins" /></View>
        <View style={s.headerText}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Text style={s.name}>Higgins</Text>
            {isMock ? <DevTag label="Preview" testID="higgins-mock-pill" /> : null}
          </View>
          <Text style={s.subtitle} numberOfLines={1}>{investigationMode ? "Working with Apollo on this issue" : "Apollo’s trusted handler"}</Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          <Pressable testID="higgins-header-info" accessibilityRole="button" accessibilityLabel="About Higgins" hitSlop={8} style={s.menuBtn} onPress={() => setAboutOpen(true)}><Info size={21} color={colors.onSurface} /></Pressable>
          <Pressable testID="higgins-clear-chat" accessibilityRole="button" accessibilityLabel="Clear chat history" hitSlop={8} style={s.menuBtn} onPress={() => setConfirmClear(true)}><Trash2 size={20} color={colors.onSurface} /></Pressable>
        </View>
      </View>
    </View>

    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={0}>
      {activeContext ? <Card style={s.context} testID="ask-active-issue"><Pill tone={activeContext.assessment_state} label={`${activeContext.gate.toUpperCase()} GATE`} testID="ask-active-gate" /><Body testID="ask-active-summary">{activeContext.issue_summary}</Body>{state.caseData ? <Body testID="ask-handoff-reference">Case reference: {state.caseData.id.slice(0, 8)}</Body> : null}<Button testID="ask-new-conversation" variant="ghost" label="Back to chat" onPress={newQuestion} disabled={busy} /></Card> : null}

      <ScrollView ref={scrollRef} contentContainerStyle={s.list} testID="ask-messages" keyboardShouldPersistTaps="handled" scrollEventThrottle={64} onScroll={onScroll} onContentSizeChange={() => scrollToEnd(investigationMode)}>
        {showWelcome ? <>
          <Text style={s.welcomePrompt} testID="higgins-welcome">What can I help you with? Ask me anything, or tap ⓘ to learn what I do.</Text>
          <View style={s.starters} testID="ask-suggestions">
            {welcomeStarters.map((question, index) => <Pressable key={question} testID={`ask-suggestion-${index}`} style={s.starter} accessibilityRole="button" onPress={() => submit(question)} disabled={busy}><Text style={s.starterText} numberOfLines={2}>{question}</Text></Pressable>)}
          </View>
        </> : null}

        {!investigationMode ? chatMessages.map((message) => message.role === "user"
          ? <View key={message.id} testID={`ask-chat-${message.id}`} style={s.rowUser}><View style={s.bubbleUser}><Text style={s.msgUser}>{message.content}</Text></View><Text style={s.time}>{formatTime(message.createdAt)}</Text></View>
          : <View key={message.id} testID={`ask-chat-${message.id}`} style={s.rowHiggins}>
              <View style={s.miniAvatar}><Image source={require("../../assets/images/higgins-avatar.png")} style={{ width: 26, height: 26 }} contentFit="cover" /></View>
              <View style={{ flexShrink: 1 }}><View style={s.bubbleHiggins}><Text style={s.msgHiggins}>{message.content}</Text></View><Text style={s.time}>{formatTime(message.createdAt)}</Text></View>
            </View>) : null}

        {!investigationMode && chatBusy ? <View style={s.rowHiggins} testID="ask-chat-progress">
          <View style={s.miniAvatar}><Image source={require("../../assets/images/higgins-avatar.png")} style={{ width: 26, height: 26 }} contentFit="cover" /></View>
          <View style={s.bubbleHiggins}><TypingDots /></View>
        </View> : null}

        {!investigationMode && chatError ? <View style={s.rowHiggins} testID="ask-chat-error"><View style={[s.bubbleHiggins, { borderColor: colors.barking }]}><Text style={s.errorText}>{chatError}</Text><Button testID="ask-chat-retry" variant="ghost" label="Try again" onPress={retryLast} /></View></View> : null}

        {!investigationMode && lastAction?.destination === "higgins_case" && latestUserMessage ? <Card testID="ask-investigation-offer" style={{ marginTop: spacing.xs }}><Body>{lastAction.purpose}</Body><Button testID="ask-start-investigation" label={lastAction.label} onPress={() => startInvestigation(latestUserMessage)} /></Card> : null}
        {!investigationMode && lastAction?.destination === "check_it" ? <Card testID="ask-check-it-offer" style={{ marginTop: spacing.xs }}><Body>{lastAction.purpose}</Body><Button testID="ask-open-check-it" label={lastAction.label} onPress={() => router.push("/(tabs)/check-it")} /></Card> : null}

        {investigationMode ? <InvestigationView state={state} onAnswer={(answer) => void ask(answer)} onRetry={() => void retry()} onCancel={() => void cancel()} testID="ask-investigation" onAction={(action, outcome) => { if (outcome.kind === "observed") void ask(`I did "${action.label}". Please re-check using the fresh observation Apollo just recorded.`); }} /> : null}
        {routeError ? <Card style={s.context} testID="ask-error-card"><Text style={s.errorText} testID="ask-error">{routeError}</Text></Card> : null}
        {investigationMode && state.phase === "failed" ? <Button testID="ask-retry-button" label="Retry" onPress={() => void retry()} style={{ marginTop: spacing.md }} /> : null}
        {investigationMode && state.undeleted ? <Button testID="ask-retry-delete" variant="ghost" label="Try deleting again" onPress={() => void retryDelete()} /> : null}
        {investigationMode ? <Button testID="ask-clear-temporary-history" label="Clear this investigation" variant="ghost" onPress={() => void deleteInvestigation()} /> : null}
        {investigationMode ? <Text testID="ask-processing-state" style={[s.subtitle, { paddingHorizontal: spacing.lg, paddingTop: spacing.xs }]}>{caseStatus}</Text> : null}
      </ScrollView>

      {showRepeatRow ? <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={s.repeatRow} testID="higgins-repeat-row">
        {starters.map((question, index) => <Pressable key={question} testID={`higgins-repeat-${index}`} style={s.repeatChip} accessibilityRole="button" accessibilityLabel={`Ask again: ${question}`} onPress={() => submit(question)} disabled={busy}><Text style={s.repeatText} numberOfLines={1}>{question}</Text></Pressable>)}
      </ScrollView> : null}
      <View style={[s.composer, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        <TextInput ref={inputRef} testID="ask-input" style={s.input} value={text} onChangeText={setText} placeholder={investigationMode ? state.phase === "waiting_user" ? "Answer Higgins' question…" : "Ask about this investigation…" : "Message Higgins…"} placeholderTextColor={colors.muted} multiline returnKeyType="send" blurOnSubmit onSubmitEditing={() => submit(text)} onFocus={() => scrollToEnd(true)} />
        <Pressable testID="ask-send-button" accessibilityRole="button" accessibilityLabel="Send message to Higgins" onPress={() => submit(text)} disabled={busy || !text.trim()} style={[s.send, { opacity: busy || !text.trim() ? 0.5 : 1 }]}>{busy ? <ActivityIndicator color={colors.onBrandPrimary} /> : <SendHorizontal size={20} color={colors.onBrandPrimary} />}</Pressable>
      </View>
    </KeyboardAvoidingView>

    <Sheet visible={aboutOpen} onClose={() => setAboutOpen(false)} title="About Higgins" testID="higgins-about-sheet">
      <Image source={require("../../assets/images/higgins-apollo-portrait.png")} style={s.aboutAvatarImg} contentFit="cover" accessibilityLabel="Higgins with Apollo" />
      <Text style={s.sheetBody}>{WELCOME}{"\n\n"}{ABOUT}</Text>
    </Sheet>

    <Sheet visible={confirmClear} onClose={() => setConfirmClear(false)} title="Clear chat history?" testID="higgins-clear-sheet">
      <Text style={s.sheetBody}>This permanently deletes your conversation with Higgins on this phone. This cannot be undone.</Text>
      <Button testID="higgins-clear-confirm" label="Delete chat history" onPress={() => { setConfirmClear(false); void clearChat(); }} />
      <Button testID="higgins-clear-cancel" variant="ghost" label="Cancel" onPress={() => setConfirmClear(false)} />
    </Sheet>
  </View>;
}
