import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from "expo-router";
import SendHorizontal from "lucide-react-native/icons/send-horizontal";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiDelete, apiGet, streamPost } from "@/src/api/client";
import { clearHandoffTransfers, takeHandoff } from '@/src/domain/handoffTransfer';
import { stopHiggins } from '@/src/voice/higgins';
import { HigginsSpeakButton } from "@/src/components/HigginsSpeakButton";
import { Body, Button, Card, Pill, ScreenHeader } from "@/src/components/ui";
import { parseHigginsIssueContext, type HigginsIssueContext } from "@/src/domain/higginsHandoff";
import { redactInvestigationSecrets as redactUserSecrets } from "@/src/domain/privacy";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

interface Msg { id: string; role: "user" | "higgins"; content: string; pending?: boolean; completed?: boolean; at: string; conversationId?: string; expiresAt?: string }
interface Handoff { id: string; context: HigginsIssueContext; question: string }
interface FailedRequest { id: string; context: HigginsIssueContext | null; question: string; turnId: string; initialId?: string; userMsgId: string; higginsMsgId: string }
type Processing = "idle" | "queued" | "submitting" | "streaming" | "failed" | "completed";
const SUGGESTIONS = ["What does it mean when Apollo growls?", "Why can't Apollo see my whole phone?", "How do I spot a scam text link?", "What should I do after Apollo barks?"];

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface }, list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.md },
  bubble: { maxWidth: "86%", padding: spacing.md, borderRadius: radius.md, borderWidth: 1 }, user: { alignSelf: "flex-end", backgroundColor: c.surfaceSecondary, borderColor: c.border },
  higgins: { alignSelf: "flex-start", backgroundColor: c.surfaceTertiary, borderColor: c.surfaceTertiary, borderLeftWidth: 3, borderLeftColor: c.gold },
  text: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface }, inputBar: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, backgroundColor: c.glass, borderTopWidth: 1, borderTopColor: c.border },
  input: { flex: 1, minHeight: 48, maxHeight: 120, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  send: { width: 48, height: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: c.brandPrimary }, chipRow: { height: 56, paddingHorizontal: spacing.xl, gap: spacing.sm, alignItems: "center" },
  chip: { height: 36, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary, justifyContent: "center", flexShrink: 0 }, chipText: { fontFamily: fonts.textMedium, fontSize: 13, color: c.onSurfaceSecondary },
  disclaimer: { fontFamily: fonts.text, fontSize: 12, color: c.muted, paddingHorizontal: spacing.xl, paddingBottom: spacing.sm }, context: { marginHorizontal: spacing.xl, marginBottom: spacing.sm, gap: spacing.xs, borderColor: c.navyBorder },
}));

