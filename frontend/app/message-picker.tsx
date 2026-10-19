// Text Gate — Messages-style inbox picker (Android, READ_SMS). Full screen (not a bottom sheet) to fix
// the previous overlap/tap issues. Inbox of conversations → tap → chat bubbles → "Check with Apollo" on a
// single incoming message, which returns the sender + full body to Text Gate. Never selects a whole thread.
// Where READ_SMS isn't available, the person is pointed to Share → Apollo from their Messages app.
import { useRouter } from "expo-router";
import ChevronLeft from "lucide-react-native/icons/chevron-left";
import Search from "lucide-react-native/icons/search";
import X from "lucide-react-native/icons/x";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Linking, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Body, Button } from "@/src/components/ui";
import { filterConversations, groupSms, timeLabel, type SmsConversation } from "@/src/domain/smsConversations";
import { PhonePickers, type RecentSms } from "@/src/security/phonePickers";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

type Phase = "checking" | "need_permission" | "requesting" | "ready" | "denied" | "unsupported";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingBottom: spacing.sm },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface, flex: 1 },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  searchBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginHorizontal: spacing.lg, marginBottom: spacing.sm, backgroundColor: c.surfaceTertiary, borderRadius: radius.pill, paddingHorizontal: spacing.lg, minHeight: 46 },
  searchInput: { flex: 1, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  convo: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: c.brandPrimary, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: fonts.textSemibold, fontSize: 16, color: c.onBrand ?? "#fff" },
  convoName: { fontFamily: fonts.textSemibold, fontSize: 16, color: c.onSurface },
  convoPreview: { fontFamily: fonts.text, fontSize: 14, color: c.onSurfaceSecondary },
  convoTime: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl },
  chatHeaderName: { fontFamily: fonts.displayBold, fontSize: 18, color: c.onSurface },
  bubbleIn: { alignSelf: "flex-start", backgroundColor: c.surfaceTertiary, borderRadius: 18, borderBottomLeftRadius: 4, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, maxWidth: "88%", marginBottom: spacing.xs },
  bubbleText: { fontFamily: fonts.text, fontSize: 15, lineHeight: 21, color: c.onSurface },
  bubbleTime: { fontFamily: fonts.text, fontSize: 11, color: c.muted, marginTop: 4 },
  checkBtn: { marginTop: spacing.sm, alignSelf: "flex-start", backgroundColor: c.brandPrimary, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  checkBtnText: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.onBrand ?? "#fff" },
  hint: { fontFamily: fonts.text, fontSize: 12, color: c.muted, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, textAlign: "center" },
}));

