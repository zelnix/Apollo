import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import SendHorizontal from "lucide-react-native/icons/send-horizontal";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGet, streamPost } from "@/src/api/client";
import { Body, Card, Pill, ScreenHeader } from "@/src/components/ui";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

interface Msg { id: string; role: "user" | "apollo"; content: string; pending?: boolean }
const SUGGESTIONS = ["What does growling mean?", "Why can't Apollo see my whole phone?", "How do I spot a scam text link?", "What should I do after a barking alert?"];

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, gap: spacing.md },
  bubble: { maxWidth: "86%", padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  user: { alignSelf: "flex-end", backgroundColor: c.surfaceSecondary, borderColor: c.border },
  apollo: { alignSelf: "flex-start", backgroundColor: c.surfaceTertiary, borderColor: c.surfaceTertiary },
  text: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingTop: spacing.sm, backgroundColor: c.glass, borderTopWidth: 1, borderTopColor: c.border },
  input: { flex: 1, minHeight: 48, maxHeight: 120, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  send: { width: 48, height: 48, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: c.brandPrimary },
  chipRow: { height: 56, paddingHorizontal: spacing.xl, gap: spacing.sm, alignItems: "center" },
  chip: { height: 36, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary, justifyContent: "center", flexShrink: 0 },
  chipText: { fontFamily: fonts.textMedium, fontSize: 13, color: c.onSurfaceSecondary },
  disclaimer: { fontFamily: fonts.text, fontSize: 12, color: c.muted, paddingHorizontal: spacing.xl, paddingBottom: spacing.sm },
}));

export default function Ask() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { deviceId } = useApollo();
  const params = useLocalSearchParams<{ context?: string; prompt?: string }>();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<Msg>>(null);
  const abortRef = useRef<(() => void) | null>(null);
  const contextUsed = useRef(false);

  const history = useQuery({ queryKey: ["ask-history", deviceId], enabled: !!deviceId, queryFn: () => apiGet<{ id: string; role: "user" | "apollo"; content: string }[]>(`/ask/history?device_id=${deviceId}`) });
  useEffect(() => { if (history.data && messages.length === 0) setMessages(history.data.map((m) => ({ id: m.id, role: m.role, content: m.content }))); }, [history.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = (msg: string, context?: string) => {
    const clean = msg.trim();
    if (!clean || streaming || !deviceId) return;
    setError(null);
    const userMsg: Msg = { id: `u-${Date.now()}`, role: "user", content: clean };
    const apolloMsg: Msg = { id: `a-${Date.now()}`, role: "apollo", content: "", pending: true };
    setMessages((m) => [...m, userMsg, apolloMsg]);
    setText(""); setStreaming(true);
    abortRef.current = streamPost("/ask/stream", "ask_apollo", { device_id: deviceId, message: clean, ...(context ? { context } : {}) },
      (delta) => setMessages((m) => m.map((x) => x.id === apolloMsg.id ? { ...x, content: x.content + delta, pending: false } : x)),
      (err) => {
        setStreaming(false);
        if (err) { setError(err); setMessages((m) => m.filter((x) => x.id !== apolloMsg.id || x.content.length > 0)); }
        void qc.invalidateQueries({ queryKey: ["ask-history", deviceId] });
      });
  };

  useEffect(() => {
    if (params.prompt && deviceId && !contextUsed.current) { contextUsed.current = true; send(String(params.prompt), params.context ? String(params.context) : undefined); }
  }, [params.prompt, deviceId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => abortRef.current?.(), []);

  return (
    <View style={s.root}>
      <View style={{ paddingTop: insets.top + spacing.md }}>
        <ScreenHeader title="Ask Apollo" testID="ask-header" right={<Pill tone="neutral" label="Explanation only" testID="ask-scope-pill" />} />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : "height"} keyboardVerticalOffset={0}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={s.list}
          testID="ask-messages"
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => (
            <View style={[s.bubble, item.role === "user" ? s.user : s.apollo]} testID={`ask-msg-${item.role}`}>
              {item.pending ? <ActivityIndicator color={colors.resting} /> : <Text style={s.text}>{item.content}</Text>}
            </View>
          )}
          ListEmptyComponent={
            <Card style={{ gap: spacing.sm }} testID="ask-empty">
              <Text style={{ fontFamily: fonts.display, fontSize: 16, color: colors.onSurface }}>Ask Apollo to explain</Text>
              <Body>Apollo explains what happened and what to do, in plain language. It never decides what is safe — Apollo&apos;s on-device checks and intelligence do that.</Body>
            </Card>
          }
        />
        {error ? <Text style={[s.disclaimer, { color: colors.barking }]} testID="ask-error">{error}</Text> : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chipRow} testID="ask-suggestions">
          {SUGGESTIONS.map((q) => (
            <Pressable key={q} testID={`ask-suggestion-${SUGGESTIONS.indexOf(q)}`} style={s.chip} onPress={() => send(q)}><Text style={s.chipText}>{q}</Text></Pressable>
          ))}
        </ScrollView>
        <View style={[s.inputBar, { paddingBottom: spacing.sm }]}>
          <TextInput
            testID="ask-input"
            style={s.input}
            value={text}
            onChangeText={setText}
            placeholder="Ask about a link, a warning, or a term…"
            placeholderTextColor={colors.muted}
            multiline
            returnKeyType="send"
            blurOnSubmit
            onSubmitEditing={() => send(text)}
          />
          <Pressable testID="ask-send-button" accessibilityRole="button" onPress={() => send(text)} disabled={streaming || !text.trim()} style={[s.send, { opacity: streaming || !text.trim() ? 0.5 : 1 }]}>
            {streaming ? <ActivityIndicator color={colors.onBrandPrimary} /> : <SendHorizontal size={20} color={colors.onBrandPrimary} />}
          </Pressable>
        </View>
        <Text style={s.disclaimer}>Guidance only. Apollo&apos;s AI never blocks or verifies threats.</Text>
      </KeyboardAvoidingView>
    </View>
  );
}
