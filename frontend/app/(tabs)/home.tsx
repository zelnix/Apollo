import { useFocusEffect, useRouter } from "expo-router";
import Camera from "lucide-react-native/icons/camera";
import ChevronRight from "lucide-react-native/icons/chevron-right";
import FileText from "lucide-react-native/icons/file-text";
import Globe from "lucide-react-native/icons/globe";
import Mail from "lucide-react-native/icons/mail";
import MessageSquare from "lucide-react-native/icons/message-square";
import Phone from "lucide-react-native/icons/phone";
import Shield from "lucide-react-native/icons/shield";
import ShieldCheck from "lucide-react-native/icons/shield-check";
import Smartphone from "lucide-react-native/icons/smartphone";
import React from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PriorityScamNotice } from "@/src/components/PriorityScamNotice";
import { AlertsButton } from "@/src/components/AlertsButton";
import { AppMenuButton } from "@/src/components/AppMenu";
import { RecoveryBanner, useRecoveryTracker } from "@/src/components/RecoveryBanner";
import { RetrofitModal, hasRetrofitRun } from "@/src/components/RetrofitModal";
import { ServiceBanner } from "@/src/components/ServiceBanner";
import { HigginsFollowUp } from "@/src/components/HigginsFollowUp";
import { ClipboardLinkBanner } from "@/src/components/ClipboardLinkBanner";
import { Body, Button, Card, DevTag, toneColor } from "@/src/components/ui";
import { buildHomeAttention } from "@/src/domain/homeAttention";
import { plainTriageText } from "@/src/domain/triage/contract";
import { groupApolloProtections, summariseApolloProtections } from "@/src/domain/apolloProtections";
import { buildHeroLines, buildHomeVoice } from "@/src/domain/higginsHomeVoice";
import { isConsumerPatrolEvent } from "@/src/domain/patrolOutcomes";
import { STATE_LABEL } from "@/src/domain/types";
import type { ApolloState, PatrolEvent, SourceMetadata } from "@/src/domain/types";
import {
  threatCaseStatus,
  STATUS_LABELS,
  STATUS_COLORS,
  formatDateTime,
} from "@/src/domain/threatCase";
import { looksLikeInternalCode } from "@/src/domain/messageVoice";
import { ProtectionChangeBanner } from "@/src/components/device/ProtectionChangeBanner";
import { getBaseline } from "@/src/store/firstCheckStore";
import { useApollo } from "@/src/store/ApolloContext";
import { useDeviceProtections } from "@/src/store/deviceProtectionStore";
import { fonts, makeStyles, radius, spacing, useTheme, type ThemeColors } from "@/src/theme";
import { useProtectionHealth } from "@/src/protection/healthStore";
import { displayHost } from "@/src/domain/urlPresentation";

/** Short chip for the Home protection cards. Counts only what a real read said. */
type CardOverall = "action" | "review" | "check" | "protected" | "unread" | "checking";
const CARD_CHIP: Record<CardOverall, string> = {
  action: "Needs attention", review: "Review", check: "To check", protected: "Protected", unread: "Not checked", checking: "Checking",
};
function chipColors(overall: CardOverall, c: ThemeColors) {
  switch (overall) {
    case "action": return { dot: c.biting, bg: c.bitingTint, text: c.bitingText };
    case "review": return { dot: c.growling, bg: c.growlingTint, text: c.growlingText };
    case "check": return { dot: c.gold, bg: c.goldTint, text: c.onSurface };
    case "protected": return { dot: c.resting, bg: c.restingTint, text: c.restingText };
    default: return { dot: c.muted, bg: c.unknownTint, text: c.unknownText };
  }
}

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

// ── Priority threat helpers ──────────────────────────────────────────────────
// "Important for you" is a priority subset of Threats, not an independent store.

