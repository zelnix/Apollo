// Home hero: communicates the current Apollo state with exact wording.
// Visibility gaps are surfaced explicitly, never masked by a safe state.
// Apollo (the shield) is animated per state: patrolling = slow breath + look-around sweep,
// growling = low rumble, barking = sharp bounces, biting = lunge and snap.

import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";

import type { StateResolution } from "@/src/domain/stateMachine";
import { STATE_LABEL, STATE_MEANING, type ApolloState, type Visibility } from "@/src/domain/types";
import { HigginsSpeakButton } from "@/src/components/HigginsSpeakButton";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { Pill, toneColor, toneTint } from "./ui";

const useStyles = makeStyles((c) => ({
  hero: { borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, overflow: "hidden", backgroundColor: c.surfaceSecondary },
  inner: { padding: spacing.xl, gap: spacing.md },
  orbWrap: { alignItems: "center", justifyContent: "center", height: 160 },
  orbRing: { position: "absolute", width: 150, height: 150, borderRadius: 75, borderWidth: 1 },
  glow: { position: "absolute", width: 120, height: 120, borderRadius: 60 },
  label: { fontFamily: fonts.displayBold, fontSize: 26, color: c.onSurface, letterSpacing: -0.3 },
  meaning: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurfaceSecondary },
  reason: { fontFamily: fonts.textMedium, fontSize: 14, lineHeight: 20, color: c.onSurface },
  row: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
}));

const ease = Easing.inOut(Easing.ease);

