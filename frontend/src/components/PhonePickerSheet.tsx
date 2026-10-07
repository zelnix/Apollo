// Shared Call/Text Gate picker: lists recent callers (READ_CALL_LOG) or inbox messages (READ_SMS)
// after a contextual permission prompt. Honours the permission contract — explains before asking,
// polls for the grant, and offers Open Settings if the person declines. Android-only; elsewhere it
// shows a short "not available on this build" note so the screen still works via manual entry.
import ChevronRight from "lucide-react-native/icons/chevron-right";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { Body, Button } from "@/src/components/ui";
import { Sheet } from "@/src/components/Sheet";
import { PhonePickers, type RecentCall, type RecentSms } from "@/src/security/phonePickers";
import { getTrustedCallers, normalizeNumber, trustCaller, untrustCaller } from "@/src/domain/trustedCallers";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

type Phase = "checking" | "need_permission" | "requesting" | "ready" | "denied" | "unsupported";

const useStyles = makeStyles((c) => ({
  input: { minHeight: 48, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  item: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: c.divider, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  primary: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  secondary: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceSecondary },
  center: { paddingVertical: spacing.lg, alignItems: "center", gap: spacing.sm },
}));

export function PhonePickerSheet({ visible, mode, onClose, onPickCall, onPickSms }: {
  visible: boolean; mode: "calls" | "sms"; onClose: () => void;
  onPickCall?: (call: RecentCall) => void; onPickSms?: (sms: RecentSms) => void;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const [phase, setPhase] = useState<Phase>("checking");
  const [calls, setCalls] = useState<RecentCall[]>([]);
  const [messages, setMessages] = useState<RecentSms[]>([]);
  const [query, setQuery] = useState("");
  const [trusted, setTrusted] = useState<string[]>([]);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const perm = mode === "calls" ? "call_log" : "sms";
  const title = mode === "calls" ? "Pick a recent caller" : "Pick a message from your inbox";

  const load = useCallback(async () => {
    if (mode === "calls") { const [list, trust] = await Promise.all([PhonePickers.listRecentCalls(), getTrustedCallers()]); setCalls(list); setTrusted(trust); }
    else { const list = await PhonePickers.listRecentSms(); setMessages(list); }
    setPhase("ready");
  }, [mode]);

  const toggleTrust = async (num: string) => {
    const norm = normalizeNumber(num);
    if (trusted.includes(norm)) { await untrustCaller(num); setTrusted((t) => t.filter((x) => x !== norm)); }
    else { await trustCaller(num); setTrusted((t) => [...t, norm]); }
  };

  const evaluate = useCallback(async () => {
    if (!PhonePickers.isSupported()) { setPhase("unsupported"); return; }
    const { granted } = await PhonePickers.hasPermission(perm);
    if (granted) await load(); else setPhase("need_permission");
  }, [perm, load]);

  useEffect(() => {
    if (!visible) { if (pollRef.current) clearTimeout(pollRef.current); setQuery(""); setPhase("checking"); return; }
    void evaluate();
    return () => { if (pollRef.current) clearTimeout(pollRef.current); };
  }, [visible, evaluate]);

  const allow = async () => {
    setPhase("requesting");
    await PhonePickers.requestPermission(perm);
    // The system dialog does not reliably round-trip through AppState, so poll the grant directly.
    const started = Date.now();
    const poll = async () => {
      const { granted } = await PhonePickers.hasPermission(perm);
      if (granted) { await load(); return; }
      if (Date.now() - started > 15000) { setPhase("denied"); return; }
      pollRef.current = setTimeout(() => void poll(), 700);
    };
    pollRef.current = setTimeout(() => void poll(), 700);
  };

  const filteredCalls = calls.filter((c) => `${c.name ?? ""} ${c.number}`.toLowerCase().includes(query.trim().toLowerCase()));
  const filteredMsgs = messages.filter((m) => `${m.address} ${m.body}`.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <Sheet visible={visible} onClose={onClose} title={title} testID={`phone-picker-${mode}`}>
      {phase === "unsupported" ? (
        <Body testID="phone-picker-unsupported">This picker needs a production Android build. You can still {mode === "calls" ? "type the caller number" : "paste or share the message"} by hand.</Body>
      ) : phase === "need_permission" ? (
        <View style={{ gap: spacing.md }}>
          <Body testID="phone-picker-explain">{mode === "calls" ? "Apollo can list your recent callers so you can pick the number to check. It reads them only when you open this picker — never in the background." : "Apollo can list your recent inbox messages so you can pick one to check. It reads them only when you open this picker — never in the background."}</Body>
          <Button testID="phone-picker-allow" label={mode === "calls" ? "Allow recent calls" : "Allow messages"} onPress={() => void allow()} />
        </View>
      ) : phase === "requesting" || phase === "checking" ? (
        <View style={s.center}><ActivityIndicator color={colors.gold} /><Body>{phase === "requesting" ? "Waiting for your permission…" : "Checking…"}</Body></View>
      ) : phase === "denied" ? (
        <View style={{ gap: spacing.md }}>
          <Body testID="phone-picker-denied">Permission isn&apos;t granted, so Apollo can&apos;t list {mode === "calls" ? "recent callers" : "your messages"}. You can enable it in Settings, or {mode === "calls" ? "type the number" : "paste the message"} by hand.</Body>
          <Button testID="phone-picker-settings" variant="secondary" label="Open Settings" onPress={() => void Linking.openSettings()} />
          <Button testID="phone-picker-retry" variant="ghost" label="Try again" onPress={() => void evaluate()} />
        </View>
      ) : (
        <View style={{ gap: spacing.sm }}>
          <TextInput testID="phone-picker-search" style={s.input} value={query} onChangeText={setQuery} placeholder={mode === "calls" ? "Search callers" : "Search messages"} placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} />
          {(mode === "calls" ? filteredCalls.length : filteredMsgs.length) === 0 ? (
            <Body testID="phone-picker-empty">{(mode === "calls" ? calls.length : messages.length) === 0 ? `No ${mode === "calls" ? "recent calls" : "messages"} found.` : `No ${mode === "calls" ? "callers" : "messages"} match “${query}”.`}</Body>
          ) : (
            <ScrollView style={{ maxHeight: 380 }} testID="phone-picker-list" keyboardShouldPersistTaps="handled">
              {mode === "calls" ? filteredCalls.map((call, i) => (
                <Pressable key={`${call.number}-${i}`} testID={`phone-picker-call-${i}`} accessibilityRole="button" onPress={() => { onPickCall?.(call); onClose(); }} style={({ pressed }) => [s.item, { opacity: pressed ? 0.7 : 1 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.primary}>{call.name || call.number}</Text>
                    <Text style={s.secondary} numberOfLines={1}>{call.name ? `${call.number} · ` : ""}{call.type}{call.date ? ` · ${new Date(call.date).toLocaleDateString()}` : ""}</Text>
                  </View>
                  <Pressable testID={`phone-picker-trust-${i}`} accessibilityRole="button" accessibilityLabel={trusted.includes(normalizeNumber(call.number)) ? "Untrust this number" : "Trust this number so Apollo stays quiet"} hitSlop={8} onPress={() => void toggleTrust(call.number)} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.sm }}>
                    <Text style={[s.secondary, { fontFamily: fonts.textSemibold, color: trusted.includes(normalizeNumber(call.number)) ? colors.resting : colors.brand }]}>{trusted.includes(normalizeNumber(call.number)) ? "Trusted" : "Trust"}</Text>
                  </Pressable>
                  <ChevronRight size={18} color={colors.brand} />
                </Pressable>
              )) : filteredMsgs.map((msg, i) => (
                <Pressable key={`${msg.address}-${i}`} testID={`phone-picker-sms-${i}`} accessibilityRole="button" onPress={() => { onPickSms?.(msg); onClose(); }} style={({ pressed }) => [s.item, { opacity: pressed ? 0.7 : 1, alignItems: "flex-start" }]}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.primary} numberOfLines={1}>{msg.address || "Unknown sender"}</Text>
                    <Text style={[s.secondary, { color: colors.onSurface }]} numberOfLines={2}>{msg.body}</Text>
                  </View>
                  <ChevronRight size={18} color={colors.brand} />
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      )}
      <Button testID="phone-picker-close" variant="ghost" label="Close" onPress={onClose} />
    </Sheet>
  );
}
