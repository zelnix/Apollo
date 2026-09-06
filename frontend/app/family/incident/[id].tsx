// Family Incident Sharing — guardian view. Read-only timeline + the family member's Stay With Me progress,
// with one-tap call. Shows only what they chose to share: headlines, states, steps and ticks.
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Check from "lucide-react-native/icons/check";
import Heart from "lucide-react-native/icons/heart";
import Phone from "lucide-react-native/icons/phone";
import X from "lucide-react-native/icons/x";
import React, { useEffect, useState } from "react";
import { Linking, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGet, apiPost } from "@/src/api/client";
import { Body, Button, Card, Pill, SectionTitle, toneColor } from "@/src/components/ui";
import { CATEGORY_GLYPH, CATEGORY_LABEL } from "@/src/domain/incidentPlan";
import { type ApolloState, type EventCategory, STATE_NAME } from "@/src/domain/types";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";
import { storage } from "@/src/utils/storage";

export interface SharedIncident { scent_id: string; from_label: string; headline: string; state: ApolloState; events: { event_id: string; category: EventCategory; state: ApolloState; headline: string; occurred_at: string; status: string }[]; steps: { id: string; text: string }[]; done: string[]; resolved: boolean; shared_at: string; updated_at: string; phone: string }
export interface IncidentNote { note_id: string; guardian_label: string; kind: string; text: string; phone: string; created_at: string }

type NoteKind = "here" | "calling" | "on_way" | "together" | "custom";
const PRESETS: { kind: NoteKind; label: string }[] = [
  { kind: "here", label: "I'm here, call me" },
  { kind: "calling", label: "I'm calling you now" },
  { kind: "on_way", label: "I'm on my way" },
  { kind: "together", label: "We'll sort it together" },
];

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  headline: { fontFamily: fonts.displayBold, fontSize: 20, lineHeight: 26, color: c.onSurface },
  why: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurface },
  label: { fontFamily: fonts.textSemibold, fontSize: 15, color: c.onSurface },
  meta: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
  step: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start", paddingVertical: spacing.sm },
  box: { width: 24, height: 24, borderRadius: 8, borderWidth: 2, alignItems: "center", justifyContent: "center", marginTop: 1 },
  done: { textDecorationLine: "line-through", color: c.muted },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceTertiary, justifyContent: "center" },
  chipOn: { borderColor: c.resting, backgroundColor: c.restingTint },
  chipText: { fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurface },
  input: { minHeight: 48, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  note: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", paddingVertical: spacing.xs },
}));

