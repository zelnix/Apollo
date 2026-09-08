// Incident Timeline — one Threat Scent, told in order (email → link → login → MFA), with a single combined
// Stay With Me plan the user can tick off. Resolving the incident resolves every linked event.
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Check from "lucide-react-native/icons/check";
import Heart from "lucide-react-native/icons/heart";
import Phone from "lucide-react-native/icons/phone";
import X from "lucide-react-native/icons/x";
import React, { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGet, apiPatch, apiPost } from "@/src/api/client";
import { HigginsReadAloud } from "@/src/components/HigginsReadAloud";
import { StaleNote } from "@/src/components/ServiceBanner";
import { VoiceCaption, VoicePlayButton } from "@/src/components/VoiceNote";
import { Body, Button, Card, Pill, SectionTitle, toneColor } from "@/src/components/ui";
import { narrateIncident } from "@/src/domain/higginsNarration";
import { buildIncidentPlan, CATEGORY_GLYPH, CATEGORY_LABEL } from "@/src/domain/incidentPlan";
import { STATE_LABEL, STATE_NAME } from "@/src/domain/types";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { storage } from "@/src/utils/storage";
import { goBackOrHome } from "@/src/utils/navigation";

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
  row: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  rail: { width: 28, alignItems: "center" },
  glyph: { fontSize: 18, lineHeight: 24 },
  line: { width: 2, flex: 1, minHeight: 20, marginVertical: 4 },
  step: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start", paddingVertical: spacing.sm, minHeight: 44 },
  box: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, alignItems: "center", justifyContent: "center", marginTop: 1 },
  done: { textDecorationLine: "line-through", color: c.muted },
}));

