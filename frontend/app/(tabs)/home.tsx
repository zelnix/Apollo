import { useRouter } from "expo-router";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import GraduationCap from "lucide-react-native/icons/graduation-cap";
import Megaphone from "lucide-react-native/icons/megaphone";
import MessageSquare from "lucide-react-native/icons/message-square";
import Settings from "lucide-react-native/icons/settings";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PriorityScamNotice } from "@/src/components/PriorityScamNotice";
import { RecoveryBanner, useRecoveryTracker } from "@/src/components/RecoveryBanner";
import { RetrofitModal, hasRetrofitRun } from "@/src/components/RetrofitModal";
import { ServiceBanner } from "@/src/components/ServiceBanner";
import { HigginsFollowUp } from "@/src/components/HigginsFollowUp";
import { ClipboardLinkBanner } from "@/src/components/ClipboardLinkBanner";
import { Body, Button, Card, DevTag, Pill, toneColor } from "@/src/components/ui";
import { buildHomeAttention, buildSecurityFindings } from "@/src/domain/homeAttention";
import { buildHomeVoice } from "@/src/domain/higginsHomeVoice";
import { buildScents } from "@/src/domain/threatScent";
import { isConsumerPatrolEvent, projectPatrolOutcomes } from "@/src/domain/patrolOutcomes";
import { STATE_NAME, STATE_LABEL } from "@/src/domain/types";
import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { minimiseApp } from "@/src/utils/minimise";
import { useProtectionHealth } from "@/src/protection/healthStore";
import type { ApolloState } from "@/src/domain/types";

/** Apollo is an animated character — one state → one GIF.  Matches ApolloHero.tsx. */
const STATE_GIF: Partial<Record<ApolloState, { src: number; label: string }>> = {
  resting:  { src: require("@/assets/images/apollo-patrolling.gif"), label: "Apollo patrolling" },
  sniffing: { src: require("@/assets/images/apollo-sniffing.gif"),   label: "Apollo sniffing" },
  ears_up:  { src: require("@/assets/images/apollo-sniffing.gif"),   label: "Apollo has his ears up" },
  growling: { src: require("@/assets/images/apollo-growling.gif"),    label: "Apollo growling" },
  barking:  { src: require("@/assets/images/apollo-barking.gif"),     label: "Apollo barking" },
  biting:   { src: require("@/assets/images/apollo-barking.gif"),     label: "Apollo blocked a threat" },
};
const FALLBACK_IMAGE = require("@/assets/images/logo.png");
const HERO_BG_IMAGE = require("@/assets/images/hero-bg-patrolling.webp");

/** State-based hero card background landscapes */
const STATE_BG: Record<string, any> = {
  resting:  require("@/assets/images/hero-bg-patrolling.webp"),
  sniffing: require("@/assets/images/hero-bg-sniffing.webp"),
  ears_up:  require("@/assets/images/hero-bg-sniffing.webp"),
  growling: require("@/assets/images/hero-bg-growling.webp"),
  barking:  require("@/assets/images/hero-bg-barking.webp"),
  biting:   require("@/assets/images/hero-bg-biting.webp"),
};

