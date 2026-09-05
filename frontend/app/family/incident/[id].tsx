// Family Incident Sharing — guardian view. Read-only timeline + the family member's Stay With Me progress,
// with one-tap call. Shows only what they chose to share: headlines, states, steps and ticks.
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Check from "lucide-react-native/icons/check";
import Phone from "lucide-react-native/icons/phone";
import X from "lucide-react-native/icons/x";
import React from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiGet } from "@/src/api/client";
import { Body, Button, Card, Pill, SectionTitle, toneColor } from "@/src/components/ui";
import { CATEGORY_GLYPH, CATEGORY_LABEL } from "@/src/domain/incidentPlan";
import { type ApolloState, type EventCategory, STATE_NAME } from "@/src/domain/types";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

export interface SharedIncident { scent_id: string; from_label: string; headline: string; state: ApolloState; events: { event_id: string; category: EventCategory; state: ApolloState; headline: string; occurred_at: string; status: string }[]; steps: { id: string; text: string }[]; done: string[]; resolved: boolean; shared_at: string; updated_at: string; phone: string }

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
}));

export default function FamilyIncident() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ready, setupDone, deviceId } = useApollo();
  const q = useQuery({ queryKey: ["family-incident", id, deviceId], enabled: !!deviceId, refetchInterval: 15000, queryFn: () => apiGet<SharedIncident>(`/family/incidents/${id}?device_id=${deviceId}`) });
  const inc = q.data;
  if (ready && !setupDone) return <Redirect href="/" />;
  const doneCount = inc ? inc.steps.filter((st) => inc.done.includes(st.id)).length : 0;

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>{inc ? `${inc.from_label}'s incident` : "Shared incident"}</Text>
        <Pressable testID="family-incident-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} testID="family-incident-scroll">
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
          </>
        )}
      </ScrollView>
    </View>
  );
}