export default function IncidentTimeline() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { events, ready, setupDone, upsertEvent, showToast, deviceId } = useApollo();
  const linked = useMemo(() => events.filter((e) => e.scent_id === id || e.event_id === id), [events, id]);
  const plan = useMemo(() => buildIncidentPlan(linked), [linked]);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [shared, setShared] = useState(false);
  const [sharing, setSharing] = useState(false);
  const doneCount = plan.steps.filter((st) => ticked[st.id]).length;
  // Reassurance notes from family arrive once the incident is shared; poll gently while the screen is open.
  const notes = useQuery({ queryKey: ["incident-notes", id, deviceId], enabled: shared && !!deviceId, refetchInterval: 15000, queryFn: () => apiGet<{ note_id: string; guardian_label: string; kind: string; text: string; phone: string; created_at: string; duration_s?: number; transcript?: string; transcript_status?: "pending" | "ready" | "unavailable" }[]>(`/family/incidents/${id}/notes?device_id=${deviceId}`) });
  // Tick progress survives leaving the screen; if the incident was shared with family, progress is mirrored to them.
  useEffect(() => { void storage.getItem<string | null>(`apollo.incident.${id}`, null).then((raw) => { if (raw) { const v = JSON.parse(raw) as { ticked: Record<string, boolean>; shared: boolean }; setTicked(v.ticked ?? {}); setShared(!!v.shared); } }); }, [id]);
  const save = (next: Record<string, boolean>, isShared: boolean, resolved = false) => {
    void storage.setItem(`apollo.incident.${id}`, JSON.stringify({ ticked: next, shared: isShared }));
    if (isShared) void apiPatch(`/family/incidents/${id}/progress`, { device_id: deviceId ?? "local-device", done: Object.keys(next).filter((k) => next[k]), resolved }).catch(() => undefined);
  };
  const toggle = (stepId: string) => setTicked((t) => { const next = { ...t, [stepId]: !t[stepId] }; save(next, shared); return next; });
  const shareWithFamily = async () => {
    setSharing(true);
    try {
      const r = await apiPost<{ shared_with: number }>("/family/incidents/share", "family", { device_id: deviceId ?? "local-device", scent_id: id, headline: plan.headline, state: plan.state, events: plan.timeline.map((e) => ({ event_id: e.event_id, category: e.category, state: e.state, headline: e.headline, occurred_at: e.occurred_at, status: e.status })), steps: plan.steps.map((st) => ({ id: st.id, text: st.text })), done: Object.keys(ticked).filter((k) => ticked[k]), note: "" });
      if (r.shared_with === 0) { showToast("No family linked yet. Pair someone in Family first.", "neutral"); return; }
      setShared(true); save(ticked, true);
      showToast(`Shared with ${r.shared_with} family member${r.shared_with > 1 ? "s" : ""}. They can see the timeline and your progress — nothing else.`, "resting");
    } catch { showToast("Couldn't reach Apollo's relay right now.", "barking"); } finally { setSharing(false); }
  };
  if (ready && !setupDone) return <Redirect href="/" />;

  const resolveAll = async () => { const at = new Date().toISOString(); for (const e of linked) if (e.status === "active") await upsertEvent({ ...e, status: "resolved", resolved_at: at }); save(ticked, shared, true); showToast("Incident marked handled. Apollo keeps the record.", "resting"); };

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Incident timeline</Text>
        <Pressable testID="incident-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      {!linked.length ? <View style={s.content}><Body>This incident is no longer available.</Body></View> : (
        <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} testID="incident-scroll">
          <Card style={{ gap: spacing.sm, borderColor: toneColor(colors, plan.state) }} testID="incident-summary">
            <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}><Pill tone={plan.state} label={STATE_NAME[plan.state]} testID="incident-state" /><Pill tone="neutral" label={`${linked.length} connected events`} testID="incident-count" />{plan.allResolved ? <Pill tone="resting" label="Handled" testID="incident-handled" /> : null}</View>
            <Text style={s.headline} testID="incident-headline">{plan.headline}</Text>
            <Text style={s.why}>{STATE_LABEL[plan.state]}</Text>
            <Body>{plan.exposure.length ? `You told Apollo: ${plan.exposure.join("; ")}. The plan below starts with the most urgent step.` : "Apollo connected these because they happened close together and point at the same target. Nothing is lost if you haven't typed, paid or approved anything."}</Body>
            <HigginsReadAloud chunks={narrateIncident(plan, ticked)} label="Higgins, read the whole incident" testID="incident-read" />
          </Card>

          {shared && (notes.data ?? []).length ? (
            <Card style={{ gap: spacing.sm, borderColor: colors.resting }} testID="incident-family-notes">
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}><Heart size={18} color={colors.resting} /><SectionTitle>From your family</SectionTitle></View>
              {notes.data!.map((n, i) => (
                <View key={n.note_id} style={{ gap: 2 }} testID={`incident-family-note-${i}`}>
                  <Text style={s.label}>{n.guardian_label}: <Text style={s.why}>{n.text}</Text></Text>
                  <Text style={s.meta}>{new Date(n.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Text>
                  {n.kind === "voice" ? <VoicePlayButton noteId={n.note_id} deviceId={deviceId ?? "local-device"} durationS={n.duration_s} label={`Hear ${n.guardian_label}`} /> : null}
                  {n.kind === "voice" ? <VoiceCaption status={n.transcript_status} text={n.transcript} testID={`incident-family-note-caption-${i}`} /> : null}
                  {n.phone ? <View style={{ flexDirection: "row", paddingTop: spacing.xs }}><Button testID={`incident-family-note-call-${i}`} variant="secondary" label={`Call ${n.guardian_label} back`} icon={<Phone size={16} color={colors.onSurface} />} onPress={() => void Linking.openURL(`tel:${n.phone.replace(/[^+\d]/g, "")}`)} /></View> : null}
                </View>
              ))}
              <Body>Family notes are reassurance only. If anyone — even family — asks for a password or code, stop and call them on a number you already know.</Body>
              <StaleNote queries={[notes]} testID="incident-family-notes-stale" />
            </Card>
          ) : null}

          <View>
            <SectionTitle>What happened, in order</SectionTitle>
            {plan.timeline.map((e, i) => (
              <Pressable key={e.event_id} testID={`incident-event-${i}`} accessibilityRole="button" onPress={() => router.push({ pathname: "/patrol/[id]", params: { id: e.event_id } })} style={s.row}>
                <View style={s.rail}><Text style={s.glyph}>{CATEGORY_GLYPH[e.category]}</Text>{i < plan.timeline.length - 1 ? <View style={[s.line, { backgroundColor: colors.border }]} /> : null}</View>
                <View style={{ flex: 1, paddingBottom: spacing.md, gap: 2 }}>
                  <Text style={s.meta}>{new Date(e.occurred_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · {CATEGORY_LABEL[e.category]}</Text>
                  <Text style={s.label}>{e.headline.replace(/^(Email|App|Device|Account|Network): /, "")}</Text>
                  <Body>{e.what_happened}</Body>
                  <View style={{ flexDirection: "row", gap: spacing.sm }}><Pill tone={e.state} label={STATE_NAME[e.state]} />{e.status !== "active" ? <Pill tone="resting" label="Handled" /> : null}</View>
                </View>
              </Pressable>
            ))}
          </View>

          <Card style={{ gap: spacing.xs }} testID="incident-plan">
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}><SectionTitle>Stay with me — one plan</SectionTitle><Text style={s.meta} testID="incident-progress">{doneCount}/{plan.steps.length}</Text></View>
            {plan.steps.map((st, i) => {
              const on = !!ticked[st.id];
              return (
                <Pressable key={st.id} testID={`incident-step-${i}`} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => toggle(st.id)} style={s.step}>
                  <View style={[s.box, { borderColor: on ? colors.resting : colors.borderStrong, backgroundColor: on ? colors.resting : "transparent" }]}>{on ? <Check size={16} color={colors.surface} /> : null}</View>
                  <Text style={[s.why, { flex: 1 }, on && s.done]}>{i + 1}. {st.text}</Text>
                </Pressable>
              );
            })}
            <Body>Tick steps as you go. Apollo doesn&apos;t know what was taken — only what was risky — so don&apos;t assume the worst, but do the steps.</Body>
          </Card>

          <Card style={{ gap: spacing.sm }} testID="incident-actions">
            <Button testID="incident-share-family" variant={shared ? "ghost" : "secondary"} label={sharing ? "Sharing…" : shared ? "Shared with family — update" : "Ask my family for help"} onPress={() => void shareWithFamily()} disabled={sharing} />
            {shared ? <Body testID="incident-shared-note">Your family can see this timeline and which steps you&apos;ve ticked — not your messages or links. They&apos;ll be nudged to call you.</Body> : <Body>Shares only the timeline headlines and the plan — never the message text or links.</Body>}
            <Button testID="incident-ask" variant="secondary" label="Ask Higgins about this incident" onPress={() => router.push({ pathname: "/(tabs)/ask", params: { context: `Incident: ${plan.headline}. Events in order: ${plan.timeline.map((e) => `${CATEGORY_LABEL[e.category]} — ${e.headline}`).join("; ")}. Exposure: ${plan.exposure.join(", ") || "none reported"}.`, prompt: "What should I do first, and what's the risk?" } })} />
            {!plan.allResolved ? <Button testID="incident-resolve" variant={doneCount === plan.steps.length ? "primary" : "ghost"} label="I've done the steps — mark incident handled" onPress={() => void resolveAll()} /> : null}
          </Card>
        </ScrollView>
      )}
    </View>
  );
}