function threatSourceIcon(cat: string, meta?: SourceMetadata | null) {
  const t = meta?.type ?? cat;
  switch (t) {
    case "email": return { Icon: Mail, bg: "rgba(220,38,38,0.1)", fg: "#DC2626" };
    case "text": case "message": return { Icon: MessageSquare, bg: "rgba(16,185,129,0.1)", fg: "#10B981" };
    case "screenshot": return { Icon: Camera, bg: "rgba(139,92,246,0.1)", fg: "#8B5CF6" };
    case "link": case "website": return { Icon: Globe, bg: "rgba(220,38,38,0.1)", fg: "#DC2626" };
    case "call": return { Icon: Phone, bg: "rgba(217,119,6,0.1)", fg: "#D97706" };
    case "file": return { Icon: FileText, bg: "rgba(220,38,38,0.1)", fg: "#DC2626" };
    case "app": return { Icon: Smartphone, bg: "rgba(16,185,129,0.1)", fg: "#065F46" };
    default: return { Icon: Shield, bg: "rgba(107,114,128,0.1)", fg: "#374151" };
  }
}

function threatTitle(e: PatrolEvent): string {
  const meta = e.source_metadata;
  if (meta?.subject) return meta.subject;
  if (e.headline && !looksLikeInternalCode(e.headline)) return e.headline;
  if (meta?.preview) return meta.preview.length > 50 ? meta.preview.slice(0, 50) + "…" : meta.preview;
  if (e.indicator_host) return e.indicator_host;
  return "Recorded finding";
}

function threatIdentity(e: PatrolEvent): string {
  const meta = e.source_metadata;
  if (meta?.sender) return `From: ${meta.sender}`;
  if (e.indicator_host) return e.indicator_host;
  if (meta?.url) return displayHost(meta.url); // never the raw address: its query can be thousands of characters
  if (e.claimed_brand) return e.claimed_brand;
  return "";
}

