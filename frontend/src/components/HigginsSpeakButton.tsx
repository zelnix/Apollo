// "Hear Higgins" — a small speaker button that reads the given text aloud in Higgins' voice. Tap again to stop.
import Volume2 from "lucide-react-native/icons/volume-2";
import VolumeX from "lucide-react-native/icons/volume-x";
import React from "react";
import { ActivityIndicator, Pressable, Text } from "react-native";

import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { useHiggins } from "@/src/voice/higgins";

const useStyles = makeStyles((c) => ({
  btn: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: c.border, backgroundColor: c.surfaceTertiary, alignSelf: "flex-start" },
  on: { borderColor: c.resting, backgroundColor: c.restingTint },
  label: { fontFamily: fonts.textMedium, fontSize: 14, color: c.onSurface },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
}));

export function HigginsSpeakButton({ text, label = "Hear Higgins", compact = false, testID }: { text: string; label?: string; compact?: boolean; testID?: string }) {
  const s = useStyles();
  const { colors } = useTheme();
  const { deviceId, showToast } = useApollo();
  const { speak, speaking, busy } = useHiggins(deviceId);
  const active = !!speaking && speaking === text.trim().slice(0, 1500);
  const onPress = () => { void speak(text).catch((e: Error) => showToast(e.message || "Higgins couldn't speak just now.", "neutral")); };
  const Icon = active ? VolumeX : Volume2;
  if (compact) {
    return (
      <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={active ? "Stop Higgins" : label} onPress={onPress} style={[s.icon, active && s.on]} hitSlop={6}>
        {busy ? <ActivityIndicator size="small" color={colors.resting} /> : <Icon size={18} color={active ? colors.resting : colors.onSurfaceSecondary} />}
      </Pressable>
    );
  }
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={[s.btn, active && s.on]}>
      {busy ? <ActivityIndicator size="small" color={colors.resting} /> : <Icon size={18} color={active ? colors.resting : colors.onSurface} />}
      <Text style={s.label}>{busy ? "Higgins is clearing his throat…" : active ? "Stop" : label}</Text>
    </Pressable>
  );
}
