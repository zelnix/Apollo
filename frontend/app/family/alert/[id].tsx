// Family alert detail — opened from a push tap (action_url /family/alert/{event_id}) or from the Family screen.
// Shows the shared summary (never the full link) with one-tap Call / Message and the Guardian Reply.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import MessageCircle from "lucide-react-native/icons/message-circle";
import Phone from "lucide-react-native/icons/phone";
import React, { useEffect, useState } from "react";
import { Linking, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGet, apiPost } from "@/src/api/client";
import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import { STATE_NAME, type ApolloState } from "@/src/domain/types";
import { scrubMessage } from "@/src/domain/messageVoice";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";
import { CloseButton } from "@/src/components/CloseButton";
import { threatNotesPath, type ThreatNote } from "@/src/components/FamilyNotes";
import { formatDateTime } from "@/src/domain/threatCase";

const NOTE_MAX = 140;

export interface SharedAlert {
  event_id: string; protected_device_id?: string; from_label: string; state: string; headline: string; what_to_do: string;
  indicator_host: string | null; occurred_at: string; acknowledged_at?: string; ack_label?: string; phone?: string;
  // Set when the person sent this summary themselves ("Send to family").
  shared_by_owner?: boolean; result?: string; what_happened?: string; involved_label?: "Website" | "Number" | null; involved?: string | null; case_ref?: string;
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.xl },
  headline: { fontFamily: fonts.displayBold, fontSize: 20, color: c.onSurface, lineHeight: 26 },
  input: { minHeight: 48, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  err: { fontFamily: fonts.textMedium, fontSize: 13, color: c.barkingText },
  noteInput: { minHeight: 88, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.md, fontFamily: fonts.text, fontSize: 15, color: c.onSurface, textAlignVertical: "top" },
  hint: { fontFamily: fonts.text, fontSize: 12, color: c.muted },
  sent: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary },
}));

