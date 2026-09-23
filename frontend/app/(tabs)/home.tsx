import { useRouter } from "expo-router";
import BatteryCharging from "lucide-react-native/icons/battery-charging";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import Sparkles from "lucide-react-native/icons/sparkles";
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApolloHero } from "@/src/components/ApolloHero";
import { RootScreenHeader } from "@/src/components/RootScreenHeader";
import { HigginsFollowUp } from "@/src/components/HigginsFollowUp";
import { HigginsGreeting } from "@/src/components/HigginsGreeting";
import { ClipboardLinkBanner } from "@/src/components/ClipboardLinkBanner";
import { PatrolItem } from "@/src/components/PatrolItem";
import { ServiceBanner } from "@/src/components/ServiceBanner";
import { Body, Button, Card, DevTag, Pill, SectionTitle, toneColor } from "@/src/components/ui";
import { buildScents } from "@/src/domain/threatScent";
import { STATE_NAME } from "@/src/domain/types";
import { buildWeeklyDigest } from "@/src/domain/digest";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";
import { minimiseApp } from "@/src/utils/minimise";
import { useProtectionHealth } from "@/src/protection/healthStore";
import { projectPatrolOutcomes } from "@/src/domain/patrolOutcomes";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: spacing.xl, gap: spacing.xl, paddingBottom: spacing.xl },
  empty: { alignItems: "flex-start", gap: spacing.sm },
  emptyTitle: { fontFamily: fonts.display, fontSize: 16, color: c.onSurface },
  link: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.restingText },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardIconWell: { width: 30, height: 30, borderRadius: 15, backgroundColor: c.navyTint, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontFamily: fonts.displayBold, fontSize: 15, color: c.brand },
  cardLinkRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2, minHeight: 32 },
}));

export default function Home() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { resolution, capabilities, protection, adapterLabel, isMock, refreshing, events, lowPower, quietNow, showToast, identityReset, reRegisterDevice } = useApollo();
  const health = useProtectionHealth();
  // Recent Patrol on Home is a glance, not the archive — at most 2-3 items; the full history lives on Patrol.
  const recent = projectPatrolOutcomes(events).slice(0, 3);
  const digest = buildWeeklyDigest(events);
  const scents = buildScents(events);
  const activeCount = health.gates.filter((gate) => gate.capability.automatic?.state === "running").length;
  const attentionCount = health.gates.filter((gate) => gate.tone === "attention").length;

  return (
    <View style={s.root}>
      <View style={{ paddingTop: insets.top + spacing.md }}>
        <RootScreenHeader title="Home" testID="home-header" rightAccessory={isMock ? <DevTag label="Preview" testID="home-mock-pill" /> : null} />
      </View>
      <ScrollView contentContainerStyle={s.content} testID="home-scroll">
        <ApolloHero resolution={resolution} adapterLabel={adapterLabel} isMock={isMock} capabilities={capabilities} animate={!lowPower} quietNow={quietNow} sniffing={refreshing} />
        {identityReset ? (
          <Card style={{ gap: spacing.sm, borderColor: colors.barking }} testID="identity-reset-card">
            <Text style={s.cardTitle}>Apollo needs to re-register this phone</Text>
            <Body testID="identity-reset-why">{identityReset}</Body>
            <Body>Your on-phone Patrol history is untouched. Family pairings and shared incidents were tied to the old identity — after re-registering, pair with family again. Nothing is sent to Apollo&apos;s servers until you do.</Body>
            <Button testID="identity-reset-register" label="Register this phone again" onPress={() => void reRegisterDevice().catch((e: Error) => showToast(e.message, "barking"))} />
          </Card>
        ) : null}
        <ServiceBanner />
        <HigginsGreeting state={resolution.state} />
        <HigginsFollowUp />
        <ClipboardLinkBanner />
        {protection?.operational ? (
          <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }} testID="home-background-card">
            <BatteryCharging size={20} color={colors.resting} />
            <View style={{ flex: 1 }}><Body>Guarding in the background — minimise to save battery.</Body></View>
            <Button testID="home-minimise" variant="ghost" label="Minimise" onPress={() => void minimiseApp(showToast)} />
          </Card>
        ) : null}

        <View style={{ gap: spacing.md }}>
          <Card style={{ gap: 4 }} testID="home-protection-summary">
            <View style={s.cardTitleRow}>
              <View style={s.cardIconWell}><ShieldCheck size={16} color={colors.brand} /></View>
              <Text style={s.cardTitle}>Protection</Text>
            </View>
            <Body testID="home-protection-status">{health.checking ? "Checking current device status…" : `${activeCount} ${activeCount === 1 ? "Gate is" : "Gates are"} helping automatically${attentionCount ? ` · ${attentionCount} ${attentionCount === 1 ? "needs" : "need"} your attention` : ""}`}</Body>
            <Pressable testID="home-open-guard" accessibilityRole="button" onPress={() => router.push("/(tabs)/guard")} style={s.cardLinkRow}>
              <Text style={s.link}>{attentionCount ? "Review what needs attention" : "View protection"}</Text>
              <ChevronRight size={14} color={colors.restingText} />
            </Pressable>
          </Card>
        </View>

        {scents.length ? (
          <View>
            <SectionTitle>Connected events (Threat Scent)</SectionTitle>
            {scents.slice(0, 2).map((sc) => (
              <Pressable key={sc.scent_id} testID={`home-scent-${sc.scent_id}`} accessibilityRole="button" onPress={() => router.push({ pathname: "/patrol/scent/[id]", params: { id: sc.scent_id } })}>
                <Card style={{ gap: spacing.xs, borderColor: toneColor(colors, sc.state) }}>
                  <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}><Pill tone={sc.state} label={STATE_NAME[sc.state]} />{sc.brand ? <Pill tone="neutral" label={sc.brand} /> : null}<Pill tone="neutral" label={`${sc.events.length} events`} /></View>
                  <Body>{sc.summary}</Body>
                  <Body>Tap to see the timeline and one Stay With Me plan for the whole incident.</Body>
                </Card>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View>
          <SectionTitle>Recent patrol</SectionTitle>
          {recent.length === 0 ? (
            <Card style={s.empty} testID="home-patrol-empty">
              <Text style={s.emptyTitle}>All quiet</Text>
              <Body>Apollo is patrolling within the checks he can see.</Body>
            </Card>
          ) : (
            <View>
              {recent.map((outcome, i) => <PatrolItem key={outcome.outcomeId} outcome={outcome} isLast={i === recent.length - 1} />)}
              <Text style={s.link} onPress={() => router.push("/(tabs)/patrol")} testID="home-open-patrol">See all</Text>
            </View>
          )}
        </View>

        <View>
          <SectionTitle>This week</SectionTitle>
          <Pressable testID="home-digest-card" accessibilityRole="button" onPress={() => router.push("/digest")}>
            <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.md }}>
              <View style={s.cardIconWell}><Sparkles size={16} color={colors.brand} /></View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.cardTitle} numberOfLines={1}>{digest.headline}</Text>
                <Body numberOfLines={2}>{digest.summary}</Body>
              </View>
              <ChevronRight size={18} color={colors.onSurfaceSecondary} />
            </Card>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}
