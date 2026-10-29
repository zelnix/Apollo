import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import Phone from "lucide-react-native/icons/phone";
import MonitorUp from "lucide-react-native/icons/monitor-up";
import React, { useEffect, useRef, useState } from "react";
import { Alert, Linking, Platform, Pressable, Switch, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView, type KeyboardAwareScrollViewRef } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiDelete, apiGet, apiPost, apiPut } from "@/src/api/client";
import { ServiceBanner, StaleNote } from "@/src/components/ServiceBanner";
import { Body, Button, Card, Pill, SectionTitle } from "@/src/components/ui";
import { type FamilyWeekly, lastSeenLabel, weeklyDetails, weeklyHeadline } from "@/src/domain/familyWeekly";
import { STATE_NAME, type ApolloState } from "@/src/domain/types";
import { familyScamAlerts, openScamAlert, SEVERITY_TONE, severityLabel } from "@/src/higgins/scamAlertUi";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";
import { storage } from "@/src/utils/storage";
import { CloseButton } from "@/src/components/CloseButton";

interface SharedEvent { event_id: string; protected_device_id?: string; from_label: string; state: string; headline: string; what_to_do: string; indicator_host: string | null; occurred_at: string; acknowledged_at?: string; ack_label?: string; phone?: string }
interface WatchLink { link_id: string; owner_name: string; protected_device_id: string; phone: string; my_label: string }
interface Watcher { link_id: string; guardian_label: string; since: string }
interface Ack { event_id: string; guardian_label: string; ack_label: string; headline: string; acknowledged_at: string }
interface Checkin { guardian_device_id: string; protected_device_id: string; week_key: string; guardian_label: string; reply: string; label: string; created_at: string }
interface PairCode { code: string; expires_at: string }

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.xl },
  input: { minHeight: 48, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingHorizontal: spacing.lg, fontFamily: fonts.text, fontSize: 15, color: c.onSurface },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  name: { fontFamily: fonts.textMedium, fontSize: 15, color: c.onSurface },
  linkText: { fontFamily: fonts.textMedium, fontSize: 14, color: c.brandPrimary, paddingVertical: spacing.sm },
  code: { fontFamily: fonts.displayBold, fontSize: 32, letterSpacing: 6, color: c.onSurface, textAlign: "center" },
  err: { fontFamily: fonts.textMedium, fontSize: 13, color: c.barkingText },
}));

