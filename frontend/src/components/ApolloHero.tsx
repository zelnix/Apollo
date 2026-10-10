// Home hero: communicates the current Apollo state with exact wording.
// Visibility gaps are surfaced explicitly, never masked by a safe state.
// Apollo (the shield) is animated per state: patrolling = slow breath + look-around sweep,
// growling = low rumble, barking = sharp bounces, biting = lunge and snap.

import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Text, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { useRouter } from "expo-router";

import type { StateResolution } from "@/src/domain/stateMachine";
import type { AttentionItem } from "@/src/domain/homeAttention";
import { buildHomeVoice } from "@/src/domain/higginsHomeVoice";
import type { GatePresentation } from "@/src/domain/gates";
import { STATE_LABEL, STATE_MEANING, type ApolloState, type Capability } from "@/src/domain/types";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { HigginsChecks } from "@/src/components/HigginsChecks";
import { higginsPermissionNote, recommendedChecks } from "@/src/domain/higginsChecks";
import { Sheet } from "./Sheet";
import { Body, Button, DevTag, Pill, toneColor, toneWash } from "./ui";

/** Apollo is an animated character, not a static shield — this is core brand identity.
 *  One state → one asset, in one place, so dropping in apollo-ears-up.gif later is a one-line change. */
const HERO_SIZE = 104;
const STATE_GIF: Partial<Record<ApolloState, { src: number; label: string; testID: string }>> = {
  resting: { src: require("../../assets/images/apollo-patrolling.gif"), label: "Apollo patrolling", testID: "apollo-hero-gif" },
  sniffing: { src: require("../../assets/images/apollo-sniffing.gif"), label: "Apollo sniffing", testID: "apollo-hero-gif-sniffing" },
  growling: { src: require("../../assets/images/apollo-growling.gif"), label: "Apollo growling", testID: "apollo-hero-gif-growling" },
  barking: { src: require("../../assets/images/apollo-barking.gif"), label: "Apollo barking", testID: "apollo-hero-gif-barking" },
  biting: { src: require("../../assets/images/apollo-barking.gif"), label: "Apollo biting after a confirmed block", testID: "apollo-hero-gif-biting" },
  // ears_up: same visual as sniffing — Apollo noticed something and is taking a closer look (investigation).
  ears_up: { src: require("../../assets/images/apollo-sniffing.gif"), label: "Apollo has his ears up", testID: "apollo-hero-gif-ears-up" },
};

const useStyles = makeStyles((c) => ({
  hero: { borderRadius: radius.lg, borderWidth: 1, borderColor: c.navyBorder, overflow: "hidden" },
  topEdge: { position: "absolute", top: 0, left: 0, right: 0, height: 5 },
  topSeam: { position: "absolute", top: 5, left: 0, right: 0, height: 1, backgroundColor: c.navySoft, opacity: 0.35 },
  inner: { padding: spacing.lg, gap: spacing.sm, alignItems: "center" },
  orbWrap: { alignItems: "center", justifyContent: "center", height: 128 },
  outerRing: { position: "absolute", width: 132, height: 132, borderRadius: 66, borderWidth: 1 },
  orbRing: { position: "absolute", width: 120, height: 120, borderRadius: 60, borderWidth: 1 },
  goldRing: { position: "absolute", width: 112, height: 112, borderRadius: 56, borderWidth: 1.5 },
  glow: { position: "absolute", width: 120, height: 120, borderRadius: 60 },
  label: { fontFamily: fonts.displayBold, fontSize: 22, color: c.onSurface, letterSpacing: -0.3, textAlign: "center" },
  meaning: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurfaceSecondary, textAlign: "center" },
  reason: { fontFamily: fonts.textMedium, fontSize: 14, lineHeight: 20, color: c.onSurface, textAlign: "center" },
  reasonLink: { fontFamily: fonts.displayBold, fontSize: 14, lineHeight: 20, color: c.onSurface, textAlign: "center" },
  higginsPara: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurface, textAlign: "left" },
  problemBox: { width: "100%", gap: 3, backgroundColor: c.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, padding: spacing.md },
  problemLabel: { fontFamily: fonts.textSemibold, fontSize: 11, letterSpacing: 0.4, color: c.muted },
  problemTitle: { fontFamily: fonts.displayBold, fontSize: 15, lineHeight: 20, color: c.onSurface, textAlign: "center" },
  problemText: { fontFamily: fonts.textMedium, fontSize: 14, lineHeight: 20, color: c.onSurface },
  higginsText: { fontFamily: fonts.text, fontSize: 14, lineHeight: 20, color: c.onSurface },
  openHint: { marginTop: 8, fontFamily: fonts.displayBold, fontSize: 14, color: c.brand },
  row: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", justifyContent: "center" },
  note: { fontFamily: fonts.text, fontSize: 12, lineHeight: 17, color: c.onSurfaceSecondary },
}));

const ease = Easing.inOut(Easing.ease);