const useStyles = makeStyles((c) => ({
  root: { flex: 1, backgroundColor: c.surface },
  scroll: { paddingBottom: spacing["3xl"] },

  // ── Branded header ──
  header: { paddingHorizontal: spacing.xl, paddingBottom: spacing.sm },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brandTitle: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface, letterSpacing: -0.3 },
  brandSubtitle: { fontFamily: fonts.text, fontSize: 13, color: c.onSurfaceSecondary, marginTop: 1 },
  settingsBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },

  // ── Hero status card ──
  heroCard: {
    marginHorizontal: spacing.xl, borderRadius: radius.lg, overflow: "hidden",
    minHeight: 160, backgroundColor: "#E8F5EE",
  },
  heroBgImage: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  heroOverlay: {
    padding: spacing.xl, gap: spacing.md, flexDirection: "row",
    alignItems: "flex-start",
  },
  heroInner: { flexDirection: "row", gap: spacing.lg, alignItems: "flex-start" },
  heroImageWrap: { width: 90, height: 90, borderRadius: 45, borderWidth: 2, borderColor: c.gold, overflow: "hidden", backgroundColor: c.surfaceSecondary },
  heroImage: { width: 90, height: 90 },
  heroContent: { flex: 1, gap: spacing.xs, paddingRight: 60 },
  heroStatusRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  heroShield: { marginRight: 2 },
  heroStatusText: { fontFamily: fonts.displayBold, fontSize: 17, color: "#1B6B47" },
  heroExplanation: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurface },

  // ── Two side-by-side cards ──
  twoCards: { flexDirection: "row", gap: spacing.md, paddingHorizontal: spacing.xl, marginTop: spacing.md },
  halfCard: {
    flex: 1, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm,
    borderWidth: 1,
  },
  halfCardIconWrap: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  halfCardTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  halfCardTitle: { fontFamily: fonts.displayBold, fontSize: 14, color: c.onSurface, flex: 1 },
  halfCardDesc: { fontFamily: fonts.text, fontSize: 12, lineHeight: 17, color: c.onSurfaceSecondary },
  halfCardBtn: {
    borderRadius: radius.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    alignItems: "center", justifyContent: "center", marginTop: spacing.xs,
  },
  halfCardBtnText: { fontFamily: fonts.textSemibold, fontSize: 12 },

  // ── Section headers ──
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.xl, marginTop: spacing.md, marginBottom: spacing.sm },
  sectionTitle: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface },
  sectionLink: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.brand },

  // ── Priority alert card ──
  alertCard: {
    marginHorizontal: spacing.xl, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm,
    backgroundColor: "rgba(217,83,79,0.06)", borderWidth: 1, borderColor: "rgba(217,83,79,0.18)",
  },
  alertTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  alertIconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(217,83,79,0.14)", alignItems: "center", justifyContent: "center" },
  alertBadge: { backgroundColor: "rgba(217,83,79,0.14)", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  alertBadgeText: { fontFamily: fonts.textSemibold, fontSize: 10, color: c.barking, letterSpacing: 0.5, textTransform: "uppercase" },
  alertTime: { fontFamily: fonts.text, fontSize: 11, color: c.onSurfaceSecondary, marginLeft: "auto" },
  alertTitle: { fontFamily: fonts.displayBold, fontSize: 15, color: c.onSurface },
  alertDesc: { fontFamily: fonts.text, fontSize: 13, lineHeight: 19, color: c.onSurfaceSecondary },
  alertBtn: {
    borderRadius: radius.sm, borderWidth: 1, borderColor: c.barking,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.lg,
    alignItems: "center", alignSelf: "flex-start", marginTop: spacing.xs,
  },
  alertBtnText: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.barking },

  // ── Activity row ──
  activityCard: {
    marginHorizontal: spacing.xl, borderRadius: radius.lg, padding: spacing.lg,
    backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border,
    flexDirection: "row", alignItems: "center", gap: spacing.md,
  },
  activityIconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: c.surfaceTertiary, alignItems: "center", justifyContent: "center" },
  activityContent: { flex: 1, gap: 2 },
  activityText: { fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurface },
  activitySub: { fontFamily: fonts.text, fontSize: 12, color: c.onSurfaceSecondary },
  activityTime: { fontFamily: fonts.text, fontSize: 11, color: c.onSurfaceSecondary },
  findingLink: { fontFamily: fonts.textSemibold, fontSize: 12, color: c.brand },
}));