export default function Family() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  // Opened from Threats → Family alerts: go straight to the alerts from people you watch, following the section down
  // as the cards above it load, until the person scrolls themselves.
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const scrollRef = useRef<KeyboardAwareScrollViewRef>(null);
  const alertsY = useRef({ section: 0, inner: 0, userScrolled: false });
  const toAlerts = () => { if (focus === "alerts" && !alertsY.current.userScrolled) scrollRef.current?.scrollTo({ y: alertsY.current.section + alertsY.current.inner, animated: false }); };
  const qc = useQueryClient();
  const { deviceId, showToast } = useApollo();
  const [owner, setOwner] = useState("");
  const [code, setCode] = useState(""); const [pairCode, setPairCode] = useState<PairCode | null>(null); const [codeExpired, setCodeExpired] = useState(false); const [err, setErr] = useState<string | null>(null);
  // A pairing code works for 15 minutes: when that runs out it disappears and the button offers a new one.
  useEffect(() => {
    if (!pairCode) return;
    const left = Date.parse(pairCode.expires_at) - Date.now();
    const expire = () => { setPairCode(null); setCodeExpired(true); };
    if (!(left > 0)) { expire(); return; }
    const t = setTimeout(expire, left);
    return () => clearTimeout(t);
  }, [pairCode]);

  const links = useQuery({ queryKey: ["family-links", deviceId], enabled: !!deviceId, queryFn: () => apiGet<{ i_watch: WatchLink[]; watching_me: number; watchers: Watcher[] }>(`/family/links?device_id=${deviceId}`) });
  const shared = useQuery({ queryKey: ["shared-events", deviceId], enabled: !!deviceId, queryFn: () => apiGet<SharedEvent[]>(`/family/shared-events?device_id=${deviceId}`), refetchInterval: 30000 });
  const incidents = useQuery({ queryKey: ["family-incidents", deviceId], enabled: !!deviceId, queryFn: () => apiGet<{ scent_id: string; from_label: string; headline: string; state: ApolloState; steps: { id: string }[]; done: string[]; resolved: boolean; updated_at: string }[]>(`/family/incidents?device_id=${deviceId}`) });
  const scamShares = useQuery({ queryKey: ["family-scam-alerts", deviceId], enabled: !!deviceId, queryFn: () => familyScamAlerts(deviceId!) });
  const acks = useQuery({ queryKey: ["family-acks", deviceId], enabled: !!deviceId, queryFn: () => apiGet<Ack[]>(`/family/acks?device_id=${deviceId}`), refetchInterval: 30000 });
  const weekly = useQuery({ queryKey: ["family-weekly", deviceId], enabled: !!deviceId, queryFn: () => apiGet<FamilyWeekly[]>(`/family/weekly?device_id=${deviceId}`) });
  const weeklyPref = useQuery({ queryKey: ["family-weekly-pref", deviceId], enabled: !!deviceId, queryFn: () => apiGet<{ enabled: boolean; last_sent_at: string | null; window: string }>(`/family/weekly/notify?device_id=${deviceId}`) });
  const setWeeklyPref = useMutation({
    mutationFn: (enabled: boolean) => apiPut<{ enabled: boolean }>("/family/weekly/notify", "family", { device_id: deviceId, enabled }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["family-weekly-pref", deviceId] }); showToast(r.enabled ? "Sunday check-in on. ApolloSG will nudge you Sunday evening." : "Sunday check-in off. The Family screen still shows the week.", "neutral"); },
  });
  const [weeklyPreview, setWeeklyPreview] = useState<string | null>(null);
  const checkins = useQuery({ queryKey: ["family-checkins", deviceId], enabled: !!deviceId, refetchInterval: 30000, queryFn: () => apiGet<Checkin[]>(`/family/weekly/checkins?device_id=${deviceId}`) });
  const [myName, setMyName] = useState("");
  useEffect(() => { void storage.getItem<string>("apollo.family.myname", "").then((v) => setMyName(v ?? "")); }, []);
  const checkin = useMutation({
    mutationFn: (p: { protected_device_id: string; reply: "spoke" | "messaged" | "will_call"; name: string }) => apiPost<{ label: string }>("/family/weekly/checkin", "family", { device_id: deviceId, protected_device_id: p.protected_device_id, reply: p.reply, from_name: myName.trim() }),
    onSuccess: (r, p) => { qc.invalidateQueries({ queryKey: ["family-checkins", deviceId] }); showToast(`Checked in: ${r.label.replace("them", p.name)}. ${p.name} will see it in their app.`, "resting"); },
    onError: (e) => showToast(e instanceof Error ? e.message : "Couldn't check in right now.", "barking"),
  });
  const myCheckinFor = (pid: string) => (checkins.data ?? []).find((c) => c.guardian_device_id === deviceId && c.protected_device_id === pid && Date.now() - Date.parse(c.created_at) < 7 * 86_400_000);
  const received = (checkins.data ?? []).filter((c) => c.protected_device_id === deviceId);
  const previewWeekly = useMutation({
    mutationFn: (p: { send: boolean; kind: "summary" | "nudge" }) => apiPost<{ sent: boolean; title?: string; message?: string; reason?: string }>("/family/weekly/send-now", "family", { device_id: deviceId, preview_only: !p.send, kind: p.kind }),
    onSuccess: (r, { send }) => { if (r.message) setWeeklyPreview(`${r.title} — ${r.message}`); if (send) showToast(r.sent ? "Sent. Check your notifications." : "Nothing to send yet — pair with someone first.", r.sent ? "resting" : "neutral"); },
    onError: (e) => showToast(e instanceof Error ? e.message : "Couldn't reach ApolloSG's relay.", "barking"),
  });
  const ack = useMutation({
    mutationFn: (p: { event_id: string; reply: string }) => apiPost<{ ack_label: string }>(`/family/shared-events/${p.event_id}/ack`, "family", { device_id: deviceId, reply: p.reply }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["shared-events", deviceId] }); showToast(`Marked: ${r.ack_label}`, "resting"); },
  });
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["family-links", deviceId] }); qc.invalidateQueries({ queryKey: ["shared-events", deviceId] }); };

  const makeCode = useMutation({
    mutationFn: () => apiPost<PairCode>("/family/pair", "family", { device_id: deviceId, owner_name: owner.trim() }),
    onSuccess: (r) => { setErr(null); setCodeExpired(false); setPairCode(r); },
    onError: (e) => setErr(e instanceof Error ? e.message : "Could not create code"),
  });
  // Unlink Device: either side can end a pairing. Soft-deleted on the server → that device stops receiving alerts, pushes and weekly rollups.
  const unlink = useMutation({
    mutationFn: (linkId: string) => apiDelete(`/family/links/${linkId}?device_id=${deviceId}`),
    onSuccess: () => { invalidate(); qc.invalidateQueries({ queryKey: ["family-weekly", deviceId] }); showToast("Pairing removed. That phone no longer receives alerts.", "neutral"); },
    onError: (e) => setErr(e instanceof Error ? e.message : "Could not remove the pairing"),
  });
  const confirmUnlink = (linkId: string, who: string, mine: boolean) => {
    const title = mine ? `Remove ${who}?` : `Stop watching ${who}?`;
    const msg = mine ? `${who} will stop receiving your alerts, incidents and weekly check-ins. You can pair again with a new code.` : `You will stop receiving ${who}'s alerts and weekly check-ins.`;
    if (Platform.OS === "web") { if (typeof globalThis.confirm !== "function" || globalThis.confirm(`${title}\n\n${msg}`)) unlink.mutate(linkId); return; }
    Alert.alert(title, msg, [{ text: "Keep", style: "cancel" }, { text: mine ? "Remove" : "Stop watching", style: "destructive", onPress: () => unlink.mutate(linkId) }]);
  };
  // Watcher Names: the guardian's own name (the "Your name" field) is sent with the pairing and can be changed later.
  const rename = useMutation({
    mutationFn: (v: { linkId: string; name: string }) => apiPut(`/family/links/${v.linkId}/name`, "family", { device_id: deviceId, name: v.name }),
    onSuccess: () => { invalidate(); showToast("They'll now see your name on their phone.", "resting"); },
    onError: (e) => setErr(e instanceof Error ? e.message : "Could not update your name"),
  });
  const link = useMutation({
    mutationFn: () => apiPost<{ owner_name: string }>("/family/link", "family", { device_id: deviceId, code: code.trim(), guardian_name: owner.trim() }),
    onSuccess: (r) => { setCode(""); setErr(null); invalidate(); showToast(`Now watching ${r.owner_name || "a family member"}`, "resting"); },
    onError: (e) => setErr(e instanceof Error ? e.message : "Could not link"),
  });

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Family sharing</Text>
        <CloseButton testID="family-close" label="Close Family" onPress={() => goBackOrHome(router)} />
      </View>
      <KeyboardAwareScrollView ref={scrollRef} onScrollBeginDrag={() => { alertsY.current.userScrolled = true; }} contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} bottomOffset={24} testID="family-scroll">
        {err ? <Text style={s.err} testID="family-error">{err}</Text> : null}
        <ServiceBanner />
        <StaleNote queries={[links, shared, incidents, acks, weekly, checkins]} testID="family-stale-note" />

        <Card style={{ gap: spacing.md }} testID="family-help-entry-card">
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}><MonitorUp size={24} color={colors.brandPrimary} /><SectionTitle>Family Help</SectionTitle></View>
          <Body>Ask someone you trust to watch your screen while you solve a problem. They cannot control your device.</Body>
          <Pressable testID="family-help-open" accessibilityRole="button" onPress={() => router.push("/family/help")} style={s.row}><Text style={s.name}>Open Family Help</Text><ChevronRight size={20} color={colors.muted} /></Pressable>
        </Card>

        <View>
          <SectionTitle>Your name (shown to them)</SectionTitle>
          <TextInput testID="family-owner-name" style={s.input} value={owner} onChangeText={setOwner} placeholder="e.g. Mum" placeholderTextColor={colors.muted} />
        </View>

        <View>
          <SectionTitle>Pair another ApolloSG device</SectionTitle>
          <Card style={{ gap: spacing.md }} testID="family-pair-card">
            <Body>Give this code to a family member who also uses ApolloSG. Your Barking/Biting alerts will appear in their app, and they get a calm weekly check-in — how many things Apollo checked and how many alerts — never what you checked.</Body>
            {pairCode ? (
              <View style={{ gap: spacing.xs }}>
                <Text style={s.code} selectable testID="family-pair-code">{pairCode.code}</Text>
                <Body testID="family-pair-code-expiry" style={{ textAlign: "center" }}>Works once. Expires in 15 minutes, at {new Date(pairCode.expires_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.</Body>
              </View>
            ) : codeExpired ? <Body testID="family-pair-code-expired">That code has expired. Create a new one when they&apos;re ready to enter it.</Body> : null}
            <Button testID="family-make-code" variant="secondary" label={pairCode ? "New code" : "Create pairing code"} onPress={() => makeCode.mutate()} disabled={makeCode.isPending} />
            <Body>{links.data?.watching_me ? `${links.data.watching_me} device${links.data.watching_me > 1 ? "s receive" : " receives"} your alerts.` : "No devices linked yet."}</Body>
            {(links.data?.watchers ?? []).map((w) => (
              <View key={w.link_id} style={s.row} testID={`family-watcher-${w.link_id}`}>
                <View style={{ flex: 1 }}><Text style={s.name}>{w.guardian_label}</Text><Body>Paired {new Date(w.since).toLocaleDateString()}</Body></View>
                <Button testID={`family-watcher-remove-${w.link_id}`} variant="ghost" label="Remove" onPress={() => confirmUnlink(w.link_id, w.guardian_label, true)} disabled={unlink.isPending} />
              </View>
            ))}
            <TextInput testID="family-link-code" style={s.input} value={code} onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} placeholder="Enter the 6-digit code you were given" placeholderTextColor={colors.muted} keyboardType="number-pad" maxLength={6} />
            <Button testID="family-link-button" variant="secondary" label="Link" onPress={() => link.mutate()} disabled={!/^\d{6}$/.test(code) || link.isPending} />
          </Card>
        </View>

        <View onLayout={(e) => { alertsY.current.section = e.nativeEvent.layout.y; toAlerts(); }}>
          {(weekly.data ?? []).length ? (
            <>
              <SectionTitle>Weekly check-in</SectionTitle>
              <Card style={{ gap: spacing.md }} testID="family-weekly">
                {weekly.data!.map((w) => { const h = weeklyHeadline(w); const details = weeklyDetails(w); return (
                  <View key={w.protected_device_id} style={{ gap: spacing.xs, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider }} testID={`family-weekly-${w.protected_device_id}`}>
                    <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center", flexWrap: "wrap" }}><Pill tone={h.tone} label={h.tone === "resting" ? "Calm week" : h.tone === "growling" ? "Needs a call" : h.tone === "ears_up" ? "Handled" : "No news"} testID={`family-weekly-tone-${w.protected_device_id}`} /><Body>{w.owner_name || "Family member"} · last 7 days</Body></View>
                    <Text style={s.name} testID={`family-weekly-headline-${w.protected_device_id}`}>{h.text}</Text>
                    {details.length ? <Body testID={`family-weekly-details-${w.protected_device_id}`}>{details.join(" · ")}</Body> : null}
                    <Body>{lastSeenLabel(w)}</Body>
                    {w.phone ? <View style={{ flexDirection: "row" }}><Button testID={`family-weekly-call-${w.protected_device_id}`} variant={h.tone === "growling" ? "primary" : "ghost"} label={`Call ${w.owner_name || "them"}`} icon={<Phone size={16} color={h.tone === "growling" ? colors.onBrandPrimary : colors.onSurface} />} onPress={() => void Linking.openURL(`tel:${w.phone.replace(/[^+\d]/g, "")}`)} /></View> : null}
                    {(() => { const done = myCheckinFor(w.protected_device_id); return done ? (
                      <Pill tone="resting" label={`Checked in · ${done.label.replace("them", w.owner_name || "them")} · ${new Date(done.created_at).toLocaleDateString([], { weekday: "short" })}`} testID={`family-weekly-checkin-done-${w.protected_device_id}`} />
                    ) : (
                      <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
                        <Button testID={`family-weekly-checkin-spoke-${w.protected_device_id}`} variant="secondary" label={`All good, spoke to ${w.owner_name || "them"}`} onPress={() => checkin.mutate({ protected_device_id: w.protected_device_id, reply: "spoke", name: w.owner_name || "them" })} disabled={checkin.isPending} />
                        <Button testID={`family-weekly-checkin-messaged-${w.protected_device_id}`} variant="ghost" label="Messaged them" onPress={() => checkin.mutate({ protected_device_id: w.protected_device_id, reply: "messaged", name: w.owner_name || "them" })} disabled={checkin.isPending} />
                      </View>
                    ); })()}
                  </View>); })}
                <Body>Counts only — ApolloSG never shares what they checked, their messages or their links.</Body>
                <View style={[s.row, { borderBottomWidth: 0 }]} testID="family-weekly-notify-row">
                  <View style={{ flex: 1 }}><Text style={s.name}>Sunday check-in notification</Text><Body>{weeklyPref.data?.window ?? "Sunday 5–9 pm, your local time"}{weeklyPref.data?.last_sent_at ? ` · last sent ${new Date(weeklyPref.data.last_sent_at).toLocaleDateString()}` : ""}. Same calm summary, so you don&apos;t have to open the app. If you haven&apos;t said hello by Tuesday evening, ApolloSG sends one gentle reminder.</Body></View>
                  <Switch testID="family-weekly-notify-switch" value={weeklyPref.data?.enabled ?? true} onValueChange={(v) => setWeeklyPref.mutate(v)} trackColor={{ true: colors.resting, false: colors.borderStrong }} thumbColor={colors.onSurface} />
                </View>
                <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
                  <Button testID="family-weekly-preview" variant="ghost" label={previewWeekly.isPending ? "…" : "Preview Sunday's"} onPress={() => previewWeekly.mutate({ send: false, kind: "summary" })} disabled={previewWeekly.isPending} />
                  <Button testID="family-weekly-preview-nudge" variant="ghost" label="Preview Tuesday's" onPress={() => previewWeekly.mutate({ send: false, kind: "nudge" })} disabled={previewWeekly.isPending} />
                  {Platform.OS !== "web" ? <Button testID="family-weekly-send-now" variant="secondary" label="Send Sunday's now" onPress={() => previewWeekly.mutate({ send: true, kind: "summary" })} disabled={previewWeekly.isPending} /> : null}
                </View>
                {weeklyPreview ? <Body testID="family-weekly-preview-text">{weeklyPreview}</Body> : null}
                {Platform.OS === "web" ? <Body>Notifications arrive on the device app (a native build) — the preview shows the exact wording.</Body> : null}
              </Card>
            </>
          ) : null}
          {(scamShares.data ?? []).length ? (
            <>
              <SectionTitle>Scam alerts from your family</SectionTitle>
              <Card testID="family-scam-alerts">
                {scamShares.data!.map((f, i) => (
                  <Pressable key={`${f.url}-${f.from_label}`} onPress={() => openScamAlert(router, f.url)} testID={`family-scam-alert-${i}`} accessibilityRole="button" style={{ paddingVertical: spacing.sm, gap: 4, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
                    <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center", flexWrap: "wrap" }}><Pill tone={SEVERITY_TONE[f.severity]} label={severityLabel(f.severity)} /><Body>{f.from_label} · {new Date(f.shared_at).toLocaleString()}</Body></View>
                    <Text style={s.name}>{f.title}</Text>
                    <Body>{f.source} · Tap to see what to look for and how to stay safe.</Body>
                  </Pressable>
                ))}
              </Card>
            </>
          ) : null}
          {(incidents.data ?? []).length ? (
            <>
              <SectionTitle>Incidents shared with you</SectionTitle>
              <Card testID="family-incidents">
                {incidents.data!.map((inc) => (
                  <Pressable key={inc.scent_id} onPress={() => router.push(`/family/incident/${inc.scent_id}`)} testID={`family-incident-open-${inc.scent_id}`} accessibilityRole="button" style={{ paddingVertical: spacing.sm, gap: 4, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
                    <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center", flexWrap: "wrap" }}><Pill tone={inc.resolved ? "resting" : inc.state} label={inc.resolved ? "Handled" : STATE_NAME[inc.state]} /><Body>{inc.from_label} · {inc.done.length}/{inc.steps.length} steps · {new Date(inc.updated_at).toLocaleString()}</Body></View>
                    <Text style={s.name}>{inc.headline}</Text>
                    <Body>Tap to see the timeline and help them through the steps.</Body>
                  </Pressable>
                ))}
              </Card>
            </>
          ) : null}
          <View onLayout={(e) => { alertsY.current.inner = e.nativeEvent.layout.y; toAlerts(); }} testID="family-alerts-section">
          <SectionTitle>Alerts from people you watch</SectionTitle>
          <Card testID="family-shared">
            {(links.data?.i_watch ?? []).map((l) => (
              <View key={l.protected_device_id} style={s.row} testID={`family-watch-${l.protected_device_id}`}>
                <View style={{ flex: 1 }}>
                  <Text style={s.name}>{l.owner_name || "Family member"}</Text>
                  <Body>{l.phone ? l.phone : "No phone number yet — add one from any of their alerts"}</Body>
                  <Body testID={`family-watch-label-${l.protected_device_id}`}>{l.my_label ? `They see you as “${l.my_label}”` : "They see you as “A family member”"}</Body>
                  {owner.trim() && owner.trim() !== l.my_label ? <Pressable testID={`family-watch-rename-${l.protected_device_id}`} accessibilityRole="button" onPress={() => rename.mutate({ linkId: l.link_id, name: owner.trim() })} disabled={rename.isPending}><Text style={s.linkText}>Use “{owner.trim()}” instead</Text></Pressable> : null}
                </View>
                {l.phone ? <Button testID={`family-watch-call-${l.protected_device_id}`} variant="secondary" label="Call" icon={<Phone size={16} color={colors.onSurface} />} onPress={() => void Linking.openURL(`tel:${l.phone.replace(/[^+\d]/g, "")}`)} /> : null}
                <Button testID={`family-watch-stop-${l.protected_device_id}`} variant="ghost" label="Stop" onPress={() => confirmUnlink(l.link_id, l.owner_name || "this person", false)} disabled={unlink.isPending} />
              </View>
            ))}
            {(shared.data ?? []).length === 0 ? <Body>No alerts. That&apos;s good news.</Body> : shared.data!.map((e) => (
              <View key={e.event_id} style={{ paddingVertical: spacing.sm, gap: 4, borderBottomWidth: 1, borderBottomColor: colors.divider }} testID={`family-shared-${e.event_id}`}>
                <Pressable onPress={() => router.push(`/family/alert/${e.event_id}`)} testID={`family-shared-open-${e.event_id}`} accessibilityRole="button" style={{ gap: 4 }}>
                  <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}><Pill tone={e.state as "barking"} label={STATE_NAME[e.state as ApolloState]} /><Body>{e.from_label} · {new Date(e.occurred_at).toLocaleString()}</Body><ChevronRight size={16} color={colors.muted} /></View>
                  <Text style={s.name}>{e.headline}</Text>
                  <Body>{e.what_to_do}</Body>
                </Pressable>
                {e.acknowledged_at ? <Pill tone="resting" label={`${e.ack_label} · ${new Date(e.acknowledged_at).toLocaleDateString()}`} testID={`family-ack-done-${e.event_id}`} /> : (
                  <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
                    {e.phone ? <Button testID={`family-call-${e.event_id}`} label="Call" icon={<Phone size={16} color={colors.onBrandPrimary} />} onPress={() => { void Linking.openURL(`tel:${e.phone!.replace(/[^+\d]/g, "")}`); ack.mutate({ event_id: e.event_id, reply: "called" }); }} /> : null}
                    <Button testID={`family-ack-called-${e.event_id}`} variant="secondary" label="I called them" onPress={() => ack.mutate({ event_id: e.event_id, reply: "called" })} />
                    <Button testID={`family-ack-messaged-${e.event_id}`} variant="ghost" label="I messaged them" onPress={() => ack.mutate({ event_id: e.event_id, reply: "messaged" })} />
                  </View>
                )}
              </View>
            ))}
          </Card>
          </View>
        </View>

        <View>
          <SectionTitle>Family responses to your alerts</SectionTitle>
          <Card testID="family-acks">
            {received.length ? (
              <View style={{ gap: 2, paddingBottom: spacing.sm }} testID="family-checkins-received">
                {received.map((c) => (
                  <View key={`${c.guardian_device_id}-${c.week_key}`} style={s.row} testID={`family-checkin-${c.guardian_device_id}-${c.week_key}`}>
                    <View style={{ flex: 1 }}><Text style={s.name}>{c.guardian_label} checked in</Text><Body>{c.label.replace("them", "you")}</Body></View>
                    <Body>{new Date(c.created_at).toLocaleDateString()}</Body>
                  </View>
                ))}
              </View>
            ) : null}
            {(acks.data ?? []).length === 0 ? <Body>No responses yet. When someone you share with marks an alert handled, it shows here.</Body> : acks.data!.map((a) => (
              <View key={a.event_id} style={s.row} testID={`family-acks-${a.event_id}`}>
                <View style={{ flex: 1 }}><Text style={s.name}>{a.headline}</Text><Body>{a.guardian_label}: {a.ack_label}</Body></View>
                <Body>{new Date(a.acknowledged_at).toLocaleDateString()}</Body>
              </View>
            ))}
          </Card>
        </View>
        {Platform.OS === "web" ? null : <Body>Tip: a quick phone call is usually the most helpful response to an alert.</Body>}
      </KeyboardAwareScrollView>
    </View>
  );
}