export function ApolloHero({ resolution, adapterLabel, isMock, capabilities = [], animate = true, quietNow = false, sniffing = false, attention = [], gates = [], findingCount = 0 }: {
  resolution: StateResolution; adapterLabel: string; isMock: boolean; animate?: boolean; quietNow?: boolean;
  capabilities?: Capability[];
  sniffing?: boolean;
  attention?: AttentionItem[];
  gates?: GatePresentation[];
  /** Distinct unresolved findings count (observations + concerns + blocked) — same number as Protection Details. */
  findingCount?: number;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const tone = resolution.state;
  const color = toneColor(colors, tone);
  // UX-16: respect the platform reduced-motion accessibility preference by routing it through the
  // existing animation-disable path (the same one battery saver uses). No new animation subsystem.
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => { if (mounted) setReduceMotion(!!v); }).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", (v) => setReduceMotion(!!v));
    return () => { mounted = false; sub?.remove?.(); };
  }, []);
  const motionOn = animate && !reduceMotion;
  const state: ApolloState = sniffing ? "sniffing" : resolution.state;
  const gif = motionOn ? STATE_GIF[state] : undefined;
  const [checklistOpen, setChecklistOpen] = useState(false);

  const ring = useSharedValue(1);
  const scale = useSharedValue(1);
  const ty = useSharedValue(0);
  const glow = useSharedValue(0.25);

  useEffect(() => {
    [ring, scale, ty, glow].forEach(cancelAnimation);
    ring.value = 1; scale.value = 1; ty.value = 0; glow.value = 0.25;
    if (!motionOn) return;
    if (state === "resting") {
      // The patrolling GIF carries the dog's motion; code adds only a slow breath and ring pulse.
      scale.value = withRepeat(withSequence(withTiming(1.03, { duration: 2400, easing: ease }), withTiming(1, { duration: 2400, easing: ease })), -1, false);
      ring.value = withRepeat(withSequence(withTiming(1.12, { duration: 2600, easing: ease }), withTiming(1, { duration: 2600, easing: ease })), -1, false);
      glow.value = withRepeat(withSequence(withTiming(0.55, { duration: 2400, easing: ease }), withTiming(0.32, { duration: 2400, easing: ease })), -1, false);
    } else if (state === "sniffing") {
      // The sniffing GIF carries the dog's motion; code adds only the ring pulse and glow.
      ring.value = withRepeat(withSequence(withTiming(1.15, { duration: 900, easing: ease }), withTiming(1, { duration: 900, easing: ease })), -1, false);
      glow.value = withRepeat(withSequence(withTiming(0.55, { duration: 600 }), withTiming(0.35, { duration: 600 })), -1, false);
    } else if (state === "ears_up") {
      // Alert but still: a quick perk up, then a hold, then a slow settle.
      ty.value = withRepeat(withSequence(withTiming(-6, { duration: 160, easing: Easing.out(Easing.quad) }), withTiming(-6, { duration: 1400 }), withTiming(0, { duration: 700, easing: ease }), withDelay(1200, withTiming(0, { duration: 1 }))), -1, false);
      scale.value = withRepeat(withSequence(withTiming(1.06, { duration: 160 }), withTiming(1.06, { duration: 1400 }), withTiming(1, { duration: 700, easing: ease }), withDelay(1200, withTiming(1, { duration: 1 }))), -1, false);
      ring.value = withRepeat(withSequence(withTiming(1.1, { duration: 1600, easing: ease }), withTiming(1, { duration: 1600, easing: ease })), -1, false);
      glow.value = withRepeat(withSequence(withTiming(0.6, { duration: 1200 }), withTiming(0.38, { duration: 1200 })), -1, false);
    } else if (state === "growling") {
      // The growling GIF carries the dog's motion — no code shake. Ring and glow pulse low and steady.
      ring.value = withRepeat(withSequence(withTiming(1.1, { duration: 1400, easing: ease }), withTiming(1, { duration: 1400, easing: ease })), -1, false);
      glow.value = withRepeat(withSequence(withTiming(0.68, { duration: 700 }), withTiming(0.42, { duration: 700 })), -1, false);
    } else if (state === "barking") {
      // The barking GIF carries the dog's motion; code adds sharp ring bursts and glow.
      ring.value = withRepeat(withSequence(withTiming(1.25, { duration: 350, easing: Easing.out(Easing.quad) }), withTiming(1, { duration: 350 })), -1, false);
      glow.value = withRepeat(withSequence(withTiming(0.82, { duration: 250 }), withTiming(0.42, { duration: 450 })), -1, false);
    } else if (state === "biting") {
      // Guarding: same GIF as barking, stronger ring and glow — no code lunge.
      ring.value = withRepeat(withSequence(withTiming(1.3, { duration: 300, easing: Easing.out(Easing.quad) }), withTiming(1, { duration: 400 })), -1, false);
      glow.value = withRepeat(withSequence(withTiming(0.9, { duration: 200 }), withTiming(0.45, { duration: 600 })), -1, false);
    } else {
      // Visibility lost: dim, slow fade — deliberately lifeless.
      glow.value = withRepeat(withSequence(withTiming(0.15, { duration: 1800 }), withTiming(0.05, { duration: 1800 })), -1, false);
    }
  }, [state, motionOn, ring, scale, ty, glow]);

  const ringStyle = useAnimatedStyle(() => ({ transform: [{ scale: ring.value }], opacity: 1.35 - ring.value }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));
  const dogStyle = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }, { scale: scale.value }] }));

  const title = STATE_LABEL[resolution.state];
  const meaning = STATE_MEANING[resolution.state];
  const router = useRouter();

  // Higgins' interpretation of Apollo's behaviour — ONE short paragraph that names only the gates
  // actually affected, and one primary action. Short on Home; the Protection Details screen (or the
  // specific investigation / gate) has the full detail. Benign states (resting / sniffing) still get
  // a line of voice so the person always sees Higgins.
  const voice = useMemo(
    () => buildHomeVoice({ resolution, attention, gates, capabilities, findingCount }),
    [resolution, attention, gates, capabilities, findingCount],
  );
  const checks = sniffing ? [] : recommendedChecks(resolution);
  const askedAt = useMemo(() => new Date(new Date().setHours(0, 0, 0, 0)).toISOString(), []);
  const permissionNote = higginsPermissionNote(capabilities);

  return (
    <View style={[s.hero, { backgroundColor: toneWash(colors, tone) }]} testID="apollo-hero">
      <LinearGradient colors={[color, colors.goldHighlight]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.topEdge} />
      <View style={s.topSeam} />
      <View style={s.inner}>
        <View style={s.orbWrap} testID={`apollo-hero-anim-${state}`}>
          <View style={[s.outerRing, { borderColor: colors.navyBorder }]} />
          <Animated.View style={[s.orbRing, { borderColor: color }, ringStyle]} />
          <Animated.View style={[s.glow, { backgroundColor: color }, glowStyle]} />
          <View style={[s.goldRing, { borderColor: colors.goldBorder }]} />
          <Animated.View style={dogStyle}>
            {gif ? (
              <Image source={gif.src} style={{ width: HERO_SIZE, height: HERO_SIZE }} contentFit="contain" autoplay accessibilityLabel={gif.label} testID={gif.testID} />
            ) : (
              <Image source={require("../../assets/images/logo.png")} style={{ width: HERO_SIZE * 0.94, height: HERO_SIZE * 0.94 }} contentFit="contain" accessibilityLabel="Apollo" />
            )}
          </Animated.View>
        </View>
        <Text style={s.label} testID="apollo-state-label">{title}</Text>
        {/* Patrolling is the only "all is well" state — show the simple meaning. For every other
         *  state (sniffing / ears_up / growling / barking / biting) Higgins speaks ONE short
         *  paragraph (gate names assembled from the real affected set) and the card offers ONE
         *  primary action — the Protection Details screen for broad concerns, or the specific
         *  investigation / gate for a specific issue. */}
        {state === "resting" ? (
          <Text style={s.meaning} testID="apollo-state-meaning">{meaning}</Text>
        ) : (
          <View style={{ width: "100%", gap: spacing.sm, alignItems: "stretch" }}>
            <Text style={s.higginsPara} testID="apollo-higgins-paragraph">{voice.text}</Text>
            {findingCount > 0 ? (
              <Text style={[s.higginsPara, { fontFamily: fonts.textSemibold }]} testID="apollo-finding-count">
                {findingCount === 1 ? "1 finding" : `${findingCount} findings`} requiring attention
              </Text>
            ) : null}
            {voice.ctaRoute ? (
              <Button
                testID="apollo-view-details"
                label={voice.ctaLabel}
                onPress={() => router.push(voice.ctaRoute as never)}
              />
            ) : null}
          </View>
        )}
        <View style={s.row}>
          {resolution.recovering ? <Pill tone="growling" label="Awaiting fresh check" testID="recovering-pill" /> : null}
          {resolution.recovering && resolution.drivingEvent?.state === "biting" && resolution.drivingEvent.verified_block ? <Pill tone="resting" label="Threat contained" testID="contained-pill" /> : null}
          {quietNow ? <Pill tone="unknown" label="Quiet hours" testID="quiet-pill" /> : null}
          {!animate ? <Pill tone="unknown" label="Battery saver" testID="lowpower-pill" /> : null}
          {isMock ? <DevTag label={adapterLabel} testID="mock-adapter-pill" /> : null}
        </View>
      </View>
      <Sheet visible={checklistOpen} onClose={() => setChecklistOpen(false)} title="Checks Higgins recommends" testID="hero-checklist-sheet">
        <HigginsChecks checks={checks} askedAt={askedAt} messageId="hero" record={false} title="" onNavigate={() => setChecklistOpen(false)} />
        {permissionNote ? <Body testID="hero-checklist-permission-note">{permissionNote}</Body> : null}
        <Button testID="hero-checklist-close" variant="ghost" label="Got it" onPress={() => setChecklistOpen(false)} />
      </Sheet>
    </View>
  );
}