export default function Home() {
  const s = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { resolution, capabilities, protection, adapterLabel, isMock, refreshing, events, lowPower, quietNow, showToast, identityReset, reRegisterDevice } = useApollo();
  const health = useProtectionHealth();
  const { recovery, dismiss: dismissRecovery } = useRecoveryTracker(protection?.operational);

  // ── Auto-retrofit on first load ──
  const [showRetrofit, setShowRetrofit] = React.useState(false);
  React.useEffect(() => {
    hasRetrofitRun().then((done) => {
      if (!done) setShowRetrofit(true);
    });
  }, []);

  const attention = React.useMemo(
    () => (health.checking ? [] : buildHomeAttention({ gates: health.gates, events })),
    [health.checking, health.gates, events],
  );

  const voice = React.useMemo(
    () => buildHomeVoice({ resolution, attention, gates: health.gates, capabilities }),
    [resolution, attention, health.gates, capabilities],
  );

  const securityFindings = React.useMemo(() => buildSecurityFindings({ gates: health.gates, events }), [health.gates, events]);
  const scents = buildScents(events);

  // Most recent consumer event for the "Recent activity" section
  const recentEvent = React.useMemo(() => {
    const consumer = events.filter(isConsumerPatrolEvent);
    return consumer.length > 0 ? consumer[0] : null;
  }, [events]);

  const state = resolution.state;
  const stateLabel = STATE_LABEL[state] ?? "Apollo is Patrolling";
  const statusColor = toneColor(colors, state);
  const gif = STATE_GIF[state];
  const heroBg = STATE_BG[state] ?? STATE_BG.resting;

  return (
    <View style={s.root}>
      {/* ── Branded Header ── */}
      <View style={[s.header, { paddingTop: insets.top + spacing.md }]}>
        <View style={s.headerRow}>
          <View>
            <Text style={s.brandTitle} testID="home-brand-title">Apollo Scam Guard</Text>
            <Text style={s.brandSubtitle}>Safer People. Safer Tomorrows.</Text>
          </View>
          {isMock ? <DevTag label="Preview" testID="home-mock-pill" /> : null}
          <Pressable testID="home-settings" accessibilityRole="button" accessibilityLabel="Settings" onPress={() => router.push("/settings")} style={s.settingsBtn}>
            <Settings size={20} color={colors.onSurfaceSecondary} />
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={s.scroll} testID="home-scroll" showsVerticalScrollIndicator={false}>
        {/* ── Hero Status Card ── */}
        <Pressable
          testID="home-hero-card"
          accessibilityRole="button"
          accessibilityLabel={stateLabel}
          onPress={() => voice.ctaRoute ? router.push(voice.ctaRoute as any) : null}
          style={s.heroCard}
        >
          <Image
            source={heroBg}
            style={s.heroBgImage}
            contentFit="cover"
            testID="home-hero-bg"
          />
          <View style={s.heroOverlay}>
            <View style={s.heroImageWrap}>
              <Image
                source={gif ? gif.src : FALLBACK_IMAGE}
                style={s.heroImage}
                contentFit="cover"
                autoplay
                accessibilityLabel={gif?.label ?? "Apollo"}
                testID="home-hero-gif"
              />
            </View>
            <View style={s.heroContent}>
              <View style={s.heroStatusRow}>
                <ShieldCheck size={16} color="#FFFFFF" fill={statusColor} style={s.heroShield} />
                <Text style={[s.heroStatusText, { color: colors[`${state}Text` as keyof typeof colors] as string || colors.restingText }]}>{stateLabel}</Text>
              </View>
              <Text style={s.heroExplanation} numberOfLines={5}>{voice.text}</Text>
            </View>
          </View>
        </Pressable>

        {/* Recovery banner */}
        <View style={{ paddingHorizontal: spacing.xl, marginTop: spacing.sm }}>
          <RecoveryBanner recovery={recovery} onDismiss={dismissRecovery} testID="home-recovery-banner" />
        </View>

        {/* ── Two Side-by-Side Cards ── */}
        <View style={s.twoCards}>
          {/* Protection Status Card */}
          <Pressable
            testID="home-protection-card"
            accessibilityRole="button"
            accessibilityLabel="Protection Status"
            onPress={() => router.push("/(tabs)/protection")}
            style={({ pressed }) => [s.halfCard, { backgroundColor: "rgba(22,34,53,0.04)", borderColor: "rgba(22,34,53,0.12)", opacity: pressed ? 0.85 : 1 }]}
          >
            <View style={s.halfCardTitleRow}>
              <View style={[s.halfCardIconWrap, { backgroundColor: "rgba(22,34,53,0.10)" }]}>
                <ShieldCheck size={16} color={colors.brand} />
              </View>
              <Text style={s.halfCardTitle}>Protection Status</Text>
            </View>
            <Text style={s.halfCardDesc} numberOfLines={3}>See what Apollo is protecting. Gate health, limitations and action needed.</Text>
            <View style={[s.halfCardBtn, { backgroundColor: colors.brand }]}>
              <Text style={[s.halfCardBtnText, { color: colors.onBrand }]}>View Protection</Text>
            </View>
          </Pressable>

          {/* Learn with Higgins Card */}
          <Pressable
            testID="home-learn-card"
            accessibilityRole="button"
            accessibilityLabel="Learn with Higgins"
            onPress={() => router.push("/higgins/learning")}
            style={({ pressed }) => [s.halfCard, { backgroundColor: "rgba(201,163,74,0.06)", borderColor: "rgba(201,163,74,0.20)", opacity: pressed ? 0.85 : 1 }]}
          >
            <View style={s.halfCardTitleRow}>
              <View style={[s.halfCardIconWrap, { backgroundColor: colors.goldTint }]}>
                <GraduationCap size={16} color={colors.gold} />
              </View>
              <Text style={s.halfCardTitle}>Learn with Higgins</Text>
            </View>
            <Text style={s.halfCardDesc} numberOfLines={3}>Friendly, practical lessons about scams, cyber security and staying safer online.</Text>
            <View style={[s.halfCardBtn, { backgroundColor: colors.gold }]}>
              <Text style={[s.halfCardBtnText, { color: "#FFFFFF" }]}>Start Learning</Text>
            </View>
          </Pressable>
        </View>

        {/* ── Important For You ── */}
        {(securityFindings.length > 0 || true) ? (
          <View>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>Important for you</Text>
              <Pressable onPress={() => router.push("/(tabs)/patrol")} hitSlop={8}>
                <Text style={s.sectionLink}>View all</Text>
              </Pressable>
            </View>
            {/* Priority Scam Alert — compact summary with link */}
            <PriorityScamNotice compact />
            {securityFindings.slice(0, 2).map((finding) => (
              <Pressable key={finding.id} testID={`home-finding-${finding.id}`} onPress={() => router.push(finding.route as any)} style={[s.activityCard, { marginBottom: spacing.sm }]}>
                <View style={[s.activityIconWrap, { backgroundColor: colors.barkingTint }]}>
                  <MessageSquare size={16} color={colors.barking} />
                </View>
                <View style={s.activityContent}>
                  <Text style={s.activityText}>{finding.title}</Text>
                </View>
                <Text style={s.findingLink}>View details</Text>
                <ChevronRight size={14} color={colors.brand} />
              </Pressable>
            ))}
          </View>
        ) : null}

        {/* ── Recent Activity ── */}
        <View>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Recent activity</Text>
            <Pressable onPress={() => router.push("/(tabs)/patrol")} hitSlop={8}>
              <Text style={s.sectionLink}>View all</Text>
            </Pressable>
          </View>
          {recentEvent ? (
            <Pressable
              testID="home-recent-activity"
              accessibilityRole="button"
              onPress={() => router.push(`/patrol/${encodeURIComponent(recentEvent.event_id)}` as any)}
              style={s.activityCard}
            >
              <View style={s.activityIconWrap}>
                <MessageSquare size={16} color={colors.onSurfaceSecondary} />
              </View>
              <View style={s.activityContent}>
                <Text style={s.activityText} numberOfLines={1}>{recentEvent.headline || "Apollo recorded activity"}</Text>
                <Text style={s.activitySub} numberOfLines={1}>{recentEvent.what_happened || "Tap to see details."}</Text>
              </View>
              <Text style={s.activityTime}>{timeAgo(recentEvent.occurred_at)}</Text>
              <ChevronRight size={16} color={colors.onSurfaceSecondary} />
            </Pressable>
          ) : (
            <View style={s.activityCard} testID="home-no-recent-activity">
              <View style={s.activityIconWrap}>
                <ShieldCheck size={16} color={colors.resting} />
              </View>
              <View style={s.activityContent}>
                <Text style={s.activityText}>No recent activity</Text>
                <Text style={s.activitySub}>Apollo is patrolling quietly. Nothing to report.</Text>
              </View>
            </View>
          )}
        </View>

        {/* ── Utility banners (compact) ── */}
        <View style={{ paddingHorizontal: spacing.xl, gap: spacing.sm, marginTop: spacing.md }}>
          {identityReset ? (
            <Card style={{ gap: spacing.sm, borderColor: colors.barking }} testID="identity-reset-card">
              <Text style={{ fontFamily: fonts.displayBold, fontSize: 15, color: colors.brand }}>Apollo needs to re-register this phone</Text>
              <Body testID="identity-reset-why">{identityReset}</Body>
              <Button testID="identity-reset-register" label="Register this phone again" onPress={() => void reRegisterDevice().catch((e: Error) => showToast(e.message, "barking"))} />
            </Card>
          ) : null}
          <ServiceBanner />
          <HigginsFollowUp />
          <ClipboardLinkBanner />
        </View>

        {/* Threat Scent clusters */}
        {scents.length ? (
          <View style={{ paddingHorizontal: spacing.xl, marginTop: spacing.md }}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>Connected events</Text>
            </View>
            {scents.slice(0, 2).map((sc) => (
              <Pressable key={sc.scent_id} testID={`home-scent-${sc.scent_id}`} accessibilityRole="button" onPress={() => router.push({ pathname: "/patrol/scent/[id]", params: { id: sc.scent_id } })}>
                <Card style={{ gap: spacing.xs, borderColor: toneColor(colors, sc.state), marginBottom: spacing.sm }}>
                  <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center", flexWrap: "wrap" }}>
                    <Pill tone={sc.state} label={STATE_NAME[sc.state]} />
                    {sc.brand ? <Pill tone="neutral" label={sc.brand} /> : null}
                    <Pill tone="neutral" label={`${sc.events.length} events`} />
                  </View>
                  <Body>{sc.summary}</Body>
                </Card>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
      <RetrofitModal visible={showRetrofit} onClose={() => setShowRetrofit(false)} auto />
    </View>
  );
}

/** Simple relative time label */
function timeAgo(iso: string): string {
  const diff = Date.now() - Date.parse(iso);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}
