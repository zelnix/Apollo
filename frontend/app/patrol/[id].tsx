import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import X from "lucide-react-native/icons/x";
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EventActions } from "@/src/components/EventActions";
import { Body, Card, Pill, toneColor } from "@/src/components/ui";
import { STATE_LABEL, STATE_MEANING } from "@/src/domain/types";
import { goBackOrHome } from "@/src/utils/navigation";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface, flex: 1, marginRight: spacing.md },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.lg },
  sub: { fontFamily: fonts.display, fontSize: 13, color: c.onSurfaceSecondary, letterSpacing: 1, textTransform: "uppercase" },
  big: { fontFamily: fonts.textMedium, fontSize: 16, lineHeight: 24, color: c.onSurface },
  bullet: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 8 },
  meta: { fontFamily: fonts.text, fontSize: 13, color: c.muted },
}));

export default function EventDetail() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { events, isMock, ready, setupDone } = useApollo();
  const event = events.find((e) => e.event_id === id);
  if (ready && !setupDone) return <Redirect href="/onboarding" />;

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title} numberOfLines={2} testID="event-title">{event?.headline ?? "Event"}</Text>
        <Pressable testID="event-close" accessibilityRole="button" accessibilityLabel="Close" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      {!event ? (
        <View style={s.content}><Body>This event is no longer available.</Body></View>
      ) : (
        <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} testID="event-scroll">
          <View style={{ flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" }}>
            <Pill tone={event.state} label={STATE_LABEL[event.state]} testID="event-state-pill" />
            {event.verified_block ? <Pill tone="biting" label="Block verified" testID="event-verified-pill" /> : null}
            {isMock ? <Pill tone="unknown" label={event.adapter_label} /> : null}
          </View>
          <Body>{STATE_MEANING[event.state]}</Body>

          <Card style={{ gap: spacing.sm }}>
            <Text style={s.sub}>What happened</Text>
            <Text style={s.big} testID="event-what-happened">{event.what_happened}</Text>
            {event.local_indicator ? <Text style={s.meta} selectable testID="event-indicator">{event.local_indicator}</Text> : event.indicator_host ? <Text style={s.meta}>{event.indicator_host}</Text> : null}
          </Card>

          <Card style={{ gap: spacing.sm }}>
            <Text style={s.sub}>Why Apollo reacted</Text>
            {event.why.length === 0 ? <Body>No specific warning signs.</Body> : event.why.map((w, i) => (
              <View key={i} style={s.bullet}><View style={[s.dot, { backgroundColor: toneColor(colors, event.state) }]} /><Body style={{ flex: 1 }}>{w}</Body></View>
            ))}
          </Card>

          <Card style={{ gap: spacing.sm, borderColor: toneColor(colors, event.state) }}>
            <Text style={s.sub}>What to do</Text>
            <Text style={s.big} testID="event-what-to-do">{event.what_to_do}</Text>
          </Card>

          <EventActions event={event} />

          <Text style={s.meta}>Occurred {new Date(event.occurred_at).toLocaleString()}{event.resolved_at ? ` · Resolved ${new Date(event.resolved_at).toLocaleString()}` : ""}</Text>
        </ScrollView>
      )}
    </View>
  );
}