export default function MessagePicker() {
  const s = useStyles(); const { colors } = useTheme(); const insets = useSafeAreaInsets(); const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [conversations, setConversations] = useState<SmsConversation[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<SmsConversation | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => { setConversations(groupSms(await PhonePickers.listRecentSms())); setPhase("ready"); }, []);
  const evaluate = useCallback(async () => {
    if (!PhonePickers.isSupported()) { setPhase("unsupported"); return; }
    const { granted } = await PhonePickers.hasPermission("sms");
    if (granted) await load(); else setPhase("need_permission");
  }, [load]);
  useEffect(() => { void evaluate(); return () => { if (pollRef.current) clearTimeout(pollRef.current); }; }, [evaluate]);

  const allow = async () => {
    setPhase("requesting"); await PhonePickers.requestPermission("sms");
    const started = Date.now();
    const poll = async () => {
      const { granted } = await PhonePickers.hasPermission("sms");
      if (granted) { await load(); return; }
      if (Date.now() - started > 15000) { setPhase("denied"); return; }
      pollRef.current = setTimeout(() => void poll(), 700);
    };
    pollRef.current = setTimeout(() => void poll(), 700);
  };

  // Return exactly the selected incoming message (sender + full body) to Text Gate — never a whole thread.
  const check = (msg: RecentSms) => router.replace({ pathname: "/message", params: { text: msg.body ?? "", sender: msg.address ?? "", source: "inbox_picker" } });

  const shown = filterConversations(conversations, query);

  return <View style={s.root} testID="message-picker-screen">
    <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
      {open ? <Pressable testID="message-picker-back" accessibilityRole="button" onPress={() => setOpen(null)} style={s.iconBtn}><ChevronLeft size={22} color={colors.onSurface} /></Pressable> : null}
      <Text style={s.title} numberOfLines={1}>{open ? open.display : "Your messages"}</Text>
      <Pressable testID="message-picker-close" accessibilityRole="button" accessibilityLabel="Close" onPress={() => goBackOrHome(router)} style={s.iconBtn}><X size={20} color={colors.onSurface} /></Pressable>
    </View>

    {phase === "unsupported" ? (
      <View style={s.center}><Body testID="message-picker-unsupported">Apollo can&apos;t open your inbox on this build. In your Messages app, open the text, tap Share, and choose Apollo — Apollo will check it the same way.</Body><Button testID="message-picker-unsupported-back" variant="secondary" label="Go back" onPress={() => goBackOrHome(router)} /></View>
    ) : phase === "need_permission" ? (
      <View style={s.center}><Body testID="message-picker-explain">Apollo can list your recent messages so you can pick one to check. It reads them only while this screen is open — never in the background — and nothing is saved.</Body><Button testID="message-picker-allow" label="Allow messages" onPress={() => void allow()} /><Button testID="message-picker-share-fallback" variant="ghost" label="Or share a message from your Messages app" onPress={() => goBackOrHome(router)} /></View>
    ) : phase === "requesting" || phase === "checking" ? (
      <View style={s.center}><ActivityIndicator color={colors.gold} /><Body>{phase === "requesting" ? "Waiting for your permission…" : "Opening your messages…"}</Body></View>
    ) : phase === "denied" ? (
      <View style={s.center}><Body testID="message-picker-denied">Permission isn&apos;t granted, so Apollo can&apos;t list your messages. Enable it in Settings, or share a message from your Messages app instead.</Body><Button testID="message-picker-settings" variant="secondary" label="Open Settings" onPress={() => void Linking.openSettings()} /><Button testID="message-picker-retry" variant="ghost" label="Try again" onPress={() => void evaluate()} /></View>
    ) : open ? (
      // Conversation view — chat bubbles, each incoming message selectable.
      <FlatList
        testID="message-picker-thread"
        data={open.messages}
        keyExtractor={(m, i) => `${m.date}-${i}`}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl, gap: spacing.sm }}
        renderItem={({ item, index }) => (
          <View style={s.bubbleIn} testID={`message-picker-msg-${index}`}>
            <Text style={s.bubbleText}>{item.body || "(no text)"}</Text>
            <Text style={s.bubbleTime}>{timeLabel(item.date)}</Text>
            <Pressable testID={`message-picker-check-${index}`} accessibilityRole="button" accessibilityLabel="Check this message with Apollo" onPress={() => check(item)} style={s.checkBtn}><Text style={s.checkBtnText}>Check with Apollo</Text></Pressable>
          </View>
        )}
        ListHeaderComponent={<Text style={s.chatHeaderName} testID="message-picker-thread-header">Tap “Check with Apollo” on the message you want checked.</Text>}
      />
    ) : (
      <>
        <View style={s.searchBar}><Search size={18} color={colors.muted} /><TextInput testID="message-picker-search" style={s.searchInput} value={query} onChangeText={setQuery} placeholder="Search messages" placeholderTextColor={colors.muted} autoCapitalize="none" autoCorrect={false} /></View>
        <Text style={s.hint}>Newest conversations first. Apollo checks only the one message you pick.</Text>
        {shown.length === 0 ? (
          <View style={s.center}><Body testID="message-picker-empty">{conversations.length === 0 ? "No messages found on this device." : `No conversations match “${query}”.`}</Body></View>
        ) : (
          <FlatList
            testID="message-picker-inbox"
            data={shown}
            keyExtractor={(c) => c.address}
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
            renderItem={({ item, index }) => (
              <Pressable testID={`message-picker-convo-${index}`} accessibilityRole="button" accessibilityLabel={`Open conversation with ${item.display}`} onPress={() => setOpen(item)} style={({ pressed }) => [s.convo, { opacity: pressed ? 0.7 : 1 }]}>
                <View style={s.avatar}><Text style={s.avatarText}>{item.initials}</Text></View>
                <View style={{ flex: 1 }}><Text style={s.convoName} numberOfLines={1}>{item.display}</Text><Text style={s.convoPreview} numberOfLines={1}>{item.preview || `${item.count} message${item.count > 1 ? "s" : ""}`}</Text></View>
                <Text style={s.convoTime}>{timeLabel(item.lastDate)}</Text>
              </Pressable>
            )}
          />
        )}
      </>
    )}
  </View>;
}
