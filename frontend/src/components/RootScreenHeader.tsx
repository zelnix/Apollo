import { useRouter } from "expo-router";
import Settings from "lucide-react-native/icons/settings";
import React, { useRef } from "react";
import { Pressable, View } from "react-native";

import { ScreenHeader } from "./ui";
import { makeStyles, radius, spacing, useTheme } from "@/src/theme";

const useStyles = makeStyles((c) => ({
  actions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  settings: { width: 48, height: 48, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", backgroundColor: c.surfaceSecondary, borderWidth: 1, borderColor: c.border },
}));

export function RootScreenHeader({ title, testID, rightAccessory }: { title: string; testID: string; rightAccessory?: React.ReactNode }) {
  const s = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const opening = useRef(false);
  const openSettings = () => {
    if (opening.current) return;
    opening.current = true;
    router.push("/settings");
  };
  return <ScreenHeader title={title} testID={testID} right={<View style={s.actions}>{rightAccessory}<Pressable testID={`${testID}-settings`} accessibilityRole="button" accessibilityLabel="Settings" accessibilityHint="Opens Apollo settings" onPress={openSettings} style={({ pressed }) => [s.settings, { opacity: pressed ? 0.75 : 1 }]}><Settings size={23} color={colors.onSurface} /></Pressable></View>} />;
}