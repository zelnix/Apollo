import { useRouter } from "expo-router";
import BatteryCharging from "lucide-react-native/icons/battery-charging";
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApolloHero } from "@/src/components/ApolloHero";
import { RootScreenHeader } from "@/src/components/RootScreenHeader";
import { HigginsFollowUp } from "@/src/components/HigginsFollowUp";
import { ClipboardLinkBanner } from "@/src/components/ClipboardLinkBanner";
import { PatrolItem } from "@/src/components/PatrolItem";
import { ServiceBanner } from "@/src/components/ServiceBanner";
import { CoverageCard } from "@/src/components/CoverageCard";
import { HomeScamAlerts } from "@/src/components/HomeScamAlerts";
import { Body, Button, Card, DevTag, Pill, SectionTitle, toneColor } from "@/src/components/ui";
import { buildScents } from "@/src/domain/threatScent";
import { buildHomeAttention, type AttentionItem } from "@/src/domain/homeAttention";
import { STATE_NAME } from "@/src/domain/types";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, spacing, useTheme } from "@/src/theme";
import { minimiseApp } from "@/src/utils/minimise";
import { useProtectionHealth } from "@/src/protection/healthStore";
import { projectPatrolOutcomes } from "@/src/domain/patrolOutcomes";

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  content: { paddingHorizontal: spacing.xl, gap: spacing.xl, paddingBottom: spacing["3xl"] },
  empty: { alignItems: "flex-start", gap: spacing.sm },
  emptyTitle: { fontFamily: fonts.display, fontSize: 16, color: c.onSurface },
  link: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.restingText, minHeight: 32 },
  cardIconWell: { width: 30, height: 30, borderRadius: 15, backgroundColor: c.navyTint, alignItems: "center", justifyContent: "center" },
  cardTitle: { fontFamily: fonts.displayBold, fontSize: 15, color: c.brand },
  // Compact single-line background indicator (replaces the bulky wrapping card).
  bgRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  bgText: { flex: 1, fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceSecondary },
  bgMinimise: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.brand, minHeight: 32, paddingVertical: 6 },
  // Needs-your-attention item.
  attnTitle: { fontFamily: fonts.displayBold, fontSize: 16, lineHeight: 21, color: c.onSurface },
  attnLabel: { fontFamily: fonts.textSemibold, color: c.onSurface },
  attnDismiss: { fontFamily: fonts.textSemibold, fontSize: 14, color: c.muted, minHeight: 44, paddingTop: spacing.xs },
  sectionGap: { gap: spacing.md },
}));

