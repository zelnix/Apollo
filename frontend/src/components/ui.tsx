// Small shared UI primitives. All colors from theme tokens.

import * as Haptics from "expo-haptics";
import React from "react";
import { Platform, Pressable, Text, View, type StyleProp, type ViewStyle } from "react-native";

import type { ApolloState, CapabilityStatus } from "@/src/domain/types";
import { fonts, makeStyles, radius, spacing, useTheme, type ThemeColors } from "@/src/theme";

export type Tone = ApolloState | "neutral" | "unknown";

export function toneColor(colors: ThemeColors, tone: Tone) {
  switch (tone) {
    case "resting": return colors.resting;
    case "growling": return colors.growling;
    case "barking": return colors.barking;
    case "biting": return colors.biting;
    case "unknown": return colors.unknown;
    default: return colors.onSurfaceSecondary;
  }
}
export function toneTint(colors: ThemeColors, tone: Tone) {
  switch (tone) {
    case "resting": return colors.restingTint;
    case "growling": return colors.growlingTint;
    case "barking": return colors.barkingTint;
    case "biting": return colors.bitingTint;
    default: return colors.unknownTint;
  }
}

export function capabilityTone(status: CapabilityStatus): Tone {
  if (status === "active") return "resting";
  if (status === "available" || status === "inactive") return "neutral";
  if (status === "permission_required") return "growling";
  return "unknown";
}

const useStyles = makeStyles((c) => ({
  card: { backgroundColor: c.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: spacing.lg },
  pill: { paddingHorizontal: spacing.md, height: 28, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 6, alignSelf: "flex-start" },
  pillText: { fontFamily: fonts.textSemibold, fontSize: 12, letterSpacing: 0.2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  btn: { minHeight: 48, borderRadius: radius.md, paddingHorizontal: spacing.xl, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: spacing.sm },
  btnText: { fontFamily: fonts.textSemibold, fontSize: 15 },
  section: { fontFamily: fonts.display, fontSize: 13, color: c.onSurfaceSecondary, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: spacing.md },
  h1: { fontFamily: fonts.displayBold, fontSize: 28, color: c.onSurface, letterSpacing: -0.4 },
  body: { fontFamily: fonts.text, fontSize: 15, lineHeight: 22, color: c.onSurfaceSecondary },
  header: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
}));

export function Card({ children, style, testID }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const s = useStyles();
  return <View testID={testID} style={[s.card, style]}>{children}</View>;
}

export function Pill({ label, tone = "neutral", testID }: { label: string; tone?: Tone; testID?: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const color = toneColor(colors, tone);
  return (
    <View testID={testID} style={[s.pill, { backgroundColor: toneTint(colors, tone) }]}>
      <View style={[s.dot, { backgroundColor: color }]} />
      <Text style={[s.pillText, { color }]}>{label}</Text>
    </View>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  const s = useStyles();
  return <Text style={s.section}>{children}</Text>;
}

export function ScreenHeader({ title, right, testID }: { title: string; right?: React.ReactNode; testID?: string }) {
  const s = useStyles();
  return (
    <View style={s.header} testID={testID}>
      <Text style={s.h1}>{title}</Text>
      {right}
    </View>
  );
}

export function Body({ children, style, testID }: { children: React.ReactNode; style?: StyleProp<any>; testID?: string }) {
  const s = useStyles();
  return <Text testID={testID} style={[s.body, style]}>{children}</Text>;
}

type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "warning";

export function Button({ label, onPress, variant = "primary", icon, disabled, testID, style }: {
  label: string; onPress: () => void; variant?: BtnVariant; icon?: React.ReactNode; disabled?: boolean; testID: string; style?: StyleProp<ViewStyle>;
}) {
  const s = useStyles();
  const { colors } = useTheme();
  const palette: Record<BtnVariant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: colors.brandPrimary, fg: colors.onBrandPrimary },
    secondary: { bg: colors.surfaceTertiary, fg: colors.onSurface, border: colors.borderStrong },
    ghost: { bg: "transparent", fg: colors.onSurfaceSecondary },
    danger: { bg: colors.biting, fg: colors.onError },
    warning: { bg: colors.growling, fg: colors.onWarning },
  };
  const p = palette[variant];
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => { if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onPress(); }}
      style={({ pressed }) => [s.btn, { backgroundColor: p.bg, borderWidth: p.border ? 1 : 0, borderColor: p.border, opacity: disabled ? 0.45 : pressed ? 0.82 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] }, style]}
    >
      {icon}
      <Text style={[s.btnText, { color: p.fg }]}>{label}</Text>
    </Pressable>
  );
}
