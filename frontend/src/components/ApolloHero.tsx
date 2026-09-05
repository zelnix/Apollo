// Home hero: communicates the current Apollo state with exact wording.
// Visibility gaps are surfaced explicitly, never masked by a safe state.

import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";

import type { StateResolution } from "@/src/domain/stateMachine";
import { STATE_LABEL, STATE_MEANING, type Visibility } from "@/src/domain/types";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { Pill, toneColor, toneTint } from "./ui";

const useStyles = makeStyles((c) => ({
  hero: { borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, overflow: "hidden", backgroundColor: c.surfaceSecondary },
  inner: { padding: spacing.xl, gap: spacing.md },
  orbWrap: { alignItems: "center", justifyContent: "center", height: 150 },
  orbRing: { position: "absolute", width: 150, height: 150, borderRadius: 75, borderWidth: 1 },
  orb: { width: 92, height: 92, borderRadius: 46, alignItems: "center", justifyContent: "center", borderWidth: 2 },
  orbCore: { width: 40, height: 40, borderRadius: 20 },
  label: { fontFamily: fonts.displayBold, fontSize: 26, color: c.onSurface, letterSpacing: -0.3 },
  meaning: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurfaceSecondary },
  reason: { fontFamily: fonts.textMedium, fontSize: 14, lineHeight: 20, color: c.onSurface },
  row: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
}));

export function ApolloHero({ resolution, visibility, adapterLabel, isMock }: { resolution: StateResolution; visibility: Visibility; adapterLabel: string; isMock: boolean }) {
  const s = useStyles();
  const { colors } = useTheme();
  const tone = resolution.visibilityLost ? "unknown" : resolution.state;
  const color = toneColor(colors, tone);
  const pulse = useSharedValue(1);
  useEffect(() => {
    const dur = resolution.state === "resting" ? 2600 : resolution.state === "growling" ? 1400 : 700;
    pulse.value = 1;
    pulse.value = withRepeat(withSequence(withTiming(1.12, { duration: dur, easing: Easing.inOut(Easing.ease) }), withTiming(1, { duration: dur, easing: Easing.inOut(Easing.ease) })), -1, false);
  }, [resolution.state, pulse]);
  const ring = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }], opacity: 1.35 - pulse.value }));

  const title = resolution.visibilityLost ? "Apollo can't see right now" : STATE_LABEL[resolution.state];
  const meaning = resolution.visibilityLost ? "Protection is off or has no active checks. This is not a safe state." : STATE_MEANING[resolution.state];

  return (
    <View style={s.hero} testID="apollo-hero">
      <LinearGradient colors={[toneTint(colors, tone), colors.surfaceSecondary]} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }}>
        <View style={s.inner}>
          <View style={s.orbWrap}>
            <Animated.View style={[s.orbRing, { borderColor: color }, ring]} />
            <View style={[s.orb, { borderColor: color, backgroundColor: toneTint(colors, tone) }]}>
              <View style={[s.orbCore, { backgroundColor: color }]} />
            </View>
          </View>
          <Text style={s.label} testID="apollo-state-label">{title}</Text>
          <Text style={s.meaning}>{meaning}</Text>
          <Text style={s.reason} testID="apollo-state-reason">{resolution.reason}</Text>
          <View style={s.row}>
            <Pill testID="visibility-pill" tone={visibility === "full" ? "resting" : visibility === "limited" ? "growling" : "unknown"} label={visibility === "full" ? "Full visibility" : visibility === "limited" ? "Limited visibility" : "No visibility"} />
            {resolution.recovering ? <Pill tone="growling" label="Awaiting fresh check" testID="recovering-pill" /> : null}
            {isMock ? <Pill tone="unknown" label={adapterLabel} testID="mock-adapter-pill" /> : null}
          </View>
        </View>
      </LinearGradient>
    </View>
  );
}
