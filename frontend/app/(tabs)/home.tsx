import { useRouter } from "expo-router";
import Link2 from "lucide-react-native/icons/link-2";
import RefreshCw from "lucide-react-native/icons/refresh-cw";
import React from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApolloHero } from "@/src/components/ApolloHero";
import { PatrolItem } from "@/src/components/PatrolItem";
import { Body, Button, Card, Pill, ScreenHeader, SectionTitle, capabilityTone } from "@/src/components/ui";
import { CAPABILITY_STATUS_LABEL, visibilityFrom } from "@/src/domain/capability";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: spacing.xl, gap: spacing.xl, paddingBottom: spacing.xl },
  actions: { flexDirection: "row", gap: spacing.md },
  capRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: spacing.sm, gap: spacing.md },
  capTitle: { fontFamily: fonts.textMedium, fontSize: 15, color: c.onSurface, flex: 1 },
  empty: { alignItems: "flex-start", gap: spacing.sm },
  emptyTitle: { fontFamily: fonts.display, fontSize: 16, color: c.onSurface },
  link: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.resting },
}));

export default function Home() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { resolution, capabilities, protection, adapterLabel, isMock, refreshing, verifyNow, events, lastVerifiedAt } = useApollo();
  const visibility = visibilityFrom(capabilities, !!protection?.running);
  const recent = events.slice(0, 4);

  return (
    <View style={s.root}>
      <View style={{ paddingTop: insets.top + spacing.md }}>
        <ScreenHeader title="Apollo" testID="home-header" right={isMock ? <Pill tone="unknown" label="Mock" testID="home-mock-pill" /> : null} />
      </View>
      <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={verifyNow} tintColor={colors.resting} />} testID="home-scroll">
        <ApolloHero resolution={resolution} visibility={visibility} adapterLabel={adapterLabel} isMock={isMock} />

        <View style={s.actions}>
          <Button testID="home-check-link-button" label="Check a link" onPress={() => router.push("/check")} icon={<Link2 size={18} color={colors.onBrandPrimary} />} style={{ flex: 1 }} />
          <Button testID="home-verify-button" label="Verify now" variant="secondary" onPress={verifyNow} icon={<RefreshCw size={18} color={colors.onSurface} />} style={{ flex: 1 }} />
        </View>
        {lastVerifiedAt ? <Body style={{ marginTop: -spacing.md }} >Last verified {new Date(lastVerifiedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</Body> : null}

        <View>
          <SectionTitle>What Apollo can see</SectionTitle>
          <Card testID="home-capabilities">
            {capabilities.map((cap) => (
              <View key={cap.id} style={s.capRow} testID={`home-cap-${cap.id}`}>
                <Text style={s.capTitle}>{cap.title}</Text>
                <Pill tone={capabilityTone(cap.status)} label={CAPABILITY_STATUS_LABEL[cap.status]} />
              </View>
            ))}
            <Text style={s.link} onPress={() => router.push("/(tabs)/guard")} testID="home-open-guard">Manage in Guard</Text>
          </Card>
        </View>

        <View>
          <SectionTitle>Recent patrol</SectionTitle>
          {recent.length === 0 ? (
            <Card style={s.empty} testID="home-patrol-empty">
              <Text style={s.emptyTitle}>No events yet</Text>
              <Body>Apollo is watching within its supported checks. Try checking a link to see how Apollo reacts.</Body>
            </Card>
          ) : (
            <View>
              {recent.map((e, i) => <PatrolItem key={e.event_id} event={e} isLast={i === recent.length - 1} />)}
              <Text style={s.link} onPress={() => router.push("/(tabs)/patrol")} testID="home-open-patrol">See full patrol</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
