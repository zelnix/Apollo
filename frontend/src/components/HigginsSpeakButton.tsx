// "Hear Higgins" — a small speaker button that reads the given text aloud in Higgins' voice. Tap again to stop.
import Volume2 from "lucide-react-native/icons/volume-2";
import VolumeX from "lucide-react-native/icons/volume-x";
import React from "react";
import { ActivityIndicator, Pressable, Text } from "react-native";

import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { useHiggins } from "@/src/voice/higgins";

const useStyles = makeStyles((c) => ({
  // Navy premium CTA — gold icon, white text, fine gold border. See design_guidelines.json "Buttons".
  btn: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 48, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: c.goldBorder, backgroundColor: c.brand, alignSelf: "flex-start" },
  btnOn: { borderColor: c.resting },
  label: { fontFamily: fonts.textSemibold, fontSize: 14, color: "#FFFFFF" },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  iconOn: { backgroundColor: c.restingTint },
}));

export function HigginsSpeakButton({ text, label = "Hear Higgins", compact = false, testID, onPress: onExtraPress }: { text: string; label?: string; compact?: boolean; testID?: string; /** Fires alongside the tap, before speech starts (e.g. to open a related popup). Not called when tapping to stop. */ onPress?: () => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const { deviceId, showToast } = useApollo();
  const { speak, speaking, busy } = useHiggins(deviceId);
  const active = !!speaking && speaking === text.trim().slice(0, 1500);
  const onPress = () => {
    if (!active) onExtraPress?.();
    void speak(text).catch((e: Error) => showToast(e.message || "I couldn't speak just now.", "neutral"));
  };
  const Icon = active ? VolumeX : Volume2;
  if (compact) {
    return (
      <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={active ? "Stop Higgins" : label} onPress={onPress} style={[s.icon, active && s.iconOn]} hitSlop={6}>
        {busy ? <ActivityIndicator size="small" color={colors.resting} /> : <Icon size={18} color={active ? colors.resting : colors.onSurfaceSecondary} />}
      </Pressable>
    );
  }
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={[s.btn, active && s.btnOn]}>
      {busy ? <ActivityIndicator size="small" color={colors.resting} /> : <Icon size={18} color={active ? colors.resting : colors.gold} />}
      <Text style={s.label}>{busy ? "Higgins is clearing his throat…" : active ? "Stop" : label}</Text>
    </Pressable>
  );
}
