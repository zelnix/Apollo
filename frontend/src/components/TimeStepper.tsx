// Compact hour/half-hour stepper for quiet-hours windows (no native picker dependency).
import ChevronDown from "lucide-react-native/icons/chevron-down";
import ChevronUp from "lucide-react-native/icons/chevron-up";
import React from "react";
import { Pressable, Text, View } from "react-native";

import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  wrap: { flex: 1, backgroundColor: c.surfaceTertiary, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, alignItems: "center", gap: 1 },
  label: { fontFamily: fonts.textMedium, fontSize: 10, color: c.onSurfaceSecondary, textTransform: "uppercase", letterSpacing: 0.6 },
  value: { fontFamily: fonts.displayBold, fontSize: 15, color: c.onSurface },
  btn: { width: 36, height: 24, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
}));

export function formatMinutes(m: number): string {
  const h = Math.floor(m / 60) % 24;
  const mm = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mm.toString().padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

export function TimeStepper({ label, minutes, onChange, step = 30, testID }: { label: string; minutes: number; onChange: (m: number) => void; step?: number; testID?: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const bump = (d: number) => onChange((minutes + d + 1440) % 1440);
  return (
    <View style={s.wrap} testID={testID}>
      <Pressable onPress={() => bump(step)} style={s.btn} accessibilityRole="button" accessibilityLabel={`${label} later`} testID={testID ? `${testID}-up` : undefined}><ChevronUp size={16} color={colors.onSurface} /></Pressable>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value} testID={testID ? `${testID}-value` : undefined}>{formatMinutes(minutes)}</Text>
      <Pressable onPress={() => bump(-step)} style={s.btn} accessibilityRole="button" accessibilityLabel={`${label} earlier`} testID={testID ? `${testID}-down` : undefined}><ChevronDown size={16} color={colors.onSurface} /></Pressable>
    </View>
  );
}
