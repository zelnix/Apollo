// Family alert detail — opened from a push tap (action_url /family/alert/{event_id}) or from the Family screen.
// Shows the shared summary (never the full link) with one-tap Call / Message and the Guardian Reply.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import MessageCircle from "lucide-react-native/icons/message-circle";
import Phone from "lucide-react-native/icons/phone";
import X from "lucide-react-native/icons/x";
import React, { useEffect, useState } from "react";
import { Linking, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGet, apiPost } from "@/src/api/client";
import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import { STATE_NAME, type ApolloState } from "@/src/domain/types";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

export interface SharedAlert {
  event_id: string; protected_device_id?: string; from_label: string; state: string; headline: string; what_to_do: string;
  indicator_host: string | null; occurred_at: string; acknowledged_at?: string; ack_label?: string; phone?: string;
}

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.xl },
  headline: { fontFamily: fonts.displayBold, fontSize: 20, color: c.onSurface, lineHeight: 26 },
  input: { minHeight: 48, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  err: { fontFamily: fonts.textMedium, fontSize: 13, color: c.barking },
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
  const call = (scheme: "tel" | "sms") => {
    if (!tel) { setEditing(true); return; }
    void Linking.openURL(`${scheme}:${tel}`).catch(() => showToast("This device can't place the call.", "barking"));
    if (scheme === "tel" && !alert?.acknowledged_at) ack.mutate("called");
  };

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Family alert</Text>
        <Pressable testID="family-alert-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <KeyboardAwareScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} bottomOffset={24} testID="family-alert-scroll">
        {shared.isLoading ? <Body>Loading…</Body> : !alert ? (
          <Card><Body testID="family-alert-missing">This alert isn&apos;t available on this device. It may have been cleared, or the pairing was removed.</Body></Card>
        ) : (
          <>
            <Card style={{ gap: spacing.sm }} testID="family-alert-card">
              <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center", flexWrap: "wrap" }}>
                <Pill tone={alert.state as "barking"} label={STATE_NAME[alert.state as ApolloState] ?? alert.state} />
                <Body>{alert.from_label} · {new Date(alert.occurred_at).toLocaleString()}</Body>
              </View>
              <Text style={s.headline} testID="family-alert-headline">{alert.headline}</Text>
              <Body>{alert.what_to_do}</Body>
              {alert.indicator_host ? <Body>Website involved: {alert.indicator_host}</Body> : null}
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