export default function Ask() {
  const s = useStyles(); const { colors } = useTheme(); const insets = useSafeAreaInsets(); const qc = useQueryClient(); const router = useRouter();
  const { deviceId } = useApollo();
  const params = useLocalSearchParams<{ context?: string; prompt?: string; handoffId?: string }>();
  const [messages, setMessages] = useState<Msg[]>([]); const [text, setText] = useState(""); const [streaming, setStreaming] = useState(false);
  const [processing, setProcessing] = useState<Processing>("idle"); const [error, setError] = useState<string | null>(null);
  const [activeContext, setActiveContext] = useState<HigginsIssueContext | null>(null); const [activeHandoffId, setActiveHandoffId] = useState<string | null>(null);
  const [queued, setQueued] = useState<Handoff | null>(null); const [failed, setFailed] = useState<FailedRequest | null>(null);
  const listRef = useRef<FlatList<Msg>>(null); const abortRef = useRef<(() => void) | null>(null); const streamingRef = useRef(false); const queuedRef = useRef<Handoff | null>(null); const seenRoute = useRef<string | null>(null);
  const [generalId, setGeneralId] = useState(() => Crypto.randomUUID());
  const expiryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyLoaded = useRef(false);

  const history = useQuery({ queryKey: ["ask-history", deviceId], enabled: !!deviceId, queryFn: () => apiGet<{ id: string; role: "user" | "apollo" | "higgins"; content: string; created_at: string; conversation_id?: string; expires_at?: string }[]>(`/ask/history?device_id=${deviceId}`) });
  useEffect(() => {
    if (!history.data || historyLoaded.current) return;
    historyLoaded.current = true;
    if (messages.length) return;
    const latest = history.data[history.data.length - 1];
    if (latest?.conversation_id) setGeneralId(latest.conversation_id);
    setMessages(history.data.map((m) => ({ id: m.id, role: m.role === 'user' ? 'user' : 'higgins', completed: true, content: m.content, at: m.created_at, conversationId: m.conversation_id, expiresAt: m.expires_at })));
  }, [history.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback((msg: string, options?: { handoff?: Handoff; retry?: FailedRequest }) => {
    const clean = redactUserSecrets(msg).trim();
    if (!clean || streamingRef.current || !deviceId) return false;
    const selected = options?.handoff ?? options?.retry ?? (activeContext && activeHandoffId ? { id: activeHandoffId, context: activeContext, question: clean } : null);
    const retry = options?.retry; const now = new Date().toISOString();
    const initialId = retry?.initialId ?? options?.handoff?.id; const conversationId = selected?.id ?? activeHandoffId ?? generalId;
    const turnId = retry?.turnId ?? initialId ?? Crypto.randomUUID();
    const expiresAt = messages.find(item => item.conversationId === conversationId)?.expiresAt ?? new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const userMsg: Msg = { id: retry?.userMsgId ?? (initialId ? `u-${initialId}` : `u-${Date.now()}`), role: "user", content: clean, at: now, conversationId, expiresAt };
    const higginsMsg: Msg = { id: retry?.higginsMsgId ?? (initialId ? `h-${initialId}` : `h-${Date.now()}`), role: "higgins", content: "", pending: true, at: now, conversationId, expiresAt };
    if (retry) setMessages((items) => items.map((item) => item.id === higginsMsg.id ? higginsMsg : item));
    else setMessages((items) => [...items, userMsg, higginsMsg]);
    setText(""); setError(null); setFailed(null); setStreaming(true); streamingRef.current = true; setProcessing("submitting");
    abortRef.current = streamPost("/ask/stream", "ask_apollo", {
      device_id: deviceId, message: clean, conversation_id: conversationId, turn_id: turnId,
      ...(selected?.context ? { context: selected.context } : {}), ...(initialId ? { handoff_id: initialId } : {}),
    }, (delta) => { setProcessing("streaming"); setMessages((items) => items.map((item) => item.id === higginsMsg.id ? { ...item, content: item.content + delta, pending: false } : item)); },
    (err) => {
      setStreaming(false); streamingRef.current = false; abortRef.current = null;
      if (err) { setProcessing("failed"); setError(err); setFailed({ id: conversationId, context: selected?.context ?? null, question: clean, turnId, initialId, userMsgId: userMsg.id, higginsMsgId: higginsMsg.id }); setMessages((items) => items.map((item) => item.id === higginsMsg.id ? { ...item, pending: false, completed: false } : item)); }
      else { setProcessing("completed"); setMessages((items) => items.map((item) => item.id === higginsMsg.id ? { ...item, pending: false, completed: true } : item)); }
      void qc.invalidateQueries({ queryKey: ["ask-history", deviceId] });
      const next = queuedRef.current;
      if (!err && next) { queuedRef.current = null; setQueued(null); setActiveContext(next.context); setActiveHandoffId(next.id); setTimeout(() => send(next.question, { handoff: next }), 0); }
    });
    return true;
  }, [activeContext, activeHandoffId, deviceId, qc, generalId, messages]);

  useEffect(() => {
    const deadlines = messages.flatMap(item => item.expiresAt ? [Date.parse(item.expiresAt)] : []).filter(Number.isFinite);
    if (!deadlines.length) return;
    expiryRef.current = setTimeout(() => {
      abortRef.current?.(); stopHiggins(); historyLoaded.current = true;
      setMessages([]); setActiveContext(null); setActiveHandoffId(null); setQueued(null); queuedRef.current = null;
      setFailed(null); setText(''); setStreaming(false); streamingRef.current = false; setProcessing('idle');
      setError('Temporary investigation content expired. Submit the required evidence again for a new check.');
      setGeneralId(Crypto.randomUUID()); expiryRef.current = null;
      qc.removeQueries({ queryKey: ['ask-history', deviceId] });
    }, Math.max(0, Math.min(...deadlines) - Date.now()));
    return () => { if (expiryRef.current) clearTimeout(expiryRef.current); };
  }, [messages, qc, deviceId]);

  useEffect(() => {
    const id = params.handoffId ? String(params.handoffId) : "";
    if (!id || id === seenRoute.current || !deviceId) return;
    const transfer = takeHandoff(id);
    const context = transfer?.context ?? (params.context ? parseHigginsIssueContext(String(params.context)) : null);
    if (!context) { seenRoute.current = id; setError("Apollo could not prepare this issue for Higgins. Return to the result and try again."); return; }
    const handoff: Handoff = { id, context, question: transfer?.question ?? redactUserSecrets(String(params.prompt ?? '')).trim() };
    seenRoute.current = id;
    router.setParams({ handoffId: '', context: '', prompt: '' });
    if (streamingRef.current) { queuedRef.current = handoff; setQueued(handoff); setProcessing("queued"); return; }
    setActiveContext(context); setActiveHandoffId(id); setProcessing("queued"); send(handoff.question, { handoff });
  }, [params.handoffId, params.context, params.prompt, deviceId, send, router]);
  useEffect(() => () => { abortRef.current?.(); if (expiryRef.current) clearTimeout(expiryRef.current); }, []);

  const deleteHistory = async () => {
    if (!deviceId) return;
    abortRef.current?.(); stopHiggins(); clearHandoffTransfers(); historyLoaded.current = true;
    streamingRef.current = false; setStreaming(false); setMessages([]); setFailed(null); setText('');
    setActiveContext(null); setActiveHandoffId(null); setQueued(null); queuedRef.current = null;
    setGeneralId(Crypto.randomUUID());
    if (expiryRef.current) clearTimeout(expiryRef.current); expiryRef.current = null;
    await qc.cancelQueries({ queryKey: ['ask-history', deviceId] });
    qc.removeQueries({ queryKey: ['ask-history', deviceId] });
    try { await apiDelete(`/ask/history?device_id=${deviceId}`); setError(null); setProcessing('idle'); }
    catch { setError('Local content cleared. Server deletion could not be confirmed; try Clear temporary history again.'); }
  };

  const clearContext = () => { if (streaming) return; setGeneralId(Crypto.randomUUID()); setActiveContext(null); setActiveHandoffId(null); setProcessing("idle"); setError(null); setFailed(null); router.setParams({ handoffId: "", context: "", prompt: "" }); };
  const activeMessages = messages.filter((item) => item.conversationId === (activeHandoffId ?? generalId));
  const activeQuestions = activeMessages.filter((item) => item.role === "user").length;
  const activeAnswers = activeMessages.filter((item) => item.role === "higgins" && item.completed === true).length;
  return <View style={s.root}>
    <View style={{ paddingTop: insets.top + spacing.md }}><ScreenHeader title="Ask Higgins" testID="ask-header" right={<Pill tone="neutral" label="Explanation only" testID="ask-scope-pill" />} /></View>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={0}>
      {activeContext ? <Card style={s.context} testID="ask-active-issue"><Pill tone={activeContext.assessment_state} label={`${activeContext.gate.toUpperCase()} GATE`} testID="ask-active-gate" /><Body testID="ask-active-summary">{activeContext.issue_summary}</Body><Body testID="ask-handoff-reference">Issue reference: {activeHandoffId?.slice(0, 8)}</Body><Body testID="ask-handoff-status">{processing === "queued" ? "Waiting for the current answer to finish…" : processing === "submitting" ? "Submitting this issue to Higgins…" : processing === "streaming" ? "Higgins is answering this issue…" : processing === "failed" ? "Answer failed — the issue and question are retained." : "This issue stays attached to your follow-up questions."}</Body><Body testID="ask-conversation-counts">{activeQuestions} question{activeQuestions === 1 ? "" : "s"} • {activeAnswers} completed answer{activeAnswers === 1 ? "" : "s"}</Body><Button testID="ask-new-conversation" variant="ghost" label="Start an unrelated question" onPress={clearContext} disabled={streaming} /></Card> : null}
      {queued ? <Card style={s.context} testID="ask-queued-issue"><Body>Next issue: {queued.context.issue_summary}</Body></Card> : null}
      <FlatList ref={listRef} data={activeMessages} keyExtractor={(item) => item.id} contentContainerStyle={s.list} testID="ask-messages" onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => <View style={[s.bubble, item.role === "user" ? s.user : s.higgins]} testID={`ask-message-${item.id}`}>
          {item.pending ? <ActivityIndicator testID={`ask-message-loading-${item.id}`} color={colors.gold} /> : item.content ? <Text testID={`ask-message-content-${item.id}`} style={s.text}>{item.content}</Text> : <Body>Higgins did not finish this answer.</Body>}
          {item.role === 'higgins' && item.completed && item.content ? <View style={{ marginTop: spacing.sm }}><HigginsSpeakButton text={item.content} testID={`ask-hear-${item.id}`} /></View> : null}
        </View>} />
      {error ? <Card style={s.context} testID="ask-error-card"><Text style={[s.text, { color: colors.barkingText }]} testID="ask-error">{error}</Text>{failed ? <Button testID="ask-retry-button" label="Retry" onPress={() => send(failed.question, { retry: failed })} disabled={streaming} /> : null}</Card> : null}
      <Button testID="ask-clear-temporary-history" label="Clear temporary history" variant="ghost" onPress={() => void deleteHistory()} />
      <Text testID="ask-processing-state" style={s.disclaimer}>{processing === 'completed' ? 'Answer complete' : processing === 'failed' ? 'Answer incomplete' : (processing === 'submitting' || processing === 'streaming') ? 'Higgins is investigating…' : 'Temporary content expires within 15 minutes'}</Text>
      {!activeContext ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow} testID="ask-suggestions">{SUGGESTIONS.map((question, index) => <Pressable key={question} testID={`ask-suggestion-${index}`} style={s.chip} onPress={() => send(question)} disabled={streaming}><Text style={s.chipText}>{question}</Text></Pressable>)}</ScrollView> : null}
      <View style={[s.inputBar, { paddingBottom: spacing.sm }]}><TextInput testID="ask-input" style={s.input} value={text} onChangeText={setText} placeholder={activeContext ? "Ask a follow-up about this issue…" : "Ask Higgins about a warning or term…"} placeholderTextColor={colors.muted} multiline returnKeyType="send" blurOnSubmit onSubmitEditing={() => send(text)} />
        <Pressable testID="ask-send-button" accessibilityRole="button" accessibilityLabel="Send question to Higgins" onPress={() => send(text)} disabled={streaming || !text.trim()} style={[s.send, { opacity: streaming || !text.trim() ? 0.5 : 1 }]}>{streaming ? <ActivityIndicator color={colors.onBrandPrimary} /> : <SendHorizontal size={20} color={colors.onBrandPrimary} />}</Pressable></View>
      <Text style={s.disclaimer}>Guidance only. Higgins interprets and guides; Apollo performs supported checks and protective actions.</Text>
    </KeyboardAvoidingView>
  </View>;
}