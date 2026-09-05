import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import X from "lucide-react-native/icons/x";
import React, { useState } from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiDelete, apiGet, apiPost } from "@/src/api/client";
import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

interface GuardianRow { guardian_id: string; email: string; name: string; confirmed: boolean }
interface SharedEvent { event_id: string; from_label: string; state: string; headline: string; what_to_do: string; indicator_host: string | null; occurred_at: string }

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.xl },
  input: { minHeight: 48, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  name: { fontFamily: fonts.textMedium, fontSize: 15, color: c.onSurface },
  code: { fontFamily: fonts.displayBold, fontSize: 32, letterSpacing: 6, color: c.onSurface, textAlign: "center" },
  err: { fontFamily: fonts.textMedium, fontSize: 13, color: c.barking },
}));

export default function Family() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();
  const { deviceId, showToast } = useApollo();
  const [email, setEmail] = useState(""); const [name, setName] = useState(""); const [owner, setOwner] = useState("");
  const [code, setCode] = useState(""); const [pairCode, setPairCode] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null);

  const guardians = useQuery({ queryKey: ["guardians", deviceId], enabled: !!deviceId, queryFn: () => apiGet<GuardianRow[]>(`/family/guardians?device_id=${deviceId}`) });
  const links = useQuery({ queryKey: ["family-links", deviceId], enabled: !!deviceId, queryFn: () => apiGet<{ i_watch: { owner_name: string }[]; watching_me: number }>(`/family/links?device_id=${deviceId}`) });
  const shared = useQuery({ queryKey: ["shared-events", deviceId], enabled: !!deviceId, queryFn: () => apiGet<SharedEvent[]>(`/family/shared-events?device_id=${deviceId}`), refetchInterval: 30000 });
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["guardians", deviceId] }); qc.invalidateQueries({ queryKey: ["family-links", deviceId] }); qc.invalidateQueries({ queryKey: ["shared-events", deviceId] }); };

  const addGuardian = useMutation({
    mutationFn: () => apiPost("/family/guardians", "family", { device_id: deviceId, email: email.trim(), name: name.trim(), owner_name: owner.trim() }),
    onSuccess: () => { setEmail(""); setName(""); setErr(null); invalidate(); showToast("Invitation email sent", "resting"); },
    onError: (e) => setErr(e instanceof Error ? e.message : "Could not add"),
  });
  const remove = useMutation({ mutationFn: (id: string) => apiDelete(`/family/guardians/${id}?device_id=${deviceId}`), onSuccess: () => { invalidate(); showToast("Removed", "neutral"); } });
  const makeCode = useMutation({ mutationFn: () => apiPost<{ code: string }>("/family/pair", "family", { device_id: deviceId, owner_name: owner.trim() }), onSuccess: (r) => setPairCode(r.code) });
  const link = useMutation({
    mutationFn: () => apiPost<{ owner_name: string }>("/family/link", "family", { device_id: deviceId, code: code.trim().toUpperCase() }),
    onSuccess: (r) => { setCode(""); setErr(null); invalidate(); showToast(`Now watching ${r.owner_name || "a family member"}`, "resting"); },
    onError: (e) => setErr(e instanceof Error ? e.message : "Could not link"),
  });

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Family sharing</Text>
        <Pressable testID="family-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <KeyboardAwareScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} bottomOffset={24} testID="family-scroll">
        <Body>Share only Barking and Biting alerts — headline, website and what to do — with someone you trust. Never the full link, never your browsing.</Body>
        {err ? <Text style={s.err} testID="family-error">{err}</Text> : null}

        <View>
          <SectionTitle>Your name (shown to them)</SectionTitle>
          <TextInput testID="family-owner-name" style={s.input} value={owner} onChangeText={setOwner} placeholder="e.g. Mum" placeholderTextColor={colors.muted} />
        </View>

        <View>
          <SectionTitle>Email alerts</SectionTitle>
          <Card style={{ gap: spacing.md }} testID="family-email-card">
            {(guardians.data ?? []).map((g) => (
              <View key={g.guardian_id} style={s.row} testID={`family-guardian-${g.guardian_id}`}>
                <View style={{ flex: 1 }}><Text style={s.name}>{g.name || g.email}</Text><Body>{g.email}</Body></View>
                <Pill tone={g.confirmed ? "resting" : "growling"} label={g.confirmed ? "Confirmed" : "Awaiting confirmation"} />
                <Button testID={`family-remove-${g.guardian_id}`} variant="ghost" label="Remove" onPress={() => remove.mutate(g.guardian_id)} />
              </View>
            ))}
            <TextInput testID="family-guardian-name" style={s.input} value={name} onChangeText={setName} placeholder="Their name" placeholderTextColor={colors.muted} />
            <TextInput testID="family-guardian-email" style={s.input} value={email} onChangeText={setEmail} placeholder="their@email.com" placeholderTextColor={colors.muted} autoCapitalize="none" keyboardType="email-address" autoCorrect={false} />
            <Button testID="family-add-guardian" label={addGuardian.isPending ? "Sending…" : "Send invitation"} onPress={() => addGuardian.mutate()} disabled={!email.trim() || addGuardian.isPending} />
            <Body>They must confirm by email before any alert is sent. Max 5 alerts per day per person.</Body>
          </Card>
        </View>

        <View>
          <SectionTitle>Pair another Apollo device</SectionTitle>
          <Card style={{ gap: spacing.md }} testID="family-pair-card">
            <Body>Give this code to a family member who also uses Apollo. Your Barking/Biting alerts will appear in their app.</Body>
            {pairCode ? <Text style={s.code} selectable testID="family-pair-code">{pairCode}</Text> : null}
            <Button testID="family-make-code" variant="secondary" label={pairCode ? "New code" : "Create pairing code"} onPress={() => makeCode.mutate()} disabled={makeCode.isPending} />
            <Body>{links.data?.watching_me ? `${links.data.watching_me} device${links.data.watching_me > 1 ? "s" : ""} receive your alerts.` : "No devices linked yet."}</Body>
            <TextInput testID="family-link-code" style={s.input} value={code} onChangeText={setCode} placeholder="Enter a code you were given" placeholderTextColor={colors.muted} autoCapitalize="characters" maxLength={6} />
            <Button testID="family-link-button" variant="secondary" label="Link" onPress={() => link.mutate()} disabled={code.trim().length !== 6 || link.isPending} />
          </Card>
        </View>

        <View>
          <SectionTitle>Alerts from people you watch</SectionTitle>
          <Card testID="family-shared">
            {(links.data?.i_watch ?? []).length ? <Body style={{ marginBottom: spacing.sm }}>Watching: {links.data!.i_watch.map((l) => l.owner_name || "Family member").join(", ")}</Body> : null}
            {(shared.data ?? []).length === 0 ? <Body>No alerts. That&apos;s good news.</Body> : shared.data!.map((e) => (
              <View key={e.event_id} style={{ paddingVertical: spacing.sm, gap: 4, borderBottomWidth: 1, borderBottomColor: colors.divider }} testID={`family-shared-${e.event_id}`}>
                <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}><Pill tone={e.state as "barking"} label={e.state} /><Body>{e.from_label} · {new Date(e.occurred_at).toLocaleString()}</Body></View>
                <Text style={s.name}>{e.headline}</Text>
                <Body>{e.what_to_do}</Body>
              </View>
            ))}
          </Card>
        </View>
        {Platform.OS === "web" ? null : <Body>Tip: a quick phone call is usually the most helpful response to an alert.</Body>}
      </KeyboardAwareScrollView>
    </View>
  );
}
