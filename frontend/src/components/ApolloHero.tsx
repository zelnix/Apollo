// Home hero: communicates the current Apollo state with exact wording.
// Visibility gaps are surfaced explicitly, never masked by a safe state.
// Apollo (the shield) is animated per state: patrolling = slow breath + look-around sweep,
// growling = low rumble, barking = sharp bounces, biting = lunge and snap.

import { useAudioPlayer } from "expo-audio";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import BellRing from "lucide-react-native/icons/bell-ring";
import React, { useEffect, useMemo, useState } from "react";
import { AppState, Text, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";

import type { StateResolution } from "@/src/domain/stateMachine";
import { STATE_LABEL, STATE_MEANING, type ApolloState, type Capability, type Visibility } from "@/src/domain/types";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { HigginsChecks } from "@/src/components/HigginsChecks";
import { HigginsSpeakButton } from "@/src/components/HigginsSpeakButton";
import { checksSpoken, higginsPermissionNote, recommendedChecks } from "@/src/domain/higginsChecks";
import { Sheet } from "./Sheet";
import { Body, Button, DevTag, Pill, toneColor, toneWash } from "./ui";

/** How often Higgins chimes to remind you a check is waiting, until you tap Hear Higgins. */
const REMINDER_INTERVAL_MS = 60 * 1000;

/** Apollo is an animated character, not a static shield — this is core brand identity.
 *  One state → one asset, in one place, so dropping in apollo-ears-up.gif later is a one-line change. */
const HERO_SIZE = 170;
const STATE_GIF: Partial<Record<ApolloState, { src: number; label: string; testID: string }>> = {
  resting: { src: require("../../assets/images/apollo-patrolling.gif"), label: "Apollo patrolling", testID: "apollo-hero-gif" },
  sniffing: { src: require("../../assets/images/apollo-sniffing.gif"), label: "Apollo sniffing", testID: "apollo-hero-gif-sniffing" },
  growling: { src: require("../../assets/images/apollo-growling.gif"), label: "Apollo growling", testID: "apollo-hero-gif-growling" },
  barking: { src: require("../../assets/images/apollo-barking.gif"), label: "Apollo barking", testID: "apollo-hero-gif-barking" },
  biting: { src: require("../../assets/images/apollo-barking.gif"), label: "Apollo barking", testID: "apollo-hero-gif-barking" },
  // ears_up: no GIF yet — drop apollo-ears-up.gif in here when it exists. Falls back to the static mark below.
};

const useStyles = makeStyles((c) => ({
  hero: { borderRadius: radius.lg, borderWidth: 1, borderColor: c.navyBorder, overflow: "hidden" },
  topEdge: { position: "absolute", top: 0, left: 0, right: 0, height: 5 },
  topSeam: { position: "absolute", top: 5, left: 0, right: 0, height: 1, backgroundColor: c.navySoft, opacity: 0.35 },
  inner: { padding: spacing.xl, gap: spacing.sm, alignItems: "center" },
  orbWrap: { alignItems: "center", justifyContent: "center", height: 208 },
  outerRing: { position: "absolute", width: 224, height: 224, borderRadius: 112, borderWidth: 1 },
  orbRing: { position: "absolute", width: 192, height: 192, borderRadius: 96, borderWidth: 1 },
  goldRing: { position: "absolute", width: 182, height: 182, borderRadius: 91, borderWidth: 1.5 },
  glow: { position: "absolute", width: 204, height: 204, borderRadius: 102 },
  label: { fontFamily: fonts.displayBold, fontSize: 26, color: c.onSurface, letterSpacing: -0.3, textAlign: "center" },
  meaning: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurfaceSecondary, textAlign: "center" },
  reason: { fontFamily: fonts.textMedium, fontSize: 14, lineHeight: 20, color: c.onSurface, textAlign: "center" },
  row: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", justifyContent: "center" },
  note: { fontFamily: fonts.text, fontSize: 12, lineHeight: 17, color: c.onSurfaceSecondary },
}));

const ease = Easing.inOut(Easing.ease);