export default function FamilyIncident() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ready, setupDone, deviceId, showToast } = useApollo();
  const q = useQuery({ queryKey: ["family-incident", id, deviceId], enabled: !!deviceId, refetchInterval: 15000, queryFn: () => apiGet<SharedIncident>(`/family/incidents/${id}?device_id=${deviceId}`) });
  const notes = useQuery({ queryKey: ["family-incident-notes", id, deviceId], enabled: !!deviceId, queryFn: () => apiGet<IncidentNote[]>(`/family/incidents/${id}/notes?device_id=${deviceId}`) });
  const [kind, setKind] = useState<NoteKind>("here");
  const [custom, setCustom] = useState("");
  const [fromName, setFromName] = useState("");
  const [myPhone, setMyPhone] = useState("");
  useEffect(() => {
    void storage.getItem<string>("apollo.family.myname", "").then((v) => setFromName(v ?? ""));
    void storage.getItem<string>("apollo.family.myphone", "").then((v) => setMyPhone(v ?? ""));
  }, []);
  const send = useMutation({
    mutationFn: () => apiPost<IncidentNote>(`/family/incidents/${id}/notes`, "family", { device_id: deviceId ?? "local-device", kind, text: kind === "custom" ? custom.trim() : "", from_name: fromName.trim(), phone: myPhone.trim() }),
    onSuccess: () => { void storage.setItem("apollo.family.myname", fromName.trim()); void storage.setItem("apollo.family.myphone", myPhone.trim()); setCustom(""); void qc.invalidateQueries({ queryKey: ["family-incident-notes", id, deviceId] }); showToast("Note sent. They'll see it on their incident timeline.", "resting"); },
    onError: (e: Error) => showToast(e.message || "Couldn't send the note right now.", "barking"),
  });
  const inc = q.data;
  if (ready && !setupDone) return <Redirect href="/" />;
  const doneCount = inc ? inc.steps.filter((st) => inc.done.includes(st.id)).length : 0;
  const canSend = !send.isPending && (kind !== "custom" || custom.trim().length > 0);

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>{inc ? `${inc.from_label}'s incident` : "Shared incident"}</Text>
        <Pressable testID="family-incident-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <KeyboardAwareScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} testID="family-incident-scroll" bottomOffset={24} keyboardShouldPersistTaps="handled">
        {q.isLoading ? <Body>Loading…</Body> : !inc ? <Body testID="family-incident-missing">This incident isn&apos;t available (it may have been shared with someone else).</Body> : (
          <>
            <Card style={{ gap: spacing.sm, borderColor: toneColor(colors, inc.resolved ? "resting" : inc.state) }} testID="family-incident-summary">
              <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}><Pill tone={inc.state} label={STATE_NAME[inc.state]} testID="family-incident-state" />{inc.resolved ? <Pill tone="resting" label="They marked it handled" testID="family-incident-resolved" /> : <Pill tone="neutral" label={`${doneCount}/${inc.steps.length} steps done`} testID="family-incident-progress" />}</View>
              <Text style={s.headline} testID="family-incident-headline">{inc.headline}</Text>
              <Body>{inc.from_label} asked for help {new Date(inc.shared_at).toLocaleString()}. Updated {new Date(inc.updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.</Body>
              <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
                {inc.phone ? <Button testID="family-incident-call" label={`Call ${inc.from_label}`} icon={<Phone size={18} color={colors.onBrandPrimary} />} onPress={() => void Linking.openURL(`tel:${inc.phone.replace(/[^+\d]/g, "")}`)} /> : <Body>No phone number saved — add one from any of their alerts.</Body>}
              </View>
              <Body>Walk them through the unticked steps below. Don&apos;t ask for their passwords or codes — Apollo never does either.</Body>
            </Card>
            <View>
              <SectionTitle>What happened to them, in order</SectionTitle>
              {[...inc.events].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at)).map((e, i) => (
                <View key={e.event_id} style={{ flexDirection: "row", gap: spacing.md, paddingBottom: spacing.md }} testID={`family-incident-event-${i}`}>
                  <Text style={{ fontSize: 18, lineHeight: 24 }}>{CATEGORY_GLYPH[e.category] ?? "•"}</Text>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.meta}>{new Date(e.occurred_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {CATEGORY_LABEL[e.category] ?? e.category}</Text>
                    <Text style={s.label}>{e.headline.replace(/^(Email|App|Device|Account|Network): /, "")}</Text>
                    <View style={{ flexDirection: "row", gap: spacing.sm }}><Pill tone={e.state} label={STATE_NAME[e.state]} />{e.status !== "active" ? <Pill tone="resting" label="Handled" /> : null}</View>
                  </View>
                </View>
              ))}
            </View>
            <Card style={{ gap: spacing.xs }} testID="family-incident-plan">
              <SectionTitle>Their Stay With Me plan</SectionTitle>
              {inc.steps.map((st, i) => { const on = inc.done.includes(st.id); return (
                <View key={st.id} style={s.step} testID={`family-incident-step-${i}`}>
                  <View style={[s.box, { borderColor: on ? colors.resting : colors.borderStrong, backgroundColor: on ? colors.resting : "transparent" }]}>{on ? <Check size={14} color={colors.surface} /> : null}</View>
                  <Text style={[s.why, { flex: 1 }, on && s.done]}>{i + 1}. {st.text}</Text>
                </View>); })}
              <Body>Progress updates live as they tick steps on their phone.</Body>
            </Card>
            <Card style={{ gap: spacing.md }} testID="family-note-card">
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}><Heart size={18} color={colors.resting} /><SectionTitle>Send a reassurance note</SectionTitle></View>
              <Body>A short line lands on {inc.from_label}&apos;s incident timeline (and as an alert). Never ask for passwords or codes — Apollo won&apos;t either.</Body>
              <View style={s.chips}>
                {PRESETS.map((p) => (
                  <Pressable key={p.kind} testID={`family-note-kind-${p.kind}`} accessibilityRole="radio" accessibilityState={{ selected: kind === p.kind }} onPress={() => setKind(p.kind)} style={[s.chip, kind === p.kind && s.chipOn]}><Text style={s.chipText}>{p.label}</Text></Pressable>
                ))}
                <Pressable testID="family-note-kind-custom" accessibilityRole="radio" accessibilityState={{ selected: kind === "custom" }} onPress={() => setKind("custom")} style={[s.chip, kind === "custom" && s.chipOn]}><Text style={s.chipText}>Write my own</Text></Pressable>
              </View>
              {kind === "custom" ? <TextInput testID="family-note-text" style={s.input} value={custom} onChangeText={(t) => setCustom(t.slice(0, 140))} placeholder="e.g. Popping over after work — don't touch anything till then" placeholderTextColor={colors.muted} multiline maxLength={140} /> : null}
              <TextInput testID="family-note-name" style={s.input} value={fromName} onChangeText={(t) => setFromName(t.slice(0, 40))} placeholder="Your name (so they know who it's from)" placeholderTextColor={colors.muted} maxLength={40} autoCorrect={false} />
              <TextInput testID="family-note-phone" style={s.input} value={myPhone} onChangeText={(t) => setMyPhone(t.slice(0, 32))} placeholder="Your phone number (optional) — adds a one-tap Call back button" placeholderTextColor={colors.muted} keyboardType="phone-pad" maxLength={32} autoCorrect={false} />
              <Button testID="family-note-send" label={send.isPending ? "Sending…" : "Send note"} onPress={() => send.mutate()} disabled={!canSend} />
              {(notes.data ?? []).length ? (
                <View style={{ gap: spacing.xs }} testID="family-note-sent">
                  <Text style={s.meta}>Sent</Text>
                  {notes.data!.map((n, i) => (
                    <View key={n.note_id} style={s.note} testID={`family-note-sent-${i}`}>
                      <Check size={16} color={colors.resting} style={{ marginTop: 3 }} />
                      <Text style={[s.why, { flex: 1 }]}>{n.text} <Text style={s.meta}>· {new Date(n.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{n.phone ? ` · call back ${n.phone}` : ""}</Text></Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </Card>
          </>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}