export default function FamilyAlert() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { deviceId, showToast } = useApollo();
  const [phone, setPhone] = useState("");
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const shared = useQuery({ queryKey: ["shared-events", deviceId], enabled: !!deviceId, queryFn: () => apiGet<SharedAlert[]>(`/family/shared-events?device_id=${deviceId}`) });
  const alert = shared.data?.find((e) => e.event_id === id) ?? null;
  useEffect(() => { if (alert && !editing) setPhone(alert.phone ?? ""); }, [alert, editing]);

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["shared-events", deviceId] }); qc.invalidateQueries({ queryKey: ["family-links", deviceId] }); };
  const ack = useMutation({
    mutationFn: (reply: string) => apiPost<{ ack_label: string }>(`/family/shared-events/${id}/ack`, "family", { device_id: deviceId, reply }),
    onSuccess: (r) => { invalidate(); showToast(`Marked: ${r.ack_label}`, "resting"); },
    onError: (e) => setErr(e instanceof Error ? e.message : "Could not save"),
  });
  const savePhone = useMutation({
    mutationFn: () => apiPost<{ phone: string }>("/family/links/phone", "family", { device_id: deviceId, protected_device_id: alert?.protected_device_id, phone: phone.trim() }),
    onSuccess: () => { setEditing(false); setErr(null); invalidate(); showToast("Number saved", "resting"); },
    onError: (e) => setErr(e instanceof Error ? e.message : "Could not save"),
  });

  const tel = (alert?.phone ?? "").replace(/[^+\d]/g, "");
  const [own, setOwn] = useState("");
  const [writing, setWriting] = useState(false);
  const notesKey = ["threat-notes", id, deviceId];
  const notes = useQuery({ queryKey: notesKey, enabled: !!deviceId && !!id, queryFn: () => apiGet<ThreatNote[]>(threatNotesPath(id!, deviceId!)) });
  const sendNote = useMutation({
    mutationFn: (n: { kind: ThreatNote["kind"]; text?: string }) => apiPost<ThreatNote>(`/family/shared-events/${id}/notes`, "family", { device_id: deviceId, kind: n.kind, text: n.text ?? "" }),
    onSuccess: () => { setOwn(""); setWriting(false); setErr(null); qc.invalidateQueries({ queryKey: notesKey }); showToast(`Note sent to ${alert?.from_label ?? "them"}.`, "resting"); },
    onError: (e) => setErr(e instanceof Error ? e.message : "Could not send the note"),
  });
  const call = (scheme: "tel" | "sms") => {
    if (!tel) { setEditing(true); return; }
    void Linking.openURL(`${scheme}:${tel}`).catch(() => showToast("This device can't place the call.", "barking"));
    if (scheme === "tel" && !alert?.acknowledged_at) ack.mutate("called");
  };

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Family alert</Text>
        <CloseButton testID="family-alert-close" onPress={() => goBackOrHome(router)} />
      </View>
      <KeyboardAwareScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} bottomOffset={24} testID="family-alert-scroll">
        {shared.isLoading ? <Body>Loading…</Body> : shared.isError && !shared.data ? (
          <Card><Body testID="family-alert-unavailable">Apollo can&apos;t reach the security service right now, so this alert can&apos;t be loaded. It hasn&apos;t gone anywhere — try again shortly.</Body></Card>
        ) : !alert ? (
          <Card><Body testID="family-alert-missing">This alert isn&apos;t available on this device. It may have been cleared, or the pairing was removed.</Body></Card>
        ) : (
          <>
            <Card style={{ gap: spacing.sm }} testID="family-alert-card">
              <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center", flexWrap: "wrap" }}>
                <Pill tone={alert.state as "barking"} label={STATE_NAME[alert.state as ApolloState] ?? alert.state} />
                <Body>{alert.from_label} · {new Date(alert.occurred_at).toLocaleString()}</Body>
              </View>
              <Text style={s.headline} testID="family-alert-headline">{scrubMessage(alert.headline)}</Text>
              {alert.result ? <Body testID="family-alert-result">Result: {alert.result}</Body> : null}
              {alert.what_happened && alert.what_happened !== alert.headline ? <Body testID="family-alert-what-happened">{scrubMessage(alert.what_happened)}</Body> : null}
              <Body>{alert.result ? "What to do: " : ""}{scrubMessage(alert.what_to_do)}</Body>
              {alert.involved ? <Body testID="family-alert-involved">{alert.involved_label ?? "Website"} involved: {alert.involved}</Body>
                : alert.indicator_host ? <Body>Website involved: {alert.indicator_host}</Body> : null}
              {alert.shared_by_owner ? <Body testID="family-alert-sent-by">{alert.from_label} sent you this summary{alert.case_ref ? ` (case ${alert.case_ref})` : ""}. The original message, its links and pictures stayed on their phone.</Body> : null}
              {alert.acknowledged_at ? <Pill tone="resting" label={`${alert.ack_label} · ${new Date(alert.acknowledged_at).toLocaleDateString()}`} testID="family-alert-ack-done" /> : null}
            </Card>

            <View>
              <SectionTitle>Reach {alert.from_label}</SectionTitle>
              <Card style={{ gap: spacing.md }} testID="family-alert-contact">
                <Body>{tel ? `A quick call is usually the most helpful response.` : `No number yet. Add ${alert.from_label}'s phone number to call with one tap.`}</Body>
                {tel ? (
                  <View style={{ flexDirection: "row", gap: spacing.sm }}>
                    <Button testID="family-alert-call" label={`Call ${alert.from_label}`} icon={<Phone size={18} color={colors.onBrandPrimary} />} onPress={() => call("tel")} style={{ flex: 1 }} />
                    <Button testID="family-alert-sms" variant="secondary" label="Message" icon={<MessageCircle size={18} color={colors.onSurface} />} onPress={() => call("sms")} />
                  </View>
                ) : null}
                {editing || !tel ? (
                  <>
                    <TextInput testID="family-alert-phone" style={s.input} value={phone} onChangeText={setPhone} placeholder="+61 4xx xxx xxx" placeholderTextColor={colors.muted} keyboardType="phone-pad" autoCorrect={false} />
                    {err ? <Text style={s.err} testID="family-alert-error">{err}</Text> : null}
                    <Button testID="family-alert-save-phone" variant="secondary" label={savePhone.isPending ? "Saving…" : "Save number"} onPress={() => savePhone.mutate()} disabled={savePhone.isPending || !phone.trim()} />
                  </>
                ) : (
                  <Button testID="family-alert-edit-phone" variant="ghost" label={`Change number (${alert.phone})`} onPress={() => setEditing(true)} />
                )}
              </Card>
            </View>

            <View>
              <SectionTitle>Send {alert.from_label} a quick note</SectionTitle>
              <Card style={{ gap: spacing.sm }} testID="family-alert-notes">
                <Button testID="family-alert-note-calling" variant="secondary" label="I'm calling you now" onPress={() => sendNote.mutate({ kind: "calling" })} disabled={sendNote.isPending} />
                <Button testID="family-alert-note-wait" variant="secondary" label="Don't do anything yet" onPress={() => sendNote.mutate({ kind: "wait" })} disabled={sendNote.isPending} />
                {writing ? (
                  <>
                    <TextInput testID="family-alert-note-input" style={s.noteInput} value={own} onChangeText={setOwn} placeholder="Write a short note" placeholderTextColor={colors.muted} multiline maxLength={NOTE_MAX} autoFocus />
                    <Text style={s.hint} testID="family-alert-note-hint">{NOTE_MAX - own.length} characters left. Never send codes or passwords in a note.</Text>
                    <Button testID="family-alert-note-send" label={sendNote.isPending ? "Sending…" : "Send note"} onPress={() => sendNote.mutate({ kind: "custom", text: own })} disabled={sendNote.isPending || !own.trim()} />
                  </>
                ) : (
                  <Button testID="family-alert-note-write" variant="ghost" label="Write your own note" onPress={() => setWriting(true)} />
                )}
                {(notes.data ?? []).map((n) => (
                  <Text key={n.note_id} style={s.sent} testID={`family-alert-note-sent-${n.note_id}`}>You sent: “{n.text}” · {formatDateTime(n.created_at)}</Text>
                ))}
              </Card>
            </View>

            {!alert.acknowledged_at ? (
              <View>
                <SectionTitle>Let them know you saw this</SectionTitle>
                <Card style={{ gap: spacing.sm }}>
                  <Button testID="family-alert-ack-called" variant="secondary" label="I called them" onPress={() => ack.mutate("called")} disabled={ack.isPending} />
                  <Button testID="family-alert-ack-messaged" variant="ghost" label="I messaged them" onPress={() => ack.mutate("messaged")} disabled={ack.isPending} />
                  <Button testID="family-alert-ack-visiting" variant="ghost" label="I'm visiting them" onPress={() => ack.mutate("visiting")} disabled={ack.isPending} />
                </Card>
              </View>
            ) : null}
          </>
        )}
      </KeyboardAwareScrollView>
    </View>
  );
}