export default function Home() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { resolution, capabilities, protection, adapterLabel, isMock, refreshing, events, lowPower, quietNow, showToast, identityReset, reRegisterDevice } = useApollo();
  const health = useProtectionHealth();

  // Specific, real issues that need the person — computed once from live gate + event data.
  const attention = React.useMemo(
    () => (health.checking ? [] : buildHomeAttention({ gates: health.gates, events })),
    [health.checking, health.gates, events],
  );
  // Recent Patrol on Home is a glance of HISTORY — it must not echo the active issues already shown in
  // "Needs your attention". Exclude those event ids; the full archive lives on Patrol.
  const attentionEventIds = new Set(attention.filter((a) => a.kind === "event" && a.event).map((a) => a.event!.event_id));
  const recent = projectPatrolOutcomes(events).filter((o) => !attentionEventIds.has(o.event.event_id)).slice(0, 3);
  const scents = buildScents(events);

  return (
    <View style={s.root}>
      <View style={{ paddingTop: insets.top + spacing.md }}>
        <RootScreenHeader title="Home" testID="home-header" rightAccessory={isMock ? <DevTag label="Preview" testID="home-mock-pill" /> : null} />
      </View>
      <ScrollView contentContainerStyle={s.content} testID="home-scroll">
        {/* 1. Apollo's current status — small emblem, exact problem, Higgins' next step, action. */}
        <ApolloHero resolution={resolution} adapterLabel={adapterLabel} isMock={isMock} capabilities={capabilities} animate={!lowPower} quietNow={quietNow} sniffing={refreshing} attention={attention} />

        {identityReset ? (
          <Card style={{ gap: spacing.sm, borderColor: colors.barking }} testID="identity-reset-card">
            <Text style={s.cardTitle}>Apollo needs to re-register this phone</Text>
            <Body testID="identity-reset-why">{identityReset}</Body>
            <Body>Your on-phone Patrol history is untouched. Family pairings and shared incidents were tied to the old identity — after re-registering, pair with family again. Nothing is sent to Apollo&apos;s servers until you do.</Body>
            <Button testID="identity-reset-register" label="Register this phone again" onPress={() => void reRegisterDevice().catch((e: Error) => showToast(e.message, "barking"))} />
          </Card>
        ) : null}
        <ServiceBanner />
        <HigginsFollowUp />
        <ClipboardLinkBanner />

        {/* 2. Coverage at a glance — every gate verifiably Watching, shown once. */}
        <CoverageCard />

        {/* 2b. Latest official scam alerts — awareness only, separate from Gate coverage. */}
        <HomeScamAlerts />

        {/* 3. Needs your attention — only specific unresolved issues; hidden when empty. */}
        {attention.length > 0 ? (
          <View style={s.sectionGap}>
            <SectionTitle>Needs your attention</SectionTitle>
            {attention.map((item) => (
              <AttentionCard key={item.id} item={item} />
            ))}
          </View>
        ) : null}

        {/* Compact background-protection indicator. */}
        {protection?.operational ? (
          <View style={s.bgRow} testID="home-background-row">
            <BatteryCharging size={16} color={colors.resting} />
            <Text style={s.bgText} numberOfLines={1}>Apollo is protecting in the background.</Text>
            <Pressable testID="home-minimise" accessibilityRole="button" hitSlop={8} onPress={() => void minimiseApp(showToast)}>
              <Text style={s.bgMinimise}>Minimise</Text>
            </Pressable>
          </View>
        ) : null}

        {scents.length ? (
          <View>
            <SectionTitle>Connected events (Threat Scent)</SectionTitle>
            {scents.slice(0, 2).map((sc) => (
              <Pressable key={sc.scent_id} testID={`home-scent-${sc.scent_id}`} accessibilityRole="button" onPress={() => router.push({ pathname: "/patrol/scent/[id]", params: { id: sc.scent_id } })}>
                <Card style={{ gap: spacing.xs, borderColor: toneColor(colors, sc.state) }}>
                  <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center", flexWrap: "wrap" }}><Pill tone={sc.state} label={STATE_NAME[sc.state]} />{sc.brand ? <Pill tone="neutral" label={sc.brand} /> : null}<Pill tone="neutral" label={`${sc.events.length} events`} /></View>
                  <Body>{sc.summary}</Body>
                  <Body>Tap to see the timeline and one Stay With Me plan for the whole incident.</Body>
                </Card>
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* 4. Recent Patrol — two or three meaningful findings and See all. */}
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
      </ScrollView>
    </View>
  );
}

/** A single "needs your attention" item: names the affected gate, the specific problem, Higgins'
 *  recommendation and a direct action. Event items can also be dismissed. */
function AttentionCard({ item }: { item: AttentionItem }) {
  const s = useStyles();
  const router = useRouter();
  const { resolveEvent } = useApollo();
  return (
    <Card style={{ gap: spacing.xs }} testID={`home-attention-${item.id}`}>
      <Text style={s.attnTitle}>{item.title}</Text>
      <Body><Text style={s.attnLabel}>Problem: </Text>{item.problem}</Body>
      <Body><Text style={s.attnLabel}>Higgins: </Text>{item.higgins}</Body>
      <Button testID={`home-attention-${item.id}-action`} label={item.actionLabel} onPress={() => router.push(item.route as never)} />
      {item.kind === "event" && item.event ? (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={() => void resolveEvent(item.event!)} testID={`home-attention-${item.id}-dismiss`}>
          <Text style={s.attnDismiss}>Dismiss</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}
