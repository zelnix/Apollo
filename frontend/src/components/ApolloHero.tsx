// Home hero: communicates the current Apollo state with exact wording.
// Visibility gaps are surfaced explicitly, never masked by a safe state.
// Apollo (the shield) is animated per state: patrolling = slow breath + look-around sweep,
// growling = low rumble, barking = sharp bounces, biting = lunge and snap.

import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Pressable, Text, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { useRouter } from "expo-router";

import type { StateResolution } from "@/src/domain/stateMachine";
import type { AttentionItem } from "@/src/domain/homeAttention";
import { STATE_LABEL, STATE_MEANING, type ApolloState, type Capability } from "@/src/domain/types";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { HigginsChecks } from "@/src/components/HigginsChecks";
import { HigginsSpeakButton } from "@/src/components/HigginsSpeakButton";
import { checksSpoken, higginsPermissionNote, recommendedChecks, CHECKS } from "@/src/domain/higginsChecks";
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
  // ears_up: no GIF yet — drop apollo-ears-up.gif in here when it exists. Falls back to the static mark below.
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

/** A full, plain-English explanation of WHY Apollo is in a warning state and what it means for the
 *  person — used when there isn't a more specific incident to quote. Never a terse "run a check". */
function warningExplainer(resolution: StateResolution, checkNames: string[]): string {
  const names = checkNames.join(" and ");
  if (resolution.visibilityLost) {
    return `Apollo is growling because it can't confirm its automatic protection is switched on, which means it may not be watching your device for threats in the background right now. ${names ? `Open the ${names} so I can check exactly what's running and help you switch protection back on.` : "Open this so I can check exactly what's running and help you switch protection back on."}`;
  }
  if (resolution.recovering) {
    return `Apollo is staying cautious after a recent alert and won't settle back to normal patrol until it has run a fresh check. ${names ? `Run the ${names} and I'll confirm whether the concern has cleared or still needs your attention.` : "Open this and I'll show you the checks that confirm whether the concern has cleared."}`;
  }
  return names
    ? `Apollo has noticed something that needs a closer look. Run the ${names} and I'll take you through exactly what it found and what it means for you.`
    : "Apollo has noticed something that needs a closer look. Open this and I'll take you through exactly what it found and what it means for you.";
}

/** When Apollo can't verify protection, name the SPECIFIC protections affected and what's wrong with each
 *  (from the capability's own truthful detail) rather than a vague "protection is unavailable". */
function protectionProblem(capabilities: Capability[], fallback: string): string {
  const affected = capabilities.filter((c) => c.status !== "active" && c.status !== "coming_later");
  if (!affected.length) return fallback;
  const lines = affected.slice(0, 4).map((c) => `• ${c.title}: ${c.detail}`);
  return `Apollo can't confirm these protections are running right now:\n${lines.join("\n")}`;
}

