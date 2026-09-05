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

export function ApolloHero({ resolution, visibility, adapterLabel, isMock, animate = true, quietNow = false }: {
  resolution: StateResolution; visibility: Visibility; adapterLabel: string; isMock: boolean; animate?: boolean; quietNow?: boolean;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const tone = resolution.visibilityLost ? "unknown" : resolution.state;
  const color = toneColor(colors, tone);
  const state: ApolloState | "lost" = resolution.visibilityLost ? "lost" : resolution.state;

  const ring = useSharedValue(1);
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const rot = useSharedValue(0);
  const glow = useSharedValue(0.25);

  useEffect(() => {
    [ring, scale, tx, ty, rot, glow].forEach(cancelAnimation);
    ring.value = 1; scale.value = 1; tx.value = 0; ty.value = 0; rot.value = 0; glow.value = 0.25;
    if (!animate) return;
    if (state === "resting") {
      // The patrolling GIF carries the dog's motion; code adds only a slow breath and ring pulse.
      scale.value = withRepeat(withSequence(withTiming(1.03, { duration: 2400, easing: ease }), withTiming(1, { duration: 2400, easing: ease })), -1, false);
      ring.value = withRepeat(withSequence(withTiming(1.12, { duration: 2600, easing: ease }), withTiming(1, { duration: 2600, easing: ease })), -1, false);
      glow.value = withRepeat(withSequence(withTiming(0.4, { duration: 2400, easing: ease }), withTiming(0.2, { duration: 2400, easing: ease })), -1, false);
    } else if (state === "sniffing") {
      // Nose down, quick sniffs: small fast scale ticks with a gentle head tilt.
      scale.value = withRepeat(withSequence(withTiming(1.05, { duration: 140 }), withTiming(1, { duration: 140 }), withTiming(1.05, { duration: 140 }), withTiming(1, { duration: 140 }), withDelay(400, withTiming(1, { duration: 1 }))), -1, false);
      rot.value = withRepeat(withSequence(withTiming(6, { duration: 500, easing: ease }), withTiming(-6, { duration: 700, easing: ease }), withTiming(0, { duration: 500, easing: ease })), -1, false);
      ring.value = withRepeat(withSequence(withTiming(1.15, { duration: 900, easing: ease }), withTiming(1, { duration: 900, easing: ease })), -1, false);
      glow.value = withRepeat(withSequence(withTiming(0.45, { duration: 600 }), withTiming(0.25, { duration: 600 })), -1, false);
    } else if (state === "ears_up") {
      // Alert but still: a quick perk up, then a hold, then a slow settle.
      ty.value = withRepeat(withSequence(withTiming(-6, { duration: 160, easing: Easing.out(Easing.quad) }), withTiming(-6, { duration: 1400 }), withTiming(0, { duration: 700, easing: ease }), withDelay(1200, withTiming(0, { duration: 1 }))), -1, false);
      scale.value = withRepeat(withSequence(withTiming(1.06, { duration: 160 }), withTiming(1.06, { duration: 1400 }), withTiming(1, { duration: 700, easing: ease }), withDelay(1200, withTiming(1, { duration: 1 }))), -1, false);
      ring.value = withRepeat(withSequence(withTiming(1.1, { duration: 1600, easing: ease }), withTiming(1, { duration: 1600, easing: ease })), -1, false);
      glow.value = withRepeat(withSequence(withTiming(0.45, { duration: 1200 }), withTiming(0.25, { duration: 1200 })), -1, false);
    } else if (state === "growling") {
      // Low, continuous rumble.
      tx.value = withRepeat(withSequence(withTiming(-1.8, { duration: 70 }), withTiming(1.8, { duration: 70 })), -1, true);
      scale.value = withRepeat(withSequence(withTiming(1.03, { duration: 900, easing: ease }), withTiming(1, { duration: 900, easing: ease })), -1, false);
      ring.value = withRepeat(withSequence(withTiming(1.1, { duration: 1400, easing: ease }), withTiming(1, { duration: 1400, easing: ease })), -1, false);
      glow.value = withRepeat(withSequence(withTiming(0.55, { duration: 700 }), withTiming(0.3, { duration: 700 })), -1, false);
    } else if (state === "barking") {
      // Sharp, rhythmic bounces — two quick barks then a beat.
      const bark = withSequence(withTiming(-10, { duration: 110, easing: Easing.out(Easing.quad) }), withTiming(0, { duration: 160, easing: Easing.bounce }));
      ty.value = withRepeat(withSequence(bark, withDelay(120, bark), withDelay(700, withTiming(0, { duration: 1 }))), -1, false);
      scale.value = withRepeat(withSequence(withTiming(1.1, { duration: 110 }), withTiming(1, { duration: 160 }), withDelay(120, withTiming(1.1, { duration: 110 })), withTiming(1, { duration: 160 }), withDelay(700, withTiming(1, { duration: 1 }))), -1, false);
      ring.value = withRepeat(withSequence(withTiming(1.25, { duration: 350, easing: Easing.out(Easing.quad) }), withTiming(1, { duration: 350 })), -1, false);
      glow.value = withRepeat(withSequence(withTiming(0.7, { duration: 250 }), withTiming(0.3, { duration: 450 })), -1, false);
    } else if (state === "biting") {
      // Lunge forward, snap, hold, settle.
      scale.value = withRepeat(withSequence(withTiming(1.18, { duration: 140, easing: Easing.out(Easing.quad) }), withTiming(1.06, { duration: 120 }), withTiming(1.12, { duration: 90 }), withTiming(1, { duration: 500, easing: ease }), withDelay(900, withTiming(1, { duration: 1 }))), -1, false);
      rot.value = withRepeat(withSequence(withTiming(-7, { duration: 140 }), withTiming(3, { duration: 120 }), withTiming(-2, { duration: 90 }), withTiming(0, { duration: 500, easing: ease }), withDelay(900, withTiming(0, { duration: 1 }))), -1, false);
      ring.value = withRepeat(withSequence(withTiming(1.3, { duration: 300, easing: Easing.out(Easing.quad) }), withTiming(1, { duration: 400 })), -1, false);
      glow.value = withRepeat(withSequence(withTiming(0.8, { duration: 200 }), withTiming(0.35, { duration: 600 })), -1, false);
    } else {
      // Visibility lost: dim, slow fade — deliberately lifeless.
      glow.value = withRepeat(withSequence(withTiming(0.15, { duration: 1800 }), withTiming(0.05, { duration: 1800 })), -1, false);
    }
  }, [state, animate, ring, scale, tx, ty, rot, glow]);

  const ringStyle = useAnimatedStyle(() => ({ transform: [{ scale: ring.value }], opacity: 1.35 - ring.value }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));
  const dogStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { rotate: `${rot.value}deg` }, { scale: scale.value }] }));

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
              ) : (
                <Image source={require("../../assets/images/logo.png")} style={{ width: 124, height: 124 }} contentFit="contain" accessibilityLabel="Apollo" />
              )}
            </Animated.View>
          </View>
          <Text style={s.label} testID="apollo-state-label">{title}</Text>
          <Text style={s.meaning}>{meaning}</Text>
          <Text style={s.reason} testID="apollo-state-reason">{resolution.reason}</Text>
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
