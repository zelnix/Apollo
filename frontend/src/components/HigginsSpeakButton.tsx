// "Hear Higgins" — a small speaker button that reads the given text aloud in Higgins' voice. Tap again to stop.
import Volume2 from "lucide-react-native/icons/volume-2";
import VolumeX from "lucide-react-native/icons/volume-x";
import { Image } from "expo-image";
import React from "react";
import { ActivityIndicator, Pressable, Text } from "react-native";

import { useApollo } from "@/src/store/ApolloContext";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { useHiggins } from "@/src/voice/higgins";

const useStyles = makeStyles((c) => ({
  // Navy premium CTA — gold icon, white text, fine gold border. See design_guidelines.json "Buttons".
  btn: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 48, paddingLeft: spacing.sm, paddingRight: spacing.lg, borderRadius: radius.pill, borderWidth: 1, borderColor: c.goldBorder, backgroundColor: c.brand, alignSelf: "flex-start" },
  btnSmall: { minHeight: 38, paddingRight: spacing.md },
  btnOn: { borderColor: c.resting },
  label: { fontFamily: fonts.textSemibold, fontSize: 14, color: "#FFFFFF" },
  labelSmall: { fontSize: 13 },
  face: { width: 32, height: 32, borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: c.goldBorder },
  faceSmall: { width: 26, height: 26, borderRadius: 13 },
  icon: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.pill },
  iconOn: { backgroundColor: c.restingTint },
}));

export function HigginsSpeakButton({ text, label = "Hear Higgins", compact = false, small = false, testID, onPress: onExtraPress, scopeId }: { text: string; label?: string; compact?: boolean; /** Slimmer height/face — used on the compact Home status card. */ small?: boolean; testID?: string; /** Investigation case ID: binds the audio to the case lifecycle. */ scopeId?: string; /** Fires alongside the tap, before speech starts (e.g. to open a related popup). Not called when tapping to stop. */ onPress?: () => void }) {
  const s = useStyles();
  const { colors } = useTheme();
  const { deviceId, showToast } = useApollo();
  const { speak, speaking, busy, error, errorForText } = useHiggins(deviceId);
  React.useEffect(() => { if (error && errorForText === text.trim()) showToast(error, 'neutral'); }, [error, errorForText, text, showToast]);
  const active = !!speaking && speaking === text.trim();
  const onPress = () => {
    if (!active) onExtraPress?.();
    void speak(text, scopeId).catch((e: Error) => showToast(e.message || "I couldn't speak just now.", "neutral"));
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
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={[s.btn, small && s.btnSmall, active && s.btnOn]}>
      <Image source={require("../../assets/images/higgins-avatar.png")} style={[s.face, small && s.faceSmall]} contentFit="cover" accessibilityLabel="Higgins" />
      {busy ? <ActivityIndicator size="small" color={colors.resting} /> : <Icon size={small ? 16 : 18} color={active ? colors.resting : colors.gold} />}
      <Text style={[s.label, small && s.labelSmall]}>{busy ? "Higgins is clearing his throat…" : active ? "Stop" : label}</Text>
    </Pressable>
  );
}