/** Build deduplicated priority threats from real PatrolEvent data. */
function buildPriorityThreats(events: PatrolEvent[]): PatrolEvent[] {
  const active = events
    .filter((e) => !e.resolved_at && (e.state === "barking" || e.state === "growling" || e.state === "ears_up" || e.state === "biting"))
    .sort((a, b) => {
      const rank = (s: string) => (s === "biting" ? 4 : s === "barking" ? 3 : s === "growling" ? 2 : 1);
      const r = rank(b.state) - rank(a.state);
      return r !== 0 ? r : Date.parse(b.occurred_at) - Date.parse(a.occurred_at);
    });
  // Deduplicate by logical issue key
  const seen = new Set<string>();
  const deduped: PatrolEvent[] = [];
  for (const e of active) {
    const key = e.patrol_record?.logicalIssueKey ?? e.event_id;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(e);
  }
  return deduped.slice(0, 3);
}

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
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  brandLogo: { height: 36, aspectRatio: 1789 / 537 },
  brandSubtitle: { fontFamily: fonts.text, fontSize: 11, color: c.onSurfaceSecondary, marginTop: 1, letterSpacing: 0.3 },

  // ── Hero status card ──
  heroCard: {
    marginHorizontal: spacing.lg, borderRadius: radius.lg, overflow: "hidden",
    minHeight: 140, backgroundColor: "#E8F5EE",
  },
  // The 3:1 artwork band, pinned to the bottom so it scales with the card's width on any device.
  heroBgBand: { position: "absolute", left: 0, right: 0, bottom: 0 },
  heroBgImage: { width: "100%", aspectRatio: 2000 / 667 },
  heroBandFade: { position: "absolute", top: 0, left: 0, right: 0, height: "55%" },
  heroGradient: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  heroOverlay: {
    padding: spacing.lg, gap: spacing.md, flexDirection: "column",
    alignItems: "stretch",
  },
  heroTopRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  heroDotsRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.xs, minHeight: 24 },
  heroDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "rgba(22,34,53,0.25)" },
  heroDotActive: { backgroundColor: c.brand, width: 18 },
  heroDotsLabel: { fontFamily: fonts.text, fontSize: 11, color: c.onSurfaceSecondary, marginLeft: spacing.xs },
  checkedRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceSecondary },
  checkedText: { flex: 1, fontFamily: fonts.textMedium, fontSize: 13, color: c.onSurfaceSecondary },
  checkedAction: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.brandPrimary },
  heroInner: { flexDirection: "row", gap: spacing.lg, alignItems: "flex-start" },
  heroContentWrap: { flex: 1, flexShrink: 1 },
  heroImageWrap: { width: 90, height: 90, borderRadius: 45, borderWidth: 2, borderColor: c.gold, overflow: "hidden", backgroundColor: c.surfaceSecondary },
  heroImage: { width: 90, height: 90 },
  heroContent: { flex: 1, flexShrink: 1, gap: spacing.xs },
  heroStatusRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexShrink: 1 },
  heroShield: { marginRight: 2 },
  heroStatusText: { fontFamily: fonts.displayBold, fontSize: 17, color: "#1B6B47", flexShrink: 1 },
  // Runs the full width of the card, stopping short of the artwork on the right.
  heroExplanation: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurface, paddingRight: spacing.sm },

  // ── Two side-by-side cards ──
  twoCards: { flexDirection: "row", gap: spacing.md, paddingHorizontal: spacing.lg, marginTop: spacing.md },
  halfCard: {
    flex: 1, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm,
    borderWidth: 0.25,
  },
  halfCardIconWrap: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  halfCardTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  halfCardTitle: { fontFamily: fonts.displayBold, fontSize: 14, color: c.onSurface, flex: 1 },
  halfCardDesc: { fontFamily: fonts.text, fontSize: 12, lineHeight: 17, color: c.onSurfaceSecondary },
  scoreChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, borderWidth: 0.5 },
  scoreDot: { width: 6, height: 6, borderRadius: 3 },
  scoreText: { fontFamily: fonts.textSemibold, fontSize: 11 },
  halfCardBtn: {
    borderRadius: radius.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    alignItems: "center", justifyContent: "center", marginTop: "auto",
  },
  halfCardBtnText: { fontFamily: fonts.textSemibold, fontSize: 12 },

  // ── Section headers ──
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, marginTop: spacing.md, marginBottom: spacing.sm },
  sectionTitle: { fontFamily: fonts.displayBold, fontSize: 17, color: c.onSurface },
  sectionLink: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.brand },

  // ── Priority alert card ──
  alertCard: {
    marginHorizontal: spacing.lg, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm,
    backgroundColor: "rgba(217,83,79,0.06)", borderWidth: 0.25, borderColor: "rgba(217,83,79,0.18)",
  },
  alertTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  alertIconWrap: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(217,83,79,0.14)", alignItems: "center", justifyContent: "center" },
  alertBadge: { backgroundColor: "rgba(217,83,79,0.14)", borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 },
  alertBadgeText: { fontFamily: fonts.textSemibold, fontSize: 10, color: c.barking, letterSpacing: 0.5, textTransform: "uppercase" },
  alertTime: { fontFamily: fonts.text, fontSize: 11, color: c.onSurfaceSecondary, marginLeft: "auto" },
  alertTitle: { fontFamily: fonts.displayBold, fontSize: 15, color: c.onSurface },
  alertDesc: { fontFamily: fonts.text, fontSize: 13, lineHeight: 19, color: c.onSurfaceSecondary },
  alertBtn: {
    borderRadius: radius.sm, borderWidth: 0.25, borderColor: c.barking,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.lg,
    alignItems: "center", alignSelf: "flex-start", marginTop: spacing.xs,
  },
  alertBtnText: { fontFamily: fonts.textSemibold, fontSize: 13, color: c.barking },

  // ── Activity row ──
  activityCard: {
    marginHorizontal: spacing.lg, borderRadius: radius.lg, padding: spacing.lg,
    backgroundColor: c.surfaceSecondary, borderWidth: 0.25, borderColor: c.border,
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
  const { width: screenW } = useWindowDimensions();
  const compact = screenW < 380;
  const { resolution, capabilities, protection, adapterLabel, refreshing, events, lowPower, quietNow, showToast, identityReset, reRegisterDevice, refresh } = useApollo();
  const health = useProtectionHealth();
  const { recovery, dismiss: dismissRecovery } = useRecoveryTracker(protection?.operational);

  // ── Refresh data whenever Home regains focus (e.g. after handling an item) ──
  useFocusEffect(
    React.useCallback(() => {
      void refresh(0);
    }, [refresh])
  );

  // The last time Higgins actually completed a Device Check on this device. Read from the stored
  // check itself — opening the app never counts as a check.
  const [lastHigginsCheckAt, setLastHigginsCheckAt] = React.useState<string | null>(null);
  useFocusEffect(
    React.useCallback(() => {
      let active = true;
      void getBaseline().then((baseline) => { if (active) setLastHigginsCheckAt(baseline?.checkedAt ?? null); }).catch(() => undefined);
      return () => { active = false; };
    }, [])
  );

  // Exception-first summaries for the two protection cards. The Device read happens once per open
  // (and on return to Apollo); a failed or absent read produces "Not checked" — never a green light.
  const deviceProtections = useDeviceProtections();
  const apolloSummary = React.useMemo(
    () => summariseApolloProtections(groupApolloProtections(health.gates), health.checking),
    [health.gates, health.checking],
  );
  const deviceSummary = deviceProtections?.summary ?? null;

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

  // Everything that needs the person right now, as hero lines Apollo cycles through.
  const heroLines = React.useMemo(() => buildHeroLines(voice, attention), [voice, attention]);
  const [heroIndex, setHeroIndex] = React.useState(0);
  React.useEffect(() => { setHeroIndex(0); }, [heroLines.length]);
  React.useEffect(() => {
    if (heroLines.length < 2) return;
    const timer = setInterval(() => setHeroIndex((i) => (i + 1) % heroLines.length), 7000);
    return () => clearInterval(timer);
  }, [heroLines.length]);
  const heroLine = heroLines[Math.min(heroIndex, heroLines.length - 1)] ?? heroLines[0];

  // Swipe left/right to move between the things needing attention.
  const stepHero = React.useCallback((delta: number) => {
    setHeroIndex((i) => {
      const count = heroLines.length;
      if (count < 2) return 0;
      return (i + delta + count) % count;
    });
  }, [heroLines.length]);
  const heroSwipe = React.useMemo(
    () => Gesture.Pan()
      .activeOffsetX([-20, 20])
      .failOffsetY([-14, 14])
      .onEnd((e) => {
        if (e.translationX <= -40) runOnJS(stepHero)(1);
        else if (e.translationX >= 40) runOnJS(stepHero)(-1);
      }),
    [stepHero],
  );

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
      <View style={[s.header, compact && { paddingHorizontal: spacing.lg }, { paddingTop: insets.top + spacing.sm }]}>
        <View style={s.headerRow}>
          <Image
            source={require("@/assets/images/apollosg-wordmark.png")}
            style={{ width: Math.min(screenW * 0.58, 280) * (screenW < 600 ? 0.75 : 1), aspectRatio: 1200 / 282 }}
            accessibilityLabel="ApolloSG"
            contentFit="contain"
            testID="home-brand-title"
          />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
            <AlertsButton testID="home-alerts" />
            <AppMenuButton testID="home-menu" />
          </View>
        </View>
        <Text style={[s.brandSubtitle, { fontSize: Math.max(9, Math.min(11, screenW * 0.028)) }]}>Better Protection. Safer You. Safer Tomorrows.</Text>
      </View>

      <ScrollView contentContainerStyle={s.scroll} testID="home-scroll" showsVerticalScrollIndicator={false}>
        {/* ── Hero Status Card ── */}
        <GestureDetector gesture={heroSwipe}>
        <Pressable
          testID="home-hero-card"
          accessibilityRole="button"
          accessibilityLabel={stateLabel}
          onPress={() => { const route = heroLine?.route ?? voice.ctaRoute; return route ? router.push(route as any) : null; }}
          style={[s.heroCard, compact && { marginHorizontal: spacing.lg }]}
        >
          {/* The artwork is a 3:1 landscape. It is laid out as a full-width band pinned to the bottom of
              the card and sized BY ITS OWN PROPORTIONS (aspectRatio), so every device shows the whole
              picture undistorted and uncropped however tall the card grows. A vertical wash blends the
              top of the band into the card colour, and the horizontal wash keeps the text readable. */}
          <View style={s.heroBgBand} pointerEvents="none">
            <Image
              source={heroBg}
              style={s.heroBgImage}
              contentFit="cover"
              testID="home-hero-bg"
            />
            <LinearGradient
              colors={["#E8F5EE", "rgba(232,245,238,0.55)", "transparent"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              locations={[0, 0.35, 1]}
              style={s.heroBandFade}
            />
          </View>
          <LinearGradient
            colors={["rgba(232,245,238,0.95)", "rgba(232,245,238,0.72)", "rgba(232,245,238,0.18)", "transparent"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            locations={[0, 0.55, 0.85, 1]}
            style={s.heroGradient}
          />
          <View style={[s.heroOverlay, compact && { padding: spacing.md }]}>
            {/* Apollo + his state on one row; the line he's saying runs the full width underneath. */}
            <View style={s.heroTopRow}>
              <View style={[s.heroImageWrap, compact && { width: 68, height: 68, borderRadius: 34 }]}>
                <Image
                  source={gif ? gif.src : FALLBACK_IMAGE}
                  style={[s.heroImage, compact && { width: 68, height: 68 }]}
                  contentFit="cover"
                  autoplay
                  accessibilityLabel={gif?.label ?? "Apollo"}
                  testID="home-hero-gif"
                />
              </View>
              <View style={s.heroStatusRow}>
                <ShieldCheck size={compact ? 14 : 16} color="#FFFFFF" fill={statusColor} style={s.heroShield} />
                <Text style={[s.heroStatusText, compact && { fontSize: 15 }, { color: colors[`${state}Text` as keyof typeof colors] as string || colors.restingText }]} numberOfLines={2}>{stateLabel}</Text>
              </View>
            </View>
            <Text style={[s.heroExplanation, compact && { fontSize: 13, lineHeight: 18 }]} numberOfLines={5} testID="home-hero-voice">{heroLine?.text ?? voice.text}</Text>
          </View>
        </Pressable>
        </GestureDetector>
        {heroLines.length > 1 ? (
          <Pressable
            onPress={() => setHeroIndex((i) => (i + 1) % heroLines.length)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Item ${heroIndex + 1} of ${heroLines.length}. Tap to see the next one.`}
            style={s.heroDotsRow}
            testID="home-hero-dots"
          >
            {heroLines.map((line, i) => (
              <View key={line.id} style={[s.heroDot, i === heroIndex && s.heroDotActive]} />
            ))}
            <Text style={s.heroDotsLabel}>{heroIndex + 1} of {heroLines.length}</Text>
          </Pressable>
        ) : null}

        {/* Last completed Higgins check — links to the Device Check result */}
        <View style={{ paddingHorizontal: spacing.xl, marginTop: spacing.sm }}>
          <Pressable
            testID="home-higgins-check"
            accessibilityRole="button"
            accessibilityLabel={lastHigginsCheckAt ? `Protection checked by Apollo ${timeAgo(lastHigginsCheckAt)}. Open the result.` : "Apollo hasn't checked this device yet. Run a check."}
            onPress={() => router.push("/recheck")}
            style={({ pressed }) => [s.checkedRow, { opacity: pressed ? 0.85 : 1 }]}
          >
            <ShieldCheck size={16} color={colors.resting} />
            <Text style={s.checkedText} numberOfLines={2} testID="home-higgins-check-text">
              {lastHigginsCheckAt ? `Protection checked by Apollo · ${timeAgo(lastHigginsCheckAt)}` : "Apollo hasn't checked this device yet"}
            </Text>
            <Text style={s.checkedAction}>{lastHigginsCheckAt ? "View" : "Run check"}</Text>
          </Pressable>
        </View>

        {/* A Device Protection changed since the person last looked — stays until they open it. */}
        <ProtectionChangeBanner style={{ marginHorizontal: spacing.xl, marginTop: spacing.sm }} testID="home-protection-change" />

        {/* Recovery banner */}
        <View style={{ paddingHorizontal: spacing.xl, marginTop: spacing.sm }}>
          <RecoveryBanner recovery={recovery} onDismiss={dismissRecovery} testID="home-recovery-banner" />
        </View>

        {/* ── Two Side-by-Side Cards — what needs you first, healthy items as a count ── */}
        <View style={[s.twoCards, compact && { gap: spacing.sm, paddingHorizontal: spacing.lg }]}>
          {/* Apollo Protections Card */}
          <Pressable
            testID="home-protection-card"
            accessibilityRole="button"
            accessibilityLabel={`Apollo Protections. ${apolloSummary.headline}. ${apolloSummary.detail}`}
            onPress={() => router.push("/(tabs)/protection")}
            style={({ pressed }) => [s.halfCard, compact && { padding: spacing.md }, { backgroundColor: "rgba(22,34,53,0.04)", borderColor: "rgba(22,34,53,0.12)", opacity: pressed ? 0.85 : 1 }]}
          >
            <View style={s.halfCardTitleRow}>
              <View style={[s.halfCardIconWrap, compact && { width: 28, height: 28, borderRadius: 14 }, { backgroundColor: "rgba(22,34,53,0.10)" }]}>
                <ShieldCheck size={compact ? 14 : 16} color={colors.brand} />
              </View>
              <Text style={[s.halfCardTitle, compact && { fontSize: 13 }]} numberOfLines={2}>Apollo Protections</Text>
            </View>
            <HomeCardChip overall={apolloSummary.overall} label={apolloSummary.overall === "action" || apolloSummary.overall === "review" || apolloSummary.overall === "check" ? apolloSummary.headline : CARD_CHIP[apolloSummary.overall]} testID="home-protection-chip" />
            <Text style={[s.halfCardDesc, compact && { fontSize: 11 }]} numberOfLines={3} testID="home-protection-summary">{apolloSummary.detail}</Text>
            <View style={[s.halfCardBtn, { backgroundColor: colors.brand }]}>
              <Text style={[s.halfCardBtnText, compact && { fontSize: 11 }, { color: colors.onBrand }]}>View</Text>
            </View>
          </Pressable>

          {/* Device Protections Card */}
          <Pressable
            testID="home-device-card"
            accessibilityRole="button"
            accessibilityLabel={`Device Protections. ${deviceSummary ? `${deviceSummary.headline}. ${deviceSummary.detail}` : "Reading this device."}`}
            onPress={() => router.push("/device-protection")}
            style={({ pressed }) => [s.halfCard, compact && { padding: spacing.md }, { backgroundColor: "rgba(201,163,74,0.06)", borderColor: "rgba(201,163,74,0.20)", opacity: pressed ? 0.85 : 1 }]}
          >
            <View style={s.halfCardTitleRow}>
              <View style={[s.halfCardIconWrap, compact && { width: 28, height: 28, borderRadius: 14 }, { backgroundColor: colors.goldTint }]}>
                <Smartphone size={compact ? 14 : 16} color={colors.gold} />
              </View>
              <Text style={[s.halfCardTitle, compact && { fontSize: 13 }]} numberOfLines={2}>Device Protections</Text>
            </View>
            <HomeCardChip overall={deviceSummary?.overall ?? "checking"} label={CARD_CHIP[deviceSummary?.overall ?? "checking"]} testID="home-device-capability-score" />
            <Text style={[s.halfCardDesc, compact && { fontSize: 11 }]} numberOfLines={3} testID="home-device-summary">
              {deviceSummary ? [deviceSummary.headline, deviceSummary.detail].filter(Boolean).join(". ").replace(/\.\./g, ".") : "Reading this device’s settings…"}
            </Text>
            <View style={[s.halfCardBtn, { backgroundColor: colors.gold }]}>
              <Text style={[s.halfCardBtnText, compact && { fontSize: 11 }, { color: "#FFFFFF" }]}>View</Text>
            </View>
          </Pressable>
        </View>

        {/* ── Important For You — priority subset of Threats + one scam alert ── */}
        {(() => {
          const priorityThreats = buildPriorityThreats(events);
          // Section shows if there are personal threats OR if PriorityScamNotice will render
          // (PriorityScamNotice handles its own data loading — renders null if no alert)
          return (
            <View>
              <View style={[s.sectionHeader, compact && { paddingHorizontal: spacing.lg }]}>
                <Text style={[s.sectionTitle, compact && { fontSize: 15 }]}>Important for you</Text>
                <Pressable onPress={() => router.push("/(tabs)/patrol")} hitSlop={8}>
                  <Text style={s.sectionLink}>View all</Text>
                </Pressable>
              </View>

              {/* Personal threats first — these take precedence */}
              {priorityThreats.map((event) => {
                const si = threatSourceIcon(event.category, event.source_metadata);
                const IconEl = si.Icon;
                const status = threatCaseStatus(event);
                const statusColor = STATUS_COLORS[status];
                return (
                  <Pressable
                    key={event.event_id}
                    testID={`home-threat-${event.event_id}`}
                    onPress={() => router.push(`/patrol/${encodeURIComponent(event.event_id)}` as any)}
                    style={[s.activityCard, compact && { marginHorizontal: spacing.lg, padding: spacing.md }, { marginBottom: spacing.sm, flexDirection: "column", alignItems: "stretch" }]}
                  >
                    {/* Icon, time and status share one compact row so the words below get the full card width. */}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                      <View style={[s.activityIconWrap, compact && { width: 28, height: 28, borderRadius: 14 }, { backgroundColor: si.bg }]}>
                        <IconEl size={compact ? 14 : 16} color={si.fg} />
                      </View>
                      <Text style={{ fontFamily: fonts.text, fontSize: 12, color: colors.muted, flex: 1 }} numberOfLines={1}>
                        {formatDateTime(event.occurred_at)}
                      </Text>
                      <View style={{ paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, backgroundColor: statusColor.bg }}>
                        <Text style={{ fontFamily: fonts.textSemibold, fontSize: 10, color: statusColor.text }}>{STATUS_LABELS[status]}</Text>
                      </View>
                    </View>
                    <View style={{ gap: 2, marginTop: 2 }}>
                      <Text style={[s.activityText, compact && { fontSize: 14 }]} numberOfLines={3}>{threatTitle(event)}</Text>
                      {threatIdentity(event) ? <Text style={s.activitySub} numberOfLines={1}>{threatIdentity(event)}</Text> : null}
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 4, marginTop: 2 }}>
                      <Text style={s.findingLink}>View threat</Text>
                      <ChevronRight size={14} color={colors.brand} />
                    </View>
                  </Pressable>
                );
              })}

              {/* One highest-priority scam alert — after personal threats */}
              <PriorityScamNotice compact />
            </View>
          );
        })()}

        {/* ── Recent Activity ── */}
        <View>
          <View style={[s.sectionHeader, compact && { paddingHorizontal: spacing.lg }]}>
            <Text style={[s.sectionTitle, compact && { fontSize: 15 }]}>Recent activity</Text>
            <Pressable onPress={() => router.push("/(tabs)/patrol")} hitSlop={8}>
              <Text style={s.sectionLink}>View all</Text>
            </Pressable>
          </View>
          {recentEvent ? (
            <Pressable
              testID="home-recent-activity"
              accessibilityRole="button"
              onPress={() => router.push(`/patrol/${encodeURIComponent(recentEvent.event_id)}` as any)}
              style={[s.activityCard, compact && { marginHorizontal: spacing.lg, padding: spacing.md }]}
            >
              <View style={s.activityIconWrap}>
                <MessageSquare size={16} color={colors.onSurfaceSecondary} />
              </View>
              <View style={s.activityContent}>
                <Text style={s.activityText} numberOfLines={1}>{recentEvent.headline || "Apollo recorded activity"}</Text>
                <Text style={s.activitySub} numberOfLines={1}>{plainTriageText(recentEvent.what_happened) || "Tap to see details."}</Text>
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
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm, marginTop: spacing.md }}>
          {identityReset ? (
            <Card style={{ gap: spacing.sm, borderColor: colors.barking }} testID="identity-reset-card">
              <Text style={{ fontFamily: fonts.displayBold, fontSize: 15, color: colors.brand }}>ApolloSG needs to re-register this phone</Text>
              <Body testID="identity-reset-why">{identityReset}</Body>
              <Button testID="identity-reset-register" label="Register this phone again" onPress={() => void reRegisterDevice().catch((e: Error) => showToast(e.message, "barking"))} />
            </Card>
          ) : null}
          <ServiceBanner />
          <HigginsFollowUp />
          <ClipboardLinkBanner />
        </View>

      </ScrollView>
      <RetrofitModal visible={showRetrofit} onClose={() => setShowRetrofit(false)} auto />
    </View>
  );
}

/** The status chip on a Home protection card. */
function HomeCardChip({ overall, label, testID }: { overall: CardOverall; label: string; testID: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const palette = chipColors(overall, colors);
  return (
    <View style={[s.scoreChip, { backgroundColor: palette.bg, borderColor: palette.dot, alignSelf: "flex-start" }]} testID={testID}>
      <View style={[s.scoreDot, { backgroundColor: palette.dot }]} />
      <Text style={[s.scoreText, { color: palette.text }]} numberOfLines={1}>{label}</Text>
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