export function ApolloHero({ resolution, adapterLabel, isMock, capabilities = [], animate = true, quietNow = false, sniffing = false, attention = [] }: {
  resolution: StateResolution; adapterLabel: string; isMock: boolean; animate?: boolean; quietNow?: boolean;
  /** Used only to have Higgins name a real permission gap by name — never a generic "this is mock" disclaimer. */
  capabilities?: Capability[];
  /** True while Apollo is actively re-checking (Verify now / pull-to-refresh) — shows the transient Sniffing state. */
  sniffing?: boolean;
  /** Specific, real issues that need the person — drives the exact problem + Higgins step + action. */
  attention?: AttentionItem[];
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
  const reasonRoute = resolution.reasonRoute;
  const router = useRouter();

  // The specific issue Apollo is surfacing, from REAL gate/event data. When present, it names the
  // affected gate, the exact problem and Higgins' next step — shown directly on this card so the
  // person sees what Apollo is reacting to without scrolling. The matching item is de-duplicated
  // from the "Needs your attention" list below. When absent, fall back to the honest resolution
  // reason (e.g. "waiting for a fresh check") — never a vague "needs your decision".
  const primary = attention[0] ?? null;
  const reason = resolution.reason;
  const drivingEvent = resolution.drivingEvent;
  const checks = sniffing ? [] : recommendedChecks(resolution);
  const askedAt = useMemo(() => new Date(new Date().setHours(0, 0, 0, 0)).toISOString(), []);
  const permissionNote = higginsPermissionNote(capabilities);
  // The exact problem + Higgins' next step shown on the card for ANY warning state. Prefer a specific
  // incident (an attention item), then the Patrol event currently driving Apollo's state (so a growling
  // "worth checking" shows its REAL detail), then the honest resolution reason + the concrete checks
  // Higgins recommends. Never a bare "needs your decision".
  const checkNames = checks.map((c) => CHECKS[c].label);
  const detailTitle = primary ? primary.title : ((drivingEvent?.headline || "").trim() || null);
  const detailProblem = primary
    ? primary.problem
    : ((drivingEvent?.what_happened || "").trim()
      || (resolution.visibilityLost ? protectionProblem(capabilities, reason) : reason));
  const detailHiggins = primary
    ? primary.higgins
    : ((drivingEvent?.what_to_do || "").trim() || warningExplainer(resolution, checkNames));
  // Deep-link straight to the specific issue — the whole card is tappable, so a separate "see" button is not needed.
  const heroRoute = primary ? primary.route : (drivingEvent ? `/patrol/${encodeURIComponent(drivingEvent.event_id)}` : reasonRoute);
  const needsAction = state !== "resting" && state !== "sniffing" && !!heroRoute;
  const spokenText = (state === "resting" || state === "sniffing")
    ? `${title}. ${meaning} ${reason} ${permissionNote ?? ""}`.trim()
    : `${title}. ${detailTitle ? `${detailTitle}. ` : ""}${detailProblem} ${detailHiggins} ${checksSpoken(checks)} ${permissionNote ?? ""}`.trim();

  const onHearHiggins = () => {
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
        {/* Benign states show the generic meaning. When Apollo is reacting to a real issue, show the
         *  SPECIFIC problem Apollo found and Higgins' plain-English next step right here on the card. */}
        {(state === "resting" || state === "sniffing") ? (
          <Text style={s.meaning} testID="apollo-state-meaning">{meaning}</Text>
        ) : needsAction ? (
          <>
            {detailTitle ? <Text style={s.problemTitle} testID="apollo-state-problem-title">{detailTitle}</Text> : null}
            <Pressable testID="hero-open-issue" accessibilityRole="button" accessibilityLabel={`Open ${detailTitle || "what needs attention"}`} onPress={() => router.push(heroRoute as any)} style={({ pressed }) => [s.problemBox, { opacity: pressed ? 0.85 : 1 }]}>
              <Text style={s.problemLabel}>PROBLEM</Text>
              <Text style={s.problemText} testID="apollo-hero-problem-text">{detailProblem}</Text>
              <Text style={[s.problemLabel, { marginTop: 6 }]}>HIGGINS</Text>
              <Text style={s.higginsText} testID="apollo-hero-higgins-text">{detailHiggins}</Text>
              <Text style={s.openHint}>Open this &rsaquo;</Text>
            </Pressable>
          </>
        ) : heroRoute ? (
          <Pressable onPress={() => router.push(heroRoute as any)} accessibilityRole="link" testID="apollo-state-reason-link" style={{ minHeight: 44, justifyContent: "center" }}>
            <Text style={s.reasonLink} testID="apollo-state-reason">{reason} →</Text>
          </Pressable>
        ) : reasonRoute ? (
          <Pressable onPress={() => router.push(reasonRoute as any)} accessibilityRole="link" testID="apollo-state-reason-link" style={{ minHeight: 44, justifyContent: "center" }}>
            <Text style={s.reasonLink} testID="apollo-state-reason">{reason} →</Text>
          </Pressable>
        ) : (
          <Text style={s.reason} testID="apollo-state-reason">{reason}</Text>
        )}
        <View style={[s.row, { alignItems: "center" }]}><HigginsSpeakButton small text={spokenText} testID="hero-hear-higgins" onPress={onHearHiggins} /></View>
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