export function ApolloHero({ resolution, visibility, adapterLabel, isMock, capabilities = [], animate = true, quietNow = false, sniffing = false }: {
  resolution: StateResolution; visibility: Visibility; adapterLabel: string; isMock: boolean; animate?: boolean; quietNow?: boolean;
  /** Used only to have Higgins name a real permission gap by name — never a generic "this is mock" disclaimer. */
  capabilities?: Capability[];
  /** True while Apollo is actively re-checking (Verify now / pull-to-refresh) — shows the transient Sniffing state. */
  sniffing?: boolean;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const tone = resolution.visibilityLost ? "unknown" : resolution.state;
  const color = toneColor(colors, tone);
  const state: ApolloState | "lost" = resolution.visibilityLost ? "lost" : sniffing ? "sniffing" : resolution.state;
  const gif = animate && state !== "lost" ? STATE_GIF[state] : undefined;
  const [checklistOpen, setChecklistOpen] = useState(false);
  const [ackKey, setAckKey] = useState<string | null>(null);
  const chime = useAudioPlayer(require("../../assets/sounds/apollo_chime.wav"));

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
  }, [state, animate, ring, scale, ty, glow]);

  const ringStyle = useAnimatedStyle(() => ({ transform: [{ scale: ring.value }], opacity: 1.35 - ring.value }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));
  const dogStyle = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }, { scale: scale.value }] }));

  const title = resolution.visibilityLost ? "Apollo can't see right now" : STATE_LABEL[resolution.state];
  const meaning = resolution.visibilityLost ? "Protection is off or has no active checks. This is not a safe state." : STATE_MEANING[resolution.state];
  // "Run a check" is never said bare: the exact checks are listed (tappable, in a popup) and read aloud. Completion
  // counts from the start of today, so a check already done this morning shows as done.
  const checks = sniffing ? [] : recommendedChecks(resolution);
  const askedAt = useMemo(() => new Date(new Date().setHours(0, 0, 0, 0)).toISOString(), []);
  const permissionNote = higginsPermissionNote(capabilities);
  const spokenText = `${title}. ${meaning} ${resolution.reason} ${checksSpoken(checks)} ${permissionNote ?? ""}`.trim();

  // Higgins keeps asking, gently: while checks are waiting and haven't been acknowledged, the button pulses and
  // chimes once a minute. Tapping Hear Higgins (to start speech) silences the reminder and opens the checklist.
  const pendingKey = checks.length ? `${state}:${checks.join(",")}` : null;
  const reminderActive = !!pendingKey && ackKey !== pendingKey;
  const bellPulse = useSharedValue(1);

  useEffect(() => {
    cancelAnimation(bellPulse);
    if (reminderActive && animate) {
      bellPulse.value = withRepeat(withSequence(withTiming(1.05, { duration: 500, easing: ease }), withTiming(1, { duration: 500, easing: ease })), -1, false);
    } else {
      bellPulse.value = withTiming(1, { duration: 200 });
    }
  }, [reminderActive, animate, bellPulse]);
  const bellPulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: bellPulse.value }] }));

  useEffect(() => {
    if (!reminderActive) return;
    const ring = () => { if (AppState.currentState === "active") { try { chime.seekTo(0); chime.play(); } catch { /* not ready */ } } };
    ring();
    const id = setInterval(ring, REMINDER_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reminderActive, pendingKey]);

  const onHearHiggins = () => {
    if (pendingKey) setAckKey(pendingKey);
    if (checks.length) setChecklistOpen(true);
  };

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
        <Text style={s.meaning}>{meaning}</Text>
        <Text style={s.reason} testID="apollo-state-reason">{resolution.reason}</Text>
        <Animated.View style={bellPulseStyle}>
          <View style={[s.row, { alignItems: "center" }]}>
            <HigginsSpeakButton text={spokenText} testID="hero-hear-higgins" onPress={onHearHiggins} />
            {reminderActive ? <BellRing testID="hero-reminder-bell" size={18} color={colors.growling} /> : null}
          </View>
        </Animated.View>
        {reminderActive ? <Text style={s.note} testID="hero-reminder-note">Chiming every minute until you tap Hear Higgins.</Text> : null}
        <View style={s.row}>
          <Pill testID="visibility-pill" tone={visibility === "full" ? "resting" : visibility === "limited" ? "growling" : "unknown"} label={visibility === "full" ? "Full visibility" : visibility === "limited" ? "Limited visibility" : "No visibility"} />
          {resolution.recovering ? <Pill tone="growling" label="Awaiting fresh check" testID="recovering-pill" /> : null}
          {resolution.recovering && resolution.drivingEvent?.state === "biting" && resolution.drivingEvent.verified_block ? <Pill tone="resting" label="Threat contained" testID="contained-pill" /> : null}
          {quietNow ? <Pill tone="unknown" label="Quiet hours" testID="quiet-pill" /> : null}
          {!animate ? <Pill tone="unknown" label="Battery saver" testID="lowpower-pill" /> : null}
          {isMock ? <DevTag label={adapterLabel} testID="mock-adapter-pill" /> : null}
        </View>
      </View>
      <Sheet visible={checklistOpen} onClose={() => setChecklistOpen(false)} title="Checks I need you to run" testID="hero-checklist-sheet">
        <HigginsChecks checks={checks} askedAt={askedAt} messageId="hero" record={false} title="" />
        {permissionNote ? <Body testID="hero-checklist-permission-note">{permissionNote}</Body> : null}
        <Button testID="hero-checklist-close" variant="ghost" label="Got it" onPress={() => setChecklistOpen(false)} />
      </Sheet>
    </View>
  );
}