export function ApolloHero({ resolution, visibility, adapterLabel, isMock, animate = true, quietNow = false, sniffing = false }: {
  resolution: StateResolution; visibility: Visibility; adapterLabel: string; isMock: boolean; animate?: boolean; quietNow?: boolean;
  /** True while Apollo is actively re-checking (Verify now / pull-to-refresh) — shows the transient Sniffing state. */
  sniffing?: boolean;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const tone = resolution.visibilityLost ? "unknown" : resolution.state;
  const color = toneColor(colors, tone);
  const state: ApolloState | "lost" = resolution.visibilityLost ? "lost" : sniffing ? "sniffing" : resolution.state;

  const ring = useSharedValue(1);
  const scale = useSharedValue(1);
  const ty = useSharedValue(0);
  const glow = useSharedValue(0.25);

  useEffect(() => {
    [ring, scale, ty, glow].forEach(cancelAnimation);
    ring.value = 1; scale.value = 1; ty.value = 0; glow.value = 0.25;
    if (!animate) return;
    if (state === "resting") {
      // The patrolling GIF carries the dog's motion; code adds only a slow breath and ring pulse.
      scale.value = withRepeat(withSequence(withTiming(1.03, { duration: 2400, easing: ease }), withTiming(1, { duration: 2400, easing: ease })), -1, false);
      ring.value = withRepeat(withSequence(withTiming(1.12, { duration: 2600, easing: ease }), withTiming(1, { duration: 2600, easing: ease })), -1, false);
      glow.value = withRepeat(withSequence(withTiming(0.4, { duration: 2400, easing: ease }), withTiming(0.2, { duration: 2400, easing: ease })), -1, false);
    } else if (state === "sniffing") {
      // The sniffing GIF carries the dog's motion; code adds only the ring pulse and glow.
      ring.value = withRepeat(withSequence(withTiming(1.15, { duration: 900, easing: ease }), withTiming(1, { duration: 900, easing: ease })), -1, false);
      glow.value = withRepeat(withSequence(withTiming(0.45, { duration: 600 }), withTiming(0.25, { duration: 600 })), -1, false);
    } else if (state === "ears_up") {
      // Alert but still: a quick perk up, then a hold, then a slow settle.
      ty.value = withRepeat(withSequence(withTiming(-6, { duration: 160, easing: Easing.out(Easing.quad) }), withTiming(-6, { duration: 1400 }), withTiming(0, { duration: 700, easing: ease }), withDelay(1200, withTiming(0, { duration: 1 }))), -1, false);
      scale.value = withRepeat(withSequence(withTiming(1.06, { duration: 160 }), withTiming(1.06, { duration: 1400 }), withTiming(1, { duration: 700, easing: ease }), withDelay(1200, withTiming(1, { duration: 1 }))), -1, false);
      ring.value = withRepeat(withSequence(withTiming(1.1, { duration: 1600, easing: ease }), withTiming(1, { duration: 1600, easing: ease })), -1, false);
      glow.value = withRepeat(withSequence(withTiming(0.45, { duration: 1200 }), withTiming(0.25, { duration: 1200 })), -1, false);
    } else if (state === "growling") {
      // The growling GIF carries the dog's motion — no code shake. Ring and glow pulse low and steady.
      ring.value = withRepeat(withSequence(withTiming(1.1, { duration: 1400, easing: ease }), withTiming(1, { duration: 1400, easing: ease })), -1, false);
      glow.value = withRepeat(withSequence(withTiming(0.55, { duration: 700 }), withTiming(0.3, { duration: 700 })), -1, false);
    } else if (state === "barking") {
      // The barking GIF carries the dog's motion; code adds sharp ring bursts and glow.
      ring.value = withRepeat(withSequence(withTiming(1.25, { duration: 350, easing: Easing.out(Easing.quad) }), withTiming(1, { duration: 350 })), -1, false);
      glow.value = withRepeat(withSequence(withTiming(0.7, { duration: 250 }), withTiming(0.3, { duration: 450 })), -1, false);
    } else if (state === "biting") {
      // Guarding: same GIF as barking, stronger ring and glow — no code lunge.
      ring.value = withRepeat(withSequence(withTiming(1.3, { duration: 300, easing: Easing.out(Easing.quad) }), withTiming(1, { duration: 400 })), -1, false);
      glow.value = withRepeat(withSequence(withTiming(0.8, { duration: 200 }), withTiming(0.35, { duration: 600 })), -1, false);
    } else {
      // Visibility lost: dim, slow fade — deliberately lifeless.
      glow.value = withRepeat(withSequence(withTiming(0.15, { duration: 1800 }), withTiming(0.05, { duration: 1800 })), -1, false);
    }
  }, [state, animate, ring, scale, ty, glow]);

  const ringStyle = useAnimatedStyle(() => ({ transform: [{ scale: ring.value }], opacity: 1.35 - ring.value }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));
  const dogStyle = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }, { scale: scale.value }] }));

  const title = resolution.visibilityLost ? "Apollo can't see right now" : STATE_LABEL[resolution.state];
  const meaning = resolution.visibilityLost ? "Protection is off or has no active checks. This is not a safe state." : STATE_MEANING[resolution.state];

  return (
    <View style={s.hero} testID="apollo-hero">
      <LinearGradient colors={[toneTint(colors, tone), colors.surfaceSecondary]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }}>
        <View style={s.inner}>
          <View style={s.orbWrap} testID={`apollo-hero-anim-${state}`}>
            <Animated.View style={[s.orbRing, { borderColor: color }, ringStyle]} />
            <Animated.View style={[s.glow, { backgroundColor: color }, glowStyle]} />
            <Animated.View style={dogStyle}>
              {state === "resting" && animate ? (
                <Image source={require("../../assets/images/apollo-patrolling.gif")} style={{ width: 132, height: 132 }} contentFit="contain" autoplay accessibilityLabel="Apollo patrolling" testID="apollo-hero-gif" />
              ) : (state === "barking" || state === "biting") && animate ? (
                <Image source={require("../../assets/images/apollo-barking.gif")} style={{ width: 132, height: 132 }} contentFit="contain" autoplay accessibilityLabel="Apollo barking" testID="apollo-hero-gif-barking" />
              ) : state === "growling" && animate ? (
                <Image source={require("../../assets/images/apollo-growling.gif")} style={{ width: 132, height: 132 }} contentFit="contain" autoplay accessibilityLabel="Apollo growling" testID="apollo-hero-gif-growling" />
              ) : state === "sniffing" && animate ? (
                <Image source={require("../../assets/images/apollo-sniffing.gif")} style={{ width: 132, height: 132 }} contentFit="contain" autoplay accessibilityLabel="Apollo sniffing" testID="apollo-hero-gif-sniffing" />
              ) : (
                <Image source={require("../../assets/images/logo.png")} style={{ width: 124, height: 124 }} contentFit="contain" accessibilityLabel="Apollo" />
              )}
            </Animated.View>
          </View>
          <Text style={s.label} testID="apollo-state-label">{title}</Text>
          <Text style={s.meaning}>{meaning}</Text>
          <Text style={s.reason} testID="apollo-state-reason">{resolution.reason}</Text>
          <HigginsSpeakButton text={`${title}. ${meaning} ${resolution.reason}`} testID="hero-hear-higgins" />
          <View style={s.row}>
            <Pill testID="visibility-pill" tone={visibility === "full" ? "resting" : visibility === "limited" ? "growling" : "unknown"} label={visibility === "full" ? "Full visibility" : visibility === "limited" ? "Limited visibility" : "No visibility"} />
            {resolution.recovering ? <Pill tone="growling" label="Awaiting fresh check" testID="recovering-pill" /> : null}
            {resolution.recovering && resolution.drivingEvent?.state === "biting" && resolution.drivingEvent.verified_block ? <Pill tone="resting" label="Threat contained" testID="contained-pill" /> : null}
            {quietNow ? <Pill tone="unknown" label="Quiet hours" testID="quiet-pill" /> : null}
            {!animate ? <Pill tone="unknown" label="Battery saver" testID="lowpower-pill" /> : null}
            {isMock ? <Pill tone="unknown" label={adapterLabel} testID="mock-adapter-pill" /> : null}
          </View>
        </View>
      </LinearGradient>
    </View>
  );
}
