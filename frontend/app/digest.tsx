import { useRouter } from "expo-router";
import X from "lucide-react-native/icons/x";
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Body, Card, Pill, SectionTitle } from "@/src/components/ui";
import { buildWeeklyDigest } from "@/src/domain/digest";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { goBackOrHome } from "@/src/utils/navigation";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  top: { paddingHorizontal: spacing.xl, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingBottom: spacing.md },
  title: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface },
  close: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill, backgroundColor: c.surfaceTertiary },
  content: { paddingHorizontal: spacing.xl, gap: spacing.xl },
  headline: { fontFamily: fonts.displayBold, fontSize: 24, color: c.onSurface },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  stat: { width: "47%", backgroundColor: c.surfaceTertiary, borderRadius: radius.md, padding: spacing.lg, gap: 2 },
  statValue: { fontFamily: fonts.displayBold, fontSize: 26, color: c.onSurface },
  statLabel: { fontFamily: fonts.text, fontSize: 12, color: c.onSurfaceSecondary },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: c.divider },
  host: { fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurface },
}));

export default function Digest() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { events } = useApollo();
  const d = buildWeeklyDigest(events);
  const range = `${new Date(d.from).toLocaleDateString([], { day: "numeric", month: "short" })} – ${new Date(d.to).toLocaleDateString([], { day: "numeric", month: "short" })}`;

  return (
    <View style={s.root}>
      <View style={[s.top, { paddingTop: insets.top + spacing.md }]}>
        <Text style={s.title}>Weekly patrol</Text>
        <Pressable testID="digest-close" accessibilityRole="button" onPress={() => goBackOrHome(router)} style={s.close}><X size={20} color={colors.onSurface} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.xl }]} testID="digest-scroll">
        <Card style={{ gap: spacing.sm }}>
          <Pill tone={d.blocked ? "biting" : d.warned ? "growling" : "resting"} label={range} />
          <Text style={s.headline} testID="digest-headline">{d.headline}</Text>
          <Body testID="digest-summary">{d.summary}</Body>
        </Card>
        <View style={s.grid}>
          {[["Links checked", d.checked, colors.onSurface], ["Looked fine", d.letThrough, colors.resting], ["Needed care", d.warned, colors.growling], ["Blocked (verified)", d.blocked, colors.biting], ["Wi‑Fi warnings", d.connection, colors.growling], ["Quiet days", d.quietDays, colors.resting]].map(([label, value, color]) => (
            <View key={String(label)} style={s.stat} testID={`digest-stat-${String(label).toLowerCase().replace(/[^a-z]+/g, "-")}`}>
              <Text style={[s.statValue, { color: color as string }]}>{value as number}</Text>
              <Text style={s.statLabel}>{label as string}</Text>
            </View>
          ))}
        </View>
        <View>
          <SectionTitle>Websites Apollo reacted to</SectionTitle>
          <Card>
            {d.topHosts.length === 0 ? <Body>None this week.</Body> : d.topHosts.map((h) => (
              <View key={h.host} style={s.row}><Text style={s.host}>{h.host}</Text><Body>{h.count}×</Body></View>
            ))}
          </Card>
        </View>
        <Body>Apollo only counts what it could see: links you checked or shared, and Wi‑Fi facts your phone reports. It never scans your messages or browsing.</Body>
      </ScrollView>
    </View>
  );
}
